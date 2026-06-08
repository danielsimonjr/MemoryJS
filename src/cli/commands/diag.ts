/**
 * Diagnostic CLI commands.
 *
 * Surface for understanding the current memoryjs runtime + storage state.
 * Designed as a fast-feedback engineering tool for triage when the MCP
 * server isn't responding or when graph state is suspect.
 *
 *   memory diag      one-shot snapshot: versions, runtime, storage, env
 *   memory env       all known memoryjs env vars with resolved + default values
 *   memory health    fast integrity checks (graph loads, no orphans, no cycles)
 *   memory version   compact version line for piping into other tooling
 *
 * All commands emit JSON by default (pipe-friendly). Each command exits
 * non-zero on hard failure (e.g. graph won't load); `health` additionally
 * exits non-zero when any check fails.
 *
 * @module cli/commands/diag
 */

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ManagerContext } from '../../core/ManagerContext.js';
import type { Entity } from '../../types/types.js';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

/**
 * Catalog of all memoryjs env vars (current value + documented default).
 * Mirrors the Environment Variables section of `CLAUDE.md` so operators can
 * see the contract without leaving the terminal.
 */
const ENV_VAR_CATALOG: Array<{ name: string; defaultValue: string; description: string }> = [
  // Core
  { name: 'MEMORY_STORAGE_TYPE', defaultValue: 'jsonl', description: 'jsonl | sqlite — storage backend selector' },
  { name: 'MEMORY_FILE_PATH', defaultValue: '(repo default)', description: 'Custom storage file path' },
  { name: 'SKIP_BENCHMARKS', defaultValue: 'false', description: 'Skip performance-benchmark tests' },
  { name: 'LOG_LEVEL', defaultValue: '(none)', description: 'debug | info | warn | error' },
  // Embeddings
  { name: 'MEMORY_EMBEDDING_PROVIDER', defaultValue: 'local', description: 'openai | local | none' },
  { name: 'MEMORY_OPENAI_API_KEY', defaultValue: '(unset)', description: 'OpenAI API key (when provider=openai)' },
  { name: 'MEMORY_EMBEDDING_MODEL', defaultValue: '(provider default)', description: 'Override embedding model name' },
  { name: 'MEMORY_AUTO_INDEX_EMBEDDINGS', defaultValue: 'false', description: 'Auto-index new entities for semantic search' },
  // Read pool / coalescing
  { name: 'MEMORY_SQLITE_READ_POOL_SIZE', defaultValue: '4', description: 'SQLite read-connection pool size' },
  { name: 'MEMORY_INDEX_COALESCE_MS', defaultValue: '50', description: 'TF-IDF event-sync coalescing window (ms)' },
  // Governance
  { name: 'MEMORY_GOVERNANCE_ENABLED', defaultValue: 'false', description: 'Enable governance policy enforcement' },
  { name: 'MEMORY_AUDIT_LOG_FILE', defaultValue: '(unset)', description: 'Path for audit JSONL trail' },
  { name: 'MEMORY_FRESHNESS_TTL_DEFAULT_HOURS', defaultValue: '168', description: 'Default freshness TTL (hours)' },
  // Agent role + advanced
  { name: 'MEMORY_AGENT_ROLE', defaultValue: '(unset)', description: 'researcher | planner | executor | reviewer | coordinator' },
  { name: 'MEMORY_ENTROPY_FILTER_ENABLED', defaultValue: 'false', description: 'Enable low-entropy observation filter' },
  { name: 'MEMORY_ENTROPY_THRESHOLD', defaultValue: '0.3', description: 'Entropy filter threshold (0–1)' },
  { name: 'MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', defaultValue: 'false', description: 'Enable background consolidation' },
  { name: 'MEMORY_CONSOLIDATION_INTERVAL_MS', defaultValue: '3600000', description: 'Consolidation interval (ms)' },
  { name: 'MEMORY_DEFAULT_VISIBILITY', defaultValue: 'private', description: 'private | team | org | shared | public' },
  // CLI-only
  { name: 'MEMORYJS_STORAGE_PATH', defaultValue: './memory.jsonl', description: 'CLI: default storage path' },
  { name: 'MEMORYJS_OUTPUT_FORMAT', defaultValue: 'json', description: 'CLI: json | table | csv' },
];

interface DiagSnapshot {
  memoryjs: { version: string };
  runtime: { node: string; platform: string; arch: string; pid: number };
  storage: {
    path: string;
    type: string;
    exists: boolean;
    sizeBytes: number;
    entities: number;
    relations: number;
  };
  loadedAt: string;
}

function readPackageVersion(): string {
  // Resolve relative to the compiled CLI bundle, then fall back to the source
  // package.json for `npx tsx`-style runs.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, '../../../package.json'),
      join(here, '../../package.json'),
      join(here, '../package.json'),
    ]) {
      try {
        const raw = readFileSync(candidate, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === '@danielsimonjr/memoryjs' && pkg.version) return pkg.version;
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return 'unknown';
}

async function buildSnapshot(ctx: ManagerContext, storagePath: string): Promise<DiagSnapshot> {
  let sizeBytes = 0;
  let exists = false;
  try {
    const stat = await fs.stat(storagePath);
    exists = true;
    sizeBytes = stat.size;
  } catch { /* file may not exist yet */ }

  const stats = await ctx.analyticsManager.getGraphStats();

  return {
    memoryjs: { version: readPackageVersion() },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    storage: {
      path: storagePath,
      type: process.env.MEMORY_STORAGE_TYPE ?? 'jsonl',
      exists,
      sizeBytes,
      entities: stats.totalEntities,
      relations: stats.totalRelations,
    },
    loadedAt: new Date().toISOString(),
  };
}

interface HealthCheck {
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
}

async function runHealthChecks(ctx: ManagerContext): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  // 1. Storage loads
  const t1 = performance.now();
  let graph: Awaited<ReturnType<typeof ctx.storage.loadGraph>>;
  try {
    graph = await ctx.storage.loadGraph();
    checks.push({ name: 'storage:loadGraph', ok: true, durationMs: performance.now() - t1 });
  } catch (e) {
    checks.push({
      name: 'storage:loadGraph',
      ok: false,
      durationMs: performance.now() - t1,
      detail: e instanceof Error ? e.message : String(e),
    });
    return checks; // Without the graph, downstream checks can't run.
  }

  // 2. Distinct entity names
  const t2 = performance.now();
  const names = new Set<string>();
  const dupes: string[] = [];
  for (const e of graph.entities) {
    if (names.has(e.name)) dupes.push(e.name);
    else names.add(e.name);
  }
  checks.push({
    name: 'entities:distinct-names',
    ok: dupes.length === 0,
    durationMs: performance.now() - t2,
    detail: dupes.length === 0 ? undefined : `duplicates: ${dupes.slice(0, 5).join(', ')}${dupes.length > 5 ? '…' : ''}`,
  });

  // 3. No orphan relations (every from/to resolves to an entity)
  const t3 = performance.now();
  const orphans: string[] = [];
  for (const r of graph.relations) {
    if (!names.has(r.from)) orphans.push(`${r.from} → ${r.to} (from missing)`);
    else if (!names.has(r.to)) orphans.push(`${r.from} → ${r.to} (to missing)`);
  }
  checks.push({
    name: 'relations:no-orphans',
    ok: orphans.length === 0,
    durationMs: performance.now() - t3,
    detail: orphans.length === 0 ? undefined : `${orphans.length} orphan(s); first: ${orphans.slice(0, 3).join('; ')}`,
  });

  // 4. Hierarchy: no cycles, parents exist
  const t4 = performance.now();
  const byName = new Map<string, Entity>();
  for (const e of graph.entities) byName.set(e.name, e);
  const cycleIssues: string[] = [];
  for (const e of graph.entities) {
    if (!e.parentId) continue;
    const visited = new Set<string>();
    let cur: Entity | undefined = byName.get(e.parentId);
    while (cur && cur.parentId) {
      if (visited.has(cur.name)) {
        cycleIssues.push(`cycle through ${cur.name}`);
        break;
      }
      visited.add(cur.name);
      cur = byName.get(cur.parentId);
    }
    if (e.parentId && !byName.has(e.parentId)) {
      cycleIssues.push(`${e.name}.parentId='${e.parentId}' missing`);
    }
  }
  checks.push({
    name: 'hierarchy:no-cycles-no-missing-parents',
    ok: cycleIssues.length === 0,
    durationMs: performance.now() - t4,
    detail: cycleIssues.length === 0 ? undefined : cycleIssues.slice(0, 3).join('; '),
  });

  return checks;
}

export function registerDiagCommand(program: Command): void {
  program
    .command('diag')
    .description('One-shot diagnostic snapshot: memoryjs version, runtime, storage, env')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const snapshot = await buildSnapshot(ctx, options.storage);
        console.log(JSON.stringify(snapshot, null, 2));
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });

  program
    .command('env')
    .description('Print all memoryjs env vars with documented defaults and resolved values')
    .option('--all', 'Include vars that are unset and have no documented default override')
    .action(async (opts: { all?: boolean }) => {
      const showAll = Boolean(opts.all);
      const rows = ENV_VAR_CATALOG.map((spec) => {
        const current = process.env[spec.name];
        return {
          name: spec.name,
          value: current ?? null,
          default: spec.defaultValue,
          set: current !== undefined,
          description: spec.description,
        };
      });
      const filtered = showAll ? rows : rows.filter((r) => r.set || !r.default.startsWith('('));
      console.log(JSON.stringify({ count: filtered.length, vars: filtered }, null, 2));
    });

  program
    .command('health')
    .description('Run fast integrity checks (graph loads, distinct names, no orphan relations, no hierarchy cycles)')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const checks = await runHealthChecks(ctx);
        const failed = checks.filter((c) => !c.ok).length;
        const totalMs = checks.reduce((acc, c) => acc + c.durationMs, 0);
        console.log(JSON.stringify({
          ok: failed === 0,
          failed,
          totalChecks: checks.length,
          totalMs: Number(totalMs.toFixed(2)),
          checks,
        }, null, 2));
        if (failed > 0) process.exit(1);
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });

  program
    .command('version')
    .description('Compact version line: memoryjs, node, platform')
    .action(() => {
      console.log(JSON.stringify({
        memoryjs: readPackageVersion(),
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
      }));
    });

}
