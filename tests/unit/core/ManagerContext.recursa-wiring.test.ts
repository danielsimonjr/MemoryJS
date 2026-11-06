/**
 * Recursa Phase 1D: ManagerContext lazy getters for the skill registry, the
 * instruction sets, the knowledge repository and the skill publisher.
 *
 * - Each getter returns the same instance on repeated access.
 * - Nothing is constructed until a getter is touched (checked through the
 *   private cache fields, the same pattern the other wiring tests use).
 * - `skillManager` never constructs `semanticSearch`; it blends semantic scores
 *   only when `semanticSearch` was initialised first, and a throwing or
 *   rejecting provider degrades to the lexical score.
 * - `knowledgeRepository.loadForContext` works end-to-end through the getters
 *   on both storage backends.
 * - `close()` is idempotent.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import {
  makeTempJsonlPath,
  makeTempSqlitePath,
  cleanupTempDirs,
} from '../../helpers/tempStorage.js';

type CacheFields = {
  _skillManager?: unknown;
  _instructionSets?: unknown;
  _knowledgeRepository?: unknown;
  _skillPublisher?: unknown;
};

function cacheOf(ctx: ManagerContext): CacheFields {
  return ctx as unknown as CacheFields;
}

const BACKENDS = [
  { name: 'jsonl', storageType: 'jsonl' as const, newPath: makeTempJsonlPath },
  { name: 'sqlite', storageType: 'sqlite' as const, newPath: makeTempSqlitePath },
] as const;

const ENV_KEYS = ['MEMORY_STORAGE_TYPE', 'MEMORY_EMBEDDING_PROVIDER'] as const;

describe('Recursa ManagerContext getters', () => {
  const contexts: ManagerContext[] = [];
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    // The env var overrides the constructor's storageType option, so clear it
    // to make each backend case exercise the backend it names.
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    cleanupTempDirs();
  });

  function newCtx(backend: (typeof BACKENDS)[number]): ManagerContext {
    const ctx = new ManagerContext({ storagePath: backend.newPath(), storageType: backend.storageType });
    contexts.push(ctx);
    return ctx;
  }

  describe.each(BACKENDS)('on $name storage', (backend) => {
    it('returns the same instance on repeated access', () => {
      const ctx = newCtx(backend);
      expect(ctx.skillManager).toBe(ctx.skillManager);
      expect(ctx.instructionSets).toBe(ctx.instructionSets);
      expect(ctx.knowledgeRepository).toBe(ctx.knowledgeRepository);
      expect(ctx.skillPublisher).toBe(ctx.skillPublisher);
    });

    it('constructs nothing until a getter is touched, and each getter only what it needs', () => {
      const ctx = newCtx(backend);
      expect(cacheOf(ctx)._skillManager).toBeUndefined();
      expect(cacheOf(ctx)._instructionSets).toBeUndefined();
      expect(cacheOf(ctx)._knowledgeRepository).toBeUndefined();
      expect(cacheOf(ctx)._skillPublisher).toBeUndefined();

      // Touching the publisher builds the skill manager it wraps, but not the repository.
      expect(ctx.skillPublisher).toBeDefined();
      expect(cacheOf(ctx)._skillPublisher).toBeDefined();
      expect(cacheOf(ctx)._skillManager).toBeDefined();
      expect(cacheOf(ctx)._instructionSets).toBeUndefined();
      expect(cacheOf(ctx)._knowledgeRepository).toBeUndefined();

      // Touching the repository builds the instruction sets it composes.
      expect(ctx.knowledgeRepository).toBeDefined();
      expect(cacheOf(ctx)._instructionSets).toBeDefined();
      expect(cacheOf(ctx)._knowledgeRepository).toBeDefined();
    });

    it('loadForContext returns a skill added through ctx.skillManager and an instruction set added through ctx.instructionSets', async () => {
      const ctx = newCtx(backend);
      const skillId = await ctx.skillManager.add({
        name: 'Rerun flaky tests',
        description: 'Use when a flaky test fails intermittently',
        kind: 'procedure',
        scope: { domains: ['testing'] },
        uncertainty: 0.2,
        body: 'Re-run the failing test three times before blaming the production code.',
      });
      const setId = await ctx.instructionSets.add({
        role: 'solver',
        sections: [
          {
            heading: 'House style',
            text: 'Prefer small pure functions with explicit return types.',
            sources: [],
            uncertainty: 0.1,
          },
        ],
      });

      const loaded = await ctx.knowledgeRepository.loadForContext({
        role: 'solver',
        taskHint: 'flaky test fails intermittently',
        budgetTokens: 2000,
      });

      expect(loaded.skillIds).toContain(skillId);
      expect(loaded.instructionSetIds).toContain(setId);
      expect(loaded.markdown).toContain('House style');
      expect(loaded.markdown).toContain('Re-run the failing test');
      expect(loaded.tokens).toBeGreaterThan(0);
    });

    it('close() is idempotent', () => {
      const ctx = newCtx(backend);
      void ctx.skillManager;
      void ctx.knowledgeRepository;
      ctx.close();
      expect(() => ctx.close()).not.toThrow();
      expect(() => ctx.close()).not.toThrow();
    });
  });

  it('leaves semantic matching unwired when no embedding provider is configured', () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath() });
    contexts.push(ctx);
    expect(ctx.semanticSearch).toBeNull();
    expect((ctx.skillManager as unknown as { semantic?: unknown }).semantic).toBeUndefined();
  });

  it('touching skillManager / knowledgeRepository on a fresh context does not construct semanticSearch', () => {
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath() });
    contexts.push(ctx);
    void ctx.skillManager;
    void ctx.knowledgeRepository;
    expect((ctx as unknown as { _semanticSearch?: unknown })._semanticSearch ?? undefined).toBeUndefined();
    expect((ctx.skillManager as unknown as { semantic?: unknown }).semantic).toBeUndefined();
  });

  it('match() with the default embedding env returns lexical results without throwing', async () => {
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath() });
    contexts.push(ctx);
    const id = await ctx.skillManager.add({
      name: 'Rerun flaky tests',
      description: 'Use when a flaky test fails intermittently',
      kind: 'procedure',
      scope: { domains: ['testing'] },
      uncertainty: 0.2,
      body: 'Re-run the failing test three times.',
    });
    const matches = await ctx.skillManager.match('flaky test fails');
    expect(matches.map((m) => m.skill.id)).toContain(id);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('peer missing'))],
    ['throws synchronously', () => {
      throw new Error('peer missing');
    }],
  ])('match() falls back to the lexical score when the provider %s', async (_label, impl) => {
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath() });
    contexts.push(ctx);
    const manager = ctx.skillManager;
    const id = await manager.add({
      name: 'Rerun flaky tests',
      description: 'Use when a flaky test fails intermittently',
      kind: 'procedure',
      scope: { domains: ['testing'] },
      uncertainty: 0.2,
      body: 'Re-run the failing test three times.',
    });
    const lexical = await manager.match('flaky test fails');
    manager.setSemanticSearch({ calculateSimilarity: impl as never });
    const blended = await manager.match('flaky test fails');
    expect(blended.map((m) => m.skill.id)).toEqual([id]);
    expect(blended[0].score).toBe(lexical[0].score);
  });
});
