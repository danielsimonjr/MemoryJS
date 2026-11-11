import { describe, it, expect } from 'vitest';
import type { FailureRecord } from '../../../../src/types/agent-memory.js';
import type { SkillRecord } from '../../../../src/types/skills.js';
import type { InstructionItem } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { makeSkill } from './knowledgeFixtures.js';
import { packLoadedKnowledge, toLoadItems } from '../../../../src/agent/knowledge/knowledgeLoad.js';
import type { SkillMatchLike } from '../../../../src/agent/knowledge/KnowledgeRepository.js';

function match(skill: SkillRecord): SkillMatchLike {
  return { skill, score: 0, matched: [] };
}

function instruction(setId: string, heading: string, text: string): InstructionItem {
  return { setId, heading, text };
}

function failure(id: string): FailureRecord {
  return {
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    context: 'ctx',
    attempted: 'attempt',
    failure_mode: 'mode',
    root_cause: 'root',
    applicability_hint: 'hint',
    lifecycle: 'open',
  } as unknown as FailureRecord;
}

describe('toLoadItems', () => {
  it('concatenates instructions, skills then failures in that order', () => {
    const items = toLoadItems(
      [instruction('set-a', 'H', 'body')],
      [match(makeSkill('skill-a'))],
      [failure('failure-a')],
    );
    expect(items.map((i) => i.kind)).toEqual(['instruction', 'skill', 'failure']);
  });

  it('returns an empty list when every input is empty', () => {
    expect(toLoadItems([], [], [])).toEqual([]);
  });
});

describe('packLoadedKnowledge', () => {
  it('renders markdown grouping instructions, skills and failures', () => {
    const packed = packLoadedKnowledge(
      'solver',
      toLoadItems([instruction('set-a', 'Heading', 'Do the thing.')], [match(makeSkill('skill-a'))], [failure('failure-a')]),
      4000,
      1.3,
    );
    expect(packed.markdown).toContain('## Instructions (solver)');
    expect(packed.markdown).toContain('### Heading');
    expect(packed.markdown).toContain('## Skills');
    expect(packed.markdown).toContain('## Failure lessons');
  });

  it('collects skill, instruction-set and failure ids from the kept items', () => {
    const packed = packLoadedKnowledge(
      'solver',
      toLoadItems([instruction('set-a', 'H', 'body')], [match(makeSkill('skill-a'))], [failure('failure-a')]),
      4000,
      1.3,
    );
    expect(packed.skillIds).toEqual(['skill-a']);
    expect(packed.instructionSetIds).toEqual(['set-a']);
    expect(packed.failureIds).toEqual(['failure-a']);
  });

  it('omits a skill that falls after the budget cut from skillIds', () => {
    const small = makeSkill('skill-small');
    const large = makeSkill('skill-large', { body: 'token '.repeat(3000) });
    const packed = packLoadedKnowledge(
      'solver',
      toLoadItems([], [match(small), match(large)], []),
      1000,
      1.3,
    );
    expect(packed.skillIds).toEqual(['skill-small']);
    expect(packed.markdown).not.toContain('skill-large');
  });

  it('deduplicates instruction-set ids across sections of the same set', () => {
    const packed = packLoadedKnowledge(
      'solver',
      toLoadItems([instruction('set-a', 'A', 'one'), instruction('set-a', 'B', 'two')], [], []),
      4000,
      1.3,
    );
    expect(packed.instructionSetIds).toEqual(['set-a']);
  });

  it('reports positive tokens for a non-empty render and zero for an empty one', () => {
    const packed = packLoadedKnowledge('solver', toLoadItems([], [], []), 4000, 1.3);
    expect(packed.markdown).toBe('');
    expect(packed.tokens).toBe(0);
    const nonEmpty = packLoadedKnowledge('solver', toLoadItems([instruction('s', 'H', 'text')], [], []), 4000, 1.3);
    expect(nonEmpty.tokens).toBeGreaterThan(0);
  });
});
