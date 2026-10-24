/**
 * Pin tests for the two parent-walk path reconstructions:
 * GraphTraversal.reconstructPath and EvidencePathBuilder.reconstruct.
 *
 * Each test pins the exact output of one caller on a fixed graph.
 * Each caller keeps its own return shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import { EvidencePathBuilder } from '../../../src/search/EvidencePathBuilder.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';

// A -> B -> C -> D. No shortcut edge, so the walk has three hops.
const chain: KnowledgeGraph = {
  entities: ['A', 'B', 'C', 'D'].map(name => ({
    name,
    entityType: 'node',
    observations: ['x'],
  })),
  relations: [
    { from: 'A', to: 'B', relationType: 'connects' },
    { from: 'B', to: 'C', relationType: 'connects' },
    { from: 'C', to: 'D', relationType: 'connects' },
  ],
};

describe('GraphTraversal path reconstruction pins', () => {
  let tempDir: string;
  let storage: GraphStorage;
  let traversal: GraphTraversal;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-twins-paths-'));
    storage = new GraphStorage(path.join(tempDir, 'memory.jsonl'));
    await storage.saveGraph(chain);
    traversal = new GraphTraversal(storage);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns the golden path, length and relations for a three-hop walk', async () => {
    const result = await traversal.findShortestPath('A', 'D');

    expect(result).toStrictEqual({
      path: ['A', 'B', 'C', 'D'],
      length: 3,
      relations: [
        { from: 'A', to: 'B', relationType: 'connects' },
        { from: 'B', to: 'C', relationType: 'connects' },
        { from: 'C', to: 'D', relationType: 'connects' },
      ],
    });
  });

  it('keeps the stored relation direction when the walk runs backwards', async () => {
    const result = await traversal.findShortestPath('D', 'A');

    expect(result).toStrictEqual({
      path: ['D', 'C', 'B', 'A'],
      length: 3,
      relations: [
        { from: 'C', to: 'D', relationType: 'connects' },
        { from: 'B', to: 'C', relationType: 'connects' },
        { from: 'A', to: 'B', relationType: 'connects' },
      ],
    });
  });

  it('returns the same golden path through the depth-bounded walk', async () => {
    const result = await traversal.findPathWithin('A', 'D', 3);

    expect(result?.path).toStrictEqual(['A', 'B', 'C', 'D']);
    expect(result?.length).toBe(3);
  });
});

describe('EvidencePathBuilder path reconstruction pins', () => {
  it('returns the golden evidence path from the anchor to the result', () => {
    const builder = new EvidencePathBuilder(chain, { maxDepth: 3 });

    const set = builder.buildForResult('D', [{ name: 'A', viaLayer: 'lexical', score: 1 }]);

    expect(set).toStrictEqual({
      paths: [
        {
          nodes: ['A', 'B', 'C', 'D'],
          relations: [
            { from: 'A', to: 'B', relationType: 'connects' },
            { from: 'B', to: 'C', relationType: 'connects' },
            { from: 'C', to: 'D', relationType: 'connects' },
          ],
          anchor: 'A',
          viaLayer: 'lexical',
        },
      ],
      truncated: false,
    });
  });

  it('returns a one-hop evidence path when the anchor is adjacent', () => {
    const builder = new EvidencePathBuilder(chain, { maxDepth: 3 });

    const set = builder.buildForResult('D', [{ name: 'C', viaLayer: 'semantic' }]);

    expect(set).toStrictEqual({
      paths: [
        {
          nodes: ['C', 'D'],
          relations: [{ from: 'C', to: 'D', relationType: 'connects' }],
          anchor: 'C',
          viaLayer: 'semantic',
        },
      ],
      truncated: false,
    });
  });

  it('returns the walked path with the source as anchor and the lexical layer', () => {
    const builder = new EvidencePathBuilder(chain, { maxDepth: 3 });

    const outcome = (builder as any).boundedBfs('A', 'D');

    expect(Object.keys(outcome.path)).toStrictEqual(['nodes', 'relations', 'anchor', 'viaLayer']);
    expect(outcome.path.nodes).toStrictEqual(['A', 'B', 'C', 'D']);
    expect(outcome.path.anchor).toBe('A');
    expect(outcome.path.viaLayer).toBe('lexical');
    expect(outcome.depthLimited).toBe(false);
  });
});
