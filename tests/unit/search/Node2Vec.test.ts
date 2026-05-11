/**
 * Node2Vec Unit Tests
 *
 * Covers Phase 5 step 50: biased random walks + Skip-Gram trainer.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  BiasedRandomWalk,
  computeNode2Vec,
  similarity,
  topKSimilar,
} from '../../../src/search/Node2Vec.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../src/types/types.js';

function chainGraph(n: number): KnowledgeGraph {
  const entities: Entity[] = Array.from({ length: n }, (_, i) => ({
    name: `n${i}`,
    entityType: 'node',
    observations: [],
  }));
  const relations: Relation[] = [];
  for (let i = 0; i < n - 1; i++) {
    relations.push({ from: `n${i}`, to: `n${i + 1}`, relationType: 'next' });
  }
  return { entities, relations };
}

function twoClusterGraph(): KnowledgeGraph {
  // Cluster A: a1-a2-a3-a4 fully connected
  // Cluster B: b1-b2-b3-b4 fully connected
  // Single bridge a4 -> b1
  const entities: Entity[] = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'].map((n) => ({
    name: n,
    entityType: 'node',
    observations: [],
  }));
  const relations: Relation[] = [];
  const a = ['a1', 'a2', 'a3', 'a4'];
  const b = ['b1', 'b2', 'b3', 'b4'];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      relations.push({ from: a[i]!, to: a[j]!, relationType: 'link' });
    }
  }
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      relations.push({ from: b[i]!, to: b[j]!, relationType: 'link' });
    }
  }
  relations.push({ from: 'a4', to: 'b1', relationType: 'bridge' });
  return { entities, relations };
}

describe('buildAdjacency', () => {
  it('builds undirected adjacency by default', () => {
    const graph = chainGraph(3);
    const adj = buildAdjacency(graph.entities, graph.relations);
    expect(adj.get('n0')).toContain('n1');
    expect(adj.get('n1')).toContain('n0');
    expect(adj.get('n1')).toContain('n2');
  });

  it('respects undirected=false', () => {
    const graph = chainGraph(3);
    const adj = buildAdjacency(graph.entities, graph.relations, false);
    expect(adj.get('n0')).toContain('n1');
    expect(adj.get('n1')).not.toContain('n0');
  });
});

describe('BiasedRandomWalk', () => {
  it('walk respects requested length on a chain (cycles back via undirected)', () => {
    const graph = chainGraph(5);
    const adj = buildAdjacency(graph.entities, graph.relations);
    const walker = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(42));
    const walk = walker.walk('n0', 10);
    expect(walk.length).toBeGreaterThan(1);
    expect(walk[0]).toBe('n0');
    expect(walk.every((n) => /^n\d+$/.test(n))).toBe(true);
  });

  it('walk stops early on a dead-end (directed)', () => {
    const graph: KnowledgeGraph = {
      entities: [{ name: 'a', entityType: 'x', observations: [] }],
      relations: [],
    };
    const adj = buildAdjacency(graph.entities, graph.relations, false);
    const walker = new BiasedRandomWalk(adj, 1, 1, () => 0.5);
    const walk = walker.walk('a', 10);
    expect(walk).toEqual(['a']);
  });

  it('p << 1 biases walks toward returning to the source (more revisits)', () => {
    const graph = twoClusterGraph();
    const adj = buildAdjacency(graph.entities, graph.relations);

    const lowP = new BiasedRandomWalk(adj, 0.01, 1, makeSeededRng(11));
    const highP = new BiasedRandomWalk(adj, 100, 1, makeSeededRng(11));

    const lowPwalk = lowP.walk('a1', 40);
    const highPwalk = highP.walk('a1', 40);

    expect(uniqueCount(lowPwalk)).toBeLessThan(uniqueCount(highPwalk));
  });

  it('generateAll produces numWalks × |nodes| walks', () => {
    const graph = chainGraph(4);
    const adj = buildAdjacency(graph.entities, graph.relations);
    const walker = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(7));
    const walks = walker.generateAll(5, 3);
    expect(walks).toHaveLength(4 * 3);
  });

  it('is deterministic with a seed', () => {
    const graph = twoClusterGraph();
    const adj = buildAdjacency(graph.entities, graph.relations);
    const w1 = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(99)).walk('a1', 15);
    const w2 = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(99)).walk('a1', 15);
    expect(w1).toEqual(w2);
  });

  it('walkLength=1 returns just the start node', () => {
    const graph = chainGraph(5);
    const adj = buildAdjacency(graph.entities, graph.relations);
    const walker = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(0));
    expect(walker.walk('n0', 1)).toEqual(['n0']);
  });

  it('isolated node produces a length-1 walk (no neighbors)', () => {
    const graph: KnowledgeGraph = {
      entities: [
        { name: 'lonely', entityType: 'x', observations: [] },
        { name: 'other', entityType: 'x', observations: [] },
      ],
      relations: [],
    };
    const adj = buildAdjacency(graph.entities, graph.relations);
    const walker = new BiasedRandomWalk(adj, 1, 1, makeSeededRng(1));
    expect(walker.walk('lonely', 10)).toEqual(['lonely']);
  });
});

describe('computeNode2Vec', () => {
  it('produces an embedding for every node with at least one edge', () => {
    const graph = twoClusterGraph();
    const result = computeNode2Vec(graph, {
      dimensions: 16,
      walkLength: 10,
      numWalks: 5,
      epochs: 2,
      seed: 123,
    });
    expect(result.embeddings.size).toBe(8);
    for (const [, vec] of result.embeddings) {
      expect(vec.length).toBe(16);
    }
  });

  it('embeddings are L2-normalized (unit length)', () => {
    const graph = chainGraph(5);
    const result = computeNode2Vec(graph, {
      dimensions: 8,
      walkLength: 6,
      numWalks: 3,
      epochs: 2,
      seed: 7,
    });
    for (const vec of result.embeddings.values()) {
      const norm = Math.sqrt([...vec].reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    }
  });

  it('captures cluster structure — same-cluster pairs > cross-cluster pairs (avg)', () => {
    const graph = twoClusterGraph();
    const result = computeNode2Vec(graph, {
      dimensions: 32,
      walkLength: 20,
      numWalks: 30,
      epochs: 8,
      window: 5,
      seed: 314,
    });

    const a1 = result.embeddings.get('a1')!;
    const a2 = result.embeddings.get('a2')!;
    const a3 = result.embeddings.get('a3')!;
    const b2 = result.embeddings.get('b2')!;
    const b3 = result.embeddings.get('b3')!;

    const sameClusterAvg =
      (similarity(a1, a2) + similarity(a1, a3) + similarity(b2, b3)) / 3;
    const crossClusterAvg =
      (similarity(a1, b2) + similarity(a1, b3) + similarity(a2, b3)) / 3;

    expect(sameClusterAvg).toBeGreaterThan(crossClusterAvg);
  });

  it('is deterministic with a seed', () => {
    const graph = twoClusterGraph();
    const r1 = computeNode2Vec(graph, { dimensions: 8, seed: 42, epochs: 1, numWalks: 2, walkLength: 5 });
    const r2 = computeNode2Vec(graph, { dimensions: 8, seed: 42, epochs: 1, numWalks: 2, walkLength: 5 });

    for (const [name, v1] of r1.embeddings) {
      const v2 = r2.embeddings.get(name)!;
      expect([...v1]).toEqual([...v2]);
    }
  });

  it('handles an empty graph', () => {
    const result = computeNode2Vec({ entities: [], relations: [] });
    expect(result.embeddings.size).toBe(0);
    expect(result.vocabulary).toEqual([]);
  });
});

describe('topKSimilar', () => {
  it('ranks neighbors by similarity, excludes self', () => {
    const graph = twoClusterGraph();
    const result = computeNode2Vec(graph, {
      dimensions: 16,
      walkLength: 15,
      numWalks: 15,
      epochs: 5,
      seed: 1,
    });
    const a1 = result.embeddings.get('a1')!;
    const top = topKSimilar(a1, result.embeddings, 3, new Set(['a1']));
    expect(top).toHaveLength(3);
    expect(top[0]!.score).toBeGreaterThanOrEqual(top[1]!.score);
    expect(top[1]!.score).toBeGreaterThanOrEqual(top[2]!.score);
    expect(top.every((t) => t.name !== 'a1')).toBe(true);
  });
});

function uniqueCount(arr: string[]): number {
  return new Set(arr).size;
}

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
