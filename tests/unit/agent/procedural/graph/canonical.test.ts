/**
 * Tests for Procedural Graph canonical hashing.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  graphDigest,
  storageKey,
  toolCatalogHash,
} from '../../../../../src/agent/procedural/graph/canonical.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGNode, PGSnapshot } from '../../../../../src/types/proceduralGraph.js';

function node(id: string, extras: Partial<PGNode> = {}): PGNode {
  return { id, type: 'ACTION', description: `node ${id}`, ...extras };
}

function edge(source: string, target: string, extras: Partial<PGEdge> = {}): PGEdge {
  return {
    source,
    relation: 'LEADS_TO',
    target,
    condition: null,
    guidance: 'g',
    pitfalls: 'p',
    ...extras,
  };
}

function snapshot(partial: Partial<PGSnapshot> = {}): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId: 'graph-a',
    revisionId: 'rev-1',
    entryNodeId: 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy: 'reject',
    toolCatalogHash: toolCatalogHash(['lookup']),
    nodes: [node('Start', { type: 'STATE' }), node('End', { type: 'STATE' })],
    edges: [edge('Start', 'End')],
    ...partial,
  };
}

describe('canonical', () => {
  it('canonicalJson sorts keys recursively and is whitespace-free', () => {
    const raw = { b: 1, a: { d: 2, c: [ { z: 1, y: 2 } ] } };
    const encoded = canonicalJson(raw);
    expect(encoded).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
    expect(encoded).not.toMatch(/\s/);
  });

  it('graphDigest ignores graphId, revisionId and parentRevisionId', () => {
    const base = snapshot({ graphId: 'g1', revisionId: 'r1', parentRevisionId: 'p0' });
    const renamed = snapshot({ graphId: 'g2', revisionId: 'r9', parentRevisionId: 'p8' });
    expect(graphDigest(base)).toBe(graphDigest(renamed));
  });

  it('graphDigest changes when an edge attribute changes', () => {
    const a = snapshot({
      edges: [edge('Start', 'End', { guidance: 'go' })],
    });
    const b = snapshot({
      edges: [edge('Start', 'End', { guidance: 'stop' })],
    });
    expect(graphDigest(a)).not.toBe(graphDigest(b));
  });

  it('graphDigest is order-independent for nodes and edges', () => {
    const n1 = node('A');
    const n2 = node('B');
    const e1 = edge('A', 'B', { relation: 'LEADS_TO' });
    const e2 = edge('A', 'B', { relation: 'TRIGGERS' });
    const left = snapshot({
      entryNodeId: 'A',
      nodes: [n1, n2],
      edges: [e1, e2],
    });
    const right = snapshot({
      entryNodeId: 'A',
      nodes: [n2, n1],
      edges: [e2, e1],
    });
    expect(graphDigest(left)).toBe(graphDigest(right));
  });

  it('storageKey is under 100 chars for a 600-char node id', () => {
    const key = storageKey('node', ['graph-id', 'revision-id', 'n'.repeat(600)]);
    expect(key.length).toBeLessThan(100);
    expect(key.startsWith('pg:node:')).toBe(true);
  });
});
