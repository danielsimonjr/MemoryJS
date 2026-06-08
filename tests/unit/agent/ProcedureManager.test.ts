/**
 * 3B.4 — ProcedureManager Tests
 *
 * Covers store roundtrip, step sequencer cursor + fallback, manager
 * add/get/getStep/getNextStep, matchProcedure ranking, and
 * refineProcedure EWMA update.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import {
  ProcedureManager,
  StepSequencer,
  decodeProcedure,
  PROCEDURE_ENTITY_TYPE,
} from '../../../src/agent/procedural/index.js';
import type { Procedure } from '../../../src/types/procedure.js';

describe('3B.4 Procedural Memory', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let manager: ProcedureManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `proc-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    manager = new ProcedureManager(entityManager);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // -------- Manager.addProcedure / getProcedure --------
  describe('addProcedure / getProcedure', () => {
    it('persists steps and metadata through entity storage', async () => {
      const proc = await manager.addProcedure({
        name: 'reset-password',
        description: 'Send a reset link, confirm, set new password.',
        steps: [
          { order: 1, action: 'send-email', parameters: { template: 'reset' } },
          { order: 2, action: 'verify-token', parameters: {} },
          { order: 3, action: 'persist-password', parameters: {} },
        ],
        triggers: ['password reset', 'forgot password'],
      });
      expect(proc.id).toMatch(/^proc-/);

      const loaded = await manager.getProcedure(proc.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.steps).toHaveLength(3);
      expect(loaded?.steps[0].action).toBe('send-email');
      expect(loaded?.triggers).toEqual(['password reset', 'forgot password']);
    });

    it('returns null for unknown id', async () => {
      expect(await manager.getProcedure('does-not-exist')).toBeNull();
    });

    it('throws when steps is omitted', async () => {
      await expect(manager.addProcedure({ name: 'bad' })).rejects.toThrow();
    });

    it('underlying entity has entityType = procedure', async () => {
      const proc = await manager.addProcedure({
        name: 'p',
        steps: [{ order: 1, action: 'a', parameters: {} }],
      });
      const entity = await entityManager.getEntity(proc.id);
      expect(entity?.entityType).toBe(PROCEDURE_ENTITY_TYPE);
    });
  });

  // -------- Stateless step access --------
  describe('getStep / getNextStep', () => {
    let procId: string;
    beforeEach(async () => {
      const p = await manager.addProcedure({
        name: 'test',
        steps: [
          { order: 1, action: 'a', parameters: {} },
          { order: 2, action: 'b', parameters: {} },
          { order: 3, action: 'c', parameters: {} },
        ],
      });
      procId = p.id;
    });

    it('getStep returns the step matching `order`', async () => {
      const step = await manager.getStep(procId, 2);
      expect(step?.action).toBe('b');
    });

    it('getStep returns null for unknown order', async () => {
      expect(await manager.getStep(procId, 99)).toBeNull();
    });

    it('getNextStep returns the next step in order', async () => {
      const step = await manager.getNextStep(procId, 1);
      expect(step?.action).toBe('b');
    });

    it('getNextStep returns null at the end', async () => {
      expect(await manager.getNextStep(procId, 3)).toBeNull();
    });
  });

  // -------- StepSequencer --------
  describe('StepSequencer', () => {
    function makeProc(steps: Procedure['steps']): Procedure {
      return {
        id: 'p', name: 'p', description: '', steps,
      };
    }

    it('cursor starts at step 1, advances to 2 then 3 then null', () => {
      const seq = new StepSequencer(makeProc([
        { order: 1, action: 'a', parameters: {} },
        { order: 2, action: 'b', parameters: {} },
        { order: 3, action: 'c', parameters: {} },
      ]));
      expect(seq.current()?.action).toBe('a');
      expect(seq.next()?.action).toBe('b');
      expect(seq.next()?.action).toBe('c');
      expect(seq.next()).toBeNull();
      expect(seq.isComplete()).toBe(true);
    });

    it('branchToFallback redirects current() to the fallback step', () => {
      const seq = new StepSequencer(makeProc([
        {
          order: 1, action: 'risky', parameters: {},
          fallback: { order: 99, action: 'safe', parameters: {} },
        },
        { order: 2, action: 'after', parameters: {} },
      ]));
      seq.branchToFallback();
      expect(seq.current()?.action).toBe('safe');
      // After running the fallback, next() restores main-track flow.
      expect(seq.next()?.action).toBe('after');
    });

    it('branchToFallback throws when current step has no fallback', () => {
      const seq = new StepSequencer(makeProc([
        { order: 1, action: 'a', parameters: {} },
      ]));
      expect(() => seq.branchToFallback()).toThrow();
    });

    it('reset() rewinds to step 1', () => {
      const seq = new StepSequencer(makeProc([
        { order: 1, action: 'a', parameters: {} },
        { order: 2, action: 'b', parameters: {} },
      ]));
      seq.next();
      seq.next();
      expect(seq.isComplete()).toBe(true);
      seq.reset();
      expect(seq.current()?.action).toBe('a');
      expect(seq.cursorIndex).toBe(0);
    });
  });

  // -------- matchProcedure --------
  describe('matchProcedure', () => {
    it('ranks procedures by token overlap with context', async () => {
      const a = await manager.addProcedure({
        name: 'reset-password',
        steps: [{ order: 1, action: 'a', parameters: {} }],
        triggers: ['password reset', 'forgot password'],
      });
      const b = await manager.addProcedure({
        name: 'create-account',
        steps: [{ order: 1, action: 'b', parameters: {} }],
        triggers: ['signup', 'register'],
      });
      const matches = await manager.matchProcedure(
        'user forgot password again',
        [a, b],
      );
      expect(matches[0].procedure.id).toBe(a.id);
      expect(matches[0].score).toBeGreaterThan(matches[1].score);
    });

    it('threshold filters out low-overlap matches', async () => {
      const a = await manager.addProcedure({
        name: 'reset-password',
        steps: [{ order: 1, action: 'a', parameters: {} }],
        triggers: ['password reset'],
      });
      // Context has zero overlap with the procedure.
      const matches = await manager.matchProcedure(
        'completely unrelated topic',
        [a],
        0.5,
      );
      expect(matches).toHaveLength(0);
    });

    it('returns empty when context has no tokens', async () => {
      const a = await manager.addProcedure({
        name: 'p',
        steps: [{ order: 1, action: 'a', parameters: {} }],
      });
      expect(await manager.matchProcedure('!!! @@@ ###', [a])).toEqual([]);
    });
  });

  // -------- refineProcedure --------
  describe('refineProcedure', () => {
    it('first success initializes successRate from 0.5 baseline (EWMA)', async () => {
      const proc = await manager.addProcedure({
        name: 'p',
        steps: [{ order: 1, action: 'a', parameters: {} }],
      });
      const refined = await manager.refineProcedure(proc.id, { succeeded: true });
      // baseline 0.5 + 0.2 * (1 - 0.5) = 0.6
      expect(refined.successRate).toBeCloseTo(0.6);
      expect(refined.executionCount).toBe(1);
    });

    it('successive successes converge toward 1.0', async () => {
      const proc = await manager.addProcedure({
        name: 'p',
        steps: [{ order: 1, action: 'a', parameters: {} }],
      });
      let refined = await manager.refineProcedure(proc.id, { succeeded: true });
      for (let i = 0; i < 20; i++) {
        refined = await manager.refineProcedure(proc.id, { succeeded: true });
      }
      expect(refined.successRate).toBeGreaterThan(0.95);
    });

    it('successive failures converge toward 0.0', async () => {
      const proc = await manager.addProcedure({
        name: 'p',
        steps: [{ order: 1, action: 'a', parameters: {} }],
      });
      let refined: Procedure = proc;
      for (let i = 0; i < 30; i++) {
        refined = await manager.refineProcedure(proc.id, { succeeded: false });
      }
      expect(refined.successRate).toBeLessThan(0.05);
    });

    it('throws when procedure does not exist', async () => {
      await expect(
        manager.refineProcedure('ghost', { succeeded: true }),
      ).rejects.toThrow();
    });
  });

  // -------- Decoder --------
  describe('decodeProcedure', () => {
    it('returns empty steps for entities with no JSON observation', () => {
      const decoded = decodeProcedure('p', ['just a description', 'another note']);
      expect(decoded.steps).toEqual([]);
      expect(decoded.description).toBe('just a description\nanother note');
    });

    it('tolerates malformed JSON in the steps line', () => {
      const decoded = decodeProcedure('p', [
        'desc',
        '[procedure-steps]:not-json',
      ]);
      expect(decoded.steps).toEqual([]);
    });
  });

  // -------- Persistence roundtrip --------
  describe('JSONL persistence roundtrip', () => {
    it('procedure survives storage reload', async () => {
      const created = await manager.addProcedure({
        name: 'roundtrip',
        steps: [
          { order: 1, action: 'first', parameters: { x: '1' } },
          { order: 2, action: 'second', parameters: {} },
        ],
        triggers: ['rt'],
      });
      // Force a fresh storage read.
      const fresh = new GraphStorage(storage.getFilePath());
      const freshEntities = new EntityManager(fresh);
      const freshManager = new ProcedureManager(freshEntities);
      const loaded = await freshManager.getProcedure(created.id);
      expect(loaded?.steps).toHaveLength(2);
      expect(loaded?.steps[0].parameters.x).toBe('1');
    });
  });
});
