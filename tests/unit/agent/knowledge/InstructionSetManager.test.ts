/** InstructionSetManager (RS-4) on both storage backends. */
import { describe, it, expect } from 'vitest';
import {
  InstructionSetManager,
  instructionItemsFor,
} from '../../../../src/agent/knowledge/InstructionSetManager.js';
import type { InstructionSetRecord } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';

withBothBackends('InstructionSetManager', (backend) => {
  describe('add / get / list', () => {
    it('persists sets, returns stable ids and filters list by role', async () => {
      const storage = backend.create();
      const sets = new InstructionSetManager(storage);
      const solverId = await sets.add({ role: 'solver', sections: [{ heading: 'Goal', text: 'Answer.', sources: [], uncertainty: 0.1 }] });
      const sharedId = await sets.add({ role: 'shared', id: 'instructions-shared-fixed' });
      expect(solverId).toMatch(/^instructions-solver-[0-9a-f]{8}$/);
      expect(await sets.add({ role: 'shared', id: 'instructions-shared-fixed' })).toBe(sharedId);
      expect(sets.get(solverId)?.sections[0]?.heading).toBe('Goal');
      expect((await sets.list()).map((r) => r.id).sort()).toEqual([solverId, sharedId].sort());
      expect((await sets.list('shared')).map((r) => r.id)).toEqual([sharedId]);
    });

    it('rejects an unknown role with RangeError', async () => {
      const sets = new InstructionSetManager(backend.create());
      await expect(sets.add({ role: 'bogus' as never })).rejects.toThrow(RangeError);
    });
  });

  describe('patchSection', () => {
    it('appends a new heading, replaces an existing one and bumps the version', async () => {
      const storage = backend.create();
      const sets = new InstructionSetManager(storage);
      const id = await sets.add({ role: 'learner' });
      expect(await sets.patchSection(id, 'Guardrails', 'v1', [{ ref: 'doc:a', kind: 'document' }], { expectedVersion: 1 })).toBe('updated');
      expect(await sets.patchSection(id, 'Guardrails', 'v2', [], { expectedVersion: 2 })).toBe('updated');
      const record = sets.get(id)!;
      expect(record.sections).toHaveLength(1);
      expect(record.sections[0]).toMatchObject({ heading: 'Guardrails', text: 'v2', uncertainty: 0.5 });
      expect(storage.getEntityByName(id)?.version).toBe(3);
    });

    it('returns version-conflict and writes nothing when expectedVersion is stale', async () => {
      const storage = backend.create();
      const sets = new InstructionSetManager(storage);
      const id = await sets.add({ role: 'solver' });
      await sets.patchSection(id, 'Goal', 'first', [], { expectedVersion: 1 });
      expect(await sets.patchSection(id, 'Goal', 'stale', [], { expectedVersion: 1 })).toBe('version-conflict');
      expect(sets.get(id)?.sections[0]?.text).toBe('first');
    });

    it('returns not-found for an unknown id and rejects a blank heading', async () => {
      const sets = new InstructionSetManager(backend.create());
      expect(await sets.patchSection('instructions-solver-missing', 'Goal', 'x', [])).toBe('not-found');
      await expect(sets.patchSection('instructions-solver-missing', '  ', 'x', [])).rejects.toThrow(TypeError);
    });
  });

  describe('render / history', () => {
    it('renders the role and shared sections in order and trims to the budget', async () => {
      const sets = new InstructionSetManager(backend.create());
      await sets.add({ role: 'solver', id: 'instructions-solver-a', sections: [{ heading: 'Goal', text: 'one two three', sources: [], uncertainty: 0.1 }] });
      await sets.add({ role: 'learner', id: 'instructions-learner-b', sections: [{ heading: 'Learn', text: 'should not appear', sources: [], uncertainty: 0.1 }] });
      await sets.add({ role: 'shared', id: 'instructions-shared-c', sections: [{ heading: 'Style', text: 'be brief', sources: [], uncertainty: 0.1 }] });
      const full = await sets.render('solver', { budgetTokens: 1000 });
      expect(full).toContain('### Goal');
      expect(full).toContain('### Style');
      expect(full).not.toContain('should not appear');
      expect(await sets.render('solver', { budgetTokens: 0 })).toBe('');
      const tight = await sets.render('solver', { budgetTokens: 5 });
      expect(tight.length).toBeLessThanOrEqual(full.length);
    });

    it('history is empty without a ledger and instructionItemsFor handles an empty list', async () => {
      const sets = new InstructionSetManager(backend.create());
      const id = await sets.add({ role: 'solver' });
      expect(sets.history(id)).toEqual([]);
      const records: InstructionSetRecord[] = (await sets.list('solver')).map((r) => ({ ...r }));
      expect(instructionItemsFor(records, 'solver')).toEqual([]);
    });

    it('delegates history to a ledger when one is configured', async () => {
      const calls: Array<[string, number | undefined]> = [];
      const ledger = {
        getHistory: (entityId: string, limit?: number) => {
          calls.push([entityId, limit]);
          return [];
        },
      };
      const sets = new InstructionSetManager(backend.create(), { ledger });
      sets.history('instructions-solver-x', 3);
      expect(calls).toEqual([['instructions-solver-x', 3]]);
    });
  });
});
