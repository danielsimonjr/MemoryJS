#!/usr/bin/env node

/**
 * Generic Dependency Graph Generator (MemoryJS edition)
 *
 * Scans a TypeScript codebase and generates:
 * - docs/architecture/DEPENDENCY_GRAPH.md (human-readable, with Mermaid diagram)
 * - docs/architecture/dependency-graph.json (machine-readable)
 * - docs/architecture/dependency-graph.yaml (compact, ~40% smaller than JSON)
 * - docs/architecture/dependency-summary.compact.json (~10KB LLM-oriented summary)
 * - docs/architecture/unused-analysis.md (unused exports + DORMANT FILES)
 * - docs/architecture/duplicate-symbols.md / .json (duplicate own-definitions)
 * - docs/architecture/FILE_INVENTORY.md / file-inventory.json (complete file census)
 * - docs/architecture/TEST_COVERAGE.md / test-coverage.json (with --include-tests)
 *
 * Usage: node tools/create-dependency-graph/create-dependency-graph.ts
 * (Runs on Node >= 22.18 via built-in type stripping — no tsx required. The
 *  source deliberately avoids TS syntax type stripping can't erase: no enums,
 *  no namespaces, no parameter properties.)
 *
 * This tool is generic and does not depend on any codebase-specific functions.
 * It dynamically discovers the project structure from the filesystem.
 *
 * Reachability model. A file is "reachable" if a path of imports leads to it
 * from a seeded ROOT. Roots are the package's `src/index.ts` plus every build
 * entry the tool can discover: package.json `exports` subpath targets, `bin`
 * targets (dist/x.js -> src/x.ts), extra `tsup src/*.ts` script entries,
 * `tsup.config.ts` entry arrays (ALL of them — multi-config files included),
 * secondary `tsc -p <cfg>` includes parsed from package scripts, and
 * `new URL('…src/x.ts', …)` references in root-level build/test configs.
 * Edges are followed through four import forms — `import … from`, bare
 * side-effect `import '…'`, inline/dynamic `import('…')` expressions, and
 * imports of the package's own npm name (self-imports; in a monorepo,
 * npm-scoped workspace imports). Files reachable from none of these are
 * DORMANT, split in unused-analysis.md into "orphaned" (reachable from no
 * root and no test — delete/wire candidates) and "test-only" (exercised by a
 * test, ships nothing). `.d.ts` ambient declarations are excluded.
 *
 * Single-package vs monorepo: MemoryJS is a single package, so the DEFAULT
 * graph includes every src file (dormancy is reported, not hidden) — use
 * `--reachable-only` to restrict the graph to reachable files. When a
 * `workspaces` field is present the tool switches to monorepo mode
 * (per-package roots, package-level dependency table) and defaults to
 * reachable-only, matching the upstream MathTS behaviour (`--all` to widen).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { basename, dirname, join, relative } from 'path';

// Types
interface Dependency {
  file: string;
  imports: string[];
  reExport?: boolean;
  typeOnly?: boolean; // Track type-only imports (and lazy dynamic imports)
  dynamic?: boolean; // Runtime `import('…')` expression (lazy edge)
}

interface ExternalDependency {
  package: string;
  imports: string[];
}

interface NodeDependency {
  module: string;
  imports: string[];
}

interface FileExports {
  named: string[];
  default: string | null;
  types: string[];
  interfaces: string[];
  enums: string[];
  classes: string[];
  functions: string[];
  constants: string[];
  reExported: string[]; // Track re-exported symbols
}

interface ParsedFile {
  path: string;
  name: string;
  externalDependencies: ExternalDependency[];
  nodeDependencies: NodeDependency[];
  internalDependencies: Dependency[];
  workspaceDependencies: WorkspaceDependency[];
  packageName: string | null;
  exports: FileExports;
  description: string | null;
}

interface DependencyMatrix {
  [path: string]: {
    importsFrom: string[];
    exportsTo: string[];
  };
}

interface Statistics {
  totalTypeScriptFiles: number;
  totalModules: number;
  totalLinesOfCode: number;
  totalExports: number;
  totalClasses: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalTypeGuards: number;
  totalEnums: number;
  totalConstants: number;
  totalReExports: number;
  totalTypeOnlyImports: number;
  runtimeCircularDeps: number; // Excludes type-only cycles
  typeOnlyCircularDeps: number; // Type-only cycles (not runtime issues)
  entryRoots: number; // Seeded reachability roots
  reachableFiles: number;
  dormantFiles: number; // src files unreachable from every root
  orphanedFiles: number; // dormant AND unreachable from every test
  testOnlyFiles: number; // dormant but exercised by a test
  unusedFilesCount: number;
  unusedExportsCount: number;
}

interface UnusedExport {
  file: string;
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant' | 'enum' | 'other';
  // How many times the symbol is referenced WITHIN its own file beyond its export
  // definition. > 0 means it's a type contract / helper backing live exports in the
  // same module (not deletable in isolation); 0 means unreferenced anywhere — the
  // true deletion candidates. This split is what makes the report legible.
  inFileRefs: number;
}

interface UnusedAnalysis {
  unusedFiles: string[];
  unusedExports: UnusedExport[];
}

interface ModuleMap {
  [moduleName: string]: {
    [filePath: string]: ParsedFile;
  };
}

interface PackageJson {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
  bin?: Record<string, string> | string;
  scripts?: Record<string, string>;
  workspaces?: string[];
}

interface WorkspacePackage {
  name: string; // npm name, e.g., "@danielsimonjr/memoryjs"
  directory: string; // relative dir ('' for the single root package)
  srcDir: string; // relative src dir, e.g., "src"
  // Source files of package.json `exports` subpath entries other than "." plus
  // `bin` targets, script-declared build entries, and tsup.config entries.
  // These are roots exactly like src/index.ts; without them everything reachable
  // only through such an entry is false-flagged as dormant/unused.
  extraEntries: string[];
}

interface WorkspaceDependency {
  package: string; // workspace (or self) package name
  directory: string; // package directory ('' for the root package)
  imports: string[]; // imported symbols
  // Set when the import specifier targeted an `exports` subpath entry rather than
  // the package root — e.g. `@scope/pkg/internal` -> "internal".
  subpath?: string;
}

// CLI options interface
interface CLIOptions {
  root: string;
  includeTests: boolean;
  all: boolean;
  reachableOnly: boolean;
  checkCensus: boolean;
  strictOrphans: boolean;
}

// Constants - support CLI argument or current working directory for portability
function parseCliOptions(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    root: process.cwd(),
    includeTests: false,
    all: false,
    reachableOnly: false,
    checkCensus: false,
    strictOrphans: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--root=')) {
      options.root = arg.slice(7);
    } else if (arg === '--include-tests' || arg === '-t') {
      options.includeTests = true;
    } else if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--reachable-only') {
      options.reachableOnly = true;
    } else if (arg === '--check-census') {
      options.checkCensus = true;
    } else if (arg === '--strict-orphans') {
      options.strictOrphans = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Dependency Graph Generator

Usage:
  create-dependency-graph [options] [project-root]

Options:
  --root=<path>      Project root directory (default: current directory)
  --include-tests    Also generate TEST_COVERAGE.md / test-coverage.json
  -t                 Short form of --include-tests
  --reachable-only   Restrict the graph to files reachable from a build root
                     (single-package mode analyzes ALL files by default,
                     reporting dormancy instead of hiding it)
  --all, -a          Monorepo mode only: include dormant/unreachable files
  --strict-orphans   Exit non-zero when any orphaned src file exists
  --check-census     Verify the committed file-inventory.json against a fresh
                     repo walk WITHOUT re-running the graph scan, then exit
  --help, -h         Show this help

Reachability roots are discovered from package.json (exports subpaths, bin
targets, script entries, tsc -p includes), tsup.config.ts entry arrays, and
new URL('…src/x.ts') references in root-level configs.

Examples:
  node tools/create-dependency-graph/create-dependency-graph.ts
  node tools/create-dependency-graph/create-dependency-graph.ts --include-tests
  node tools/create-dependency-graph/create-dependency-graph.ts --root=. --strict-orphans
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && existsSync(arg)) {
      // First non-flag argument is the project root
      options.root = arg;
    }
  }

  return options;
}

function getProjectRoot(): string {
  return parseCliOptions().root;
}

const ROOT_DIR = getProjectRoot();
const SRC_DIR = join(ROOT_DIR, 'src');
const OUTPUT_DIR = join(ROOT_DIR, 'docs', 'architecture');

// Read package.json for version and name
let packageJson: PackageJson = { name: 'unknown', version: '0.0.0' };
try {
  packageJson = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8')) as PackageJson;
} catch {
  console.warn('Warning: Could not read package.json, using defaults');
}

// Module-level package map. In monorepo mode: one entry per workspace package.
// In single-package mode: one synthetic entry for the root package itself
// (directory '' / srcDir 'src'), so self-name imports resolve and root
// discovery flows through one code path.
let workspaceMap: Map<string, WorkspacePackage> = new Map();
let isMonorepo = false;

/** Does `relPath` live inside workspace package `ws`? (handles the root
 *  package's empty directory). */
function wsContains(ws: WorkspacePackage, relPath: string): boolean {
  return ws.directory === '' ? true : relPath.startsWith(ws.directory + '/');
}

/**
 * Bundler entry points declared in a package's `tsup.config.ts`.
 * Unlike the upstream (MathTS) version this reads EVERY `entry: [ … ]` array
 * in the config — tsup configs commonly export an array of configs (MemoryJS
 * has three: library, CLI, workers), and reading only the first silently
 * dropped the CLI and worker build roots.
 */
function tsupConfigEntries(rootDir: string, pkgDir: string): string[] {
  const cfgPath = join(rootDir, pkgDir, 'tsup.config.ts');
  if (!existsSync(cfgPath)) return [];
  let code: string;
  try {
    code = readFileSync(cfgPath, 'utf-8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const arr of code.matchAll(/entry\s*:\s*\[([^\]]*)\]/g)) {
    for (const m of arr[1].matchAll(/['"`]([^'"`]+\.ts)['"`]/g)) {
      const p = join(pkgDir, m[1]).replace(/\\/g, '/');
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * Build/entry roots of a package beyond `src/index.ts`:
 * - `exports` subpath entries other than "." (`"./internal"` -> src/internal.ts)
 * - `bin` targets (`dist/cli/index.js` -> src/cli/index.ts) — nothing imports a
 *   CLI entry, so without seeding it the whole CLI subtree is false-dormant
 * - explicit `src/*.ts` arguments in package scripts (tsup/esbuild entries)
 * - secondary `tsc -p <cfg>` builds' `files`/`include` roots
 * - `tsup.config.ts` entry arrays (workers loaded dynamically from dist/,
 *   multi-entry CLIs)
 * Returned paths are repo-relative.
 */
function exportsSubpathEntries(rootDir: string, pkgDir: string, pkg: PackageJson): string[] {
  const entries: string[] = [];
  const addIfExists = (srcPath: string): void => {
    const norm = srcPath.replace(/\\/g, '/');
    if (existsSync(join(rootDir, srcPath)) && !entries.includes(norm)) {
      entries.push(norm);
    }
  };
  if (pkg.exports && typeof pkg.exports === 'object') {
    for (const key of Object.keys(pkg.exports)) {
      if (key === '.' || !key.startsWith('./')) continue;
      const name = key.slice(2); // "./internal" -> "internal"
      addIfExists(join(pkgDir, 'src', `${name}.ts`));
    }
  }
  // `bin` entries are build roots too: nothing imports them, so without seeding
  // them the whole CLI subtree is excluded from the graph and everything it
  // consumes gets false-flagged as unused.
  const binValues = typeof pkg.bin === 'string' ? [pkg.bin] : pkg.bin ? Object.values(pkg.bin) : [];
  for (const bin of binValues) {
    const m = /(?:\.\/)?dist\/(.+)\.[cm]?js$/.exec(bin);
    if (m) addIfExists(join(pkgDir, 'src', `${m[1]}.ts`));
  }
  // Bundler entry points declared in scripts — e.g. `tsup src/index.ts src/worker.ts`.
  // Each additional `src/*.ts` argument is a BUILD ROOT emitting its own bundle.
  const allScripts = Object.values(pkg.scripts ?? {});
  for (const script of allScripts) {
    if (!script) continue;
    for (const m of script.matchAll(/(?:^|\s)(src\/[\w./-]+\.ts)\b/g)) {
      addIfExists(join(pkgDir, m[1]));
    }
    // Secondary `tsc -p <tsconfig>` builds: seed that tsconfig's `files`/`include`
    // roots — they are compiled separately and shipped, but nothing imports them.
    for (const m of script.matchAll(/tsc\s+-p\s+([\w./-]+\.json)/g)) {
      seedTsconfigEntries(rootDir, pkgDir, m[1], addIfExists);
    }
  }
  // tsup entries from tsup.config.ts. Upstream gated this on "the build script
  // invokes tsup with no explicit src arg"; here it is read unconditionally —
  // if a tsup.config.ts declares an entry it IS a build root regardless of how
  // scripts happen to invoke tsup (npm run build:watch, direct npx tsup, …).
  for (const entry of tsupConfigEntries(rootDir, pkgDir)) addIfExists(entry);
  return entries;
}

/**
 * Source files pulled into a bundle by a root-level build/test config through a
 * path the module graph never surfaces — specifically a `new URL('./…/src/x.ts',
 * import.meta.url)` reference, the idiom for a bundler ALIAS or entry target.
 *
 * Deliberately narrow: it matches ONLY `new URL(...)` source references, NOT
 * arbitrary quoted strings. A config's coverage/test `include` lists name many
 * `src/*.ts` files that are measured or matched, not bundle roots — seeding
 * those would falsely mark their whole import closure reachable and hide
 * genuine dormancy.
 */
function configReferencedEntries(rootDir: string): string[] {
  const out = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(rootDir);
  } catch {
    return [];
  }
  const isConfig = (n: string): boolean =>
    /\.config(\.[\w-]+)?\.(m?[jt]s)$/.test(n) || /^(vite|vitest|rollup|webpack|tsup)\./.test(n);
  for (const name of names) {
    if (!isConfig(name)) continue;
    let code: string;
    try {
      code = readFileSync(join(rootDir, name), 'utf-8');
    } catch {
      continue;
    }
    for (const m of code.matchAll(/new\s+URL\(\s*['"`]([^'"`]*?src\/[\w./-]+\.ts)['"`]/g)) {
      out.add(m[1].replace(/^\.\//, ''));
    }
  }
  return [...out];
}

/**
 * Seed the entry files of a secondary tsconfig (`tsc -p <cfg>`): its explicit
 * `files`, plus non-glob `include` paths that point at a concrete `.ts`. Glob
 * includes (`src/bindings/**`) are expanded to every `.ts` under the base dir,
 * so a whole separately-compiled subtree is treated as reachable rather than
 * false-dormant.
 */
function seedTsconfigEntries(
  rootDir: string,
  pkgDir: string,
  cfgRel: string,
  add: (srcPath: string) => void
): void {
  const cfgPath = join(rootDir, pkgDir, cfgRel);
  if (!existsSync(cfgPath)) return;
  let cfg: { files?: string[]; include?: string[] };
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch {
    return;
  }
  const cfgDir = dirname(join(pkgDir, cfgRel));
  const seedPath = (p: string): void => {
    if (p.includes('*')) {
      const base = join(rootDir, cfgDir, p.replace(/\/?\*.*$/, ''));
      if (existsSync(base)) {
        for (const f of getAllSourceTsFiles(base)) {
          add(relative(rootDir, f).replace(/\\/g, '/'));
        }
      }
    } else if (p.endsWith('.ts')) {
      add(join(cfgDir, p));
    }
  };
  for (const f of cfg.files ?? []) seedPath(f);
  for (const inc of cfg.include ?? []) seedPath(inc);
}

/**
 * Detect workspace packages from a monorepo root. Returns empty map when the
 * root package.json has no `workspaces` field (single-package mode).
 */
function detectWorkspaces(rootDir: string): Map<string, WorkspacePackage> {
  const workspaces = new Map<string, WorkspacePackage>();

  try {
    const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
    const wsPatterns: string[] = rootPkg.workspaces || [];
    if (wsPatterns.length === 0) return workspaces;

    const register = (pkgDir: string): void => {
      const pkgJsonPath = join(rootDir, pkgDir, 'package.json');
      if (!existsSync(pkgJsonPath)) return;
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as PackageJson;
        if (pkg.name) {
          const srcDir = join(pkgDir, 'src');
          workspaces.set(pkg.name, {
            name: pkg.name,
            directory: pkgDir.replace(/\\/g, '/'),
            srcDir: srcDir.replace(/\\/g, '/'),
            extraEntries: exportsSubpathEntries(rootDir, pkgDir, pkg),
          });
        }
      } catch {
        /* skip invalid package.json */
      }
    };

    for (const pattern of wsPatterns) {
      if (pattern.endsWith('/*')) {
        const parentDir = pattern.slice(0, -2);
        const fullParent = join(rootDir, parentDir);
        if (!existsSync(fullParent)) continue;
        for (const entry of readdirSync(fullParent)) {
          register(join(parentDir, entry));
        }
      } else {
        register(pattern);
      }
    }
  } catch {
    /* no package.json or no workspaces field */
  }

  return workspaces;
}

/** Recursively collect non-test, non-declaration `.ts` source files under `dir`. */
function getAllSourceTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      getAllSourceTsFiles(fullPath, files);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Recursively get all test files (.test.ts, .spec.ts) in a directory. */
function getAllTestFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      getAllTestFiles(fullPath, files);
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Test coverage analysis interfaces
interface TestCoverageAnalysis {
  sourceFiles: string[];
  testFiles: ParsedFile[];
  coverageMap: Map<string, string[]>; // source file -> test files that import it
  testedFiles: string[];
  untestedFiles: string[];
  testToSourceMap: Map<string, string[]>; // test file -> source files it imports
  policy: CoveragePolicy | null;
  policyBreakdown: CategoryBreakdown;
}

// Coverage-policy support (loaded from docs/architecture/coverage-policy.json
// if present). Categorises untested files into "intentionally indirect"
// buckets so the headline metric can carry an "effective coverage" companion
// number alongside the raw direct-import figure.

interface CoveragePolicyCategory {
  label: string;
  rationale: string;
  pathPrefixes?: string[];
  exactPaths?: string[];
}

interface CoveragePolicy {
  description?: string;
  updated?: string;
  categories: Record<string, CoveragePolicyCategory>;
}

// Per-untested-file classification result. `null` category = active gap (real).
type ClassifiedUntested = { file: string; category: string | null };

// Aggregate breakdown returned alongside the raw counts.
interface CategoryBreakdown {
  byCategory: Record<string, number>;
  excludedTotal: number;
  activeFiles: number;
  testedActive: number;
  effectivePercent: string;
  classifiedUntested: ClassifiedUntested[];
}

/**
 * Load coverage-policy.json from docs/architecture/ if present. Returns null
 * when missing — the tool stays backwards-compatible (the breakdown collapses
 * to "active_untested = untestedCount" with no other categories).
 */
function loadCoveragePolicy(rootDir: string): CoveragePolicy | null {
  const policyPath = join(rootDir, 'docs', 'architecture', 'coverage-policy.json');
  if (!existsSync(policyPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as CoveragePolicy;
    if (!parsed.categories || typeof parsed.categories !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Classify one path against the policy (`exactPaths` wins over `pathPrefixes`). */
function classifyAgainstPolicy(filePath: string, policy: CoveragePolicy | null): string | null {
  if (!policy) return null;
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    if (cat.exactPaths?.includes(filePath)) return categoryId;
  }
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    if (cat.pathPrefixes) {
      for (const prefix of cat.pathPrefixes) {
        if (filePath.startsWith(prefix)) return categoryId;
      }
    }
  }
  return null;
}

/** Build the per-untested-file classification and aggregate counts. */
function buildCategoryBreakdown(
  sourceFiles: string[],
  testedFiles: string[],
  untestedFiles: string[],
  policy: CoveragePolicy | null
): CategoryBreakdown {
  const byCategory: Record<string, number> = {};
  if (policy) {
    for (const id of Object.keys(policy.categories)) byCategory[id] = 0;
  }
  byCategory.active_untested = 0;

  const classifiedUntested: ClassifiedUntested[] = [];
  for (const f of untestedFiles) {
    const cat = classifyAgainstPolicy(f, policy);
    if (cat) {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    } else {
      byCategory.active_untested = (byCategory.active_untested ?? 0) + 1;
    }
    classifiedUntested.push({ file: f, category: cat });
  }

  let excludedTotal = 0;
  let testedExcluded = 0;
  const testedSet = new Set(testedFiles);
  for (const f of sourceFiles) {
    const cat = classifyAgainstPolicy(f, policy);
    if (cat) {
      excludedTotal++;
      if (testedSet.has(f)) testedExcluded++;
    }
  }
  const activeFiles = sourceFiles.length - excludedTotal;
  const testedActive = testedFiles.length - testedExcluded;
  const effectivePercent = activeFiles > 0 ? ((testedActive / activeFiles) * 100).toFixed(1) : '0';

  return {
    byCategory,
    excludedTotal,
    activeFiles,
    testedActive,
    effectivePercent,
    classifiedUntested,
  };
}

// Re-export map: barrel file -> source files it re-exports from
type ReExportMap = Map<string, Set<string>>;

/**
 * Build a map of barrel files to the source files they re-export from.
 * This allows tracing imports through barrel files (index.ts) to find
 * the actual source files being tested.
 */
function buildReExportMap(sourceFiles: ParsedFile[]): ReExportMap {
  const reExportMap: ReExportMap = new Map();
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));

  for (const file of sourceFiles) {
    const reExportedSources = new Set<string>();
    for (const dep of file.internalDependencies) {
      if (dep.reExport) {
        const resolved = resolveImport(file.path, dep.file, sourceFilePaths);
        if (sourceFilePaths.has(resolved)) {
          reExportedSources.add(resolved);
        }
      }
    }
    if (reExportedSources.size > 0) {
      reExportMap.set(file.path, reExportedSources);
    }
  }

  // Recursively expand re-exports (handle chains like types/index.ts -> types/types.ts)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [barrelPath, sources] of reExportMap) {
      const expanded = new Set(sources);
      for (const source of sources) {
        const nestedSources = reExportMap.get(source);
        if (nestedSources) {
          for (const nested of nestedSources) {
            if (!expanded.has(nested)) {
              expanded.add(nested);
              changed = true;
            }
          }
        }
      }
      reExportMap.set(barrelPath, expanded);
    }
  }

  return reExportMap;
}

/**
 * Get all source files that are ultimately imported through a barrel file chain.
 */
function traceReExports(importedPath: string, reExportMap: ReExportMap): Set<string> {
  const result = new Set<string>();
  result.add(importedPath);
  const sources = reExportMap.get(importedPath);
  if (sources) {
    for (const source of sources) {
      result.add(source);
    }
  }
  return result;
}

/**
 * Analyze test coverage by mapping source files to test files.
 * Traces imports through barrel files (index.ts) to find all source files
 * that are indirectly tested through re-exports.
 */
function analyzeTestCoverage(
  sourceFiles: ParsedFile[],
  testFiles: ParsedFile[]
): TestCoverageAnalysis {
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));
  const coverageMap = new Map<string, string[]>();
  const testToSourceMap = new Map<string, string[]>();

  const reExportMap = buildReExportMap(sourceFiles);

  for (const source of sourceFiles) {
    coverageMap.set(source.path, []);
  }

  const addCoverage = (sourcePath: string, testPath: string, importedSources: string[]): void => {
    if (!importedSources.includes(sourcePath)) {
      importedSources.push(sourcePath);
    }
    const tests = coverageMap.get(sourcePath) || [];
    if (!tests.includes(testPath)) {
      tests.push(testPath);
      coverageMap.set(sourcePath, tests);
    }
  };

  for (const testFile of testFiles) {
    const importedSources: string[] = [];

    for (const dep of testFile.internalDependencies) {
      const resolvedPath = resolveImport(testFile.path, dep.file, sourceFilePaths);
      if (sourceFilePaths.has(resolvedPath)) {
        addCoverage(resolvedPath, testFile.path, importedSources);
        const reExportedSources = traceReExports(resolvedPath, reExportMap);
        for (const reExportedPath of reExportedSources) {
          if (sourceFilePaths.has(reExportedPath)) {
            addCoverage(reExportedPath, testFile.path, importedSources);
          }
        }
      }
    }

    // Tests may also import the package by its npm name (or a workspace name).
    for (const ws of testFile.workspaceDependencies) {
      const target = workspaceEntryPath(ws.package, ws.subpath);
      if (target && sourceFilePaths.has(target)) {
        addCoverage(target, testFile.path, importedSources);
        const reExportedSources = traceReExports(target, reExportMap);
        for (const reExportedPath of reExportedSources) {
          if (sourceFilePaths.has(reExportedPath)) {
            addCoverage(reExportedPath, testFile.path, importedSources);
          }
        }
      }
    }

    testToSourceMap.set(testFile.path, importedSources);
  }

  const testedFiles: string[] = [];
  const untestedFiles: string[] = [];
  for (const [sourcePath, tests] of coverageMap) {
    if (tests.length > 0) {
      testedFiles.push(sourcePath);
    } else {
      untestedFiles.push(sourcePath);
    }
  }

  const policy = loadCoveragePolicy(ROOT_DIR);
  const sourcePaths = sourceFiles.map((f) => f.path);
  const policyBreakdown = buildCategoryBreakdown(sourcePaths, testedFiles, untestedFiles, policy);

  return {
    sourceFiles: sourcePaths,
    testFiles,
    coverageMap,
    testedFiles,
    untestedFiles,
    testToSourceMap,
    policy,
    policyBreakdown,
  };
}

const nodeBuiltins = [
  'fs',
  'path',
  'url',
  'crypto',
  'util',
  'stream',
  'events',
  'buffer',
  'os',
  'child_process',
  'http',
  'https',
  'net',
  'dns',
  'tls',
  'zlib',
  'readline',
  'assert',
  'cluster',
  'dgram',
  'domain',
  'inspector',
  'module',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'repl',
  'string_decoder',
  'timers',
  'tty',
  'v8',
  'vm',
  'worker_threads',
];

/**
 * Parse a TypeScript file for imports and exports
 */
function parseFile(filePath: string): ParsedFile {
  const content = readFileSync(filePath, 'utf-8');
  const relativePath = relative(ROOT_DIR, filePath).replace(/\\/g, '/');

  // Determine which package this file belongs to
  let detectedPackageName: string | null = null;
  for (const [name, ws] of workspaceMap) {
    if (wsContains(ws, relativePath)) {
      detectedPackageName = name;
      break;
    }
  }

  // Strip comments for import/export parsing (prevents picking up imports in JSDoc examples)
  const code = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, ''); // Remove single-line comments

  const result: ParsedFile = {
    path: relativePath,
    name: basename(filePath, '.ts'),
    externalDependencies: [],
    nodeDependencies: [],
    internalDependencies: [],
    workspaceDependencies: [],
    packageName: detectedPackageName,
    exports: {
      named: [],
      default: null,
      types: [],
      interfaces: [],
      enums: [],
      classes: [],
      functions: [],
      constants: [],
      reExported: [],
    },
    description: extractDescription(content),
  };

  // Parse imports - enhanced to detect type-only imports
  // Matches: import type { ... }, import { type X, Y }, import X from, import * as X from
  const importRegex =
    /import\s+(type\s+)?(?:(?:{([^}]+)}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:{([^}]+)}|(\w+)))?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    const isTypeOnlyImport = !!match[1]; // "import type" prefix
    const namedImports = match[2] || match[5] || '';
    const defaultImport = match[3] || match[6] || '';
    const namespaceImport = match[4] || '';
    const source = match[7];

    const imports: string[] = [];
    let hasRuntimeImport = !isTypeOnlyImport;

    if (namedImports) {
      const importItems = namedImports.split(',').map((s) => s.trim());
      for (const item of importItems) {
        // Check for inline type imports: import { type Foo, Bar }
        const isInlineType = item.startsWith('type ');
        const name = item
          .replace(/^type\s+/, '')
          .split(' as ')[0]
          .trim();
        if (name) {
          imports.push(name);
          if (!isInlineType && !isTypeOnlyImport) {
            hasRuntimeImport = true;
          }
        }
      }
    }
    if (defaultImport) imports.push(defaultImport);
    if (namespaceImport) imports.push(`* as ${namespaceImport}`);

    const typeOnly = isTypeOnlyImport || !hasRuntimeImport;

    // Check if source is a workspace/self-package import (root or `exports` subpath)
    const wsResolved = resolveWorkspaceSource(source);

    if (source.startsWith('.')) {
      result.internalDependencies.push({
        file: source,
        imports: imports,
        typeOnly: typeOnly,
      });
    } else if (wsResolved) {
      result.workspaceDependencies.push({
        package: wsResolved.ws.name,
        directory: wsResolved.ws.directory,
        imports: imports,
        ...(wsResolved.subpath ? { subpath: wsResolved.subpath } : {}),
      });
    } else if (source.startsWith('node:') || nodeBuiltins.includes(source.split('/')[0])) {
      result.nodeDependencies.push({
        module: source.replace('node:', ''),
        imports: imports,
      });
    } else {
      result.externalDependencies.push({
        package: source,
        imports: imports,
      });
    }
  }

  // Bare side-effect imports: `import './register-backends.js';` (no bindings,
  // no `from`). Real runtime edges — the module runs for its effects — but the
  // binding-oriented importRegex never matches them, so without this pass such
  // modules were false-flagged as dormant. Relative specifiers only.
  const sideEffectImportRegex = /(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]\s*;?/g;
  while ((match = sideEffectImportRegex.exec(code)) !== null) {
    const source = match[1];
    if (!result.internalDependencies.some((d) => d.file === source)) {
      result.internalDependencies.push({ file: source, imports: [], typeOnly: false });
    }
  }

  // Destructured dynamic imports: `const { A, B } = await import('./x.js')`.
  // Handled BEFORE the generic inline-import pass so the destructured binding
  // names are recorded as imported SYMBOLS — without this, every symbol
  // consumed only through a dynamic import (e.g. the CLI's lazily-loaded
  // `startInteractiveMode`) is false-flagged as an unused export.
  const destructuredDynamicImportRegex =
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = destructuredDynamicImportRegex.exec(code)) !== null) {
    const names = match[1]
      .split(',')
      .map((s) => s.split(':')[0].trim()) // `{ a: localA }` destructures export `a`
      .filter(Boolean);
    const source = match[2];
    const existing = result.internalDependencies.find((d) => d.file === source);
    if (existing) {
      for (const n of names) if (!existing.imports.includes(n)) existing.imports.push(n);
    } else {
      result.internalDependencies.push({ file: source, imports: names, typeOnly: true, dynamic: true });
    }
  }

  // Inline import() expressions — BOTH type-position references
  // (`import('../types/index.js').Entity`, `typeof import('./x.js')`) AND
  // runtime dynamic imports (`await import('./commands/inspect.js')`). Either
  // way the referenced module is a real dependency edge the passes above
  // miss. Recorded as typeOnly (a dynamic import is lazy — it cannot create a
  // module-initialization cycle, so keeping it out of the runtime-cycle graph
  // is the safe classification) and marked `dynamic` for transparency.
  const inlineImportRegex = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = inlineImportRegex.exec(code)) !== null) {
    const source = match[1];
    if (!result.internalDependencies.some((d) => d.file === source)) {
      result.internalDependencies.push({ file: source, imports: [], typeOnly: true, dynamic: true });
    }
  }

  // Parse exports
  // Named exports: `export { foo, bar as baz }` — record the *exported* name
  // (the alias after `as`), not the local name, so the inventory reflects the
  // public surface.
  const namedExportRegex = /export\s*{\s*([^}]+)\s*}/g;
  while ((match = namedExportRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(',')
      .map((s) => {
        const parts = s.split(' as ');
        return cleanExportName(parts[parts.length - 1]);
      })
      .filter(Boolean);
    result.exports.named.push(...exports);
  }

  // export const/let/var
  const constExportRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = constExportRegex.exec(code)) !== null) {
    result.exports.constants.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export function
  const funcExportRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcExportRegex.exec(code)) !== null) {
    result.exports.functions.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export class (incl. abstract)
  const classExportRegex = /export\s+(?:abstract\s+)?class\s+(\w+)/g;
  while ((match = classExportRegex.exec(code)) !== null) {
    result.exports.classes.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export interface
  const interfaceExportRegex = /export\s+interface\s+(\w+)/g;
  while ((match = interfaceExportRegex.exec(code)) !== null) {
    result.exports.interfaces.push(match[1]);
    result.exports.types.push(match[1]);
  }

  // export type
  const typeExportRegex = /export\s+type\s+(\w+)/g;
  while ((match = typeExportRegex.exec(code)) !== null) {
    result.exports.types.push(match[1]);
  }

  // export enum
  const enumExportRegex = /export\s+(?:const\s+)?enum\s+(\w+)/g;
  while ((match = enumExportRegex.exec(code)) !== null) {
    result.exports.enums.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export default
  const defaultExportRegex = /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/;
  const defaultMatch = code.match(defaultExportRegex);
  if (defaultMatch) {
    result.exports.default = defaultMatch[1] || 'default';
  }

  // Re-exports: export * from
  const reExportAllRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportAllRegex.exec(code)) !== null) {
    const reSource = match[1];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: ['*'],
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: ['*'],
        reExport: true,
      });
    }
    result.exports.reExported.push(`* from ${reSource}`);
  }

  // Re-exports: export { foo } from
  const reExportNamedRegex = /export\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportNamedRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(',')
      .map((s) => cleanExportName(s.split(' as ')[0]))
      .filter(Boolean);
    const reSource = match[2];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: exports,
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: exports,
        reExport: true,
      });
    }
    result.exports.named.push(...exports);
    result.exports.reExported.push(...exports);
  }

  // Re-exports: export type { foo } from (named type-only re-exports). The plain
  // named regex above only matches `export {` (not `export type {`), so without
  // this every re-exported type/interface looked unused — the bulk of the
  // unused-analysis false positives.
  const reExportTypeNamedRegex = /export\s+type\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportTypeNamedRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(',')
      .map((s) => cleanExportName(s.split(' as ')[0]))
      .filter(Boolean);
    const reSource = match[2];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: exports,
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: exports,
        reExport: true,
        typeOnly: true,
      });
    }
    result.exports.named.push(...exports);
    result.exports.reExported.push(...exports);
  }

  // Re-exports: export type * from (type-only re-exports)
  const reExportTypeAllRegex = /export\s+type\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportTypeAllRegex.exec(code)) !== null) {
    const reSource = match[1];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: ['*'],
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: ['*'],
        reExport: true,
        typeOnly: true,
      });
    }
    result.exports.reExported.push(`type * from ${match[1]}`);
  }

  // Dedupe exports
  result.exports.named = [...new Set(result.exports.named)];
  result.exports.types = [...new Set(result.exports.types)];
  result.exports.reExported = [...new Set(result.exports.reExported)];

  return result;
}

/**
 * Generate a meaningful fallback description from file metadata
 */
function generateFallbackDescription(file: ParsedFile): string {
  const fileName = basename(file.path, '.ts');

  if (fileName === 'index') {
    if (file.exports.reExported.length > 0) {
      const pkgName = dirname(file.path).split('/').pop() || '';
      return `Package entry point for ${pkgName || 'module'} (re-exports ${file.exports.reExported.length} symbols)`;
    }
    if (file.exports.named.length > 0) {
      return `Entry point exporting ${file.exports.named.length} symbols`;
    }
    return `Package entry point`;
  }

  const hasOnlyTypes =
    file.exports.named.length === 0 &&
    !file.exports.default &&
    (file.exports.interfaces.length > 0 || file.exports.types.length > 0);
  if (hasOnlyTypes) {
    return `Type definitions (${file.exports.interfaces.length} interfaces, ${file.exports.types.filter((t) => !file.exports.interfaces.includes(t)).length} type aliases)`;
  }

  return `${fileName} module`;
}

/**
 * Extract file description from comments
 */
function extractDescription(content: string): string | null {
  // Try to find JSDoc comment at the top
  const jsdocMatch = content.match(/\/\*\*\s*\n([^*]*(?:\*(?!\/)[^*]*)*)\*\//);
  if (jsdocMatch) {
    const lines = jsdocMatch[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .map((line) => {
        // Extract description from @scope/package - description lines
        if (line.startsWith('@') && line.includes(' - ')) {
          return line.split(' - ').slice(1).join(' - ').trim();
        }
        return line;
      })
      .filter((line) => !line.startsWith('@') && line.length > 0)
      .filter((line) => !/^[=\-*~#_]{3,}$/.test(line));
    if (lines.length > 0) {
      return lines[0].slice(0, 120);
    }
  }

  // Try single-line comment
  const singleLineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (singleLineMatch) {
    const desc = singleLineMatch[1].trim();
    if (/^[=\-*~#_]{3,}$/.test(desc)) return null;
    return desc.slice(0, 120);
  }

  return null;
}

/**
 * Clean export name by stripping inline comments and whitespace
 */
function cleanExportName(name: string): string {
  let cleaned = name.replace(/\/\/.*$/gm, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.startsWith('type ') && !cleaned.includes('{')) {
    cleaned = cleaned.slice(5).trim();
  }
  return cleaned;
}

/**
 * Dynamically discover and categorize files into modules based on directory structure
 */
function categorizeFiles(files: ParsedFile[], monorepo: boolean = false): ModuleMap {
  const modules: ModuleMap = {};

  if (monorepo) {
    // Monorepo mode: first level = workspace package directory, second = submodule
    for (const file of files) {
      let pkgKey = 'unknown';
      for (const [, ws] of workspaceMap) {
        if (ws.directory !== '' && file.path.startsWith(ws.directory + '/')) {
          pkgKey = ws.directory;
          break;
        }
      }

      const pkgParts = pkgKey.split('/');
      const parts = file.path.split('/');
      const afterPkg = parts.slice(pkgParts.length);

      if (afterPkg.length >= 2 && afterPkg[0] === 'src') {
        if (afterPkg.length === 2) {
          if (!modules[pkgKey]) modules[pkgKey] = {};
          modules[pkgKey][file.path] = file;
        } else {
          const subModule = `${pkgKey}/${afterPkg[1]}`;
          if (!modules[subModule]) modules[subModule] = {};
          modules[subModule][file.path] = file;
        }
      } else {
        if (!modules[pkgKey]) modules[pkgKey] = {};
        modules[pkgKey][file.path] = file;
      }
    }
  } else {
    // Single-package mode
    for (const file of files) {
      const relativePath = file.path;

      // Handle entry point (src/index.ts)
      if (relativePath === 'src/index.ts') {
        if (!modules.entry) modules.entry = {};
        modules.entry[relativePath] = file;
        continue;
      }

      const parts = relativePath.split('/');
      if (parts.length >= 2 && parts[0] === 'src') {
        const moduleName = parts[1].replace('.ts', '');
        if (parts.length === 2) {
          if (!modules.root) modules.root = {};
          modules.root[relativePath] = file;
        } else {
          if (!modules[moduleName]) modules[moduleName] = {};
          modules[moduleName][relativePath] = file;
        }
      }
    }
  }

  // Remove empty modules
  for (const key of Object.keys(modules)) {
    if (Object.keys(modules[key]).length === 0) {
      delete modules[key];
    }
  }
  return modules;
}

/**
 * Build dependency matrix
 */
function buildDependencyMatrix(files: ParsedFile[]): DependencyMatrix {
  const matrix: DependencyMatrix = {};
  const filePaths = new Set(files.map((f) => f.path));

  // Precompute reverse edges in one pass (the naive O(n^2) walk is slow at 250+ files)
  const reverse = new Map<string, Set<string>>();
  for (const file of files) {
    for (const dep of file.internalDependencies) {
      const resolvedPath = resolveImport(file.path, dep.file, filePaths);
      if (!reverse.has(resolvedPath)) reverse.set(resolvedPath, new Set());
      reverse.get(resolvedPath)!.add(file.path);
    }
  }

  for (const file of files) {
    const importedFrom = new Set<string>();
    for (const dep of file.internalDependencies) {
      importedFrom.add(dep.file);
    }
    const exportsTo = reverse.get(file.path) ?? new Set<string>();
    exportsTo.delete(file.path);
    matrix[file.path] = {
      importsFrom: [...importedFrom],
      exportsTo: [...exportsTo],
    };
  }

  return matrix;
}

/**
 * Resolve relative path (naive: strips .js, appends .ts)
 */
function resolvePath(fromPath: string, relativePath: string): string {
  const dir = dirname(fromPath);
  let resolved = join(dir, relativePath);

  // Remove .js extension if present
  resolved = resolved.replace(/\.js$/, '');

  // Add .ts extension if not present
  if (!resolved.endsWith('.ts')) {
    resolved = resolved + '.ts';
  }

  // Normalize path separators
  resolved = resolved.replace(/\\/g, '/');

  return resolved;
}

/**
 * Resolve an import specifier against the known file set, with a directory
 * (`./foo` -> `foo/index.ts`) fallback. Returns the naive resolution when
 * neither candidate exists (callers membership-check against the set anyway).
 */
function resolveImport(fromPath: string, spec: string, known: Set<string>): string {
  const naive = resolvePath(fromPath, spec);
  if (known.has(naive)) return naive;
  const asIndex = naive.replace(/\.ts$/, '/index.ts');
  if (known.has(asIndex)) return asIndex;
  return naive;
}

/**
 * Find all files reachable from entry points via internal dependencies (BFS).
 * Follows relative imports (all four recorded forms) and workspace/self-name
 * imports through to the target package's entry (or subpath entry) file.
 */
function findReachableFiles(entryPoints: string[], allFiles: ParsedFile[]): Set<string> {
  const fileMap = new Map<string, ParsedFile>();
  for (const f of allFiles) fileMap.set(f.path, f);
  const known = new Set(fileMap.keys());

  const reachable = new Set<string>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const file = fileMap.get(current);
    if (!file) continue;

    for (const dep of file.internalDependencies) {
      const resolved = resolveImport(current, dep.file, known);
      if (fileMap.has(resolved) && !reachable.has(resolved)) {
        queue.push(resolved);
      }
    }

    // Package-name imports (self-imports in single-package mode; cross-package
    // scoped imports in a monorepo) reach the imported package's entry file.
    for (const ws of file.workspaceDependencies) {
      const sub = ws.subpath ? workspaceEntryPath(ws.package, ws.subpath) : undefined;
      const target = sub && fileMap.has(sub) ? sub : workspaceEntryPath(ws.package);
      if (target && fileMap.has(target) && !reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

/**
 * Resolve a package name to its entry-point file path (`<srcDir>/index.ts`,
 * or `<srcDir>/<subpath>.ts`). Returns undefined for unknown packages.
 */
function workspaceEntryPath(packageName: string, subpath?: string): string | undefined {
  const ws = workspaceMap.get(packageName);
  if (!ws) return undefined;
  return `${ws.srcDir}/${subpath ?? 'index'}.ts`;
}

/**
 * Resolve an import specifier to a known package (workspace member or the
 * package itself), including `exports` subpath entries
 * (`@scope/pkg/internal` -> pkg + subpath "internal").
 */
function resolveWorkspaceSource(
  source: string
): { ws: WorkspacePackage; subpath?: string } | undefined {
  const exact = workspaceMap.get(source);
  if (exact) return { ws: exact };
  if (source.startsWith('.')) return undefined;
  for (const [name, ws] of workspaceMap) {
    if (source.startsWith(name + '/')) {
      return { ws, subpath: source.slice(name.length + 1) };
    }
  }
  return undefined;
}

interface CircularDependencyResult {
  all: string[][];
  runtime: string[][]; // Non-type-only cycles (real runtime issues)
  typeOnly: string[][]; // Type-only cycles (safe, no runtime impact)
}

/**
 * Detect circular dependencies, distinguishing runtime from type-only cycles
 */
function detectCircularDependencies(files: ParsedFile[]): CircularDependencyResult {
  const filePaths = new Set(files.map((f) => f.path));

  // Build both runtime-only and all-dependencies graphs
  const runtimeGraph = new Map<string, string[]>();
  const allGraph = new Map<string, string[]>();

  for (const file of files) {
    const runtimeDeps: string[] = [];
    const allDeps: string[] = [];

    for (const d of file.internalDependencies) {
      const resolved = resolveImport(file.path, d.file, filePaths);
      if (filePaths.has(resolved)) {
        allDeps.push(resolved);
        if (!d.typeOnly) {
          runtimeDeps.push(resolved);
        }
      }
    }
    runtimeGraph.set(file.path, runtimeDeps);
    allGraph.set(file.path, allDeps);
  }

  function findCycles(graph: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function dfs(node: string, path: string[]): void {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          cycle.push(node);
          const cycleKey = [...cycle].sort().join('->');
          if (!cycles.some((c) => [...c].sort().join('->') === cycleKey)) {
            cycles.push(cycle);
          }
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor, path);
      }

      path.pop();
      inStack.delete(node);
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  const allCycles = findCycles(allGraph);
  const runtimeCycles = findCycles(runtimeGraph);

  const runtimeCycleKeys = new Set(runtimeCycles.map((c) => [...c].sort().join('->')));
  const typeOnlyCycles = allCycles.filter((c) => !runtimeCycleKeys.has([...c].sort().join('->')));

  return {
    all: allCycles,
    runtime: runtimeCycles,
    typeOnly: typeOnlyCycles,
  };
}

interface PublicSurface {
  /** Files whose ENTIRE export list is public (reached by a wildcard `export *`
   *  chain from a package root, or is itself a root). */
  publicWildcardFiles: Set<string>;
  /** `${path}::${name}` for individually named-re-exported public exports. */
  publicNamed: Set<string>;
  /** Public roots beyond `src/index.ts`: `exports` subpath entries, `bin`
   *  targets, tsup/script/tsconfig entries, and config-referenced entries. */
  extraEntryPaths: Set<string>;
}

/**
 * Compute the package public-API surface: any export surfaced through
 * `src/index.ts` (or an equally-public root — an `exports` subpath entry, a
 * `bin` target, a tsup/script build entry, or a config-referenced entry) —
 * directly, or re-exported into one via `export … from` (transitively) — is
 * the package's external surface. Shared by `detectUnused` (a public export
 * isn't "unused") and `buildDuplicateEntries` (a public export is a real
 * canonical-candidate signal).
 */
function computePublicSurface(files: ParsedFile[]): PublicSurface {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const known = new Set(byPath.keys());
  const publicWildcardFiles = new Set<string>();
  const publicNamed = new Set<string>();

  const markPublic = (file: ParsedFile, seen: Set<string>): void => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    publicWildcardFiles.add(file.path); // the file's own exports are public
    for (const dep of file.internalDependencies) {
      if (!dep.reExport) continue;
      const target = byPath.get(resolveImport(file.path, dep.file, known));
      if (!target) continue;
      if (dep.imports.includes('*')) {
        markPublic(target, seen); // export * -> every export of the source is public
      } else {
        for (const name of dep.imports) publicNamed.add(`${target.path}::${name}`);
      }
    }
  };

  const extraEntryPaths = new Set<string>();
  for (const ws of workspaceMap.values()) {
    for (const entry of ws.extraEntries) extraEntryPaths.add(entry);
  }
  // Config-referenced roots (bundler alias / entry targets) are entry points
  // too — nothing imports them by design.
  for (const entry of configReferencedEntries(ROOT_DIR)) extraEntryPaths.add(entry);
  for (const file of files) {
    if (
      file.path === 'src/index.ts' ||
      file.path.endsWith('/src/index.ts') ||
      extraEntryPaths.has(file.path)
    ) {
      markPublic(file, new Set());
    }
  }

  return { publicWildcardFiles, publicNamed, extraEntryPaths };
}

/**
 * Detect unused files and exports
 */
function detectUnused(files: ParsedFile[], testFiles: ParsedFile[] = []): UnusedAnalysis {
  const filePaths = new Set(files.map((f) => f.path));

  const importedFiles = new Set<string>();
  const importedSymbols = new Map<string, Set<string>>();

  // Walk source files + test files so test-only imports register as legitimate
  // consumers and don't false-flag exported test helpers.
  for (const file of [...files, ...testFiles]) {
    for (const dep of file.internalDependencies) {
      const resolved = resolveImport(file.path, dep.file, filePaths);
      if (filePaths.has(resolved)) {
        importedFiles.add(resolved);

        if (!importedSymbols.has(resolved)) {
          importedSymbols.set(resolved, new Set());
        }
        const symbols = importedSymbols.get(resolved)!;
        for (const imp of dep.imports) {
          if (imp === '*' || imp.startsWith('* as ')) {
            // Wildcard OR namespace import (`import * as X`) — every export of the
            // source is reachable (X.foo), so mark all as used.
            symbols.add('*');
          } else {
            symbols.add(imp);
          }
        }
      }
    }

    // Package-name imports count as use of the imported package's entry-point
    // file (and the symbols listed in the import).
    for (const ws of file.workspaceDependencies) {
      const sub = ws.subpath ? workspaceEntryPath(ws.package, ws.subpath) : undefined;
      const target = sub && filePaths.has(sub) ? sub : workspaceEntryPath(ws.package);
      if (!target || !filePaths.has(target)) continue;
      importedFiles.add(target);
      if (!importedSymbols.has(target)) importedSymbols.set(target, new Set());
      const symbols = importedSymbols.get(target)!;
      for (const imp of ws.imports) {
        if (imp === '*' || imp.startsWith('* as ')) {
          symbols.add('*');
        } else {
          symbols.add(imp);
        }
      }
    }
  }

  // Public-API surface: any export surfaced through src/index.ts (directly or
  // re-exported into it transitively) is external surface, consumed by end
  // users, not internal files. Flagging it as "unused" is a false positive.
  const { publicWildcardFiles, publicNamed, extraEntryPaths } = computePublicSurface(files);

  // Find unused files (excluding entry points and re-export hubs)
  const unusedFiles: string[] = [];
  for (const file of files) {
    if (file.path === 'src/index.ts' || file.path.endsWith('/src/index.ts')) continue;
    if (file.name === 'index' && file.exports.reExported.length > 0) continue; // Re-export hubs
    // Entry/build-root files — nothing imports them by design (CLI bin entries,
    // workers loaded at runtime from dist/).
    if (extraEntryPaths.has(file.path)) continue;
    if (!importedFiles.has(file.path)) {
      unusedFiles.push(file.path);
    }
  }

  // Find unused exports
  const unusedExports: UnusedExport[] = [];
  for (const file of files) {
    // Package public-API hub: all its exports are the external surface.
    if (publicWildcardFiles.has(file.path)) continue;

    const usedSymbols = importedSymbols.get(file.path);
    const isWildcardImported = usedSymbols?.has('*');

    if (!usedSymbols || isWildcardImported) continue;

    // A named export that is re-exported into a package index is public API.
    const isPublic = (name: string): boolean =>
      usedSymbols.has(name) || publicNamed.has(`${file.path}::${name}`);

    // In-file reference count: occurrences of the symbol in its own file beyond
    // the export definition. Splits "type contract / helper backing live exports"
    // (refs > 0) from "unreferenced anywhere" (refs = 0, the deletion candidates).
    let fileContent: string | undefined;
    const inFileRefs = (name: string): number => {
      if (fileContent === undefined) {
        try {
          fileContent = readFileSync(join(ROOT_DIR, file.path), 'utf-8');
        } catch {
          fileContent = '';
        }
      }
      const all = (fileContent.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      const defs = (
        fileContent.match(
          new RegExp(
            `export\\s+(?:async\\s+)?(?:function|const|let|var|class|abstract\\s+class|interface|type|enum)\\s+${name}\\b`,
            'g'
          )
        ) || []
      ).length;
      return Math.max(0, all - defs);
    };
    const push = (name: string, type: UnusedExport['type']): void => {
      unusedExports.push({ file: file.path, name, type, inFileRefs: inFileRefs(name) });
    };

    for (const fn of file.exports.functions) {
      if (!isPublic(fn)) push(fn, 'function');
    }
    for (const cls of file.exports.classes) {
      if (!isPublic(cls)) push(cls, 'class');
    }
    for (const iface of file.exports.interfaces) {
      if (!isPublic(iface)) push(iface, 'interface');
    }
    for (const type of file.exports.types) {
      if (!isPublic(type) && !file.exports.interfaces.includes(type)) push(type, 'type');
    }
    for (const en of file.exports.enums) {
      if (!isPublic(en)) push(en, 'enum');
    }
    for (const constant of file.exports.constants) {
      if (!isPublic(constant)) push(constant, 'constant');
    }
  }

  return { unusedFiles, unusedExports };
}

/**
 * Generate statistics from parsed files
 */
function generateStatistics(
  files: ParsedFile[],
  modules: ModuleMap,
  circularDeps: CircularDependencyResult,
  unusedAnalysis: UnusedAnalysis,
  reach: {
    roots: Set<string>;
    reachable: Set<string>;
    dormant: string[];
    orphaned: string[];
    testOnly: string[];
  }
): Statistics {
  let totalExports = 0;
  let totalClasses = 0;
  let totalInterfaces = 0;
  let totalFunctions = 0;
  let totalTypeGuards = 0;
  let totalEnums = 0;
  let totalConstants = 0;
  let totalLines = 0;
  let totalReExports = 0;
  let totalTypeOnlyImports = 0;

  for (const file of files) {
    totalExports += file.exports.named.length;
    totalClasses += file.exports.classes.length;
    totalInterfaces += file.exports.interfaces.length;
    totalFunctions += file.exports.functions.length;
    totalEnums += file.exports.enums.length;
    totalConstants += file.exports.constants.length;
    totalReExports += file.exports.reExported.length;

    totalTypeOnlyImports += file.internalDependencies.filter((d) => d.typeOnly).length;
    totalTypeGuards += file.exports.functions.filter((f) => f.startsWith('is')).length;

    try {
      const content = readFileSync(join(ROOT_DIR, file.path), 'utf-8');
      totalLines += content.split('\n').length;
    } catch {
      // Ignore
    }
  }

  return {
    totalTypeScriptFiles: files.length,
    totalModules: Object.keys(modules).length,
    totalLinesOfCode: totalLines,
    totalExports,
    totalClasses,
    totalInterfaces,
    totalFunctions,
    totalTypeGuards,
    totalEnums,
    totalConstants,
    totalReExports,
    totalTypeOnlyImports,
    runtimeCircularDeps: circularDeps.runtime.length,
    typeOnlyCircularDeps: circularDeps.typeOnly.length,
    entryRoots: reach.roots.size,
    reachableFiles: reach.reachable.size,
    dormantFiles: reach.dormant.length,
    orphanedFiles: reach.orphaned.length,
    testOnlyFiles: reach.testOnly.length,
    unusedFilesCount: unusedAnalysis.unusedFiles.length,
    unusedExportsCount: unusedAnalysis.unusedExports.length,
  };
}

/**
 * Generate JSON output
 */
function generateJSON(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  roots: Set<string>,
  dormant: { orphaned: string[]; testOnly: string[] }
): object {
  const today = new Date().toISOString().split('T')[0];

  // Convert modules to JSON-friendly format
  const modulesJson: Record<string, Record<string, object>> = {};
  for (const [category, categoryFiles] of Object.entries(modules)) {
    modulesJson[category] = {};
    for (const [path, file] of Object.entries(categoryFiles)) {
      const fileData: Record<string, unknown> = {
        description: file.description || generateFallbackDescription(file),
        externalDependencies: file.externalDependencies,
        nodeDependencies: file.nodeDependencies,
        internalDependencies: file.internalDependencies.map((d) => ({
          file: d.file,
          imports: d.imports,
          ...(d.reExport ? { reExport: true } : {}),
          ...(d.typeOnly ? { typeOnly: true } : {}),
          ...(d.dynamic ? { dynamic: true } : {}),
        })),
        workspaceDependencies:
          file.workspaceDependencies.length > 0 ? file.workspaceDependencies : undefined,
        exports: file.exports.named,
        reExported: file.exports.reExported.length > 0 ? file.exports.reExported : undefined,
        classes: file.exports.classes.length > 0 ? file.exports.classes : undefined,
        interfaces: file.exports.interfaces.length > 0 ? file.exports.interfaces : undefined,
        functions: file.exports.functions.length > 0 ? file.exports.functions : undefined,
        enums: file.exports.enums.length > 0 ? file.exports.enums : undefined,
        constants: file.exports.constants.length > 0 ? file.exports.constants : undefined,
      };

      Object.keys(fileData).forEach((key) => {
        if (fileData[key] === undefined) {
          delete fileData[key];
        }
      });

      modulesJson[category][path] = fileData;
    }
  }

  // Build layers from modules
  const layers = Object.keys(modules)
    .map((name) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      files: Object.keys(modules[name]),
    }))
    .filter((l) => l.files.length > 0);

  const byPath = new Map(files.map((f) => [f.path, f] as const));
  return {
    metadata: {
      name: packageJson.name,
      version: packageJson.version,
      lastUpdated: today,
      totalFiles: stats.totalTypeScriptFiles,
      totalModules: stats.totalModules,
      totalExports: stats.totalExports,
    },
    entryPoints: [...roots].sort().map((p) => ({
      file: p,
      type:
        p === 'src/index.ts' || p.endsWith('/src/index.ts')
          ? 'main'
          : /\/cli\//.test(p)
            ? 'bin'
            : 'build-entry',
      description: byPath.get(p)?.description || 'Entry Point',
    })),
    modules: modulesJson,
    dependencyGraph: {
      circularDependencies: {
        runtime: circularDeps.runtime,
        typeOnly: circularDeps.typeOnly,
        total: circularDeps.all.length,
        runtimeCount: circularDeps.runtime.length,
        typeOnlyCount: circularDeps.typeOnly.length,
      },
      layers,
    },
    reachability: {
      roots: [...roots].sort(),
      reachableCount: stats.reachableFiles,
      dormantCount: stats.dormantFiles,
      orphaned: dormant.orphaned,
      testOnly: dormant.testOnly,
    },
    statistics: stats,
  };
}

/**
 * Generate a dynamic Mermaid diagram from actual dependencies
 */
function generateMermaidDiagram(modules: ModuleMap, files: ParsedFile[]): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('graph TD');

  const moduleNames = Object.keys(modules);
  const nodeIds = new Map<string, string>();
  let nodeCounter = 0;

  for (const moduleName of moduleNames) {
    const title = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    lines.push(`    subgraph ${title}`);

    const moduleFiles = Object.keys(modules[moduleName]);
    for (const filePath of moduleFiles.slice(0, 10)) {
      // Limit to 10 files per module for readability
      const name = basename(filePath, '.ts');
      const nodeId = `N${nodeCounter++}`;
      nodeIds.set(filePath, nodeId);
      lines.push(`        ${nodeId}[${name}]`);
    }

    if (moduleFiles.length > 10) {
      const nodeId = `N${nodeCounter++}`;
      lines.push(`        ${nodeId}[...${moduleFiles.length - 10} more]`);
    }

    lines.push('    end');
    lines.push('');
  }

  // Add edges for dependencies (limited for readability)
  const addedEdges = new Set<string>();
  let edgeCount = 0;
  const maxEdges = 75;
  const known = new Set(files.map((f) => f.path));

  for (const file of files) {
    const sourceId = nodeIds.get(file.path);
    if (!sourceId) continue;

    for (const dep of file.internalDependencies) {
      if (edgeCount >= maxEdges) break;

      const resolved = resolveImport(file.path, dep.file, known);
      const targetId = nodeIds.get(resolved);

      if (targetId && sourceId !== targetId) {
        const edgeKey = `${sourceId}-${targetId}`;
        if (!addedEdges.has(edgeKey)) {
          lines.push(`    ${sourceId} --> ${targetId}`);
          addedEdges.add(edgeKey);
          edgeCount++;
        }
      }
    }
  }

  lines.push('```');
  return lines.join('\n');
}

/**
 * Generate Markdown output
 */
function generateMarkdown(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  matrix: DependencyMatrix,
  roots: Set<string>
): string {
  const today = new Date().toISOString().split('T')[0];
  const lines: string[] = [];
  const projectName = packageJson.name || 'Project';

  lines.push(`# ${projectName} - Dependency Graph`);
  lines.push('');
  lines.push(`**Version**: ${packageJson.version} | **Last Updated**: ${today}`);
  lines.push('');
  lines.push(
    'This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.'
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');
  lines.push('1. [Overview](#overview)');
  lines.push('2. [Entry Points & Reachability](#entry-points--reachability)');
  let tocIndex = 3;
  for (const category of Object.keys(modules)) {
    const title = category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ');
    const slug = category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    lines.push(`${tocIndex}. [${title} Dependencies](#${slug}-dependencies)`);
    tocIndex++;
  }
  lines.push(`${tocIndex}. [Dependency Matrix](#dependency-matrix)`);
  lines.push(`${tocIndex + 1}. [Circular Dependency Analysis](#circular-dependency-analysis)`);
  lines.push(`${tocIndex + 2}. [Visual Dependency Graph](#visual-dependency-graph)`);
  lines.push(`${tocIndex + 3}. [Summary Statistics](#summary-statistics)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Overview
  lines.push('<a id="overview"></a>');
  lines.push('## Overview');
  lines.push('');
  lines.push('The codebase is organized into the following modules:');
  lines.push('');
  for (const [moduleName, moduleFiles] of Object.entries(modules)) {
    const fileCount = Object.keys(moduleFiles).length;
    lines.push(`- **${moduleName}**: ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Entry points & reachability
  lines.push('<a id="entry-points--reachability"></a>');
  lines.push('## Entry Points & Reachability');
  lines.push('');
  lines.push(
    'Seeded build/entry roots (package `exports`, `bin` targets, tsup entries, script entries):'
  );
  lines.push('');
  for (const root of [...roots].sort()) {
    lines.push(`- \`${root}\``);
  }
  lines.push('');
  lines.push(
    `Reachable from a root: **${stats.reachableFiles}** of ${stats.totalTypeScriptFiles} files. ` +
      `Dormant: **${stats.dormantFiles}** (${stats.orphanedFiles} orphaned, ` +
      `${stats.testOnlyFiles} test-only) — see \`unused-analysis.md\` for the file lists.`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // Generate sections for each module category
  for (const [category, categoryFiles] of Object.entries(modules)) {
    const title = category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ');
    const sectionSlug = category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    lines.push(`<a id="${sectionSlug}-dependencies"></a>`);
    lines.push('');
    lines.push(`## ${title} Dependencies`);
    lines.push('');

    for (const [path, file] of Object.entries(categoryFiles)) {
      lines.push(`### \`${path}\` - ${file.description || generateFallbackDescription(file)}`);
      lines.push('');

      if (file.externalDependencies.length > 0) {
        lines.push('**External Dependencies:**');
        lines.push('| Package | Import |');
        lines.push('|---------|--------|');
        for (const dep of file.externalDependencies) {
          lines.push(`| \`${dep.package}\` | \`${dep.imports.join(', ')}\` |`);
        }
        lines.push('');
      }

      if (file.workspaceDependencies.length > 0) {
        lines.push('**Package Dependencies (self/workspace):**');
        lines.push('| Package | Import |');
        lines.push('|---------|--------|');
        for (const dep of file.workspaceDependencies) {
          lines.push(`| \`${dep.package}\` | \`${dep.imports.join(', ')}\` |`);
        }
        lines.push('');
      }

      if (file.nodeDependencies.length > 0) {
        lines.push('**Node.js Built-in Dependencies:**');
        lines.push('| Module | Import |');
        lines.push('|--------|--------|');
        for (const dep of file.nodeDependencies) {
          lines.push(`| \`${dep.module}\` | \`${dep.imports.join(', ')}\` |`);
        }
        lines.push('');
      }

      if (file.internalDependencies.length > 0) {
        lines.push('**Internal Dependencies:**');
        lines.push('| File | Imports | Type |');
        lines.push('|------|---------|------|');
        for (const dep of file.internalDependencies) {
          let usage = dep.reExport ? 'Re-export' : dep.dynamic ? 'Dynamic import' : 'Import';
          if (dep.typeOnly && !dep.dynamic) usage += ' (type-only)';
          lines.push(`| \`${dep.file}\` | \`${dep.imports.join(', ')}\` | ${usage} |`);
        }
        lines.push('');
      }

      if (
        file.exports.named.length > 0 ||
        file.exports.default ||
        file.exports.reExported.length > 0 ||
        file.exports.interfaces.length > 0 ||
        file.exports.types.length > 0
      ) {
        lines.push('**Exports:**');
        if (file.exports.classes.length > 0) {
          lines.push(`- Classes: \`${file.exports.classes.join('`, `')}\``);
        }
        if (file.exports.interfaces.length > 0) {
          lines.push(`- Interfaces: \`${file.exports.interfaces.join('`, `')}\``);
        }
        const typeAliases = file.exports.types.filter((t) => !file.exports.interfaces.includes(t));
        if (typeAliases.length > 0) {
          lines.push(`- Types: \`${typeAliases.join('`, `')}\``);
        }
        if (file.exports.enums.length > 0) {
          lines.push(`- Enums: \`${file.exports.enums.join('`, `')}\``);
        }
        if (file.exports.functions.length > 0) {
          lines.push(`- Functions: \`${file.exports.functions.join('`, `')}\``);
        }
        if (file.exports.constants.length > 0) {
          lines.push(`- Constants: \`${file.exports.constants.join('`, `')}\``);
        }
        if (file.exports.reExported.length > 0) {
          lines.push(`- Re-exports: \`${file.exports.reExported.join('`, `')}\``);
        }
        if (file.exports.default) {
          lines.push(`- Default: \`${file.exports.default}\``);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  // Dependency Matrix
  lines.push('<a id="dependency-matrix"></a>');
  lines.push('## Dependency Matrix');
  lines.push('');
  lines.push('### File Import/Export Matrix (top 40 by connectivity)');
  lines.push('');
  lines.push('| File | Imports From | Exports To |');
  lines.push('|------|--------------|------------|');

  const matrixEntries = Object.entries(matrix)
    .sort(
      (a, b) =>
        b[1].importsFrom.length +
        b[1].exportsTo.length -
        (a[1].importsFrom.length + a[1].exportsTo.length)
    )
    .slice(0, 40);
  for (const [filePath, deps] of matrixEntries) {
    const shortPath = filePath.replace(/\.ts$/, '');
    const importsCount = deps.importsFrom.length;
    const exportsCount = deps.exportsTo.length;
    lines.push(
      `| \`${shortPath}\` | ${importsCount} file${importsCount !== 1 ? 's' : ''} | ${exportsCount} file${exportsCount !== 1 ? 's' : ''} |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Circular Dependencies
  lines.push('<a id="circular-dependency-analysis"></a>');
  lines.push('## Circular Dependency Analysis');
  lines.push('');
  if (circularDeps.all.length === 0) {
    lines.push('**No circular dependencies detected.**');
  } else {
    lines.push(`**${circularDeps.all.length} circular dependencies detected:**`);
    lines.push('');
    lines.push(`- **Runtime cycles**: ${circularDeps.runtime.length} (require attention)`);
    lines.push(`- **Type-only cycles**: ${circularDeps.typeOnly.length} (safe, no runtime impact)`);
    lines.push('');

    if (circularDeps.runtime.length > 0) {
      lines.push('### Runtime Circular Dependencies');
      lines.push('');
      lines.push('These cycles involve runtime imports and may cause issues:');
      lines.push('');
      for (const cycle of circularDeps.runtime.slice(0, 10)) {
        lines.push(`- ${cycle.join(' -> ')}`);
      }
      if (circularDeps.runtime.length > 10) {
        lines.push(`- ... and ${circularDeps.runtime.length - 10} more`);
      }
      lines.push('');
    }

    if (circularDeps.typeOnly.length > 0) {
      lines.push('### Type-Only Circular Dependencies');
      lines.push('');
      lines.push('These cycles only involve type imports and are safe (erased at runtime):');
      lines.push('');
      for (const cycle of circularDeps.typeOnly.slice(0, 10)) {
        lines.push(`- ${cycle.join(' -> ')}`);
      }
      if (circularDeps.typeOnly.length > 10) {
        lines.push(`- ... and ${circularDeps.typeOnly.length - 10} more`);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');

  // Visual Dependency Graph
  lines.push('<a id="visual-dependency-graph"></a>');
  lines.push('## Visual Dependency Graph');
  lines.push('');
  lines.push(generateMermaidDiagram(modules, files));
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary Statistics
  lines.push('<a id="summary-statistics"></a>');
  lines.push('## Summary Statistics');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  lines.push(`| Total TypeScript Files | ${stats.totalTypeScriptFiles} |`);
  lines.push(`| Total Modules | ${stats.totalModules} |`);
  lines.push(`| Total Lines of Code | ${stats.totalLinesOfCode} |`);
  lines.push(`| Total Exports | ${stats.totalExports} |`);
  lines.push(`| Total Re-exports | ${stats.totalReExports} |`);
  lines.push(`| Total Classes | ${stats.totalClasses} |`);
  lines.push(`| Total Interfaces | ${stats.totalInterfaces} |`);
  lines.push(`| Total Functions | ${stats.totalFunctions} |`);
  lines.push(`| Total Type Guards | ${stats.totalTypeGuards} |`);
  lines.push(`| Total Enums | ${stats.totalEnums} |`);
  lines.push(`| Type-only Imports | ${stats.totalTypeOnlyImports} |`);
  lines.push(`| Runtime Circular Deps | ${stats.runtimeCircularDeps} |`);
  lines.push(`| Type-only Circular Deps | ${stats.typeOnlyCircularDeps} |`);
  lines.push(`| Entry/Build Roots | ${stats.entryRoots} |`);
  lines.push(`| Reachable Files | ${stats.reachableFiles} |`);
  lines.push(`| Dormant Files (orphaned / test-only) | ${stats.dormantFiles} (${stats.orphanedFiles} / ${stats.testOnlyFiles}) |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*Last Updated*: ${today}`);
  lines.push(`*Version*: ${packageJson.version}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate compact summary for LLM consumption (~10KB target)
 * Uses CTON-style compression: no whitespace, abbreviated keys
 */
function generateCompactSummary(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult
): string {
  const summary = {
    m: {
      // metadata
      n: packageJson.name,
      v: packageJson.version,
      d: new Date().toISOString().split('T')[0],
      f: stats.totalTypeScriptFiles,
      e: stats.totalExports,
      re: stats.totalReExports,
    },
    s: {
      // statistics
      loc: stats.totalLinesOfCode,
      cls: stats.totalClasses,
      int: stats.totalInterfaces,
      fn: stats.totalFunctions,
      tg: stats.totalTypeGuards,
      en: stats.totalEnums,
      co: stats.totalConstants,
      toi: stats.totalTypeOnlyImports,
      rf: stats.reachableFiles,
      df: stats.dormantFiles,
    },
    c: {
      // circular deps
      rt: circularDeps.runtime.length,
      to: circularDeps.typeOnly.length,
      rtp: circularDeps.runtime
        .slice(0, 5)
        .map((c) => c.map((p) => p.split('/').pop()?.replace('.ts', '')).join('→')),
    },
    mod: {} as Record<string, { f: number; exp: string[]; cls?: string[]; int?: string[] }>,
    // Hot paths: files with most dependencies
    hp: [] as { p: string; i: number; o: number }[],
  };

  for (const [modName, modFiles] of Object.entries(modules)) {
    const fileList = Object.values(modFiles);
    const exports = fileList
      .flatMap((f) => f.exports.named)
      .map(cleanExportName)
      .filter(Boolean)
      .slice(0, 20);
    const classes = fileList.flatMap((f) => f.exports.classes);
    const interfaces = fileList.flatMap((f) => f.exports.interfaces).slice(0, 10);

    summary.mod[modName] = {
      f: Object.keys(modFiles).length,
      exp: [...new Set(exports)],
    };
    if (classes.length > 0) summary.mod[modName].cls = [...new Set(classes)];
    if (interfaces.length > 0) summary.mod[modName].int = [...new Set(interfaces)];
  }

  // Find hot paths (files with highest connectivity) — one reverse-edge pass
  const known = new Set(files.map((f) => f.path));
  const inbound = new Map<string, number>();
  for (const f of files) {
    for (const d of f.internalDependencies) {
      const resolved = resolveImport(f.path, d.file, known);
      inbound.set(resolved, (inbound.get(resolved) ?? 0) + 1);
    }
  }
  const connectivity = files
    .map((f) => ({
      p: f.path.split('/').slice(-2).join('/'),
      i: f.internalDependencies.length,
      o: inbound.get(f.path) ?? 0,
    }))
    .sort((a, b) => b.i + b.o - (a.i + a.o));

  summary.hp = connectivity.slice(0, 15);

  return JSON.stringify(summary);
}

/**
 * Generate test coverage analysis markdown
 */
function generateTestCoverageMarkdown(coverage: TestCoverageAnalysis): string {
  const lines: string[] = [];
  const today = new Date().toISOString().split('T')[0];

  lines.push('# Test Coverage Analysis');
  lines.push('');
  lines.push(`**Generated**: ${today}`);
  lines.push('');

  const totalSource = coverage.sourceFiles.length;
  const totalTested = coverage.testedFiles.length;
  const totalUntested = coverage.untestedFiles.length;
  const coveragePercent = totalSource > 0 ? ((totalTested / totalSource) * 100).toFixed(1) : '0';

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Source Files | ${totalSource} |`);
  lines.push(`| Total Test Files | ${coverage.testFiles.length} |`);
  lines.push(`| Source Files with Tests | ${totalTested} |`);
  lines.push(`| Source Files without Tests | ${totalUntested} |`);
  lines.push(`| Coverage (raw, direct-import) | **${coveragePercent}%** |`);

  // Effective-coverage companion metric — only emitted when a
  // coverage-policy.json was loaded successfully.
  const b = coverage.policyBreakdown;
  if (coverage.policy) {
    lines.push(
      `| Coverage (effective, active code only) | **${b.effectivePercent}%** (${b.testedActive} / ${b.activeFiles}) |`
    );
    lines.push('');
    lines.push(
      '> The raw figure counts every source file the tool finds, including code that is intentionally not direct-imported by a test. The **effective** figure excludes those per `docs/architecture/coverage-policy.json` so the number reflects genuinely-active code only.'
    );
    lines.push('');
    lines.push('### Untested-file breakdown by category');
    lines.push('');
    lines.push('| Category | Count | Why it is intentionally untested |');
    lines.push('|---|---:|---|');
    for (const [id, cat] of Object.entries(coverage.policy.categories)) {
      const count = b.byCategory[id] ?? 0;
      if (count === 0) continue;
      lines.push(`| **${cat.label}** | ${count} | ${cat.rationale.split('.')[0]}. |`);
    }
    const activeUntested = b.byCategory.active_untested ?? 0;
    lines.push(
      `| **Active (real gap — needs a test)** | ${activeUntested} | These are the files that should grow a direct-import test. |`
    );
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  lines.push('## Source Files Without Test Coverage');
  lines.push('');
  if (coverage.untestedFiles.length === 0) {
    lines.push('**All source files have test coverage!**');
  } else {
    lines.push(
      `The following ${coverage.untestedFiles.length} source files are not directly imported by any test file:`
    );
    lines.push('');

    const byModule = new Map<string, string[]>();
    for (const file of coverage.untestedFiles) {
      const parts = file.split('/');
      const module = parts.length >= 3 ? parts[1] : 'root';
      if (!byModule.has(module)) byModule.set(module, []);
      byModule.get(module)!.push(file);
    }

    for (const [module, files] of byModule) {
      lines.push(`### ${module}/`);
      lines.push('');
      for (const file of files.sort()) {
        const fileName = basename(file, '.ts');
        lines.push(`- \`${file}\` → Expected test: \`tests/unit/${module}/${fileName}.test.ts\``);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');

  lines.push('## Source Files With Test Coverage');
  lines.push('');
  lines.push('| Source File | Test Files |');
  lines.push('|-------------|------------|');

  const sortedTested = [...coverage.testedFiles].sort();
  for (const sourcePath of sortedTested) {
    const tests = coverage.coverageMap.get(sourcePath) || [];
    const shortSource = sourcePath.split('/').slice(-2).join('/');
    const shortTests = tests.map((t) => `\`${basename(t)}\``).join(', ');
    lines.push(`| \`${shortSource}\` | ${shortTests} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Test File Details');
  lines.push('');
  lines.push('| Test File | Imports from Source |');
  lines.push('|-----------|---------------------|');

  for (const [testPath, sources] of coverage.testToSourceMap) {
    const shortTest = testPath.split('/').slice(-2).join('/');
    const sourceCount = sources.length;
    lines.push(`| \`${shortTest}\` | ${sourceCount} files |`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate test coverage JSON
 */
function generateTestCoverageJson(coverage: TestCoverageAnalysis): object {
  const coverageMapObj: Record<string, string[]> = {};
  for (const [source, tests] of coverage.coverageMap) {
    coverageMapObj[source] = tests;
  }

  const testToSourceObj: Record<string, string[]> = {};
  for (const [test, sources] of coverage.testToSourceMap) {
    testToSourceObj[test] = sources;
  }

  const b = coverage.policyBreakdown;
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSourceFiles: coverage.sourceFiles.length,
      totalTestFiles: coverage.testFiles.length,
      testedCount: coverage.testedFiles.length,
      untestedCount: coverage.untestedFiles.length,
      coveragePercent:
        coverage.sourceFiles.length > 0
          ? ((coverage.testedFiles.length / coverage.sourceFiles.length) * 100).toFixed(1)
          : '0',
      effectiveCoverage: {
        policyLoaded: coverage.policy !== null,
        activeFiles: b.activeFiles,
        testedActive: b.testedActive,
        activeUntested: b.byCategory.active_untested ?? 0,
        excludedTotal: b.excludedTotal,
        percent: b.effectivePercent,
        breakdown: b.byCategory,
      },
    },
    untestedFiles: coverage.untestedFiles.sort(),
    testedFiles: coverage.testedFiles.sort(),
    coverageMap: coverageMapObj,
    testToSourceMap: testToSourceObj,
    classifiedUntested: b.classifiedUntested.slice().sort((a, c) => a.file.localeCompare(c.file)),
  };
}

/**
 * Generate package-level dependency markdown section for monorepo mode.
 */
function generatePackageDependencySection(
  parsedFiles: ParsedFile[],
  workspaces: Map<string, WorkspacePackage>,
  reachableFiles?: Set<string>,
  dormantFiles?: Set<string>
): string {
  const lines: string[] = [];

  lines.push('<a id="package-dependencies"></a>');
  lines.push('## Package Dependencies');
  lines.push('');

  const pkgDeps = new Map<string, Set<string>>();
  for (const [name] of workspaces) pkgDeps.set(name, new Set());

  for (const file of parsedFiles) {
    if (!file.packageName) continue;
    if (reachableFiles && !reachableFiles.has(file.path)) continue;
    for (const wsDep of file.workspaceDependencies) {
      if (wsDep.package !== file.packageName) {
        pkgDeps.get(file.packageName)?.add(wsDep.package);
      }
    }
  }

  lines.push('| Package | Depends On | Files (Active) | Files (Dormant) |');
  lines.push('|---------|------------|----------------|-----------------|');

  for (const [name, ws] of workspaces) {
    const deps = pkgDeps.get(name);
    const depStr = deps && deps.size > 0 ? [...deps].map((d) => `\`${d}\``).join(', ') : '(none)';

    const pkgFiles = parsedFiles.filter((f) => f.packageName === name);
    const activeCount = reachableFiles
      ? pkgFiles.filter((f) => reachableFiles.has(f.path)).length
      : pkgFiles.length;
    const dormantCount = dormantFiles ? pkgFiles.filter((f) => dormantFiles.has(f.path)).length : 0;

    lines.push(
      `| \`${name}\` (\`${ws.directory}/\`) | ${depStr} | ${activeCount} | ${dormantCount} |`
    );
  }

  lines.push('');
  lines.push('### Package Dependency Diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph LR');

  const pkgIds = new Map<string, string>();
  let idx = 0;
  for (const [name, ws] of workspaces) {
    const id = `P${idx++}`;
    pkgIds.set(name, id);
    lines.push(`    ${id}[${ws.directory || name}]`);
  }

  for (const [name, deps] of pkgDeps) {
    const sourceId = pkgIds.get(name);
    if (!sourceId || !deps) continue;
    for (const dep of deps) {
      const targetId = pkgIds.get(dep);
      if (targetId) {
        lines.push(`    ${sourceId} --> ${targetId}`);
      }
    }
  }

  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Duplicate-symbol detection: names that are OWN-defined (not merely
 * re-exported) by >= 2 distinct files. This is the measurement that scopes a
 * consolidation campaign — the companion `check-duplicates.mjs` gates new
 * TRUE_DUPLICATE names against `docs/architecture/duplicate-baseline.json`.
 *
 * A "definer" is a file that OWNS a symbol's implementation body — the name is
 * in that file's own `functions`/`constants`/`classes` (runtime) or
 * `interfaces`/`types`/`enums` (type) export list AND is NOT also in that
 * file's `reExported` list (a name landing there is a FORWARD, not an
 * independent body).
 *
 * Classification (adapted from the MathTS original; the mathTyped
 * DISPATCH_VARIANT category is dropped — MemoryJS has no typed-dispatch layer):
 * - `ALLOWLISTED` — matches `duplicate-allowlist.json` (human-curated).
 * - `ALIAS_DELEGATION` — `export const X = Y` where `Y` is bound by an
 *   `import` in the same file — a forward, not an independent body.
 * - `PLAIN` — a genuine own-defined body.
 * Entry tags: TRUE_DUPLICATE (actionable) | ALIAS_DELEGATION | ALLOWLISTED.
 */
type RuntimeSymbolCategory = 'function' | 'constant' | 'class';
type TypeSymbolCategory = 'interface' | 'type' | 'enum';
type DupExportKey = 'functions' | 'constants' | 'classes' | 'interfaces' | 'types' | 'enums';

type DupDefinerTag = 'ALLOWLISTED' | 'ALIAS_DELEGATION' | 'PLAIN';
type DupEntryTag = 'TRUE_DUPLICATE' | 'ALIAS_DELEGATION' | 'ALLOWLISTED';

interface DuplicateDefiner {
  file: string;
  package: string;
  public: boolean;
  tag: DupDefinerTag;
  /** Present when `tag === 'ALLOWLISTED'` — the matching allowlist entry's reason. */
  reason?: string;
}

interface DuplicateSymbolEntry {
  name: string;
  /** Distinct own-definition categories across definers, '+'-joined. */
  category: string;
  definers: DuplicateDefiner[];
  /** File path of the sole PUBLIC definer, `'AMBIGUOUS'` (>=2 public
   *  definers), or `'internal-only'` (0 public definers). A hint, not a
   *  verdict — a human still confirms before consolidating. */
  canonicalHint: string;
  tag: DupEntryTag;
}

interface DuplicateSymbolsReport {
  generated: string;
  note: string;
  summary: {
    runtimeDuplicates: number;
    typeDuplicates: number;
    runtimeByTag: Record<DupEntryTag, number>;
    typeByTag: Record<DupEntryTag, number>;
  };
  runtime: DuplicateSymbolEntry[];
  types: DuplicateSymbolEntry[];
}

const RUNTIME_DUP_CATEGORIES: Array<{ cat: RuntimeSymbolCategory; key: DupExportKey }> = [
  { cat: 'function', key: 'functions' },
  { cat: 'constant', key: 'constants' },
  { cat: 'class', key: 'classes' },
];

const TYPE_DUP_CATEGORIES: Array<{ cat: TypeSymbolCategory; key: DupExportKey }> = [
  { cat: 'interface', key: 'interfaces' },
  { cat: 'type', key: 'types' },
  { cat: 'enum', key: 'enums' },
];

const DUPLICATE_SYMBOLS_NOTE =
  'This report groups names by OWN definition, not by call graph, then classifies each ' +
  'flagged name: TRUE_DUPLICATE (the actionable merge targets), ALIAS_DELEGATION (a ' +
  'const-alias forward to an imported symbol, not an independent body — excluded once ' +
  'fewer than 2 real bodies remain), and ALLOWLISTED (matches duplicate-allowlist.json: ' +
  'deliberately-independent local helpers/types). A flagged name may be a genuine ' +
  'duplicate OR a legitimately-independent local definition; a human triages ' +
  'TRUE_DUPLICATE entries using the defining files + public flags before merging anything.';

interface DuplicateAllowlistEntry {
  /** Symbol-name patterns. A trailing `*` is a prefix match; the literal `*` matches any name. */
  names: string[];
  /** File-path patterns, repo-relative. A trailing `/**` is a directory-prefix match; anything
   *  else must match the file path exactly. */
  filesGlob: string[];
  reason: string;
}

let duplicateAllowlistCache: DuplicateAllowlistEntry[] | undefined;

/**
 * Load `tools/create-dependency-graph/duplicate-allowlist.json` — the
 * human-curated set of legitimately-independent own-definitions.
 * Missing/unparseable file → empty allowlist (fail open, not a crash).
 */
function loadDuplicateAllowlist(): DuplicateAllowlistEntry[] {
  if (duplicateAllowlistCache) return duplicateAllowlistCache;
  const path = join(ROOT_DIR, 'tools', 'create-dependency-graph', 'duplicate-allowlist.json');
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      entries?: DuplicateAllowlistEntry[];
    };
    duplicateAllowlistCache = parsed.entries ?? [];
  } catch {
    duplicateAllowlistCache = [];
  }
  return duplicateAllowlistCache;
}

/** `pattern` against `value`: literal `*` matches anything, a trailing `/**`
 *  is a directory-prefix match, a trailing `*` is a plain prefix match,
 *  otherwise exact string equality. */
function globMatchSingle(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('/**')) return value.startsWith(pattern.slice(0, -2)); // keep the trailing '/'
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function findAllowlistMatch(
  allowlist: DuplicateAllowlistEntry[],
  name: string,
  filePath: string
): DuplicateAllowlistEntry | undefined {
  return allowlist.find(
    (e) =>
      e.names.some((n) => globMatchSingle(n, name)) &&
      e.filesGlob.some((f) => globMatchSingle(f, filePath))
  );
}

const rawFileContentCache = new Map<string, string>();

/** Raw source of a repo-relative file path, cached. */
function getRawFileContent(relPath: string): string {
  const cached = rawFileContentCache.get(relPath);
  if (cached !== undefined) return cached;
  let content = '';
  try {
    content = readFileSync(join(ROOT_DIR, relPath), 'utf-8');
  } catch {
    content = '';
  }
  rawFileContentCache.set(relPath, content);
  return content;
}

function stripCommentsForClassification(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every LOCAL binding name introduced by an `import` statement in `code`. */
function collectImportedLocalNames(code: string): Set<string> {
  const names = new Set<string>();
  const importRegex =
    /import\s+(?:type\s+)?(?:(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?)\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(code)) !== null) {
    const named = m[1] || m[4] || '';
    const def = m[2] || m[5] || '';
    const ns = m[3] || '';
    if (named) {
      for (const item of named.split(',')) {
        const trimmed = item.trim().replace(/^type\s+/, '');
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+as\s+/);
        const local = parts[parts.length - 1].trim();
        if (local) names.add(local);
      }
    }
    if (def) names.add(def);
    if (ns) names.add(ns);
  }
  return names;
}

/** `export const NAME = someIdentifier;` where the RHS is a BARE identifier
 *  bound by an `import` elsewhere in the file — a delegation/re-export, not an
 *  independent body. */
function isAliasDelegationBody(
  code: string,
  name: string,
  importedLocalNames: Set<string>
): boolean {
  const re = new RegExp(
    `export\\s+const\\s+${escapeRegExpLiteral(name)}\\s*(?::[^=]+)?=\\s*([A-Za-z_$][\\w$]*)\\s*;`
  );
  const m = code.match(re);
  return !!m && importedLocalNames.has(m[1]);
}

/**
 * Classify a single definer. Allowlist wins first (explicit human curation);
 * then, for `constant`-shape definers only, check for an alias forward.
 * Everything else is `PLAIN` — a genuine own-defined body.
 */
function classifyDefiner(
  file: ParsedFile,
  name: string,
  category: string,
  allowlist: DuplicateAllowlistEntry[]
): { tag: DupDefinerTag; reason?: string } {
  const allowMatch = findAllowlistMatch(allowlist, name, file.path);
  if (allowMatch) return { tag: 'ALLOWLISTED', reason: allowMatch.reason };

  if (category === 'constant') {
    const raw = getRawFileContent(file.path);
    if (raw) {
      const code = stripCommentsForClassification(raw);
      if (isAliasDelegationBody(code, name, collectImportedLocalNames(code))) {
        return { tag: 'ALIAS_DELEGATION' };
      }
    }
  }
  return { tag: 'PLAIN' };
}

/**
 * Collect every OWN definition of every symbol name across `files`, keyed by
 * name. A definer is recorded only when the name is in the file's own export
 * list for that category AND absent from `file.exports.reExported`.
 */
function collectOwnDefiners(
  files: ParsedFile[],
  categories: Array<{ cat: string; key: DupExportKey }>
): Map<string, Array<{ file: ParsedFile; category: string }>> {
  const byName = new Map<string, Array<{ file: ParsedFile; category: string }>>();
  for (const file of files) {
    const reExported = new Set(file.exports.reExported);
    for (const { cat, key } of categories) {
      for (const name of file.exports[key]) {
        if (reExported.has(name)) continue; // forward, not an own body
        // `exports.types` also contains every interface name — skip so an
        // interface isn't double-counted as its own "type" duplicate too.
        if (key === 'types' && file.exports.interfaces.includes(name)) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ file, category: cat });
      }
    }
  }
  return byName;
}

const DUP_ENTRY_TAG_SORT_ORDER: Record<DupEntryTag, number> = {
  TRUE_DUPLICATE: 0,
  ALIAS_DELEGATION: 1,
  ALLOWLISTED: 2,
};

function finalizeDuplicateEntry(
  name: string,
  categories: Set<string>,
  definers: DuplicateDefiner[],
  tag: DupEntryTag
): DuplicateSymbolEntry {
  const publicDefiners = definers.filter((d) => d.public);
  const canonicalHint =
    publicDefiners.length === 1
      ? publicDefiners[0].file
      : publicDefiners.length > 1
        ? 'AMBIGUOUS'
        : 'internal-only';
  return { name, category: [...categories].sort().join('+'), definers, canonicalHint, tag };
}

/**
 * Turn per-name definer lists into classified report entries, keeping only
 * names with >=2 DISTINCT defining files:
 * 1. Classify every definer: ALLOWLISTED > ALIAS_DELEGATION (constant-shape) > PLAIN.
 * 2. Exclude ALIAS_DELEGATION definers first — a const-alias forward is not an
 *    independent body. If fewer than 2 non-alias definers remain, tag the
 *    entry ALIAS_DELEGATION (reported for transparency, excluded from the
 *    actionable count).
 * 3. Of the non-alias definers, exclude ALLOWLISTED ones. If fewer than 2
 *    remain, tag ALLOWLISTED.
 * 4. Otherwise it's a real TRUE_DUPLICATE — the actionable merge target.
 *
 * Public is resolved per FILE: a definer is public iff its own file is in
 * `publicSurface.publicWildcardFiles` OR its specific name is in
 * `publicSurface.publicNamed` (`${file}::${name}`).
 */
function buildDuplicateEntries(
  byName: Map<string, Array<{ file: ParsedFile; category: string }>>,
  publicSurface: PublicSurface,
  allowlist: DuplicateAllowlistEntry[]
): DuplicateSymbolEntry[] {
  const isFilePublic = (file: ParsedFile, name: string): boolean =>
    publicSurface.publicWildcardFiles.has(file.path) ||
    publicSurface.publicNamed.has(`${file.path}::${name}`);

  const entries: DuplicateSymbolEntry[] = [];
  for (const [name, defs] of byName) {
    const byFile = new Map<string, { file: ParsedFile; category: string }>();
    for (const d of defs) {
      if (!byFile.has(d.file.path)) byFile.set(d.file.path, d);
    }
    if (byFile.size < 2) continue;

    const categories = new Set<string>();
    const definers: DuplicateDefiner[] = [];
    for (const { file, category } of byFile.values()) {
      categories.add(category);
      const { tag, reason } = classifyDefiner(file, name, category, allowlist);
      definers.push({
        file: file.path,
        package: file.packageName ?? 'unknown',
        public: isFilePublic(file, name),
        tag,
        ...(reason ? { reason } : {}),
      });
    }
    definers.sort((a, b) => a.file.localeCompare(b.file));

    const nonAlias = definers.filter((d) => d.tag !== 'ALIAS_DELEGATION');
    if (nonAlias.length < 2) {
      entries.push(finalizeDuplicateEntry(name, categories, definers, 'ALIAS_DELEGATION'));
      continue;
    }

    const nonAllowlisted = nonAlias.filter((d) => d.tag !== 'ALLOWLISTED');
    const entryTag: DupEntryTag = nonAllowlisted.length < 2 ? 'ALLOWLISTED' : 'TRUE_DUPLICATE';
    entries.push(finalizeDuplicateEntry(name, categories, definers, entryTag));
  }
  entries.sort(
    (a, b) =>
      DUP_ENTRY_TAG_SORT_ORDER[a.tag] - DUP_ENTRY_TAG_SORT_ORDER[b.tag] ||
      b.definers.length - a.definers.length ||
      a.name.localeCompare(b.name)
  );
  return entries;
}

function tallyByTag(entries: DuplicateSymbolEntry[]): Record<DupEntryTag, number> {
  const tally: Record<DupEntryTag, number> = {
    TRUE_DUPLICATE: 0,
    ALIAS_DELEGATION: 0,
    ALLOWLISTED: 0,
  };
  for (const e of entries) tally[e.tag]++;
  return tally;
}

function detectDuplicateSymbols(
  files: ParsedFile[],
  publicSurface: PublicSurface
): { runtime: DuplicateSymbolEntry[]; types: DuplicateSymbolEntry[] } {
  const allowlist = loadDuplicateAllowlist();
  return {
    runtime: buildDuplicateEntries(
      collectOwnDefiners(files, RUNTIME_DUP_CATEGORIES),
      publicSurface,
      allowlist
    ),
    types: buildDuplicateEntries(
      collectOwnDefiners(files, TYPE_DUP_CATEGORIES),
      publicSurface,
      allowlist
    ),
  };
}

function generateDuplicateSymbolsMarkdown(report: DuplicateSymbolsReport): string {
  let md = '# Duplicate Symbols\n\n';
  md += `**Generated**: ${report.generated} (by tools/create-dependency-graph)\n\n`;
  md += `Names that are OWN-DEFINED (not merely re-exported) by >= 2 distinct files, then `;
  md += `CLASSIFIED so the actionable subset is clear: \`TRUE_DUPLICATE\` (real merge targets) `;
  md += `vs \`ALIAS_DELEGATION\` (a \`const X = importedY\` forward, excluded once <2 real `;
  md += `bodies remain) and \`ALLOWLISTED\` (matches \`duplicate-allowlist.json\`).\n\n`;
  md += `> **Note:** ${report.note}\n\n`;

  const summaryTable = (byTag: Record<DupEntryTag, number>, total: number): string =>
    `| Category | Count |\n| --- | --: |\n` +
    `| **TRUE_DUPLICATE** (actionable) | ${byTag.TRUE_DUPLICATE} |\n` +
    `| ALIAS_DELEGATION | ${byTag.ALIAS_DELEGATION} |\n` +
    `| ALLOWLISTED | ${byTag.ALLOWLISTED} |\n` +
    `| _Total flagged names_ | ${total} |\n\n`;

  md += `## Summary — runtime (function/constant/class)\n\n`;
  md += summaryTable(report.summary.runtimeByTag, report.runtime.length);
  md += `## Summary — types (interface/type/enum)\n\n`;
  md += summaryTable(report.summary.typeByTag, report.types.length);

  const renderTable = (entries: DuplicateSymbolEntry[]): string => {
    if (entries.length === 0) return '_None._\n\n';
    let out = '| Name | Category | Defining files (public?, sub-tag) | Canonical hint |\n';
    out += '| --- | --- | --- | --- |\n';
    for (const e of entries) {
      const files = e.definers
        .map((d) => {
          const reasonSuffix = d.reason ? `: ${d.reason}` : '';
          return `\`${d.file}\` (${d.public ? 'public' : 'internal'}, ${d.tag}${reasonSuffix})`;
        })
        .join('<br>');
      const hint = e.canonicalHint === 'AMBIGUOUS' ? '**AMBIGUOUS**' : `\`${e.canonicalHint}\``;
      out += `| \`${e.name}\` | ${e.category} | ${files} | ${hint} |\n`;
    }
    out += '\n';
    return out;
  };

  const renderTaggedSection = (
    title: string,
    entries: DuplicateSymbolEntry[],
    tag: DupEntryTag
  ): string => `### ${title}\n\n${renderTable(entries.filter((e) => e.tag === tag))}`;

  md += `## Runtime duplicates\n\n`;
  md += renderTaggedSection(
    'TRUE_DUPLICATE — actionable merge targets',
    report.runtime,
    'TRUE_DUPLICATE'
  );
  md += renderTaggedSection(
    'ALIAS_DELEGATION — const-alias forwards (not independent bodies)',
    report.runtime,
    'ALIAS_DELEGATION'
  );
  md += renderTaggedSection(
    'ALLOWLISTED — accepted duplication (see duplicate-allowlist.json)',
    report.runtime,
    'ALLOWLISTED'
  );

  md += `## Type duplicates (lower priority)\n\n`;
  md += renderTaggedSection('TRUE_DUPLICATE', report.types, 'TRUE_DUPLICATE');
  md += renderTaggedSection('ALIAS_DELEGATION', report.types, 'ALIAS_DELEGATION');
  md += renderTaggedSection('ALLOWLISTED', report.types, 'ALLOWLISTED');

  return md;
}

// ── Complete file census ────────────────────────────────────────────────────
//
// A whole-repo inventory of EVERY tracked `.ts` file — not just src/ but ALSO
// tests/, tools/, benchmarks/, root-level `*.config.ts`, examples/ and docs/
// sources — each tagged with a disposition. The point is completeness: no
// `.ts` in the repo may be silently missing from the docs.
//
// Two DIFFERENT walks, on purpose:
//   - The CENSUS discovers via ENUMERATED roots and classifies each file.
//   - The GATE (`verifyFileCensus`) uses a MAXIMAL, location-agnostic walk from
//     the repo root as ground truth. Any `.ts` the maximal walk finds that the
//     census does not account for HARD-FAILS the run — the gate cannot share
//     the census's blind spot.
//
// Both walks exclude only `node_modules`, `dist`, `*.d.ts`, and dot-directories.
//
// Orphan handling differs from the MathTS original: orphans WARN by default
// (exit 0) and hard-fail only under `--strict-orphans`. Rationale: MemoryJS is
// adopting this model on an existing codebase; the strict gate is opt-in until
// the orphan backlog is triaged (wire or delete), at which point CI can flip
// the flag on.

type FileDisposition =
  | 'reachable'
  | 'build-entry'
  | 'test-only'
  | 'orphan'
  | 'test'
  | 'tool'
  | 'config'
  | 'bench'
  | 'example';

type FileArea = 'src' | 'tests' | 'tools' | 'config' | 'benchmarks' | 'examples' | 'docs';

interface FileInventoryRow {
  file: string;
  package: string;
  area: FileArea;
  disposition: FileDisposition;
  loc: number;
}

interface FileInventory {
  generated: string;
  totalFiles: number;
  byDisposition: Record<string, number>;
  byArea: Record<string, number>;
  files: FileInventoryRow[];
}

/** MAXIMAL repo walk — every `.ts` (except `.d.ts`) under `rootDir`, skipping
 *  `node_modules`, `dist`, and any dot-directory. Repo-relative, sorted. */
function walkRepoTsFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        out.push(relative(rootDir, p).replace(/\\/g, '/'));
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

/** The CENSUS's file discovery: ENUMERATED source roots only — src/ (or each
 *  workspace dir), tests/, tools/, benchmarks/, examples/, docs/, and
 *  root-level `.ts` config files. Deliberately narrower than
 *  `walkRepoTsFiles`, so the maximal gate can catch a scoping gap. */
function collectCensusFiles(rootDir: string): string[] {
  const set = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        set.add(relative(rootDir, p).replace(/\\/g, '/'));
      }
    }
  };
  const dirs = new Set<string>(['src', 'tests', 'tools', 'benchmarks', 'examples', 'docs']);
  for (const ws of workspaceMap.values()) {
    if (ws.directory !== '') dirs.add(ws.directory);
  }
  for (const d of dirs) walk(join(rootDir, d));
  // Root-level `.ts` files (tsup.config.ts, vitest.config.ts, …).
  for (const e of readdirSync(rootDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      set.add(e.name);
    }
  }
  return [...set];
}

/** Classify a repo-relative `.ts` path into an AREA purely by location/name. */
function classifyArea(rel: string): FileArea {
  if (/(^|\/)tools\//.test(rel)) return 'tools';
  if (/\.config(\.[\w-]+)?\.[cm]?ts$/.test(rel)) return 'config';
  if (/\.(test|spec)\.ts$/.test(rel) || /(^|\/)tests\//.test(rel)) return 'tests';
  if (/^benchmarks\//.test(rel)) return 'benchmarks';
  if (/^examples\//.test(rel)) return 'examples';
  if (/^docs\//.test(rel)) return 'docs';
  return 'src';
}

/** The package a file belongs to, or `(root)` for repo-root files. */
function packageOf(rel: string): string {
  for (const [name, ws] of workspaceMap) {
    if (ws.directory !== '' && rel.startsWith(ws.directory + '/')) return name;
    if (ws.directory === '' && rel.startsWith('src/')) return name;
  }
  return '(root)';
}

function countLoc(rootDir: string, relPath: string): number {
  try {
    return readFileSync(join(rootDir, relPath), 'utf-8').split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Build the complete file inventory over the ENUMERATED census roots.
 * Disposition for a `src` file: build-entry (a seeded root) > reachable >
 * test-only (reachable only from a test) > orphan (reachable from nothing).
 * Non-`src` areas map straight to their kind.
 */
function buildFileInventory(
  rootDir: string,
  roots: Set<string>,
  reachable: Set<string>,
  testReachable: Set<string>
): FileInventory {
  const rows: FileInventoryRow[] = [];
  for (const rel of collectCensusFiles(rootDir)) {
    const area = classifyArea(rel);
    let disposition: FileDisposition;
    if (area === 'src') {
      disposition = roots.has(rel)
        ? 'build-entry'
        : reachable.has(rel)
          ? 'reachable'
          : testReachable.has(rel)
            ? 'test-only'
            : 'orphan';
    } else if (area === 'tests') {
      disposition = 'test';
    } else if (area === 'tools') {
      disposition = 'tool';
    } else if (area === 'config') {
      disposition = 'config';
    } else if (area === 'benchmarks') {
      disposition = 'bench';
    } else {
      disposition = 'example'; // examples | docs
    }
    rows.push({
      file: rel,
      package: packageOf(rel),
      area,
      disposition,
      loc: countLoc(rootDir, rel),
    });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));

  const byDisposition: Record<string, number> = {
    reachable: 0,
    'build-entry': 0,
    'test-only': 0,
    orphan: 0,
    test: 0,
    tool: 0,
    config: 0,
    bench: 0,
    example: 0,
  };
  const byArea: Record<string, number> = {};
  for (const r of rows) {
    byDisposition[r.disposition] = (byDisposition[r.disposition] ?? 0) + 1;
    byArea[r.area] = (byArea[r.area] ?? 0) + 1;
  }

  return {
    generated: new Date().toISOString().split('T')[0],
    totalFiles: rows.length,
    byDisposition,
    byArea,
    files: rows,
  };
}

const FILE_DISPOSITION_LEGEND: Array<[FileDisposition, string]> = [
  ['reachable', 'A `src/` file in the module graph, reachable from a root.'],
  [
    'build-entry',
    'A detected build/exports/`bin`/worker/tsup root (index, cli/index, levenshteinWorker, …).',
  ],
  ['test-only', 'A `src/` file not reachable from src roots but imported by a test.'],
  [
    'orphan',
    'A `src/` file reachable from nothing — a delete/wire candidate (fails the gate under --strict-orphans).',
  ],
  ['test', 'A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`).'],
  ['tool', 'A file under `tools/` — repo meta-tooling.'],
  ['config', 'A build/test config source (`*.config.ts`: vitest/tsup).'],
  ['bench', 'A `benchmarks/` source file (run directly via tsx, not imported).'],
  ['example', 'An `examples/` or `docs/` reference/illustration source.'],
];

function generateFileInventoryMarkdown(inv: FileInventory): string {
  const lines: string[] = [];
  lines.push('# Complete File Inventory');
  lines.push('');
  lines.push(`**Generated**: ${inv.generated} (by tools/create-dependency-graph)`);
  lines.push('');
  lines.push(
    'Every tracked `.ts` file in the repo — `src/`, `tests/`, `tools/`, `benchmarks/`, ' +
      'root-level `*.config.ts` — tagged with a disposition. A completeness census: no `.ts` ' +
      'may be silently missing. The self-check gate does a MAXIMAL, location-agnostic repo ' +
      'walk (broader than this census’s enumerated discovery) and fails the run if any `.ts` ' +
      'on disk is unaccounted.'
  );
  lines.push('');
  lines.push(
    '**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient ' +
      'declarations, and dot-directories.'
  );
  lines.push('');
  lines.push(`**Total files**: ${inv.totalFiles}`);
  lines.push('');
  lines.push('## Disposition counts');
  lines.push('');
  lines.push('| Disposition | Count | Meaning |');
  lines.push('| --- | --: | --- |');
  for (const [disp, meaning] of FILE_DISPOSITION_LEGEND) {
    lines.push(`| \`${disp}\` | ${inv.byDisposition[disp] ?? 0} | ${meaning} |`);
  }
  lines.push(`| **Total** | **${inv.totalFiles}** | |`);
  lines.push('');
  lines.push('## Per-area counts');
  lines.push('');
  lines.push('| Area | Files |');
  lines.push('| --- | --: |');
  for (const area of Object.keys(inv.byArea).sort()) {
    lines.push(`| \`${area}\` | ${inv.byArea[area]} |`);
  }
  lines.push('');
  lines.push('## All files');
  lines.push('');
  lines.push('| file | area | disposition | LOC |');
  lines.push('| --- | --- | --- | --: |');
  for (const r of inv.files) {
    lines.push(`| \`${r.file}\` | ${r.area} | ${r.disposition} | ${r.loc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Self-check gate. Ground truth is the MAXIMAL repo walk. Failure conditions:
 *   1. **Unaccounted on disk** — a `.ts` the maximal walk finds that the census
 *      does not list (scoping-gap catcher) — always hard-fails.
 *   2. **Stale in census** — a census entry with no file on disk — hard-fails.
 *   3. **Orphans present** — warns by default; hard-fails under --strict-orphans.
 */
function verifyFileCensus(rootDir: string, inventory: FileInventory, strictOrphans: boolean): void {
  const onDisk = new Set(walkRepoTsFiles(rootDir));
  const census = new Set(inventory.files.map((f) => f.file));
  const missingFromCensus = [...onDisk].filter((f) => !census.has(f)).sort();
  const missingFromDisk = [...census].filter((f) => !onDisk.has(f)).sort();
  const orphans = inventory.files
    .filter((f) => f.disposition === 'orphan')
    .map((f) => f.file)
    .sort();

  if (missingFromCensus.length > 0 || missingFromDisk.length > 0) {
    let msg = 'FILE CENSUS SELF-CHECK FAILED.\n';
    if (missingFromCensus.length > 0) {
      msg += `  ${missingFromCensus.length} file(s) on disk but ABSENT from the census (scoping/discovery gap — teach the census to enumerate this location):\n`;
      msg += missingFromCensus.map((f) => `    + ${f}`).join('\n') + '\n';
    }
    if (missingFromDisk.length > 0) {
      msg += `  ${missingFromDisk.length} file(s) in the census but MISSING on disk (stale entry — regenerate):\n`;
      msg += missingFromDisk.map((f) => `    - ${f}`).join('\n') + '\n';
    }
    throw new Error(msg);
  }

  if (orphans.length > 0) {
    const lines = [
      `${orphans.length} ORPHAN src file(s) — reachable from no root and no test. Each is either`,
      `a root the tool did not detect (a new build/worker entry, a new URL()-loaded script, a`,
      `side-effect-only module) — teach root discovery about it — or dead code to delete:`,
      ...orphans.map((f) => `  ! ${f}`),
    ];
    if (strictOrphans) {
      throw new Error('FILE CENSUS: ' + lines.join('\n'));
    }
    console.warn('\nWARNING: ' + lines.join('\n'));
  }

  console.log(
    `File census self-check passed: ${inventory.totalFiles} files == maximal repo walk, ` +
      `${orphans.length} orphan(s)${strictOrphans ? ' (strict)' : ''}.`
  );
}

/**
 * `--check-census` (no-regen) entry: verify the ALREADY-GENERATED
 * `file-inventory.json` against a fresh maximal repo walk WITHOUT re-running
 * the graph scan. Throws (→ non-zero exit) if the committed census is stale
 * vs the disk — this is what catches a `.ts` added anywhere in the repo after
 * the last regeneration.
 */
function runCensusCheckNoRegen(rootDir: string, strictOrphans: boolean): void {
  const invPath = join(rootDir, 'docs', 'architecture', 'file-inventory.json');
  if (!existsSync(invPath)) {
    throw new Error(
      `file-census check: ${invPath} not found — run the generator first to create it.`
    );
  }
  const inventory = JSON.parse(readFileSync(invPath, 'utf-8')) as FileInventory;
  verifyFileCensus(rootDir, inventory, strictOrphans);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const cliOptions = parseCliOptions();

  // Detect packages: monorepo workspaces, or a synthetic self-package entry
  // for the root package (so self-name imports resolve and root discovery
  // flows through one code path).
  const detected = detectWorkspaces(ROOT_DIR);
  isMonorepo = detected.size > 0;
  if (isMonorepo) {
    workspaceMap = detected;
  } else {
    workspaceMap = new Map();
    workspaceMap.set(packageJson.name, {
      name: packageJson.name,
      directory: '',
      srcDir: 'src',
      extraEntries: exportsSubpathEntries(ROOT_DIR, '', packageJson),
    });
  }

  // Standing no-regen census gate.
  if (cliOptions.checkCensus) {
    runCensusCheckNoRegen(ROOT_DIR, cliOptions.strictOrphans);
    console.log('file-census check passed (no-regen): committed inventory matches the repo.');
    return;
  }

  console.log('Scanning codebase for dependencies...');
  if (cliOptions.includeTests) {
    console.log('Test file analysis enabled');
  }
  if (isMonorepo) {
    console.log(`Monorepo detected: ${workspaceMap.size} workspace packages`);
    for (const [name, ws] of workspaceMap) {
      console.log(`  - ${name} (${ws.directory}/)`);
    }
  }

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}`);
  }

  // Get all TypeScript files (`.d.ts` ambient declarations excluded)
  let tsFiles: string[];
  if (isMonorepo) {
    tsFiles = [];
    for (const [, ws] of workspaceMap) {
      const srcDir = join(ROOT_DIR, ws.srcDir);
      const pkgFiles = getAllSourceTsFiles(srcDir);
      tsFiles.push(...pkgFiles);
      console.log(`  ${ws.directory}/src: ${pkgFiles.length} files`);
    }
  } else {
    tsFiles = getAllSourceTsFiles(SRC_DIR);
  }
  console.log(`Found ${tsFiles.length} TypeScript files total`);

  if (tsFiles.length === 0) {
    console.error('No TypeScript files found');
    process.exit(1);
  }

  // Parse all files
  const parsedFiles = tsFiles.map(parseFile);
  console.log('Parsed all files');

  // ── Reachability analysis (always) ────────────────────────────────────────
  // Roots: each package's src/index.ts + its discovered extra entries
  // (exports subpaths, bin targets, tsup/script/tsconfig entries) + config-
  // referenced entries.
  const entryPoints: string[] = [];
  for (const [, ws] of workspaceMap) {
    const candidates = [`${ws.srcDir}/index.ts`.replace(/\\/g, '/'), ...ws.extraEntries];
    for (const entryPath of candidates) {
      const found = parsedFiles.find((f) => f.path === entryPath);
      if (found && !entryPoints.includes(found.path)) {
        entryPoints.push(found.path);
      }
    }
  }
  for (const cfgEntry of configReferencedEntries(ROOT_DIR)) {
    if (parsedFiles.some((f) => f.path === cfgEntry) && !entryPoints.includes(cfgEntry)) {
      entryPoints.push(cfgEntry);
    }
  }
  const rootsSet = new Set(entryPoints);
  console.log(`Entry/build roots: ${entryPoints.length}`);
  for (const r of [...rootsSet].sort()) console.log(`  * ${r}`);

  const reachableSet = findReachableFiles(entryPoints, parsedFiles);
  const dormantSet = new Set(
    parsedFiles.filter((f) => !reachableSet.has(f.path)).map((f) => f.path)
  );
  console.log(`Reachable files: ${reachableSet.size}`);
  console.log(`Dormant files: ${dormantSet.size}`);

  // Which file set feeds the graph/report?
  // Single-package default: ALL files (dormancy is reported, not hidden).
  // Monorepo default: reachable-only (MathTS parity; --all to widen).
  let activeParsedFiles = parsedFiles;
  const restrict = cliOptions.reachableOnly || (isMonorepo && !cliOptions.all);
  if (restrict) {
    activeParsedFiles = parsedFiles.filter((f) => reachableSet.has(f.path));
    console.log(`Analyzing ${activeParsedFiles.length} reachable files (restricted)`);
  } else {
    console.log(`Analyzing all ${activeParsedFiles.length} files (dormancy reported below)`);
  }

  // Categorize into modules
  const modules = categorizeFiles(activeParsedFiles, isMonorepo);
  console.log(`Categorized into ${Object.keys(modules).length} modules`);

  // Detect circular dependencies
  const circularDeps = detectCircularDependencies(activeParsedFiles);
  console.log(
    `Found ${circularDeps.all.length} circular dependencies (${circularDeps.runtime.length} runtime, ${circularDeps.typeOnly.length} type-only)`
  );

  // Parse test files up-front UNCONDITIONALLY so the unused-analysis always
  // sees test-only consumers. --include-tests gates only the coverage REPORT.
  const testFilePaths: string[] = [];
  if (isMonorepo) {
    for (const [, ws] of workspaceMap) {
      testFilePaths.push(...getAllTestFiles(join(ROOT_DIR, ws.directory, 'tests')));
      testFilePaths.push(...getAllTestFiles(join(ROOT_DIR, ws.srcDir)));
    }
    testFilePaths.push(...getAllTestFiles(join(ROOT_DIR, 'tests')));
  } else {
    testFilePaths.push(...getAllTestFiles(join(ROOT_DIR, 'tests')), ...getAllTestFiles(SRC_DIR));
  }
  const parsedTestFiles: ParsedFile[] = testFilePaths.map(parseFile);
  console.log(`Parsed ${parsedTestFiles.length} test files (for unused/dormancy analysis)`);

  // Dormant split: test-only (exercised by a test) vs orphaned (nothing at all)
  const testReachable = findReachableFiles(
    parsedTestFiles.map((f) => f.path),
    [...parsedFiles, ...parsedTestFiles]
  );
  const dormantAll = [...dormantSet]
    .filter((f) => /(^|\/)src\//.test(f) && !f.endsWith('.d.ts'))
    .sort();
  const orphaned = dormantAll.filter((f) => !testReachable.has(f));
  const testOnly = dormantAll.filter((f) => testReachable.has(f));

  // Detect unused files and exports
  const unusedAnalysis = detectUnused(activeParsedFiles, parsedTestFiles);

  // Generate statistics
  const stats = generateStatistics(activeParsedFiles, modules, circularDeps, unusedAnalysis, {
    roots: rootsSet,
    reachable: reachableSet,
    dormant: dormantAll,
    orphaned,
    testOnly,
  });
  console.log('Generated statistics');

  // Build dependency matrix
  const matrix = buildDependencyMatrix(activeParsedFiles);
  console.log('Built dependency matrix');

  // Generate outputs
  const json = generateJSON(activeParsedFiles, modules, stats, circularDeps, rootsSet, {
    orphaned,
    testOnly,
  });
  let markdown = generateMarkdown(
    activeParsedFiles,
    modules,
    stats,
    circularDeps,
    matrix,
    rootsSet
  );

  // Insert package-level section for monorepo mode
  if (isMonorepo) {
    const pkgSection = generatePackageDependencySection(
      parsedFiles,
      workspaceMap,
      reachableSet,
      dormantSet
    );
    const overviewMarker = '## Overview';
    const overviewIdx = markdown.indexOf(overviewMarker);
    if (overviewIdx !== -1) {
      const sepIdx = markdown.indexOf('\n---\n', overviewIdx + overviewMarker.length);
      if (sepIdx !== -1) {
        const insertPoint = sepIdx + 5;
        markdown = markdown.slice(0, insertPoint) + '\n' + pkgSection + markdown.slice(insertPoint);
      }
    }
  }

  // Write outputs
  writeFileSync(join(OUTPUT_DIR, 'dependency-graph.json'), JSON.stringify(json, null, 2));
  console.log('Written: docs/architecture/dependency-graph.json');

  // Write YAML output (more compact, ~40% smaller than JSON)
  const yamlOutput = yaml.dump(json, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  writeFileSync(join(OUTPUT_DIR, 'dependency-graph.yaml'), yamlOutput);
  console.log('Written: docs/architecture/dependency-graph.yaml');

  writeFileSync(join(OUTPUT_DIR, 'DEPENDENCY_GRAPH.md'), markdown);
  console.log('Written: docs/architecture/DEPENDENCY_GRAPH.md');

  // Write compact summary for LLM consumption (CTON-style, ~10KB)
  const compactSummary = generateCompactSummary(activeParsedFiles, modules, stats, circularDeps);
  writeFileSync(join(OUTPUT_DIR, 'dependency-summary.compact.json'), compactSummary);
  const compactSize = Buffer.byteLength(compactSummary, 'utf8');
  console.log(
    `Written: docs/architecture/dependency-summary.compact.json (${(compactSize / 1024).toFixed(1)}KB)`
  );

  // Duplicate-symbol detection.
  const dup = detectDuplicateSymbols(activeParsedFiles, computePublicSurface(activeParsedFiles));
  const runtimeByTag = tallyByTag(dup.runtime);
  const typeByTag = tallyByTag(dup.types);
  const duplicateReport: DuplicateSymbolsReport = {
    generated: new Date().toISOString().split('T')[0],
    note: DUPLICATE_SYMBOLS_NOTE,
    summary: {
      runtimeDuplicates: runtimeByTag.TRUE_DUPLICATE,
      typeDuplicates: typeByTag.TRUE_DUPLICATE,
      runtimeByTag,
      typeByTag,
    },
    runtime: dup.runtime,
    types: dup.types,
  };
  writeFileSync(
    join(OUTPUT_DIR, 'duplicate-symbols.json'),
    JSON.stringify(duplicateReport, null, 2)
  );
  writeFileSync(
    join(OUTPUT_DIR, 'duplicate-symbols.md'),
    generateDuplicateSymbolsMarkdown(duplicateReport)
  );
  console.log(
    `Written: docs/architecture/duplicate-symbols.md ` +
      `(${duplicateReport.summary.runtimeDuplicates} runtime TRUE_DUPLICATE / ` +
      `${dup.runtime.length} runtime flagged, ` +
      `${duplicateReport.summary.typeDuplicates} type TRUE_DUPLICATE / ` +
      `${dup.types.length} type flagged)`
  );

  // Test coverage analysis (when --include-tests is specified)
  let testCoverage: TestCoverageAnalysis | null = null;
  if (cliOptions.includeTests) {
    console.log('\nAnalyzing test coverage...');
    console.log(`Found ${testFilePaths.length} test files`);
    testCoverage = analyzeTestCoverage(activeParsedFiles, parsedTestFiles);

    const testCoverageMarkdown = generateTestCoverageMarkdown(testCoverage);
    const testCoverageJson = generateTestCoverageJson(testCoverage);

    writeFileSync(join(OUTPUT_DIR, 'TEST_COVERAGE.md'), testCoverageMarkdown);
    console.log('Written: docs/architecture/TEST_COVERAGE.md');

    writeFileSync(
      join(OUTPUT_DIR, 'test-coverage.json'),
      JSON.stringify(testCoverageJson, null, 2)
    );
    console.log('Written: docs/architecture/test-coverage.json');
  }

  console.log('\nDependency graph generation complete!');
  console.log(`  - ${stats.totalTypeScriptFiles} files analyzed`);
  console.log(`  - ${stats.totalExports} exports found (${stats.totalReExports} re-exports)`);
  console.log(`  - ${stats.totalTypeOnlyImports} type-only imports detected`);
  console.log(`  - ${circularDeps.all.length} circular dependencies:`);
  console.log(`      ${circularDeps.runtime.length} runtime (require attention)`);
  console.log(`      ${circularDeps.typeOnly.length} type-only (safe)`);
  console.log(
    `  - ${reachableSet.size} reachable / ${dormantAll.length} dormant ` +
      `(${orphaned.length} orphaned, ${testOnly.length} test-only)`
  );
  console.log(`  - ${unusedAnalysis.unusedFiles.length} potentially unused files`);
  console.log(`  - ${unusedAnalysis.unusedExports.length} potentially unused exports`);

  // Print unused files if any
  if (unusedAnalysis.unusedFiles.length > 0) {
    console.log('\nPotentially unused files:');
    for (const file of unusedAnalysis.unusedFiles.slice(0, 20)) {
      console.log(`  - ${file}`);
    }
    if (unusedAnalysis.unusedFiles.length > 20) {
      console.log(`  ... and ${unusedAnalysis.unusedFiles.length - 20} more`);
    }
  }

  // Print unused exports if any (grouped by file)
  if (unusedAnalysis.unusedExports.length > 0) {
    console.log('\nPotentially unused exports:');
    const byFile = new Map<string, UnusedExport[]>();
    for (const exp of unusedAnalysis.unusedExports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }
    let shown = 0;
    for (const [file, exports] of byFile) {
      if (shown >= 10) {
        console.log(`  ... and ${byFile.size - 10} more files with unused exports`);
        break;
      }
      console.log(`  ${file}:`);
      for (const exp of exports.slice(0, 5)) {
        console.log(`    - ${exp.name} (${exp.type})`);
      }
      if (exports.length > 5) {
        console.log(`    ... and ${exports.length - 5} more`);
      }
      shown++;
    }
  }

  // Write full unused analysis to a separate file
  const unusedReportPath = join(OUTPUT_DIR, 'unused-analysis.md');
  let unusedReport = '# Unused Files and Exports Analysis\n\n';
  unusedReport += `**Generated**: ${new Date().toISOString().split('T')[0]}\n\n`;
  const deadExports = unusedAnalysis.unusedExports.filter((e) => e.inFileRefs === 0);
  const contractExports = unusedAnalysis.unusedExports.filter((e) => e.inFileRefs > 0);

  unusedReport += `## Summary\n\n`;
  unusedReport += `- **Potentially unused files**: ${unusedAnalysis.unusedFiles.length}\n`;
  unusedReport += `- **Dormant files** (runtime code on disk, unreachable from any entry/build root): ${dormantAll.length}\n`;
  unusedReport += `  - **Orphaned (reachable from nothing — delete/wire candidates)**: ${orphaned.length}\n`;
  unusedReport += `  - **Test-only (exercised by a test, ships nothing)**: ${testOnly.length}\n`;
  unusedReport += `- **Potentially unused exports**: ${unusedAnalysis.unusedExports.length}\n`;
  unusedReport += `  - **Unreferenced anywhere (deletion candidates)**: ${deadExports.length}\n`;
  unusedReport += `  - **Referenced in-module (type contracts / helpers backing live exports)**: ${contractExports.length}\n\n`;

  unusedReport += `Seeded reachability roots (${rootsSet.size}):\n\n`;
  for (const r of [...rootsSet].sort()) unusedReport += `- \`${r}\`\n`;
  unusedReport += '\n';

  const renderFileList = (files: string[]): string => {
    if (files.length === 0) return `_None._\n\n`;
    let out = '';
    for (const f of files) out += `- \`${f}\`\n`;
    out += '\n';
    return out;
  };

  unusedReport += `## Dormant Files — Orphaned (delete/wire candidates)\n\n`;
  unusedReport += `Runtime source files reachable from NO root and NO test. Each is either dead code\n`;
  unusedReport += `to delete, or a root the tool cannot see (a new build/worker entry, a\n`;
  unusedReport += `\`new URL()\`-loaded script, or a side-effect-only module) — in which case wire it\n`;
  unusedReport += `or seed it. Verify before deleting.\n\n`;
  unusedReport += renderFileList(orphaned);

  unusedReport += `## Dormant Files — Test-only (ships nothing, but exercised)\n\n`;
  unusedReport += `Not reachable from any package entry point, but imported by a test — deliberately\n`;
  unusedReport += `kept, standalone-tested code or a helper a test drives directly. Not dead; not\n`;
  unusedReport += `shipped. No action needed.\n\n`;
  unusedReport += renderFileList(testOnly);

  unusedReport += `## Potentially Unused Files\n\n`;
  unusedReport += `These files are not imported by any other file in the codebase:\n\n`;
  unusedReport += renderFileList(unusedAnalysis.unusedFiles);

  const renderByFile = (exports: UnusedExport[], note?: (e: UnusedExport) => string): string => {
    if (exports.length === 0) return `_None._\n\n`;
    let out = '';
    const byFile = new Map<string, UnusedExport[]>();
    for (const exp of exports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }
    for (const [file, exps] of byFile) {
      out += `### \`${file}\`\n\n`;
      for (const exp of exps) {
        out += `- \`${exp.name}\` (${exp.type})${note ? note(exp) : ''}\n`;
      }
      out += '\n';
    }
    return out;
  };

  unusedReport += `## Unreferenced Anywhere (deletion candidates)\n\n`;
  unusedReport += `Not imported by any other file AND not referenced within their own module — `;
  unusedReport += `the true dead-code candidates. Verify each isn't consumed by a mechanism the\n`;
  unusedReport += `parser can't see (dynamic access, docs examples, published-API contract) before deleting.\n\n`;
  unusedReport += renderByFile(deadExports);

  unusedReport += `## Referenced In-Module (type contracts / helpers backing live exports)\n\n`;
  unusedReport += `Not imported cross-file, but referenced within their own module — they type or\n`;
  unusedReport += `support exports that ARE used, so they cannot be deleted in isolation.\n\n`;
  unusedReport += renderByFile(
    contractExports,
    (e) => ` — ${e.inFileRefs} in-file ref${e.inFileRefs === 1 ? '' : 's'}`
  );

  writeFileSync(unusedReportPath, unusedReport);
  console.log(`\nWritten: ${unusedReportPath}`);

  // Complete file census + self-check.
  const inventory = buildFileInventory(ROOT_DIR, rootsSet, reachableSet, testReachable);
  writeFileSync(join(OUTPUT_DIR, 'file-inventory.json'), JSON.stringify(inventory, null, 2));
  writeFileSync(join(OUTPUT_DIR, 'FILE_INVENTORY.md'), generateFileInventoryMarkdown(inventory));
  console.log(
    `Written: docs/architecture/FILE_INVENTORY.md (${inventory.totalFiles} files: ` +
      Object.entries(inventory.byDisposition)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ') +
      ')'
  );
  verifyFileCensus(ROOT_DIR, inventory, cliOptions.strictOrphans);

  // Print test coverage summary if enabled
  if (testCoverage) {
    const coveragePercent =
      testCoverage.sourceFiles.length > 0
        ? ((testCoverage.testedFiles.length / testCoverage.sourceFiles.length) * 100).toFixed(1)
        : '0';

    console.log('\n=== Test Coverage Analysis ===');
    console.log(`  - ${testCoverage.testFiles.length} test files analyzed`);
    console.log(
      `  - ${testCoverage.testedFiles.length}/${testCoverage.sourceFiles.length} source files have tests (${coveragePercent}%)`
    );
    console.log(`  - ${testCoverage.untestedFiles.length} source files without tests`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
