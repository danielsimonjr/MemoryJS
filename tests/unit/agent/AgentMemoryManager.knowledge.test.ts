/**
 * AgentMemoryManager knowledge wiring tests (spec RS-27).
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentMemoryManager } from '../../../src/agent/AgentMemoryManager.js';
import type { KnowledgeRepositoryLike } from '../../../src/agent/knowledgeContext.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';

const INSTRUCTION = 'Prefer primary sources.';

function fake(instr: string): KnowledgeRepositoryLike {
  return {
    loadForContext: vi.fn(async () => ({
      markdown: `## Instructions (shared)\n\n- ${instr}`,
      skillIds: [],
      instructionSetIds: [],
      failureIds: [],
      tokens: 0,
    })),
  } as unknown as KnowledgeRepositoryLike;
}

function manager(): AgentMemoryManager {
  const storage = {
    loadGraph: vi.fn().mockResolvedValue({ entities: [] as Entity[], relations: [] }),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn().mockReturnValue(undefined),
    getRelationsFor: vi.fn().mockReturnValue([]),
  } as unknown as IGraphStorage;
  return new AgentMemoryManager(storage);
}

describe('AgentMemoryManager knowledge repository', () => {
  it('feeds the set repository into wakeUp', async () => {
    const mgr = manager();
    mgr.setKnowledgeRepository(fake(INSTRUCTION));
    const result = await mgr.wakeUp({ maxL0Tokens: 100 });
    expect(result.l0).toContain(INSTRUCTION);
  });

  it('prefers an explicit knowledge option over the set repository', async () => {
    const mgr = manager();
    mgr.setKnowledgeRepository(fake('set repo rule'));
    const result = await mgr.wakeUp({ maxL0Tokens: 100, knowledge: fake('explicit rule') });
    expect(result.l0).toContain('explicit rule');
    expect(result.l0).not.toContain('set repo rule');
  });

  it('clears knowledge when set to undefined', async () => {
    const mgr = manager();
    const baseline = await mgr.wakeUp({ maxL0Tokens: 100 });
    mgr.setKnowledgeRepository(fake(INSTRUCTION));
    mgr.setKnowledgeRepository(undefined);
    const cleared = await mgr.wakeUp({ maxL0Tokens: 100 });
    expect(cleared).toEqual(baseline);
    expect(cleared.l0).not.toContain(INSTRUCTION);
  });

  it('matches ContextWindowManager output when no repository is set', async () => {
    const mgr = manager();
    const direct = await mgr.contextWindowManager.wakeUp({ maxL1Tokens: 300 });
    expect(await mgr.wakeUp({ maxL1Tokens: 300 })).toEqual(direct);
  });
});
