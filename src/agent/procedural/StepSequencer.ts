/**
 * Step Sequencer (3B.4)
 *
 * Stateful cursor for in-progress procedure execution. Tracks current
 * step, advances forward, and can branch into a step's `fallback` when
 * the executor signals failure. Pure value object — no IO, no side
 * effects.
 *
 * @module agent/procedural/StepSequencer
 */

import type { Procedure, ProcedureStep } from '../../types/procedure.js';

export class StepSequencer {
  private cursor = 0;
  /** When set, all `current()` / `next()` calls return this fallback chain
   *  instead of the main steps until cleared. */
  private activeFallback: ProcedureStep | null = null;

  constructor(private readonly procedure: Procedure) {}

  /** Steps in 1-indexed order. Read-only. */
  get steps(): readonly ProcedureStep[] {
    return this.procedure.steps;
  }

  /** Index of the next step to execute (0-based). Public for tests. */
  get cursorIndex(): number {
    return this.cursor;
  }

  /** Whether all main-track steps have been consumed. Fallbacks may still run. */
  isComplete(): boolean {
    return this.activeFallback === null && this.cursor >= this.procedure.steps.length;
  }

  /** Return the step about to execute, or null if exhausted. */
  current(): ProcedureStep | null {
    if (this.activeFallback) return this.activeFallback;
    return this.procedure.steps[this.cursor] ?? null;
  }

  /**
   * Advance the cursor and return the new current step (or null when
   * complete). Clears any active fallback — fallbacks are single-step
   * by design; deeper branching needs a nested fallback in the step's
   * `fallback.fallback`.
   */
  next(): ProcedureStep | null {
    if (this.activeFallback) {
      // Clear the fallback AND advance past the original step it
      // replaced, so flow resumes at the next main-track step.
      this.activeFallback = null;
      this.cursor++;
      return this.current();
    }
    this.cursor++;
    return this.current();
  }

  /**
   * Switch to the current step's `fallback` chain. The next `current()`
   * call will return the fallback's first step. Throws if the current
   * step has no fallback (caller should test before invoking).
   */
  branchToFallback(): void {
    const step = this.current();
    if (!step?.fallback) {
      throw new Error(`Step ${step?.order ?? '?'} has no fallback`);
    }
    this.activeFallback = step.fallback;
  }

  /** Reset the cursor and clear any fallback — start over. */
  reset(): void {
    this.cursor = 0;
    this.activeFallback = null;
  }
}
