# Design: Dependency reduction

**Date:** 2026-11-10
**Status:** Proposed. This document is the spec. Implementation is later sprints, one PR each.
**Target version:** patch releases on 4.x (current package version 4.6.0) for Sprints 1–8. Sprint 9 is a major: `engines.node` becomes `>=22.16.0`. Daniel approved that major on 2026-11-10 (10:08 AM CT). The sprint may land the code and the engines field. The version number, tag, and publish wait until Daniel OKs the release. Daniel decided the chrono rebuild on 2026-11-10 (9:12 AM CT) and the KEEP-runtime rebuilds on 2026-11-10 (9:13 AM CT).
**Package:** `@danielsimonjr/memoryjs`
**Lockfile measured:** `bun.lock` lockfileVersion 2, 269 package entries, on master at the time of this spec.
**Out of scope for code:** this run writes only this spec and `docs/superpowers/plans/2026-11-10-dependency-reduction.md`. No merge, tag, release, or publish.

## Goal

Cut third-party packages MemoryJS installs and ships, without changing the public API, and without trading away correctness, security, or performance. Each later sprint is one small PR that replaces or reclassifies one dependency, with behavior-parity tests written against the old package before that package is removed.

## Non-goals

- Rewriting the test runner, the typechecker, the bundler, the linter, or the worker runtime.
- Reimplementing a package's whole surface when MemoryJS uses a subset. Sprints 5–9 rebuild that subset, each inspired by the original package, each with parity tests before the package is removed. Sprint 5 does not reimplement every chrono locale. Sprint 7 does not reimplement unused Zod methods.
- Vendoring large packages. No dependency in this inventory is both small enough and license-clean enough that copying the upstream source is better than a narrow in-repo replacement or than keeping the package.
- Changing `tools/*` packages. They are not part of the published `files` list (`dist`, `scripts/rebuild-native.mjs`, `README.md`, `LICENSE`).
- A major version inside Sprints 1–8. Public exports, CLI flag names, storage formats, and environment variables stay as they are. Sprint 9 is the approved major. Its break is `engines.node` moving from `>=22.12.0` to `>=22.16.0`. Publishing that major waits for Daniel.
- Running the published library or the CLI under Bun. Bun is the development toolchain. Node is the deployment runtime. There is no `bun:sqlite` adapter.

## Roles for later sprints

Each implementation sprint is one PR, executed subagent-driven, test-first:

| Role | Model |
|---|---|
| Builder | deepseek-v41-flash-1017 |
| Challenger | glm-5p3-flash |
| Build Reviewer | composer-2.5 |
| Build Checker/Fixer | grok-4.6 |
| Final PR reviewer | grok-4.7 |

The builder implements the sprint. The challenger tries to break the parity claim and leaves findings or failing tests. The build reviewer reads those findings, fixes the valid ones, and rebuts the invalid ones with written reasons on the PR. The build checker/fixer then checks everything in the PR against this spec and the plan and fixes all remaining issues, then hands the PR to the final PR reviewer. The final PR reviewer reports PASS or FAIL. The sprint merges only after that PASS and green CI. This planning run does not execute a sprint and does not merge.

## Decision vocabulary

| Decision | Meaning |
|---|---|
| REBUILD | Delete the dependency. Replace the calls MemoryJS actually makes with a small module in this repo. |
| VENDOR | Copy upstream source into the repo with its license and attribution. Not chosen for any package. |
| MAKE OPTIONAL | Move a runtime dependency to `peerDependencies` with `peerDependenciesMeta.*.optional: true`, and load it with the dynamic import that already exists. |
| KEEP | Leave the dependency. Removing it would hurt correctness, security, or performance, or the usage is the package's whole surface. |

## How the inventory was measured

- Direct dependencies are the `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `devDependencies`, and `overrides` keys in the root `package.json`.
- Call sites are imports under `src/`, `scripts/`, `tests/`, and `tsup.config.ts`.
- Transitive counts are the lockfile closure of each direct package key in `bun.lock` `packages` (the package plus every `dependencies` edge, not `optionalDependencies` of platform-specific esbuild binaries).
- Unpacked size is `dist.unpackedSize` from the npm registry for the version pinned in `bun.lock`, not the `latest` tag.
- Optional peers are not installed. `yaml`, `pg`, and `@huggingface/transformers` are not keys in `bun.lock` `packages`. The lockfile workspace block lists peer dependencies for `@huggingface/transformers` and `pg` only. `yaml` is in root `package.json` and is missing from that workspace block (lockfile drift). No sprint rewrites the lockfile to "fix" that drift unless `bun install` does it on its own. Bun does not install optional peers, so they add nothing to a default `bun install`.
- `node_modules` was not installed in the planning environment. Sizes are registry unpacked sizes, not a local `du`.

Runtime union of the eight `dependencies` entries: 15 lockfile packages. Dev union: 91. Overlap makes the full direct union 105 of the 269 lockfile entries. The rest are mostly `@esbuild/*` platform packages pulled by the `esbuild` override, counted inside the `tsup` / `tsx` closures only when that edge names `esbuild` itself.

## Downstream consumers

`package.json` `version` is `4.6.0`. A consumer ranged at `^4.5.0` receives patch and minor releases. Sprints 1–8 are patches when parity holds: they do not change exported names, types, CLI flags, or on-disk formats, so those consumers receive them and see the same behavior. Sprint 9 is the approved major that sets `engines.node` to `>=22.16.0`. Consumers on Node 22.12 through 22.15 stay on 4.x. The sprint does not set `package.json` `version`, tag, or publish. Daniel OKs that release separately.

Checked on 2026-11-10 against `github.com/danielsimonjr/episodic-memory` branch `main` at `b1b0d8e3330b46f05fef02020cd82549029a1a07` (`episodic-memory` 1.7.3, committed 2026-11-07). Current `package.json` `dependencies` do **not** include `@danielsimonjr/memoryjs`. A Recursa branch, `cursor/recursa-task0-memoryjs-dep-2f37` (package 1.7.1), did add `@danielsimonjr/memoryjs` `^4.5.0`. Main removed it in `6b5de905` ("chore: drop the @danielsimonjr/memoryjs dependency", PR #35, 2026-11-06) after PR #34 replaced the adapter with a native knowledge store. The only `src/` hit on main is a comment in `src/learn/knowledge-store.ts` about that previous adapter. Nothing imports the package.

That repo's own dependencies include `better-sqlite3` pinned to `13.0.3`, `zod` `^4.6.6`, and `@huggingface/transformers` `^4.2.0`. Those are separate installs. MemoryJS sprints must still assume other consumers on `^4.5.0` exist, and must not break the root export, the subpath exports, or the `memory` / `memoryjs` bins.

## Inventory and decisions

### Runtime dependencies

#### `async-mutex` @ 0.5.0 — REBUILD

| | |
|---|---|
| Unpacked size | 63,046 bytes |
| Lockfile closure | 2 (`async-mutex`, `tslib`) |
| License | MIT |
| Maintenance | Last publish 2024-03-11. The API MemoryJS uses has been stable for years. No deprecation flag. |
| What the code uses | `new Mutex()` and `mutex.runExclusive(fn)` only. |

Call sites:

- `src/core/GraphStorage.ts`
- `src/core/SQLiteStorage.ts`
- `src/core/RefIndex.ts`
- `src/core/columns/JsonlColumnStore.ts`
- `src/search/tiered/MapFileTier.ts` (and subclasses `DiskWarmTier`, `BrotliColdTier` via the inherited mutex)
- `src/agent/harness/InteractionLogBlobs.ts` (`sharedMutex`)
- `src/agent/harness/InteractionLog.ts` (type-only `import type { Mutex }`)
- `tests/unit/core/EntityManager.legacyDelete.test.ts`

`src/utils/AsyncMutex.ts` already exists and is the lock behind `graphMutex`. It is **not** a drop-in replacement. `AsyncMutex.acquire` rejects when the queue exceeds 1,000 waiters or when the head waiter exceeds 30 seconds. `async-mutex`'s `runExclusive` has no timeout and no queue cap. Storage writers depend on that. Sprint 4 adds a separate `RunExclusiveMutex` and does not route these call sites through `AsyncMutex`.

`RunExclusiveMutex` is not reentrant. A `runExclusive` callback that calls `runExclusive` on the same instance deadlocks. That matches `async-mutex` 0.5.0. None of the production call sites re-enter the same instance. Do not add `acquire`, `isLocked`, `cancel`, or a queue limit.

The reference plan chains `previous.then(async () => { ... })`; shipped code may use an async IIFE that `await`s `previous` instead. The Sprint 4 challenger harness treated both as equivalent to `async-mutex` 0.5.0 for ordering, release-on-throw, and microtask settle timing (pinned in `tests/unit/utils/RunExclusiveMutex*.test.ts`).

`tests/unit/core/EntityManager.legacyDelete.test.ts` is the exception. It does `graphMutex: new Mutex()`, and `EntityManager` calls `graphMutex.acquire()`, which `async-mutex`'s `Mutex` provides and `RunExclusiveMutex` must not. That test switches the fake to `new AsyncMutex()` from `src/utils/AsyncMutex.ts`. It does not construct `RunExclusiveMutex`.

`tslib` is in the `async-mutex` closure and is also a dependency of `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, and `@tybys/wasm-util`. Deleting `async-mutex` leaves `tslib` in the lockfile.

Consumers on `^4.5.0` do not import `async-mutex` through MemoryJS's public types. The class is not re-exported.

#### `chalk` @ 6.0.0 — REBUILD

| | |
|---|---|
| Unpacked size | 56,029 bytes |
| Lockfile closure | 1 |
| License | MIT |
| Maintenance | Actively published (6.0.1 exists). 6.0.0 is ESM-only, zero dependencies. |
| What the code uses | Default import in `src/cli/formatters.ts` and `src/cli/interactive.ts`: `chalk.cyan`, `chalk.bold`, `chalk.green`, `chalk.red`, `chalk.yellow`, `chalk.gray`. |

The library entries do not import `chalk`. It is still a runtime `dependencies` entry, so every consumer installs it. The CLI is bundled by tsup from `src/cli/index.ts`, so an in-repo helper is bundled into `dist/cli` and disappears from consumer installs.

Color behavior that must survive, matching chalk 6.0.0 (`supports-color` rules) except where this sprint's `NO_COLOR` contract overrides chalk (chalk 6 ignores `NO_COLOR`):

- A non-empty `NO_COLOR` disables color, and it wins over `FORCE_COLOR`. An empty `NO_COLOR` does not disable color.
- When `FORCE_COLOR` is absent, color is on only when `process.stdout.isTTY` is true.
- `FORCE_COLOR=0` and `FORCE_COLOR=false` disable. `FORCE_COLOR=1`, `2`, or `3` enable. An empty `FORCE_COLOR` and `FORCE_COLOR=true` enable (level 1). A pure digit string above 3 enables (chalk clamps to level 3). Whitespace-padded, comma-separated, fractional, and other non-digit `FORCE_COLOR` values are not numeric and fall back to TTY detection.
- SGR codes at level 1: bold `1` closed by `22`; red `31`, green `32`, yellow `33`, cyan `36`, gray `90`, each closed by `39`.

The parity test compares those strings to chalk while chalk is still installed. If chalk 6.0.0 disagrees, the helper changes, not the recorded expected strings.

#### `cli-table3` @ 0.6.5 — REBUILD

| | |
|---|---|
| Unpacked size | 46,198 bytes |
| Lockfile closure | 6, via `string-width` ^4.2.0 |
| License | MIT |
| Maintenance | Last publish 2024-05-12. The string-width 4 line is the old Unicode-width stack. |
| What the code uses | `src/cli/formatters.ts` only: `new Table({ head, colWidths, wordWrap: true })`, `table.push(cells)`, `table.toString()`. `wordWrap: true` is set on the entity table and the search-results table. The relation table and the centrality table set `head` and `colWidths` only. |

A general Unicode table would be a second `cli-table3`. The replacement covers this option subset. `colWidths` keep cli-table3's meaning: each number is the full column width, including the default one-space padding on each side, so the content width is `max(1, colWidth - 2)`. `calculateColWidths` already budgets those widths against the terminal. Treating `colWidths` as content width and then adding padding makes the table wider than the terminal the ratios were computed for.

Width measurement strips ANSI (`CSI … m`) and then uses the same rules as `string-width` 4 for the characters the CLI can print: a fullwidth code point is 2, an emoji presentation is 2, a combining mark is 0, everything else is 1. `String.length` is not the width. When `wordWrap` is true, wrap on whitespace, and hard-break a single token that is wider than the content width. When `wordWrap` is omitted, do not wrap. ANSI in headers must not inflate the width. Header text is short. Body cells are not colored today. Do not implement `colSpan`, `rowSpan`, `style`, `chars` overrides, or streaming.

JSON and CSV formatters must stay byte-identical. Tests pin the table cases MemoryJS renders rather than the whole `cli-table3` matrix. Borders may differ in glyph choice from cli-table3. Daniel approved that difference on 2026-11-10 (10:08 AM CT). It ships in the Sprint 3 patch. It is not an open decision.

#### `chrono-node` @ 2.9.1 — REBUILD (Sprint 5)

| | |
|---|---|
| Unpacked size | 3,505,885 bytes |
| Lockfile closure | 1 (the package bundles its parser) |
| License | MIT |
| Maintenance | Actively published (2.10.3 exists; lockfile pins 2.9.1). |
| What the code uses | The only import is `src/search/TemporalQueryParser.ts`. It dynamic-imports `chrono-node` and falls back to a synchronous `createRequire`. Symbols used: `parse`, `parseDate`, result `.start.date()`, `.end.date()`, option `{ forwardDate: false }` then a retry with `{ forwardDate: true }`. |

Call sites that do not import the package, and that Sprint 5 updates only when a comment names it:

- `src/search/TemporalSearch.ts` calls `parseTemporalExpressionAsync`.
- `src/search/SearchManager.ts` `searchByTime` documents chrono in a comment.
- `src/core/context/SearchFacade.ts` documents chrono in a comment.

`parseCustomPattern` already handles these phrases without chrono: `in the past N <unit>`, `past N <unit>`, `last N <unit>`, `last|past hour|week|month|year` (optional leading `the`), `this week`, `this month`, `this year`, `today`, `yesterday`, and `N <unit> ago`. Units are second, minute, hour, day, week, month, year. `since <date>` calls `parseDate` and then uses the reference instant as the end. Everything else goes to `parseWithChrono`, including `between Monday and Wednesday` and `Jan 1 to Jan 7`. A single chrono result becomes a range with the reference date. Two or more results use the first start and the last start. Text chrono cannot parse returns `undefined`. A throw from the loader or from `parse` / `parseDate` still throws. Sprint 5 must not turn a throw into `undefined`.

Daniel decided on 2026-11-10 (9:12 AM CT) to rebuild this instead of making the package optional. The replacement is an in-repo English parser organized as chrono-node is organized: small parsers plus refiners, covering casual, relative, and absolute forms. Scope is every phrase MemoryJS accepts today, plus the common English casual, relative, and ISO forms chrono parses (`tomorrow`, `tonight`, `noon`, `next Friday`, `3 days from now`, `2026-01-15`, `2026-01-15T12:00:00Z`, month-name dates, and weekday ranges). It is not a port of every chrono locale.

Parity has two oracles, both at reference `2026-01-15T12:00:00.000Z` with `TZ=UTC`:

- Phrases `parseCustomPattern` already handles are pinned to today's `TemporalQueryParser` start and end instants. They are not compared to chrono. Those patterns exist because chrono does not produce the ranges MemoryJS returns (`this week`, `last hour`, `N units ago`, and the rest of the list above).
- Phrases that reach `parseWithChrono` or `parseDate` (`since`, `between` / `to`, casual, relative, ISO, month-name) are compared to chrono-node 2.9.1, including `{ forwardDate: false }`, the forward retry, the single-result end (the reference instant when chrono has no end), and the first-start to last-start span when chrono returns two or more results. Text chrono returns no result for stays `undefined`. A throw from `parse` or `parseDate` still throws.

The dependency stays in `dependencies` until both oracles are green. Then it is deleted from `dependencies` and from `devDependencies`, and the green ISO strings are recorded so later runs do not need the package. `parseEnDate` stays an internal module. It is not added to a package barrel. `chrono-node` is MIT. Original code needs no copied license. If a pattern table or a snippet is adapted from chrono, that file and `THIRD_PARTY_NOTICES` keep the chrono copyright and the MIT license text.

Semver is a patch when those oracles hold. No type signature changes. No optional peer. No 5.0.0. A new public export would be a minor and is out of this sprint.

**Intentional deviations (recorded 2026-11-10, Sprint 5 implementation).** Both follow from doing all calendar math in UTC (`Date.UTC` / `getUTC*`, no `Intl` zone names), which this sprint's scope requires. Neither changes what the parity corpus asserts at `TZ=UTC`, and neither changes the instants MemoryJS returns for the custom patterns.

- **Host timezone.** chrono-node resolves wall-clock fields in the host timezone (`new Date(year, month-1, day, ...)` plus `getTimezoneOffset()`), so the same phrase yields different instants under different host `TZ`. The in-repo parser resolves in UTC, so a phrase yields the same instant on every host. Before this sprint, every CI lane and the shipped default already ran the parser at `TZ=UTC` for the corpus; after it, results are stable regardless. Frozen expectations were recorded at `TZ=UTC`, and Vitest pins `TZ=UTC`.
- **Zone abbreviations.** chrono-node maps a trailing abbreviation (`5pm EST`) through `TIMEZONE_ABBR_MAP`, whose daylight-saving rules for `CET`, `CT`, `ET`, `MT`, and `PT` are evaluated in local time. The in-repo parser keeps the same table but evaluates the DST windows in UTC, so a zone-abbreviation phrase can differ from chrono by the size of a local-time DST boundary shift. MemoryJS relies on no zone-abbreviation phrase; they are supported because chrono parsed them.

The dependency is deleted from `dependencies` only after both oracles are green (and it was never added to `devDependencies`). The green ISO strings are recorded in the two test files so later runs do not need the package. `parseEnDate` stays an internal module and is not added to a package barrel. Weekday, month, unit, ordinal, timezone, and parser-expression tables were adapted from `chrono-node` (MIT), so `THIRD_PARTY_NOTICES` carries its copyright and license text and each adapted file names the origin.

#### `commander` @ 15.0.0 — REBUILD (Sprint 6)

| | |
|---|---|
| Unpacked size | 207,368 bytes |
| Lockfile closure | 1 |
| License | MIT |
| Maintenance | 15.1.0 published 2026-11-09. Lockfile pins 15.0.0. Healthy. |
| What the code uses | `Command` across `src/cli/index.ts` and `src/cli/commands/*.ts`. Also `Option` (`audit.ts`, `io.ts`) and `InvalidArgumentError` (`maintenance.ts`, message `Expected a finite number`). Tests in `tests/unit/cli/` construct `Command` directly. Methods actually called: `command`, `option` (short/long flags, descriptions, defaults, variadic `<tags...>`, and argument parsers `parseInt` / `parseFloat` / custom), `addOption`, `choices`, `requiredOption`, `argument` is not used, `action`, `alias` (`maintenance.ts` `.alias('i')`), `name`, `description`, `version` (including the custom flags `'-v, --version'`), `parse`, `parseAsync(args, { from: 'user' })` (`src/cli/index.ts` pipe mode), `opts`, `exitOverride`, `help`. `optsWithGlobals` is not called. |

Sprint 6 replaces this with an in-repo parser that covers every command, option, help string, and error behavior those files use. Help text is pinned by snapshot tests against commander 15.0.0 before the dependency is removed, including root `--help`, every registered subcommand `--help`, and one pipe-mode `parseAsync` line. The replacement is inspired by commander's command tree. It does not implement unused commander features. MIT notice if any commander text is adapted. Semver is a patch when every help snapshot matches and `InvalidArgumentError` keeps that message. Stop for Daniel if a snapshot cannot match. Do not ship different help as a silent patch. Risk is lower than Sprints 7–9 because a mismatch is visible CLI text, not stored data.

#### `zod` @ 4.6.7 — REBUILD (Sprint 7)

| | |
|---|---|
| Unpacked size | 6,148,944 bytes |
| Lockfile closure | 1 (4.6.7 is pinned; `package.json` says `^4.6.6`) |
| License | MIT |
| Maintenance | Active. 4.6.7 published 2026-10-12. |
| What the code uses | Confirmed in `src/` on 2026-11-10: `z.object`, `z.array`, `z.string`, `z.string().regex`, `z.number`, `z.boolean`, `z.enum`, `z.literal`, `z.null`, `z.record` (two-argument key and value schemas), `z.union`, `z.discriminatedUnion`, `z.tuple`, `z.unknown`, `z.iso.datetime`, `z.ZodType`, `z.output`, `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })` in `src/adapters/recursaToolSupport.ts`, `.strict()`, `.optional()`, `.nullable()`, `.min()`, `.max()`, `.int()`, `.finite()`, `.refine()`, `.safeParse()`, `z.infer`. Also `ZodSchema` and `ZodError` in `src/utils/schemas.ts`. The sprint's first task re-greps `src/` and adds any method that grep finds and this list missed. It does not add methods the grep does not find. |

Production call sites include `src/utils/schemas.ts` (entity, relation, import, and search schemas used by `EntityManager`, `RelationManager`, and `IOManager`), `src/adapters/recursaToolSchemas.ts`, `src/adapters/recursaToolSupport.ts`, `src/adapters/RecursaToolAdapter.ts`, `src/agent/procedural/graph/ProceduralGraphSchemas.ts`, `src/agent/evaluation/LLMRubricJudge.ts`, `src/agent/learning/{Diagnoser,KnowledgeEditor,RevisionReconcile,revisionMergeShared}.ts` (`RevisionMerger.ts` is type-only), and `src/agent/bootstrap/{ExplorationNotes,PracticeTaskGenerator}.ts`.

`src/utils/index.ts` re-exports the schemas, the `z.infer` type aliases (`EntityInput`, `CreateEntityInput`, and the rest of that block), and `formatZodErrors(error: ZodError)`. Those aliases must still infer the same fields. Error text and issue shape that reach users or MCP tools (`invalid_args` from `safeParse`, including `.strict()` unknown keys and a reserved-key `.refine()`) must match Zod 4.6.7. `z.toJSONSchema` output that the Recursa adapter publishes must match for the same schemas. MIT notice if any Zod source is adapted. Semver is a patch when that parity holds and no public field is added or removed. `episodic-memory` depends on `zod` itself; MemoryJS's copy does not satisfy that dependency, and removing MemoryJS's copy does not remove theirs.

#### `better-sqlite3` @ 13.0.3 — REBUILD (Sprint 9, approved major)

| | |
|---|---|
| Unpacked size | 27,302,969 bytes (prebuilds for every platform) |
| Lockfile closure | 2 (`better-sqlite3`, `node-addon-api`) |
| License | MIT |
| Maintenance | 13.0.3 published 2026-08-05. Native addon. `postinstall` runs `scripts/rebuild-native.mjs`. |
| What the code uses | Runtime `require('better-sqlite3')` inside `src/core/SQLiteStorage.ts` `resolveSQLiteDatabaseCtor`, with a `node:sqlite` fallback in `src/core/nodeSqliteAdapter.ts`. Type imports in `SQLiteStorage.ts` and `src/search/PartialIndexAdvisor.ts`. `src/cli/commands/doctor.ts` requires it for the ABI check. `scripts/node-runtime-smoke.mjs` requires it. `tsup.config.ts` externalizes it on both the library and the CLI pipelines. Tests open real databases. |

`nodeSqliteAdapter.ts` already maps `exec`, `prepare` (`run` / `get` / `all`), `pragma` (including `{ simple: true }` as the first column of the first row), `transaction`, and `close`. It normalizes bigint `changes` to a number. Its transactions are not nestable (no SAVEPOINT). `SQLiteStorage` does not nest them. `SqliteProceduralGraphBacking` uses `resolveSQLiteDatabaseCtor()`, so it follows the same driver. `PartialIndexAdvisor.ts` only type-imports `better-sqlite3`.

`node:sqlite` facts, checked against Node release notes:

- Added in Node 22.5.0 behind `--experimental-sqlite`.
- Unflagged in Node 22.13.0 (`nodejs/node#55890`). The module stayed experimental. Today's `engines.node` of `>=22.12.0` still allows Node 22.12.0, which does not load `node:sqlite` unless the process was started with that flag. Sprint 9 removes that range.
- FTS5 arrived in Node 22.16.0 with `nodejs/node#57621` (`sqlite: enable common flags`). Node 22.13.0 through 22.15.x open the module with no flag and still throw `no such module: fts5` on `SQLiteStorage`'s virtual table. `src/core/SQLiteStorage.ts` `explainMissingFts5` already says this.
- `PRAGMA journal_mode = WAL` is ordinary SQLite, not a separate compile flag. The probe still runs it, plus the `synchronous` pragma `SQLiteStorage` sets. A passing WAL pragma does not prove FTS5.

Daniel approved this replacement on 2026-11-10 (10:08 AM CT). It is not gated. The sprint sets `engines.node` to `>=22.16.0` in the same PR that deletes the native module. That engines change is why the release is a major. The sprint does not change `package.json` `version`, does not tag, and does not publish. Daniel OKs the release that ships the major.

The CI matrix (`typescript.yml`, job `ci`) is Ubuntu, macOS, and Windows, with `node-version` `22` and `24`. `22` means the newest 22, which in November 2026 is past 22.16, but the alias does not pin the floor. Sprint 9 changes the Node 22 leg to `22.16` (lowest version that has unflagged `node:sqlite` and FTS5) and keeps Node 24. The job name is the branch-protection context (`ci (${{ matrix.os }}, ${{ matrix.node }})`). Moving `22` to `22.16` renames those three checks. The sprint calls that out so protection can be updated. It does not add a Bun-runtime job.

Tests load `node:sqlite` only in the Node lane (`bun run test:ci`, which starts with `node -e`). They skip only when `typeof Bun !== 'undefined'`. The Ubuntu Node 24 step that sets `MEMORY_SQLITE_DRIVER=node` stays until the native module is gone. After removal, `MEMORY_SQLITE_DRIVER=node` is the only driver, and that step still runs the suite on Node.

The sprint switches the default constructor to `createNodeSqliteDatabaseCtor()`, benchmarks it, updates `doctor.ts` (the ABI check must not require the removed addon), `scripts/node-runtime-smoke.mjs` (it `require`s `better-sqlite3` today), both `external: ['better-sqlite3']` entries in `tsup.config.ts`, and `scripts/rebuild-native.mjs`, and deletes the dependency only after parity tests are green. `tools/migrate-from-jsonl-to-sqlite` keeps its own `better-sqlite3` and is out of scope. `episodic-memory` pins `better-sqlite3@13.0.3` on its own. MIT notice if any better-sqlite3 text is adapted. `@types/better-sqlite3` leaves with the runtime package.

#### `@danielsimonjr/workerpool` @ 10.2.0 — REBUILD (Sprint 8)

| | |
|---|---|
| Unpacked size | 3,142,636 bytes |
| Lockfile closure | 1 |
| License | Apache-2.0 |
| Maintenance | First-party. 10.2.2 exists on npm; lockfile pins 10.2.0. Published 2026-09-19 for 10.2.x. |
| What the code uses | `workerpool.cpus`, `workerpool.pool(path, options)`, `workerpool.pool(options)` with no script (`WorkerPoolManager` when `workerPath` is absent), `pool.exec(method, args)` then `.timeout()` and `.cancel()` on the returned promise (`WorkerTaskManager` also reads `pending`), `pool.stats()`, `pool.terminate(force)` and `pool.terminate()` with no argument (`FuzzySearch`), `workerpool.worker({...})`. Options the call sites pass: `maxWorkers`, `workerType: 'thread'`, and `workerThreadOpts: { type: 'module' }`. `WorkerPoolConfig.workerType` also allows `'process'`. `tests/unit/workers/WorkerPool.test.ts` calls `pool()`, `stats()`, and `terminate(true)`. |

Call sites: `src/utils/WorkerPoolManager.ts`, `src/utils/WorkerTaskManager.ts`, `src/search/FuzzySearch.ts`, `src/workers/levenshteinWorker.ts`. `parallelUtils.ts` and `taskScheduler.ts` mention workerpool in comments only.

Sprint 8 replaces that subset with a thin pool on `node:worker_threads`. The same names and the options above stay, including `workerType: 'process'` because `WorkerPoolConfig` already exposes it. Dropping process mode would change a public TypeScript field. Parity tests drive the installed pool and the new pool on the Levenshtein worker (equal results, `timeout`, `cancel`, `terminate(true)`, and `terminate()`), and they cover `pool()` with no script plus `workerThreadOpts` for the ESM worker. The Apache-2.0 notice, including any upstream NOTICE text, goes in `THIRD_PARTY_NOTICES` if any workerpool source is copied. A clean-room implementation needs no notice. Semver is a patch when the public TypeScript surface does not change and the fuzzy-search results match. This sprint is after Zod because a wrong pool drops throughput, while a wrong schema can store bad data, and both are after the CLI parser.

### Optional peer dependencies

All three stay optional peers. No sprint rebuilds them. Each one is a large spec or runtime that is already absent from a default install. Rebuilding it would copy that weight into the repo for a feature most consumers never turn on.

#### `@huggingface/transformers` ^4.3.1 — KEEP

Dynamic `import('@huggingface/transformers')` in `src/search/EmbeddingService.ts` (`pipeline` of the feature-extraction task, q8). Absent peer: local embeddings fail with an install hint; lexical search still works. Unpacked size of 4.3.2 (registry latest matching the range, not locked) is about 10 MB, plus model files downloaded at runtime, which are not part of the package. Apache-2.0. The model runtime and the ONNX stack are the reason it stays optional and is not rebuilt. `episodic-memory` depends on `^4.2.0` itself.

#### `pg` >=8.0.0 — KEEP

`src/core/PostgreSQLStorage.ts` dynamic-imports `pg` and uses `Pool`. The storage is not the default (`MEMORY_STORAGE_TYPE` defaults to jsonl). Registry unpacked size of 8.23.1 is 102,632 bytes. MIT. The wire protocol and the server-specific type codecs are the reason it stays optional and is not rebuilt. Consumers who enable Postgres install `pg`. MemoryJS must not bundle it.

#### `yaml` >=2.0.0 — KEEP

`src/agent/skills/SkillFormat.ts` uses `yaml.parse` on skill front matter when the peer is installed. Without it, front matter accepts JSON values only (the error string in that file says so). `SkillPublisher.ts` calls `loadOptionalYaml()`. ISC license. Registry unpacked size of 2.9.1 is 686,297 bytes. The YAML 1.2 grammar is the reason it stays optional and is not rebuilt. The peer is absent from `bun.lock` because it is optional and not installed. That is expected.

### devDependencies

| Package | Locked | Unpacked | Closure | Decision | Why |
|---|---|---|---|---|---|
| `rimraf` | 6.1.4 | 262,867 | 10 (`glob`, `package-json-from-dist`, …) | REBUILD | Used only as `rimraf dist` in the `clean` script. Node 22 `fs.rm(path, { recursive: true, force: true })` is the same operation. BlueOak-1.0.0. Actively published, but the transitive glob chain is the reason it was bumped (CHANGELOG notes GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249 via glob/minimatch). Deleting it removes that chain from the dev install. |
| `@types/better-sqlite3` | 9.6.0 | (types) | 3 with `@types/node` | KEEP until Sprint 9 completes | Compiling `SQLiteStorage` needs the types while the native module stays. Sprint 9 removes it with `better-sqlite3` if the `node:sqlite` path is accepted. |
| `@types/node` | 26.4.0 | (types) | 2 (`undici-types`) | KEEP | The types are the Node API. Sprint 9 raises `engines.node` to `>=22.16.0`. |
| `typescript` | 7.0.2 | 2,497,498 | 1 | KEEP | `typecheck` is `tsc --noEmit && tsc --noEmit -p tsconfig.probes.json`. TS 7 has no programmatic compiler API (`scripts/emit-dts.mjs` exists because of that). Replacing the compiler is not a dependency-diet task. Apache-2.0. |
| `tsup` | 8.5.1 | 389,734 | 45 | KEEP | `build` is `tsup && node scripts/emit-dts.mjs && node scripts/check-exports.mjs`. The config has three pipelines (ESM split library, CJS library, CLI banner, workers). Replacing tsup rewrites the publishable bundle. MIT. |
| `tsx` | 4.23.1 | (closure 2, via `esbuild`) | 2 | KEEP | `benchmark` and `audit:plans` run `tsx`. One transitive. Not published. |
| `vitest` | 5.0.5 | 2,878,460 | 23 | KEEP | `test` / `test:ci`. Replacing the runner touches every test file. |
| `@vitest/coverage-v8` | 5.0.5 | 30,103 | 20 | KEEP | `test:coverage` only. Tied to the vitest major. |
| `oxlint` | 1.82.0 | 2,436,426 | 1 | KEEP | `lint` is `oxlint --type-aware src` plus `scripts/check-lint-rules.mjs`. |
| `oxlint-tsgolint` | 7.0.2001 | 16,008 | 1 | KEEP | Type-aware oxlint companion. `package.json` does not import it; oxlint resolves it. Removing it drops type-aware rules. |
| `oxc-parser` | 0.150.0 | 2,912,429 | 2 | KEEP | `scripts/lint-rules.mjs` calls `parseSync` to enforce the two project rules (types layer is a leaf, `storage.updateEntity()` results are not discarded). The script is part of `bun run lint`. |

`lint:fix` still calls `eslint`, and `eslint` is **not** a dependency. That script is already broken relative to this `package.json`. Fixing it is not a reduction sprint. Do not add `eslint` back.

### Overrides and native extras

- `overrides.esbuild: ^0.28.1` — KEEP. It forces the esbuild that `tsup` and `tsx` load. It is a security pin, not a feature dependency. Sprints must not delete it when they edit `package.json`.
- Native addon: `better-sqlite3` is the only native runtime dependency. `scripts/rebuild-native.mjs` lists `NATIVE = ['better-sqlite3']`. Optional peers do not ship native code of their own inside MemoryJS (`@huggingface/transformers` downloads ONNX runtimes when the consumer installs it). Only Sprint 9 may remove the native addon from that list, and only after the gate passes. The devDependency toolchain stays: it is not shipped.

### Tool packages (not published, no sprint)

| Package | Dependencies | devDependencies |
|---|---|---|
| `tools/chunking-for-files` | none | `@types/node`, `@yao-pkg/pkg`, `typescript` |
| `tools/compress-for-context` | none | same shape |
| `tools/create-dependency-graph` | `js-yaml` ^4.3.2 | `@types/js-yaml`, `@types/node`, `@yao-pkg/pkg`, `typescript` |
| `tools/migrate-from-jsonl-to-sqlite` | `better-sqlite3` ^13.0.3 | `@types/better-sqlite3`, `@types/node`, `@yao-pkg/pkg`, `typescript` |

`bun run tools:install` uses npm in those directories. They keep their own `package-lock.json`. Leave them alone so a MemoryJS sprint cannot break the migration tool's SQLite build.

## Approaches considered

1. **Keep every runtime dependency.** Zero risk, zero reduction. Rejected. `rimraf`, `chalk`, `async-mutex`, and `cli-table3` are small, narrow, and not part of the library contract.
2. **Vendor the large packages (zod, chrono-node, workerpool, better-sqlite3).** Copies their bugs and licenses into the repo and keeps the bytes. Rejected for every package.
3. **Rebuild the narrow call sites, then the remaining runtime dependencies one sprint at a time.** Chosen. Order is smallest and safest first through Sprint 5, then commander, Zod, workerpool, and `node:sqlite` as an approved major. Optional peers and the dev toolchain stay.

## Sprint order

| Sprint | Package | Decision | Risk | Semver |
|---|---|---|---|---|
| 1 | `rimraf` | REBUILD | Dev script only. `dist/` delete. | none (devDependency) |
| 2 | `chalk` | REBUILD | CLI colors. Library API untouched. | patch |
| 3 | `cli-table3` | REBUILD | CLI table text only. JSON/CSV identical. Border glyphs may differ. Daniel approved that on 2026-11-10 (10:08 AM CT). | patch |
| 4 | `async-mutex` | REBUILD | In-process write serialization. Parity with no timeout and no reentrancy. | patch |
| 5 | `chrono-node` | REBUILD | English date parser. Custom phrases pinned to today's parser. Fallback phrases pinned to chrono-node 2.9.1. Not gated. | patch when both oracles hold |
| 6 | `commander` | REBUILD | CLI parse, help, pipe-mode `parseAsync`, and `InvalidArgumentError`. Lowest risk of the runtime rebuilds. | patch when help snapshots match |
| 7 | `zod` | REBUILD | Schema subset (including `toJSONSchema`, `discriminatedUnion`, `iso.datetime`), inferred types, and surfaced error shape. Higher risk than the CLI. | patch when parity holds |
| 8 | `@danielsimonjr/workerpool` | REBUILD | `node:worker_threads` pool for the used API subset, including `workerType: 'process'`. | patch when results match |
| 9 | `better-sqlite3` | REBUILD, approved | `node:sqlite` on Node, `engines.node` `>=22.16.0`. CI Node leg pinned to 22.16. Tests run in the Node lane. Publish waits for Daniel. | major. The sprint does not set `version`, tag, or publish |

KEEP packages have no sprint.

## Global constraints

These lines are binding on every sprint. The plan repeats them.

- Node production runtime remains `>=22.12.0` until Sprint 9, which sets `engines.node` to `>=22.16.0`. Bun remains `>=1.4.2` and `packageManager` remains `bun@1.4.2`. Bun installs, runs scripts, and drives CI. The published `dist/` and the CLI run on Node. They are not required to run inside the Bun runtime.
- Daniel decided on 2026-11-10 (9:59 AM CT) that every sprint keeps the Bun dev workflow green: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, and `bun run build`. What CI actually runs is recorded under "Dev toolchain and the Node test lane" below. A sprint does not add a Bun-runtime matrix.
- `bun.lock` is the lockfile that changes. Do not add a root `package-lock.json`.
- Public exports in `package.json` `exports` stay. No exported TypeScript name is removed or retyped.
- `overrides.esbuild` stays `^0.28.1`.
- `better-sqlite3` stays external in both `tsup.config.ts` pipelines until Sprint 9 deletes it. That sprint drops both `external` entries.
- Storage file formats, SQLite schema, and environment-variable names stay.
- Each sprint is one PR. The builder is deepseek-v41-flash-1017. The challenger is glm-5p3-flash. The build reviewer is composer-2.5. The build checker/fixer is grok-4.6. The final PR reviewer is grok-4.7. The build reviewer reconciles the challenger's findings, then the build checker/fixer checks the whole PR against the plan and fixes every remaining issue, then the final PR reviewer runs. Merge only after the final PR reviewer reports PASS and CI is green.
- Tests that describe the old dependency's behavior land in the same PR as the removal, and they are written to fail before the new module exists.
- Verification for every sprint: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`, `node scripts/check-exports.mjs` (already inside `build`), and `git diff --stat` on `dist/` only after a local build to see the bundle change. Do not commit `dist/`.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` and `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` must exit 0 when a sprint adds an exported symbol. New exports need a JSDoc block whose first sentence says what the function does.
- No force-push, rebase, amend, or `--no-verify`. No publish.

## Dev toolchain and the Node test lane

Daniel decided on 2026-11-10 (9:59 AM CT): Bun is how the repo is developed. Node is what ships.

Checked against `.github/workflows/typescript.yml` and `package.json` on 2026-11-10:

- Job `ci` is a matrix of Ubuntu, macOS, and Windows, and Node 22 and Node 24. Each leg also installs Bun 1.4.2. Install is `bun install --frozen-lockfile`. Typecheck, lint, test, and build are `bun run typecheck`, `bun run lint`, `bun run test:ci`, and `bun run build`.
- `test:ci` is not `bun test`. The script is `node -e` which sets `IGNORE_UNHANDLED_REJECTIONS` and then `child_process.execSync('vitest run --exclude=tests/performance/**')`. `bun run test:ci` therefore starts Node, and Vitest's workers are Node children. `vitest.config.ts` sets `environment: 'node'`. That is the Node test lane. `node:sqlite` can load there when the `node` on `PATH` is new enough.
- `scripts.test` is `vitest run` with no `node` prefix. `bun run test` may execute that bin inside Bun. Sprints must not move `test:ci` onto `bun --bun` or `bun test`.
- One extra step, Ubuntu and Node 24 only, re-runs `bun run test:ci` with `MEMORY_SQLITE_DRIVER=node`. That is already the Node lane for the built-in driver. A later step runs `node scripts/node-runtime-smoke.mjs` on the built CJS bundle. CI does not execute the suite inside Bun, and this design does not add that job.
- `node:sqlite` is absent in Bun. Sprint 9 does not add `bun:sqlite`. Probe and parity tests for `node:sqlite` run in the Node lane (`bun run test:ci` and the Ubuntu Node 24 step). A test file may skip only when `typeof Bun !== 'undefined'` (Vitest hosted by Bun, where `node:sqlite` cannot load). The Node lane must not skip. CI covers that lane on Node 22 and Node 24 today, and the driver step covers `MEMORY_SQLITE_DRIVER=node` on Node 24.

Per-sprint audit for the Bun dev workflow. None of these require the published code to run under Bun.

| Sprint | Node-only API? | Dev-workflow note |
|---|---|---|
| 1 `rimraf` | `node:fs/promises` `rm` inside `scripts/clean-dist.mjs`, invoked as `node scripts/clean-dist.mjs` | `bun run clean` needs `node` on `PATH`. CI installs Node before Bun. `fs.rm({ recursive: true, force: true })` is the Node 22 call. In-flight PR #292 already uses that shape. No Bun-runtime change. |
| 2 `chalk` | No. The helper reads `NO_COLOR` and `FORCE_COLOR` and `process.stdout.isTTY` | Same env checks on the Node test lane. Empty `NO_COLOR` does not disable color. A non-empty `NO_COLOR` wins over `FORCE_COLOR`. |
| 3 `cli-table3` | No. Width is a pure function | Do not call `Bun.stringWidth`. The fixtures run in the Node lane and must match the recorded `string-width` 4 cases. |
| 4 `async-mutex` | No. Promise FIFO | No `node:async_hooks`. The queue behaves the same in the Node test lane. |
| 5 date parser | No, if it keeps `Date.UTC` and `getUTC*` | Tests launch with `TZ=UTC`. Do not use `Intl` timezone names. Local getters are not the oracle. |
| 6 `commander` | `process.argv` and `process.exit` in the shipped CLI, which is Node | Tests call `parse` / `parseAsync` with an explicit argv and `{ from: 'user' }`. `exitOverride` throws. They do not depend on Bun's argv. |
| 7 `zod` | No. Pure functions | `safeParse`, `z.infer`, and `toJSONSchema` run in the Node lane. |
| 8 worker pool | `node:worker_threads` and, for `workerType: 'process'`, `node:child_process` | Required proof is the Node lane (`bun run test:ci`). Do not retarget that script at Bun. Bun 1.4's worker implementation is not the deployment target. |
| 9 `better-sqlite3` | `node:sqlite` on Node only | No `bun:sqlite`. Tests run via `bun run test:ci` so the process is Node. Skip only when `typeof Bun !== 'undefined'`. Approved major: `engines.node` `>=22.16.0`. CI pins Node `22.16`. Publish waits for Daniel. |

## Success criteria

- After Sprints 1–8, root `devDependencies` no longer lists `rimraf`, and root `dependencies` and `devDependencies` no longer list `chalk`, `async-mutex`, `cli-table3`, `chrono-node`, `commander`, `zod`, or `@danielsimonjr/workerpool`. Sprint 9 removes `better-sqlite3` and `@types/better-sqlite3` and sets `engines.node` to `>=22.16.0`. It does not publish.
- `bun.lock` no longer contains those keys or `rimraf`'s `glob` / `minimatch` chain unless some other direct dependency still pulls them (today none does).
- `rg "from 'chalk'|from 'cli-table3'|from 'async-mutex'|from 'chrono-node'|rimraf" src package.json` finds no matches.
- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, and `bun run build` exit 0. `bun run test:ci` still starts with `node -e` so Vitest runs on Node. `node:sqlite` tests skip only when `typeof Bun !== 'undefined'`.
- Exported type names from `src/utils/index.ts` and the CLI's command names are unchanged.
- Sprint 5's recorded corpus at `2026-01-15T12:00:00.000Z` in UTC matches today's custom-pattern instants, and matches chrono-node 2.9.1 on the fallback phrases. Text chrono returns no result for still returns `undefined`. A throw from `parse` or `parseDate` still throws.

## Spec self-review

- No package in `package.json` is missing a decision.
- VENDOR is defined and unused on purpose.
- `AsyncMutex` is distinguished from the `async-mutex` replacement so a builder cannot "reuse the existing mutex."
- Sprint 5 rebuilds chrono-node. Sprints 6–8 rebuild commander, Zod, and workerpool. Sprint 9 is the approved `node:sqlite` major (`engines.node` `>=22.16.0`). Optional peers and the dev toolchain have no rebuild sprint.
- Closed decisions (2026-11-10, 10:08 AM CT): Sprint 3 border glyphs ship in a patch. Sprint 9 is not gated. Nothing in this spec is waiting on Daniel except the later publish of the major.
- Bun develops; Node ships. The Node test lane is `bun run test:ci`. There is no `bun:sqlite` path.
- Tool packages and the esbuild override are explicit keeps.
