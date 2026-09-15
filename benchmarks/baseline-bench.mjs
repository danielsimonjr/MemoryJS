#!/usr/bin/env node
/**
 * Step-1 baseline benchmark. A measurement record, not an optimization and not a CI gate.
 *
 * Run:  bun run build && node benchmarks/baseline-bench.mjs [--out benchmarks/results/<file>.json]
 * Config: benchmarks/baseline.config.json. Scratch data goes under os.tmpdir() and is removed.
 *
 * Measures the shipped dist build: cold import time, RSS, event-loop delay, basic search
 * latency, write throughput and bytes written, and lock wait. It also runs the CPU cases of
 * benchmarks/review-bench.ts and embeds their output. It lives outside tests/, so the
 * default vitest run never executes it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, platform, release, arch, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'benchmarks/baseline.config.json'), 'utf-8'));
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > 0 ? resolve(process.argv[outIdx + 1]) : undefined;
const distEntry = pathToFileURL(join(root, 'dist/index.js')).href;

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => {
  const s = sorted(xs);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// Nearest-rank percentile: with 100 samples, p99 is the 99th value, not the maximum.
const pct = (xs, p) => sorted(xs)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)];
const ms = (n) => Number(n.toFixed(3));
const dirBytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (sum, e) => sum + (e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0,
  );

// 1. Cold import: a fresh Node process per sample.
function coldImport() {
  const script = `const t=performance.now();await import(${JSON.stringify(distEntry)});` +
    `console.log(JSON.stringify({ms:performance.now()-t,rss:process.memoryUsage().rss}))`;
  const samples = [];
  for (let i = 0; i < config.coldImportRuns; i++) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf-8' });
    samples.push(JSON.parse(out.trim().split('\n').pop()));
  }
  return {
    runs: samples.length,
    medianMs: ms(median(samples.map((s) => s.ms))),
    minMs: ms(Math.min(...samples.map((s) => s.ms))),
    maxMs: ms(Math.max(...samples.map((s) => s.ms))),
    rssAfterImportMiB: ms(median(samples.map((s) => s.rss)) / 2 ** 20),
  };
}

async function workload() {
  const { ManagerContext } = await import(distEntry);
  const dir = mkdtempSync(join(tmpdir(), 'memoryjs-baseline-'));
  const loop = monitorEventLoopDelay({ resolution: config.eventLoopResolutionMs });
  const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
  try {
    loop.enable();

    // 2. Write throughput and bytes written.
    const total = config.entities;
    const writeStart = performance.now();
    for (let i = 0; i < total; i += config.writeBatchSize) {
      const batch = [];
      for (let j = i; j < Math.min(total, i + config.writeBatchSize); j++) {
        batch.push({
          name: `entity-${j}`,
          entityType: `topic-${j % 10}`,
          observations: Array.from({ length: config.observationsPerEntity }, (_, k) => `observation ${k} for entity ${j}`),
        });
      }
      await ctx.entityManager.createEntities(batch);
    }
    const writeMs = performance.now() - writeStart;
    const bytesWritten = dirBytes(dir);

    // 3. Basic search latency. The first call per query is uncached; later calls can hit the
    //    search result cache, so both are recorded and must not be compared with each other.
    const search = {};
    for (const q of config.searchQueries) {
      const first = performance.now();
      await ctx.searchManager.searchNodes(q);
      const firstCallMs = performance.now() - first;
      const samples = [];
      let hits = 0;
      for (let i = 0; i < config.searchSamplesPerQuery; i++) {
        const t = performance.now();
        const result = await ctx.searchManager.searchNodes(q);
        samples.push(performance.now() - t);
        hits = result.entities.length;
      }
      search[q] = { firstCallMs: ms(firstCallMs), warmMedianMs: ms(median(samples)), hits };
    }

    // 4. Lock wait: N concurrent addObservations on ONE entity serialize on the storage mutex.
    //    Each call's latency is measured from enqueue, so the tail is the queue drain.
    const n = config.lockWaitConcurrency;
    const waits = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const t = performance.now();
        await ctx.observationManager.addObservations([{ entityName: 'entity-0', contents: [`lock probe ${i}`] }]);
        return performance.now() - t;
      }),
    );

    loop.disable();
    return {
      write: {
        entities: total,
        batchSize: config.writeBatchSize,
        totalMs: ms(writeMs),
        entitiesPerSec: ms(total / (writeMs / 1000)),
        bytesWritten,
      },
      search,
      lockWait: { concurrency: n, p50Ms: ms(pct(waits, 50)), p99Ms: ms(pct(waits, 99)), maxMs: ms(Math.max(...waits)) },
      eventLoopDelay: {
        p50Ms: ms(loop.percentile(50) / 1e6),
        p99Ms: ms(loop.percentile(99) / 1e6),
        maxMs: ms(loop.max / 1e6),
      },
      rss: {
        afterWorkloadMiB: ms(process.memoryUsage().rss / 2 ** 20),
        peakMiB: ms((process.resourceUsage().maxRSS * 1024) / 2 ** 20),
      },
    };
  } finally {
    ctx.close();
    // close() detaches async disposal; on Windows an open handle can make removal throw.
    // A cleanup failure must not replace the measurements.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (err) {
      console.error(`warning: could not remove ${dir}: ${err.message}`);
    }
  }
}

// 5. Existing CPU microbenchmarks (PR #143), embedded unchanged.
function reviewBench() {
  const out = execFileSync(process.execPath, ['--import', 'tsx', 'benchmarks/review-bench.ts'], {
    cwd: root,
    encoding: 'utf-8',
  });
  return out.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}

const result = {
  label: 'MemoryJS step-1 baseline',
  date: new Date().toISOString(),
  machine: {
    cpu: cpus()[0]?.model.trim(),
    logicalCores: cpus().length,
    memoryGiB: ms(totalmem() / 2 ** 30),
    os: `${platform()} ${release()} ${arch()}`,
    node: process.version,
  },
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim(),
  config,
  coldImport: coldImport(),
  ...(await workload()),
  reviewBench: reviewBench(),
};

const json = JSON.stringify(result, null, 2);
console.log(json);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json + '\n');
}
process.exit(0);
