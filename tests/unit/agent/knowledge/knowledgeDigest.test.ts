/** Unit tests for the canonical JSON, digest, budget and diff helpers. */
import { describe, it, expect } from 'vitest';
import {
  canonicalKnowledgeJson,
  digestOf,
  fitInOrder,
  idDelta,
  diffSnapshots,
  slugify,
} from '../../../../src/agent/knowledge/knowledgeDigest.js';
import type { KnowledgeSnapshotRecord } from '../../../../src/types/skills.js';
import { makeSkill, FIXED_TIME } from './knowledgeFixtures.js';

describe('canonicalKnowledgeJson / digestOf', () => {
  it('ignores object key order and undefined members', () => {
    const a = { z: 1, a: { y: [1, 2], b: 'x' } };
    const b = { a: { b: 'x', y: [1, 2] }, z: 1, skipped: undefined };
    expect(canonicalKnowledgeJson(a)).toBe(canonicalKnowledgeJson(b));
    expect(digestOf({ instructionSets: [], skills: [a] })).toBe(
      digestOf({ instructionSets: [], skills: [b] }),
    );
  });

  it('sorts arrays of id-bearing records by id but keeps other arrays in order', () => {
    const forward = [{ id: 'b', n: 1 }, { id: 'a', n: 2 }];
    const reversed = [{ id: 'a', n: 2 }, { id: 'b', n: 1 }];
    expect(canonicalKnowledgeJson(forward)).toBe(canonicalKnowledgeJson(reversed));
    expect(canonicalKnowledgeJson(['b', 'a'])).not.toBe(canonicalKnowledgeJson(['a', 'b']));
  });

  it('changes the digest when any payload value changes', () => {
    const base = { instructionSets: [], skills: [makeSkill('s1')] };
    const changed = { instructionSets: [], skills: [makeSkill('s1', { body: 'other' })] };
    expect(digestOf(base)).not.toBe(digestOf(changed));
  });
});

describe('slugify', () => {
  it('produces lower-case hyphenated slugs and never returns an empty string', () => {
    expect(slugify('Paginate API Results!')).toBe('paginate-api-results');
    expect(slugify('!!!')).toBe('item');
    expect(slugify('a'.repeat(60)).length).toBeLessThanOrEqual(40);
  });
});

describe('fitInOrder', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
  const items = [{ text: words(2) }, { text: words(2) }, { text: words(1) }];
  const render = (kept: readonly { text: string }[]) => kept.map((k) => k.text).join(' ');

  it('keeps the longest prefix that fits and stops at the first overflow', () => {
    expect(fitInOrder(items, render, 4, 1)).toHaveLength(2);
    expect(fitInOrder(items, render, 3, 1)).toHaveLength(1);
    expect(fitInOrder(items, render, 0, 1)).toHaveLength(0);
  });

  it('does not skip a large early item to keep a smaller later one', () => {
    const big = [{ text: words(10) }, { text: words(1) }];
    expect(fitInOrder(big, render, 5, 1)).toHaveLength(0);
  });
});

describe('idDelta / diffSnapshots (pure)', () => {
  it('idDelta mirrors when the arguments are swapped', () => {
    const forward = idDelta(['a', 'b'], ['b', 'c']);
    const backward = idDelta(['b', 'c'], ['a', 'b']);
    expect(forward).toEqual({ added: ['c'], removed: ['a'] });
    expect(backward).toEqual({ added: ['a'], removed: ['c'] });
  });

  it('reports skill retirement in one direction and restoration in the other', () => {
    const live = makeSkill('s1');
    const retired = makeSkill('s1', { retired: { at: FIXED_TIME as never, reason: 'old' } });
    const snap = (skills: typeof live[]): KnowledgeSnapshotRecord => ({
      id: 'K-x',
      createdAt: FIXED_TIME as never,
      instructionSets: [],
      skills,
      memoryRefs: { heuristicIds: [], failureIds: [], reflectionIds: [] },
      digest: 'd',
    });
    const forward = diffSnapshots(snap([live]), snap([retired]));
    const backward = diffSnapshots(snap([retired]), snap([live]));
    expect(forward.skills.retired).toEqual(['s1']);
    expect(backward.skills.restored).toEqual(['s1']);
    expect(forward.skills.updated).toEqual([]);
  });
});
