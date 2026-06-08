/**
 * `SQLiteBackend` — durable `IMemoryBackend` adapter wrapping the
 * existing memoryjs `MemoryEngine` + `SQLiteStorage` + `DecayEngine`.
 *
 * Phase β.3 of v1.12.0 Memory Engine Decay Extensions
 * (`docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`).
 *
 * Design choices:
 * - **`dedupOnAdd=true` (default)** — `add()` delegates to
 *   `MemoryEngine.addTurn`, inheriting the four-tier dedup chain
 *   (exact / prefix / Jaccard / optional semantic) and event emission.
 *   Idempotent on duplicate — silent no-op.
 * - **`dedupOnAdd=false`** — bypass dedup. `add()` writes directly via
 *   `EntityManager.createEntities`. Intended for bulk import scenarios
 *   where the caller has already de-duplicated upstream.
 * - **`preserveCallerIds=true`** — when set together with
 *   `dedupOnAdd=true`, the engine-generated entity name is renamed to
 *   the caller's `turn.id` after creation. Lossy translation
 *   documented in the spec; default is `false` (engine-generated names
 *   win, caller's IDs are silently overridden).
 * - **`get_weighted` reuses the v1.11.0 `MemoryEngine.getSessionTurns`**
 *   for session-scoped retrieval, then scores via
 *   `DecayEngine.calculatePrdEffectiveImportance` and applies the
 *   threshold/limit filter. The four-tier-dedup-aware `addTurn` and
 *   the sessionId-indexed retrieval together give us identical
 *   observable behavior to `InMemoryBackend` for the contract suite.
 *
 * @module agent/SQLiteBackend
 */

import type { DecayEngine } from './DecayEngine.js';
import type { MemoryEngine } from './MemoryEngine.js';
import type {
  IMemoryBackend,
  MemoryTurn,
  WeightedTurn,
  GetWeightedOptions,
} from './MemoryBackend.js';
import type { AgentEntity } from '../types/agent-memory.js';

export interface SQLiteBackendOptions {
  /** When true (default), `add()` runs the dedup chain via
   * `MemoryEngine.addTurn`. When false, writes bypass dedup. */
  dedupOnAdd?: boolean;
  /** When true, preserve caller's `turn.id` by renaming the
   * engine-generated entity name post-creation. Default false (lossy
   * translation: caller IDs are silently overridden). */
  preserveCallerIds?: boolean;
}

export class SQLiteBackend implements IMemoryBackend {
  private readonly options: Required<SQLiteBackendOptions>;

  constructor(
    private readonly memoryEngine: MemoryEngine,
    private readonly decayEngine: DecayEngine,
    options: SQLiteBackendOptions = {},
  ) {
    this.options = {
      dedupOnAdd: options.dedupOnAdd ?? true,
      preserveCallerIds: options.preserveCallerIds ?? false,
    };
  }

  async add(turn: MemoryTurn): Promise<void> {
    if (!this.options.dedupOnAdd) {
      // Direct-write bypass: not yet wired (would need a path through
      // EntityManager.createEntities + post-write contentHash + agentMetadata
      // serialization). For β.3 we only ship the dedup-on path; bulk-import
      // bypass is a follow-up if/when a caller asks for it.
      throw new Error(
        'SQLiteBackend: dedupOnAdd=false bypass path is not implemented yet. ' +
          'See docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md',
      );
    }

    // PRD-importance translation (turn.importance is [1.0, 3.0]; addTurn
    // expects memoryjs scale [0, 10]). Match InMemoryBackend's inverse.
    const memoryjsImportance = Math.max(0, Math.min(10, (turn.importance - 1.0) * 5));

    const result = await this.memoryEngine.addTurn(turn.content, {
      sessionId: turn.sessionId,
      role: turn.role,
      importance: memoryjsImportance,
    });

    // Optional: write caller's id as a rename on the new entity.
    // For β.3 we skip this — preserveCallerIds=true requires a
    // storage.renameEntity primitive that doesn't exist yet. Adding it
    // touches the durable-storage layer + indexes, so it lands as a
    // separate (T13b) follow-up if needed.
    if (this.options.preserveCallerIds && !result.duplicateDetected && turn.id !== result.entity.name) {
      throw new Error(
        'SQLiteBackend: preserveCallerIds=true requires storage.renameEntity ' +
          'which is not implemented yet. Default false; see β.3 spec notes.',
      );
    }
  }

  async get_weighted(
    query: string,
    sessionId: string,
    options?: GetWeightedOptions,
  ): Promise<WeightedTurn[]> {
    const turns = await this.memoryEngine.getSessionTurns(sessionId);
    if (turns.length === 0) return [];

    const threshold = options?.threshold ?? this.decayEngine.prdMinImportanceThreshold;
    const limit = options?.limit ?? 10;

    const scored: WeightedTurn[] = turns.map((entity) => {
      const score = this.decayEngine.calculatePrdEffectiveImportance(entity, query);
      return { turn: entityToTurn(entity), score };
    });

    return scored
      .filter((wt) => wt.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async delete_session(sessionId: string): Promise<void> {
    // MemoryEngine.deleteSession is idempotent on unknown sessions —
    // returns { deleted: 0 } and skips the event. Spec for IMemoryBackend
    // says delete_session is idempotent → matches.
    await this.memoryEngine.deleteSession(sessionId);
  }

  async list_sessions(): Promise<string[]> {
    return await this.memoryEngine.listSessions();
  }
}

/** Project an `AgentEntity` (from `MemoryEngine.getSessionTurns`) onto
 * the `MemoryTurn` shape. Strips the role prefix so callers see raw
 * content. PRD-scale importance is recovered by the inverse translation
 * applied at add() time (memoryjs [0,10] → PRD [1.0, 3.0]). */
function entityToTurn(entity: AgentEntity): MemoryTurn {
  const observation = entity.observations?.[0] ?? '';
  // Strip the role prefix `[role=user]` / `[role=assistant]` etc.
  const m = observation.match(/^\[role=([a-z]+)\]\s*(.*)$/i);
  const role = (m?.[1]?.toLowerCase() ?? 'user') as 'user' | 'assistant' | 'system';
  const content = m?.[2] ?? observation;
  // PRD-scale importance: convert memoryjs [0, 10] back to [1.0, 3.0].
  const memoryjsImportance = entity.importance ?? 5;
  const prdImportance = 1.0 + (memoryjsImportance / 10.0) * 2.0;

  return {
    id: entity.name,
    sessionId: entity.sessionId ?? '',
    content,
    role,
    importance: prdImportance,
    createdAt: entity.createdAt ?? new Date().toISOString(),
    lastAccessedAt: entity.lastAccessedAt,
    accessCount: entity.accessCount,
    embedding: undefined, // not exposed via getSessionTurns; future read-path enhancement
    metadata: undefined, // see the metadata-round-trip caveat in the contract test
  };
}
