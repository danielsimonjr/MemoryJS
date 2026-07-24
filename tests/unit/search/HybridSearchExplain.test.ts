/**
 * HybridSearchManager Explain + LookFor Unit Tests
 *
 * R2: `explain: true` annotates results with traceable evidence paths.
 * R7: `lookFor` ranks neighbor-expansion candidates by descriptor similarity.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HybridSearchManager,
  type ExplainedHybridSearchResult,
} from '../../../src/search/HybridSearchManager.js';
import type { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import type { EvidencePath } from '../../../src/types/search.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

const createEntity = (name: string, observations: string[] = [`Observation for ${name}`]): Entity => ({
  name,
  entityType: 'person',
  observations,
});

function assertPathValid(path: EvidencePath, graph: ReadonlyKnowledgeGraph): void {
  expect(path.nodes.length).toBe(path.relations.length + 1);
  expect(path.nodes[0]).toBe(path.anchor);
  path.relations.forEach((rel, i) => {
    const a = path.nodes[i];
    const b = path.nodes[i + 1];
    expect((rel.from === a && rel.to === b) || (rel.from === b && rel.to === a)).toBe(true);
    expect(
      graph.relations.some(
        r => r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType
      )
    ).toBe(true);
  });
}

describe('HybridSearchManager explain (R2)', () => {
  const mockSemanticSearch = { search: vi.fn() };
  const mockRankedSearch = { searchNodesRanked: vi.fn() };

  // Result <- Mid <- Anchor chain; Sem -> Result direct edge
  const entities = {
    Result: createEntity('Result'),
    Anchor: createEntity('Anchor'),
    Mid: createEntity('Mid'),
    Sem: createEntity('Sem'),
  };
  let testGraph: ReadonlyKnowledgeGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    testGraph = {
      entities: Object.values(entities),
      relations: [
        { from: 'Anchor', to: 'Mid', relationType: 'links' },
        { from: 'Mid', to: 'Result', relationType: 'links' },
        { from: 'Sem', to: 'Result', relationType: 'supports' },
      ],
    };
    mockSemanticSearch.search.mockResolvedValue([
      { entity: entities.Sem, similarity: 0.9 },
    ]);
    mockRankedSearch.searchNodesRanked.mockResolvedValue([
      { entity: entities.Result, score: 5 },
      { entity: entities.Anchor, score: 3 },
    ]);
  });

  const makeManager = () =>
    new HybridSearchManager(mockSemanticSearch as never, mockRankedSearch as never);

  it('explain off (default) produces results deep-equal to explain: false, with no evidence fields', async () => {
    const manager = makeManager();

    const off = await manager.search(testGraph, 'test');
    const explicitOff = await manager.search(testGraph, 'test', { explain: false });

    expect(off).toEqual(explicitOff);
    for (const result of off) {
      expect('evidencePaths' in result).toBe(false);
      expect('evidenceTruncated' in result).toBe(false);
      expect('lookForScore' in result).toBe(false);
    }
  });

  it('explain on leaves entities, scores, and ordering identical to explain off', async () => {
    const manager = makeManager();

    const off = await manager.search(testGraph, 'test');
    const on = await manager.search(testGraph, 'test', { explain: true });

    expect(on.map(r => ({ entity: r.entity, scores: r.scores, matchedLayers: r.matchedLayers })))
      .toEqual(off.map(r => ({ entity: r.entity, scores: r.scores, matchedLayers: r.matchedLayers })));
  });

  it('annotates every result with evidencePaths and evidenceTruncated', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', { explain: true });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(Array.isArray(result.evidencePaths)).toBe(true);
      expect(typeof result.evidenceTruncated).toBe('boolean');
    }
  });

  it('produces a trivial self-path for a result that directly matched', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', { explain: true });
    const resultHit = results.find(r => r.entity.name === 'Result')!;

    const selfPath = resultHit.evidencePaths!.find(p => p.anchor === 'Result')!;
    expect(selfPath).toBeDefined();
    expect(selfPath.nodes).toEqual(['Result']);
    expect(selfPath.relations).toEqual([]);
    expect(selfPath.viaLayer).toBe('lexical');
  });

  it('assigns viaLayer per anchor layer (semantic vs lexical) and builds valid paths', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', { explain: true });
    const resultHit = results.find(r => r.entity.name === 'Result')!;
    const paths = resultHit.evidencePaths!;

    const fromSem = paths.find(p => p.anchor === 'Sem')!;
    expect(fromSem.viaLayer).toBe('semantic');
    expect(fromSem.nodes).toEqual(['Sem', 'Result']);

    const fromAnchor = paths.find(p => p.anchor === 'Anchor')!;
    expect(fromAnchor.viaLayer).toBe('lexical');
    expect(fromAnchor.nodes).toEqual(['Anchor', 'Mid', 'Result']);

    for (const path of paths) {
      assertPathValid(path, testGraph);
    }
  });

  it('honors maxDepth: paths beyond the cap disappear and truncated is set', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', {
      explain: true,
      explainOptions: { maxDepth: 1 },
    });
    const resultHit = results.find(r => r.entity.name === 'Result')!;

    // Anchor -> Mid -> Result (2 hops) no longer fits
    expect(resultHit.evidencePaths!.some(p => p.anchor === 'Anchor')).toBe(false);
    // But the 1-hop and self paths remain
    expect(resultHit.evidencePaths!.some(p => p.anchor === 'Sem')).toBe(true);
    expect(resultHit.evidencePaths!.some(p => p.anchor === 'Result')).toBe(true);
    expect(resultHit.evidenceTruncated).toBe(true);
  });

  it('honors maxPathsPerResult and sets truncated when anchors remain', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', {
      explain: true,
      explainOptions: { maxPathsPerResult: 1 },
    });
    const resultHit = results.find(r => r.entity.name === 'Result')!;

    expect(resultHit.evidencePaths).toHaveLength(1);
    expect(resultHit.evidenceTruncated).toBe(true);
  });

  it('reports truncated: false when all anchor paths fit within the caps', async () => {
    const manager = makeManager();

    const results = await manager.search(testGraph, 'test', { explain: true });
    const resultHit = results.find(r => r.entity.name === 'Result')!;

    // 3 anchors (Result, Sem, Anchor), default cap 3, all reachable within 3 hops
    expect(resultHit.evidencePaths).toHaveLength(3);
    expect(resultHit.evidenceTruncated).toBe(false);
  });
});

describe('HybridSearchManager lookFor neighbor expansion (R7)', () => {
  const mockRankedSearch = { searchNodesRanked: vi.fn() };

  const parent = createEntity('Parent');
  const dbNeighbor = createEntity('DbNeighbor', ['maintains the database storage engine']);
  const cookNeighbor = createEntity('CookNeighbor', ['collects cooking recipes']);

  let testGraph: ReadonlyKnowledgeGraph;

  const makeFakePrior = (neighbors: Record<string, string[]>) =>
    ({
      getScores: vi.fn(async () => new Map<string, number>()),
      neighbors: vi.fn((name: string) => neighbors[name] ?? []),
    }) as unknown as GraphRankPrior;

  beforeEach(() => {
    vi.clearAllMocks();
    testGraph = {
      entities: [parent, cookNeighbor, dbNeighbor],
      relations: [],
    };
    mockRankedSearch.searchNodesRanked.mockResolvedValue([{ entity: parent, score: 5 }]);
  });

  it('without lookFor, expansion neighbors keep prior order and carry no lookForScore', async () => {
    const prior = makeFakePrior({ Parent: ['CookNeighbor', 'DbNeighbor'] });
    const manager = new HybridSearchManager(null, mockRankedSearch as never, prior);

    const results = await manager.search(testGraph, 'test', {
      expandNeighbors: { hops: 1 },
    });

    const names = results.map(r => r.entity.name);
    expect(names).toEqual(['Parent', 'CookNeighbor', 'DbNeighbor']);
    for (const r of results) {
      expect('lookForScore' in r).toBe(false);
    }
  });

  it('with lookFor and no semantic layer, lexical fallback re-ranks tied neighbors', async () => {
    const prior = makeFakePrior({ Parent: ['CookNeighbor', 'DbNeighbor'] });
    const manager = new HybridSearchManager(null, mockRankedSearch as never, prior);

    const results = await manager.search(testGraph, 'test', {
      expandNeighbors: { hops: 1 },
      lookFor: 'database storage',
    });

    const names = results.map(r => r.entity.name);
    // DbNeighbor's descriptor overlaps 'database storage'; CookNeighbor's does not
    expect(names).toEqual(['Parent', 'DbNeighbor', 'CookNeighbor']);

    const db = results.find(r => r.entity.name === 'DbNeighbor')!;
    const cook = results.find(r => r.entity.name === 'CookNeighbor')!;
    expect(db.lookForScore!).toBeGreaterThan(cook.lookForScore!);
    // Damped combined scores stay untouched by lookFor
    expect(db.scores.combined).toBeCloseTo(cook.scores.combined);
  });

  it('with lookFor and a similarity fn, semantic scores drive the ranking', async () => {
    const prior = makeFakePrior({ Parent: ['CookNeighbor', 'DbNeighbor'] });
    const calculateSimilarity = vi.fn(async (_lookFor: string, descriptor: string) =>
      descriptor.includes('CookNeighbor') ? 0.95 : 0.05
    );
    const fakeSemantic = { search: vi.fn().mockResolvedValue([]), calculateSimilarity };
    const manager = new HybridSearchManager(fakeSemantic as never, mockRankedSearch as never, prior);

    const results = await manager.search(testGraph, 'test', {
      expandNeighbors: { hops: 1 },
      lookFor: 'someone who cooks',
    });

    expect(calculateSimilarity).toHaveBeenCalled();
    const names = results.map(r => r.entity.name);
    expect(names).toEqual(['Parent', 'CookNeighbor', 'DbNeighbor']);
    const cook = results.find(r => r.entity.name === 'CookNeighbor')!;
    expect(cook.lookForScore).toBeCloseTo(0.95);
  });

  it('falls back to lexical scoring when the semantic similarity fn throws', async () => {
    const prior = makeFakePrior({ Parent: ['CookNeighbor', 'DbNeighbor'] });
    const fakeSemantic = {
      search: vi.fn().mockResolvedValue([]),
      calculateSimilarity: vi.fn().mockRejectedValue(new Error('embedding service not ready')),
    };
    const manager = new HybridSearchManager(fakeSemantic as never, mockRankedSearch as never, prior);

    const results = await manager.search(testGraph, 'test', {
      expandNeighbors: { hops: 1 },
      lookFor: 'database storage',
    });

    const names = results.map(r => r.entity.name);
    expect(names).toEqual(['Parent', 'DbNeighbor', 'CookNeighbor']);
  });

  it('explain and lookFor compose: expansion neighbors also receive evidence annotations', async () => {
    const graphWithEdges: ReadonlyKnowledgeGraph = {
      entities: [parent, cookNeighbor, dbNeighbor],
      relations: [
        { from: 'Parent', to: 'DbNeighbor', relationType: 'manages' },
        { from: 'Parent', to: 'CookNeighbor', relationType: 'knows' },
      ],
    };
    const prior = makeFakePrior({ Parent: ['CookNeighbor', 'DbNeighbor'] });
    const manager = new HybridSearchManager(null, mockRankedSearch as never, prior);

    const results: ExplainedHybridSearchResult[] = await manager.search(graphWithEdges, 'test', {
      expandNeighbors: { hops: 1 },
      lookFor: 'database storage',
      explain: true,
    });

    const db = results.find(r => r.entity.name === 'DbNeighbor')!;
    expect(db.lookForScore).toBeGreaterThan(0);
    // Parent is the sole lexical anchor; the neighbor's evidence path leads back to it
    expect(db.evidencePaths).toHaveLength(1);
    expect(db.evidencePaths![0].anchor).toBe('Parent');
    expect(db.evidencePaths![0].nodes).toEqual(['Parent', 'DbNeighbor']);
    assertPathValid(db.evidencePaths![0], graphWithEdges);
  });
});
