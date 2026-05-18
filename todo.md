# Active Cross-Repo TODO

Tracks in-flight work across `memoryjs`, `Memory-mcp`, and `workerpool`.
Marked items are complete; unmarked are open. Each item ends with a target
release where applicable.

## In progress

_(nothing currently in flight)_

## Backlog (offered but not yet picked)

- [ ] Vector-DB drivers (memoryjs P2 roadmap, MEM-06): Pinecone / Weaviate / Qdrant adapters.
- [ ] Wire `batchProcessViaWorkers` into a real agent-system consumer (entropy filter or pairwise similarity batch) to demonstrate the pattern end-to-end.
- [ ] Optional Memory-mcp surface: `worker_stats` MCP tool exposing `WorkerTaskManager.getStats()` so MCP clients can observe queue + pool state. Marginal value; defer unless asked.
- [ ] Real-database integration tests for PostgreSQLStorage under `MEMORYJS_TEST_PG_URL` (currently only unit-tested via the mocked `pg` module).

## Recently completed

- [x] Memory-mcp v12.5.1 — bump `@danielsimonjr/memoryjs` `^2.3.0` → `^2.8.1` (infrastructure-only; 46/46 spot-check green)
- [x] memoryjs v2.8.1 — `WorkerTaskManager.cancel` propagates through `WorkerpoolPromise.cancel()` for mid-execution cancellation
- [x] workerpool investigation — **no changes needed**; verified library is feature-complete for memoryjs's needs (cancel + timeout + circuit breaker + memory pressure + event emitter + dual build all present)
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
