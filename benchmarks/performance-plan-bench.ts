/** Reproducible performance-plan workloads. Run with NODE_ENV=production node --import tsx ... */
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GraphStorage } from '../src/core/GraphStorage.js';
import { BM25Search } from '../src/search/BM25Search.js';
import { FuzzySearch } from '../src/search/FuzzySearch.js';
import { TFIDFIndexManager } from '../src/search/TFIDFIndexManager.js';
import { InMemoryVectorStore } from '../src/search/VectorStore.js';
// Optional so the same harness can measure a baseline checkout predating ANN.
const annModule = await import('../src/search/LSHVectorStore.js').catch(() => undefined);
import { SemanticSearch } from '../src/search/SemanticSearch.js';
import { MockEmbeddingService } from '../src/search/EmbeddingService.js';
import type { Entity } from '../src/types/index.js';

const count = Number(process.argv[2] ?? 10000);
if (!Number.isInteger(count) || count < 100) throw new Error('Entity count must be an integer >= 100');
const samples = 100;
const warmupCalls = 10;
const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
};
async function measure(operation: () => unknown | Promise<unknown>) {
  const start = performance.now();
  await operation();
  const firstCallMs = performance.now() - start;
  for (let i = 0; i < warmupCalls; i++) await operation();
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  return { firstCallMs, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), samples, warmupCalls };
}
const directory = await mkdtemp(join(tmpdir(), 'memoryjs-perf-plan-'));
const storage = new GraphStorage(join(directory, 'graph.jsonl'));
const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
try {
  const entities: Entity[] = Array.from({ length: count }, (_, i) => ({
    name: `document-${String(i).padStart(8, '0')}`,
    entityType: 'document',
    observations: [`common subject group${i % 100} ${i % 1000 === 0 ? 'selectiveneedle' : 'ordinary'} fact ${i}`],
    tags: [i % 100 === 0 ? 'eligible' : 'other'],
    projectId: i % 100 === 0 ? 'target' : 'other',
  }));
  await storage.saveGraph({ entities, relations: [] });
  const bm25 = new BM25Search(storage);
  await bm25.buildIndex();
  const selective = await bm25.search('selectiveneedle', 10);
  if (selective.length !== Math.min(10, Math.ceil(count / 1000))) throw new Error('Selective BM25 result count changed');
  const lexical = {
    selective: await measure(() => bm25.search('selectiveneedle', 10)),
    broad: await measure(() => bm25.search('common', 10)),
  };
  // Clear only result caching between calls so this measures filter/match execution.
  const fuzzyFiltered = await measure(async () => {
    fuzzy.clearCache();
    const result = await fuzzy.fuzzySearch('commom', 0.7, ['eligible'], undefined, undefined, 0, 10, 'target');
    if (result.entities.some(entity => entity.projectId !== 'target')) throw new Error('Fuzzy project filter failed');
  });
  const manager = new TFIDFIndexManager(directory);
  await manager.buildIndex({ entities, relations: [] });
  await manager.saveIndex();
  const updateStart = performance.now();
  for (let i = 0; i < 100; i++) manager.updateDocument({ ...entities[i % count], observations: [`changed fact ${i}`] });
  const update100Ms = performance.now() - updateStart;
  const appendStart = performance.now();
  for (let i = 0; i < 100; i++) manager.addDocument({ name: `appended-${i}`, entityType: 'document', observations: [`new vocabulary appendedterm${i}`] });
  const append100Ms = performance.now() - appendStart;
  const persistStart = performance.now();
  await manager.saveIndex();
  const persistMs = performance.now() - persistStart;
  const reloaded = new TFIDFIndexManager(directory);
  const reloadStart = performance.now();
  const restored = await reloaded.loadIndex();
  const reloadMs = performance.now() - reloadStart;
  if (restored?.documents.size !== count + 100) throw new Error('TF-IDF reload lost documents');
  for (let i = 0; i < 100; i++) {
    if (!restored.documents.get(entities[i].name)?.documentText.includes(`changed fact ${i}`)) throw new Error('TF-IDF replay lost updated content');
    if (!restored.documents.has(`appended-${i}`)) throw new Error('TF-IDF replay lost added content');
  }
  const tfidf = { update100Ms, append100Ms, persistMs, reloadMs, journalBytes: await stat(join(directory, '.indexes', 'tfidf-index.json.journal')).then(s => s.size, () => 0), snapshotBytes: (await stat(join(directory, '.indexes', 'tfidf-index.json'))).size };
  // Seeded vectors are independent from entity text; measure retrieval, not a remote model.
  let seed = 123456789;
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296 * 2 - 1;
  };
  const exact = new InMemoryVectorStore();
  const approximate = annModule ? new annModule.LSHVectorStore({ seed: 42, exactThreshold: 0 }) : undefined;
  const vectors = entities.map(() => Array.from({ length: 64 }, random));
  for (let i = 0; i < count; i++) {
    exact.add(entities[i].name, vectors[i]);
    approximate?.add(entities[i].name, vectors[i]);
  }
  let recall = 0;
  let candidates = 0;
  let exactMs = 0;
  let approximateMs = 0;
  for (let i = 0; i < samples; i++) {
    const query = vectors[Math.floor(i * count / samples)].map(value => value + random() * 0.05);
    const exactStart = performance.now();
    const expected = new Set(exact.search(query, 10).map(result => result.name));
    exactMs += performance.now() - exactStart;
    if (!approximate) continue;
    const approximateStart = performance.now();
    const actual = approximate.search(query, 10);
    approximateMs += performance.now() - approximateStart;
    recall += actual.filter(result => expected.has(result.name)).length / expected.size;
    candidates += approximate.getLastCandidateCount();
  }
  const ann = approximate ? { recallAt10: recall / samples, meanCandidates: candidates / samples,
    corpusSize: count, dimensions: 64, queryCount: samples, exactTotalMs: exactMs, approximateTotalMs: approximateMs } : null;
  const graph = { entities, relations: [] };
  const byName = new Map(entities.map(entity => [entity.name, entity]));
  const provider = new MockEmbeddingService(64);
  const semanticDefault = new SemanticSearch(provider, exact);
  let resolverCalls = 0;
  const semanticResolver = new SemanticSearch(provider, exact, { resolveEntity: name => { resolverCalls++; return byName.get(name); } });
  const semantic = {
    rebuildMap: await measure(() => semanticDefault.search(graph, 'common subject', 10)),
    indexedResolver: await measure(() => semanticResolver.search(graph, 'common subject', 10)),
  };
  const resolverSupported = resolverCalls > 0;
  console.log(JSON.stringify({
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    date: new Date().toISOString(), node: process.version, platform: process.platform, cpu: cpus()[0]?.model, resolverSupported,
    nodeEnv: process.env.NODE_ENV ?? 'unset', entities: count,
    lexical, fuzzyFiltered, tfidf, ann, semantic, rssBytes: process.memoryUsage().rss,
    notes: ['Single-process measurements; compare identical machine/runtime/environment.', 'Indexes are initialized before measurement; firstCallMs is not process-cold latency.', 'Timings are observations, not CI assertions.'],
  }, null, 2));
} finally {
  await fuzzy.shutdown();
  await rm(directory, { recursive: true, force: true });
}
