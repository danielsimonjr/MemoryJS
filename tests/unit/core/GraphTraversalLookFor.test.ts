/**
 * GraphTraversal LookFor + findPathWithin Unit Tests
 *
 * R7: NL-guided neighbor retrieval via `lookFor` on getNeighborsWithRelations.
 * R2: depth-bounded shortest-path lookup via findPathWithin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GraphTraversal lookFor and findPathWithin', () => {
  let tempDir: string;
  let storage: GraphStorage;
  let traversal: GraphTraversal;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-traversal-lookfor-test-'));
    storage = new GraphStorage(path.join(tempDir, 'memory.jsonl'));

    // Hub with two differently-flavored neighbors, plus a chain for path tests:
    // Hub -> DbExpert ('knows'), Hub -> Chef ('knows')
    // A -> B -> C -> D chain
    const graph = {
      entities: [
        { name: 'Hub', entityType: 'person', observations: ['Central connector'] },
        { name: 'DbExpert', entityType: 'person', observations: ['enjoys database engineering and storage systems'] },
        { name: 'Chef', entityType: 'person', observations: ['paints landscapes and collects cooking recipes'] },
        { name: 'A', entityType: 'node', observations: ['Start'] },
        { name: 'B', entityType: 'node', observations: ['Second'] },
        { name: 'C', entityType: 'node', observations: ['Third'] },
        { name: 'D', entityType: 'node', observations: ['End'] },
      ],
      relations: [
        { from: 'Hub', to: 'DbExpert', relationType: 'knows' },
        { from: 'Hub', to: 'Chef', relationType: 'knows' },
        { from: 'A', to: 'B', relationType: 'connects' },
        { from: 'B', to: 'C', relationType: 'connects' },
        { from: 'C', to: 'D', relationType: 'connects' },
      ],
    };
    await storage.saveGraph(graph);
    await storage.loadGraph();
    traversal = new GraphTraversal(storage);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getNeighborsWithRelations lookFor (R7)', () => {
    it('stays synchronous and unchanged without lookFor', () => {
      const neighbors = traversal.getNeighborsWithRelations('Hub');

      expect(Array.isArray(neighbors)).toBe(true); // not a Promise
      expect(neighbors).toHaveLength(2);
      for (const entry of neighbors) {
        expect('lookForScore' in entry).toBe(false);
      }
    });

    it('ranks neighbors by lexical token overlap when no similarity fn is given', async () => {
      const ranked = await traversal.getNeighborsWithRelations('Hub', {
        lookFor: 'database storage systems',
      });

      expect(ranked).toHaveLength(2);
      expect(ranked[0].neighbor).toBe('DbExpert');
      expect(ranked[1].neighbor).toBe('Chef');
      expect(ranked[0].lookForScore!).toBeGreaterThan(ranked[1].lookForScore!);
      expect(ranked[1].lookForScore).toBe(0);
      // Same shape as the plain variant, plus the score
      expect(ranked[0].relation).toEqual({ from: 'Hub', to: 'DbExpert', relationType: 'knows' });
    });

    it('ranks neighbors with a provided async similarity fn', async () => {
      const calculateSimilarity = vi.fn(async (_lookFor: string, descriptor: string) =>
        descriptor.includes('Chef') ? 0.9 : 0.1
      );

      const ranked = await traversal.getNeighborsWithRelations('Hub', {
        lookFor: 'someone who cooks',
        semanticSearch: { calculateSimilarity },
      });

      expect(calculateSimilarity).toHaveBeenCalledTimes(2);
      expect(ranked[0].neighbor).toBe('Chef');
      expect(ranked[0].lookForScore).toBeCloseTo(0.9);
      expect(ranked[1].neighbor).toBe('DbExpert');
      expect(ranked[1].lookForScore).toBeCloseTo(0.1);
    });

    it('supports a synchronous similarity fn (structural surface)', async () => {
      const ranked = await traversal.getNeighborsWithRelations('Hub', {
        lookFor: 'databases',
        semanticSearch: {
          calculateSimilarity: (_a: string, b: string) => (b.includes('DbExpert') ? 1 : 0),
        },
      });

      expect(ranked[0].neighbor).toBe('DbExpert');
      expect(ranked[0].lookForScore).toBe(1);
    });

    it('builds descriptors from name + relationType + leading observations', async () => {
      const descriptors: string[] = [];
      await traversal.getNeighborsWithRelations('Hub', {
        lookFor: 'anything',
        semanticSearch: {
          calculateSimilarity: (_a: string, b: string) => {
            descriptors.push(b);
            return 0;
          },
        },
      });

      const dbDescriptor = descriptors.find(d => d.startsWith('DbExpert'))!;
      expect(dbDescriptor).toContain('knows'); // relation type
      expect(dbDescriptor).toContain('database engineering'); // observation text
    });

    it('still honors traversal filters (direction, relationTypes) under lookFor', async () => {
      const ranked = await traversal.getNeighborsWithRelations('B', {
        direction: 'outgoing',
        lookFor: 'third node',
      });

      expect(ranked).toHaveLength(1);
      expect(ranked[0].neighbor).toBe('C');
    });

    it('returns an empty ranked array for an entity with no neighbors', async () => {
      const ranked = await traversal.getNeighborsWithRelations('D', {
        direction: 'outgoing',
        lookFor: 'anything',
      });

      expect(ranked).toEqual([]);
    });
  });

  describe('findPathWithin (R2)', () => {
    it('finds a path within the depth cap', async () => {
      const result = await traversal.findPathWithin('A', 'D', 3);

      expect(result).not.toBeNull();
      expect(result!.path).toEqual(['A', 'B', 'C', 'D']);
      expect(result!.length).toBe(3);
      expect(result!.relations).toHaveLength(3);
      // Endpoints chain through the relations
      result!.relations.forEach((rel, i) => {
        const a = result!.path[i];
        const b = result!.path[i + 1];
        expect((rel.from === a && rel.to === b) || (rel.from === b && rel.to === a)).toBe(true);
      });
    });

    it('returns null when the only path exceeds maxDepth', async () => {
      expect(await traversal.findPathWithin('A', 'D', 2)).toBeNull();
    });

    it('matches findShortestPath for reachable pairs within the cap', async () => {
      const bounded = await traversal.findPathWithin('A', 'C', 3);
      const unbounded = await traversal.findShortestPath('A', 'C');

      expect(bounded).toEqual(unbounded);
    });

    it('returns a trivial path for source === target', async () => {
      const result = await traversal.findPathWithin('A', 'A', 3);

      expect(result).toEqual({ path: ['A'], length: 0, relations: [] });
    });

    it('returns null for unknown entities and for maxDepth < 1', async () => {
      expect(await traversal.findPathWithin('A', 'Nope', 3)).toBeNull();
      expect(await traversal.findPathWithin('Nope', 'A', 3)).toBeNull();
      expect(await traversal.findPathWithin('A', 'B', 0)).toBeNull();
    });

    it('respects direction options', async () => {
      // D -> A against edge direction: unreachable with outgoing-only traversal
      expect(await traversal.findPathWithin('D', 'A', 3, { direction: 'outgoing' })).toBeNull();
      expect(await traversal.findPathWithin('D', 'A', 3)).not.toBeNull();
    });
  });
});
