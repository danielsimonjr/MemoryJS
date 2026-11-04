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
 * - **`dedupOnAdd=false`** — bypass dedup. `add()` still goes through
 *   `MemoryEngine.addTurn` (so exclusion rules, importance scoring and
 *   `turnAdded` events apply) but with `skipDedup: true`, so every turn is
 *   written. Intended for bulk import scenarios where the caller has
 *   already de-duplicated upstream.
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
import { selectWeightedTurns } from './selectWeightedTurns.js';

/**
 * Options for `SQLiteBackend`.
 */
export interface SQLiteBackendOptions {
  /** When true (default), `add()` runs the dedup chain via
   * `MemoryEngine.addTurn`. When false, writes bypass dedup. */
  dedupOnAdd?: boolean;
  /** When true, preserve caller's `turn.id` by renaming the
   * engine-generated entity name post-creation. Default false (lossy
   * translation: caller IDs are silently overridden). */
  preserveCallerIds?: boolean;
  /**
   * Optional rename hook used by `preserveCallerIds=true`. Pass
   * `(a, b) => ctx.entityManager.renameEntity(a, b)` to enable it. Without
   * it, `preserveCallerIds=true` throws on the first id mismatch. Additive;
   * omitting it keeps the previous behaviour.
   */
  renameEntity?: (oldName: string, newName: string) => Promise<unknown>;
}

/**
 * Durable `IMemoryBackend` that stores turns as graph entities through `MemoryEngine`.
 *
 * By default `add` runs the dedup chain of the engine. Decay scoring uses `DecayEngine`.
 */
export class SQLiteBackend implements IMemoryBackend {
  private readonly options: Required<Omit<SQLiteBackendOptions, 'renameEntity'>>;
  private readonly renameEntity?: (oldName: string, newName: string) => Promise<unknown>;

  constructor(
    private readonly memoryEngine: MemoryEngine,
    private readonly decayEngine: DecayEngine,
    options: SQLiteBackendOptions = {},
  ) {
    this.options = {
      dedupOnAdd: options.dedupOnAdd ?? true,
      preserveCallerIds: options.preserveCallerIds ?? false,
    };
    this.renameEntity = options.renameEntity;
  }

  async add(turn: MemoryTurn): Promise<void> {
    // PRD-importance translation (turn.importance is [1.0, 3.0]; addTurn
    // expects memoryjs scale [0, 10]). Match InMemoryBackend's inverse.
    const memoryjsImportance = Math.max(0, Math.min(10, (turn.importance - 1.0) * 5));

    const result = await this.memoryEngine.addTurn(turn.content, {
      sessionId: turn.sessionId,
      role: turn.role,
      importance: memoryjsImportance,
      // dedupOnAdd=false: bulk-import bypass, the caller de-duplicated upstream.
      skipDedup: !this.options.dedupOnAdd,
    });

    // Optional: rename the engine-generated entity to the caller's turn.id.
    // `result.entity` is absent on the `blocked` path (Phase Excl B);
    // a blocked write never produces an id-mismatch to detect.
    if (
      this.options.preserveCallerIds &&
      !result.duplicateDetected &&
      result.entity &&
      turn.id !== result.entity.name
    ) {
      if (!this.renameEntity) {
        throw new Error(
          'SQLiteBackend: preserveCallerIds=true requires a renameEntity hook. ' +
            'Pass `renameEntity` (e.g. ctx.entityManager.renameEntity.bind(ctx.entityManager)) ' +
            'in SQLiteBackendOptions to enable it. Default false.',
        );
      }
      // Errors from the hook (e.g. DuplicateEntityError on a colliding id) propagate.
      await this.renameEntity(result.entity.name, turn.id);
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

    return selectWeightedTurns(turns, entity => {
      const score = this.decayEngine.calculatePrdEffectiveImportance(entity, query);
      return { turn: entityToTurn(entity), score };
    }, threshold, limit);
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
