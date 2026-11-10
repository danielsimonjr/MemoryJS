# Design: Dependency reduction

**Date:** 2026-11-10
**Status:** Proposed. This document is the spec. Implementation is later sprints, one PR each.
**Target version:** patch releases on 4.x (current package version 4.6.0), except Sprint 5, which is a flagged behavior change and stays unshipped until Daniel accepts it.
**Package:** `@danielsimonjr/memoryjs`
**Lockfile measured:** `bun.lock` lockfileVersion 2, 269 package entries, on master at the time of this spec.
**Out of scope for code:** this run writes only this spec and `docs/superpowers/plans/2026-11-10-dependency-reduction.md`. No merge, tag, release, or publish.

## Goal

Cut third-party packages MemoryJS installs and ships, without changing the public API, and without trading away correctness, security, or performance. Each later sprint is one small PR that replaces or reclassifies one dependency, with behavior-parity tests written against the old package before that package is removed.

## Non-goals

- Rewriting the test runner, the typechecker, the bundler, the linter, or the worker runtime.
- Reimplementing Zod, Commander, chrono-node's natural-language grammar, or better-sqlite3.
- Vendoring large packages. No dependency in this inventory is both small enough and license-clean enough that copying the upstream source is better than a narrow in-repo replacement or than keeping the package.
- Changing `tools/*` packages. They are not part of the published `files` list (`dist`, `scripts/rebuild-native.mjs`, `README.md`, `LICENSE`).
- A major version. Public exports, CLI flag names, storage formats, and environment variables stay as they are.

## Roles for later sprints

Each implementation sprint is one PR, executed subagent-driven, test-first:

| Role | Model |
|---|---|
| Builder | deepseek-v41-flash-1017 |
| Challenger | glm-5p3-flash |
| Reviewer | composer-2.5 |
| Checker | grok-4.6 |

The builder implements the sprint. The challenger tries to break the parity claim. The reviewer checks the diff against this spec. The checker re-runs the verification commands and reports pass or fail. This planning run does not execute a sprint.

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
- Optional peers are absent from `bun.lock` (`yaml`, `pg`, and `@huggingface/transformers` are not lockfile keys). Bun does not install them, so they add nothing to a default `bun install`.
- `node_modules` was not installed in the planning environment. Sizes are registry unpacked sizes, not a local `du`.

Runtime union of the eight `dependencies` entries: 15 lockfile packages. Dev union: 91. Overlap makes the full direct union 105 of the 269 lockfile entries. The rest are mostly `@esbuild/*` platform packages pulled by the `esbuild` override, counted inside the `tsup` / `tsx` closures only when that edge names `esbuild` itself.

## Downstream consumers

`package.json` `version` is `4.6.0`. A consumer ranged at `^4.5.0` receives these sprints as patch or minor updates. Sprints 1–4 are patch: they do not change exported names, types, CLI flags, or on-disk formats.

Checked on 2026-11-10: the default branch of `github.com/danielsimonjr/episodic-memory` (`episodic-memory` 1.7.3) does **not** declare `@danielsimonjr/memoryjs`. Its own dependencies include `better-sqlite3` pinned to `13.0.3`, `zod` `^4.6.6`, and `@huggingface/transformers` `^4.2.0`. Those are separate installs. Keeping or removing the same names inside MemoryJS does not add or remove them from that repo. MemoryJS sprints must still assume other unpublished consumers on `^4.5.0` exist, and must not break the root export, the subpath exports, or the `memory` / `memoryjs` bins.

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

`src/utils/AsyncMutex.ts` already exists and is the lock behind `graphMutex`. It is **not** a drop-in replacement. `AsyncMutex.acquire` rejects when the queue exceeds 1,000 waiters or when the head waiter exceeds 30 seconds. `async-mutex`'s `runExclusive` has no timeout and no queue cap. Storage writers depend on that. Sprint 3 adds a separate `RunExclusiveMutex` and does not route these call sites through `AsyncMutex`.

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

Color behavior that must survive: chalk 5+ honors `NO_COLOR` (any value disables color) and `FORCE_COLOR` (`0` disables, `1`/`2`/`3` enables). When neither is set, chalk colors only when stdout is a TTY. The replacement uses the same rule and the same SGR codes: bold `1`, red `31`, green `32`, yellow `33`, cyan `36`, gray `90`.

#### `cli-table3` @ 0.6.5 — REBUILD

| | |
|---|---|
| Unpacked size | 46,198 bytes |
| Lockfile closure | 6, via `string-width` ^4.2.0 |
| License | MIT |
| Maintenance | Last publish 2024-05-12. The string-width 4 line is the old Unicode-width stack. |
| What the code uses | `src/cli/formatters.ts` only: `new Table({ head, colWidths, wordWrap: true })`, `table.push(cells)`, `table.toString()`. `wordWrap: true` is set on the entity, relation, and search tables. The centrality table sets `head` and `colWidths` only. |

A general Unicode table would be a second `cli-table3`. The replacement covers this option subset: ANSI-aware column measurement (so Sprint 2's color codes do not inflate widths), space padding, a `+---+` border, and word wrap on whitespace when `wordWrap` is true. It does not implement `cli-table3` options MemoryJS never passes (`colSpan`, `rowSpan`, `style`, `chars` overrides, streaming).

CLI stdout text for table format can change by padding or wrap differences. JSON and CSV formatters must stay byte-identical. Tests pin the table cases MemoryJS renders rather than the whole `cli-table3` matrix. That is a CLI presentation change inside a patch, limited to table glyphs, and it is called out in Sprint 4 so Daniel can reject the sprint if a consumer snapshots table output.

#### `chrono-node` @ 2.9.1 — MAKE OPTIONAL (Sprint 5, flagged)

| | |
|---|---|
| Unpacked size | 3,505,885 bytes |
| Lockfile closure | 1 (the package bundles its parser) |
| License | MIT |
| Maintenance | Actively published (2.10.3 exists; lockfile pins 2.9.1). |
| What the code uses | `src/search/TemporalQueryParser.ts` only. Dynamic `import('chrono-node')` and a synchronous `createRequire` fallback. Symbols used: `parse`, `parseDate`, result `.start.date()`, `.end.date()`. |

Custom patterns in `parseCustomPattern` already handle the relative phrases (`last hour`, `past N days`, `this week`, `today`, `yesterday`, `N units ago`) without chrono. Chrono is the fallback for everything else, including `since <date>` and ranges such as `between Monday and Wednesday`. The module is lazy, but it is still a hard dependency, so it is installed for every consumer and tsup can still bundle it into chunks that load the parser.

Making it an optional peer removes ~3.5 MB from the default install. It also changes runtime behavior: a chrono-only phrase currently returns a `ParsedTemporalRange`; without the peer it must return `undefined` (the same value the parser already uses for text it cannot parse) and emit one `console.warn` per process. That is a behavior change for `TemporalQueryParser`, `TemporalSearch.searchByTime`, and `SearchManager.searchByTime`.

**Flag for Daniel.** Sprint 5 does not ship unless Daniel accepts that change. If he does not, the decision flips to KEEP and the sprint is skipped. No type signature changes either way. Consumers who need the fallback run `npm install chrono-node@^2.9.1`. `danielsimonjr/episodic-memory` 1.7.3 does not depend on MemoryJS, so this sprint does not change that repo's install.

Do not rebuild chrono. The grammar is the product. A partial reimplementation would hurt correctness.

#### `commander` @ 15.0.0 — KEEP

| | |
|---|---|
| Unpacked size | 207,368 bytes |
| Lockfile closure | 1 |
| License | MIT |
| Maintenance | 15.1.0 published 2026-11-09. Lockfile pins 15.0.0. Healthy. |
| What the code uses | `Command` across `src/cli/index.ts` and `src/cli/commands/*.ts`. Also `Option` (`audit.ts`, `io.ts`) and `InvalidArgumentError` (`maintenance.ts`). Tests construct `Command` directly. |

This is the CLI's argument parser, help text, and error type. Rebuilding it would rewrite every command's help and option handling. That is a behavior and support risk with little install-size win (one package, ~200 KB, CLI bundle only in practice, but it is a runtime dependency because the bin is part of the package). KEEP so CLI correctness stays with the maintained parser.

#### `zod` @ 4.6.7 — KEEP

| | |
|---|---|
| Unpacked size | 6,148,944 bytes |
| Lockfile closure | 1 (4.6.7 is pinned; `package.json` says `^4.6.6`) |
| License | MIT |
| Maintenance | Active. 4.6.7 published 2026-10-12. |
| What the code uses | `z.object`, `z.array`, `z.string`, `z.number`, `z.enum`, `z.literal`, `z.record`, `.strict()`, `.safeParse()`, `z.infer`, `ZodSchema`, `ZodError`. |

Production call sites include `src/utils/schemas.ts` (entity, relation, import, and search schemas used by `EntityManager`, `RelationManager`, and `IOManager`), `src/adapters/recursaToolSchemas.ts`, `src/adapters/RecursaToolAdapter.ts`, `src/agent/procedural/graph/ProceduralGraphSchemas.ts`, `src/agent/evaluation/LLMRubricJudge.ts`, `src/agent/learning/{Diagnoser,KnowledgeEditor,RevisionReconcile,revisionMergeShared}.ts`, and `src/agent/bootstrap/{ExplorationNotes,PracticeTaskGenerator}.ts`.

`src/utils/index.ts` re-exports the schemas, the `z.infer` type aliases (`EntityInput`, `CreateEntityInput`, and the rest of that block), and `formatZodErrors(error: ZodError)`. Those aliases erase to plain types, but `formatZodErrors` names `ZodError` and the schema values are Zod objects at runtime. Removing Zod changes the public `utils` surface. Rebuilding even the subset MemoryJS uses (strict objects, trimmed strings, datetime strings, int ranges, enums, discriminated unions, error formatting) is a correctness risk on data that enters storage.

KEEP. The 6 MB unpacked size is the cost of not drifting validation. `episodic-memory` depends on `zod` itself; MemoryJS's copy does not satisfy that dependency.

#### `better-sqlite3` @ 13.0.3 — KEEP

| | |
|---|---|
| Unpacked size | 27,302,969 bytes (prebuilds for every platform) |
| Lockfile closure | 2 (`better-sqlite3`, `node-addon-api`) |
| License | MIT |
| Maintenance | 13.0.3 published 2026-08-05. Native addon. `postinstall` runs `scripts/rebuild-native.mjs`. |
| What the code uses | Runtime `require('better-sqlite3')` inside `src/core/SQLiteStorage.ts` `resolveSQLiteDatabaseCtor`, with a `node:sqlite` fallback in `src/core/nodeSqliteAdapter.ts`. Type imports in `SQLiteStorage.ts` and `src/search/PartialIndexAdvisor.ts`. `tsup.config.ts` externalizes it. Doctor command checks ABI. Tests open real databases. |

`nodeSqliteAdapter.ts` documents itself as a compatibility shim, not a reimplementation: `node:sqlite`'s `changes` shape, `.pragma({ simple: true })` (first column of the first row), and non-nestable transactions differ from better-sqlite3. FTS5 search is a documented feature of `SQLiteStorage`. Dropping the native addon would make the fast path depend on a shim that the repo already refuses to treat as equivalent, and it would drop the prebuilt performance path.

KEEP. Removing it would hurt performance and FTS correctness. The fallback stays for environments where the native binary cannot load. `tools/migrate-from-jsonl-to-sqlite` has its own `better-sqlite3` dependency and is out of scope. `episodic-memory` pins `better-sqlite3@13.0.3` on its own; do not bump MemoryJS's range in these sprints.

#### `@danielsimonjr/workerpool` @ 10.2.0 — KEEP

| | |
|---|---|
| Unpacked size | 3,142,636 bytes |
| Lockfile closure | 1 |
| License | Apache-2.0 |
| Maintenance | First-party. 10.2.2 exists on npm; lockfile pins 10.2.0. Published 2026-09-19 for 10.2.x. |
| What the code uses | `workerpool.cpus`, `workerpool.pool(path, options)`, `pool.exec(method, args)` (then `.timeout()` and `.cancel()` on the returned promise), `pool.stats()`, `pool.terminate(force)`, `workerpool.worker({...})`. |

Call sites: `src/utils/WorkerPoolManager.ts`, `src/utils/WorkerTaskManager.ts` (cancel and pending), `src/search/FuzzySearch.ts`, `src/workers/levenshteinWorker.ts`. `parallelUtils.ts` and `taskScheduler.ts` mention workerpool in comments only.

This is Daniel's package, not an incidental utility. The worker protocol (transfer, timeout, cancel, stats, process vs thread) is the feature. Rebuilding it inside MemoryJS would fork a library he already publishes and would risk fuzzy-search throughput. KEEP. A version bump to 10.2.2 is a dependency-hygiene change, not part of these sprints.

### Optional peer dependencies

All three are already optional. Default installs do not fetch them. Decision for each is KEEP. No sprint moves them back to `dependencies`.

#### `@huggingface/transformers` ^4.3.1 — KEEP

Dynamic `import('@huggingface/transformers')` in `src/search/EmbeddingService.ts` (`pipeline` of the feature-extraction task, q8). Absent peer: local embeddings fail with an install hint; lexical search still works. Unpacked size of 4.3.2 (registry latest matching the range, not locked) is about 10 MB, plus model files downloaded at runtime, which are not part of the package. Apache-2.0. Actively published. `episodic-memory` depends on `^4.2.0` itself. Making the peer required would force that weight onto every MemoryJS consumer. Keeping it optional is the reduction.

#### `pg` >=8.0.0 — KEEP

`src/core/PostgreSQLStorage.ts` dynamic-imports `pg` and uses `Pool`. The storage is not the default (`MEMORY_STORAGE_TYPE` defaults to jsonl). Registry unpacked size of 8.23.1 is 102,632 bytes. MIT. Active. Consumers who enable Postgres install `pg`. MemoryJS must not bundle it.

#### `yaml` >=2.0.0 — KEEP

`src/agent/skills/SkillFormat.ts` uses `yaml.parse` on skill front matter when the peer is installed. Without it, front matter accepts JSON values only (the error string in that file says so). `SkillPublisher.ts` calls `loadOptionalYaml()`. ISC license. Registry unpacked size of 2.9.1 is 686,297 bytes. The peer is absent from `bun.lock` because it is optional and not installed. That is expected. Do not vendor `yaml` to parse a path that is already optional.

### devDependencies

| Package | Locked | Unpacked | Closure | Decision | Why |
|---|---|---|---|---|---|
| `rimraf` | 6.1.4 | 262,867 | 10 (`glob`, `package-json-from-dist`, …) | REBUILD | Used only as `rimraf dist` in the `clean` script. Node 22 `fs.rm(path, { recursive: true, force: true })` is the same operation. BlueOak-1.0.0. Actively published, but the transitive glob chain is the reason it was bumped (CHANGELOG notes GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249 via glob/minimatch). Deleting it removes that chain from the dev install. |
| `@types/better-sqlite3` | 9.6.0 | (types) | 3 with `@types/node` | KEEP | Compiling `SQLiteStorage` needs the types while the native module stays. |
| `@types/node` | 26.4.0 | (types) | 2 (`undici-types`) | KEEP | `engines.node` is `>=22.12.0`. The types are the Node API. |
| `typescript` | 7.0.2 | 2,497,498 | 1 | KEEP | `typecheck` is `tsc --noEmit`. TS 7 has no programmatic compiler API (`scripts/emit-dts.mjs` exists because of that). Replacing the compiler is not a dependency-diet task. Apache-2.0. |
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
- Native addon: `better-sqlite3` is the only native runtime dependency. `scripts/rebuild-native.mjs` lists `NATIVE = ['better-sqlite3']`. Optional peers do not ship native code of their own inside MemoryJS (`@huggingface/transformers` downloads ONNX runtimes when the consumer installs it). No sprint removes the postinstall script.

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
3. **Rebuild only the narrow call sites, and make chrono optional behind an explicit accept.** Chosen. Order is smallest and safest first.

## Sprint order

| Sprint | Package | Decision | Risk | Semver |
|---|---|---|---|---|
| 1 | `rimraf` | REBUILD | Dev script only. `dist/` delete. | none (devDependency) |
| 2 | `chalk` | REBUILD | CLI colors. Library API untouched. | patch |
| 3 | `async-mutex` | REBUILD | In-process write serialization. Parity with no timeout. | patch |
| 4 | `cli-table3` | REBUILD | CLI table text only. JSON/CSV identical. | patch, with a presentation note |
| 5 | `chrono-node` | MAKE OPTIONAL | Flagged behavior change. Skip if Daniel declines. | minor, not patch, and only after accept |

KEEP packages have no sprint.

## Global constraints

These lines are binding on every sprint. The plan repeats them.

- Node production runtime remains `>=22.12.0`. Bun remains `>=1.4.2` and `packageManager` remains `bun@1.4.2`.
- `bun.lock` is the lockfile that changes. Do not add a root `package-lock.json`.
- Public exports in `package.json` `exports` stay. No exported TypeScript name is removed or retyped.
- `overrides.esbuild` stays `^0.28.1`.
- `better-sqlite3` stays external in `tsup.config.ts`.
- Storage file formats, SQLite schema, and environment-variable names stay.
- Each sprint is one PR. The builder is deepseek-v41-flash-1017. The challenger is glm-5p3-flash. The reviewer is composer-2.5. The checker is grok-4.6.
- Tests that describe the old dependency's behavior land in the same PR as the removal, and they are written to fail before the new module exists.
- Verification for every sprint: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`, `node scripts/check-exports.mjs` (already inside `build`), and `git diff --stat` on `dist/` only after a local build to see the bundle change. Do not commit `dist/`.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` and `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` must exit 0 when a sprint adds an exported symbol. New exports need a JSDoc block whose first sentence says what the function does.
- No force-push, rebase, amend, or `--no-verify`. No publish.

## Success criteria

- After Sprints 1–4, root `dependencies` no longer lists `rimraf` (it was a devDependency), `chalk`, `async-mutex`, or `cli-table3`.
- `bun.lock` no longer contains those four keys or `rimraf`'s `glob` / `minimatch` chain unless some other direct dependency still pulls them (today none does).
- `rg "from 'chalk'|from 'cli-table3'|from 'async-mutex'|rimraf" src package.json` finds no matches.
- `bun run test:ci`, `bun run typecheck`, `bun run lint`, and `bun run build` exit 0.
- Exported type names from `src/utils/index.ts` and the CLI's command names are unchanged.
- Sprint 5 is either skipped, or merged only with Daniel's acceptance recorded in the PR, and `chrono-node` is then an optional peer rather than a dependency.

## Spec self-review

- No package in `package.json` is missing a decision.
- VENDOR is defined and unused on purpose.
- `AsyncMutex` is distinguished from the `async-mutex` replacement so a builder cannot "reuse the existing mutex."
- Sprint 5 is the only behavior change, and it is gated.
- Tool packages and the esbuild override are explicit keeps.
