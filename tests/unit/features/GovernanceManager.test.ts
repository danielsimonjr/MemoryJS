/**
 * GovernanceManager Unit Tests
 *
 * Tests for Feature 8: Dynamic Memory Governance — GovernanceManager class.
 * Covers withTransaction (commit/rollback), policy enforcement, and audit entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GovernanceManager, GovernanceTransaction } from '../../../src/features/GovernanceManager.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { KnowledgeGraph } from '../../../src/types/index.js';

describe('GovernanceManager', () => {
  let storage: GraphStorage;
  let auditLog: AuditLog;
  let governance: GovernanceManager;
  let testDir: string;
  let testFilePath: string;
  let auditFilePath: string;

  const emptyGraph: KnowledgeGraph = { entities: [], relations: [] };

  beforeEach(async () => {
    testDir = join(tmpdir(), `governance-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    auditFilePath = join(testDir, 'test-audit.jsonl');

    storage = new GraphStorage(testFilePath);
    await storage.saveGraph(emptyGraph);

    auditLog = new AuditLog(auditFilePath);
    governance = new GovernanceManager(storage, auditLog);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==================== withTransaction — commit ====================

  describe('withTransaction - success path', () => {
    it('should commit a create and return the result', async () => {
      const created = await governance.withTransaction(async (tx) => {
        return tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      });

      expect(created.name).toBe('Alice');
      expect(created.entityType).toBe('person');
      expect(created.createdAt).toBeDefined();
    });

    it('should persist the entity to storage after commit', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      });

      const graph = await storage.loadGraph();
      expect(graph.entities.some(e => e.name === 'Alice')).toBe(true);
    });

    it('should create audit entries for each operation', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await tx.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
      });

      const entries = await auditLog.loadAll();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.status === 'committed')).toBe(true);
    });

    it('should record agentId in audit entries', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity(
          { name: 'Alice', entityType: 'person', observations: [] },
          { agentId: 'test-agent' }
        );
      });

      const entries = await auditLog.loadAll();
      expect(entries[0].agentId).toBe('test-agent');
    });

    it('should propagate default agentId to all operations', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await tx.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
      }, 'default-agent');

      const entries = await auditLog.loadAll();
      expect(entries.every(e => e.agentId === 'default-agent')).toBe(true);
    });

    it('should record before/after snapshots for update', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: ['Old fact'] }],
        relations: [],
      });

      await governance.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['New fact'] });
      });

      const entries = await auditLog.loadAll();
      const update = entries.find(e => e.operation === 'update');
      expect(update).toBeDefined();
      expect((update!.before as { observations: string[] }).observations).toEqual(['Old fact']);
      expect((update!.after as { observations: string[] }).observations).toEqual(['New fact']);
    });

    it('should record before snapshot for delete', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: [] }],
        relations: [],
      });

      await governance.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
      });

      const entries = await auditLog.loadAll();
      const del = entries.find(e => e.operation === 'delete');
      expect(del).toBeDefined();
      expect((del!.before as { name: string }).name).toBe('Alice');
      expect(del!.after).toBeUndefined();
    });
  });

  // ==================== withTransaction — rollback on error ====================

  describe('withTransaction - error path', () => {
    it('should re-throw errors from the callback', async () => {
      await expect(
        governance.withTransaction(async (_tx) => {
          throw new Error('Something went wrong');
        })
      ).rejects.toThrow('Something went wrong');
    });

    it('should mark audit entries as rolled_back when callback throws', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        throw new Error('Forced error');
      }).catch(() => {});

      const entries = await auditLog.loadAll();
      // There should be a committed entry and a rolled_back entry
      const committed = entries.filter(e => e.status === 'committed');
      const rolledBack = entries.filter(e => e.status === 'rolled_back');
      expect(committed).toHaveLength(1);
      expect(rolledBack).toHaveLength(1);
    });

    it('should still have entity in storage after create (physical rollback requires explicit rollback())', async () => {
      // withTransaction marks audit entries as rolled_back but doesn't
      // automatically undo physical storage changes — that requires rollback()
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        throw new Error('Forced error');
      }).catch(() => {});

      // Entity was created before the error
      const graph = await storage.loadGraph();
      expect(graph.entities.some(e => e.name === 'Alice')).toBe(true);
    });
  });

  // ==================== rollback ====================

  describe('rollback', () => {
    it('should delete entity when rolling back a create', async () => {
      let createEntryId: string;

      await governance.withTransaction(async (tx) => {
        const created = await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        const entries = tx.getAuditEntries();
        createEntryId = entries[0].id;
        return created;
      });

      // Verify entity exists
      let graph = await storage.loadGraph();
      expect(graph.entities.some(e => e.name === 'Alice')).toBe(true);

      // Rollback the create
      await governance.rollback(createEntryId!);

      // Entity should be gone
      graph = await storage.loadGraph();
      expect(graph.entities.some(e => e.name === 'Alice')).toBe(false);
    });

    it('should recreate entity when rolling back a delete', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: ['Original fact'] }],
        relations: [],
      });

      let deleteEntryId: string;
      await governance.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
        const entries = tx.getAuditEntries();
        deleteEntryId = entries[0].id;
      });

      // Verify entity is gone
      let graph = await storage.loadGraph();
      expect(graph.entities.some(e => e.name === 'Alice')).toBe(false);

      // Rollback the delete
      await governance.rollback(deleteEntryId!);

      // Entity should be restored
      graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice).toBeDefined();
      expect(alice!.observations).toContain('Original fact');
    });

    it('should restore entity to before state when rolling back an update', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: ['Old fact'] }],
        relations: [],
      });

      let updateEntryId: string;
      await governance.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['New fact'] });
        const entries = tx.getAuditEntries();
        updateEntryId = entries[0].id;
      });

      // Rollback
      await governance.rollback(updateEntryId!);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice).toBeDefined();
      expect(alice!.observations).toContain('Old fact');
    });

    it('should append a rolled_back audit entry after rollback', async () => {
      let entryId: string;
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        entryId = tx.getAuditEntries()[0].id;
      });

      await governance.rollback(entryId!);

      const entries = await auditLog.loadAll();
      const rolledBack = entries.filter(e => e.status === 'rolled_back');
      expect(rolledBack).toHaveLength(1);
      expect(rolledBack[0].operation).toBe('create');
      expect(rolledBack[0].entityName).toBe('Alice');
    });

    it('should throw when audit entry id is not found', async () => {
      await expect(governance.rollback('non-existent-id')).rejects.toThrow('non-existent-id');
    });
  });

  // ==================== Policy ====================

  describe('setPolicy / policy enforcement', () => {
    it('should allow all operations when no policy is set', async () => {
      await expect(
        governance.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        })
      ).resolves.not.toThrow();
    });

    it('should block create when canCreate returns false', async () => {
      governance.setPolicy({
        canCreate: (entity) => entity.entityType !== 'restricted',
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Secret', entityType: 'restricted', observations: [] });
        })
      ).rejects.toThrow('policy blocked');
    });

    it('should allow create when canCreate returns true', async () => {
      governance.setPolicy({
        canCreate: (entity) => entity.entityType !== 'restricted',
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        })
      ).resolves.not.toThrow();
    });

    it('should block delete when canDelete returns false', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Critical', entityType: 'person', observations: [], importance: 9 }],
        relations: [],
      });

      governance.setPolicy({
        canDelete: (entity) => (entity.importance ?? 0) < 8,
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.deleteEntity('Critical');
        })
      ).rejects.toThrow('policy blocked');
    });

    it('should allow delete when canDelete returns true', async () => {
      await storage.saveGraph({
        entities: [{ name: 'LowPriority', entityType: 'person', observations: [], importance: 2 }],
        relations: [],
      });

      governance.setPolicy({
        canDelete: (entity) => (entity.importance ?? 0) < 8,
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.deleteEntity('LowPriority');
        })
      ).resolves.not.toThrow();
    });

    it('should block update when canUpdate returns false', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Locked', entityType: 'system', observations: [] }],
        relations: [],
      });

      governance.setPolicy({
        canUpdate: (entity) => entity.entityType !== 'system',
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.updateEntity('Locked', { observations: ['New fact'] });
        })
      ).rejects.toThrow('policy blocked');
    });

    it('should use updated policy after setPolicy is called again', async () => {
      governance.setPolicy({
        canCreate: () => false,
      });

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        })
      ).rejects.toThrow('policy blocked');

      // Update policy to allow creates
      governance.setPolicy({});

      await expect(
        governance.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        })
      ).resolves.not.toThrow();
    });
  });

  // ==================== Audit entries for each operation ====================

  describe('audit entries created for each operation type', () => {
    it('should create audit entry with operation=create for createEntity', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      });

      const entries = await auditLog.query({ operation: 'create' });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityName).toBe('Alice');
    });

    it('should create audit entry with operation=update for updateEntity', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: [] }],
        relations: [],
      });

      await governance.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['Updated'] });
      });

      const entries = await auditLog.query({ operation: 'update' });
      expect(entries).toHaveLength(1);
    });

    it('should create audit entry with operation=delete for deleteEntity', async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: [] }],
        relations: [],
      });

      await governance.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
      });

      const entries = await auditLog.query({ operation: 'delete' });
      expect(entries).toHaveLength(1);
    });

    it('should create audit entry with operation=merge for recordMerge', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.recordMerge(
          'Alice',
          { name: 'Alice', entityType: 'person', observations: [] },
          { name: 'Alice', entityType: 'person', observations: ['merged fact'] }
        );
      });

      const entries = await auditLog.query({ operation: 'merge' });
      expect(entries).toHaveLength(1);
    });

    it('should create audit entry with operation=archive for recordArchive', async () => {
      await governance.withTransaction(async (tx) => {
        await tx.recordArchive(
          'Alice',
          { name: 'Alice', entityType: 'person', observations: [] }
        );
      });

      const entries = await auditLog.query({ operation: 'archive' });
      expect(entries).toHaveLength(1);
    });
  });
});
