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
