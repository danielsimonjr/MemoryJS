/**
 * Canonical comparators and digest stability (CL-4).
 *
 * `compareString` / `compareEdges` moved to canonical.ts from ProceduralGraph
 * and ProceduralGraphSerializer. The digest pin below was captured before the
 * move, so any change to the sort order or the hashed fields fails this test.
 */

import { describe, it, expect } from 'vitest';
import {
  compareEdges,
  compareString,
  graphDigest,
} from '../../../../../src/agent/procedural/graph/canonical.js';
import type { PGSnapshot, PGEdge, PGNode } from '../../../../../src/types/proceduralGraph.js';

/** Digest of `buildFixture()` computed by the pre-CL-4 code. */
const PINNED_FIXTURE_DIGEST = 'b053344ddd56e78de2f74c34ca4f87942b31a4323a94dcbd96ff1f0e17165e59';

function node(id: string, type: PGNode['type'], description: string, actionName?: string): PGNode {
  return actionName === undefined ? { id, type, description } : { id, type, description, actionName };
}

function edge(source: string, relation: string, target: string, condition: string | null = null): PGEdge {
  return { source, relation, target, condition, guidance: null, pitfalls: null };
}

function buildFixture(): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId: 'g-1',
    revisionId: 'r-1',
    entryNodeId: 'n-a',
    relationVocabulary: ['TRIGGERS', 'LEADS_TO', 'CONVERGES_TO', 'PROVIDES_INPUT_FOR'],
    cyclePolicy: 'allow',
    toolCatalogHash: 'abc',
    nodes: [
      node('n-c', 'STATE', 'Done'),
      node('n-a', 'ACTION', 'Start', 'open'),
      node('n-b', 'SKILL', 'Middle'),
      node('n-B', 'REASONING', 'Upper'),
    ],
    edges: [
      edge('n-b', 'TRIGGERS', 'n-c', 'if ok'),
      edge('n-a', 'LEADS_TO', 'n-b'),
      edge('n-a', 'LEADS_TO', 'n-B'),
      edge('n-a', 'CONVERGES_TO', 'n-c'),
      edge('n-B', 'PROVIDES_INPUT_FOR', 'n-c'),
      edge('n-a', 'LEADS_TO', 'n-b', 'dup'),
    ],
  };
}

describe('canonical comparators (CL-4)', () => {
  it('graphDigest of the fixture is unchanged from the pre-refactor value', () => {
    expect(graphDigest(buildFixture())).toBe(PINNED_FIXTURE_DIGEST);
  });

  it('graphDigest ignores input order of nodes and vocabulary', () => {
    const shuffled = buildFixture();
    shuffled.nodes = [...shuffled.nodes].reverse();
    shuffled.relationVocabulary = [...shuffled.relationVocabulary].reverse();
    expect(graphDigest(shuffled)).toBe(PINNED_FIXTURE_DIGEST);
  });

  it('graphDigest ignores input order of edges when no two edges tie', () => {
    // The fixture's two (n-a, n-b, LEADS_TO) edges tie, and a stable sort keeps
    // their input order, which the digest hashes. Use a tie-free fixture here.
    const base = buildFixture();
    base.edges = base.edges.filter(e => e.condition !== 'dup');
    const reversed = { ...base, edges: [...base.edges].reverse() };
    expect(graphDigest(reversed)).toBe(graphDigest(base));
  });

  it('compareString orders by code unit, with uppercase before lowercase', () => {
    expect(compareString('a', 'b')).toBeLessThan(0);
    expect(compareString('b', 'a')).toBeGreaterThan(0);
    expect(compareString('same', 'same')).toBe(0);
    expect(compareString('B', 'a')).toBeLessThan(0);
    expect(compareString('', 'a')).toBeLessThan(0);
    expect(['b', 'B', 'a', 'A'].sort(compareString)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('compareEdges uses source, then target, then relation', () => {
    const e = (source: string, target: string, relation: string) => ({ source, target, relation });
    expect(compareEdges(e('a', 'z', 'z'), e('b', 'a', 'a'))).toBeLessThan(0);
    expect(compareEdges(e('a', 'b', 'z'), e('a', 'c', 'a'))).toBeLessThan(0);
    expect(compareEdges(e('a', 'b', 'x'), e('a', 'b', 'y'))).toBeLessThan(0);
    expect(compareEdges(e('a', 'b', 'x'), e('a', 'b', 'x'))).toBe(0);
  });
});
