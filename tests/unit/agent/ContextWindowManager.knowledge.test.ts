/**
 * ContextWindowManager knowledge integration tests (spec RS-27).
 * Uses a fake KnowledgeRepositoryLike with the section layout of KnowledgeRepository.loadForContext.
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { KnowledgeRepositoryLike } from '../../../src/agent/knowledgeContext.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';
import { estimateTokensFromText } from '../../../src/utils/tokenEstimate.js';

const INSTRUCTION = 'Always cite sources for every claim.';
const SKILL_BODY = 'Parse the almanac table before answering.';

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `w${i}`).join(' ');
}

function renderedMarkdown(instr: string, skill: string): string {
  return [
    `## Instructions (shared)\n\n- ${instr}`,
    `## Skills\n\n### almanac-parse (uncertainty 0.1, sources: none)\n\n${skill}`,
    '## Failure lessons\n\n- timeout → retry (applies when: slow network)',
  ].join('\n\n');
}

function fakeKnowledge(markdown = renderedMarkdown(INSTRUCTION, SKILL_BODY)): KnowledgeRepositoryLike & {
  loadForContext: ReturnType<typeof vi.fn>;
} {
  return {
    loadForContext: vi.fn(async () => ({
      markdown,
      skillIds: [],
      instructionSetIds: [],
      failureIds: [],
      tokens: 0,
    })),
  } as unknown as KnowledgeRepositoryLike & { loadForContext: ReturnType<typeof vi.fn> };
}

function build(): ContextWindowManager {
  const storage = {
    loadGraph: vi.fn().mockResolvedValue({ entities: [] as Entity[], relations: [] }),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn().mockReturnValue(undefined),
    getRelationsFor: vi.fn().mockReturnValue([]),
  } as unknown as IGraphStorage;
  const accessTracker = new AccessTracker(storage);
  const decayEngine = new DecayEngine(storage, accessTracker);
  const salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
  return new ContextWindowManager(storage, salienceEngine, {});
}

describe('ContextWindowManager.wakeUp with knowledge', () => {
  it('puts shared instructions in L0 within the L0 budget', async () => {
    const result = await build().wakeUp({ knowledge: fakeKnowledge(), maxL0Tokens: 100 });
    expect(result.l0).toContain(INSTRUCTION);
    expect(result.l0).toContain('## Instructions (shared)');
    expect(estimateTokensFromText(result.l0, 1.3)).toBeLessThanOrEqual(100);
  });

  it('puts matched skill bodies in L1 within the L1 budget', async () => {
    const result = await build().wakeUp({ knowledge: fakeKnowledge(), taskHint: 'read the almanac', maxL1Tokens: 500 });
    expect(result.l1).toContain('## Skills');
    expect(result.l1).toContain(SKILL_BODY);
    expect(result.l1).not.toContain('Failure lessons');
    expect(estimateTokensFromText(result.l1, 1.3)).toBeLessThanOrEqual(500);
  });

  it('passes the taskHint and shared role to the repository', async () => {
    const knowledge = fakeKnowledge();
    await build().wakeUp({ knowledge, taskHint: 'read the almanac', maxL0Tokens: 100, maxL1Tokens: 200 });
    expect(knowledge.loadForContext).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'shared', taskHint: 'read the almanac' }),
    );
  });

  it('truncates over-budget content instead of throwing', async () => {
    const knowledge = fakeKnowledge(renderedMarkdown(words(300), words(300)));
    const result = await build().wakeUp({ knowledge, maxL0Tokens: 20, maxL1Tokens: 20 });
    expect(estimateTokensFromText(result.l0, 1.3)).toBeLessThanOrEqual(20);
    expect(estimateTokensFromText(result.l1, 1.3)).toBeLessThanOrEqual(20);
    expect(result.totalTokens).toBeLessThanOrEqual(40);
  });

  it('resolves when the repository rejects', async () => {
    const knowledge = {
      loadForContext: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as KnowledgeRepositoryLike;
    const result = await build().wakeUp({ knowledge });
    expect(result.l0).toBe('');
    expect(result.l1).toBe('');
  });

  it('is byte-identical to the no-knowledge output when knowledge is unset', async () => {
    const cwm = build();
    const baseline = await cwm.wakeUp({ maxL0Tokens: 100, maxL1Tokens: 500 });
    const unset = await cwm.wakeUp({ maxL0Tokens: 100, maxL1Tokens: 500, knowledge: undefined, taskHint: 'x' });
    expect(unset).toEqual(baseline);
  });
});
