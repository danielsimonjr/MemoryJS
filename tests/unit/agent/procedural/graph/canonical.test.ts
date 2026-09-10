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

  it('equality of digests for semantically identical graphs with different graphId/revisionId', () => {
    const nodes = [
      node('Start', { type: 'STATE', description: 'entry' }),
      node('lookup', { description: 'call lookup', actionName: 'lookup' }),
      node('End', { type: 'STATE', description: 'done' }),
    ];
    const edges = [
      edge('Start', 'lookup', { guidance: 'begin', pitfalls: 'do not skip' }),
      edge('lookup', 'End', { relation: 'TRIGGERS', condition: 'found', guidance: 'finish', pitfalls: 'do not loop' }),
    ];
    const left = snapshot({
      graphId: 'graph-alpha',
      revisionId: 'rev-left',
      parentRevisionId: 'parent-left',
      nodes,
      edges,
    });
    const right = snapshot({
      graphId: 'graph-beta',
      revisionId: 'rev-right',
      parentRevisionId: 'parent-right',
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
      relationVocabulary: [...PG_BUILT_IN_RELATIONS].reverse(),
    });
    expect(left.graphId).not.toBe(right.graphId);
    expect(left.revisionId).not.toBe(right.revisionId);
    expect(graphDigest(left)).toBe(graphDigest(right));
  });

  it('property: graphDigest is order-independent across 200 random graphs', () => {
    const rng = mulberry32(20260910);
    for (let i = 0; i < 200; i++) {
      const generated = randomSnapshot(rng);
      const shuffled = snapshot({
        ...generated,
        graphId: `other-${generated.graphId}`,
        revisionId: `other-${generated.revisionId}`,
        parentRevisionId: generated.parentRevisionId ? `other-${generated.parentRevisionId}` : 'other-parent',
        nodes: shuffle(rng, generated.nodes),
        edges: shuffle(rng, generated.edges),
        relationVocabulary: shuffle(rng, generated.relationVocabulary),
      });
      expect(graphDigest(generated), `graph ${i}`).toBe(graphDigest(shuffled));
    }
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function randomSnapshot(rng: () => number): PGSnapshot {
  const nodeCount = randInt(rng, 2, 8);
  const nodes: PGNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(node(`n${i}`, {
      type: pick(rng, ['ACTION', 'SKILL', 'REASONING', 'STATE'] as const),
      description: `desc-${i}-${randInt(rng, 0, 99)}`,
      ...(rng() < 0.3 ? { actionName: `tool_${i}` } : {}),
    }));
  }
  const seen = new Set<string>();
  const edges: PGEdge[] = [];
  const edgeCount = randInt(rng, 1, nodeCount + 3);
  for (let i = 0; i < edgeCount; i++) {
    const source = pick(rng, nodes).id;
    const target = pick(rng, nodes).id;
    const relation = pick(rng, PG_BUILT_IN_RELATIONS);
    const key = `${source}\0${relation}\0${target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push(edge(source, target, {
      relation,
      condition: rng() < 0.5 ? null : `cond-${i}`,
      guidance: rng() < 0.2 ? null : `g-${i}`,
      pitfalls: rng() < 0.2 ? null : `p-${i}`,
    }));
  }
  if (edges.length === 0) {
    edges.push(edge(nodes[0]!.id, nodes[nodes.length - 1]!.id));
  }
  return snapshot({
    graphId: `g-${randInt(rng, 0, 9999)}`,
    revisionId: `r-${randInt(rng, 0, 9999)}`,
    parentRevisionId: rng() < 0.5 ? `p-${randInt(rng, 0, 99)}` : undefined,
    entryNodeId: nodes[0]!.id,
    cyclePolicy: pick(rng, ['allow', 'repair', 'reject'] as const),
    nodes,
    edges,
  });
}
