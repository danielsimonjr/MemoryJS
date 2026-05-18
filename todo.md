# Active Cross-Repo TODO

Tracks in-flight work across `memoryjs`, `Memory-mcp`, and `workerpool`.
Marked items are complete; unmarked are open. Each item ends with a target
release where applicable.

## In progress

- [x] **Investigate workerpool for genuine improvements** — **No changes needed.**
  Verified that `WorkerpoolPromise.cancel()` is exposed and typed
  (`types/core/Promise.d.ts:79`); `Pool` already has circuit breaker, memory
  pressure, retry, ready promise, event emitter, warmup, comprehensive types,
  dual ESM/CJS build (v10.1.0). The one thing missing — `AbortSignal`
  integration — would be a generic modernisation, not something memoryjs
  needs. Skipping per the "as needed for changes in memoryjs" qualifier.
- [ ] **Fix `WorkerTaskManager.cancel` to propagate through `WorkerpoolPromise.cancel()`**
  → memoryjs v2.7.0 documented "best-effort" cancellation, but workerpool
  already exposes hard-cancel via `pool.exec(...).cancel()`. Retain the
  workerpool-promise reference; call `.cancel()` on it when the handle
  cancels mid-execution. Add a test that verifies a running worker receives
  the cancellation. → memoryjs **v2.8.1**.
- [ ] **Bump Memory-mcp's `@danielsimonjr/memoryjs` dep**
  → currently `^2.3.0`. Pull in everything since: v12.5.0 engineering tools,
  v2.5.0 dead-code pass, v2.6.0 PostgreSQL backend, v2.7.0 WorkerTaskManager,
  v2.8.0/2.8.1 tsvector FTS + cancel fix. Verify typecheck + integration
  tests pass against the new memoryjs. → Memory-mcp **v12.5.2**.

## Backlog (offered but not yet picked)

- [ ] Vector-DB drivers (memoryjs P2 roadmap, MEM-06): Pinecone / Weaviate / Qdrant adapters.
- [ ] Wire `batchProcessViaWorkers` into a real agent-system consumer (entropy filter or pairwise similarity batch) to demonstrate the pattern end-to-end.
- [ ] Optional Memory-mcp surface: `worker_stats` MCP tool exposing `WorkerTaskManager.getStats()` so MCP clients can observe queue + pool state. Marginal value; defer unless asked.
- [ ] Real-database integration tests for PostgreSQLStorage under `MEMORYJS_TEST_PG_URL` (currently only unit-tested via the mocked `pg` module).

## Recently completed

- [x] memoryjs v2.8.0 — tsvector FTS for `PostgreSQLStorage`
- [x] memoryjs v2.7.0 — `WorkerTaskManager` facade + `batchProcessViaWorkers`
- [x] memoryjs v2.6.0 — PostgreSQL backend
- [x] memoryjs v2.5.0 — dead-code pass (16 orphan modules removed, 8 redundant aliases)
- [x] Memory-mcp v12.5.0 — 10 engineering / diagnostic MCP tools
- [x] memoryjs v2.4.0 — CLI `cache` / `reindex` + REPL extensions
- [x] memoryjs v2.3.0 — CLI manager coverage (`heuristic`/`obs-dedup`/`spell`/`check`) + persistence-allowlist fix
- [x] memoryjs v2.2.0 — CLI `diag` / `inspect` engineering surface
- [x] memoryjs v2.1.2 — `memory smoke` CLI subcommand
- [x] memoryjs v2.1.1 — `UpdateEntitySchema.passthrough` fix
- [x] Architecture docs cleanup (v2.5.0-removed-module bleed + API hallucinations)
- [x] memoryjs README cleanup (changelog-bleed removal, fact-checked against `src/`)

## Conventions

Update this file when:
- A new task lands → add to **In progress**
- A task ships → move to **Recently completed** with the release tag
- Investigation rules a candidate out → note the rationale + drop from list
