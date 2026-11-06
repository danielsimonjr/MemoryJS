/**
 * SkillManager (RS-2): add, dedup, get, list, OCC update, retire, match,
 * recordOutcome and loadForContext. Runs on JSONL and SQLite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager, type AddSkillInput } from '../../../../src/agent/skills/SkillManager.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';

const REVIEW: AddSkillInput = {
  name: 'Security review',
  description: 'Use when reviewing a pull request for security issues',
  kind: 'procedure',
  scope: { domains: ['code-review'], tasks: ['review pull request'] },
  uncertainty: 0.2,
  body: '## Steps\n1. Read the diff.\n2. Check input handling.',
};

function input(overrides: Partial<AddSkillInput>): AddSkillInput {
  return { ...REVIEW, ...overrides };
}

function entityVersion(storage: IGraphStorage, id: string): number | undefined {
  return storage.getEntityByName(id)?.version;
}

withBothBackends('SkillManager', (backend) => {
  let storage: IGraphStorage;
  let mgr: SkillManager;

  beforeEach(() => {
    storage = backend.create();
    mgr = new SkillManager(storage);
  });

  describe('add and get', () => {
    it('returns an id with the skill- prefix and stores a retrievable record', async () => {
      const id = await mgr.add(REVIEW);
      expect(id.startsWith('skill-security-review-')).toBe(true);
      const record = mgr.get(id);
      expect(record?.name).toBe('Security review');
      expect(record?.stats).toEqual({ applied: 0, helped: 0, hurt: 0 });
      expect(record?.id).toBe(id);
    });

    it('returns the existing id for the same name and body without writing a second entity', async () => {
      const first = await mgr.add(REVIEW);
      const second = await mgr.add({ ...REVIEW, description: 'different description, same name and body' });
      expect(second).toBe(first);
      expect(await mgr.list()).toHaveLength(1);
    });

    it('treats a different body under the same name as a new skill', async () => {
      const first = await mgr.add(REVIEW);
      const second = await mgr.add({ ...REVIEW, body: 'other body' });
      expect(second).not.toBe(first);
      expect(await mgr.list()).toHaveLength(2);
    });

    it('rejects an empty scope.domains list', async () => {
      await expect(mgr.add(input({ scope: { domains: [] } }))).rejects.toThrow('Invalid skill');
    });

    it('rejects uncertainty outside [0, 1]', async () => {
      await expect(mgr.add(input({ uncertainty: 1.5 }))).rejects.toThrow('Invalid skill');
      await expect(mgr.add(input({ uncertainty: Number.NaN }))).rejects.toThrow('Invalid skill');
    });

    it('rejects an empty name and a name longer than 80 characters', async () => {
      await expect(mgr.add(input({ name: '   ' }))).rejects.toThrow('Invalid skill');
      await expect(mgr.add(input({ name: 'x'.repeat(81), body: 'long' }))).rejects.toThrow('Invalid skill');
    });

    it('get returns undefined for an unknown id', () => {
      expect(mgr.get('skill-missing-00000000')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('filters by kind and by domain (case-insensitive) and excludes retired skills by default', async () => {
      const a = await mgr.add(input({ name: 'A', body: 'a body', kind: 'procedure' }));
      await mgr.add(input({ name: 'B', body: 'b body', kind: 'convention', scope: { domains: ['Billing'] } }));
      const c = await mgr.add(input({ name: 'C', body: 'c body', kind: 'procedure' }));
      await mgr.retire(c, 'obsolete');

      expect((await mgr.list({ kind: 'procedure' })).map((s) => s.id)).toEqual([a]);
      expect((await mgr.list({ domain: 'billing' })).map((s) => s.name)).toEqual(['B']);
      expect(await mgr.list({ includeRetired: true })).toHaveLength(3);
      expect(await mgr.list()).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('applies a patch when expectedVersion matches and advances the entity version', async () => {
      const id = await mgr.add(REVIEW);
      const result = await mgr.update(id, { description: 'Use for auth changes', uncertainty: 0.4 }, { expectedVersion: 1 });
      expect(result).toBe('updated');
      expect(mgr.get(id)?.description).toBe('Use for auth changes');
      expect(mgr.get(id)?.uncertainty).toBe(0.4);
      expect(entityVersion(storage, id)).toBe(2);
    });

    it('returns version-conflict and writes nothing when expectedVersion is stale', async () => {
      const id = await mgr.add(REVIEW);
      await mgr.update(id, { uncertainty: 0.3 }, { expectedVersion: 1 });
      const result = await mgr.update(id, { uncertainty: 0.9 }, { expectedVersion: 1 });
      expect(result).toBe('version-conflict');
      expect(mgr.get(id)?.uncertainty).toBe(0.3);
      expect(entityVersion(storage, id)).toBe(2);
    });

    it('lets exactly one of two concurrent updates with the same expectedVersion win', async () => {
      const id = await mgr.add(REVIEW);
      const results = await Promise.all([
        mgr.update(id, { uncertainty: 0.1 }, { expectedVersion: 1 }),
        mgr.update(id, { uncertainty: 0.9 }, { expectedVersion: 1 }),
      ]);
      expect([...results].sort()).toEqual(['updated', 'version-conflict']);
      expect(entityVersion(storage, id)).toBe(2);
    });

    it('returns not-found for an unknown id', async () => {
      expect(await mgr.update('skill-nope-00000000', { uncertainty: 0.1 }, { expectedVersion: 1 })).toBe('not-found');
    });

    it('rejects a patch that breaks the RS-2 rules and leaves the record unchanged', async () => {
      const id = await mgr.add(REVIEW);
      await expect(mgr.update(id, { scope: { domains: [] } }, { expectedVersion: 1 })).rejects.toThrow('Invalid skill');
      expect(mgr.get(id)?.scope.domains).toEqual(['code-review']);
    });
  });

  describe('retire', () => {
    it('marks the skill retired, keeps it readable, and reports repeat calls', async () => {
      const id = await mgr.add(REVIEW);
      expect(await mgr.retire(id, 'superseded')).toBe('retired');
      const record = mgr.get(id);
      expect(record?.retired?.reason).toBe('superseded');
      expect(record?.retired?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await mgr.retire(id, 'again')).toBe('already-retired');
      expect(await mgr.retire('skill-nope-00000000', 'x')).toBe('not-found');
    });

    it('excludes a retired skill from match and loadForContext', async () => {
      const id = await mgr.add(REVIEW);
      await mgr.retire(id, 'gone');
      expect(await mgr.match('review pull request security')).toEqual([]);
      expect(mgr.loadForContext([id], { budgetTokens: 1000, multiplier: 1 })).toBe('');
    });
  });

  describe('match', () => {
    it('returns [] for a hint that has no usable tokens', async () => {
      await mgr.add(REVIEW);
      expect(await mgr.match('')).toEqual([]);
      expect(await mgr.match('the a an of')).toEqual([]);
    });

    it('ranks by lexical overlap and reports the shared tokens', async () => {
      const strong = await mgr.add(REVIEW);
      await mgr.add(input({ name: 'Billing', body: 'billing body', description: 'Use for invoice reconciliation', scope: { domains: ['billing'] } }));
      const matches = await mgr.match('review pull request security');
      expect(matches[0]?.skill.id).toBe(strong);
      expect(matches[0]?.matched).toEqual(['pull', 'request', 'review', 'security']);
      expect(matches[0]!.score).toBeGreaterThan(0.1);
    });

    it('respects limit and minScore', async () => {
      await mgr.add(REVIEW);
      await mgr.add(input({ name: 'Second review', body: 'second', description: 'review pull request checklist' }));
      expect(await mgr.match('review pull request', { limit: 1 })).toHaveLength(1);
      expect(await mgr.match('review pull request', { minScore: 0.99 })).toEqual([]);
    });

    it('breaks score ties by helped minus hurt, then by id', async () => {
      const a = await mgr.add(input({ name: 'Alpha', body: 'alpha body' }));
      const b = await mgr.add(input({ name: 'Beta', body: 'beta body' }));
      const c = await mgr.add(input({ name: 'Gamma', body: 'gamma body' }));
      await mgr.recordOutcome(b, 'helped');
      await mgr.recordOutcome(c, 'helped');
      await mgr.recordOutcome(c, 'hurt');
      const order = (await mgr.match('review pull request', { minScore: 0 })).map((m) => m.skill.id);
      // b has net +1; a and c both have net 0, so they fall back to id order.
      expect(order).toEqual([b, ...[a, c].sort()]);
    });

    it('blends lexical and semantic scores 50/50 once a provider is set', async () => {
      const id = await mgr.add(REVIEW);
      const provider = { calculateSimilarity: async () => 1 };
      mgr.setSemanticSearch(provider);
      const unrelated = await mgr.match('billing invoice reconciliation', { minScore: 0.4 });
      expect(unrelated.map((m) => m.skill.id)).toEqual([id]);
      expect(unrelated[0]!.matched).toEqual([]);
      expect(unrelated[0]!.score).toBeCloseTo(0.5, 10);
      mgr.setSemanticSearch(undefined);
      expect(await mgr.match('billing invoice reconciliation')).toEqual([]);
    });
  });

  describe('recordOutcome', () => {
    it('increments the requested counter and advances the version', async () => {
      const id = await mgr.add(REVIEW);
      expect(await mgr.recordOutcome(id, 'applied')).toBe('updated');
      expect(await mgr.recordOutcome(id, 'helped')).toBe('updated');
      expect(await mgr.recordOutcome(id, 'helped')).toBe('updated');
      expect(await mgr.recordOutcome(id, 'hurt')).toBe('updated');
      expect(mgr.get(id)?.stats).toEqual({ applied: 1, helped: 2, hurt: 1 });
      expect(entityVersion(storage, id)).toBe(5);
    });

    it('returns not-found for an unknown id', async () => {
      expect(await mgr.recordOutcome('skill-nope-00000000', 'applied')).toBe('not-found');
    });
  });

  describe('loadForContext', () => {
    it('renders a heading with uncertainty and sources, then a fenced body, in the given order', async () => {
      const id = await mgr.add(input({ sources: [{ ref: 'doc:security-guide', kind: 'document' }] }));
      const text = mgr.loadForContext([id], { budgetTokens: 1000, multiplier: 1 });
      expect(text).toContain('### Security review (uncertainty 0.2, sources: doc:security-guide)');
      expect(text).toContain('```markdown\n## Steps\n1. Read the diff.\n2. Check input handling.\n```');
    });

    it('uses a longer fence when the body contains backtick runs', async () => {
      const id = await mgr.add(input({ body: 'Run ```bash``` then stop.' }));
      const text = mgr.loadForContext([id], { budgetTokens: 1000, multiplier: 1 });
      expect(text).toContain('````markdown\nRun ```bash``` then stop.\n````');
    });

    it('returns empty text for a zero budget and skips unknown and duplicate ids', async () => {
      const id = await mgr.add(REVIEW);
      expect(mgr.loadForContext([id], { budgetTokens: 0, multiplier: 1 })).toBe('');
      const once = mgr.loadForContext([id], { budgetTokens: 1000, multiplier: 1 });
      expect(mgr.loadForContext([id, 'skill-nope-00000000', id], { budgetTokens: 1000, multiplier: 1 })).toBe(once);
    });

    it('stops adding skills once the budget is spent and cuts the next one at a word boundary', async () => {
      const first = await mgr.add(input({ name: 'First', body: 'alpha beta gamma' }));
      const longBody = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
      const second = await mgr.add(input({ name: 'Second', body: longBody }));
      const third = await mgr.add(input({ name: 'Third', body: 'third body' }));
      const budget = 80;
      const text = mgr.loadForContext([first, second, third], { budgetTokens: budget, multiplier: 1 });
      expect(text).toContain('### First');
      expect(text).toContain('### Second');
      expect(text).toContain('[…truncated]');
      expect(text).not.toContain('### Third');
      expect(text).not.toContain('word199');
      const { estimateTokensFromText } = await import('../../../../src/utils/tokenEstimate.js');
      expect(estimateTokensFromText(text, 1)).toBeLessThanOrEqual(budget);
    });

    it('rejects a negative or non-finite budget', () => {
      expect(() => mgr.loadForContext([], { budgetTokens: -1 })).toThrow(RangeError);
      expect(() => mgr.loadForContext([], { budgetTokens: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    });
  });
});
