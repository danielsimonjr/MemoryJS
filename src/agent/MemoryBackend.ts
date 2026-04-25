/**
 * Memory Backend Interface (`IMemoryBackend`)
 *
 * Phase β.1 of the v1.12.0 Memory Engine Decay Extensions plan
 * (`docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`).
 *
 * This is the interface only — adapters (`InMemoryBackend`, `SQLiteBackend`)
 * land in T12 / T13 and `DecayEngine.calculatePrdEffectiveImportance` in T15.
 *
 * Why a new interface vs. `IGraphStorage`:
 * - `IGraphStorage` is the durable graph-store contract (entities + relations
 *   + indexes + transactions).
 * - `IMemoryBackend` is the agent-memory-flavored contract — turn-level
 *   ingest, weighted retrieval (PRD `get_weighted`), session lifecycle.
 *   Both can coexist; this is purely additive.
 *
 * Naming convention: `get_weighted` and `delete_session` use snake_case
 * deliberately to match the Context Engine PRD spec verbatim (PRD MEM-04).
 * This is the only place in the codebase that does so. The rest of the
 * codebase keeps camelCase.
 *
 * @module agent/MemoryBackend
 */

/**
 * The unit of conversation memory the backend round-trips. Distinct from
 * `AgentEntity`: this is a thinner shape designed to map cleanly to PRD
 * MEM-04 `add()` / `get_weighted()`. Adapters translate to/from
 * `AgentEntity` at the storage boundary.
 */
export interface MemoryTurn {
  /**
   * Stable turn identifier.
   *
   * **Per-backend honoring:**
   * - `InMemoryBackend` — caller-supplied `id` is honored verbatim.
   * - `SQLiteBackend` — caller-supplied `id` is **silently overridden**
   *   by an engine-generated entity name unless `preserveCallerIds: true`
   *   is set on the backend (which currently throws, pending a future
   *   `storage.renameEntity` primitive).
   *
   * Callers that need stable cross-backend IDs should not rely on this
   * field round-tripping unchanged today.
   */
  id: string;

  /** Session this turn belongs to. Authoritative for routing + filtering. */
  sessionId: string;

  /** Raw turn content (no role prefix — adapters add `[role=...]` on write). */
  content: string;

  /** Speaker role. Determines role-prefix on storage. */
  role: 'user' | 'assistant' | 'system';

  /**
   * Importance score in PRD range [1.0, 3.0]. Adapters using the legacy
   * memoryjs scale [0, 10] convert at the boundary via
   * `DecayEngine.calculatePrdEffectiveImportance`.
   */
  importance: number;

  /**
   * ISO-8601 creation timestamp.
   *
   * **Per-backend honoring:**
   * - `InMemoryBackend` — caller-supplied `createdAt` is honored verbatim.
   * - `SQLiteBackend` — caller-supplied `createdAt` is **silently
   *   overridden** by `EpisodicMemoryManager.createEpisode`'s
   *   `new Date().toISOString()`.
   *
   * Set by the engine on read.
   */
  createdAt: string;

  /** ISO-8601 most-recent-access timestamp. Updated by `get_weighted`. */
  lastAccessedAt?: string;

  /** Total reads of this turn through `get_weighted`. */
  accessCount?: number;

  /** Optional dense embedding vector (semantic recall). */
  embedding?: number[];

  /**
   * Caller metadata round-tripped opaquely.
   *
   * **Per-backend honoring:**
   * - `InMemoryBackend` — full round-trip via the in-memory `MemoryTurn` map.
   * - `SQLiteBackend` — currently dropped on write; round-trip returns
   *   `undefined`. Future enhancement could thread metadata through the
   *   `agentMetadata` JSON-blob column shipped in T06b.
   */
  metadata?: Record<string, unknown>;
}

/** Result row returned by `get_weighted`: a turn plus its decay-weighted score. */
export interface WeightedTurn {
  turn: MemoryTurn;
  /** PRD effective importance × recency × overlap. Higher = more relevant. */
  score: number;
}

/** Options for `get_weighted` retrieval. */
export interface GetWeightedOptions {
  /** Maximum rows to return. Default backend-defined (typically 10). */
  limit?: number;

  /**
   * Score floor — turns scoring below this are pruned from the result set.
   * Distinct from the legacy `MEMORY_DECAY_MIN_IMPORTANCE` (storage clamp);
   * this is a retrieval filter. Defaults to backend's
   * `min_importance_threshold` config.
   */
  threshold?: number;
}

/**
 * The agent-memory-flavored backend contract. Adapters:
 * - `InMemoryBackend` — ephemeral `Map<sessionId, MemoryTurn[]>`, default.
 * - `SQLiteBackend` — wraps `SQLiteStorage` + `MemoryEngine` for persistence.
 * - (Phase γ) `PostgreSQLBackend`, `VectorMemoryBackend`.
 *
 * All methods are async to allow remote/streaming backends in the future.
 */
export interface IMemoryBackend {
  /**
   * PRD MEM-04: persist a turn. `turn.sessionId` is authoritative — there
   * is no separate `sessionId` parameter. Idempotency is backend-defined:
   * `SQLiteBackend` runs the four-tier dedup chain by default; on a
   * duplicate hit, the call is a silent no-op (no event fires through
   * this interface — events live on `MemoryEngine.events`).
   */
  add(turn: MemoryTurn): Promise<void>;

  /**
   * PRD MEM-04: return turns in weighted-by-decay order, scoped to the
   * given session. The score is `DecayEngine.calculatePrdEffectiveImportance`
   * combined with optional query-relevance signal (semantic backends use
   * embedding similarity; lexical backends use BM25 or token overlap).
   *
   * Note the snake_case method name preserved from the PRD.
   */
  get_weighted(
    query: string,
    sessionId: string,
    options?: GetWeightedOptions,
  ): Promise<WeightedTurn[]>;

  /** Delete every turn in the session. Idempotent: missing session → no-op. */
  delete_session(sessionId: string): Promise<void>;

  /** Enumerate every distinct sessionId currently held by this backend. */
  list_sessions(): Promise<string[]>;
}
