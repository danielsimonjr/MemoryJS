/**
 * TEMPORARY diagnostic (removed before merge): per-category timing of the recursa loop.
 *
 * Runs one JSONL and one SQLite recursa-loop cycle — the same work
 * `tests/integration/agent/recursa-loop.test.ts` does — and prints where the wall clock goes,
 * split by operation category with call counts. Runs on every CI OS so the same instrument
 * measures Linux and Windows.
 *
 * Usage: `bunx tsx scripts/recursa-perf-probe.ts`
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { ManagerContext } from '../src/core/ManagerContext.js';
import { GraphStorage } from '../src/core/GraphStorage.js';
import { LearningTrace } from '../src/agent/learning/LearningTrace.js';
import { KnowledgeRepository } from '../src/agent/knowledge/KnowledgeRepository.js';
import { stratifiedSplit } from '../src/agent/evaluation/Evaluator.js';
import { DeterministicJudge } from '../src/agent/evaluation/DeterministicJudge.js';
import type { TaskRecord } from '../src/types/learning.js';
import { syntheticCorpus } from '../tests/unit/agent/bootstrap/bootstrapFixtures.js';

interface Stat {
  n: number;
  ms: number;
  bytes: number;
}

const cats = new Map<string, Stat>();

function add(cat: string, ms: number, bytes = 0): void {
  const s = cats.get(cat) ?? { n: 0, ms: 0, bytes: 0 };
  s.n += 1;
  s.ms += ms;
  s.bytes += bytes;
  cats.set(cat, s);
}

/** Bytes of a patched call's first argument when it is (an array of) strings or a Buffer. */
function sizeOf(arg: unknown): number {
  if (typeof arg === 'string') return Buffer.byteLength(arg);
  if (Buffer.isBuffer(arg)) return arg.length;
  if (Array.isArray(arg)) return arg.reduce<number>((n, x) => n + (typeof x === 'string' ? Buffer.byteLength(x) : 0), 0);
  return 0;
}

/** Patch `obj[name]` so every call is timed under `cat`. */
function patch(obj: object, name: string, cat: string): void {
  const rec = obj as unknown as Record<string, (...a: unknown[]) => unknown>;
  const orig = rec[name];
  if (typeof orig !== 'function') {
    process.stderr.write(`[probe] missing method ${name}\n`);
    return;
  }
  rec[name] = function (this: unknown, ...args: unknown[]) {
    const t0 = process.hrtime.bigint();
    const done = (bytes = 0): void => {
      add(cat, Number(process.hrtime.bigint() - t0) / 1e6, bytes);
    };
    let out: unknown;
    try {
      out = orig.apply(this, args);
    } catch (err) {
      done(sizeOf(args[0]));
      throw err;
    }
    if (out instanceof Promise) return out.finally(() => done(sizeOf(args[0])));
    done(sizeOf(args[0]));
    return out;
  };
}

async function instrumentRawFs(): Promise<void> {
  const probe = await fsp.open(join(tmpdir(), 'recursa-probe.txt'), 'w');
  const proto = Object.getPrototypeOf(probe) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const name of ['sync', 'write', 'writeFile', 'close'] as const) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    proto[name] = async function (this: unknown, ...args: unknown[]) {
      const t0 = process.hrtime.bigint();
      try {
        return await orig.apply(this, args);
      } finally {
        add(`fs.FileHandle.${name}`, Number(process.hrtime.bigint() - t0) / 1e6);
      }
    };
  }
  await probe.close();

  for (const name of ['stat', 'open', 'rename', 'mkdir', 'readdir', 'unlink', 'chmod', 'lstat', 'readFile'] as const) {
    const orig = (fsp as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    if (typeof orig !== 'function') continue;
    (fsp as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name] = async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const t0 = process.hrtime.bigint();
      try {
        return await orig.apply(this, args);
      } finally {
        add(`fs.${name}`, Number(process.hrtime.bigint() - t0) / 1e6);
      }
    };
  }
}

function instrument(): void {
  patch(GraphStorage.prototype, 'appendLines', 'GS.appendLines');
  patch(GraphStorage.prototype, 'durableWriteFile', 'GS.durableWriteFile');
  patch(GraphStorage.prototype, 'durableAppendFile' as never, 'GS.durableAppendFile');
  patch(GraphStorage.prototype, 'appendLocked', 'GS.appendLocked');
  patch(GraphStorage.prototype, 'updateEntity', 'GS.updateEntity');
  patch(GraphStorage.prototype, 'updateEntities', 'GS.updateEntities');
  patch(GraphStorage.prototype, 'compactInternal', 'GS.compact');
  patch(GraphStorage.prototype, 'saveGraphInternal', 'GS.saveGraphInternal');
  patch(GraphStorage.prototype, 'loadGraph', 'GS.loadGraph');
  patch(GraphStorage.prototype, 'ensureLoaded', 'GS.ensureLoaded');
  patch(GraphStorage.prototype, 'loadFromDisk' as never, 'GS.loadFromDisk');
  patch(LearningTrace.prototype, 'writeState', 'trace.writeState');
  patch(LearningTrace.prototype, 'appendAction', 'trace.appendAction');
  patch(LearningTrace.prototype, 'setMetrics', 'trace.setMetrics');
  patch(LearningTrace.prototype, 'addRevisionId', 'trace.addRevisionId');
  patch(KnowledgeRepository.prototype, 'snapshot', 'repo.snapshot');
  patch(KnowledgeRepository.prototype, 'applyRevision', 'repo.applyRevision');
  patch(KnowledgeRepository.prototype, 'cloneForValidation', 'repo.cloneForValidation');
  patch(KnowledgeRepository.prototype, 'loadForContext', 'repo.loadForContext');
  patch(KnowledgeRepository.prototype, 'liveDigest', 'repo.liveDigest');
  patch(KnowledgeRepository.prototype, 'snapshotForRevision', 'repo.snapshotForRevision');
  patch(GraphStorage.prototype, 'getGraphForMutation', 'GS.getGraphForMutation');
  patch(GraphStorage.prototype, 'saveGraph', 'GS.saveGraph');
}

async function runOne(backend: 'jsonl' | 'sqlite'): Promise<void> {
  process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
  const root = mkdtempSync(join(tmpdir(), `recursa-probe-${backend}-`));
  const publishDir = join(root, 'skills');
  const file = backend === 'jsonl' ? 'memory.jsonl' : 'memory.db';
  const ctx = new ManagerContext({ storagePath: join(root, file), storageType: backend, skillPublishRoot: root });

  const tBoot = process.hrtime.bigint();
  const boot = await ctx.bootstrapper({ learning: { publishDir } }).run({
    sources: syntheticCorpus(32, 4),
    budget: { maxRounds: 2 },
    corpusLabel: 'corpus',
    taskCount: 12,
  });
  const bootMs = Number(process.hrtime.bigint() - tBoot) / 1e6;

  const graph = await ctx.storage.loadGraph();
  const tasks = boot.taskIds
    .map((id) => graph.entities.find((e) => e.name === id)?.taskRecord)
    .filter((t): t is TaskRecord => t !== undefined)
    .map((t, i) => ({ ...t, input: `Learned ${t.id}`, category: i % 2 === 0 ? 'ledger' : 'vendor' }));

  const split = stratifiedSplit(tasks, { testFraction: 0.25, by: 'difficulty', seed: 42 });
  const expectedOf = (task: TaskRecord): string =>
    task.rubric.map((c) => (Array.isArray(c.expected) ? c.expected.join(' ') : String(c.expected ?? ''))).join('; ');
  const solver = {
    async solve(task: TaskRecord, knowledge: { markdown: string }) {
      const learned = knowledge.markdown.includes(`Learned: ${task.id}`);
      return { answer: learned ? expectedOf(task) : 'unknown', traceAddrs: [] };
    },
  };

  const before = await ctx.storage.loadGraph();
  const fileBytes = (): number => {
    try {
      return statSync(join(root, file)).size;
    } catch {
      return -1;
    }
  };
  const bytesBefore = fileBytes();
  const entitiesBefore = before.entities.length;

  const tLearn = process.hrtime.bigint();
  const loop = ctx.learningLoop({ solver, judge: new DeterministicJudge(), publishDir });
  const result = await loop.learn({
    taskIds: split.train.map((t) => t.id),
    tasks: split.train,
    budget: { maxRounds: 3 },
    validationSampleSize: 4,
    split: 'auto',
  });
  const learnMs = Number(process.hrtime.bigint() - tLearn) / 1e6;

  const after = await ctx.storage.loadGraph();
  process.stdout.write(
    `\n--- ${backend} ---\n` +
      `bootstrap ${bootMs.toFixed(0)}ms | learn ${learnMs.toFixed(0)}ms | stop=${result.stoppedBecause}\n` +
      `entities ${entitiesBefore} -> ${after.entities.length}, relations ${before.relations.length} -> ${after.relations.length}\n` +
      `file ${(bytesBefore / 1024).toFixed(0)} KiB -> ${(fileBytes() / 1024).toFixed(0)} KiB, tasks=${split.train.length}\n`,
  );
  await ctx.close();
  rmSync(root, { recursive: true, force: true });
}

async function report(): Promise<void> {
  const rows = [...cats.entries()].sort((a, b) => b[1].ms - a[1].ms);
  process.stdout.write('\n=== category timings (inclusive of nested work) ===\n');
  for (const [k, v] of rows) {
    process.stdout.write(
      `  ${k.padEnd(26)} n=${String(v.n).padStart(6)}  ${v.ms.toFixed(1).padStart(9)}ms` +
        `${v.bytes > 0 ? `  ${(v.bytes / 1024).toFixed(1)} KiB` : ''}\n`,
    );
  }
  const os = await import('node:os');
  process.stdout.write(`platform=${process.platform} node=${process.version} cpus=${os.cpus().length}\n`);
}

async function main(): Promise<void> {
  await instrumentRawFs();
  instrument();
  await runOne('jsonl');
  await runOne('sqlite');
  await report();
}

void main();
