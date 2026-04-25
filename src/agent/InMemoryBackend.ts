/**
 * `InMemoryBackend` — ephemeral, process-lifetime `IMemoryBackend` adapter.
 *
 * Phase β.2 of v1.12.0 Memory Engine Decay Extensions
 * (`docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`).
 *
 * Stores turns in an in-process `Map<sessionId, MemoryTurn[]>`. No
 * persistence. Suitable as the default backend when no SQLite/Postgres
 * configuration exists, and as the fast/clean fixture in unit tests.
 *
 * Scoring delegates to `DecayEngine.calculatePrdEffectiveImportance` so
 * `get_weighted` returns the same PRD-formula scores that
 * `SQLiteBackend` (T13) will produce.
 *
 * @module agent/InMemoryBackend
 */

import type { DecayEngine } from './DecayEngine.js';
import type {
  IMemoryBackend,
  MemoryTurn,
  WeightedTurn,
  GetWeightedOptions,
} from './MemoryBackend.js';
import type { AgentEntity } from '../types/agent-memory.js';

export class InMemoryBackend implements IMemoryBackend {
  /** Per-session FIFO ordered list of turns. */
  private readonly turns = new Map<string, MemoryTurn[]>();

  constructor(private readonly decayEngine: DecayEngine) {}

  async add(turn: MemoryTurn): Promise<void> {
    const list = this.turns.get(turn.sessionId) ?? [];
    // Match SQLiteBackend's dedup-on-exact-content behavior so the
    // contract suite's add semantics are identical across backends.
    // Subsequent adds with identical (sessionId, content) become silent
    // no-ops, matching the four-tier exact-equality tier in MemoryEngine.
    if (list.some((existing) => existing.content === turn.content)) {
      return;
    }
    list.push(turn);
    this.turns.set(turn.sessionId, list);
  }

  async get_weighted(
    query: string,
    sessionId: string,
    options?: GetWeightedOptions,
  ): Promise<WeightedTurn[]> {
    const list = this.turns.get(sessionId);
    if (!list || list.length === 0) return [];

    const threshold = options?.threshold ?? this.decayEngine.prdMinImportanceThreshold;
    const limit = options?.limit ?? 10;

    // Score every turn via PRD effective-importance, with the query
    // contributing the relevance-boost term.
    const scored: WeightedTurn[] = list.map((turn) => {
      const synthetic = turnToEntity(turn);
      const score = this.decayEngine.calculatePrdEffectiveImportance(
        synthetic,
        query,
      );
      return { turn, score };
    });

    // Threshold filter, then descending-score sort, then limit.
    return scored
      .filter((wt) => wt.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async delete_session(sessionId: string): Promise<void> {
    this.turns.delete(sessionId);
  }

  async list_sessions(): Promise<string[]> {
    return Array.from(this.turns.keys());
  }
}

/** Project a `MemoryTurn` onto the `AgentEntity` shape that
 * `DecayEngine.calculatePrdEffectiveImportance` consumes. The decay
 * engine only reads `importance`, `createdAt`, `lastAccessedAt`, and
 * `observations`, so we synthesize a minimal entity.
 *
 * `MemoryTurn.importance` is PRD scale `[1.0, 3.0]`; the decay engine
 * expects memoryjs scale `[0, 10]` and auto-scales internally. We
 * apply the inverse translation here so the round-trip preserves
 * the caller's intent: `mjs = (prd − 1.0) × 5`. */
function turnToEntity(turn: MemoryTurn): AgentEntity {
  const prd = turn.importance;
  const memoryjsImportance = Math.max(0, Math.min(10, (prd - 1.0) * 5));
  return {
    name: turn.id,
    entityType: 'memory_turn',
    observations: [turn.content],
    createdAt: turn.createdAt,
    lastModified: turn.createdAt,
    lastAccessedAt: turn.lastAccessedAt,
    importance: memoryjsImportance,
    memoryType: 'episodic',
    accessCount: turn.accessCount ?? 0,
    confidence: 1,
    confirmationCount: 0,
    visibility: 'private',
    sessionId: turn.sessionId,
  } as AgentEntity;
}
