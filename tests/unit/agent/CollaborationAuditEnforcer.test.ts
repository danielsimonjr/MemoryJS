/**
 * η.5.5.d — CollaborationAuditEnforcer
 *
 * Verifies strict-mode attribution rejection, lenient-mode pass-through,
 * audit-entry capture for all three operations, and OCC composition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import { CollaborationAuditEnforcer } from '../../../src/agent/collaboration/CollaborationAuditEnforcer.js';
import { AttributionRequiredError, VersionConflictError } from '../../../src/utils/errors.js';

describe('η.5.5.d CollaborationAuditEnforcer', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let auditLog: AuditLog;
  let enforcer: CollaborationAuditEnforcer;

  beforeEach(async () => {
    testDir = join(tmpdir(), `audit-enf-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    auditLog = new AuditLog(join(testDir, 'audit.jsonl'));
    enforcer = new CollaborationAuditEnforcer(entityManager, auditLog);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // -------- Strict mode (default) --------
  describe('strict mode (default)', () => {
    it('throws AttributionRequiredError when agentId is undefined', async () => {
      await expect(
        enforcer.createEntities(
          [{ name: 'A', entityType: 't', observations: [] }],
          undefined,
        ),
      ).rejects.toThrow(AttributionRequiredError);
    });

    it('throws AttributionRequiredError when agentId is empty string', async () => {
      await expect(
        enforcer.createEntities(
          [{ name: 'A', entityType: 't', observations: [] }],
          '',
        ),
      ).rejects.toThrow(AttributionRequiredError);
    });

    it('throws AttributionRequiredError when agentId is whitespace', async () => {
      await expect(
        enforcer.updateEntity('A', { importance: 5 }, '   '),
      ).rejects.toThrow(AttributionRequiredError);
    });

    it('throws on deleteEntities without agentId', async () => {
      await expect(enforcer.deleteEntities(['A'], undefined)).rejects.toThrow(
        AttributionRequiredError,
      );
    });
  });

  // -------- Lenient mode --------
  describe('lenient mode', () => {
    it('accepts calls without agentId and writes audit entry with no agentId field', async () => {
      const lenient = new CollaborationAuditEnforcer(entityManager, auditLog, {
        mode: 'lenient',
      });
      await lenient.createEntities(
        [{ name: 'A', entityType: 't', observations: [] }],
        undefined,
      );
      const entries = await auditLog.query({ entityName: 'A' });
      expect(entries).toHaveLength(1);
      expect(entries[0].agentId).toBeUndefined();
    });
  });

  // -------- Audit capture --------
  describe('audit-entry capture', () => {
    it('createEntities appends one create entry per entity with the supplied agentId', async () => {
      await enforcer.createEntities(
        [
          { name: 'X', entityType: 't', observations: ['fact1'] },
          { name: 'Y', entityType: 't', observations: ['fact2'] },
        ],
        'agent-alice',
      );
      const entries = await auditLog.query({ agentId: 'agent-alice' });
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.entityName).sort()).toEqual(['X', 'Y']);
      expect(entries.every(e => e.operation === 'create')).toBe(true);
      expect(entries.every(e => e.status === 'committed')).toBe(true);
      expect(entries.every(e => e.before === undefined)).toBe(true);
      expect(entries.every(e => e.after !== undefined)).toBe(true);
    });

    it('updateEntity captures before/after snapshots', async () => {
      await enforcer.createEntities(
        [{ name: 'Z', entityType: 't', observations: ['v1'] }],
        'agent-alice',
      );
      await enforcer.updateEntity('Z', { importance: 9 }, 'agent-bob');
      const updates = await auditLog.query({ operation: 'update' });
      expect(updates).toHaveLength(1);
      expect(updates[0].agentId).toBe('agent-bob');
      const before = updates[0].before as { importance?: number };
      const after = updates[0].after as { importance?: number };
      expect(before.importance).toBeUndefined();
      expect(after.importance).toBe(9);
    });

    it('deleteEntities captures pre-delete snapshot in `before`', async () => {
      await enforcer.createEntities(
        [{ name: 'Doomed', entityType: 't', observations: ['will be deleted'] }],
        'agent-alice',
      );
      await enforcer.deleteEntities(['Doomed'], 'agent-bob');
      const deletes = await auditLog.query({ operation: 'delete' });
      expect(deletes).toHaveLength(1);
      expect(deletes[0].agentId).toBe('agent-bob');
      const before = deletes[0].before as { name?: string; observations?: string[] };
      expect(before.name).toBe('Doomed');
      expect(before.observations).toEqual(['will be deleted']);
      expect(deletes[0].after).toBeUndefined();
    });

    it('deleteEntities skips audit entry for non-existent names (no-op match)', async () => {
      await enforcer.deleteEntities(['Ghost'], 'agent-alice');
      const deletes = await auditLog.query({ operation: 'delete' });
      expect(deletes).toHaveLength(0);
    });
  });

  // -------- OCC composition --------
  describe('composes with η.5.5.c OCC', () => {
    it('forwards expectedVersion and surfaces VersionConflictError', async () => {
      await enforcer.createEntities(
        [{ name: 'V', entityType: 't', observations: [] }],
        'agent-alice',
      );
      // First OCC update succeeds, version goes 1 → 2.
      await enforcer.updateEntity(
        'V',
        { importance: 1 },
        'agent-alice',
        { expectedVersion: 1 },
      );
      // Second caller still expects v1 — should conflict.
      await expect(
        enforcer.updateEntity(
          'V',
          { importance: 2 },
          'agent-bob',
          { expectedVersion: 1 },
        ),
      ).rejects.toThrow(VersionConflictError);
    });

    it('does not write a conflict-aborted audit entry', async () => {
      await enforcer.createEntities(
        [{ name: 'W', entityType: 't', observations: [] }],
        'agent-alice',
      );
      await enforcer.updateEntity('W', { importance: 1 }, 'agent-alice', { expectedVersion: 1 });
      try {
        await enforcer.updateEntity('W', { importance: 2 }, 'agent-bob', { expectedVersion: 1 });
      } catch { /* expected */ }
      // Only one update entry — bob's failed call should not appear.
      const updates = await auditLog.query({ operation: 'update', entityName: 'W' });
      expect(updates).toHaveLength(1);
      expect(updates[0].agentId).toBe('agent-alice');
    });
  });
});
