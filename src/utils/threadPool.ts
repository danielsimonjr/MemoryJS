/**
 * A thin worker pool on `node:worker_threads` (and `node:child_process`).
 *
 * This module rebuilds the slice of `@danielsimonjr/workerpool` 10.2.0 that
 * MemoryJS uses: `cpus`, `pool(script, options)`, `pool(options)` with no
 * script, `pool.exec(method, params)` with `.timeout(ms)` and `.cancel()` on
 * the returned promise, `pool.stats()`, `pool.terminate(force?)`, and
 * `worker(methods)` for the worker side. Options honoured: `maxWorkers`,
 * `minWorkers`, `maxQueueSize`, `workerType` (`'auto' | 'thread' | 'process'`),
 * `workerThreadOpts`, `forkOpts`, `forkArgs`, and `workerTerminateTimeout`.
 *
 * This is an independent implementation written from the observed behaviour of
 * workerpool 10.2.0, not a copy of its source, so no Apache-2.0 notice is
 * required and `THIRD_PARTY_NOTICES` carries no workerpool text.
 *
 * Behaviour the parity fixtures pin (`tests/unit/utils/threadPool.parity.test.ts`
 * and `tests/unit/utils/fixtures/threadPoolParity.json`):
 *
 * - `exec` resolves with the worker's return value. A rejection carries the
 *   worker error's own properties, so `message` is the worker's message and
 *   `stack` is the worker's stack (a thrown `RangeError` arrives as an `Error`
 *   whose stack still reads `RangeError: ...`).
 * - `.timeout(ms)` starts its clock when the task starts running, not while it
 *   waits in the queue, and rejects with an error named `TimeoutError`. The
 *   worker running the timed-out task is stopped, so a wedged task cannot block
 *   the queue; the pool replaces it on the next `exec`.
 * - `.cancel()` rejects with an error named `CancellationError` and stops the
 *   worker if the task had started. A queued task is rejected without touching
 *   a worker.
 * - `terminate(true)` rejects in-flight tasks with `Error('Worker terminated')`
 *   and drops queued tasks; `terminate()` lets the in-flight task finish before
 *   the worker stops. Either way no worker handle outlives the promise, so the
 *   process can exit.
 * - A worker that dies on its own rejects its task with an error named
 *   `TerminateError` whose message begins
 *   `Workerpool Worker terminated Unexpectedly`.
 *
 * Deliberate deviations from workerpool 10.2.0, none reachable from MemoryJS's
 * call sites:
 *
 * - The circuit breaker, retry policy, queue-memory accounting, health checks,
 *   event emitter, `emitStdStreams`, `dataTransfer`, `proxy`, `execBatch`,
 *   `map`, and `Transfer` are not implemented; nothing in `src/` calls them.
 * - `idleTimeout`, `maxTasksPerWorker`, `preWarm`, and `adaptiveScaling` are
 *   accepted and ignored, which matches 10.2.0: its `PoolOptionsExtended`
 *   declares them and no code reads them.
 * - The abort-listener cleanup handshake (`addAbortListener`,
 *   `__workerpool-cleanup__`) is not implemented. MemoryJS registers no abort
 *   listeners, so 10.2.0's observable behaviour is the immediate worker stop
 *   this module performs on cancel or timeout.
 * - `worker(methods)` installs the same protocol in the same places 10.2.0 does
 *   (a worker thread with a `parentPort`, or a forked child with an IPC
 *   channel), except in a plain main thread: 10.2.0 throws
 *   `TypeError: process.send is not a function` there, while this module treats
 *   it as a no-op. MemoryJS's own unit tests import `levenshteinWorker.ts` on the
 *   main thread, so the old behaviour was a latent crash and the new one is
 *   required. Message framing is identical, which is what lets the parity
 *   recorder drive the removed package against the same worker script.
 * - `Pool.terminate()` resolves after the worker handles are closed rather than
 *   merely after they were asked to close, so a pool shutdown cannot leave the
 *   Node process alive.
 *
 * @module utils/threadPool
 */

import { Worker } from 'node:worker_threads';
import { spawn, fork, type ChildProcess } from 'node:child_process';
import { cpus as osCpus } from 'node:os';

/** Message that asks a worker to stop. Not an object; it is the whole message. */
const TERMINATE_METHOD_ID = '__workerpool-terminate__';

/** Default wait before a worker is killed after being asked to stop. */
const DEFAULT_TERMINATE_TIMEOUT = 1000;

/**
 * How many CPUs are available, as workerpool's `cpus` property reports it.
 *
 * @returns The host's logical CPU count.
 */
export function cpus(): number {
  return osCpus().length;
}

/** Pool worker backend. `'web'` exists only in workerpool's browser build. */
export type WorkerType = 'auto' | 'web' | 'process' | 'thread';

/** Options accepted by {@link pool}. */
export interface WorkerPoolOptions {
  /** Upper bound on worker count. Defaults to `cpus() - 1`, minimum 1. */
  maxWorkers?: number;
  /** Workers created eagerly. `'max'` means `maxWorkers`. */
  minWorkers?: number | 'max';
  /** Queue cap; exceeding it throws from `exec`. Defaults to `Infinity`. */
  maxQueueSize?: number;
  /** Backend to use. `'auto'` picks thread workers. Defaults to `'auto'`. */
  workerType?: WorkerType;
  /** Passed to the `Worker` constructor, for example `{ type: 'module' }`. */
  workerThreadOpts?: Record<string, unknown>;
  /** Passed to `child_process.fork` for `workerType: 'process'`. */
  forkOpts?: Record<string, unknown>;
  /** Extra argv for `child_process.fork` for `workerType: 'process'`. */
  forkArgs?: string[];
  /** Milliseconds to wait for a worker to exit before killing it. Defaults to 1000. */
  workerTerminateTimeout?: number;
}

/** Runtime statistics, matching workerpool's `Pool.stats()` shape. */
export interface PoolStats {
  /** Workers that exist, busy or idle. */
  totalWorkers: number;
  /** Workers currently running a task. */
  busyWorkers: number;
  /** Workers not running a task. */
  idleWorkers: number;
  /** Tasks waiting for a worker. */
  pendingTasks: number;
  /** Tasks currently running. */
  activeTasks: number;
}

/** Per-execution options. `signal` mirrors workerpool's `AbortSignal` hook. */
export interface ExecOptions {
  /** Aborting the signal cancels the exec promise. */
  signal?: AbortSignal;
}

/** Options a worker script may pass to {@link worker}. */
export interface WorkerRegisterOptions {
  /** Called in the worker when it is asked to stop. */
  onTerminate?: (code: number | undefined) => void | PromiseLike<void>;
}

/**
 * Rejection used by {@link PoolPromise.cancel}.
 *
 * The prototype's `constructor` is `Error`, as workerpool sets it, so
 * `error.constructor.name` is `'Error'` there too. `name` and `instanceof` are
 * the identifying facts; callers match on those.
 */
export class CancellationError extends Error {
  /**
   * Create a cancellation error.
   *
   * @param message - Defaults to `promise cancelled`.
   */
  constructor(message = 'promise cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

Object.defineProperty(CancellationError.prototype, 'constructor', {
  value: Error,
  writable: true,
  configurable: true,
});

/** Rejection used when {@link PoolPromise.timeout} expires. */
export class TimeoutError extends Error {
  /**
   * Create a timeout error.
   *
   * @param message - Defaults to `timeout exceeded`.
   */
  constructor(message = 'timeout exceeded') {
    super(message);
    this.name = 'TimeoutError';
  }
}

Object.defineProperty(TimeoutError.prototype, 'constructor', {
  value: Error,
  writable: true,
  configurable: true,
});

/**
 * Rejection used when a worker dies or is shut down under a running task.
 *
 * `name` stays `'Error'` on purpose: workerpool's `TerminateError` extends
 * `Error` without overriding `name`, so only the constructor name differs from
 * a plain error there. Callers match this error by `instanceof`.
 */
export class TerminateError extends Error {
  /**
   * Create a worker-termination error.
   *
   * @param message - Defaults to `worker terminated`.
   */
  constructor(message = 'worker terminated') {
    super(message);
  }
}

/**
 * A promise with workerpool's `cancel`, `timeout`, and `pending` surface.
 *
 * Consumers await it or hand it to `Promise.allSettled`. `cancel()` and
 * `timeout()` flip `pending` and settle the promise, which is what
 * `WorkerTaskManager` reads to decide whether a mid-flight cancellation can
 * reach the worker.
 */
export class PoolPromise<T> implements PromiseLike<T> {
  /** `true` once the promise settled successfully. */
  resolved = false;
  /** `true` once the promise settled with an error. */
  rejected = false;
  /** `true` while the promise is unsettled. */
  pending = true;

  readonly [Symbol.toStringTag] = 'Promise';

  /** Set by {@link Pool.exec} so a queued task defers its timer until it starts. */
  timeoutHook: ((delay: number) => PoolPromise<T>) | null = null;

  private readonly inner: Promise<T>;
  private settleResolve!: (value: T) => void;
  private settleReject!: (error: unknown) => void;

  /**
   * Create a pending promise. The pool settles it; a caller that wants to settle
   * one itself can pass an executor, as `new Promise` takes.
   *
   * @param executor - Receives the settle functions.
   */
  constructor(executor?: (resolve: (value: T) => void, reject: (error: unknown) => void) => void) {
    this.inner = new Promise<T>((resolve, reject) => {
      this.settleResolve = resolve;
      this.settleReject = reject;
    });
    // A task nobody awaits must not become an unhandled rejection; callers that
    // do await it still observe the error through `then`/`catch`.
    this.inner.catch(() => {});
    if (executor) executor((value) => this.resolve(value), (error) => this.reject(error));
  }

  /** Settle successfully. Later calls are ignored, as workerpool ignores them. */
  resolve(value: T): this {
    if (!this.pending) return this;
    this.pending = false;
    this.resolved = true;
    this.rejected = false;
    this.settleResolve(value);
    return this;
  }

  /** Settle with an error. Later calls are ignored. */
  reject(error: unknown): this {
    if (!this.pending) return this;
    this.pending = false;
    this.resolved = false;
    this.rejected = true;
    this.settleReject(error);
    return this;
  }

  /**
   * Chain a value handler and an optional error handler.
   *
   * @param onFulfilled - Value handler.
   * @param onRejected - Error handler.
   */
  then<TResult1 = T, TResult2 = never>(
    onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.inner.then(onFulfilled, onRejected);
  }

  /**
   * Chain an error handler.
   *
   * @param onRejected - Error handler.
   */
  catch<TResult = never>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.inner.catch(onRejected);
  }

  /**
   * Run a callback on either settlement.
   *
   * @param onFinally - Runs on either settlement.
   */
  finally(onFinally?: (() => void) | null): Promise<T> {
    return this.inner.finally(onFinally ?? undefined);
  }

  /**
   * Run a callback on either settlement.
   *
   * @param fn - Runs on either settlement. Alias of `finally` kept for compatibility.
   */
  always<TResult>(fn: () => TResult | PromiseLike<TResult>): Promise<T | TResult> {
    return this.inner.then(fn, fn);
  }

  /** Reject with a {@link CancellationError}. No-op once settled. */
  cancel(): this {
    this.reject(new CancellationError());
    return this;
  }

  /**
   * Reject with a {@link TimeoutError} after `delay` milliseconds unless the
   * promise settles first. The timer is unref'd and cleared on settlement, so it
   * never keeps the process alive.
   *
   * @param delay - Milliseconds to wait.
   */
  timeout(delay: number): this {
    if (this.timeoutHook) {
      this.timeoutHook(delay);
      return this;
    }
    return this.startTimer(delay);
  }

  /** Start the timeout clock now, bypassing {@link timeoutHook}. */
  startTimer(delay: number): this {
    if (!this.pending) return this;
    const timer = setTimeout(() => {
      this.reject(new TimeoutError(`Promise timed out after ${delay} ms`));
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    const clear = (): void => { clearTimeout(timer); };
    this.inner.then(clear, clear);
    return this;
  }

  /** A deferred promise plus its settle functions. */
  static defer<T>(): { promise: PoolPromise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    const promise = new PoolPromise<T>();
    return {
      promise,
      resolve: (value: T) => { promise.resolve(value); },
      reject: (error: unknown) => { promise.reject(error); },
    };
  }
}

/**
 * Copy a worker error into an `Error` on this side of the boundary.
 *
 * workerpool serialises errors with their own enumerable properties only, so a
 * thrown `RangeError` arrives as an `Error` whose `message` is the original
 * message and whose `stack` still starts with `RangeError: ...`. Dangerous keys
 * are skipped so a hostile worker cannot pollute this process's prototypes.
 *
 * @param serialized - The `error` field of a worker response.
 * @returns An `Error` carrying the worker's own properties.
 */
function errorFromWorker(serialized: Record<string, unknown>): Error {
  const error = new Error(typeof serialized.message === 'string' ? serialized.message : '');
  for (const [key, value] of Object.entries(serialized)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    Object.defineProperty(error, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return error;
}

/**
 * The worker-side message protocol. Runs inside a worker this pool created.
 *
 * Self-contained on purpose: {@link worker} and the default (script-less) pool
 * both reach it through `installWorkerProtocol.toString()`, so it must not
 * reference anything outside its own body — every constant it needs is a literal
 * inside the body.
 *
 * @param registered - Methods exposed to `exec`. `run` and `methods` are built in.
 * @param onTerminate - Called before the worker exits when the pool asks it to stop.
 */
function installWorkerProtocol(
  registered?: Record<string, (...args: never[]) => unknown>,
  onTerminate?: (code: number | undefined) => void | PromiseLike<void>,
): void {
  const STOP = '__workerpool-terminate__';
  const proc = process as unknown as {
    exit: (code?: number) => void;
    send?: (message: unknown) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    getBuiltinModule?: (name: string) => unknown;
  };

  const threads = typeof proc.getBuiltinModule === 'function'
    ? (proc.getBuiltinModule('node:worker_threads') as {
      parentPort: { postMessage(value: unknown): void; on(event: string, listener: (...args: unknown[]) => void): void } | null;
    } | null)
    : null;
  const port = threads ? threads.parentPort : null;
  const viaIpc = !port && typeof proc.send === 'function';

  // A worker thread answers its parent; a forked child answers over IPC.
  // Anywhere else — a plain main-thread import of a worker module, which is
  // what a unit test does — there is no channel and nothing to serve, so stay
  // quiet. workerpool throws `TypeError: process.send is not a function` there.
  if (!port && !viaIpc) return;

  const send = (message: unknown): void => {
    if (port) port.postMessage(message);
    else proc.send?.(message);
  };

  const serialize = (error: unknown): Record<string, unknown> => {
    const value = error as { toJSON?: unknown } | null;
    if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
      return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    }
    return JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error as object))) as Record<string, unknown>;
  };

  const methods = Object.create(null) as Record<string, (...args: never[]) => unknown>;
  methods.run = function run(fn: string, args: unknown[]): unknown {
    // The second parameter is `__name`: bundlers (esbuild/tsx with keepNames,
    // which is what the test runner uses) wrap function expressions in
    // `__name(fn, "name")` calls, and that helper does not exist in a freshly
    // spawned worker. Supplying an identity function makes a stringified
    // function from a transformed module runnable unchanged.
    // `new Function` is the contract, not an oversight: workerpool's `run`
    // method exists to execute a function stringified by the caller, which is how
    // `pool.exec(fn, args)` reaches a script-less worker. The string is the
    // caller's own function body, never user input.
    // oxlint-disable-next-line typescript/no-implied-eval
    const factory = new Function(
      '__name',
      'var args = Array.prototype.slice.call(arguments, 1);' +
      'return (' + fn + ').apply(this, args);',
    ) as (this: unknown, ...rest: unknown[]) => unknown;
    return factory.call(factory, (value: unknown) => value, ...args);
  };
  methods.methods = function listMethods(): string[] {
    return Object.keys(methods);
  };
  if (registered) {
    for (const name of Object.keys(registered)) methods[name] = registered[name]!;
  }

  const handle = (request: unknown): void => {
    if (request === STOP) {
      if (!onTerminate) {
        proc.exit(0);
        return;
      }
      void Promise.resolve(onTerminate(0)).then(
        () => { proc.exit(0); },
        () => { proc.exit(0); },
      );
      return;
    }
    const call = request as { id: number; method: string; params?: unknown[] };
    try {
      const fn = methods[call.method];
      if (!fn) throw new Error('Unknown method "' + call.method + '"');
      const result = fn.apply(fn, (call.params ?? []) as never[]);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).then(
          (value) => { send({ id: call.id, result: value, error: null }); },
          (error: unknown) => { send({ id: call.id, result: null, error: serialize(error) }); },
        );
      } else {
        send({ id: call.id, result, error: null });
      }
    } catch (error) {
      send({ id: call.id, result: null, error: serialize(error) });
    }
  };

  if (port) port.on('message', handle as (...args: unknown[]) => void);
  else proc.on('message', handle as (...args: unknown[]) => void);

  send('ready');
}

/**
 * Source of the built-in worker used when `pool()` gets no script.
 *
 * Written as a literal rather than `installWorkerProtocol.toString()`: a
 * transformed module (tsx, esbuild, tsup) rewrites function bodies with helpers
 * such as `__name(...)` that do not exist in a freshly spawned worker, so the
 * stringified source throws `ReferenceError: __name is not defined` there. Plain
 * JavaScript has no such problem.
 *
 * It must keep the same message framing as {@link installWorkerProtocol}:
 * `'ready'` on start, `{ id, result, error }` per task, and the terminate
 * sentinel as a bare string. `threadPool.parity.test.ts` and
 * `threadPool.test.ts` exercise it through `pool()` on every run, so a drift
 * between the two shows up as a failure rather than as a silent difference.
 */
const DEFAULT_WORKER_SOURCE = `(function () {
  var STOP = '__workerpool-terminate__';
  var threads = typeof process.getBuiltinModule === 'function'
    ? process.getBuiltinModule('node:worker_threads')
    : null;
  var port = threads ? threads.parentPort : null;
  var viaIpc = !port && typeof process.send === 'function';
  if (!port && !viaIpc) return;
  function send(message) {
    if (port) port.postMessage(message);
    else process.send(message);
  }
  function serialize(error) {
    if (error && typeof error.toJSON === 'function') return JSON.parse(JSON.stringify(error));
    return JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  }
  var methods = Object.create(null);
  methods.run = function (fn, args) {
    var factory = new Function('__name', 'var a = Array.prototype.slice.call(arguments, 1); return (' + fn + ').apply(this, a);');
    return factory.apply(factory, [function (value) { return value; }].concat(args));
  };
  methods.methods = function () { return Object.keys(methods); };
  function handle(request) {
    if (request === STOP) { process.exit(0); return; }
    try {
      var fn = methods[request.method];
      if (!fn) throw new Error('Unknown method "' + request.method + '"');
      var result = fn.apply(fn, request.params || []);
      if (result && typeof result.then === 'function') {
        result.then(function (value) { send({ id: request.id, result: value, error: null }); },
          function (error) { send({ id: request.id, result: null, error: serialize(error) }); });
      } else {
        send({ id: request.id, result: result, error: null });
      }
    } catch (error) {
      send({ id: request.id, result: null, error: serialize(error) });
    }
  }
  if (port) port.on('message', handle);
  else process.on('message', handle);
  send('ready');
})()`;

/**
 * Register methods on the worker that is currently executing this module.
 *
 * Call it at the top level of a worker script, as `levenshteinWorker.ts` does.
 * Outside a pool-owned worker it does nothing.
 *
 * @param methods - Method name to function map, exposed to `Pool.exec`.
 * @param options - Registration options.
 */
export function worker(
  methods?: Record<string, (...args: never[]) => unknown>,
  options?: WorkerRegisterOptions,
): void {
  installWorkerProtocol(methods, options?.onTerminate);
}

/** One task waiting for, or running on, a worker. */
interface Task {
  id: number;
  method: string;
  params: unknown[];
  promise: PoolPromise<unknown>;
  /** Timeout requested while queued; applied once the task starts. */
  queuedTimeout: number | null;
  /** Worker running this task, `null` while queued. */
  slot: WorkerSlot | null;
}

/**
 * A worker plus the bookkeeping this pool needs about it.
 *
 * One task at a time per worker, which is what workerpool does: a worker is
 * either busy or idle, never both.
 */
class WorkerSlot {
  readonly script: string | null;
  /** Set while the pool is deliberately stopping this worker. */
  terminating = false;
  /** Set once the worker handle is gone. */
  terminated = false;

  private readonly thread: Worker | null;
  private readonly child: ChildProcess | null;
  private ready = false;
  private task: Task | null = null;
  private readonly buffered: unknown[] = [];
  private killRequested = false;
  private readonly exitWaiters: Array<() => void> = [];
  private readonly onIdle: () => void;
  private readonly terminateTimeout: number;

  constructor(
    script: string | null,
    options: WorkerPoolOptions,
    backend: 'thread' | 'process',
    onIdle: () => void,
  ) {
    this.script = script;
    this.onIdle = onIdle;
    this.terminateTimeout = options.workerTerminateTimeout ?? DEFAULT_TERMINATE_TIMEOUT;

    if (backend === 'thread') {
      const threadOpts = (options.workerThreadOpts ?? {}) as Record<string, unknown>;
      this.thread = new Worker(script ?? DEFAULT_WORKER_SOURCE, {
        stdout: false,
        stderr: false,
        ...(script ? {} : { eval: true }),
        ...threadOpts,
        ...(threadOpts.workerData ? { workerData: threadOpts.workerData } : {}),
      });
      this.child = null;
      this.thread.on('message', (message: unknown) => { this.handleMessage(message); });
      this.thread.on('messageerror', (error: Error) => { this.handleCrash(error.message); });
      this.thread.on('error', (error: Error) => { this.handleCrash(error.message); });
      this.thread.on('exit', (code: number) => { this.handleExit(code); });
    } else {
      this.thread = null;
      this.child = script
        ? fork(script, options.forkArgs ?? [], (options.forkOpts ?? {}) as never)
        : spawn(process.execPath, ['-e', DEFAULT_WORKER_SOURCE], {
          ...(options.forkOpts ?? {}),
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        } as never);
      this.child.on('message', (message: unknown) => { this.handleMessage(message); });
      this.child.on('error', (error: Error) => { this.handleCrash(error.message); });
      this.child.on('exit', (code: number | null, signal: string | null) => {
        this.handleExit(code ?? undefined, signal ?? undefined);
      });
    }
  }

  /** Whether a task may be sent to this worker. */
  get available(): boolean {
    return !this.terminated && !this.terminating && this.task === null;
  }

  /** Whether this worker is running a task. */
  get busy(): boolean {
    return this.task !== null;
  }

  /** Send a message, buffering it until the worker reports readiness. */
  send(message: unknown): void {
    if (this.terminated || this.terminating) return;
    if (!this.ready) {
      this.buffered.push(message);
      return;
    }
    if (this.thread) this.thread.postMessage(message as never);
    else this.child?.send(message as never);
  }

  /** Hand a task to this worker. */
  assign(task: Task): void {
    this.task = task;
    task.slot = this;
    if (task.queuedTimeout !== null) task.promise.startTimer(task.queuedTimeout);
    this.send({ id: task.id, method: task.method, params: task.params });
  }

  /** Release the current task without settling it (the caller already did). */
  detachTask(): Task | null {
    const task = this.task;
    this.task = null;
    if (task) task.slot = null;
    return task;
  }

  /**
   * Stop the worker.
   *
   * @param force - Reject the running task (if any) instead of waiting for it.
   * @returns Resolves once the worker handle is closed.
   */
  stop(force: boolean): Promise<void> {
    const done = new Promise<void>((resolve) => {
      if (this.terminated) resolve();
      else this.exitWaiters.push(resolve);
    });
    if (this.terminated || this.killRequested) return done;
    if (force) {
      this.terminating = true;
      const task = this.detachTask();
      if (task && task.promise.pending) task.promise.reject(new Error('Worker terminated'));
      this.kill();
      return done;
    }
    this.terminating = true;
    // Idle workers stop now; a busy worker stops once its task has responded.
    if (!this.busy) this.kill();
    return done;
  }

  private handleMessage(message: unknown): void {
    if (this.terminated) return;
    if (message === 'ready') {
      this.ready = true;
      for (const buffered of this.buffered.splice(0)) {
        if (this.thread) this.thread.postMessage(buffered as never);
        else this.child?.send(buffered as never);
      }
      return;
    }
    const response = message as { id: number; result?: unknown; error?: Record<string, unknown> | null };
    const task = this.task;
    if (!task || task.id !== response.id) return;
    this.detachTask();
    if (response.error) task.promise.reject(errorFromWorker(response.error));
    else task.promise.resolve(response.result);
    if (this.terminating) {
      this.kill();
      return;
    }
    this.onIdle();
  }

  private handleCrash(message: string): void {
    this.fail(new TerminateError(`Workerpool Worker error: ${message}`));
  }

  private handleExit(code: number | undefined, signal?: string): void {
    if (this.terminated) return;
    this.terminated = true;
    const task = this.detachTask();
    if (task && task.promise.pending) {
      if (this.terminating) {
        task.promise.reject(new Error('Worker terminated'));
      } else {
        const script = this.script ?? 'default';
        task.promise.reject(
          new TerminateError(
            'Workerpool Worker terminated Unexpectedly\n' +
            `    exitCode: \`${code}\`\n` +
            `    signalCode: \`${signal}\`\n` +
            `    workerpool.script: \`${script}\`\n` +
            '    spawnArgs: `undefined`\n' +
            '    spawnfile: `undefined`\n' +
            '    stdout: `undefined`\n' +
            '    stderr: `undefined`',
          ),
        );
      }
    }
    for (const resolve of this.exitWaiters.splice(0)) resolve();
    this.onIdle();
  }

  /** Reject the current task because the worker died, then stop serving. */
  private fail(error: Error): void {
    const task = this.detachTask();
    if (task && task.promise.pending) task.promise.reject(error);
  }

  /** Close the underlying handle. Idempotent, and never leaves it open. */
  private kill(): void {
    if (this.killRequested || this.terminated) return;
    this.killRequested = true;
    if (this.thread) {
      void this.thread.terminate().catch(() => {
        // A worker that already exited rejects this; the exit handler has run.
      });
      return;
    }
    const child = this.child;
    if (!child) return;
    const timer = setTimeout(() => { child.kill(); }, this.terminateTimeout);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', () => { clearTimeout(timer); });
    try {
      child.send(TERMINATE_METHOD_ID);
    } catch {
      child.kill();
    }
  }
}

/**
 * A pool of workers that runs named methods or stringified functions.
 *
 * Create one with {@link pool}. Surface used by MemoryJS: `exec`, `stats`, and
 * `terminate`.
 */
export class Pool {
  /** Worker script, or `null` for the built-in function runner. */
  readonly script: string | null;
  /** Backend in use. */
  readonly workerType: WorkerType;
  /** Maximum number of workers. */
  readonly maxWorkers: number;
  /** Maximum queue length. */
  readonly maxQueueSize: number;

  private readonly options: WorkerPoolOptions;
  private readonly backend: 'thread' | 'process';
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: Task[] = [];
  private taskCounter = 0;

  /**
   * Create a pool.
   *
   * @param script - Worker script path, or the options object when called as `pool(options)`.
   * @param options - Pool options.
   */
  constructor(script?: string | WorkerPoolOptions, options?: WorkerPoolOptions) {
    if (typeof script === 'string') {
      this.script = script || null;
      this.options = options ?? {};
    } else {
      this.script = null;
      this.options = script ?? options ?? {};
    }
    this.workerType = this.options.workerType ?? 'auto';
    this.backend = Pool.resolveBackend(this.workerType);

    if (this.options.maxWorkers !== undefined) {
      if (!Number.isInteger(this.options.maxWorkers) || this.options.maxWorkers < 1) {
        throw new TypeError('Option maxWorkers must be an integer number >= 1');
      }
      this.maxWorkers = this.options.maxWorkers;
    } else {
      this.maxWorkers = Math.max(cpus() - 1, 1);
    }
    this.maxQueueSize = this.options.maxQueueSize ?? Infinity;

    const minWorkers = this.options.minWorkers;
    if (minWorkers !== undefined) {
      const count = minWorkers === 'max' ? this.maxWorkers : minWorkers;
      if (!Number.isInteger(count) || count < 0) {
        throw new TypeError('Option minWorkers must be an integer number >= 0');
      }
      for (let i = 0; i < count; i++) this.workers.push(this.createSlot());
    }
  }

  private static resolveBackend(type: WorkerType): 'thread' | 'process' {
    if (type === 'thread' || type === 'process') return type;
    if (type === 'web') throw new Error('WorkerPool: Web Workers not supported');
    return 'thread';
  }

  private createSlot(): WorkerSlot {
    return new WorkerSlot(this.script, this.options, this.backend, () => { this.next(); });
  }

  /**
   * Run a method (or a stringified function) on a worker.
   *
   * @param method - Registered worker method name, or a function to run.
   * @param params - Positional arguments.
   * @param options - `signal` cancels the task when aborted.
   * @returns A promise with `cancel()` and `timeout(ms)`.
   */
  exec<T = unknown>(
    method: string | ((...args: never[]) => T),
    params?: unknown[] | null,
    options?: ExecOptions,
  ): PoolPromise<T> {
    if (params && !Array.isArray(params)) {
      throw new TypeError('Array expected as argument "params"');
    }
    if (typeof method === 'function') {
      return this.exec<T>('run', [String(method), params], options);
    }
    if (typeof method !== 'string') {
      throw new TypeError('Function or string expected as argument "method"');
    }
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Max queue size of ${this.maxQueueSize} reached`);
    }

    const promise = new PoolPromise<unknown>();
    const task: Task = {
      id: ++this.taskCounter,
      method,
      params: params ?? [],
      promise,
      queuedTimeout: null,
      slot: null,
    };

    const startTimer = promise.startTimer.bind(promise);
    promise.timeoutHook = (delay: number): PoolPromise<unknown> => {
      if (this.queue.includes(task)) {
        // Defer the clock until the task actually starts, as workerpool does.
        task.queuedTimeout = delay;
        return promise;
      }
      return startTimer(delay);
    };

    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) {
        promise.reject(new CancellationError());
        return promise as PoolPromise<T>;
      }
      const onAbort = (): void => { promise.cancel(); };
      signal.addEventListener('abort', onAbort, { once: true });
      const detach = (): void => { signal.removeEventListener('abort', onAbort); };
      promise.then(detach, detach);
    }

    // A cancelled or timed-out task leaves its worker in an unknown state (it
    // may still be computing), so the worker is stopped and dropped from the
    // pool rather than reused. workerpool does the same, and it is what stops a
    // wedged task from blocking every later task in the queue.
    promise.then(undefined, (error: unknown) => {
      if (!(error instanceof CancellationError) && !(error instanceof TimeoutError)) return;
      const slot = task.slot;
      task.slot = null;
      if (!slot) return;
      slot.detachTask();
      const index = this.workers.indexOf(slot);
      if (index >= 0) this.workers.splice(index, 1);
      void slot.stop(true).then(() => { this.next(); });
    });

    this.queue.push(task);
    this.next();
    return promise as PoolPromise<T>;
  }

  /** Dispatch queued tasks to idle workers, creating workers up to `maxWorkers`. */
  private next(): void {
    while (this.queue.length > 0) {
      const slot = this.acquireWorker();
      if (!slot) return;
      const task = this.queue.shift()!;
      if (!task.promise.pending) continue;
      slot.assign(task);
    }
  }

  /** An idle worker, a newly created one, or `null` when the pool is saturated. */
  private acquireWorker(): WorkerSlot | null {
    for (const slot of this.workers) {
      if (slot.available) return slot;
    }
    for (let i = this.workers.length - 1; i >= 0; i--) {
      const slot = this.workers[i]!;
      if (slot.terminated) this.workers.splice(i, 1);
    }
    if (this.workers.length < this.maxWorkers) {
      const created = this.createSlot();
      this.workers.push(created);
      return created;
    }
    return null;
  }

  /**
   * Runtime statistics, matching workerpool's shape.
   *
   * @returns Worker and task counts.
   */
  stats(): PoolStats {
    const live = this.workers.filter((slot) => !slot.terminated);
    const busyWorkers = live.filter((slot) => slot.busy).length;
    return {
      totalWorkers: live.length,
      busyWorkers,
      idleWorkers: live.length - busyWorkers,
      pendingTasks: this.queue.length,
      activeTasks: busyWorkers,
    };
  }

  /**
   * Stop every worker.
   *
   * @param force - Terminate immediately instead of letting running tasks finish.
   * @returns Resolves once every worker handle is closed.
   */
  async terminate(force?: boolean): Promise<void> {
    for (const task of this.queue.splice(0)) {
      if (task.promise.pending) task.promise.reject(new Error('Pool terminated'));
    }
    const slots = this.workers.splice(0);
    await Promise.all(slots.map((slot) => slot.stop(Boolean(force))));
  }
}

/**
 * Create a pool.
 *
 * @param script - Worker script path, or the options object when a script is absent.
 * @param options - Pool options when `script` is a path.
 * @returns The new pool.
 */
export function pool(script?: string | WorkerPoolOptions, options?: WorkerPoolOptions): Pool {
  return new Pool(script, options);
}
