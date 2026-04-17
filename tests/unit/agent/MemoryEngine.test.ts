import { describe, it, expect } from 'vitest';
import { MemoryEngine } from '../../../src/agent/MemoryEngine.js';
import { ImportanceScorer } from '../../../src/agent/ImportanceScorer.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
