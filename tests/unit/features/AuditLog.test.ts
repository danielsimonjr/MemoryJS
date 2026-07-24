/**
 * AuditLog Unit Tests
 *
 * Tests for Feature 8: Dynamic Memory Governance — AuditLog class.
 * Covers append, query, getHistory, JSONL persistence, and stats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLog, AUDIT_GENESIS_HASH } from '../../../src/features/AuditLog.js';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AuditEntry } from '../../../src/features/AuditLog.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex');

describe('AuditLog', () => {
  let auditLog: AuditLog;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `audit-log-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-audit.jsonl');
    auditLog = new AuditLog(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==================== Constructor ====================

  describe('Constructor', () => {
    it('should create audit log instance without creating file', async () => {
      expect(auditLog).toBeDefined();
      expect(auditLog).toBeInstanceOf(AuditLog);
      const exists = await fs.access(testFilePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  // ==================== append ====================

  describe('append', () => {
    it('should create an entry with auto-generated id', async () => {
      const entry = await auditLog.append({
        operation: 'create',
        entityName: 'Alice',
        status: 'committed',
      });

      expect(entry.id).toBeDefined();
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
    });

    it('should create an entry with auto-generated ISO 8601 timestamp', async () => {
      const before = new Date().toISOString();
      const entry = await auditLog.append({
        operation: 'create',
        entityName: 'Alice',
        status: 'committed',
      });
      const after = new Date().toISOString();

      expect(entry.timestamp).toBeDefined();
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);
    });

    it('should preserve all provided fields', async () => {
      const before = { name: 'Alice', entityType: 'person', observations: [] };
      const afterObj = { name: 'Alice', entityType: 'person', observations: ['New fact'] };

      const entry = await auditLog.append({
        operation: 'update',
        entityName: 'Alice',
        agentId: 'agent-1',
        before,
        after: afterObj,
        status: 'committed',
      });

      expect(entry.operation).toBe('update');
      expect(entry.entityName).toBe('Alice');
      expect(entry.agentId).toBe('agent-1');
      expect(entry.before).toEqual(before);
      expect(entry.after).toEqual(afterObj);
      expect(entry.status).toBe('committed');
    });

    it('should generate unique ids for each entry', async () => {
      const e1 = await auditLog.append({ operation: 'create', entityName: 'A', status: 'committed' });
      const e2 = await auditLog.append({ operation: 'create', entityName: 'B', status: 'committed' });
      expect(e1.id).not.toBe(e2.id);
    });

    it('should create the JSONL file on first append', async () => {
      const existsBefore = await fs.access(testFilePath).then(() => true).catch(() => false);
      expect(existsBefore).toBe(false);

      await auditLog.append({ operation: 'create', entityName: 'Alice', status: 'committed' });

      const existsAfter = await fs.access(testFilePath).then(() => true).catch(() => false);
      expect(existsAfter).toBe(true);
    });
  });

  // ==================== query ====================

  describe('query', () => {
    beforeEach(async () => {
      // Seed some entries
      await auditLog.append({ operation: 'create', entityName: 'Alice', agentId: 'agent-1', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'Alice', agentId: 'agent-1', status: 'committed' });
      await auditLog.append({ operation: 'delete', entityName: 'Bob', agentId: 'agent-2', status: 'committed' });
      await auditLog.append({ operation: 'merge', entityName: 'Carol', agentId: 'agent-1', status: 'committed' });
      await auditLog.append({ operation: 'archive', entityName: 'Dave', agentId: 'agent-2', status: 'rolled_back' });
    });

    it('should return all entries when filter is empty', async () => {
      const results = await auditLog.query({});
      expect(results).toHaveLength(5);
    });

    it('should filter by operation type', async () => {
      const creates = await auditLog.query({ operation: 'create' });
      expect(creates).toHaveLength(1);
      expect(creates[0].entityName).toBe('Alice');

      const deletes = await auditLog.query({ operation: 'delete' });
      expect(deletes).toHaveLength(1);
      expect(deletes[0].entityName).toBe('Bob');
    });

    it('should filter by entity name', async () => {
      const aliceEntries = await auditLog.query({ entityName: 'Alice' });
      expect(aliceEntries).toHaveLength(2);
      expect(aliceEntries.every(e => e.entityName === 'Alice')).toBe(true);
    });

    it('should filter by agent id', async () => {
      const agent1Entries = await auditLog.query({ agentId: 'agent-1' });
      expect(agent1Entries).toHaveLength(3);

      const agent2Entries = await auditLog.query({ agentId: 'agent-2' });
      expect(agent2Entries).toHaveLength(2);
    });

    it('should filter by time range (fromTime)', async () => {
      const allEntries = await auditLog.loadAll();
      const midpoint = allEntries[2].timestamp;

      const results = await auditLog.query({ fromTime: midpoint });
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by time range (toTime)', async () => {
      const allEntries = await auditLog.loadAll();
      const midpoint = allEntries[1].timestamp;

      const results = await auditLog.query({ toTime: midpoint });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should combine multiple filters with AND logic', async () => {
      const results = await auditLog.query({ entityName: 'Alice', agentId: 'agent-1' });
      expect(results).toHaveLength(2);
      expect(results.every(e => e.entityName === 'Alice' && e.agentId === 'agent-1')).toBe(true);
    });

    it('should return empty array when no entries match filter', async () => {
      const results = await auditLog.query({ entityName: 'NonExistent' });
      expect(results).toHaveLength(0);
    });

    it('should return empty array when file does not exist', async () => {
      const fresh = new AuditLog(join(testDir, 'nonexistent.jsonl'));
      const results = await fresh.query({});
      expect(results).toHaveLength(0);
    });
  });

  // ==================== getHistory ====================

  describe('getHistory', () => {
    it('should return all entries for a given entity in chronological order', async () => {
      await auditLog.append({ operation: 'create', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'Bob', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'delete', entityName: 'Alice', status: 'committed' });

      const history = await auditLog.getHistory('Alice');
      expect(history).toHaveLength(3);
      expect(history.map(e => e.operation)).toEqual(['create', 'update', 'delete']);
    });

    it('should return empty array for entity with no history', async () => {
      const history = await auditLog.getHistory('NoSuchEntity');
      expect(history).toHaveLength(0);
    });

    it('should not include entries from other entities', async () => {
      await auditLog.append({ operation: 'create', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'create', entityName: 'Bob', status: 'committed' });

      const history = await auditLog.getHistory('Alice');
      expect(history).toHaveLength(1);
      expect(history[0].entityName).toBe('Alice');
    });
  });

  // ==================== JSONL persistence ====================

  describe('JSONL persistence', () => {
    it('should persist entries to JSONL file', async () => {
      await auditLog.append({ operation: 'create', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'delete', entityName: 'Bob', status: 'committed' });

      const content = await fs.readFile(testFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      // Each line must be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should reload entries correctly after restart', async () => {
      const entry1 = await auditLog.append({
        operation: 'create',
        entityName: 'Alice',
        agentId: 'test-agent',
        after: { name: 'Alice', entityType: 'person', observations: [] },
        status: 'committed',
      });

      // Simulate restart — create new instance pointing at same file
      const reloaded = new AuditLog(testFilePath);
      const entries = await reloaded.loadAll();

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(entry1.id);
      expect(entries[0].timestamp).toBe(entry1.timestamp);
      expect(entries[0].operation).toBe('create');
      expect(entries[0].entityName).toBe('Alice');
      expect(entries[0].agentId).toBe('test-agent');
      expect(entries[0].status).toBe('committed');
    });

    it('should append to existing file without overwriting', async () => {
      await auditLog.append({ operation: 'create', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'Alice', status: 'committed' });
      await auditLog.append({ operation: 'delete', entityName: 'Alice', status: 'committed' });

      const entries = await auditLog.loadAll();
      expect(entries).toHaveLength(3);
    });
  });

  // ==================== stats ====================

  describe('stats', () => {
    it('should return zeroed stats for empty log', async () => {
      const s = await auditLog.stats();
      expect(s.totalEntries).toBe(0);
      expect(s.byOperation.create).toBe(0);
      expect(s.byOperation.update).toBe(0);
      expect(s.byOperation.delete).toBe(0);
      expect(s.byOperation.merge).toBe(0);
      expect(s.byOperation.archive).toBe(0);
      expect(s.oldestEntry).toBeNull();
      expect(s.newestEntry).toBeNull();
    });

    it('should count entries by operation type', async () => {
      await auditLog.append({ operation: 'create', entityName: 'A', status: 'committed' });
      await auditLog.append({ operation: 'create', entityName: 'B', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'A', status: 'committed' });
      await auditLog.append({ operation: 'delete', entityName: 'B', status: 'committed' });
      await auditLog.append({ operation: 'merge', entityName: 'C', status: 'committed' });
      await auditLog.append({ operation: 'archive', entityName: 'D', status: 'committed' });

      const s = await auditLog.stats();
      expect(s.totalEntries).toBe(6);
      expect(s.byOperation.create).toBe(2);
      expect(s.byOperation.update).toBe(1);
      expect(s.byOperation.delete).toBe(1);
      expect(s.byOperation.merge).toBe(1);
      expect(s.byOperation.archive).toBe(1);
    });

    it('should track oldest and newest entry timestamps', async () => {
      const e1 = await auditLog.append({ operation: 'create', entityName: 'A', status: 'committed' });
      await auditLog.append({ operation: 'update', entityName: 'A', status: 'committed' });
      const e3 = await auditLog.append({ operation: 'delete', entityName: 'A', status: 'committed' });

      const s = await auditLog.stats();
      expect(s.oldestEntry).toBe(e1.timestamp);
      expect(s.newestEntry).toBe(e3.timestamp);
    });

    it('should have correct total for mixed operations', async () => {
      await auditLog.append({ operation: 'create', entityName: 'X', status: 'committed' });
      await auditLog.append({ operation: 'create', entityName: 'Y', status: 'rolled_back' });
      await auditLog.append({ operation: 'archive', entityName: 'Z', status: 'committed' });

      const s = await auditLog.stats();
      expect(s.totalEntries).toBe(3);
    });
  });

  // ==================== Sec5: hash chaining / tamper evidence ====================

  describe('hash chaining (Sec5)', () => {
    async function appendN(n: number): Promise<AuditEntry[]> {
      const out: AuditEntry[] = [];
      for (let i = 0; i < n; i++) {
        out.push(await auditLog.append({ operation: 'create', entityName: `E${i}`, status: 'committed' }));
      }
      return out;
    }

    it('stamps monotonic seq and genesis prevHash on a fresh file', async () => {
      const entries = await appendN(3);
      expect(entries.map(e => e.seq)).toEqual([0, 1, 2]);
      expect(entries[0].prevHash).toBe(AUDIT_GENESIS_HASH);

      const lines = (await fs.readFile(testFilePath, 'utf-8')).trim().split('\n');
      expect(entries[1].prevHash).toBe(sha256(lines[0]));
      expect(entries[2].prevHash).toBe(sha256(lines[1]));
    });

    it('verifyChain reports valid after N appends', async () => {
      await appendN(5);
      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(5);
      expect(result.legacyLines).toBe(0);
      expect(result.malformedLines).toBe(0);
      expect(result.brokenAt).toBeUndefined();
    });

    it('verifyChain on a nonexistent file is valid with nothing checked', async () => {
      const result = await new AuditLog(join(testDir, 'no-such.jsonl')).verifyChain();
      expect(result).toEqual({ valid: true, totalChecked: 0, legacyLines: 0, malformedLines: 0 });
    });

    it('detects tampering of a middle line at the right index', async () => {
      await appendN(5);
      const lines = (await fs.readFile(testFilePath, 'utf-8')).trim().split('\n');
      // Tamper line 2's content while keeping it valid JSON with its own
      // seq/prevHash intact — only the successor's prevHash can catch this.
      const doctored = JSON.parse(lines[2]) as AuditEntry;
      doctored.entityName = 'TAMPERED';
      lines[2] = JSON.stringify(doctored);
      await fs.writeFile(testFilePath, lines.join('\n') + '\n');

      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(3); // detected via line 3's prevHash mismatch
    });

    it('detects a removed middle line (seq gap vs entry count)', async () => {
      await appendN(5);
      const lines = (await fs.readFile(testFilePath, 'utf-8')).trim().split('\n');
      lines.splice(2, 1); // truncate the middle of the chain
      await fs.writeFile(testFilePath, lines.join('\n') + '\n');

      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2); // seq jumps from 1 to 3 at index 2
    });

    it('detects a reordered chain', async () => {
      await appendN(4);
      const lines = (await fs.readFile(testFilePath, 'utf-8')).trim().split('\n');
      [lines[1], lines[2]] = [lines[2], lines[1]];
      await fs.writeFile(testFilePath, lines.join('\n') + '\n');

      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('reports malformed lines instead of silently skipping (verifyChain)', async () => {
      await appendN(3);
      await fs.appendFile(testFilePath, 'this is not json\n');

      const fresh = new AuditLog(testFilePath);
      const result = await fresh.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.malformedLines).toBe(1);
      expect(result.firstMalformedIndex).toBe(3);
      expect(result.brokenAt).toBe(3);

      // loadAll keeps skipping for compat but exposes the count.
      const entries = await fresh.loadAll();
      expect(entries).toHaveLength(3);
      expect(fresh.malformedLineCount).toBe(1);
    });

    it('loads a legacy file (no seq/prevHash) and reports it as unverifiable-but-not-broken', async () => {
      const legacy = [
        { id: 'l1', timestamp: '2024-01-01T00:00:00Z', operation: 'create', entityName: 'Old1', status: 'committed' },
        { id: 'l2', timestamp: '2024-01-02T00:00:00Z', operation: 'update', entityName: 'Old1', status: 'committed' },
      ];
      await fs.writeFile(testFilePath, legacy.map(e => JSON.stringify(e)).join('\n') + '\n');

      const log = new AuditLog(testFilePath);
      const entries = await log.loadAll();
      expect(entries).toHaveLength(2);
      expect(entries[0].seq).toBeUndefined();

      // "legacy-style" result: valid (nothing provably broken) but
      // totalChecked === 0 with legacyLines > 0 flags "nothing verifiable".
      const result = await log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(0);
      expect(result.legacyLines).toBe(2);
    });

    it('anchors new appends to the tail of a legacy file and verifies from there', async () => {
      const legacy = [
        { id: 'l1', timestamp: '2024-01-01T00:00:00Z', operation: 'create', entityName: 'Old1', status: 'committed' },
        { id: 'l2', timestamp: '2024-01-02T00:00:00Z', operation: 'update', entityName: 'Old1', status: 'committed' },
      ];
      await fs.writeFile(testFilePath, legacy.map(e => JSON.stringify(e)).join('\n') + '\n');

      const log = new AuditLog(testFilePath);
      const appended = await log.append({ operation: 'delete', entityName: 'Old1', status: 'committed' });
      expect(appended.seq).toBe(2); // legacy lines occupy 0..1
      expect(appended.prevHash).toBe(sha256(JSON.stringify(legacy[1])));

      const result = await log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(1);
      expect(result.legacyLines).toBe(2);
    });

    it('creates the audit file with mode 0600', async () => {
      if (process.platform === 'win32') return; // POSIX modes don't apply
      await auditLog.append({ operation: 'create', entityName: 'A', status: 'committed' });
      const stat = await fs.stat(testFilePath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('keeps the chain intact across instance restarts', async () => {
      await appendN(2);
      const resumed = new AuditLog(testFilePath);
      await resumed.append({ operation: 'archive', entityName: 'E9', status: 'committed' });
      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(3);
    });

    it('serializes concurrent appends without breaking the chain', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          auditLog.append({ operation: 'create', entityName: `C${i}`, status: 'committed' })
        )
      );
      const result = await new AuditLog(testFilePath).verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(10);
    });
  });
});
