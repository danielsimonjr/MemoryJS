import { describe, it, expect } from 'vitest';
import { MemoryEngine } from '../../../src/agent/MemoryEngine.js';
import { ImportanceScorer } from '../../../src/agent/ImportanceScorer.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function mkCtx(): { ctx: ManagerContext; cleanup: () => void } {
  const file = path.join(os.tmpdir(), `memengine-${Date.now()}-${Math.random()}.jsonl`);
  const ctx = new ManagerContext(file);
  return { ctx, cleanup: () => { if (existsSync(file)) rmSync(file, { force: true }); } };
}

describe('MemoryEngine — construction', () => {
  it('constructs successfully with required dependencies', () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      expect(engine).toBeDefined();
      expect(engine.events).toBeDefined();
    } finally { cleanup(); }
  });

  it('throws when semanticDedupEnabled=true without SemanticSearch', () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      expect(() => new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
        undefined, undefined, { semanticDedupEnabled: true },
      )).toThrow(/semanticDedupEnabled=true requires a SemanticSearch/);
    } finally { cleanup(); }
  });
});

describe('MemoryEngine — checkDuplicate Tier 1 (exact equality)', () => {
  it('detects duplicate when contentHash matches within the same session', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const seeded = await agent.episodicMemory.createEpisode('[role=user] hello world', { sessionId: 'sess-A' });
      await ctx.storage.updateEntity(seeded.name, { contentHash: sha256('hello world') });

      const result = await engine.checkDuplicate('hello world', 'sess-A');
      expect(result.isDuplicate).toBe(true);
      expect(result.tier).toBe('exact');
      expect(result.match?.name).toBe(seeded.name);
    } finally { cleanup(); }
  });

  it('does NOT fire Tier 1 across sessions', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const seeded = await agent.episodicMemory.createEpisode('[role=user] x', { sessionId: 'sess-A' });
      await ctx.storage.updateEntity(seeded.name, { contentHash: sha256('x') });

      const result = await engine.checkDuplicate('x', 'sess-B');
      expect(result.isDuplicate).toBe(false);
    } finally { cleanup(); }
  });

  it('returns non-duplicate when no matching hash exists', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const result = await engine.checkDuplicate('nothing here yet', 'sess-A');
      expect(result.isDuplicate).toBe(false);
    } finally { cleanup(); }
  });
});

describe('MemoryEngine — checkDuplicate Tier 2 (50% prefix overlap)', () => {
  it('fires when prefix overlap ratio >= 0.5', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await agent.episodicMemory.createEpisode(
        '[role=user] The quick brown fox jumps over the lazy dog in the park',
        { sessionId: 'sess-A' },
      );
      const result = await engine.checkDuplicate(
        'The quick brown fox jumps over the lazy cat',
        'sess-A',
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.tier).toBe('prefix');
    } finally { cleanup(); }
  });

  it('does not fire when prefix overlap < 0.5', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await agent.episodicMemory.createEpisode(
        '[role=user] alpha beta gamma delta epsilon zeta eta theta iota kappa',
        { sessionId: 'sess-A' },
      );
      const result = await engine.checkDuplicate('zzz different content entirely', 'sess-A');
      expect(result.isDuplicate).toBe(false);
    } finally { cleanup(); }
  });

  it('ignores role prefix when comparing', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await agent.episodicMemory.createEpisode(
        '[role=user] database migration running smoothly today',
        { sessionId: 'sess-A' },
      );
      const result = await engine.checkDuplicate(
        'database migration running smoothly today afternoon',
        'sess-A',
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.tier).toBe('prefix');
    } finally { cleanup(); }
  });
});

describe('MemoryEngine — checkDuplicate Tier 3 (Jaccard)', () => {
  it('fires when Jaccard token overlap >= 0.72', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await agent.episodicMemory.createEpisode(
        '[role=user] alpha beta gamma delta epsilon zeta eta theta iota kappa lambda extra',
        { sessionId: 'sess-A' },
      );
      const result = await engine.checkDuplicate(
        'lambda kappa iota theta eta zeta epsilon delta gamma beta alpha other',
        'sess-A',
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.tier).toBe('jaccard');
    } finally { cleanup(); }
  });

  it('does not fire when Jaccard < 0.72', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await agent.episodicMemory.createEpisode(
        '[role=user] one two three four five',
        { sessionId: 'sess-A' },
      );
      const result = await engine.checkDuplicate('six seven eight nine ten one', 'sess-A');
      expect(result.isDuplicate).toBe(false);
    } finally { cleanup(); }
  });

  it('tier short-circuit: exact hit skips prefix and Jaccard', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const seeded = await agent.episodicMemory.createEpisode('[role=user] exact match', {
        sessionId: 'sess-A',
      });
      await ctx.storage.updateEntity(seeded.name, { contentHash: sha256('exact match') });

      const result = await engine.checkDuplicate('exact match', 'sess-A');
      expect(result.tier).toBe('exact');
    } finally { cleanup(); }
  });
});

import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import type { Entity } from '../../../src/types/types.js';

function stubSemanticSearch(topResult?: { entity: Entity; similarity: number }) {
  return {
    search: async () => (topResult ? [topResult] : []),
  } as unknown as SemanticSearch;
}

describe('MemoryEngine — optional semantic tier', () => {
  it('fires semantic tier as primary when enabled', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const seeded = await agent.episodicMemory.createEpisode('[role=user] what time is it', { sessionId: 'sess-A' });
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
        stubSemanticSearch({ entity: seeded, similarity: 0.95 }), null,
        { semanticDedupEnabled: true, semanticThreshold: 0.9 },
      );
      const result = await engine.checkDuplicate('current time please', 'sess-A');
      expect(result.isDuplicate).toBe(true);
      expect(result.tier).toBe('semantic');
    } finally { cleanup(); }
  });

  it('skips semantic tier when disabled', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const seeded = await agent.episodicMemory.createEpisode('[role=user] what time is it', { sessionId: 'sess-A' });
      const spy = { called: 0 };
      const wrapped = { search: async () => { spy.called += 1; return [{ entity: seeded, similarity: 0.99 }]; } } as unknown as SemanticSearch;

      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
        wrapped, null, { semanticDedupEnabled: false },
      );
      await engine.checkDuplicate('current time please', 'sess-A');
      expect(spy.called).toBe(0);
    } finally { cleanup(); }
  });

  it('ignores semantic tier match below threshold', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const seeded = await agent.episodicMemory.createEpisode('[role=user] hello', { sessionId: 'sess-A' });
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
        stubSemanticSearch({ entity: seeded, similarity: 0.5 }), null,
        { semanticDedupEnabled: true, semanticThreshold: 0.9 },
      );
      const result = await engine.checkDuplicate('goodbye', 'sess-A');
      expect(result.isDuplicate).toBe(false);
    } finally { cleanup(); }
  });
});

describe('MemoryEngine — addTurn', () => {
  it('creates entity with role-prefixed observation, importance, contentHash', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const result = await engine.addTurn('hello world', { sessionId: 'sess-A', role: 'user' });

      expect(result.duplicateDetected).toBe(false);
      expect(result.entity.observations[0]).toBe('[role=user] hello world');
      expect(result.entity.contentHash).toBe(sha256('hello world'));
      expect(result.importanceScore).toBeGreaterThanOrEqual(0);
      expect(result.importanceScore).toBeLessThanOrEqual(10);
    } finally { cleanup(); }
  });

  it('returns existing entity + duplicateTier on duplicate', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const first = await engine.addTurn('hello world', { sessionId: 'sess-A', role: 'user' });
      const second = await engine.addTurn('hello world', { sessionId: 'sess-A', role: 'user' });
      expect(second.duplicateDetected).toBe(true);
      expect(second.duplicateTier).toBe('exact');
      expect(second.duplicateOf).toBe(first.entity.name);
    } finally { cleanup(); }
  });

  it('respects importance override', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const result = await engine.addTurn('x', { sessionId: 'sess-A', role: 'user', importance: 9 });
      expect(result.entity.importance).toBe(9);
      expect(result.importanceScore).toBe(9);
    } finally { cleanup(); }
  });

  it('fires memoryEngine:turnAdded event', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const captured: unknown[] = [];
      engine.events.on('memoryEngine:turnAdded', (ev) => captured.push(ev));

      await engine.addTurn('hello', { sessionId: 'sess-A', role: 'user' });
      expect(captured).toHaveLength(1);
      const ev = captured[0] as { sessionId: string; role: string; importance: number };
      expect(ev.sessionId).toBe('sess-A');
      expect(ev.role).toBe('user');
      expect(typeof ev.importance).toBe('number');
    } finally { cleanup(); }
  });

  it('fires memoryEngine:duplicateDetected event on duplicate', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const captured: unknown[] = [];
      engine.events.on('memoryEngine:duplicateDetected', (ev) => captured.push(ev));

      await engine.addTurn('dupe', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('dupe', { sessionId: 'sess-A', role: 'user' });
      expect(captured).toHaveLength(1);
    } finally { cleanup(); }
  });
});

describe('MemoryEngine — session operations', () => {
  it('getSessionTurns returns all turns for session', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await engine.addTurn('one', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('two', { sessionId: 'sess-A', role: 'assistant' });
      await engine.addTurn('three', { sessionId: 'sess-B', role: 'user' });

      const turnsA = await engine.getSessionTurns('sess-A');
      expect(turnsA).toHaveLength(2);
      expect(turnsA.every((e) => e.sessionId === 'sess-A')).toBe(true);
    } finally { cleanup(); }
  });

  it('getSessionTurns filters by role', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await engine.addTurn('one', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('two', { sessionId: 'sess-A', role: 'assistant' });

      const userTurns = await engine.getSessionTurns('sess-A', { role: 'user' });
      expect(userTurns).toHaveLength(1);
      expect(userTurns[0].observations[0]).toBe('[role=user] one');
    } finally { cleanup(); }
  });

  it('getSessionTurns respects limit', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      // Sufficiently distinct content per turn so dedup tiers do not fire.
      const distinct = [
        'apple banana cherry',
        'mountain river forest',
        'piano violin trumpet',
        'crimson azure verdant',
        'meridian zenith equator',
      ];
      for (const c of distinct) {
        await engine.addTurn(c, { sessionId: 'sess-A', role: 'user' });
      }
      const turns = await engine.getSessionTurns('sess-A', { limit: 2 });
      expect(turns).toHaveLength(2);
    } finally { cleanup(); }
  });

  it('deleteSession removes session turns and fires event', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await engine.addTurn('one', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('two', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('three', { sessionId: 'sess-B', role: 'user' });

      const captured: unknown[] = [];
      engine.events.on('memoryEngine:sessionDeleted', (ev) => captured.push(ev));

      const { deleted } = await engine.deleteSession('sess-A');
      expect(deleted).toBe(2);
      expect(await engine.getSessionTurns('sess-A')).toHaveLength(0);
      expect(await engine.getSessionTurns('sess-B')).toHaveLength(1);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({ sessionId: 'sess-A', deletedCount: 2 });
    } finally { cleanup(); }
  });

  it('deleteSession on unknown session returns { deleted: 0 }', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      const { deleted } = await engine.deleteSession('nonexistent');
      expect(deleted).toBe(0);
    } finally { cleanup(); }
  });

  it('listSessions returns sessions with >=1 turn', async () => {
    const { ctx, cleanup } = mkCtx();
    try {
      const agent = ctx.agentMemory();
      const engine = new MemoryEngine(
        ctx.storage, ctx.entityManager, agent.episodicMemory,
        agent.workingMemory, new ImportanceScorer(),
      );
      await engine.addTurn('one', { sessionId: 'sess-A', role: 'user' });
      await engine.addTurn('two', { sessionId: 'sess-B', role: 'user' });
      const sessions = await engine.listSessions();
      expect(new Set(sessions)).toEqual(new Set(['sess-A', 'sess-B']));
    } finally { cleanup(); }
  });
});
