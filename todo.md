# Active Cross-Repo TODO

Tracks in-flight work across `memoryjs`, `Memory-mcp`, and `workerpool`.
Marked items are complete; unmarked are open. Each item ends with a target
release where applicable.

## In progress

- [x] ✅ **Release v3.4.0** (2026-08-29) — tagged, GitHub release, `npm publish` verified via `npm view dist-tags` = 3.4.0.
      Original item:
- [x] **Release v3.4.0** — cut the accumulated `[Unreleased]` work (adapter.write/onWrite seam,
      Dependabot auto-merge, CI matrix, nightly CI, duplicate-heading fix). Minor bump: the section
      carries `Added` entries, and 0.x rules do not apply here (this package is past 1.0).
      Gate before tagging: typecheck + lint + `test:ci` + build. Then tag, GitHub release, and
      `npm publish` — @danielsimonjr/memoryjs is already on npm at 3.3.2, and the ZBOOK is the only
      machine holding the credential.

## Workerpool slow-build investigation

Documenting findings for future cycles in this repo:

- **`npm run build` takes ~40 minutes** on this Windows/Dropbox machine.
  The bottleneck is AssemblyScript / WebAssembly compilation (multiple
  output formats: `workerpool.wasm`, `workerpool.debug.wasm`,
  `workerpool.esm.wasm`, `workerpool.raw.wasm` + the matching `.wat`
  text-format files). The Rollup bundling step itself is sub-minute;
  TS compilation is ~1–2 minutes. WASM is the rest.
- **Tests can run without the build.** `test/js/Pool.signal.test.js`
  imports `Pool` directly from `src/js/Pool` (CommonJS) instead of the
  rollup-bundled `dist/workerpool.js`. That dropped the full test cycle
  from ~8 s (against dist) and skipped the 40-minute rebuild between
  iterations. Pattern: use `require('../../src/js/Pool')` for new
  JS tests where the bundled helpers aren't needed.
- **`prepublishOnly` runs the full build + tests on every publish.**
  When the publish is from a known-good state, `npm publish
  --ignore-scripts` skips it. Used safely here after a manual
  build + test cycle.
- **Override / direct-dep mismatch**: `package.json` declared both
  `@rollup/plugin-terser` and `rollup` as direct dependencies AND
  in `overrides` with different version ranges. npm publish refused
  with `EOVERRIDE`. Bumped the direct deps to satisfy the override
  ranges. Pre-existing — happened on first publish from a clean lockfile.

## Backlog (offered but not yet picked)

- [ ] Vector-DB drivers (memoryjs P2 roadmap, MEM-06): Pinecone / Weaviate / Qdrant adapters.
- [ ] Wire `batchProcessViaWorkers` into a real agent-system consumer (entropy filter or pairwise similarity batch) to demonstrate the pattern end-to-end.
- [ ] Optional Memory-mcp surface: `worker_stats` MCP tool exposing `WorkerTaskManager.getStats()` so MCP clients can observe queue + pool state. Marginal value; defer unless asked.
- [ ] Real-database integration tests for PostgreSQLStorage under `MEMORYJS_TEST_PG_URL` (currently only unit-tested via the mocked `pg` module).
- [ ] `tests/unit/core/segments/segments-review-fixes.test.ts` exceeds the 120s default `testTimeout`
      under full-suite contention on a 12-core box (1 failure of 7843 on 2026-08-30), but passes
      **13/13 in 19s when run in isolation** and is green on all six CI legs. So it is worker
      contention while 320 other test files run, not a code defect -- the variance source is named,
      which is the bar for touching the threshold. Decide between raising the timeout for this file
      only, or marking it `sequential`. Do **not** widen the global timeout: that would mask real
      hangs everywhere else. Untouched by #115/#116; last changed in #103.

## Recently completed

- [x] workerpool v10.2.0 — `AbortSignal` integration in `pool.exec()` (5-test suite green); fixed pre-existing `Promise.resolve` / `Promise.reject` runtime gap; aligned `@rollup/plugin-terser` + `rollup` direct deps with overrides
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
