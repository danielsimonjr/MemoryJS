import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ContextWindowManager.wakeUp', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let amm: ReturnType<ManagerContext['agentMemory']>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'proj-alpha', entityType: 'project', observations: ['Uses React', 'Deployed on AWS'], importance: 8 },
      { name: 'proj-beta', entityType: 'project', observations: ['Uses Vue'], importance: 5 },
    ]);
    amm = ctx.agentMemory();
    await amm.profileManager.addFact('Senior developer', 'static');
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns L0 with profile static facts', async () => {
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l0).toContain('Senior developer');
    expect(result.l0).toContain('Prefers TypeScript');
  });

  it('returns L1 with top entities by importance', async () => {
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l1).toBeTruthy();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('respects maxL0Tokens budget', async () => {
    const result = await amm.contextWindowManager.wakeUp({ maxL0Tokens: 10 });
    expect(result.totalTokens).toBeLessThan(100);
  });

  it('returns empty L0 when no profile exists', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu2-'));
    const ctx2 = new ManagerContext(path.join(tmpDir2, 'memory.jsonl'));
    const amm2 = ctx2.agentMemory();
    const result = await amm2.contextWindowManager.wakeUp();
    expect(result.l0).toBe('');
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  // ==================== L1.5: pending prospective intentions ====================

  // ==================== Project Context (Phase PC B) ====================

  describe('project context (L0 prepend)', () => {
    it('returns empty projectContext when no projectId is supplied', async () => {
      const result = await amm.contextWindowManager.wakeUp();
      expect(result.projectContext).toBe('');
    });

    it('returns empty projectContext when no record exists for projectId', async () => {
      const result = await amm.contextWindowManager.wakeUp({ projectId: 'proj_unknown' });
      expect(result.projectContext).toBe('');
    });

    it('surfaces project facts/conventions/commands/glossary when present', async () => {
      await ctx.projectContextManager.upsert('proj_alpha', {
        facts: ['Built with TypeScript'],
        conventions: ['Use Result<T,E>'],
        commands: [{ name: 'test', command: 'npm test', purpose: 'Run tests' }],
        glossary: [{ term: 'OCC', definition: 'Optimistic Concurrency Control' }],
      });
      const result = await amm.contextWindowManager.wakeUp({ projectId: 'proj_alpha' });
      expect(result.projectContext).toContain('Facts');
      expect(result.projectContext).toContain('TypeScript');
      expect(result.projectContext).toContain('Conventions');
      expect(result.projectContext).toContain('Result<T,E>');
      expect(result.projectContext).toContain('npm test');
      expect(result.projectContext).toContain('OCC');
    });

    it('honors maxProjectContextTokens budget by truncating', async () => {
      await ctx.projectContextManager.upsert('proj_alpha', {
        facts: Array.from({ length: 30 }, (_, i) => `Fact ${i} is a longer-than-average sentence to exhaust the budget.`),
      });
      const result = await amm.contextWindowManager.wakeUp({
        projectId: 'proj_alpha',
        maxProjectContextTokens: 20,
      });
      // 20 tokens × default multiplier 1.3 ≈ 26 raw tokens →
      // estimateStringTokens returns chars/4-ish, so budget chars are
      // roughly 20*4 = 80. Generous upper bound to accommodate
      // truncation marker.
      expect(result.projectContext.length).toBeLessThanOrEqual(200);
    });

    it('includes projectContext tokens in totalTokens', async () => {
      await ctx.projectContextManager.upsert('proj_alpha', {
        facts: ['Built with TypeScript'],
      });
      const withCtx = await amm.contextWindowManager.wakeUp({ projectId: 'proj_alpha' });
      const withoutCtx = await amm.contextWindowManager.wakeUp({ projectId: 'proj_unknown' });
      expect(withCtx.totalTokens).toBeGreaterThan(withoutCtx.totalTokens);
    });
  });

  describe('L1.5 — pending prospective intentions', () => {
    it('returns empty l1_5 when there are no pending intentions', async () => {
      const result = await amm.contextWindowManager.wakeUp();
      expect(result.l1_5).toBe('');
      expect(result.pendingIntentionCount).toBe(0);
    });

    it('surfaces pending time-based intentions in l1_5', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      await ctx.prospectiveMemory.scheduleAt('Brief on overnight CI failures', future, {
        sessionId: 'session-a',
      });
      const result = await amm.contextWindowManager.wakeUp({ sessionId: 'session-a' });
      expect(result.pendingIntentionCount).toBe(1);
      expect(result.l1_5).toContain('Brief on overnight CI failures');
    });

    it('sorts l1_5 by next-fire time (earliest first)', async () => {
      const t1 = new Date(Date.now() + 60 * 60 * 1000); // 1h
      const t2 = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
      const t3 = new Date(Date.now() + 30 * 60 * 1000); // 30min
      await ctx.prospectiveMemory.scheduleAt('B-1h', t1, { sessionId: 's' });
      await ctx.prospectiveMemory.scheduleAt('C-2h', t2, { sessionId: 's' });
      await ctx.prospectiveMemory.scheduleAt('A-30m', t3, { sessionId: 's' });
      const result = await amm.contextWindowManager.wakeUp({ sessionId: 's' });
      const idxA = result.l1_5.indexOf('A-30m');
      const idxB = result.l1_5.indexOf('B-1h');
      const idxC = result.l1_5.indexOf('C-2h');
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('filters by sessionId when provided', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      await ctx.prospectiveMemory.scheduleAt('only-s1', future, { sessionId: 's1' });
      await ctx.prospectiveMemory.scheduleAt('only-s2', future, { sessionId: 's2' });
      const result = await amm.contextWindowManager.wakeUp({ sessionId: 's1' });
      expect(result.l1_5).toContain('only-s1');
      expect(result.l1_5).not.toContain('only-s2');
      expect(result.pendingIntentionCount).toBe(1);
    });

    it('includes intentions from all sessions when sessionId is omitted', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      await ctx.prospectiveMemory.scheduleAt('a-only', future, { sessionId: 'a' });
      await ctx.prospectiveMemory.scheduleAt('b-only', future, { sessionId: 'b' });
      const result = await amm.contextWindowManager.wakeUp();
      expect(result.pendingIntentionCount).toBe(2);
      expect(result.l1_5).toContain('a-only');
      expect(result.l1_5).toContain('b-only');
    });

    it('respects maxL1_5Tokens budget', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      for (let i = 0; i < 20; i++) {
        await ctx.prospectiveMemory.scheduleAt(`reminder-${i}-with-lots-of-words-to-burn-tokens`, future, {
          sessionId: 's',
        });
      }
      const result = await amm.contextWindowManager.wakeUp({
        sessionId: 's',
        maxL1_5Tokens: 50,
      });
      // Cap should kick in well below 20 intentions
      expect(result.pendingIntentionCount).toBeLessThan(20);
      expect(result.pendingIntentionCount).toBeGreaterThan(0);
    });

    it('skips L1.5 entirely when includeL1_5 is false', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      await ctx.prospectiveMemory.scheduleAt('x', future, { sessionId: 's' });
      const result = await amm.contextWindowManager.wakeUp({
        sessionId: 's',
        includeL1_5: false,
      });
      expect(result.l1_5).toBe('');
      expect(result.pendingIntentionCount).toBe(0);
    });

    it('excludes fired / cancelled / expired intentions', async () => {
      const future = new Date(Date.now() + 1000);
      await ctx.prospectiveMemory.scheduleAt('still-pending', future, { sessionId: 's' });
      const e2 = await ctx.prospectiveMemory.scheduleAt('to-be-cancelled', future, { sessionId: 's' });
      await ctx.prospectiveMemory.cancel(e2.name);
      const result = await amm.contextWindowManager.wakeUp({ sessionId: 's' });
      expect(result.l1_5).toContain('still-pending');
      expect(result.l1_5).not.toContain('to-be-cancelled');
      expect(result.pendingIntentionCount).toBe(1);
    });

    it('formats event-trigger prefix with all populated condition fields', async () => {
      await ctx.prospectiveMemory.scheduleOnEvent(
        'event-content',
        { tags: ['urgent', 'priority'], entityType: 'Task', sessionId: 's-e' },
        { sessionId: 's-e' }
      );
      const result = await amm.contextWindowManager.wakeUp({ sessionId: 's-e' });
      // All populated fields should appear in the prefix
      expect(result.l1_5).toMatch(/tags=urgent,priority/);
      expect(result.l1_5).toMatch(/type=Task/);
      expect(result.l1_5).toMatch(/session=s-e/);
    });

    it('includes l1_5 token count in totalTokens', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      await ctx.prospectiveMemory.scheduleAt('counted', future, { sessionId: 's' });
      const baseline = await amm.contextWindowManager.wakeUp({
        sessionId: 's',
        includeL1_5: false,
      });
      const withL15 = await amm.contextWindowManager.wakeUp({ sessionId: 's' });
      expect(withL15.totalTokens).toBeGreaterThan(baseline.totalTokens);
    });
  });
});
