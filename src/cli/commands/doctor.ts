/**
 * Preflight CLI command — `memory doctor` (R9).
 *
 * Checks the documented gotchas (CLAUDE.md) before they turn into confusing
 * runtime failures, each with pass/warn/fail + a fix hint:
 *
 *   1. Node version >= 18 (package.json `engines`)
 *   2. better-sqlite3 loadability + ABI (NODE_MODULE_VERSION mismatch)
 *   3. Workers built: dist/workers/levenshteinWorker.* present (tsup, not tsc)
 *   4. Storage file sanity (MEMORY_FILE_PATH parent dir + JSONL/SQLite probe)
 *   5. Env-var lint (strict-literal 'true' flags, numeric vars)
 *   6. Embedding provider configuration (openai without API key, etc.)
 *
 * Exit code 1 when any check FAILS (warns don't fail the run). `--json`
 * emits a machine-readable report.
 *
 * Structured as exported pure check functions (dependency-injected env /
 * require / paths) + a thin command wrapper, so tests exercise each check
 * without subprocesses.
 *
 * @module cli/commands/doctor
 */

import { Command } from 'commander';
import { existsSync, constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getOptions, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';
import { ENV_VAR_CATALOG } from './diag.js';

// ==================== Types ====================

/**
 * Outcome of one doctor check: `pass`, `warn` or `fail`.
 */
export type DoctorStatus = 'pass' | 'warn' | 'fail';

/**
 * Result of one doctor check.
 */
export interface DoctorCheckResult {
  /** Stable check identifier (used in JSON output + tests). */
  name: string;
  status: DoctorStatus;
  /** One-line human-readable outcome. */
  message: string;
  /** How to fix it (present on warn/fail where a fix is known). */
  hint?: string;
}

/**
 * Aggregate result of all doctor checks, with per-status counts.
 *
 * `ok` is true when no check has the status `fail`.
 */
export interface DoctorReport {
  ok: boolean;
  passed: number;
  warned: number;
  failed: number;
  checks: DoctorCheckResult[];
}

// ==================== Check 1: Node version ====================

/**
 * Minimum Node major version — mirrors package.json `"engines": { "node":
 * ">=18.0.0" }`. Kept as a constant (rather than parsing package.json at
 * runtime) so the check works identically from the bundled CLI and `tsx`.
 */
export const MIN_NODE_MAJOR = 18;

/**
 * Check that the Node major version meets {@link MIN_NODE_MAJOR}.
 *
 * @param version - The Node version string, for example `v20.1.0`. The default is `process.version`.
 * @returns `pass` or `fail`, or `warn` when the string has no leading major number.
 */
export function checkNodeVersion(version: string = process.version): DoctorCheckResult {
  const name = 'node-version';
  const match = /^v?(\d+)/.exec(version);
  if (!match) {
    return { name, status: 'warn', message: `Unrecognized Node version string: "${version}"` };
  }
  const major = parseInt(match[1], 10);
  if (major >= MIN_NODE_MAJOR) {
    return { name, status: 'pass', message: `Node ${version} satisfies engines >=${MIN_NODE_MAJOR}.0.0` };
  }
  return {
    name,
    status: 'fail',
    message: `Node ${version} is below the required >=${MIN_NODE_MAJOR}.0.0 (package.json engines)`,
    hint: `Install Node >= ${MIN_NODE_MAJOR} (e.g. via nvm: nvm install ${MIN_NODE_MAJOR})`,
  };
}

// ==================== Check 2: better-sqlite3 ====================

/**
 * Check that the `better-sqlite3` native addon loads.
 *
 * A `NODE_MODULE_VERSION` error gives `fail` (ABI mismatch).
 * A missing module gives `warn`, because the JSONL backend still works.
 * Any other load error gives `fail`.
 *
 * @param requireFn - The require function to use. Tests inject a stub. The default is a `createRequire` for this module.
 * @returns The check result. The function does not throw.
 */
export function checkBetterSqlite3(
  requireFn?: (id: string) => unknown,
): DoctorCheckResult {
  const name = 'better-sqlite3';
  const req = requireFn ?? createRequire(import.meta.url);
  try {
    req('better-sqlite3');
    return { name, status: 'pass', message: 'better-sqlite3 loads (native addon ABI matches this Node)' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as NodeJS.ErrnoException).code;
    if (message.includes('NODE_MODULE_VERSION')) {
      return {
        name,
        status: 'fail',
        message: 'better-sqlite3 ABI mismatch — the prebuilt binary was compiled for a different Node version',
        hint: 'Run: npm rebuild better-sqlite3',
      };
    }
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      return {
        name,
        status: 'warn',
        message: 'better-sqlite3 is not installed — the SQLite backend is unavailable (JSONL still works)',
        hint: 'Run: npm install (check node-gyp prerequisites if the native build fails)',
      };
    }
    return {
      name,
      status: 'fail',
      message: `better-sqlite3 failed to load: ${message}`,
      hint: 'Run: npm rebuild better-sqlite3 (and check node-gyp prerequisites)',
    };
  }
}

// ==================== Check 3: Workers built ====================

const WORKER_BASENAME = 'levenshteinWorker';
const WORKER_EXTENSIONS = ['.js', '.cjs', '.mjs'];

/**
 * Candidate `dist/workers` locations, covering both the bundled CLI
 * (dist/cli/… → ../workers) and source runs via tsx (repo/dist/workers).
 */
export function defaultWorkerDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, '..', 'workers'),
    join(here, '..', '..', 'workers'),
    join(here, '..', '..', '..', 'dist', 'workers'),
    resolve(process.cwd(), 'dist', 'workers'),
  ];
}

/**
 * Check that a built Levenshtein worker bundle exists.
 *
 * @param dirs - The directories to search for `levenshteinWorker.js`, `.cjs` or `.mjs`.
 * @returns `pass` with the first match, or `fail` when no directory holds the bundle.
 */
export function checkWorkersBuilt(dirs: string[] = defaultWorkerDirs()): DoctorCheckResult {
  const name = 'workers-built';
  for (const dir of dirs) {
    for (const ext of WORKER_EXTENSIONS) {
      const candidate = join(dir, WORKER_BASENAME + ext);
      if (existsSync(candidate)) {
        return { name, status: 'pass', message: `Worker bundle found: ${candidate}` };
      }
    }
  }
  return {
    name,
    status: 'fail',
    message: `dist/workers/${WORKER_BASENAME}.* not found — fuzzy search (Levenshtein worker pool) will fail at runtime`,
    hint: 'Run: npm run build (tsup builds workers; bare `npm run build:tsc` does NOT)',
  };
}

// ==================== Check 4: Storage file sanity ====================

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Check that the file in `MEMORY_FILE_PATH` is usable storage.
 *
 * The check needs a writable parent directory.
 * For SQLite, it compares the 16-byte file header with the SQLite magic string.
 * For JSONL, it parses the first non-blank line as JSON.
 * An unset path, a missing file and an empty file give `pass`.
 *
 * @param env - The environment to read. The default is `process.env`.
 * @returns The check result. The function closes the file handle before it returns.
 */
export async function checkStorageFile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorCheckResult> {
  const name = 'storage-file';
  const filePath = env.MEMORY_FILE_PATH;
  if (!filePath) {
    return { name, status: 'pass', message: 'MEMORY_FILE_PATH not set — default storage path applies' };
  }

  const resolved = resolve(filePath);
  const parentDir = dirname(resolved);
  try {
    await fs.access(parentDir, fsConstants.W_OK);
  } catch {
    return {
      name,
      status: 'fail',
      message: `Parent directory of MEMORY_FILE_PATH is missing or not writable: ${parentDir}`,
      hint: `Create it (mkdir -p "${parentDir}") or fix its permissions`,
    };
  }

  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(resolved, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { name, status: 'pass', message: `Storage file does not exist yet (${resolved}) — it will be created on first write` };
    }
    return {
      name,
      status: 'fail',
      message: `Cannot open storage file ${resolved}: ${(error as Error).message}`,
      hint: 'Check file permissions',
    };
  }

  try {
    const isSqlite = env.MEMORY_STORAGE_TYPE === 'sqlite' || /\.(db|sqlite3?)$/i.test(resolved);
    if (isSqlite) {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buf, 0, 16, 0);
      if (bytesRead === 0) {
        return { name, status: 'pass', message: `Storage file is empty (${resolved}) — fresh SQLite database` };
      }
      if (bytesRead === 16 && buf.toString('latin1', 0, 16) === SQLITE_MAGIC) {
        return { name, status: 'pass', message: `SQLite magic bytes verified (${resolved})` };
      }
      return {
        name,
        status: 'fail',
        message: `${resolved} is not a SQLite database (bad magic bytes) but the SQLite backend is selected`,
        hint: 'Point MEMORY_FILE_PATH at a .db created by memoryjs, or set MEMORY_STORAGE_TYPE=jsonl',
      };
    }

    // JSONL: probe the first line.
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead === 0) {
      return { name, status: 'pass', message: `Storage file is empty (${resolved}) — fresh JSONL store` };
    }
    const text = buf.toString('utf-8', 0, bytesRead);
    if (!text.includes('\n') && bytesRead === buf.length) {
      return { name, status: 'warn', message: `First line of ${resolved} exceeds the 64 KiB probe window — JSONL parse check skipped` };
    }
    const firstLine = text.split('\n').find((line) => line.trim() !== '');
    if (firstLine === undefined) {
      return { name, status: 'pass', message: `Storage file contains only blank lines (${resolved})` };
    }
    try {
      JSON.parse(firstLine.trim());
      return { name, status: 'pass', message: `JSONL storage file parses (${resolved})` };
    } catch {
      return {
        name,
        status: 'fail',
        message: `First line of ${resolved} is not valid JSON — corrupt or not a JSONL store`,
        hint: 'Inspect the file; restore from backup, or set MEMORY_STORAGE_TYPE=sqlite if it is a database file',
      };
    }
  } finally {
    await handle.close();
  }
}

// ==================== Check 5: Env-var lint ====================

/**
 * Flags that only activate on the strict literal string `'true'`
 * (CLAUDE.md: `'1'` / `'yes'` / `'TRUE'` silently decline).
 */
export const STRICT_TRUE_VARS = [
  'MEMORY_GOVERNANCE_ENABLED',
  'MEMORY_OBSERVATIONS_COLUMNAR',
  'MEMORY_TIERED_INDEX',
  'MEMORY_CACHE_COMPRESS',
  'MEMORY_USE_MMAP',
] as const;

/** Values that look like an attempt to enable a flag but are not `'true'`. */
const TRUTHY_LOOKALIKES = new Set(['1', 'yes', 'y', 'on', 'true', 'enabled']);

/**
 * Numeric vars not covered by ENV_VAR_CATALOG's numeric defaults
 * (the catalog contributes the rest — see {@link numericEnvVarNames}).
 */
export const EXTRA_NUMERIC_VARS = [
  'MEMORY_STORAGE_SEGMENT_COUNT',
  'MEMORY_MMAP_THRESHOLD_BYTES',
  'MEMORY_CACHE_BUDGET_ENTRIES',
  'MEMORY_DECAY_HALF_LIFE_HOURS',
  'MEMORY_DECAY_MIN_IMPORTANCE',
  'MEMORY_DECAY_INTERVAL_MS',
  'MEMORY_FORGET_THRESHOLD',
  'MEMORY_CONTEXT_MAX_TOKENS',
  'MEMORY_CONTEXT_TOKEN_MULTIPLIER',
  'MEMORY_CONTEXT_RESERVE_BUFFER',
  'MEMORY_COGNITIVE_LOAD_MAX',
  'MEMORY_HYBRID_GRAPH_WEIGHT',
  'MEMORY_RANKED_GRAPH_BOOST',
  'MEMORY_SALIENCE_CONNECTIVITY_WEIGHT',
  'MEMORY_DECAY_CONNECTIVITY_PROTECTION',
] as const;

/**
 * Vars linted as numeric: every ENV_VAR_CATALOG entry whose documented
 * default is a plain number, plus {@link EXTRA_NUMERIC_VARS}.
 */
export function numericEnvVarNames(): string[] {
  const fromCatalog = ENV_VAR_CATALOG
    .filter((spec) => /^\d+(\.\d+)?$/.test(spec.defaultValue))
    .map((spec) => spec.name);
  return [...new Set([...fromCatalog, ...EXTRA_NUMERIC_VARS])];
}

/**
 * Find environment variables that the library silently ignores.
 *
 * The check flags a strict-literal flag with a truthy lookalike value, such as `1` or `TRUE`.
 * It also flags a numeric variable whose value does not parse as a number.
 *
 * @param env - The environment to read. The default is `process.env`.
 * @returns `pass`, or `warn` with every issue in the message.
 */
export function checkEnvVarLint(env: NodeJS.ProcessEnv = process.env): DoctorCheckResult {
  const name = 'env-var-lint';
  const issues: string[] = [];

  for (const varName of STRICT_TRUE_VARS) {
    const value = env[varName];
    if (value === undefined || value === 'true') continue;
    if (TRUTHY_LOOKALIKES.has(value.trim().toLowerCase())) {
      issues.push(`${varName}='${value}' is silently ignored — must be the literal string 'true'`);
    }
  }

  for (const varName of numericEnvVarNames()) {
    const value = env[varName];
    if (value === undefined) continue;
    if (value.trim() === '' || Number.isNaN(Number(value.trim()))) {
      issues.push(`${varName}='${value}' is not numeric`);
    }
  }

  if (issues.length === 0) {
    return { name, status: 'pass', message: 'No env-var misconfigurations detected' };
  }
  return {
    name,
    status: 'warn',
    message: issues.join('; '),
    hint: "Strict-literal flags accept only 'true'; numeric vars must parse as numbers",
  };
}

// ==================== Check 6: Embedding provider ====================

/**
 * Check the `MEMORY_EMBEDDING_PROVIDER` setting.
 *
 * The `openai` provider needs `MEMORY_OPENAI_API_KEY`, and gives `fail` without it.
 * The check does not test network access.
 *
 * @param env - The environment to read. The default is `process.env`.
 * @returns `pass` for a valid configuration, `fail` for a missing key, or `warn` for an unknown provider.
 */
export function checkEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): DoctorCheckResult {
  const name = 'embedding-provider';
  const provider = env.MEMORY_EMBEDDING_PROVIDER ?? 'local';
  switch (provider) {
    case 'openai':
      if (!env.MEMORY_OPENAI_API_KEY) {
        return {
          name,
          status: 'fail',
          message: 'MEMORY_EMBEDDING_PROVIDER=openai but MEMORY_OPENAI_API_KEY is not set — semantic search will fail',
          hint: 'Set MEMORY_OPENAI_API_KEY, or switch MEMORY_EMBEDDING_PROVIDER to local (zero-config)',
        };
      }
      return { name, status: 'pass', message: 'openai provider with API key present (network reachability not probed)' };
    case 'local':
      return { name, status: 'pass', message: 'local embedding provider — zero-config, no API key needed' };
    case 'none':
      return { name, status: 'pass', message: 'embeddings disabled (provider=none) — semantic search unavailable by choice' };
    default:
      return {
        name,
        status: 'warn',
        message: `Unknown MEMORY_EMBEDDING_PROVIDER '${provider}'`,
        hint: 'Valid values: openai | local | none',
      };
  }
}

// ==================== Runner + command ====================

/**
 * Run all six doctor checks in sequence and count the results.
 *
 * @param env - The environment for the checks that read it. The default is `process.env`.
 * @returns The report with every check result and the pass, warn and fail counts.
 */
export async function runDoctorChecks(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [
    checkNodeVersion(),
    checkBetterSqlite3(),
    checkWorkersBuilt(),
    await checkStorageFile(env),
    checkEnvVarLint(env),
    checkEmbeddingProvider(env),
  ];
  const passed = checks.filter((c) => c.status === 'pass').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  return { ok: failed === 0, passed, warned, failed, checks };
}

/**
 * Register the `doctor` command.
 *
 * The command prints each check result, or a JSON report with `--json`.
 * The process exits with code 1 when a check fails.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Preflight checks for documented gotchas: node version, better-sqlite3 ABI, workers build, storage file, env lint, embedding provider')
    .option('--json', 'Emit machine-readable JSON report')
    .action(async (opts: { json?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      try {
        const report = await runDoctorChecks();

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          for (const check of report.checks) {
            console.log(`[${check.status.toUpperCase().padEnd(4)}] ${check.name} — ${check.message}`);
            if (check.hint && check.status !== 'pass') {
              console.log(`       hint: ${check.hint}`);
            }
          }
          console.log('');
          console.log(
            `${report.checks.length} checks: ${report.passed} passed, ${report.warned} warned, ${report.failed} failed`
          );
        }
        if (!report.ok) process.exit(1);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
