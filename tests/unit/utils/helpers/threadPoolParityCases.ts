/**
 * Shared corpus and observation runners for the workerpool -> `threadPool`
 * parity suite.
 *
 * Every function here takes a pool factory so the *same* script can drive the
 * installed `@danielsimonjr/workerpool` package (to record the fixture) and the
 * in-repo `src/utils/threadPool.ts` (to replay it). The runners return plain
 * JSON, so an observation is comparable field by field and can be frozen in
 * `tests/unit/utils/fixtures/threadPoolParity.json`.
 *
 * The worker is the real Levenshtein worker (`src/workers/levenshteinWorker.ts`),
 * loaded as an ESM worker thread through `tsx` so the suite needs no build.
 * Timing-sensitive behaviours (timeout, cancel, terminate) use the built-in
 * script-less worker and stringified functions, because the Levenshtein worker
 * has no slow method and a race on a fast method proves nothing.
 *
 * @module tests/unit/utils/helpers/threadPoolParityCases
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchEntities, type WorkerInput } from '../../../../src/workers/levenshteinWorker.js';

/** The subset of workerpool's `Pool` these runners use. */
export interface PoolLike {
  exec(
    method: string | ((...args: never[]) => unknown),
    params?: unknown[],
  ): PromiseLike<unknown> & { timeout?: (ms: number) => unknown; cancel?: () => unknown; pending?: boolean };
  stats(): Record<string, number>;
  terminate(force?: boolean): PromiseLike<unknown>;
}

/** `workerpool.pool` / `threadPool.pool`. */
export type PoolFactory = (script?: string | Record<string, unknown>, options?: Record<string, unknown>) => PoolLike;

/** How to load the ESM Levenshtein worker. */
export interface WorkerConfig {
  /** Absolute path to `src/workers/levenshteinWorker.ts`. */
  script: string;
  /** Pool options that load it as an ESM worker thread. */
  options: Record<string, unknown>;
}

/** The Levenshtein worker plus the options that load it as an ESM module. */
export function levenshteinWorkerConfig(): WorkerConfig {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return {
    script: join(here, '..', '..', '..', '..', 'src', 'workers', 'levenshteinWorker.ts'),
    options: {
      maxWorkers: 2,
      workerType: 'thread',
      workerThreadOpts: { type: 'module', execArgv: ['--import', 'tsx'] },
    },
  };
}

/** A deterministic corpus that produces name, type and observation matches. */
export const CORPUS: WorkerInput['entities'] = [
  { name: 'Alice', nameLower: 'alice', entityTypeLower: 'person', observations: ['software engineer', 'works remotely'] },
  { name: 'Alicia', nameLower: 'alicia', entityTypeLower: 'person', observations: ['product manager'] },
  { name: 'Bob', nameLower: 'bob', entityTypeLower: 'person', observations: ['designer', 'creates user interfaces'] },
  { name: 'Robert', nameLower: 'robert', entityTypeLower: 'person', observations: ['backend specialist'] },
  { name: 'Project_Alpha', nameLower: 'project_alpha', entityTypeLower: 'project', observations: ['alpha release planning'] },
  { name: 'Alise', nameLower: 'alise', entityTypeLower: 'person', observations: ['typo twin of alice'] },
  { name: 'Engineer_Notes', nameLower: 'engineer_notes', entityTypeLower: 'document', observations: ['notes about engineering'] },
  { name: 'Carol', nameLower: 'carol', entityTypeLower: 'person', observations: ['data scientist', 'machine learning'] },
  { name: 'Dave', nameLower: 'dave', entityTypeLower: 'person', observations: ['works on alpha'] },
  { name: 'Zed', nameLower: 'zed', entityTypeLower: 'person', observations: ['unrelated content'] },
];

/** One Levenshtein batch member: the query and the threshold to use. */
export interface BatchCase {
  label: string;
  query: string;
  threshold: number;
}

/** Queries that hit each match field and the no-match path. */
export const BATCH: BatchCase[] = [
  { label: 'typo-name', query: 'alise', threshold: 0.7 },
  { label: 'exact-name', query: 'alice', threshold: 0.9 },
  { label: 'type-match', query: 'person', threshold: 0.9 },
  { label: 'observation-match', query: 'engineer', threshold: 0.8 },
  { label: 'misspelled-observation', query: 'enginer', threshold: 0.8 },
  { label: 'no-match', query: 'zzzzzz', threshold: 0.8 },
  { label: 'low-threshold', query: 'alpha', threshold: 0.4 },
];

/** A score rounded so two runs of the same algorithm compare exactly. */
function roundScore(score: number): number {
  return Math.round(score * 1e9) / 1e9;
}

/** Errors are compared by name and message; stacks only for worker-thrown ones. */
export interface ErrorShape {
  ctor: string;
  name: string;
  message: string;
  /** First line of `stack`, when the runner captures it. */
  stackHead?: string;
}

/** Capture the comparable part of a rejection. */
export function errorShape(error: unknown, withStack = false): ErrorShape {
  const value = error as { constructor?: { name?: string }; name?: string; message?: string; stack?: string };
  const shape: ErrorShape = {
    ctor: value?.constructor?.name ?? 'unknown',
    name: value?.name ?? 'unknown',
    message: value?.message ?? String(error),
  };
  if (withStack) shape.stackHead = (value?.stack ?? '').split('\n')[0] ?? '';
  return shape;
}

/** Run every batch case through the pool and normalise the result. */
export async function runLevenshteinBatch(
  createPool: PoolFactory,
  config: WorkerConfig,
): Promise<Array<{ label: string; results?: unknown; error?: ErrorShape }>> {
  const pool = createPool(config.script, config.options);
  const out: Array<{ label: string; results?: unknown; error?: ErrorShape }> = [];
  try {
    for (const batchCase of BATCH) {
      const input: WorkerInput = {
        query: batchCase.query,
        threshold: batchCase.threshold,
        normalized: true,
        entities: CORPUS,
      };
      try {
        const results = (await pool.exec('searchEntities', [input])) as Array<{
          name: string;
          score: number;
          matchedIn: string;
        }>;
        out.push({
          label: batchCase.label,
          results: results.map((match) => ({
            name: match.name,
            score: roundScore(match.score),
            matchedIn: match.matchedIn,
          })),
        });
      } catch (error) {
        out.push({ label: batchCase.label, error: errorShape(error) });
      }
    }
  } finally {
    await pool.terminate(true);
  }
  return out;
}

/**
 * The in-process oracle: the same matching logic the worker runs, without a
 * pool. `FuzzySearch` assembles its result as "entities whose name appears in
 * any chunk's matches", which is the name set this returns.
 */
export function synchronousMatches(query: string, threshold: number): string[] {
  const matches = searchEntities({ query, threshold, normalized: true, entities: CORPUS });
  const names = new Set(matches.map((match) => match.name));
  return CORPUS.filter((entity) => names.has(entity.name)).map((entity) => entity.name);
}

/**
 * Drive the worker the way `FuzzySearch.searchWithWorkers` does: split the
 * corpus into chunks, run every chunk through the pool, and keep the entities
 * whose name appears in any chunk's matches.
 *
 * @param createPool - Pool implementation to use.
 * @param config - How to load the worker.
 * @returns Matched entity names, in corpus order.
 */
export async function runFuzzyChunks(
  createPool: PoolFactory,
  config: WorkerConfig,
): Promise<Array<{ label: string; names: string[] }>> {
  const cases: Array<{ label: string; query: string; threshold: number }> = [
    { label: 'typo-name', query: 'alise', threshold: 0.6 },
    { label: 'observation', query: 'engineer', threshold: 0.7 },
    { label: 'type', query: 'projct', threshold: 0.7 },
  ];
  const chunkSize = 4;
  const pool = createPool(config.script, config.options);
  const observed: Array<{ label: string; names: string[] }> = [];
  try {
    for (const fuzzyCase of cases) {
      const inputs: WorkerInput[] = [];
      for (let i = 0; i < CORPUS.length; i += chunkSize) {
        inputs.push({
          query: fuzzyCase.query,
          threshold: fuzzyCase.threshold,
          normalized: true,
          entities: CORPUS.slice(i, i + chunkSize),
        });
      }
      const settled = await Promise.allSettled(inputs.map((input) => pool.exec('searchEntities', [input])));
      const names = new Set<string>();
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const match of result.value as Array<{ name: string }>) names.add(match.name);
      }
      observed.push({
        label: fuzzyCase.label,
        names: CORPUS.filter((entity) => names.has(entity.name)).map((entity) => entity.name),
      });
    }
  } finally {
    await pool.terminate(true);
  }
  return observed;
}

/**
 * Functions handed to the built-in script-less worker.
 *
 * Both pools stringify a function argument and run it inside the worker, so
 * these must be self-contained: no closure over module state.
 */
const sleep = async (ms: number): Promise<number> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
};
const add = (a: number, b: number): number => a + b;
const multiply = (a: number, b: number): number => a * b;
const subtract = (a: number, b: number): number => a - b;
const double = (n: number): number => n * 2;
const identity = <T>(value: T): T => value;
const throwRange = (): never => { throw new RangeError('kaboom'); };
const exitSeven = (): never => { process.exit(7); };

/** Sleep through the built-in script-less worker (both pools support this). */
function execSleep(pool: PoolLike, ms: number): ReturnType<PoolLike['exec']> {
  return pool.exec(sleep, [ms]);
}

/** Observation of the script-less pool: it runs functions and reports stats. */
export async function observeScriptlessPool(createPool: PoolFactory): Promise<Record<string, unknown>> {
  const pool = createPool({ maxWorkers: 2 });
  try {
    const before = await Promise.resolve(pool.stats());
    const sum = await pool.exec(add, [2, 3]);
    const product = await pool.exec(multiply, [6, 7]);
    const stats = await Promise.resolve(pool.stats());
    const parallel = await Promise.all([
      pool.exec(double, [1]),
      pool.exec(double, [2]),
      pool.exec(double, [3]),
    ]);
    return {
      sum,
      product,
      parallel,
      statsKeys: Object.keys(before).filter((key) =>
        ['totalWorkers', 'busyWorkers', 'idleWorkers', 'pendingTasks', 'activeTasks'].includes(key)),
      stats: pickStats(stats),
      afterStats: pickStats(await Promise.resolve(pool.stats())),
    };
  } finally {
    await pool.terminate(true);
  }
}

/** Keep only the five `PoolStats` fields MemoryJS's mirror declares. */
export function pickStats(stats: Record<string, number>): Record<string, number> {
  return {
    totalWorkers: stats.totalWorkers ?? 0,
    busyWorkers: stats.busyWorkers ?? 0,
    idleWorkers: stats.idleWorkers ?? 0,
    pendingTasks: stats.pendingTasks ?? 0,
    activeTasks: stats.activeTasks ?? 0,
  };
}

/** Observations of the failure paths, all through the script-less worker. */
export async function observeFailures(createPool: PoolFactory): Promise<Record<string, unknown>> {
  const pool = createPool({ maxWorkers: 1 });
  const out: Record<string, unknown> = {};
  try {
    try {
      await pool.exec(throwRange, []);
    } catch (error) {
      out.thrown = errorShape(error, true);
    }
    try {
      await pool.exec('doesNotExist', []);
    } catch (error) {
      out.unknownMethod = errorShape(error);
    }
    try {
      // A non-array params argument is a programming error, not a task failure.
      await pool.exec(identity, { not: 'an array' } as never);
    } catch (error) {
      out.badParams = errorShape(error);
    }
    // The worker dies mid-task: the rejection must say so without killing us.
    try {
      await pool.exec(exitSeven, []);
    } catch (error) {
      const shape = errorShape(error);
      out.crash = { name: shape.name, messageHead: shape.message.split('\n')[0] };
    }
    // The pool still works after a worker died.
    out.afterCrash = await pool.exec(add, [1, 2]);
  } finally {
    await pool.terminate(true);
  }

  // Constructor-time validation happens before any worker exists.
  try {
    createPool({ maxWorkers: 0 });
  } catch (error) {
    out.maxWorkersValidation = errorShape(error);
  }
  return out;
}

/**
 * Timeout, cancel, and their effect on the pool.
 *
 * The two timed tasks run serially on one worker. If the timeout clock started
 * at submission, the second task would reject at about the same time as the
 * first; if it starts when the task starts (workerpool's rule) the second
 * rejects about one task duration later. The observation records the gap, which
 * is the discriminating fact.
 */
export async function observeTimeoutAndCancel(createPool: PoolFactory): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const pool = createPool({ maxWorkers: 1 });
  try {
    const started = Date.now();
    let firstAt = 0;
    try {
      await execSleep(pool, 400).timeout!(200);
    } catch (error) {
      firstAt = Date.now() - started;
      out.timeout = errorShape(error);
    }
    // The pool must still serve tasks after a timed-out task killed its worker.
    // The settle wait matters: workerpool starts the replacement worker
    // asynchronously, so an exec issued in the same tick as the timeout races
    // the kill and sometimes sees 'Worker terminated'. Waiting removes the race
    // from both implementations without hiding anything MemoryJS relies on.
    await new Promise((resolve) => setTimeout(resolve, 300));
    out.afterTimeout = await pool.exec(multiply, [3, 4]);
    out.statsAfterTimeout = pickStats(await Promise.resolve(pool.stats()));

    const queueStarted = Date.now();
    const timestamps: number[] = [];
    const first = execSleep(pool, 400);
    first.timeout!(200).catch(() => { timestamps.push(Date.now() - queueStarted); });
    const second = execSleep(pool, 400);
    second.timeout!(200).catch(() => { timestamps.push(Date.now() - queueStarted); });
    await Promise.allSettled([first, second]);
    out.queuedTimeout = {
      rejected: timestamps.length,
      // The gap between the two rejections: ~0 if the clock starts at submit,
      // ~one task duration if it starts when each task starts.
      gapAtLeast150ms: timestamps.length === 2 && timestamps[1]! - timestamps[0]! >= 150,
    };
  } finally {
    await pool.terminate(true);
  }

  const cancelling = createPool({ maxWorkers: 1 });
  try {
    const running = execSleep(cancelling, 5000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.pendingBeforeCancel = running.pending;
    const cancelled = running.catch((error: unknown) => errorShape(error));
    running.cancel!();
    out.cancel = await cancelled;
    out.pendingAfterCancel = running.pending;
    out.rejectedAfterCancel = running.rejected;
    // Let the pool notice the worker it had to stop.
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.statsAfterCancel = pickStats(await Promise.resolve(cancelling.stats()));
    out.afterCancel = await cancelling.exec(subtract, [9, 4]);

    // Cancelling a task that never started must not disturb a worker.
    const busy = execSleep(cancelling, 300);
    const queued = cancelling.exec(identity, [1]);
    let queuedShape: ErrorShape | undefined;
    const queuedRejected = queued.catch((error: unknown) => { queuedShape = errorShape(error); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    queued.cancel!();
    await queuedRejected;
    out.queuedCancel = queuedShape;
    out.busySurvived = await busy;
  } finally {
    await cancelling.terminate(true);
  }
  return out;
}

/** `terminate(true)` rejects the running task; `terminate()` lets it finish. */
export async function observeTerminate(createPool: PoolFactory): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const forced = createPool({ maxWorkers: 1 });
  const running = execSleep(forced, 5000);
  const forcedResult = running.then(
    (value: unknown) => ({ resolved: value }),
    (error: unknown) => ({ error: errorShape(error) }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await forced.terminate(true);
  out.forcedInflight = await forcedResult;
  out.statsAfterForced = pickStats(await Promise.resolve(forced.stats()));

  const graceful = createPool({ maxWorkers: 1 });
  const inflight = execSleep(graceful, 300);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await graceful.terminate();
  out.gracefulInflight = await inflight;
  out.statsAfterGraceful = pickStats(await Promise.resolve(graceful.stats()));

  // terminate() on a pool with a queued task: the queue is dropped, and the
  // returned promise still settles (the caller never awaits a queued task here).
  const queuedPool = createPool({ maxWorkers: 1 });
  const head = execSleep(queuedPool, 200);
  const tail = queuedPool.exec(identity, [1]);
  const tailResult = tail.then(
    (value: unknown) => ({ resolved: value }),
    (error: unknown) => ({ error: errorShape(error) }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  await queuedPool.terminate();
  out.queuedAtTerminate = await tailResult;
  out.headAtTerminate = await head;
  return out;
}

/** Every observation the fixture freezes, produced by one pool implementation. */
export async function observeAll(createPool: PoolFactory): Promise<Record<string, unknown>> {
  const config = levenshteinWorkerConfig();
  return {
    levenshtein: await runLevenshteinBatch(createPool, config),
    fuzzyChunks: await runFuzzyChunks(createPool, config),
    scriptless: await observeScriptlessPool(createPool),
    failures: await observeFailures(createPool),
    timeoutAndCancel: await observeTimeoutAndCancel(createPool),
    terminate: await observeTerminate(createPool),
  };
}
