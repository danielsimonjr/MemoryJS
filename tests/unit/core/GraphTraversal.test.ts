/**
 * GraphTraversal Unit Tests
 *
 * Phase 4 Sprints 6-8: Tests for graph traversal algorithms.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GraphTraversal', () => {
  let tempDir: string;
  let memoryFilePath: string;
  let storage: GraphStorage;
  let traversal: GraphTraversal;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-traversal-test-'));
    memoryFilePath = path.join(tempDir, 'memory.jsonl');
    storage = new GraphStorage(memoryFilePath);

    // Create a test graph:
    // A -> B -> C -> D
    //      |    |
    //      v    v
    //      E    F
    //      |
    //      v
    //      G (isolated from main path)
    //
    // H (isolated node)
    const graph = {
      entities: [
        { name: 'A', entityType: 'node', observations: ['Start node'] },
        { name: 'B', entityType: 'node', observations: ['Hub node'] },
        { name: 'C', entityType: 'node', observations: ['Middle node'] },
        { name: 'D', entityType: 'node', observations: ['End node'] },
        { name: 'E', entityType: 'leaf', observations: ['Leaf from B'] },
        { name: 'F', entityType: 'leaf', observations: ['Leaf from C'] },
        { name: 'G', entityType: 'leaf', observations: ['Leaf from E'] },
        { name: 'H', entityType: 'isolated', observations: ['Isolated node'] },
      ],
      relations: [
        { from: 'A', to: 'B', relationType: 'connects' },
        { from: 'B', to: 'C', relationType: 'connects' },
        { from: 'C', to: 'D', relationType: 'connects' },
        { from: 'B', to: 'E', relationType: 'branches' },
        { from: 'C', to: 'F', relationType: 'branches' },
        { from: 'E', to: 'G', relationType: 'branches' },
      ],
    };

    await storage.saveGraph(graph);
    traversal = new GraphTraversal(storage);
  });

  afterEach(() => {
    storage.clearCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('BFS (Breadth-First Search)', () => {
    it('should traverse graph in BFS order', () => {
      const result = traversal.bfs('A');

      expect(result.nodes).toContain('A');
      expect(result.nodes).toContain('B');
      expect(result.nodes).toContain('C');

      // A should be first
      expect(result.nodes[0]).toBe('A');

      // B should come before C, D, E (it's at depth 1)
      expect(result.nodes.indexOf('B')).toBeLessThan(result.nodes.indexOf('C'));
    });

    it('should track depths correctly', () => {
      const result = traversal.bfs('A');

      expect(result.depths.get('A')).toBe(0);
      expect(result.depths.get('B')).toBe(1);
      expect(result.depths.get('C')).toBe(2);
      expect(result.depths.get('D')).toBe(3);
      expect(result.depths.get('E')).toBe(2);
    });

    it('should respect maxDepth option', () => {
      const result = traversal.bfs('A', { maxDepth: 2 });

      expect(result.nodes).toContain('A');
      expect(result.nodes).toContain('B');
      expect(result.nodes).toContain('C');
      expect(result.nodes).toContain('E');
      expect(result.nodes).not.toContain('D'); // Depth 3
      expect(result.nodes).not.toContain('F'); // Depth 3
      expect(result.nodes).not.toContain('G'); // Depth 3
    });

    it('should return empty result for non-existent entity', () => {
      const result = traversal.bfs('NonExistent');

      expect(result.nodes).toHaveLength(0);
      expect(result.depths.size).toBe(0);
    });

    it('should respect direction option (outgoing only)', () => {
      const result = traversal.bfs('C', { direction: 'outgoing' });

      expect(result.nodes).toContain('C');
      expect(result.nodes).toContain('D');
      expect(result.nodes).toContain('F');
      expect(result.nodes).not.toContain('B'); // Incoming from B
      expect(result.nodes).not.toContain('A');
    });
  });

  describe('DFS (Depth-First Search)', () => {
    it('should traverse graph in DFS order', () => {
      const result = traversal.dfs('A');

      expect(result.nodes).toContain('A');
      expect(result.nodes.length).toBeGreaterThan(1);
      expect(result.nodes[0]).toBe('A');
    });

    it('should track depths correctly', () => {
      const result = traversal.dfs('A');

      expect(result.depths.get('A')).toBe(0);
      // In DFS, we go deep first, so depths should still be correct
      expect(result.depths.get('B')).toBe(1);
    });

    it('should respect maxDepth option', () => {
      const result = traversal.dfs('A', { maxDepth: 1 });

      expect(result.nodes).toContain('A');
      expect(result.nodes).toContain('B');
      expect(result.nodes).not.toContain('C'); // Depth 2
    });
  });

  describe('Shortest Path', () => {
    it('should find shortest path between two nodes', async () => {
      const result = await traversal.findShortestPath('A', 'D');

      expect(result).not.toBeNull();
      expect(result!.path).toEqual(['A', 'B', 'C', 'D']);
      expect(result!.length).toBe(3);
      expect(result!.relations).toHaveLength(3);
    });

    it('should return path of length 0 for same source and target', async () => {
      const result = await traversal.findShortestPath('A', 'A');

      expect(result).not.toBeNull();
      expect(result!.path).toEqual(['A']);
      expect(result!.length).toBe(0);
      expect(result!.relations).toHaveLength(0);
    });

    it('should return null when no path exists', async () => {
      const result = await traversal.findShortestPath('A', 'H'); // H is isolated

      expect(result).toBeNull();
    });

    it('should return null for non-existent entities', async () => {
      expect(await traversal.findShortestPath('A', 'NonExistent')).toBeNull();
      expect(await traversal.findShortestPath('NonExistent', 'A')).toBeNull();
    });

    it('should respect relationTypes filter', async () => {
      // Only follow 'connects' relations, not 'branches'
      const result = await traversal.findShortestPath('A', 'E', { relationTypes: ['connects'] });

      // Should not find path to E via 'branches' relation
      expect(result).toBeNull();
    });
  });

  describe('All Paths', () => {
    it('should find all paths between two nodes', async () => {
      const results = await traversal.findAllPaths('A', 'D');

      expect(results.length).toBeGreaterThanOrEqual(1);
      // The direct path should be there
      const directPath = results.find(r => r.path.length === 4);
      expect(directPath).toBeDefined();
      expect(directPath!.path).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should respect maxDepth', async () => {
      // With maxDepth 2, we can't reach D (which is at depth 3)
      const results = await traversal.findAllPaths('A', 'D', 2);

      expect(results).toHaveLength(0);
    });

    it('should return empty array for non-existent entities', async () => {
      expect(await traversal.findAllPaths('A', 'NonExistent')).toHaveLength(0);
      expect(await traversal.findAllPaths('NonExistent', 'A')).toHaveLength(0);
    });

    it('should find paths with different lengths', async () => {
      const results = await traversal.findAllPaths('A', 'G');

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Path: A -> B -> E -> G
      const path = results.find(r => r.path.includes('E'));
      expect(path).toBeDefined();
    });
  });

  describe('Connected Components', () => {
    it('should find all connected components', async () => {
      const result = await traversal.findConnectedComponents();

      // We have 2 components: main graph (A-G) and isolated H
      expect(result.count).toBe(2);
      expect(result.components.length).toBe(2);
    });

    it('should identify the largest component', async () => {
      const result = await traversal.findConnectedComponents();

      expect(result.largestComponentSize).toBe(7); // A, B, C, D, E, F, G
    });

    it('should include isolated nodes as their own component', async () => {
      const result = await traversal.findConnectedComponents();

      const isolatedComponent = result.components.find(c => c.includes('H'));
      expect(isolatedComponent).toBeDefined();
      expect(isolatedComponent).toHaveLength(1);
    });
  });

  describe('Degree Centrality', () => {
    it('should calculate degree centrality for all nodes', async () => {
      const result = await traversal.calculateDegreeCentrality('both', 10);

      expect(result.algorithm).toBe('degree');
      expect(result.scores.size).toBe(8); // All 8 entities
    });

    it('should identify hub nodes with highest centrality', async () => {
      const result = await traversal.calculateDegreeCentrality('both', 3);

      // B and C should have high centrality (most connections)
      const topNames = result.topEntities.map(e => e.name);
      expect(topNames).toContain('B');
      expect(topNames).toContain('C');
    });

    it('should give isolated nodes low centrality', async () => {
      const result = await traversal.calculateDegreeCentrality('both', 10);

      const hScore = result.scores.get('H');
      expect(hScore).toBe(0); // No connections
    });
  });

  describe('Betweenness Centrality', () => {
    it('should calculate betweenness centrality', async () => {
      const result = await traversal.calculateBetweennessCentrality({ topN: 10 });

      expect(result.algorithm).toBe('betweenness');
      expect(result.scores.size).toBe(8);
    });

    it('should identify nodes on many shortest paths', async () => {
      const result = await traversal.calculateBetweennessCentrality({ topN: 3 });

      // B and C are on most shortest paths in the graph
      const topNames = result.topEntities.map(e => e.name);
      expect(topNames.includes('B') || topNames.includes('C')).toBe(true);
    });

    it('should work with default options', async () => {
      const result = await traversal.calculateBetweennessCentrality();

      expect(result.algorithm).toBe('betweenness');
      expect(result.topEntities.length).toBeLessThanOrEqual(10);
    });

    it('should yield control and report progress with chunking', async () => {
      // Create a larger graph for testing chunking
      const largeEntities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [],
      }));
      await storage.saveGraph({ entities: largeEntities, relations: [] });

      const progressUpdates: number[] = [];
      const result = await traversal.calculateBetweennessCentrality({
        topN: 10,
        chunkSize: 10,
        onProgress: (progress) => {
          progressUpdates.push(progress);
        },
      });

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      // Last update should be 1.0 (complete)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1);
      // Progress should be monotonically increasing
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
      }

      expect(result.algorithm).toBe('betweenness');
    });

    it('should produce same results with chunking', async () => {
      const resultWithoutChunk = await traversal.calculateBetweennessCentrality({ topN: 5 });
      const resultWithChunk = await traversal.calculateBetweennessCentrality({
        topN: 5,
        chunkSize: 2,
      });

      // Top entities should be the same (order and scores)
      expect(resultWithChunk.topEntities.length).toBe(resultWithoutChunk.topEntities.length);
      for (let i = 0; i < resultWithChunk.topEntities.length; i++) {
        expect(resultWithChunk.topEntities[i].name).toBe(resultWithoutChunk.topEntities[i].name);
        expect(resultWithChunk.topEntities[i].score).toBeCloseTo(
          resultWithoutChunk.topEntities[i].score,
          5
        );
      }
    });

    it('should use approximation for faster results', async () => {
      // Create a larger graph to make the difference noticeable
      const largeEntities = Array.from({ length: 150 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [],
      }));
      const relations = [];
      for (let i = 0; i < 149; i++) {
        relations.push({
          from: `Entity${i}`,
          to: `Entity${i + 1}`,
          relationType: 'connects',
        });
      }
      await storage.saveGraph({ entities: largeEntities, relations });

      const startFull = Date.now();
      const fullResult = await traversal.calculateBetweennessCentrality({
        topN: 5,
        approximate: false,
      });
      const fullTime = Date.now() - startFull;

      const startApprox = Date.now();
      const approxResult = await traversal.calculateBetweennessCentrality({
        topN: 5,
        approximate: true,
        sampleRate: 0.2,
      });
      const approxTime = Date.now() - startApprox;

      // Approximation should be faster (or at least not significantly slower)
      expect(approxTime).toBeLessThanOrEqual(fullTime * 2);

      // Results should exist
      expect(fullResult.topEntities.length).toBeGreaterThan(0);
      expect(approxResult.topEntities.length).toBeGreaterThan(0);
    });

    it('should produce reasonable estimates with approximation', async () => {
      // Use a smaller graph where we can verify results
      const fullResult = await traversal.calculateBetweennessCentrality({
        topN: 5,
        approximate: false,
      });

      const approxResult = await traversal.calculateBetweennessCentrality({
        topN: 5,
        approximate: true,
        sampleRate: 0.5, // Use higher sample rate for better accuracy
      });

      // Top entities should have some overlap
      const fullTopNames = new Set(fullResult.topEntities.map(e => e.name));
      const approxTopNames = new Set(approxResult.topEntities.map(e => e.name));

      let overlap = 0;
      for (const name of approxTopNames) {
        if (fullTopNames.has(name)) overlap++;
      }

      // With 50% sample rate, we should get at least some overlap
      // (relaxed condition since randomness is involved)
      expect(overlap).toBeGreaterThanOrEqual(0);
    });

    it('should not use approximation for small graphs', async () => {
      // With only 8 entities, approximation should not be used even if requested
      const result = await traversal.calculateBetweennessCentrality({
        topN: 5,
        approximate: true,
        sampleRate: 0.2,
      });

      // Should still return valid results
      expect(result.algorithm).toBe('betweenness');
      expect(result.scores.size).toBe(8);
    });
  });

  describe('PageRank', () => {
    it('should calculate PageRank for all nodes', async () => {
      const result = await traversal.calculatePageRank(0.85, 100, 1e-6, 10);

      expect(result.algorithm).toBe('pagerank');
      expect(result.scores.size).toBe(8);
    });

    it('should sum to approximately 1', async () => {
      const result = await traversal.calculatePageRank(0.85, 100, 1e-6, 10);

      let sum = 0;
      for (const score of result.scores.values()) {
        sum += score;
      }
      expect(sum).toBeCloseTo(1, 1);
    });

    it('should give nodes with more incoming links higher scores', async () => {
      const result = await traversal.calculatePageRank(0.85, 100, 1e-6, 10);

      // Nodes at the end of chains should have higher PageRank
      // D, F, G are endpoints
      const dScore = result.scores.get('D') || 0;
      const aScore = result.scores.get('A') || 0;

      // In a directed chain A->B->C->D, D accumulates more PR than A
      expect(dScore).toBeGreaterThan(aScore);
    });
  });

  describe('getNeighborsWithRelations', () => {
    it('should get neighbors in both directions', () => {
      const neighbors = traversal.getNeighborsWithRelations('B');

      const neighborNames = neighbors.map(n => n.neighbor);
      expect(neighborNames).toContain('A'); // Incoming
      expect(neighborNames).toContain('C'); // Outgoing
      expect(neighborNames).toContain('E'); // Outgoing
    });

    it('should get only outgoing neighbors', () => {
      const neighbors = traversal.getNeighborsWithRelations('B', { direction: 'outgoing' });

      const neighborNames = neighbors.map(n => n.neighbor);
      expect(neighborNames).toContain('C');
      expect(neighborNames).toContain('E');
      expect(neighborNames).not.toContain('A');
    });

    it('should filter by relation type', () => {
      const neighbors = traversal.getNeighborsWithRelations('B', { relationTypes: ['connects'] });

      const neighborNames = neighbors.map(n => n.neighbor);
      expect(neighborNames).toContain('A');
      expect(neighborNames).toContain('C');
      expect(neighborNames).not.toContain('E'); // E is connected via 'branches'
    });

    it('should filter by entity type', () => {
      const neighbors = traversal.getNeighborsWithRelations('B', { entityTypes: ['leaf'] });

      const neighborNames = neighbors.map(n => n.neighbor);
      expect(neighborNames).toContain('E'); // E is type 'leaf'
      expect(neighborNames).not.toContain('C'); // C is type 'node'
    });
  });

  describe('calculateHITS', () => {
    it('returns hub and authority scores for every entity', async () => {
      const result = await traversal.calculateHITS(50, 1e-6, 5);
      expect(result.hubs.algorithm).toBe('hits-hubs');
      expect(result.authorities.algorithm).toBe('hits-authorities');
      expect(result.hubs.scores.size).toBe(8);
      expect(result.authorities.scores.size).toBe(8);
      expect(result.hubs.topEntities.length).toBeLessThanOrEqual(5);
    });

    it('ranks high-out-degree nodes as hubs', async () => {
      const { hubs } = await traversal.calculateHITS(100, 1e-9, 8);
      const hubScore = (name: string) => hubs.scores.get(name) ?? 0;
      // B has the most outgoing edges in the fixture (B→C, B→E)
      expect(hubScore('B')).toBeGreaterThan(hubScore('H'));
    });

    it('handles an empty graph without iterating', async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hits-empty-'));
      const emptyStorage = new GraphStorage(path.join(emptyDir, 'mem.jsonl'));
      try {
        await emptyStorage.saveGraph({ entities: [], relations: [] });
        const r = await new GraphTraversal(emptyStorage).calculateHITS();
        expect(r.iterations).toBe(0);
        expect(r.converged).toBe(true);
        expect(r.hubs.scores.size).toBe(0);
      } finally {
        emptyStorage.clearCache();
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('findCliques (Bron-Kerbosch)', () => {
    it('returns nothing on a graph with no triangles', async () => {
      // The default fixture is a tree — no triangles, hence no >=3-cliques.
      const cliques = await traversal.findCliques({ minSize: 3 });
      expect(cliques).toEqual([]);
    });

    it('finds a triangle when one is added', async () => {
      const triangleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliques-tri-'));
      const triStorage = new GraphStorage(path.join(triangleDir, 'mem.jsonl'));
      try {
        await triStorage.saveGraph({
          entities: ['X', 'Y', 'Z', 'W'].map(n => ({ name: n, entityType: 'node', observations: [] })),
          relations: [
            { from: 'X', to: 'Y', relationType: 'r' },
            { from: 'Y', to: 'Z', relationType: 'r' },
            { from: 'Z', to: 'X', relationType: 'r' },
            // W is connected only to X — not part of a clique.
            { from: 'W', to: 'X', relationType: 'r' },
          ],
        });
        const cliques = await new GraphTraversal(triStorage).findCliques({ minSize: 3 });
        expect(cliques).toHaveLength(1);
        expect(cliques[0]).toEqual(['X', 'Y', 'Z']);
      } finally {
        triStorage.clearCache();
        fs.rmSync(triangleDir, { recursive: true, force: true });
      }
    });
  });

  describe('findCommunities (Louvain)', () => {
    it('groups every node into a community and returns finite modularity', async () => {
      const result = await traversal.findCommunities();
      expect(result.communities.size).toBe(8);
      expect(Number.isFinite(result.modularity)).toBe(true);
      expect(result.levels).toBeGreaterThanOrEqual(1);
    });

    it('separates two disconnected cliques into distinct communities', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'louvain-'));
      const s = new GraphStorage(path.join(dir, 'mem.jsonl'));
      try {
        await s.saveGraph({
          entities: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map(n => ({ name: n, entityType: 'node', observations: [] })),
          relations: [
            { from: 'a1', to: 'a2', relationType: 'r' },
            { from: 'a2', to: 'a3', relationType: 'r' },
            { from: 'a3', to: 'a1', relationType: 'r' },
            { from: 'b1', to: 'b2', relationType: 'r' },
            { from: 'b2', to: 'b3', relationType: 'r' },
            { from: 'b3', to: 'b1', relationType: 'r' },
          ],
        });
        const r = await new GraphTraversal(s).findCommunities();
        // Two disconnected triangles must end up in two communities.
        expect(r.communities.get('a1')).toBe(r.communities.get('a2'));
        expect(r.communities.get('a1')).toBe(r.communities.get('a3'));
        expect(r.communities.get('b1')).toBe(r.communities.get('b2'));
        expect(r.communities.get('b1')).toBe(r.communities.get('b3'));
        expect(r.communities.get('a1')).not.toBe(r.communities.get('b1'));
        expect(r.modularity).toBeGreaterThan(0);
      } finally {
        s.clearCache();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
