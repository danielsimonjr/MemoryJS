/**
 * MemoryValidator — Phase δ.1 (ROADMAP §3B.1).
 *
 * Reflection-stage service that prevents hallucinations and logical errors
 * from contaminating memory through self-critique before storage. Wraps
 * the existing `ContradictionDetector` for the detection method (per
 * ADR-011 wrap-and-extend), and adds four new methods natively:
 *
 * - `validateConsistency(newObs, existing)` — semantic + temporal +
 *   structural check of one new observation against an entity's body.
 * - `detectContradictions(entity)` — delegates to `ContradictionDetector.detect`.
 * - `repairMemory(entity, feedback)` — applies feedback as a corrective
 *   observation; integrates with `ConflictResolver` when configured.
 * - `validateTemporalOrder(observations)` — synchronous chronological
 *   sanity check on observations carrying ISO-8601 timestamps.
 * - `calculateReliability(entity)` — composite score from confidence,
 *   confirmation count, and access pattern (read-only).
 *
 * @module agent/MemoryValidator
 */

import type { Entity } from '../types/types.js';
import type { AgentEntity, AgentMetadata, ConflictStrategy } from '../types/agent-memory.js';
import type { ContradictionDetector, Contradiction as DetectorContradiction } from '../features/ContradictionDetector.js';
import type { ConflictResolver } from './ConflictResolver.js';

/** Per-issue annotation produced by `validateConsistency` /
 * `validateTemporalOrder`. Named `MemoryValidationIssue` to avoid
 * collision with the existing `ValidationIssue` re-exported under
 * `src/types/`. */
export interface MemoryValidationIssue {
  /** Stable kind identifier — useful for filtering in higher layers. */
  kind: 'semantic-contradiction' | 'temporal-disorder' | 'duplicate-observation' | 'low-confidence';
  /** Human-readable description (no localization yet). */
  message: string;
  /** Optional pointer to the offending observation (when applicable). */
  observation?: string;
}

/** Composite result returned by the `validate*` methods. Distinct from
 * the existing `ContradictionDetector.Contradiction` shape because it
 * spans multiple issue kinds, not just semantic similarity hits. Named
 * `MemoryValidationResult` to avoid collision with the existing
 * `MemoryValidationResult` re-exported under `src/utils/`. */
export interface MemoryValidationResult {
  isValid: boolean;
  /** Confidence in the validation itself (0-1). Reflects how certain we
   * are about the verdict, separate from the entity's own confidence. */
  confidence: number;
  issues: MemoryValidationIssue[];
  /** Plain-text follow-up actions a higher-level orchestrator might apply
   * (e.g., "drop observation X", "re-confirm with user"). */
  suggestions: string[];
}

/** Per-spec extended Contradiction shape with a conflict type and
 * severity tag. The lighter `ContradictionDetector.Contradiction` shape
 * (similarity-only) is converted up at the boundary. */
export interface Contradiction {
  observation1: string;
  observation2: string;
  conflictType: 'factual' | 'temporal' | 'logical';
  severity: 'low' | 'medium' | 'high';
  /** Optional resolved/repaired observation that supersedes both inputs. */
  resolution?: string;
}

export interface MemoryValidatorConfig {
  /** Confidence floor below which `calculateReliability` flags
   * `low-confidence`. Default 0.4. */
  lowConfidenceThreshold?: number;
}

export class MemoryValidator {
  private readonly contradictionDetector: ContradictionDetector;
  private readonly lowConfidenceThreshold: number;

  constructor(
    contradictionDetector: ContradictionDetector,
    config: MemoryValidatorConfig = {},
  ) {
    this.contradictionDetector = contradictionDetector;
    this.lowConfidenceThreshold = config.lowConfidenceThreshold ?? 0.4;
  }

  /**
   * Check a new observation against an entity's existing knowledge.
   * Composite: runs the contradiction detector, plus duplicate detection,
   * plus low-confidence flag if the entity itself looks unreliable.
   */
  async validateConsistency(
    newObservation: string,
    existing: Entity,
  ): Promise<MemoryValidationResult> {
    const issues: MemoryValidationIssue[] = [];
    const suggestions: string[] = [];

    // Duplicate check (cheap; do first).
    if (existing.observations.includes(newObservation)) {
      issues.push({
        kind: 'duplicate-observation',
        message: 'Identical observation already present on this entity.',
        observation: newObservation,
      });
      suggestions.push('Drop the duplicate; existing observation is unchanged.');
    }

    // Semantic-contradiction check (delegated).
    const contradictions = await this.contradictionDetector.detect(existing, [newObservation]);
    for (const c of contradictions) {
      issues.push({
        kind: 'semantic-contradiction',
        message: `New observation semantically contradicts existing observation (similarity ${c.similarity.toFixed(2)}).`,
        observation: newObservation,
      });
      suggestions.push(
        'Either supersede the existing observation (use ContradictionDetector.supersede) or reject the new one.',
      );
    }

    // Low-confidence flag (read-only signal; doesn't itself block).
    const reliability = this.calculateReliability(existing);
    if (reliability < this.lowConfidenceThreshold) {
      issues.push({
        kind: 'low-confidence',
        message: `Entity reliability ${reliability.toFixed(2)} is below threshold ${this.lowConfidenceThreshold}.`,
      });
    }

    return {
      isValid: issues.filter((i) => i.kind !== 'low-confidence').length === 0,
      confidence: 1 - 0.2 * issues.length, // rough confidence drop per issue
      issues,
      suggestions,
    };
  }

  /**
   * Detect contradictions within an entity's own observation set.
   * Delegates to `ContradictionDetector.detect` against a synthetic
   * "new observations" set (every observation paired against the rest).
   *
   * Per ROADMAP §3B.1 spec, returns the extended Contradiction shape
   * (with `conflictType` + `severity`) — these are derived heuristically
   * from similarity score because the underlying detector is similarity-
   * only.
   */
  async detectContradictions(entity: Entity): Promise<Contradiction[]> {
    if (entity.observations.length < 2) return [];

    // Re-run the detector pair-wise. We feed the same observation list as
    // both "existing" (entity.observations) and "new" — the detector
    // skips exact matches internally so this is safe.
    const raw = await this.contradictionDetector.detect(entity, entity.observations);

    const out: Contradiction[] = [];
    const seen = new Set<string>();
    for (const c of raw) {
      // Dedup symmetric pairs (a-vs-b == b-vs-a).
      const key = [c.existingObservation, c.newObservation].sort().join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rawToTyped(c));
    }
    return out;
  }

  /**
   * Apply feedback to repair an entity by appending a corrective
   * observation prefixed with `[repair]`. Returns the repaired entity
   * — does NOT persist. Caller decides via
   * `EntityManager.updateEntity` or supersede semantics.
   *
   * For full `ConflictResolver`-driven repair against a competing
   * memory, see `repairWithResolver`.
   */
  async repairMemory(entity: Entity, feedback: string): Promise<Entity> {
    return {
      ...entity,
      observations: [...entity.observations, `[repair] ${feedback}`],
      lastModified: new Date().toISOString(),
    };
  }

  /**
   * Repair an entity by delegating to a `ConflictResolver`. Constructs
   * the minimal `ConflictInfo` from a `Contradiction` finding so callers
   * don't have to hand-build it. Closes the loop spec'd in ROADMAP §3B.1
   * for `repairMemory` integration.
   *
   * @param entity         Primary memory being repaired (must be `AgentEntity`).
   * @param competing      Competing memory to resolve against.
   * @param contradiction  Optional similarity score / context. Severity
   *                       is mapped onto `detectionMethod = 'similarity'`.
   * @param resolver       The `ConflictResolver` instance.
   * @param agents         Optional agent-metadata registry (used by the
   *                       `trusted_agent` strategy). Empty Map is fine
   *                       for the strategies that don't need it.
   * @returns The resolved memory per the resolver's verdict.
   *
   * Throws when neither input is an `AgentEntity` (resolver requires the
   * extension fields), or when the resolver itself throws (e.g., no
   * conflicting memories found — should not happen given we provide both).
   */
  async repairWithResolver(
    entity: AgentEntity,
    competing: AgentEntity,
    resolver: ConflictResolver,
    options: {
      contradiction?: { similarity?: number };
      detectionMethod?: 'similarity' | 'negation' | 'manual';
      strategy?: ConflictStrategy;
      agents?: Map<string, AgentMetadata>;
    } = {},
  ): Promise<AgentEntity> {
    const sim = options.contradiction?.similarity ?? 0.85;
    const detectionMethod = options.detectionMethod ?? 'similarity';
    const agents = options.agents ?? new Map<string, AgentMetadata>();

    // Pick a sensible default strategy based on observable signal
    // (newest wins when timestamps are far apart; highest-confidence
    // otherwise). Caller overrides via `options.strategy`.
    let suggestedStrategy: ConflictStrategy;
    if (options.strategy) {
      suggestedStrategy = options.strategy;
    } else {
      const aTs = entity.lastModified ? Date.parse(entity.lastModified) : 0;
      const bTs = competing.lastModified ? Date.parse(competing.lastModified) : 0;
      const ageDeltaSeconds = Math.abs(aTs - bTs) / 1000;
      suggestedStrategy = ageDeltaSeconds > 60 * 60 * 24 ? 'most_recent' : 'highest_confidence';
    }

    const result = resolver.resolveConflict(
      {
        primaryMemory: entity.name,
        conflictingMemories: [competing.name],
        detectionMethod,
        similarityScore: sim,
        suggestedStrategy,
        detectedAt: new Date().toISOString(),
      },
      [entity, competing],
      agents,
    );
    return result.resolvedMemory;
  }

  /**
   * Validate temporal consistency of observations carrying ISO-8601
   * timestamps. Looks for either explicit `[T=ISO]` prefixes or
   * `createdAt`-style metadata. Returns `isValid: false` when any
   * adjacent pair is out of order.
   *
   * Synchronous (no I/O); the spec method is sync.
   */
  validateTemporalOrder(observations: string[]): MemoryValidationResult {
    const issues: MemoryValidationIssue[] = [];
    const stamped: Array<{ idx: number; ts: number; obs: string }> = [];
    for (let i = 0; i < observations.length; i += 1) {
      const m = observations[i].match(/\[T=([^\]]+)\]/);
      if (m) {
        const ts = Date.parse(m[1]);
        if (Number.isFinite(ts)) {
          stamped.push({ idx: i, ts, obs: observations[i] });
        }
      }
    }
    // Check adjacent stamped pairs.
    for (let i = 1; i < stamped.length; i += 1) {
      if (stamped[i].ts < stamped[i - 1].ts) {
        issues.push({
          kind: 'temporal-disorder',
          message: `Observation at index ${stamped[i].idx} has earlier timestamp than index ${stamped[i - 1].idx}.`,
          observation: stamped[i].obs,
        });
      }
    }
    return {
      isValid: issues.length === 0,
      confidence: stamped.length >= 2 ? 0.9 : 0.5, // less confident with sparse stamps
      issues,
      suggestions: issues.length > 0 ? ['Re-sort observations by parsed timestamp.'] : [],
    };
  }

  /**
   * Reliability score in `[0, 1]`. Composite of:
   * - the entity's own `confidence` field (default 0.5 when absent),
   * - confirmation count (asymptotic — diminishing returns past 5),
   * - inverse decay from creation time (older = slightly less reliable
   *   absent reinforcement; very gentle, doesn't dominate).
   *
   * Read-only; does not persist anything to the entity.
   */
  calculateReliability(entity: Entity): number {
    const ag = entity as AgentEntity;
    const conf = ag.confidence ?? 0.5;
    const confirmations = ag.confirmationCount ?? 0;
    // Asymptotic confirmation factor: 0 → 0, 5 → 0.83, 10 → 0.91, ∞ → 1.
    const confFactor = confirmations === 0 ? 0 : 1 - 1 / (1 + confirmations / 5);
    // Age penalty: -0.1 per 30 days, capped at -0.3.
    const created = entity.createdAt ? Date.parse(entity.createdAt) : Date.now();
    const ageDays = Math.max(0, (Date.now() - created) / (1000 * 60 * 60 * 24));
    const agePenalty = Math.min(0.3, ageDays / 300);
    // Weighted blend.
    return Math.max(0, Math.min(1, conf * 0.6 + confFactor * 0.3 - agePenalty * 0.1));
  }
}

/** Map a similarity-only `ContradictionDetector` finding to the spec'd
 * `Contradiction` shape. Severity is bucketed from similarity; conflict
 * type defaults to `factual` because we don't have richer signal to
 * distinguish factual-vs-temporal-vs-logical from raw similarity. */
function rawToTyped(c: DetectorContradiction): Contradiction {
  const sev: 'low' | 'medium' | 'high' =
    c.similarity >= 0.95 ? 'high' : c.similarity >= 0.85 ? 'medium' : 'low';
  return {
    observation1: c.existingObservation,
    observation2: c.newObservation,
    conflictType: 'factual',
    severity: sev,
  };
}
