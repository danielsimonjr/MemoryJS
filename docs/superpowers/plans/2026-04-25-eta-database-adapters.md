# η.4.1 — Database Adapters Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook (`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`). Promote via `superpowers:writing-plans` to a dated implementation plan when ready. All four adapter implementations are individually gated — see Decision gate section.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 4.1.

## Goal

Extend the `IMemoryBackend` contract (Phase β.1, `src/agent/MemoryBackend.ts`) to cover relational and document-oriented stores beyond the existing `InMemoryBackend` and `SQLiteBackend`. The Phase β.1 interface and parameterized test suite (`runMemoryBackendContract` in `tests/unit/agent/IMemoryBackend.contract.test.ts`) already define the full wire shape — this plan fills in the remaining adapter slots: PostgreSQL, MongoDB, MySQL, and Redis (hot cache tier).

One task can ship today with no new deps: hardening `IMemoryBackend` for third-party adapter authors (contract JSDoc, edge-case obligations, additional `runMemoryBackendContract` assertions). Everything that touches an external database is gated.

## Out of scope

- Vector database backends (ROADMAP § 5.1 — separate plan).
- Elasticsearch integration (ROADMAP § 4.3 — separate plan).
- A shared schema-migration runner — adapters manage their own DDL via `ensureSchema()`.
- Connection pool sizing and TLS configuration UI — adapters accept a connection string or config object; the caller configures credentials.

## Architecture

The common shape is the wrap-and-extend pattern from ADR-011: each adapter is a class that implements `IMemoryBackend` and delegates PRD-scale scoring to `DecayEngine.calculatePrdEffectiveImportance`. The interface itself does not change.

```
src/agent/
├── MemoryBackend.ts              — interface only; no changes (Phase β.1)
│                                   IDatabaseBackend sub-interface added here (T0)
├── InMemoryBackend.ts            — ephemeral adapter; no changes (Phase β.2)
├── SQLiteBackend.ts              — durable adapter; no changes (Phase β.3)
│
├── PostgreSQLBackend.ts          — NEW (gated) — wraps `pg` Pool; BM25-style
│                                   scoring via pg_trgm similarity(); degrades
│                                   to ILIKE if pg_trgm extension is absent
├── MongoDBBackend.ts             — NEW (gated) — wraps `mongodb` driver;
│                                   stores turns as documents, client-side PRD
│                                   scoring after $text retrieval
├── MySQLBackend.ts               — NEW (gated) — wraps `mysql2/promise`;
│                                   FULLTEXT index; client-side PRD blending
└── RedisBackend.ts               — NEW (gated) — hot-cache adapter via `ioredis`;
                                    keys memoryjs:turn:<sessionId>:<id>;
                                    optional TTL from MEMORY_ENGINE_REDIS_TTL_SECONDS
```

### `IDatabaseBackend` sub-interface (T0, no deps)

```typescript
export interface IDatabaseBackend extends IMemoryBackend {
  /** Idempotent DDL / index creation. Call once at startup. */
  ensureSchema(): Promise<void>;
  /** Release the connection pool / close the socket. */
  close(): Promise<void>;
}
```

Not on `IMemoryBackend` — the PRD contract stays minimal. Each adapter class implements `IDatabaseBackend`. `ManagerContext` will call `close()` from a future `dispose()` path (tracked via a `TODO(dispose)` comment).

### `ManagerContext` wiring

The `MEMORY_BACKEND` switch in `ManagerContext.memoryBackend` gains four arms, each gated:

```
'postgres'  → new PostgreSQLBackend(this.decayEngine, pgConfig)
'mongodb'   → new MongoDBBackend(this.decayEngine, mongoConfig)
'mysql'     → new MySQLBackend(this.decayEngine, mysqlConfig)
'redis'     → new RedisBackend(this.decayEngine, redisConfig)
```

If a peer dep is absent: `Cannot use MEMORY_BACKEND=postgres: peer dep "pg" is not installed. Run: npm install pg`.

## Runtime deps

All four adapters require new runtime deps. **None installed until Daniel approves each individually.** T0 has zero deps.

| Adapter | Package | Approx size (gzip) | Decision gate |
|---|---|---|---|
| PostgreSQL | `pg` + `@types/pg` | ~120 KB | **Needs Daniel's approval** |
| MongoDB | `mongodb` | ~280 KB | **Needs Daniel's approval** |
| MySQL | `mysql2` | ~180 KB | **Needs Daniel's approval** |
| Redis | `ioredis` | ~90 KB | **Needs Daniel's approval** |

All four go under `peerDependencies` with `peerDependenciesMeta: { ... { optional: true } }` so they don't install for consumers who don't need them. The Phase γ comment in `MemoryBackend.ts` ("Phase γ adds postgres and vector choices") is superseded by this plan.

## Tasks (when promoted)

### T0 — Interface hardening (no deps; unblocked)

1. Add `IDatabaseBackend` sub-interface to `src/agent/MemoryBackend.ts`.
2. Audit `IMemoryBackend` JSDoc: document `add()` idempotency obligation, empty-session behavior for `get_weighted`, unspecified `list_sessions` ordering.
3. Add 2 assertions to `runMemoryBackendContract`: (a) `delete_session` on unknown sessionId is no-op, (b) `list_sessions` after `delete_session` no longer contains the deleted session.
4. Add `TODO(dispose)` comment in `ManagerContext.memoryBackend` getter.
5. Update CLAUDE.md `MEMORY_BACKEND` table.

**Effort:** 0.5d.

### T1 — PostgreSQLBackend (gated: `pg`)

1. Add `pg` + `@types/pg` as optional peer deps.
2. Constructor: `{ pool: Pool } | { connectionString: string }`.
3. `ensureSchema()`: `CREATE TABLE IF NOT EXISTS memoryjs_turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT, role TEXT, importance REAL, created_at TEXT, last_accessed_at TEXT, access_count INTEGER DEFAULT 0, embedding JSONB, metadata JSONB)` + GIN index on `to_tsvector('english', content)`; if `pg_trgm` available, also create trgm index on content.
4. `add()`: `INSERT ... ON CONFLICT (id) DO NOTHING`.
5. `get_weighted()`: `SELECT * WHERE session_id=$1` ordered by `importance DESC`, similarity boost via `similarity(content, $2)` when `pg_trgm` available.
6. `delete_session()` / `list_sessions()` / `close()`: standard.
7. Wire `'postgres'` arm + `MEMORY_POSTGRES_URL` env var.
8. `PostgreSQLBackend.test.ts` — `runMemoryBackendContract` + pg_trgm degrade test + conflict-on-duplicate-id test.

**Effort:** 2–3d.

### T2 — MongoDBBackend (gated: `mongodb`)

1. Add `mongodb` as optional peer dep.
2. Constructor: `{ client: MongoClient; dbName?: string } | { connectionString: string; dbName?: string }`.
3. `ensureSchema()`: `createIndex({ sessionId: 1 })` + `createIndex({ content: 'text' })`.
4. `add()`: `replaceOne({ id }, doc, { upsert: true })`.
5. `get_weighted()`: `find({ sessionId })` + client-side PRD scoring. Cap fetch at `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` (default 200).
6. `delete_session()`: `deleteMany({ sessionId })`.
7. `list_sessions()`: `distinct('sessionId')`.
8. Wire `'mongodb'` arm + `MEMORY_MONGODB_URI` env var.

**Effort:** 2d.

### T3 — MySQLBackend (gated: `mysql2`)

1. Add `mysql2` as optional peer dep.
2. `ensureSchema()`: `CREATE TABLE IF NOT EXISTS memoryjs_turns (...)` + idempotent `ADD FULLTEXT ft_content (content)`.
3. `add()`: `INSERT IGNORE INTO ...`.
4. `get_weighted()`: `SELECT *, MATCH(content) AGAINST (? IN BOOLEAN MODE) AS ft_score WHERE session_id=? HAVING ft_score >= 0` + client-side PRD blending. Document `ft_min_word_len=1`.
5. `delete_session()` / `list_sessions()`: standard SQL.
6. Wire `'mysql'` arm + `MEMORY_MYSQL_URL` env var.

**Effort:** 2d.

### T4 — RedisBackend (gated: `ioredis`)

Hot-cache tier — NOT a durable store. Document prominently.

1. Add `ioredis` as optional peer dep.
2. Key scheme: `memoryjs:turn:<sessionId>:<id>` (HASH), `memoryjs:sessions` (SET), `memoryjs:session:<sessionId>` (SET of turn IDs).
3. `add()`: `HSET` + `SADD` x2. Optional `EXPIRE` from `MEMORY_ENGINE_REDIS_TTL_SECONDS`.
4. `get_weighted()`: `SMEMBERS` + `HGETALL` per turn → client-side PRD scoring → sort + threshold/limit.
5. `delete_session()`: pipelined `DEL` + `SREM`.
6. `list_sessions()`: `SMEMBERS memoryjs:sessions`.
7. `close()`: `redis.quit()`.
8. Wire `'redis'` arm + `MEMORY_REDIS_URL` env var.

**Effort:** 2d.

### T5 — Env var docs + CHANGELOG (after first gated adapter ships)

Update CLAUDE.md env var tables; CHANGELOG entry per adapter shipped.

**Effort:** 0.5d per adapter.

## Effort estimate

| Task | Effort |
|---|---|
| T0 — Interface hardening (unblocked) | 0.5d |
| T1–T4 — Adapter implementations (each gated) | 2–3d each |
| T5 — Docs + CHANGELOG | 0.5d each |
| **Total (all four adapters)** | **~10d** |

T0 unblocked. T1–T4 independent — can proceed in parallel once their deps are approved.

## Decision gate

Four separate gates — one per adapter dep. T0 has no gate.

1. **PostgreSQL (`pg`)** — Needs Daniel's approval.
2. **MongoDB (`mongodb`)** — Needs Daniel's approval.
3. **MySQL (`mysql2`)** — Needs Daniel's approval.
4. **Redis (`ioredis`)** — Needs Daniel's approval.

Approval for one does not imply approval for others.

## Risks

- **`pg_trgm` availability**: managed Postgres (RDS, Supabase, Neon) usually has it; bare installs may not. `PostgreSQLBackend.ensureSchema()` must detect and fall back to plain `ILIKE`. Test both paths.
- **MongoDB client-side scoring cost**: O(n) in session length. Mitigated by `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` cap.
- **MySQL `ft_min_word_len`**: default 4 silently drops short tokens. Recommend `ft_min_word_len=1`; add 2-char query test so failure is visible.
- **Redis volatility by design**: ephemeral unless caller configures AOF/RDB. Label clearly in JSDoc/README/CLAUDE.md.
- **`ManagerContext` dispose gap**: connection pools leak if `backend.close()` not called manually. `TODO(dispose)` from T0 tracks the fix.
