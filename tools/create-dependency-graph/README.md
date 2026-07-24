# create-dependency-graph (CDG)

The MemoryJS dependency-graph **generator** — a whole-codebase TypeScript parse that emits
the `docs/architecture/*` dependency documentation, plus a duplicate-symbol prevention gate
(`check-duplicates.mjs`).

## create-dependency-graph.ts

Scans the codebase and generates comprehensive dependency documentation.

**Usage:**

```bash
# Run via npm script (recommended)
npm run tools:deps

# Or run directly — plain node, no tsx needed (Node >= 22.18 type stripping)
node tools/create-dependency-graph/create-dependency-graph.ts

# Options
node tools/create-dependency-graph/create-dependency-graph.ts --include-tests   # + coverage report
node tools/create-dependency-graph/create-dependency-graph.ts --reachable-only  # graph only reachable files
node tools/create-dependency-graph/create-dependency-graph.ts --strict-orphans  # orphans fail the run
node tools/create-dependency-graph/create-dependency-graph.ts --check-census    # no-regen freshness gate
```

> The source deliberately avoids TS syntax Node's type stripping can't erase (no enums, no
> namespaces, no parameter properties). Node prints a harmless one-line
> `MODULE_TYPELESS_PACKAGE_JSON` warning because this package's `dist` build is CJS while the
> source is ESM; it can be ignored. `npx tsx …` still works too.

**Output (all under `docs/architecture/`):**

- `DEPENDENCY_GRAPH.md` — Markdown documentation (module sections, dependency matrix,
  circular-dependency analysis split **runtime vs type-only**, Mermaid diagram, statistics,
  entry-points/reachability section)
- `dependency-graph.json` — full machine-readable graph (per-file deps/exports, cycles,
  reachability block, statistics)
- `dependency-graph.yaml` — same data, ~40% smaller
- `dependency-summary.compact.json` — ~10KB LLM-oriented summary (abbreviated keys,
  per-module export inventory, hot paths)
- `unused-analysis.md` — unused exports **and dormant files**: source files reachable from
  no entry/build root, split into _orphaned_ (reachable from nothing — delete/wire
  candidates) and _test-only_ (imported by a test, ships nothing). Unused exports are split
  into _unreferenced anywhere_ (true deletion candidates) vs _referenced in-module_
  (type contracts / helpers backing live exports), via an in-file reference count
- `duplicate-symbols.md` / `duplicate-symbols.json` — names OWN-defined by >= 2 distinct
  files, classified TRUE_DUPLICATE / ALIAS_DELEGATION / ALLOWLISTED with a canonical-file
  hint per entry
- `FILE_INVENTORY.md` / `file-inventory.json` — complete census of every tracked `.ts` in
  the repo (src/tests/tools/benchmarks/configs) with a disposition, self-checked against a
  maximal repo walk (a `.ts` in a location the census doesn't enumerate hard-fails the run)
- `TEST_COVERAGE.md` / `test-coverage.json` — with `--include-tests`: source-to-test
  mapping traced through barrel re-exports; supports an optional
  `docs/architecture/coverage-policy.json` for an "effective coverage" companion metric

**Reachability model:**

A file is *reachable* if a path of imports leads to it from a seeded root. Roots are
discovered automatically:

- `src/index.ts` (package entry)
- package.json `exports` subpath targets and `bin` targets (`dist/cli/index.js` →
  `src/cli/index.ts` — the `memory`/`memoryjs` CLI)
- **every** `entry: [...]` array in `tsup.config.ts` (library, CLI, and the worker bundle
  `src/workers/levenshteinWorker.ts`, which is loaded from `dist/workers/` by path at
  runtime and imported by nothing)
- explicit `src/*.ts` arguments and secondary `tsc -p <cfg>` includes in package scripts
- `new URL('…src/x.ts', import.meta.url)` references in root-level build/test configs

Import edges are followed through four forms: `import … from`, bare side-effect
`import '…'`, inline/dynamic `import('…')` expressions (including destructured
`const { x } = await import('…')`, whose bindings count as symbol usage), and imports of
the package's own npm name. Comments are stripped before parsing, so imports in JSDoc
examples don't count. `.d.ts` files are excluded.

MemoryJS is a single package, so the default graph includes **all** src files (dormancy is
reported, not hidden); `--reachable-only` restricts it. If a `workspaces` field is ever
added, the tool switches to monorepo mode (per-package roots + package-level dependency
table) and defaults to reachable-only (`--all` to widen).

**Known findings (validated, not false positives):**

- `src/workers/index.ts` is reported as *orphaned*: it is a re-export barrel that nothing
  imports (not `src/index.ts`, not any test — the worker itself is loaded from
  `dist/workers/levenshteinWorker.js` by path). Wire it into `src/index.ts` or delete it.
- `withErrorHandling` (`src/cli/commands/helpers.ts`) is exported but referenced nowhere.

## check-duplicates.mjs / gen-duplicate-baseline.mjs / duplicate-allowlist.json

Prevention gate for duplicate symbol definitions:

```bash
npm run tools:check-duplicates            # regenerate + gate
node tools/create-dependency-graph/check-duplicates.mjs --no-regen   # gate only (fast)
node tools/create-dependency-graph/gen-duplicate-baseline.mjs        # re-seed the baseline
```

- `duplicate-allowlist.json` (in this directory, human-curated) marks legitimately
  independent duplicates — e.g. the worker bundle's local `levenshteinDistance` copy, which
  must not import across the standalone-bundle boundary. Allowlisted names are excluded
  from the actionable TRUE_DUPLICATE count.
- `docs/architecture/duplicate-baseline.json` (generated) is the accepted, shrinking
  backlog. `check-duplicates.mjs` fails only on **new** TRUE_DUPLICATE names beyond it.
  After consolidating a name, re-run the baseline generator to shrink it.

Run all of these from the **repo root** (they resolve paths from `process.cwd()`).

## Adding New Tools

1. Create a new `.ts` file in this directory
2. Add a corresponding npm script in `package.json`
3. Document the tool in this README
4. Run typecheck before committing: `npx tsc --noEmit -p tools/create-dependency-graph/tsconfig.json`
