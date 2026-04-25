/**
 * Procedure Manager (3B.4)
 *
 * Primary API for procedural memory. Composes `ProcedureStore` (persist /
 * load) and `StepSequencer` (in-memory execution cursor). Provides:
 *
 * - `addProcedure` — auto-generates an id when missing, persists.
 * - `getProcedure` — load by id.
 * - `executeStep` / `getNextStep` — stateless step access by order.
 * - `matchProcedure` — token-overlap match against `triggers` + name.
 * - `refineProcedure` — increment execution count + EWMA-update success rate.
 *
 * Stateful execution lives in `StepSequencer`; callers construct one via
 * `manager.openSequencer(procedureId)` for the duration of a run.
 *
 * @module agent/procedural/ProcedureManager
 */

import type { EntityManager } from '../../core/EntityManager.js';
import type {
  Procedure,
  ProcedureStep,
  ProcedureMatch,
  ProcedureFeedback,
} from '../../types/procedure.js';
import { ProcedureStore } from './ProcedureStore.js';
import { StepSequencer } from './StepSequencer.js';
import { randomUUID } from 'crypto';

export interface ProcedureManagerConfig {
  /** EWMA weight for new feedback in `refineProcedure` (default 0.2). */
  successRateAlpha?: number;
}

export class ProcedureManager {
  private readonly store: ProcedureStore;
  private readonly successRateAlpha: number;

  constructor(
    entityManager: EntityManager,
    config: ProcedureManagerConfig = {},
  ) {
    this.store = new ProcedureStore(entityManager);
    this.successRateAlpha = config.successRateAlpha ?? 0.2;
  }

  /**
   * Persist a new procedure. Auto-generates `id` (and falls back to it
   * for `name`) when caller omits them. Throws if the id collides — the
   * caller should `getProcedure` first if upsert semantics are needed.
   */
  async addProcedure(input: Partial<Procedure>): Promise<Procedure> {
    if (!input.steps) {
      throw new Error('addProcedure: steps[] is required');
    }
    const id = input.id ?? `proc-${randomUUID()}`;
    const procedure: Procedure = {
      id,
      name: input.name ?? id,
      description: input.description ?? '',
      steps: input.steps,
      triggers: input.triggers ?? [],
      successRate: input.successRate ?? 0,
      executionCount: input.executionCount ?? 0,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    await this.store.save(procedure);
    return procedure;
  }

  /** Load by id, or null. */
  async getProcedure(id: string): Promise<Procedure | null> {
    return this.store.load(id);
  }

  /**
   * Stateless lookup of a specific step by 1-indexed `stepOrder`. Returns
   * null when the procedure has no such step.
   */
  async getStep(procedureId: string, stepOrder: number): Promise<ProcedureStep | null> {
    const proc = await this.getProcedure(procedureId);
    if (!proc) return null;
    return proc.steps.find(s => s.order === stepOrder) ?? null;
  }

  /**
   * Look up the step that follows `currentOrder`. Returns null when at
   * the end of the procedure or the procedure does not exist.
   */
  async getNextStep(procedureId: string, currentOrder: number): Promise<ProcedureStep | null> {
    const proc = await this.getProcedure(procedureId);
    if (!proc) return null;
    const idx = proc.steps.findIndex(s => s.order === currentOrder);
    if (idx < 0 || idx + 1 >= proc.steps.length) return null;
    return proc.steps[idx + 1];
  }

  /**
   * Open a fresh `StepSequencer` for the named procedure. Returns null
   * when the procedure doesn't exist. Multiple sequencers per procedure
   * are independent — no shared cursor state.
   */
  async openSequencer(procedureId: string): Promise<StepSequencer | null> {
    const proc = await this.getProcedure(procedureId);
    if (!proc) return null;
    return new StepSequencer(proc);
  }

  /**
   * Token-overlap match: scores each procedure by Jaccard-like overlap
   * between the lowercased context tokens and the union of (`name`,
   * `triggers`). Returns matches in score order, descending. `threshold`
   * filters out matches below the cutoff (default 0.0 — return all).
   */
  async matchProcedure(
    contextDescription: string,
    candidates: Procedure[],
    threshold: number = 0.0,
  ): Promise<ProcedureMatch[]> {
    const ctxTokens = tokenize(contextDescription);
    if (ctxTokens.size === 0) return [];

    const matches: ProcedureMatch[] = [];
    for (const procedure of candidates) {
      const procTokens = new Set<string>();
      for (const t of tokenize(procedure.name)) procTokens.add(t);
      for (const trig of procedure.triggers ?? []) {
        for (const t of tokenize(trig)) procTokens.add(t);
      }
      if (procTokens.size === 0) continue;

      const intersection = new Set<string>();
      for (const t of ctxTokens) if (procTokens.has(t)) intersection.add(t);
      const union = new Set<string>([...ctxTokens, ...procTokens]);
      const score = intersection.size / union.size;

      if (score >= threshold) matches.push({ procedure, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  /**
   * Apply caller feedback: increment `executionCount` and update
   * `successRate` via EWMA. Persists the updated procedure. Returns
   * the updated record. Throws if procedure does not exist.
   */
  async refineProcedure(
    procedureId: string,
    feedback: ProcedureFeedback,
  ): Promise<Procedure> {
    const proc = await this.getProcedure(procedureId);
    if (!proc) {
      throw new Error(`Procedure '${procedureId}' not found`);
    }
    const previousRate = proc.successRate ?? 0;
    const observation = feedback.succeeded ? 1 : 0;
    // EWMA update — first feedback initializes from neutral 0.5 baseline
    // when there's no prior history; otherwise smooths over previous rate.
    const baseline = (proc.executionCount ?? 0) === 0 ? 0.5 : previousRate;
    const newRate = baseline + this.successRateAlpha * (observation - baseline);

    const updated: Procedure = {
      ...proc,
      successRate: clamp01(newRate),
      executionCount: (proc.executionCount ?? 0) + 1,
      lastModified: feedback.recordedAt ?? new Date().toISOString(),
    };
    await this.store.update(updated);
    return updated;
  }
}

// -------- internals --------

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(t => t.length >= 2),
  );
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
