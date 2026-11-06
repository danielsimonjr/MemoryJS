/** Shared fixtures for the bootstrap tests (Recursa RS-10..RS-13). Deterministic. */
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { NavigationNodeRecord } from '../../../../src/types/skills.js';
import type { CorpusSource } from '../../../../src/agent/bootstrap/CorpusMapper.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import { SkillManager } from '../../../../src/agent/skills/SkillManager.js';
import { KnowledgeRepository } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { sha256Hex } from '../../../../src/agent/procedural/graph/canonical.js';
import { fakeFailures } from '../knowledge/knowledgeFixtures.js';

/**
 * Synthetic corpus: `count` documents spread over `groups` metadata groups. Each document has
 * unique terms (`orion<i>`) plus shared terms (`ledger`, `quarterly`) so keyword overlap is real.
 *
 * @param count - Number of documents.
 * @param groups - Number of groups (`g0`, `g1`, ...).
 * @returns Sources with inline text.
 */
export function syntheticCorpus(count: number, groups = 5): CorpusSource[] {
  const out: CorpusSource[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      ref: `doc-${String(i).padStart(2, '0')}.md`,
      title: `Document ${i}`,
      text: `Document ${i} records orion${i} vendor entries in the quarterly ledger for region zone${i % groups} with bravo${i} totals.`,
      metadata: { group: `g${i % groups}`, kind: i % 2 === 0 ? 'invoice' : 'memo' },
    });
  }
  return out;
}

/**
 * Navigation node record for a hand-built fixture.
 *
 * @param ref - Source ref.
 * @param overrides - Fields to replace.
 * @returns Record.
 */
export function nodeFixture(ref: string, overrides: Partial<NavigationNodeRecord> = {}): NavigationNodeRecord {
  const text = overrides.summary ?? `summary of ${ref}`;
  return {
    level: 0,
    ref,
    title: ref,
    summary: text,
    keywords: [],
    metadata: {},
    contentHash: sha256Hex(text),
    sourceRefs: [ref],
    ...overrides,
  };
}

/**
 * Real skill registry and knowledge repository over `storage`.
 *
 * @param storage - Storage.
 * @returns Skills and repository.
 */
export function realKnowledge(storage: IGraphStorage): { skills: SkillManager; repository: KnowledgeRepository } {
  const skills = new SkillManager(storage);
  const repository = new KnowledgeRepository({
    storage,
    instructionSets: new InstructionSetManager(storage),
    skills,
    failures: fakeFailures([]),
  });
  return { skills, repository };
}

/**
 * Provider that returns scripted replies in order (the last reply repeats).
 *
 * @param replies - Replies, or a function of the prompt.
 * @returns Provider with a call counter.
 */
export function scriptedLlm(replies: string[] | ((prompt: string) => string)): PGCompletionProvider & { calls: number } {
  const provider = {
    calls: 0,
    async complete(prompt: string): Promise<string> {
      const index = provider.calls;
      provider.calls += 1;
      if (typeof replies === 'function') return replies(prompt);
      return replies[Math.min(index, replies.length - 1)] ?? '';
    },
  };
  return provider;
}
