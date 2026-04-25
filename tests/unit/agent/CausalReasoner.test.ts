/**
 * 3B.6 — CausalReasoner Tests
 *
 * Verifies findCauses / findEffects / counterfactual / detectCycles
 * via a hand-built in-memory mock of GraphTraversal that supports
 * findAllPaths and getNeighborsWithRelations with relationType filtering.
 */

import { describe, it, expect } from 'vitest';
import type { GraphTraversal, PathResult } from '../../../src/core/GraphTraversal.js';
import type { Relation } from '../../../src/types/index.js';
import { CausalReasoner } from '../../../src/agent/causal/CausalReasoner.js';

// ==================== Mock GraphTraversal ====================

interface FakeRel {
  from: string;
  to: string;
  relationType: string;
  causalStrength?: number;
}

function makeRelation(r: FakeRel): Relation {
  return {
    from: r.from,
    to: r.to,
    relationType: r.relationType,
    metadata: r.causalStrength !== undefined
      ? { causalStrength: r.causalStrength }
      : undefined,
  };
}

/**
 * Build a tiny mock GraphTraversal from a flat relations list. Supports
 * the two methods CausalReasoner uses: findAllPaths and
 * getNeighborsWithRelations. Implements the relationTypes filter.
 */
function makeMockTraversal(rels: FakeRel[]): GraphTraversal {
  const relations = rels.map(makeRelation);

  const neighborsOf = (node: string, allowedTypes?: ReadonlyArray<string>): Array<{ neighbor: string; relation: Relation }> => {
    return relations
      .filter(r => r.from === node)
      .filter(r => !allowedTypes || allowedTypes.length === 0 || allowedTypes.includes(r.relationType))
      .map(r => ({ neighbor: r.to, relation: r }));
  };

  const findAllPaths = async (
    source: string,
    target: string,
    maxDepth: number,
    options?: { relationTypes?: string[] },
  ): Promise<PathResult[]> => {
    const allowed = options?.relationTypes;
    const out: PathResult[] = [];
    const path: string[] = [source];
    const rels: Relation[] = [];
    const visited = new Set<string>([source]);
    const dfs = (node: string, depth: number) => {
      if (depth > maxDepth) return;
      if (node === target && depth > 0) {
        out.push({ path: [...path], relations: [...rels], length: path.length - 1 });
        return;
      }
      for (const { neighbor, relation } of neighborsOf(node, allowed)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        path.push(neighbor);
        rels.push(relation);
        dfs(neighbor, depth + 1);
        path.pop();
        rels.pop();
        visited.delete(neighbor);
      }
    };
    dfs(source, 0);
    return out;
  };

  return {
    findAllPaths,
    getNeighborsWithRelations: (node: string, opts: { relationTypes?: string[]; direction?: string } = {}) => {
      // Only 'outgoing' is used by CausalReasoner.detectCycles
      return neighborsOf(node, opts.relationTypes);
    },
  } as unknown as GraphTraversal;
}

// ==================== Tests ====================

describe('3B.6 CausalReasoner', () => {
  describe('findEffects', () => {
    it('finds a direct one-hop chain along a `causes` edge', async () => {
      const traversal = makeMockTraversal([
        { from: 'rain', to: 'wet', relationType: 'causes', causalStrength: 0.9 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findEffects('rain', ['wet']);
      expect(chains).toHaveLength(1);
      expect(chains[0].path).toEqual(['rain', 'wet']);
      expect(chains[0].score).toBeCloseTo(0.9);
      expect(chains[0].length).toBe(1);
    });

    it('multiplies causalStrength along a multi-hop chain', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes', causalStrength: 0.8 },
        { from: 'b', to: 'c', relationType: 'enables', causalStrength: 0.5 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findEffects('a', ['c']);
      expect(chains).toHaveLength(1);
      expect(chains[0].score).toBeCloseTo(0.4); // 0.8 * 0.5
    });

    it('treats missing causalStrength as 1.0', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes' },
        { from: 'b', to: 'c', relationType: 'causes' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findEffects('a', ['c']);
      expect(chains[0].score).toBe(1);
    });

    it('ignores non-causal relation types', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'mentions' }, // not causal
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findEffects('a', ['b']);
      expect(chains).toHaveLength(0);
    });

    it('sorts results by score descending', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes', causalStrength: 0.9 },
        { from: 'a', to: 'c', relationType: 'causes', causalStrength: 0.4 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findEffects('a', ['b', 'c']);
      expect(chains[0].path[1]).toBe('b');
      expect(chains[1].path[1]).toBe('c');
    });
  });

  describe('findCauses', () => {
    it('finds a chain ending at the named effect', async () => {
      const traversal = makeMockTraversal([
        { from: 'spark', to: 'fire', relationType: 'causes', causalStrength: 0.7 },
        { from: 'fuel', to: 'fire', relationType: 'enables', causalStrength: 0.6 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findCauses('fire', ['spark', 'fuel']);
      expect(chains).toHaveLength(2);
      // Sorted descending by score
      expect(chains[0].score).toBeCloseTo(0.7);
      expect(chains[1].score).toBeCloseTo(0.6);
    });

    it('returns empty array when no candidate cause has a causal path', async () => {
      const traversal = makeMockTraversal([]);
      const reasoner = new CausalReasoner(traversal);
      const chains = await reasoner.findCauses('fire', ['unrelated']);
      expect(chains).toEqual([]);
    });
  });

  describe('counterfactual', () => {
    it('returns chains that survive removal of the named edge', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes', causalStrength: 0.9 },
        { from: 'a', to: 'c', relationType: 'causes', causalStrength: 0.5 },
        { from: 'c', to: 'b', relationType: 'causes', causalStrength: 0.4 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      // Remove the direct a→b edge — surviving chain must route via c.
      const surviving = await reasoner.counterfactual({
        seed: 'a', removeFrom: 'a', removeTo: 'b', predict: 'b',
      });
      expect(surviving).toHaveLength(1);
      expect(surviving[0].path).toEqual(['a', 'c', 'b']);
      // Score = 0.5 * 0.4 = 0.2
      expect(surviving[0].score).toBeCloseTo(0.2);
    });

    it('returns empty array when removing the only path', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes', causalStrength: 0.9 },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const surviving = await reasoner.counterfactual({
        seed: 'a', removeFrom: 'a', removeTo: 'b', predict: 'b',
      });
      expect(surviving).toEqual([]);
    });

    it('does not mutate the underlying graph', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes' },
        { from: 'a', to: 'c', relationType: 'causes' },
        { from: 'c', to: 'b', relationType: 'causes' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      // Run counterfactual.
      await reasoner.counterfactual({
        seed: 'a', removeFrom: 'a', removeTo: 'b', predict: 'b',
      });
      // Original findEffects should still see all three paths.
      const allChains = await reasoner.findEffects('a', ['b']);
      expect(allChains.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('detectCycles', () => {
    it('finds a simple 3-node cycle', () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes' },
        { from: 'b', to: 'c', relationType: 'causes' },
        { from: 'c', to: 'a', relationType: 'causes' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const cycles = reasoner.detectCycles('a');
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      expect(cycles[0].cycle).toEqual(['a', 'b', 'c', 'a']);
    });

    it('returns empty array when no cycles exist', () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes' },
        { from: 'b', to: 'c', relationType: 'causes' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      expect(reasoner.detectCycles('a')).toEqual([]);
    });

    it('treats prevents as a directed edge (per documented caveat)', () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'prevents' },
        { from: 'b', to: 'a', relationType: 'enables' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      const cycles = reasoner.detectCycles('a');
      // prevents+enables triangle is detected as a cycle (correct per JSDoc).
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });

    it('respects maxDepth cutoff', () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'causes' },
        { from: 'b', to: 'c', relationType: 'causes' },
        { from: 'c', to: 'd', relationType: 'causes' },
        { from: 'd', to: 'a', relationType: 'causes' },
      ]);
      const reasoner = new CausalReasoner(traversal);
      // Cycle is 4-deep; with maxDepth=2 it should not be discovered.
      expect(reasoner.detectCycles('a', 2)).toHaveLength(0);
      // With sufficient depth, found.
      expect(reasoner.detectCycles('a', 6).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('configuration', () => {
    it('respects a custom causalTypes set', async () => {
      const traversal = makeMockTraversal([
        { from: 'a', to: 'b', relationType: 'leads_to', causalStrength: 0.8 },
      ]);
      const reasoner = new CausalReasoner(traversal, { causalTypes: ['leads_to'] });
      const chains = await reasoner.findEffects('a', ['b']);
      expect(chains).toHaveLength(1);
      expect(chains[0].score).toBeCloseTo(0.8);
    });
  });
});
