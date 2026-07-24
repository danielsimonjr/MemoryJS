/**
 * Audit CLI Commands — `memory audit` (R4a queryable provenance).
 *
 * Exposes the AuditLog's query surface on the command line so operators can
 * treat the audit trail as a retrieval surface (brainapi2's
 * `/retrieve/changelogs` pattern):
 *
 *   memory audit log      filtered listing (--entity --op --agent --since
 *                         --until --text --limit), table-ish lines by
 *                         default, --json for piping
 *   memory audit history  full chronological history for one entity
 *   memory audit verify   hash-chain verification; exit code 1 when broken
 *   memory audit stats    entry counts by operation + oldest/newest
 *
 * Audit file resolution mirrors `ManagerContext.governanceManager`:
 * `MEMORY_AUDIT_LOG_FILE` when set, otherwise the `<basename>-audit.jsonl`
 * sidecar next to the storage file. `--file <path>` overrides both.
 *
 * @module cli/commands/audit
 */

import { resolve, dirname, basename, extname, join } from 'node:path';
import { Command, Option } from 'commander';
import { getOptions, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';
import { validateFilePath } from '../../utils/entityUtils.js';
import {
  AuditLog,
  type AuditEntry,
  type AuditFilter,
  type AuditOperation,
  type ChainVerificationResult,
} from '../../features/AuditLog.js';

/** Operation choices for `--op` (mirrors the AuditOperation union). */
export const AUDIT_OPERATIONS = ['create', 'update', 'delete', 'merge', 'archive'] as const;

/**
 * Resolve the audit log file path.
 *
 * Precedence: explicit `--file` override → `MEMORY_AUDIT_LOG_FILE` env var →
 * `<basename>-audit.jsonl` sidecar next to the storage file (the exact
 * convention `ManagerContext.governanceManager` uses — replicated here so the
 * CLI reads the same file governance writes, without constructing a context).
 */
export function resolveAuditFilePath(
  storagePath: string,
  fileOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (fileOverride) {
    // CLI path is user-explicit; ".." defense-in-depth still runs.
    return validateFilePath(resolve(fileOverride), undefined, false);
  }
  if (env.MEMORY_AUDIT_LOG_FILE) {
    return env.MEMORY_AUDIT_LOG_FILE;
  }
  const dir = dirname(storagePath);
  const base = basename(storagePath, extname(storagePath));
  return join(dir, `${base}-audit.jsonl`);
}

const RELATIVE_TIME_RE = /^(\d+)\s*([smhdw])$/i;
const RELATIVE_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a `--since` / `--until` value into an ISO 8601 timestamp.
 *
 * Accepts either an ISO/date string (anything `new Date()` parses) or a
 * relative spec like `30m`, `2h`, `7d`, `1w` (interpreted as "that long ago
 * from now"). Throws on unparseable input.
 */
export function parseTimeSpec(value: string, now: Date = new Date()): string {
  const rel = RELATIVE_TIME_RE.exec(value.trim());
  if (rel) {
    const amount = parseInt(rel[1], 10);
    const unitMs = RELATIVE_UNIT_MS[rel[2].toLowerCase()];
    return new Date(now.getTime() - amount * unitMs).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid time spec: "${value}" (expected ISO 8601 like 2026-07-01T00:00:00Z, or relative like "30m", "2h", "7d", "1w")`
    );
  }
  return parsed.toISOString();
}

/**
 * One table-ish line per entry for the default (non-`--json`) output.
 * Fixed-width leading columns so the lines align for eyeballing/grep.
 */
export function formatAuditEntryLine(entry: AuditEntry): string {
  const agent = entry.agentId ?? '-';
  return [
    entry.timestamp,
    entry.operation.padEnd(7),
    entry.status.padEnd(11),
    agent.padEnd(12),
    entry.entityName,
  ].join('  ');
}

/** Human-readable verdict lines for `audit verify`. */
export function formatVerifyVerdict(result: ChainVerificationResult): string {
  if (!result.valid) {
    const at = result.brokenAt !== undefined ? ` at line index ${result.brokenAt}` : '';
    return `Audit chain BROKEN${at} — ${result.totalChecked} entries verified before the break` +
      (result.malformedLines > 0 ? `; ${result.malformedLines} malformed line(s)` : '') +
      '. The file was modified, truncated mid-chain, or corrupted.';
  }
  if (result.totalChecked === 0 && result.legacyLines > 0) {
    return `Audit chain: legacy-only file — nothing verifiable (${result.legacyLines} pre-chaining line(s)).`;
  }
  if (result.totalChecked === 0) {
    return 'Audit log empty or missing — nothing to verify.';
  }
  const legacy = result.legacyLines > 0 ? ` (${result.legacyLines} leading legacy line(s) unverifiable)` : '';
  return `Audit chain OK — ${result.totalChecked} entries verified${legacy}.`;
}

interface AuditLogCliOpts {
  entity?: string;
  op?: AuditOperation;
  agent?: string;
  since?: string;
  until?: string;
  text?: string;
  limit?: string;
  file?: string;
  json?: boolean;
}

export function registerAuditCommands(program: Command): void {
  const audit = program
    .command('audit')
    .description('Query the audit trail (provenance): filtered log, per-entity history, chain verification, stats');

  audit
    .command('log')
    .description('List audit entries with filters (default: aligned lines; --json for piping)')
    .option('--entity <name>', 'Filter by entity name (exact match)')
    .addOption(new Option('--op <type>', 'Filter by operation type').choices([...AUDIT_OPERATIONS]))
    .option('--agent <id>', 'Filter by agent/user identifier')
    .option('--since <time>', 'Only entries at/after this time (ISO 8601, or relative like "2h", "7d")')
    .option('--until <time>', 'Only entries at/before this time (ISO 8601, or relative like "2h")')
    .option('--text <substr>', 'Case-insensitive free-text match over serialized entries')
    .option('--limit <n>', 'Keep only the most recent N matches')
    .option('--file <path>', 'Audit log file (overrides MEMORY_AUDIT_LOG_FILE and the sidecar default)')
    .option('--json', 'Emit entries as JSON')
    .action(async (opts: AuditLogCliOpts) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      try {
        const auditPath = resolveAuditFilePath(options.storage, opts.file);
        const filter: AuditFilter = {};
        if (opts.entity !== undefined) filter.entityName = opts.entity;
        if (opts.op !== undefined) filter.operation = opts.op;
        if (opts.agent !== undefined) filter.agentId = opts.agent;
        if (opts.since !== undefined) filter.fromTime = parseTimeSpec(opts.since);
        if (opts.until !== undefined) filter.toTime = parseTimeSpec(opts.until);
        if (opts.text !== undefined) filter.text = opts.text;
        if (opts.limit !== undefined) {
          const limit = parseInt(opts.limit, 10);
          if (Number.isNaN(limit) || limit <= 0) {
            throw new Error(`Invalid --limit: "${opts.limit}" (expected a positive integer)`);
          }
          filter.limit = limit;
        }

        const entries = await new AuditLog(auditPath).query(filter);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }
        if (entries.length === 0) {
          logger.info(`No audit entries found in ${auditPath}`);
          return;
        }
        for (const entry of entries) {
          console.log(formatAuditEntryLine(entry));
        }
        logger.info(`${entries.length} entries (${auditPath})`);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  audit
    .command('history <entityName>')
    .description('Full chronological audit history for one entity')
    .option('--file <path>', 'Audit log file (overrides MEMORY_AUDIT_LOG_FILE and the sidecar default)')
    .option('--json', 'Emit entries as JSON')
    .action(async (entityName: string, opts: { file?: string; json?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      try {
        const auditPath = resolveAuditFilePath(options.storage, opts.file);
        const entries = await new AuditLog(auditPath).getHistory(entityName);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }
        if (entries.length === 0) {
          logger.info(`No audit history for "${entityName}" in ${auditPath}`);
          return;
        }
        for (const entry of entries) {
          console.log(formatAuditEntryLine(entry));
        }
        logger.info(`${entries.length} entries for "${entityName}" (${auditPath})`);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  audit
    .command('verify')
    .description('Verify the audit log hash chain (tamper evidence); exit code 1 when broken')
    .option('--file <path>', 'Audit log file (overrides MEMORY_AUDIT_LOG_FILE and the sidecar default)')
    .option('--json', 'Emit the full verification result as JSON')
    .action(async (opts: { file?: string; json?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      try {
        const auditPath = resolveAuditFilePath(options.storage, opts.file);
        const result = await new AuditLog(auditPath).verifyChain();

        if (opts.json) {
          console.log(JSON.stringify({ file: auditPath, ...result }, null, 2));
        } else {
          console.log(formatVerifyVerdict(result));
          logger.info(`(${auditPath})`);
        }
        if (!result.valid) process.exit(1);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  audit
    .command('stats')
    .description('Audit log summary: entry counts by operation, oldest/newest timestamps')
    .option('--file <path>', 'Audit log file (overrides MEMORY_AUDIT_LOG_FILE and the sidecar default)')
    .option('--json', 'Emit stats as JSON')
    .action(async (opts: { file?: string; json?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      try {
        const auditPath = resolveAuditFilePath(options.storage, opts.file);
        const stats = await new AuditLog(auditPath).stats();

        if (opts.json) {
          console.log(JSON.stringify({ file: auditPath, ...stats }, null, 2));
          return;
        }
        console.log(`Audit log: ${auditPath}`);
        console.log(`Total entries: ${stats.totalEntries}`);
        for (const op of AUDIT_OPERATIONS) {
          console.log(`  ${op.padEnd(7)}  ${stats.byOperation[op]}`);
        }
        console.log(`Oldest: ${stats.oldestEntry ?? '-'}`);
        console.log(`Newest: ${stats.newestEntry ?? '-'}`);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
