# Optimization Opportunities — Speed & Security

**Status:** Investigation (2026-07-24) — **18 of 20 items implemented same day** (this branch).
Implemented: S1–S10 + Sec1–Sec10 (Sec1 via the env-gated `GovernanceHooks` chokepoint on
`EntityManager`). Headline measurements: ranked search ~3.3s → ~16ms at 4k entities (~170×);
SQLite sequential writes 23 → 1,972 ops/s (84×); JSONL 6.1×; warm root import ~220ms → ~150ms
with chrono-node fully lazy; type-only cycles 39 → 4 (0 runtime); tool-verified 0 orphans /
0 duplicates.

**Both follow-ups closed (post-merge):** S9 completed — `better-sqlite3` is now lazily
`createRequire`'d inside `SQLiteStorage` (loaded on first instantiation, not at module
evaluation), so the root/core import no longer loads the native addon at all (verified: absent
from `require.cache` after a root import, present after actual SQLite use). The pre-existing
bundled-dist worker-path bug is fixed — `FuzzySearch.resolveWorkerPath` probes an ordered
candidate list across every build layout (bundled root chunk, subpath entry, CLI bundle,
unbundled tsc, src-during-tests) and prefers the extension matching the host module, so the
worker pool is no longer silently disabled in production bundles.
**Method:** Derived from the `create-dependency-graph` tool reports (module graph, fan-in/out, circular-dependency split, file inventory) plus targeted source verification. Every finding below was confirmed against source with `file:line` evidence; leads that the reports suggested but source refuted are listed at the end so they are not re-investigated.

**How to read this:** Each item has evidence, when it actually hurts (workload shape), a concrete fix, expected win, and risk. Ranked within each half by value/effort. Nothing here is applied yet — this is the analysis, not the change.

**Two structural themes emerged:**
1. **Write amplification.** Manager-level mutations rewrite the whole graph (`saveGraph`) instead of appending deltas, even for single-entity writes. This one root cause inflates items S2–S6 (every write emits `graph:saved`, which invalidates every derived view). Fixing it collapses the blast radius of several others.
2. **Security modules wired into nothing.** Governance, RBAC, and PII redaction are individually well-implemented and unit-tested, but not reachable from `ManagerContext` and not enforced at any chokepoint. The library *advertises* controls it does not apply by default.

---

## Speed

### S1. Default ranked search recomputes IDF inside the per-document loop — O(N² × terms) *(highest value/effort)*
- **Evidence:** `ManagerContext` constructs `new RankedSearch(this.storage)` with no `storageDir` (`src/core/ManagerContext.ts:469`), so the TF-IDF index manager is never built and every query takes the slow path `searchWithoutIndex` (`src/search/RankedSearch.ts:184`). There, `calculateIDFFromTokenSets(term, tokenSets)` is called **inside** the `for (docData) { for (term) }` double loop (`RankedSearch.ts:341`), and that helper scans all N token sets (`src/utils/searchAlgorithms.ts:158-165`). IDF is a per-term corpus constant — loop-invariant. (The inline comment claims "O(1) per document," but the call rescans the whole corpus each time.) Also `namesKey = entities.map(e => e.name).join('\0')` builds an O(N) string per query for cache validation (`RankedSearch.ts:299`).
- **Hurts:** every `ctx.rankedSearch` query and the lexical channel of `HybridSearchManager`, at ≥ ~5k entities.
- **Fix:** hoist IDF per query term into a `Map<term, idf>` computed once before the document loop; replace `namesKey` with a monotonic generation counter bumped from graph events.
- **Win:** O(N²)→O(N·terms), 100–1000× on large graphs, identical scores. **Risk:** ~zero. **Effort:** ~10 lines.

### S2. Every manager mutation deep-copies and rewrites the whole graph (root cause of the write-amplification theme)
- **Evidence:** `EntityManager.createEntities` calls `getGraphForMutation()` (deep copy of every entity, `src/core/EntityManager.ts:256`) then `saveGraph(graph)` (`:315`) for even a single entity. Same shape at `EntityManager.ts:362/371, 619/655, 808/829, 954/988, 1005/1027, 1048/1079, 1107/1112`; `RelationManager.ts:74/124, 181/209, 286/302`; `ObservationManager` add path (`:383→:515`). JSONL `saveGraphInternal` re-serializes and rewrites the entire file + rebuilds all indexes (`src/core/GraphStorage.ts:870-932`). SQLite `saveGraph` runs `DELETE FROM relations; DELETE FROM entities;` then reinserts every row (`src/core/SQLiteStorage.ts:699-753`), firing FTS5 triggers per row (`:328-349`) and rebuilding name/type indexes (`:760-767`).
- **Hurts:** any write-heavy path (agent memory, ingestion). N sequential writes cost O(N²); a single create on a 100k-entity SQLite graph runs ~200k row ops + ~200k FTS trigger ops in one transaction.
- **Fix:** delta persistence — `createEntities` loops `storage.appendEntity` (exists: single INSERT / single JSONL line, `GraphStorage.ts:682`, `SQLiteStorage.ts:790`); updates via `storage.updateEntity` (already append-only on JSONL); targeted deletes. Keep `saveGraph` for import/restore only.
- **Win:** O(changed) instead of O(graph). **Risk:** medium — event semantics shift from `graph:saved` to per-entity events (this *fixes* S4/S5 staleness); validation/TOCTOU must stay under `graphMutex`. **Effort:** medium.

### S3. SQLite write-side tuning: default `synchronous=FULL`, per-call `prepare()`, O(N) cache maintenance on append
- **Evidence:** `initialize()` sets only `foreign_keys=ON` + `journal_mode=WAL` (`src/core/SQLiteStorage.ts:222-223`) — WAL with default `synchronous=FULL` fsyncs every commit (`NORMAL` is the canonical WAL pairing, ~2–10× commit throughput); no `busy_timeout`/`cache_size`/`mmap_size`/`temp_store`. Statements are re-`prepare`d every call (`appendEntity:797`, `appendRelation:858`, `updateEntity:939`, `getRelationsFrom/To:1452/1473/1499`) — better-sqlite3 does not auto-cache. `appendEntity` maintains the cache via `findIndex` (`:823`), `appendRelation` likewise (`:876`) — O(N)/O(R) per append despite `NameIndex` existing, making bulk append O(N²). `EpisodicMemoryManager.recordEvent` appends per event (`src/agent/EpisodicMemoryManager.ts:160`) — the per-turn hot path.
- **Fix:** set the pragmas at init; hoist prepared statements to lazily-initialized fields; use `nameIndex.has()` + a relation-key set instead of `findIndex`.
- **Win:** large on write-heavy SQLite; compounds with S2. **Risk:** `synchronous=NORMAL` can lose the last commit on power loss (crash-safe otherwise) — document or gate behind a knob. **Effort:** low.

### S4. `GraphRankPrior` fully invalidates and recomputes PageRank on every write→read cycle
- **Evidence:** subscribes `invalidate` to all five entity/relation events **and** `graph:saved` (`src/search/GraphRankPrior.ts:106-121`); `invalidate()` drops the whole cache (`:186-192`); recompute runs a degree pass + `calculatePageRank` with up to 100 power iterations (`src/core/GraphTraversal.ts:694-698`). Because of S2, every mutation emits `graph:saved`, so interleaved write/search with a graph weight > 0 pays full O(iters·(V+E)) per cycle. (Default env = 0 → prior never built, zero cost — `ManagerContext.ts:470-475`.)
- **Fix:** (a) skip invalidation on `entity:updated` that touches no relation-affecting field (observation-only updates don't change connectivity); (b) debounce/TTL ("serve ≤5s-stale scores"); (c) maintain the degree map incrementally on relation events and serve degree-normalized scores between debounced PageRank refreshes — the fallback path already exists (`:264-273`).
- **Win:** large for write-heavy graph-enabled workloads. **Risk:** low (ranking prior, not correctness). **Effort:** low (a/b) to medium (c).

### S5. TF-IDF event sync is unwired, blind to batch mutations, and recomputes all-IDF per document on flush
- **Evidence:** `TFIDFEventSync` is exported but never constructed in `ManagerContext` (no non-test instantiation). When wired, it listens only to `entity:created/updated/deleted` (`src/search/TFIDFEventSync.ts:128-138`) while batch mutations emit only `graph:saved` (S2) → index silently stale, and `searchWithIndex` **skips** entities missing from the index (`RankedSearch.ts:230-232`) — invisible results, not just slow. `flushNow` applies ops one at a time and `addDocument`/`removeDocument` each call `recalculateAllIDF()` (`src/search/TFIDFIndexManager.ts:314, 348`) → O(B × vocabulary) per flush. `handleEntityUpdated` does `graph.entities.find` O(N) per event (`TFIDFEventSync.ts:294`).
- **Fix:** defer `recalculateAllIDF` to once per flush batch; subscribe to `graph:saved` with a debounced diff/rebuild; use `storage.getEntity` in the update handler.
- **Win:** correctness + O(vocab) per flush instead of per doc. **Effort:** low.

### S6. `clearAllSearchCaches()` on every write globally nukes all query caches
- **Evidence:** called in every mutation path (`SQLiteStorage.ts:772, 834, 885, 984`; `GraphStorage.ts:701, 929`) with no per-entity granularity. In mixed read/write agent loops the basic/fuzzy caches have ~0 hit rate and every search is a full O(N) rescan.
- **Fix:** generation-counter or per-entity-touched invalidation; at minimum, don't clear entity-text caches on relation-only writes.
- **Win:** medium. **Effort:** medium.

### S7. No `sideEffects: false` and no subpath exports — blocks all consumer tree-shaking
- **Evidence:** `package.json` `exports` has only `"."`; no `sideEffects` field. All 10 `src/*/index.ts` barrels are pure re-exports (only real module-scope side effect is the light `globalMemoryMonitor` singleton, `src/utils/MemoryMonitor.ts:410`). Root import runtime-loads **217 of 255** source files (from `dependency-graph.json` runtime edges).
- **Fix:** add `"sideEffects": false` (or an array excluding `MemoryMonitor.ts`) + subpath exports (`./core`, `./search`, `./agent`, `./types`, `./sqlite`).
- **Win:** large for bundling consumers; enables S8–S9 to matter. **Risk:** low — confirm nothing relies on the `MemoryMonitor` singleton for implicit registration. **Effort:** low.

### S8. chrono-node (heaviest external, 1.6s cold) eagerly loaded on every root/ManagerContext import
- **Evidence:** `src/index.ts:24` → `src/search/index.ts` exports `TemporalQueryParser`/`TemporalSearch`; `SearchManager.ts:12` imports it and `:76` constructs `new TemporalSearch(storage)`; `TemporalQueryParser.ts:10` does top-level `import * as chrono from 'chrono-node'`.
- **Fix:** lazy `await import('chrono-node')` — `TemporalSearch.searchByTimeQuery` (`SearchManager.ts:520`) is already async; parse call sites at `TemporalQueryParser.ts:193,221,225`.
- **Win:** removes the single heaviest external from the default import path. **Risk:** low. **Effort:** low.

### S9. better-sqlite3 native addon loads even for JSONL-only users
- **Evidence:** `src/core/index.ts:7` exports SQLiteStorage; `StorageFactory.ts:17` static-imports it (instantiated only at `:56` when type is sqlite); `SQLiteStorage.ts:23` top-level `import Database from 'better-sqlite3'`.
- **Impact:** load cost plus a hard failure mode — any ABI/prebuild mismatch breaks *all* users including JSONL ones (a documented CLAUDE.md gotcha).
- **Fix:** dynamic import inside `createStorage` gated on type; move the `SQLiteStorage` re-export to a `./sqlite` subpath.
- **Win:** JSONL users stop paying for (and stop being broken by) the native addon. **Risk:** moderate — `createStorageFromPath` becomes async or uses lazy `createRequire`. **Effort:** moderate.

### S10. `ManagerContext` imports the entire search barrel for three symbols; type layer isn't a leaf
- **Evidence:** `ManagerContext.ts:43` imports `{ SemanticSearch, createEmbeddingService, createVectorStore }` from the search barrel, pulling ~70 files (incl. chrono-node, workerpool). Concrete homes exist (`EmbeddingService.ts`, `VectorStore.ts`, `SemanticSearch.ts`). Separately, all 37 circular deps are **type-only** (zero runtime cost) but route through `src/types/` because the types layer imports implementation, e.g. `src/types/agent-memory.ts:12` imports from `../agent/ContextProfileManager.js`; `types/types.ts` (2,357 lines) and `types/agent-memory.ts` (2,252 lines) are the top test fan-in files, so implementation edits trigger wide `tsc`/IDE recompiles.
- **Fix:** narrow the ManagerContext import to concrete files (one line); relocate the ~5 leaked types into `src/types/` and add an ESLint `no-restricted-imports` rule so `src/types/**` cannot import implementation.
- **Win:** smaller default load graph + faster incremental typechecks. **Risk:** low (mechanical). **Effort:** low-moderate.

---

## Security

> Defensive review of the maintainer's own library. Labels: **VERIFIED-VULNERABLE** (exploitable as-is), **BY-DESIGN-RISK** (intentional but sharp edge), **NEEDS-DESIGN** (real gap, fix requires a decision), **VERIFIED-SAFE** (checked, no action).

### Sec1. Governance is documentation-only — advertised but wired into nothing *(highest severity)*
- **Evidence:** CLAUDE.md advertises `ctx.governanceManager` (line 82) and a `MEMORY_GOVERNANCE_ENABLED` env var, but **no `governanceManager` getter exists in `ManagerContext`** and `MEMORY_GOVERNANCE_ENABLED` is read nowhere in `src/` (only appears as a diag catalog string, `src/cli/commands/diag.ts:51`) — both independently confirmed. Policy checks live solely inside `GovernanceTransaction` (`src/features/GovernanceManager.ts:92,145,189`), reachable only if a caller manually builds a `GovernanceManager` and routes writes through `withTransaction`. Every real mutation path — `EntityManager` (incl. `renameEntity`), the reconstructive backing that appends straight to storage (`ManagerContext.ts:1160-1167`), all agent managers — writes with zero policy/audit.
- **Threat:** an operator who sets `MEMORY_GOVERNANCE_ENABLED=true` and a policy believes deletes are blocked/audited; nothing enforces it. **Label:** VERIFIED-VULNERABLE (integrity/compliance claim). **Fix:** either add a `ctx.governanceManager` getter that decorates `EntityManager` mutations when the env var is set, or correct CLAUDE.md/diag to state governance is manual opt-in. Enforcement point is NEEDS-DESIGN (event pre-hooks vs manager decoration).
- **Related bug:** `GovernanceManager.rollback` spreads the raw audit snapshot before the whitelist — `{...(target.before as Entity), ...pickEntityFields(target.before)}` (`:431-435,453-457`) — so every field from the (writable) audit file lands on the restored entity, defeating `pickEntityFields`' stated purpose. Fix: build from `pickEntityFields` output only.

### Sec2. RBAC is never enforced, defaults to allow-read, and has a default-role logic bug
- **Evidence:** `checkPermission` has zero call sites in `src/` — `RbacMiddleware` is only instantiated in the lazy getter `ManagerContext.ts:1084-1089` and exported. `ctx.rbacMiddleware` builds with no options → `defaultRole='reader'` (`src/agent/rbac/RbacMiddleware.ts:53-55`), so unregistered agents get read access. The default-role ternary flips on an unrelated option: passing `{ matrix }` without `defaultRole` makes unregistered agents **denied** instead of the documented `'reader'` (`:53-55` vs doc `:34-37`) — omission and explicit-`undefined` are indistinguishable; use `'defaultRole' in options`. The referenced `MEMORY_RBAC_DEFAULT_ROLE` env var exists nowhere. `DEFAULT_PERMISSION_MATRIX` itself is sound (monotonic, unknown-role → `[]`, `src/agent/rbac/PermissionMatrix.ts:31-56`) — VERIFIED-SAFE.
- **Label:** VERIFIED-VULNERABLE (High if relied upon; Med in practice). **Fix:** route RBAC through the same chokepoint as Sec1; fix the ternary; make default deny-by-default or document loudly.
- **Sidecar:** `RoleAssignmentStore` appends grants with no file `mode` (`RoleAssignmentStore.ts:132`) → world-readable (0644); corrupt lines silently dropped (`:56-58`) means a corrupted *revoke* fails open. Fix: `{ mode: 0o600 }` + surface a corrupt-line count.

### Sec3. `memory env` prints the plaintext OpenAI API key *(best fix value/effort in this half)*
- **Evidence:** `MEMORY_OPENAI_API_KEY` is in `ENV_VAR_CATALOG` (`src/cli/commands/diag.ts:44`) and the `env` command emits `value: process.env[spec.name]` verbatim with no masking (`:240-251`) — confirmed. The command is explicitly "pipe-friendly" triage output, exactly what users paste into issues/support.
- **Label:** VERIFIED-VULNERABLE (Med). **Fix:** mask secret-classified vars (`value: current ? '***set***' : null`) — one line. Elsewhere secrets hygiene is clean: `EmbeddingService` puts the key only in the Authorization header and error paths carry only HTTP status/body (`src/search/EmbeddingService.ts:219,240`); `QueryLogger` logs query text/timings only; the key is never persisted into the graph → exports can't embed it. VERIFIED-SAFE apart from this command.

### Sec4. `GovernanceManager` mutations skip the prototype-pollution guard every other path uses
- **Evidence:** `sanitizeObject()` (`src/utils/entityUtils.ts:625-672`) filters `__proto__`/`constructor`/`prototype` and is wired into `EntityManager.updateEntity:646`, `batchUpdate:824`, both storages, `TransactionManager`, `IOManager` import `:1180`, `SavedSearchManager:219`. But `GovernanceManager.updateEntity` does `Object.assign(existing, updates)` with **no** `sanitizeObject` (`src/features/GovernanceManager.ts:154`); `createEntity` stores raw likewise. So `governanceManager.updateEntity(name, JSON.parse(userInput))` pollutes `Object.prototype` — on the supposedly hardened path.
- **Label:** VERIFIED-VULNERABLE (Med). **Fix:** wrap with `sanitizeObject(updates)` for parity — one line. (Lower-severity DB-blob spreads at `PostgreSQLStorage.ts:273`, `SQLiteStorage.ts:576` are defense-in-depth only, since the source is the store's own JSON.)

### Sec5. Audit log "immutability" is convention-only; PII persists in it after deletion
- **Evidence:** append is plain `fs.appendFile` with no file `mode`, no `O_APPEND`-exclusive handle, no fsync (`src/features/AuditLog.ts:125`); no hash chain, signatures, or sequence numbers — any writer can rewrite/truncate/reorder undetectably, and malformed lines are skipped silently on read (`:230`). The exposed API *is* append-only (no delete/truncate method) and rollbacks append compensating entries, so the class is well-behaved — but the file-level tamper-evidence the docs imply isn't there. Separately, audit entries store full before/after entity snapshots, so PII removed from the graph (incl. via `SemanticForget`) persists forever in the audit sidecar, and `PiiRedactor` is never applied to it (GDPR-deletion conflict).
- **Label:** NEEDS-DESIGN (Med) + VERIFIED-VULNERABLE for the rollback raw-spread (folded into Sec1). **Fix:** per-entry `prevHash` SHA-256 chain, `{ mode: 0o600 }`, optional periodic anchor; document the trust boundary ("tamper-evident requires external log shipping"); offer redaction on snapshot capture.

### Sec6. `PiiRedactor` is fully unwired despite an "applied on export" claim
- **Evidence:** `PiiRedactor` self-describes as "Applied on export only" (`src/security/PiiRedactor.ts:10`) but has **zero call sites** — only exported from the barrel. `IOManager` export/backup, `StreamingExporter`, `ContextWindowManager` prompt formatting, and `AuditLog` snapshots all emit raw observations. The pattern bank itself is reasonable (conservative, replace-not-delete, `:33-68`). (Contrast: `ExclusionManager` *is* wired into `MemoryEngine.addTurn`, `src/agent/MemoryEngine.ts:45-51` — the write-side filter exists; the export-side one doesn't.)
- **Label:** NEEDS-DESIGN (Med). **Fix:** opt-in `redact: true` on `IOManager.exportGraph`/backup and on audit snapshot capture would make the claim true.

### Sec7. `UpdateEntitySchema.passthrough()` allows mass assignment of arbitrary/internal fields
- **Evidence:** `src/utils/schemas.ts:177` — `UpdateEntitySchema` ends in `.passthrough()` (unlike the `.strict()` create/relation schemas), so `EntityManager.updateEntity` (`:611`) validates known fields but admits arbitrary extra keys, which flow through `sanitizeObject` (strips only the 3 dangerous keys) into `Object.assign` — spoofing internal fields (`isLatest`, `supersededBy`, `version`) or injecting junk. `GovernanceManager.canUpdate` checks the *pre-merge* entity, so a policy can't veto on injected fields. Today the REST adapter wires only `POST /entities` (create, strict), so it isn't exposed there.
- **Label:** BY-DESIGN-RISK (Low-Med) — the `.passthrough()` is intentional for subclass fields (comment `:173-176`). **Fix:** switch to `.strip()` (drops unknowns, keeps validation) or maintain an allow-list of subclass fields.

### Sec8. Brotli/zlib decompression has no output-size cap (decompression bomb)
- **Evidence:** `decompress()` calls `brotliDecompressAsync` with no `maxOutputLength` (`src/utils/compressionUtil.ts:171-186`); same for `decompressFile` and the zlib adapter (`src/utils/compression/ICompressionAdapter.ts:100-128`). A crafted small `.jsonl.br` can expand to exhaust memory. Reachability is gated: `BackupManager.restore` decompresses only from the confined, symlink-rejected backup dir (`:216-221`), so an attacker must already write there or socially-engineer a restore.
- **Label:** NEEDS-DESIGN (Low). **Fix:** pass `{ maxOutputLength }` (brotli) / bounded zlib options, or stream-decompress with a running byte budget.

### Sec9. Unauthenticated REST surface; APIKeyStore built but not wired to it
- **Evidence:** `APIKeyStore` crypto is sound — SHA-256 of a 192-bit `randomBytes(24)` key (unsalted fast hash is correct for high-entropy keys), `crypto.timingSafeEqual` with length pre-check (`src/security/APIKeyStore.ts:96-97,143-145`), no key material in errors, `serialize()` emits hashes only — VERIFIED-SAFE. But it's advertised "for the REST adapter" while `src/adapters/RestRouter.ts` contains **zero** auth wiring: anyone mounting `withDefaults` routes gets an unauthenticated read/write HTTP surface. Also `revoke()`/`issue()` don't auto-persist, so a crash between revoke and persist resurrects the key on `load()`.
- **Label:** NEEDS-DESIGN (Med for the adapter gap). **Fix:** ship a reference auth middleware wiring `APIKeyStore.validate()` into `RestRouter`, or a loud doc warning; make revoke/issue persist or document the requirement.

### Sec10. Supply-chain / CI gaps (audit itself is clean)
- **Evidence:** `npm audit` = 0 vulnerabilities; no `postinstall`/`preinstall`/`prepare` scripts; `files` whitelist ships only `dist`/README/LICENSE — all VERIFIED-SAFE. Gaps: (A) CI and the **publish** job use `npm install`, not `npm ci`, with a stale comment claiming the lockfile is gitignored (it is tracked) — the published artifact isn't pinned to the reviewed lockfile; (B) the publish job has `id-token: write` but runs bare `npm publish` with no `--provenance` / `publishConfig.provenance`; (C) no `npm audit --audit-level=high` gate and no `tools:check-duplicates` gate in CI despite both being cheap.
- **Label:** Low-Med. **Fix:** `npm ci` in both jobs; add `--provenance`; add audit + duplicate gates next to the existing typecheck/lint/test/build steps.

---

## Suggested sequencing

**Safe quick wins (low risk, high value, mostly one-liners):** S1 (IDF hoist), S3 (SQLite pragmas + statement caching), S7 (`sideEffects`/subpath exports), S8 (lazy chrono-node), Sec3 (mask API key), Sec4 (`sanitizeObject` parity), Sec2 (RBAC ternary + sidecar mode), Sec10 (CI `npm ci` + gates).

**Structural (schedule deliberately):** S2 (delta persistence — the keystone; collapses S4/S5/S6 blast radius), S9 (lazy native addon), S10 (types-layer leaf + import narrowing), Sec1 (governance enforcement chokepoint), Sec5/Sec6/Sec9 (audit hash-chain, PII wiring, REST auth), Sec7 (`.strip()` decision).

**The single highest-leverage structural change is S2**, and the single highest-leverage security decision is **choosing one enforcement chokepoint** (EntityManager mutations or the storage event layer) and routing governance + RBAC + audit + optional PII redaction through it when the corresponding env vars are set — then adding one integration test per control claim in CLAUDE.md.

---

## Leads investigated and refuted (do not re-open)

- **`SQLiteStorage.loadGraph` materializes all rows per call** — REFUTED. It returns the in-memory `this.cache` after a one-time `loadCache()` at init (`SQLiteStorage.ts:630-633,501-529`); writes update the cache in place. Per-query `loadGraph()` calls are pointer returns. Real per-query cost is the O(N) scan over cached arrays (S1/S6).
- **`listEntities` unfiltered is an expensive copy** — REFUTED. It is `[...graph.entities]`, a shallow array-of-refs copy (`EntityManager.ts:466-467`); typed filter is O(k) via TypeIndex. (`WorldModelManager.getCurrentState` does map+sort all N per call — worth an event-invalidated cache only if called per turn on large graphs.)
- **37 runtime circular dependencies** — REFUTED. All 37 are type-only (`dependency-graph.json` `circularDependencies.runtime: []`); zero runtime cost. The real cost is `tsc`/IDE recompile fan-out (S10).
- **js-yaml eagerly loaded in the library** — REFUTED. js-yaml appears only under `tools/`, never in `src/`.
- **Levenshtein worker pool spawned per search** — REFUTED. Pool is lazily created once and reused warm (`FuzzySearch.ts:475-483`). Real micro-costs: per-search it structured-clones all candidate observations to workers instead of reusing the storage `lowercaseCache` (`:495-503`), and `WORKER_MIN_ENTITIES=500` may be below the clone/roundtrip crossover — both minor, benchmark before tuning.
- **SQL injection / path traversal / XXE / ReDoS** — VERIFIED-SAFE. FTS5 queries are sanitized *and* bound to `MATCH ?`; LIKE escapes `\%_` with `ESCAPE '\'`; backup paths are confined + symlink-rejected with re-validated derived `.meta.json` paths; GraphML/GEXF import is a regex parser with no DOCTYPE/entity engine and non-recursive decoding under 10MB/100k caps; user-derived regexes are `escapeRegExp`-wrapped and temporal digit runs are bounded `\d{1,6}` with an explicit anti-ReDoS comment. Evidence retained in the security-agent transcript.
