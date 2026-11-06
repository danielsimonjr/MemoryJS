/**
 * Learning accountant (Recursa RS-23): counts learning waste and signal, phase timing and
 * tokens, and decides when a budget is exhausted.
 *
 * Rework is counted only when the same task is solved again while the knowledge digest is
 * unchanged from that task's previous solve. A digest change resets nothing and adds no rework.
 * Diagnoses are rework when the same failure id is diagnosed a second time.
 *
 * Budget semantics: a limit counts as reached when the consumed amount is `>=` the limit, so
 * `exceeded` reports the stop before the next round, token spend or time slice starts.
 * `maxChildren` is not checked here; the caller enforces it.
 *
 * @module agent/learning/LearningAccountant
 * @experimental Spec RS-23. Report fields may grow.
 */

import type { LearnStopReason, LearningBudget, LearningReport, TokenTotals } from '../../types/learning.js';
import type { LeafPhase } from './types.js';

export type { LearningReport, TokenTotals } from '../../types/learning.js';

/** Phases tracked for timing and tokens. */
const PHASES: readonly LeafPhase[] = ['solve', 'judge', 'diagnose', 'edit', 'validate', 'apply', 'done'];

/**
 * Serializable accountant state, persisted on a leaf-learner run so that rework, signal, stall
 * and phase timing survive a resume. Produced by {@link LearningAccountant.toState}.
 */
export interface AccountantState {
  /** Epoch milliseconds the accounting started. */
  startedAt: number;
  /** Stall milliseconds. */
  stallMs: number;
  /** Rework count. */
  rework: number;
  /** Solver-side signal count. */
  solverSignals: number;
  /** Learner-side signal count. */
  learnerSignals: number;
  /** Rounds recorded. */
  rounds: number;
  /** Digest of the knowledge each task was last solved with. */
  lastDigestByTask: Record<string, string>;
  /** Failure ids already diagnosed. */
  diagnosedFailures: string[];
  /** Start time of each open phase. */
  phaseStarts: Partial<Record<LeafPhase, number>>;
  /** Closed milliseconds per phase. */
  phaseMs: Record<LeafPhase, number>;
  /** Tokens per phase. */
  phaseTokens: Record<LeafPhase, TokenTotals>;
}

/** Options for {@link LearningAccountant}. */
export interface LearningAccountantOptions {
  /** Clock in milliseconds (default `Date.now`). Injectable for deterministic tests. */
  now?: () => number;
}

/**
 * Counts learning waste and signal, and enforces budgets.
 *
 * @example
 * ```ts
 * const acct = new LearningAccountant();
 * acct.recordSolve('task-1', digestA);
 * acct.recordSolve('task-1', digestA); // rework: digest unchanged
 * const stop = acct.exceeded(budget);  // LearnStopReason | null
 * ```
 */
export class LearningAccountant {
  private readonly now: () => number;
  private startedAt: number;
  private stallMs = 0;
  private reworkCount = 0;
  private solverSignalCount = 0;
  private learnerSignalCount = 0;
  private roundCount = 0;
  private readonly lastDigestByTask = new Map<string, string>();
  private readonly diagnosedFailures = new Set<string>();
  private readonly phaseStarts = new Map<LeafPhase, number>();
  private phaseMs = emptyPhaseRecord(0);
  private phaseTokens = emptyTokenRecord();

  /**
   * Create the instance.
   *
   * @param options - Optional injectable clock.
   */
  constructor(options: LearningAccountantOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  /**
   * Rebuild an accountant from persisted state.
   *
   * @param state - State from {@link LearningAccountant.toState}.
   * @param options - Optional injectable clock.
   * @returns An accountant with the same counters, digests, failures and open phases.
   */
  static fromState(state: AccountantState, options: LearningAccountantOptions = {}): LearningAccountant {
    const acct = new LearningAccountant(options);
    acct.startedAt = state.startedAt;
    acct.stallMs = state.stallMs;
    acct.reworkCount = state.rework;
    acct.solverSignalCount = state.solverSignals;
    acct.learnerSignalCount = state.learnerSignals;
    acct.roundCount = state.rounds;
    for (const [task, digest] of Object.entries(state.lastDigestByTask)) acct.lastDigestByTask.set(task, digest);
    for (const id of state.diagnosedFailures) acct.diagnosedFailures.add(id);
    for (const phase of PHASES) {
      const start = state.phaseStarts[phase];
      if (start !== undefined) acct.phaseStarts.set(phase, start);
      acct.phaseMs[phase] = state.phaseMs[phase] ?? 0;
      acct.phaseTokens[phase] = { ...(state.phaseTokens[phase] ?? { input: 0, output: 0 }) };
    }
    return acct;
  }

  /**
   * Serializable copy of every counter, for persistence.
   *
   * @returns The state; {@link LearningAccountant.fromState} restores it.
   */
  toState(): AccountantState {
    return {
      startedAt: this.startedAt,
      stallMs: this.stallMs,
      rework: this.reworkCount,
      solverSignals: this.solverSignalCount,
      learnerSignals: this.learnerSignalCount,
      rounds: this.roundCount,
      lastDigestByTask: Object.fromEntries(this.lastDigestByTask),
      diagnosedFailures: [...this.diagnosedFailures],
      phaseStarts: Object.fromEntries(this.phaseStarts),
      phaseMs: { ...this.phaseMs },
      phaseTokens: Object.fromEntries(PHASES.map((p) => [p, { ...this.phaseTokens[p] }])) as Record<LeafPhase, TokenTotals>,
    };
  }

  /**
   * Add queue time reported by the concurrency limiter (`stats.queuedMs`).
   *
   * @param queuedMs - Milliseconds spent queued; non-finite or negative values are ignored.
   */
  recordStall(queuedMs: number): void {
    if (Number.isFinite(queuedMs) && queuedMs > 0) this.stallMs += queuedMs;
  }

  /**
   * Record a solve. Rework is counted only when the same task was last solved with the same
   * digest. Tokens, when given, are added to the `solve` phase.
   *
   * @param taskId - Task that was solved.
   * @param kDigest - Digest of the knowledge the solve used.
   * @param tokens - Optional token usage of the solve.
   */
  recordSolve(taskId: string, kDigest: string, tokens?: TokenTotals): void {
    if (this.lastDigestByTask.get(taskId) === kDigest) this.reworkCount += 1;
    this.lastDigestByTask.set(taskId, kDigest);
    if (tokens) this.addTokens('solve', tokens.input, tokens.output);
  }

  /**
   * Record a diagnosis. Diagnosing the same failure id again counts as rework.
   *
   * @param failureId - Failure record the diagnosis refers to.
   */
  recordDiagnosis(failureId: string): void {
    if (this.diagnosedFailures.has(failureId)) this.reworkCount += 1;
    else this.diagnosedFailures.add(failureId);
  }

  /**
   * Add solver-side signal (feedback and trace excerpts consumed).
   *
   * @param n - Number of signal items; non-negative integers only.
   */
  recordSolverSignal(n: number): void {
    this.solverSignalCount += nonNegative(n);
  }

  /**
   * Add learner-side signal (validation verdicts, source checks and child traces consumed).
   *
   * @param n - Number of signal items; non-negative integers only.
   */
  recordLearnerSignal(n: number): void {
    this.learnerSignalCount += nonNegative(n);
  }

  /**
   * Count one learning round.
   */
  recordRound(): void {
    this.roundCount += 1;
  }

  /**
   * Start timing a phase. Starting an already open phase restarts its clock.
   *
   * @param phase - Phase to time.
   */
  startPhase(phase: LeafPhase): void {
    this.phaseStarts.set(phase, this.now());
  }

  /**
   * Whether a phase is open (started and not yet ended).
   *
   * @param phase - Phase to test.
   * @returns True while the phase is being timed.
   */
  isPhaseOpen(phase: LeafPhase): boolean {
    return this.phaseStarts.has(phase);
  }

  /**
   * Close a phase and add its elapsed time to the phase total.
   *
   * @param phase - Phase to close.
   * @throws Error when the phase was not started.
   */
  endPhase(phase: LeafPhase): void {
    const start = this.phaseStarts.get(phase);
    if (start === undefined) throw new Error(`LearningAccountant: phase "${phase}" was not started`);
    this.phaseStarts.delete(phase);
    this.phaseMs[phase] += Math.max(0, this.now() - start);
  }

  /**
   * Add token usage to a phase.
   *
   * @param phase - Phase that spent the tokens.
   * @param input - Input tokens.
   * @param output - Output tokens.
   */
  addTokens(phase: LeafPhase, input: number, output: number): void {
    const totals = this.phaseTokens[phase];
    totals.input += nonNegative(input);
    totals.output += nonNegative(output);
  }

  /**
   * Check the budget against what has been consumed so far. Checks rounds, then tokens, then
   * wall-clock time, and returns the first limit reached.
   *
   * @param budget - Limits to check.
   * @returns The stop reason, or `null` while every limit has headroom.
   */
  exceeded(budget: LearningBudget): LearnStopReason | null {
    if (this.roundCount >= budget.maxRounds) return 'budget-rounds';
    if (budget.maxTokens !== undefined && this.totalTokens() >= budget.maxTokens) return 'budget-tokens';
    if (budget.maxWallClockMs !== undefined && this.elapsedMs() >= budget.maxWallClockMs) return 'budget-time';
    return null;
  }

  /**
   * Snapshot of all counters. Phases still open are not included in their timing.
   *
   * @returns The report.
   */
  report(): LearningReport {
    const tokensByPhase = emptyTokenRecord();
    for (const phase of PHASES) tokensByPhase[phase] = { ...this.phaseTokens[phase] };
    return {
      stalls: this.stallMs,
      rework: this.reworkCount,
      solverSignals: this.solverSignalCount,
      learnerSignals: this.learnerSignalCount,
      tokensByPhase,
      wallClockByPhase: { ...this.phaseMs },
      rounds: this.roundCount,
      totalTokens: this.totalTokens(),
      elapsedMs: this.elapsedMs(),
    };
  }

  /**
   * Milliseconds since construction.
   *
   * @returns Elapsed time.
   */
  private elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  /**
   * Input plus output tokens across all phases.
   *
   * @returns Token total.
   */
  private totalTokens(): number {
    let total = 0;
    for (const phase of PHASES) total += this.phaseTokens[phase].input + this.phaseTokens[phase].output;
    return total;
  }
}

/**
 * Clamp a count to a non-negative finite value.
 *
 * @param n - Raw count.
 * @returns `n` when it is a finite non-negative number, else 0.
 */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A per-phase numeric record initialised to `value`.
 *
 * @param value - Initial value for every phase.
 * @returns Record keyed by phase.
 */
function emptyPhaseRecord(value: number): Record<LeafPhase, number> {
  return Object.fromEntries(PHASES.map((phase) => [phase, value])) as Record<LeafPhase, number>;
}

/**
 * A per-phase token record with zeroed totals.
 *
 * @returns Record keyed by phase.
 */
function emptyTokenRecord(): Record<LeafPhase, TokenTotals> {
  return Object.fromEntries(PHASES.map((phase) => [phase, { input: 0, output: 0 }])) as Record<LeafPhase, TokenTotals>;
}
