/**
 * Direct unit tests for collectInducedRelations (CMP-5).
 */

import { describe, it, expect, vi } from 'vitest';
import { collectInducedRelations } from '../../../src/search/inducedSubgraph.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Relation } from '../../../src/types/index.js';

function fakeStorage(relations: Relation[]): GraphStorage {
  const byFrom = new Map<string, Relation[]>();
  for (const r of relations) {
    const list = byFrom.get(r.from) ?? [];
    list.push(r);
    byFrom.set(r.from, list);
  }
  return {
    getRelationsFrom: (name: string) => byFrom.get(name) ?? [],
  } as unknown as GraphStorage;
}

const rel = (from: string, to: string, relationType = 'knows'): Relation => ({
  from,
  to,
  relationType,
});

describe('collectInducedRelations', () => {
  const relations = [
    rel('A', 'B'),
    rel('B', 'A', 'likes'),
    rel('A', 'C'),
    rel('C', 'D'),
    rel('D', 'A'),
    rel('B', 'B', 'self'),
  ];

  it('returns only relations whose endpoints are both in the set', () => {
    const storage = fakeStorage(relations);
    const out = collectInducedRelations(storage, new Set(['A', 'B']));
    const keys = out.map(r => `${r.from}>${r.to}:${r.relationType}`).sort();
    expect(keys).toEqual(['A>B:knows', 'B>A:likes', 'B>B:self']);
  });

  it('never includes an edge with an endpoint outside the set', () => {
    const storage = fakeStorage(relations);
    const set = new Set(['A', 'C']);
    const out = collectInducedRelations(storage, set);
    for (const r of out) {
      expect(set.has(r.from)).toBe(true);
      expect(set.has(r.to)).toBe(true);
    }
    expect(out.map(r => `${r.from}>${r.to}`)).toEqual(['A>C']);
  });

  it('includes each induced edge exactly once', () => {
    const storage = fakeStorage(relations);
    const out = collectInducedRelations(storage, new Set(['A', 'B', 'C', 'D']));
    expect(out).toHaveLength(relations.length);
    expect(new Set(out).size).toBe(out.length);
  });

  it('applies the optional predicate to induced edges', () => {
    const storage = fakeStorage(relations);
    const out = collectInducedRelations(
      storage,
      new Set(['A', 'B']),
      r => r.relationType !== 'likes',
    );
    expect(out.map(r => r.relationType).sort()).toEqual(['knows', 'self']);
  });

  it('returns an empty array for an empty entity set without querying storage', () => {
    const getRelationsFrom = vi.fn(() => []);
    const storage = { getRelationsFrom } as unknown as GraphStorage;
    expect(collectInducedRelations(storage, new Set())).toEqual([]);
    expect(getRelationsFrom).not.toHaveBeenCalled();
  });

  it('queries adjacency only for names in the set', () => {
    const getRelationsFrom = vi.fn(() => []);
    const storage = { getRelationsFrom } as unknown as GraphStorage;
    collectInducedRelations(storage, new Set(['A', 'B']));
    expect(getRelationsFrom.mock.calls.map(c => c[0])).toEqual(['A', 'B']);
  });
});
