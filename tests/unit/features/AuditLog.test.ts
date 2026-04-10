/**
 * AuditLog Unit Tests
 *
 * Tests for Feature 8: Dynamic Memory Governance — AuditLog class.
 * Covers append, query, getHistory, JSONL persistence, and stats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLog } from '../../../src/features/AuditLog.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AuditEntry } from '../../../src/features/AuditLog.js';

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
});
