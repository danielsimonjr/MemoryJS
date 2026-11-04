/**
 * GovernanceManager delta-primitive tests (OPT-10)
 *
 * Single-entity governed CRUD (createEntity / updateEntity / deleteEntity)
 * must use the storage delta primitives (appendEntity / updateEntity /
 * deleteEntities) instead of rewriting the whole graph via saveGraph.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GovernanceManager } from '../../../src/features/GovernanceManager.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GovernanceManager delta CRUD (OPT-10)', () => {
  let storage: GraphStorage;
  let auditLog: AuditLog;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `governance-delta-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [], relations: [] });
    auditLog = new AuditLog(join(testDir, 'audit.jsonl'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('createEntity', () => {
    it('uses appendEntity and never calls saveGraph or getGraphForMutation', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const saveSpy = vi.spyOn(storage, 'saveGraph');
      const mutSpy = vi.spyOn(storage, 'getGraphForMutation');
      const appendSpy = vi.spyOn(storage, 'appendEntity');

      await gov.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: ['x'] });
      });

      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).not.toHaveBeenCalled();
      expect(mutSpy).not.toHaveBeenCalled();
      expect(storage.hasEntity('Alice')).toBe(true);
    });

    it('emits entity:created and not graph:saved', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const created: string[] = [];
      const graphSaved: number[] = [];
      storage.events.on('entity:created', e => created.push(e.entity.name));
      storage.events.on('graph:saved', () => graphSaved.push(1));

      await gov.withTransaction(async (tx) => {
        await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      });

      expect(created).toEqual(['Alice']);
      expect(graphSaved).toEqual([]);
    });

    it('throws DUPLICATE_ENTITY for an existing name without writing', async () => {
      await storage.appendEntity({
        name: 'Alice', entityType: 'person', observations: ['keep'],
      } as never);
      const gov = new GovernanceManager(storage, auditLog);
      const appendSpy = vi.spyOn(storage, 'appendEntity');

      await expect(
        gov.withTransaction(async (tx) => {
          await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });

      expect(appendSpy).not.toHaveBeenCalled();
      expect(storage.getEntityByName('Alice')?.observations).toEqual(['keep']);
    });

    it('sanitizes prototype-pollution keys on create', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const payload = JSON.parse(
        '{"name":"Eve","entityType":"person","observations":[],"__proto__":{"polluted":true}}',
      );
      await gov.withTransaction(async (tx) => {
        await tx.createEntity(payload);
      });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(storage.hasEntity('Eve')).toBe(true);
    });
  });

  describe('updateEntity', () => {
    beforeEach(async () => {
      await storage.saveGraph({
        entities: [{ name: 'Alice', entityType: 'person', observations: ['Old fact'] }],
        relations: [],
      });
    });

    it('uses storage.updateEntity and never saveGraph', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const saveSpy = vi.spyOn(storage, 'saveGraph');
      const updSpy = vi.spyOn(storage, 'updateEntity');

      await gov.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['New fact'] });
      });

      expect(updSpy).toHaveBeenCalledWith('Alice', { observations: ['New fact'] });
      expect(saveSpy).not.toHaveBeenCalled();
      expect(storage.getEntityByName('Alice')?.observations).toEqual(['New fact']);
    });

    it('audit before snapshot reflects pre-update state and after reflects post-update', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const order: string[] = [];
      const realUpdate = storage.updateEntity.bind(storage);
      vi.spyOn(storage, 'updateEntity').mockImplementation(async (n, u) => {
        order.push('update');
        return realUpdate(n, u);
      });
      const returned = await gov.withTransaction(async (tx) => {
        return tx.updateEntity('Alice', { observations: ['New fact'] });
      });

      const entries = await auditLog.loadAll();
      const upd = entries.find(e => e.operation === 'update')!;
      expect((upd.before as { observations: string[] }).observations).toEqual(['Old fact']);
      expect((upd.after as { observations: string[] }).observations).toEqual(['New fact']);
      expect(order).toEqual(['update']);
      expect(returned.observations).toEqual(['New fact']);
    });

    it('before snapshot is copied before storage mutates the live object', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      let snapshotAtCallTime: string[] | undefined;
      vi.spyOn(storage, 'updateEntity').mockImplementation(async (n, u) => {
        // Live object still holds old value at call time
        snapshotAtCallTime = [...(storage.getEntityByName(n)!.observations)];
        const live = storage.getEntityByName(n)!;
        live.observations = u.observations as string[];
        return true;
      });
      await gov.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['Mutated'] });
      });
      expect(snapshotAtCallTime).toEqual(['Old fact']);
      const upd = (await auditLog.loadAll()).find(e => e.operation === 'update')!;
      expect((upd.before as { observations: string[] }).observations).toEqual(['Old fact']);
    });

    it('throws ENTITY_NOT_FOUND for unknown entity and writes nothing', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const updSpy = vi.spyOn(storage, 'updateEntity');
      await expect(
        gov.withTransaction(async (tx) => {
          await tx.updateEntity('Ghost', { observations: [] });
        }),
      ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
      expect(updSpy).not.toHaveBeenCalled();
    });

    it('throws ENTITY_NOT_FOUND and records no audit entry when storage reports no update', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      vi.spyOn(storage, 'updateEntity').mockResolvedValue(false);
      await expect(
        gov.withTransaction(async (tx) => {
          await tx.updateEntity('Alice', { observations: ['x'] });
        }),
      ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
      expect(await auditLog.loadAll()).toHaveLength(0);
    });

    it('policy veto sees pre-update state and blocks the write', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      gov.setPolicy({
        canUpdate: (entity, updates) => {
          expect(entity.observations).toEqual(['Old fact']);
          return !(updates?.observations ?? []).includes('forbidden');
        },
      });
      const updSpy = vi.spyOn(storage, 'updateEntity');
      await expect(
        gov.withTransaction(async (tx) => {
          await tx.updateEntity('Alice', { observations: ['forbidden'] });
        }),
      ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
      expect(updSpy).not.toHaveBeenCalled();
      expect(storage.getEntityByName('Alice')?.observations).toEqual(['Old fact']);
    });

    it('sets lastModified on the persisted entity', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      await gov.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: ['New'] });
      });
      expect(storage.getEntityByName('Alice')?.lastModified).toBeDefined();
    });
  });

  describe('deleteEntity', () => {
    beforeEach(async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [] },
          { name: 'Bob', entityType: 'person', observations: [] },
          { name: 'Carol', entityType: 'person', observations: [] },
        ],
        relations: [
          { from: 'Alice', to: 'Bob', relationType: 'knows' },
          { from: 'Carol', to: 'Alice', relationType: 'knows' },
          { from: 'Bob', to: 'Carol', relationType: 'knows' },
        ],
      });
    });

    it('uses deleteEntities and never saveGraph', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      const saveSpy = vi.spyOn(storage, 'saveGraph');
      const delSpy = vi.spyOn(storage, 'deleteEntities');
      await gov.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
      });
      expect(delSpy).toHaveBeenCalledWith(['Alice']);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('removes relations touching the entity (parity with old filter)', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      await gov.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
      });
      expect(storage.hasEntity('Alice')).toBe(false);
      const graph = await storage.loadGraph();
      const remaining = graph.relations.map(r => `${r.from}->${r.to}`);
      expect(remaining).toEqual(['Bob->Carol']);
    });

    it('audit before snapshot is the deleted entity', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      await gov.withTransaction(async (tx) => {
        await tx.deleteEntity('Alice');
      });
      const del = (await auditLog.loadAll()).find(e => e.operation === 'delete')!;
      expect((del.before as { name: string }).name).toBe('Alice');
      expect(del.after).toBeUndefined();
    });

    it('throws ENTITY_NOT_FOUND for unknown entity', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      await expect(
        gov.withTransaction(async (tx) => {
          await tx.deleteEntity('Ghost');
        }),
      ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
    });

    it('policy veto blocks deletion without writing', async () => {
      const gov = new GovernanceManager(storage, auditLog);
      gov.setPolicy({ canDelete: () => false });
      const delSpy = vi.spyOn(storage, 'deleteEntities');
      await expect(
        gov.withTransaction(async (tx) => {
          await tx.deleteEntity('Alice');
        }),
      ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
      expect(delSpy).not.toHaveBeenCalled();
      expect(storage.hasEntity('Alice')).toBe(true);
    });
  });

  it('rollback still restores a governed update made through the delta path', async () => {
    await storage.saveGraph({
      entities: [{ name: 'Alice', entityType: 'person', observations: ['Old'] }],
      relations: [],
    });
    const gov = new GovernanceManager(storage, auditLog);
    const entryIds: string[] = [];
    await gov.withTransaction(async (tx) => {
      await tx.updateEntity('Alice', { observations: ['New'] });
      entryIds.push(tx.getAuditEntries()[0].id);
    });
    expect(storage.getEntityByName('Alice')?.observations).toEqual(['New']);
    await gov.rollback(entryIds[0]);
    expect(storage.getEntityByName('Alice')?.observations).toEqual(['Old']);
  });
});
