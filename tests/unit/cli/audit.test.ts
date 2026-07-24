/**
 * Audit CLI command tests (R4a queryable provenance).
 *
 * Exercises `memory audit log|history|verify|stats` against a real temp
 * AuditLog file (including a tampered chain for the verify exit code),
 * plus the pure helpers: audit-file path resolution (sidecar default, env
 * override, --file override) and --since/--until time-spec parsing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog, type AuditEntry } from '../../../src/features/AuditLog.js';
import {
  registerAuditCommands,
  resolveAuditFilePath,
  parseTimeSpec,
  formatAuditEntryLine,
  formatVerifyVerdict,
} from '../../../src/cli/commands/audit.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('audit CLI helpers', () => {
  describe('resolveAuditFilePath', () => {
    it('defaults to the <basename>-audit.jsonl sidecar next to the storage file', () => {
      const resolved = resolveAuditFilePath(join('/data', 'memory.jsonl'), undefined, {});
      expect(resolved).toBe(join('/data', 'memory-audit.jsonl'));
    });

    it('strips only the final extension when building the sidecar name', () => {
      const resolved = resolveAuditFilePath(join('/data', 'graph.v2.db'), undefined, {});
      expect(resolved).toBe(join('/data', 'graph.v2-audit.jsonl'));
    });

    it('MEMORY_AUDIT_LOG_FILE env var overrides the sidecar default', () => {
      const envPath = join('/elsewhere', 'trail.jsonl');
      const resolved = resolveAuditFilePath('/data/memory.jsonl', undefined, {
        MEMORY_AUDIT_LOG_FILE: envPath,
      });
      expect(resolved).toBe(envPath);
    });

    it('--file override wins over the env var', () => {
      const filePath = join(tmpdir(), 'explicit-audit.jsonl');
      const resolved = resolveAuditFilePath('/data/memory.jsonl', filePath, {
        MEMORY_AUDIT_LOG_FILE: '/elsewhere/trail.jsonl',
      });
      expect(resolved).toBe(filePath);
    });
  });

  describe('parseTimeSpec', () => {
    it('passes ISO 8601 timestamps through (normalized)', () => {
      expect(parseTimeSpec('2026-07-01T12:00:00.000Z')).toBe('2026-07-01T12:00:00.000Z');
    });

    it('parses relative specs against a fixed now', () => {
      const now = new Date('2026-07-24T12:00:00.000Z');
      expect(parseTimeSpec('2h', now)).toBe('2026-07-24T10:00:00.000Z');
      expect(parseTimeSpec('30m', now)).toBe('2026-07-24T11:30:00.000Z');
      expect(parseTimeSpec('7d', now)).toBe('2026-07-17T12:00:00.000Z');
      expect(parseTimeSpec('1w', now)).toBe('2026-07-17T12:00:00.000Z');
      expect(parseTimeSpec('45s', now)).toBe('2026-07-24T11:59:15.000Z');
    });

    it('throws on unparseable input', () => {
      expect(() => parseTimeSpec('not-a-time')).toThrow(/Invalid time spec/);
      expect(() => parseTimeSpec('5 fortnights')).toThrow(/Invalid time spec/);
    });
  });

  describe('formatters', () => {
    it('formatAuditEntryLine includes timestamp, op, status, agent, entity', () => {
      const entry: AuditEntry = {
        id: 'x',
        timestamp: '2026-07-24T00:00:00.000Z',
        operation: 'create',
        entityName: 'Alice',
        agentId: 'agent-1',
        status: 'committed',
      };
      const line = formatAuditEntryLine(entry);
      expect(line).toContain('2026-07-24T00:00:00.000Z');
      expect(line).toContain('create');
      expect(line).toContain('committed');
      expect(line).toContain('agent-1');
      expect(line).toContain('Alice');
    });

    it('formatAuditEntryLine renders "-" for a missing agentId', () => {
      const entry: AuditEntry = {
        id: 'x',
        timestamp: '2026-07-24T00:00:00.000Z',
        operation: 'delete',
        entityName: 'Bob',
        status: 'committed',
      };
      expect(formatAuditEntryLine(entry)).toContain('-');
    });

    it('formatVerifyVerdict distinguishes ok / broken / legacy-only / empty', () => {
      expect(formatVerifyVerdict({ valid: true, totalChecked: 3, legacyLines: 0, malformedLines: 0 }))
        .toMatch(/OK — 3 entries verified/);
      expect(formatVerifyVerdict({ valid: false, brokenAt: 1, totalChecked: 1, legacyLines: 0, malformedLines: 0 }))
        .toMatch(/BROKEN at line index 1/);
      expect(formatVerifyVerdict({ valid: true, totalChecked: 0, legacyLines: 4, malformedLines: 0 }))
        .toMatch(/legacy-only/);
      expect(formatVerifyVerdict({ valid: true, totalChecked: 0, legacyLines: 0, malformedLines: 0 }))
        .toMatch(/empty or missing/);
    });
  });
});

describe('audit CLI commands', () => {
  let testDir: string;
  let storagePath: string;
  let auditPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let seeded: AuditEntry[];

  beforeEach(async () => {
    testDir = join(tmpdir(), `audit-cli-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storagePath = join(testDir, 'graph.jsonl');
    auditPath = join(testDir, 'graph-audit.jsonl'); // sidecar convention
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    // Seed a real audit log with a mix of ops/entities/agents. Small sleeps
    // guarantee strictly increasing timestamps for the time-range tests.
    const log = new AuditLog(auditPath);
    seeded = [];
    seeded.push(await log.append({
      operation: 'create', entityName: 'Alice', agentId: 'agent-1',
      after: { name: 'Alice' }, status: 'committed',
    }));
    await sleep(5);
    seeded.push(await log.append({
      operation: 'update', entityName: 'Alice', agentId: 'agent-2',
      before: { name: 'Alice' }, after: { name: 'Alice', tags: ['vip'] }, status: 'committed',
    }));
    await sleep(5);
    seeded.push(await log.append({
      operation: 'delete', entityName: 'Bob', agentId: 'agent-1',
      before: { name: 'Bob' }, status: 'committed',
    }));
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('-s, --storage <path>', 'Storage path');
    registerAuditCommands(program);
    return program;
  }

  function run(...args: string[]): Promise<Command> {
    return makeProgram().parseAsync(['node', 'memory', '--storage', storagePath, ...args]);
  }

  function lastJson(): unknown {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    return JSON.parse(calls[calls.length - 1]);
  }

  describe('audit log', () => {
    it('resolves the sidecar audit file from the storage path (no --file needed)', async () => {
      await run('audit', 'log', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.entityName)).toEqual(['Alice', 'Alice', 'Bob']);
    });

    it('--entity filters to one entity', async () => {
      await run('audit', 'log', '--entity', 'Bob', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('delete');
    });

    it('--op filters by operation type', async () => {
      await run('audit', 'log', '--op', 'update', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].agentId).toBe('agent-2');
    });

    it('--agent filters by agent id', async () => {
      await run('audit', 'log', '--agent', 'agent-1', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(2);
    });

    it('--text free-text matches inside before/after payloads (case-insensitive)', async () => {
      await run('audit', 'log', '--text', 'VIP', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('update');
    });

    it('--since / --until bound the time range (ISO input)', async () => {
      await run('audit', 'log', '--since', seeded[1].timestamp, '--json');
      let entries = lastJson() as AuditEntry[];
      expect(entries.map((e) => e.id)).toEqual([seeded[1].id, seeded[2].id]);

      await run('audit', 'log', '--until', seeded[1].timestamp, '--json');
      entries = lastJson() as AuditEntry[];
      expect(entries.map((e) => e.id)).toEqual([seeded[0].id, seeded[1].id]);
    });

    it('--limit keeps the most recent N matches in chronological order', async () => {
      await run('audit', 'log', '--limit', '2', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries.map((e) => e.id)).toEqual([seeded[1].id, seeded[2].id]);
    });

    it('rejects a non-positive --limit with exit code 1', async () => {
      await expect(run('audit', 'log', '--limit', '0', '--json')).rejects.toThrow('exit:1');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('rejects an invalid --op via commander choices', async () => {
      await expect(run('audit', 'log', '--op', 'explode')).rejects.toThrow();
    });

    it('default (non-json) output emits one aligned line per entry', async () => {
      await run('audit', 'log');
      const lines = logSpy.mock.calls.map((c) => c.join(' '));
      expect(lines.some((l) => l.includes('create') && l.includes('Alice'))).toBe(true);
      expect(lines.some((l) => l.includes('delete') && l.includes('Bob'))).toBe(true);
    });

    it('--file override reads a different audit file than the sidecar', async () => {
      const otherPath = join(testDir, 'other-audit.jsonl');
      await new AuditLog(otherPath).append({
        operation: 'archive', entityName: 'Zed', status: 'committed',
      });
      await run('audit', 'log', '--file', otherPath, '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].entityName).toBe('Zed');
    });

    it('MEMORY_AUDIT_LOG_FILE env var overrides the sidecar default', async () => {
      const envPath = join(testDir, 'env-audit.jsonl');
      await new AuditLog(envPath).append({
        operation: 'merge', entityName: 'FromEnv', status: 'committed',
      });
      const previous = process.env.MEMORY_AUDIT_LOG_FILE;
      process.env.MEMORY_AUDIT_LOG_FILE = envPath;
      try {
        await run('audit', 'log', '--json');
        const entries = lastJson() as AuditEntry[];
        expect(entries).toHaveLength(1);
        expect(entries[0].entityName).toBe('FromEnv');
      } finally {
        if (previous === undefined) delete process.env.MEMORY_AUDIT_LOG_FILE;
        else process.env.MEMORY_AUDIT_LOG_FILE = previous;
      }
    });
  });

  describe('audit history', () => {
    it('returns the chronological history for one entity', async () => {
      await run('audit', 'history', 'Alice', '--json');
      const entries = lastJson() as AuditEntry[];
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.operation)).toEqual(['create', 'update']);
    });

    it('reports nothing for an unknown entity without failing', async () => {
      await expect(run('audit', 'history', 'Nobody', '--json')).resolves.toBeDefined();
      const entries = lastJson() as AuditEntry[];
      expect(entries).toEqual([]);
    });
  });

  describe('audit verify', () => {
    it('passes on an intact chain (exit 0)', async () => {
      await run('audit', 'verify');
      expect(exitSpy).not.toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toMatch(/OK — 3 entries verified/);
    });

    it('exits 1 on a tampered chain', async () => {
      // Tamper with the middle line: flip the entity name in place.
      const raw = await fs.readFile(auditPath, 'utf-8');
      const lines = raw.split('\n');
      lines[1] = lines[1].replace('"Alice"', '"Mallory"');
      await fs.writeFile(auditPath, lines.join('\n'));

      await expect(run('audit', 'verify')).rejects.toThrow('exit:1');
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toMatch(/BROKEN/);
    });

    it('--json reports the full verification result and still exits 1 when broken', async () => {
      // Tamper with a NON-last line: last-line tampering is documented as
      // undetectable (nothing chains onto it).
      const raw = await fs.readFile(auditPath, 'utf-8');
      const lines = raw.split('\n');
      lines[0] = lines[0].replace('"agent-1"', '"agent-9"');
      await fs.writeFile(auditPath, lines.join('\n'));

      await expect(run('audit', 'verify', '--json')).rejects.toThrow('exit:1');
      const result = lastJson() as { valid: boolean; file: string; totalChecked: number };
      expect(result.valid).toBe(false);
      expect(result.file).toBe(auditPath);
    });

    it('treats a missing audit file as nothing-to-verify (exit 0)', async () => {
      await run('audit', 'verify', '--file', join(testDir, 'nope-audit.jsonl'));
      expect(exitSpy).not.toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toMatch(/empty or missing/);
    });
  });

  describe('audit stats', () => {
    it('--json emits totals, per-op counts, and oldest/newest', async () => {
      await run('audit', 'stats', '--json');
      const stats = lastJson() as {
        file: string;
        totalEntries: number;
        byOperation: Record<string, number>;
        oldestEntry: string | null;
        newestEntry: string | null;
      };
      expect(stats.file).toBe(auditPath);
      expect(stats.totalEntries).toBe(3);
      expect(stats.byOperation).toMatchObject({ create: 1, update: 1, delete: 1, merge: 0, archive: 0 });
      expect(stats.oldestEntry).toBe(seeded[0].timestamp);
      expect(stats.newestEntry).toBe(seeded[2].timestamp);
    });

    it('default output is human-readable', async () => {
      await run('audit', 'stats');
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Total entries: 3');
      expect(output).toContain('create');
    });
  });
});

describe('AuditLog additive query filters (text + limit)', () => {
  let testDir: string;
  let log: AuditLog;

  beforeEach(async () => {
    testDir = join(tmpdir(), `audit-filter-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    log = new AuditLog(join(testDir, 'trail.jsonl'));
    await log.append({ operation: 'create', entityName: 'Server-A', after: { region: 'us-east' }, status: 'committed' });
    await log.append({ operation: 'create', entityName: 'Server-B', after: { region: 'eu-west' }, status: 'committed' });
    await log.append({ operation: 'update', entityName: 'Server-A', after: { region: 'us-west' }, status: 'committed' });
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('text matches serialized payload content case-insensitively', async () => {
    const hits = await log.query({ text: 'EU-WEST' });
    expect(hits).toHaveLength(1);
    expect(hits[0].entityName).toBe('Server-B');
  });

  it('text combines with other filters as AND', async () => {
    const hits = await log.query({ text: 'server-a', operation: 'update' });
    expect(hits).toHaveLength(1);
    expect(hits[0].operation).toBe('update');
  });

  it('limit keeps the most recent N matches, chronological order preserved', async () => {
    const hits = await log.query({ limit: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0].operation).toBe('create');
    expect(hits[0].entityName).toBe('Server-B');
    expect(hits[1].operation).toBe('update');
  });

  it('non-positive or non-finite limit is ignored (no cap)', async () => {
    expect(await log.query({ limit: 0 })).toHaveLength(3);
    expect(await log.query({ limit: -5 })).toHaveLength(3);
    expect(await log.query({ limit: Number.NaN })).toHaveLength(3);
  });
});
