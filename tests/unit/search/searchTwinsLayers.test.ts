/**
 * Pin tests for the search layers run by HybridSearchManager and
 * ParallelSearchExecutor.
 *
 * Each golden value is the output of one caller on a fixed collaborator set.
 * The layer calls stay in each caller, so each caller keeps its own error policy.
 */
import { describe, it, expect, vi } from 'vitest';
import { HybridSearchManager } from '../../../src/search/HybridSearchManager.js';
import { ParallelSearchExecutor } from '../../../src/search/ParallelSearchExecutor.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

const alpha: Entity = {
  name: 'Alpha',
  entityType: 'note',
  observations: ['alpha beta'],
  tags: [],
  importance: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
};
const beta: Entity = {
  name: 'Beta',
  entityType: 'task',
  observations: ['beta gamma'],
  tags: [],
  importance: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
};
const graph: ReadonlyKnowledgeGraph = { entities: [alpha, beta], relations: [] };

const throwingSemantic = { search: vi.fn().mockRejectedValue(new Error('semantic boom')) };
const rankedWith = (scores: Array<[Entity, number]>) => ({
  searchNodesRanked: vi.fn().mockResolvedValue(
    scores.map(([entity, score]) => ({ entity, score, matchedFields: {} })),
  ),
});
const rankedRejecting = { searchNodesRanked: vi.fn().mockRejectedValue(new Error('lexical boom')) };

describe('HybridSearchManager layer policy pins', () => {
  it('keeps lexical results when the semantic layer throws', async () => {
    const hybrid = new HybridSearchManager(
      throwingSemantic as any,
      rankedWith([[alpha, 2], [beta, 1]]) as any,
    );

    const results = await hybrid.search(graph, 'alpha', {
      semanticWeight: 1,
      lexicalWeight: 1,
      symbolicWeight: 0,
    });

    expect(throwingSemantic.search).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.entity.name)).toStrictEqual(['Alpha', 'Beta']);
  });

  it('keeps semantic results when the lexical layer throws', async () => {
    const semantic = { search: vi.fn().mockResolvedValue([{ entity: beta, similarity: 0.5 }]) };
    const hybrid = new HybridSearchManager(semantic as any, rankedRejecting as any);

    const results = await hybrid.search(graph, 'beta', {
      semanticWeight: 1,
      lexicalWeight: 1,
      symbolicWeight: 0,
    });

    expect(results.map(result => result.entity.name)).toStrictEqual(['Beta']);
  });

  it('rejects with the symbolic error because the symbolic layer does not catch', async () => {
    const hybrid = new HybridSearchManager(null, rankedWith([]) as any);
    vi.spyOn((hybrid as any).symbolicSearch, 'search').mockImplementation(() => {
      throw new Error('symbolic boom');
    });

    await expect(
      hybrid.search(graph, 'alpha', {
        semanticWeight: 0,
        lexicalWeight: 0,
        symbolicWeight: 1,
        symbolic: { entityTypes: ['note'] },
      }),
    ).rejects.toThrow('symbolic boom');
  });
});

describe('ParallelSearchExecutor layer policy pins', () => {
  it('reports a throwing semantic layer as a failed layer with its message', async () => {
    const executor = new ParallelSearchExecutor(throwingSemantic as any, rankedWith([]) as any);

    const result = await executor.execute(graph, 'alpha', {
      semantic: {},
      lexical: {},
      symbolic: {},
    });

    expect(result.semanticResults.size).toBe(0);
    expect(result.timings[0]).toMatchObject({
      layer: 'semantic',
      success: false,
      error: 'semantic boom',
      resultCount: 0,
    });
    expect(result.failedLayers).toStrictEqual(['semantic']);
    expect(result.allSucceeded).toBe(false);
  });

  it('reports a throwing lexical layer as a failed layer with its message', async () => {
    const executor = new ParallelSearchExecutor(null, rankedRejecting as any);

    const result = await executor.execute(graph, 'alpha');

    expect(result.lexicalResults.size).toBe(0);
    expect(result.timings[1]).toMatchObject({
      layer: 'lexical',
      success: false,
      error: 'lexical boom',
      resultCount: 0,
    });
    expect(result.failedLayers).toStrictEqual(['lexical']);
  });

  it('reports a throwing symbolic layer as a failed layer with its message', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([]) as any);
    vi.spyOn((executor as any).symbolicSearch, 'search').mockImplementation(() => {
      throw new Error('symbolic boom');
    });

    const result = await executor.execute(graph, 'alpha', {
      symbolic: { entityTypes: ['note'] },
    });

    expect(result.symbolicResults.size).toBe(0);
    expect(result.timings[2]).toMatchObject({
      layer: 'symbolic',
      success: false,
      error: 'symbolic boom',
      resultCount: 0,
    });
    expect(result.failedLayers).toStrictEqual(['symbolic']);
  });

  it('normalizes lexical scores by the largest score, floored at 1', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([[alpha, 2], [beta, 4]]) as any);

    const result = await executor.execute(graph, 'alpha');

    expect(Array.from(result.lexicalResults.entries())).toStrictEqual([
      ['Alpha', 0.5],
      ['Beta', 1],
    ]);
  });
});

describe('ParallelSearchExecutor timing pins', () => {
  it('returns the timing fields of a successful layer in the golden key order', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([[alpha, 2]]) as any);

    const result = await executor.execute(graph, 'alpha', { symbolic: { entityTypes: ['note'] } });

    expect(Object.keys(result.timings[1])).toStrictEqual([
      'layer',
      'startTime',
      'endTime',
      'durationMs',
      'success',
      'error',
      'resultCount',
    ]);
    expect(result.timings[1]).toMatchObject({ layer: 'lexical', success: true, resultCount: 1 });
    expect(result.timings[2]).toMatchObject({ layer: 'symbolic', success: true, resultCount: 1 });
  });

  it('omits the error key for an unconfigured semantic layer', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([]) as any);

    const result = await executor.execute(graph, 'alpha');

    expect(Object.keys(result.timings[0])).toStrictEqual([
      'layer',
      'startTime',
      'endTime',
      'durationMs',
      'success',
      'resultCount',
    ]);
    expect(result.timings[0]).toMatchObject({ layer: 'semantic', success: true, resultCount: 0 });
    expect(result.allSucceeded).toBe(true);
    expect(result.failedLayers).toStrictEqual([]);
  });

  it('sets durationMs to endTime minus startTime and a numeric totalTimeMs', async () => {
    const executor = new ParallelSearchExecutor(throwingSemantic as any, rankedWith([[alpha, 1]]) as any);

    const result = await executor.execute(graph, 'alpha', { semantic: {} });

    for (const timing of result.timings) {
      expect(timing.durationMs).toBe(timing.endTime - timing.startTime);
      expect(timing.endTime).toBeGreaterThanOrEqual(timing.startTime);
    }
    expect(typeof result.totalTimeMs).toBe('number');
    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('search layer TypeError text pins', () => {
  // A collaborator without the method throws a TypeError. The message names the
  // call expression, so each test pins the exact message text.
  it('keeps the symbolic TypeError text in the hybrid rejection', async () => {
    const hybrid = new HybridSearchManager(null, rankedWith([]) as any);
    (hybrid as any).symbolicSearch = {};

    await expect(
      hybrid.search(graph, 'alpha', {
        semanticWeight: 0,
        lexicalWeight: 0,
        symbolicWeight: 1,
        symbolic: { entityTypes: ['note'] },
      }),
    ).rejects.toThrow('this.symbolicSearch.search is not a function');
  });

  it('keeps the semantic TypeError text in the parallel layer error', async () => {
    const executor = new ParallelSearchExecutor({} as any, rankedWith([]) as any);

    const result = await executor.execute(graph, 'alpha', { semantic: {} });

    expect(result.timings[0]).toMatchObject({
      layer: 'semantic',
      success: false,
      error: 'this.semanticSearch.search is not a function',
    });
  });

  it('keeps the lexical TypeError text in the parallel layer error', async () => {
    const executor = new ParallelSearchExecutor(null, {} as any);

    const result = await executor.execute(graph, 'alpha');

    expect(result.timings[1]).toMatchObject({
      layer: 'lexical',
      success: false,
      error: 'this.rankedSearch.searchNodesRanked is not a function',
    });
  });

  it('keeps the symbolic TypeError text in the parallel layer error', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([]) as any);
    (executor as any).symbolicSearch = {};

    const result = await executor.execute(graph, 'alpha', {
      symbolic: { entityTypes: ['note'] },
    });

    expect(result.timings[2]).toMatchObject({
      layer: 'symbolic',
      success: false,
      error: 'this.symbolicSearch.search is not a function',
    });
  });
});

describe('search layer score map pins', () => {
  const entries = (map: Map<string, number>) => Array.from(map.entries());
  const semanticHits = () => ({
    search: vi.fn().mockResolvedValue([
      { entity: beta, similarity: 0.75 },
      { entity: alpha, similarity: 0.25 },
    ]),
  });
  const symbolicHits = [
    { entity: beta, score: 0.9 },
    { entity: alpha, score: 0.3 },
  ];
  const symbolicFilters = { entityTypes: ['note'] };

  it('hybrid maps each similarity to its entity name in result order', async () => {
    const hybrid = new HybridSearchManager(semanticHits() as any, rankedWith([]) as any);

    const scores = await (hybrid as any).executeSemanticSearch(graph, 'alpha', {}, 10);

    expect(entries(scores)).toStrictEqual([['Beta', 0.75], ['Alpha', 0.25]]);
  });

  it('parallel maps each similarity to its entity name in result order', async () => {
    const executor = new ParallelSearchExecutor(semanticHits() as any, rankedWith([]) as any);

    const result = await executor.execute(graph, 'alpha', { semantic: {} });

    expect(entries(result.semanticResults)).toStrictEqual([['Beta', 0.75], ['Alpha', 0.25]]);
  });

  it('hybrid keeps lexical scores raw when no score exceeds one', async () => {
    const hybrid = new HybridSearchManager(null, rankedWith([[alpha, 0.5], [beta, 0.25]]) as any);

    const scores = await (hybrid as any).executeLexicalSearch('alpha', {}, 10);

    expect(entries(scores)).toStrictEqual([['Alpha', 0.5], ['Beta', 0.25]]);
  });

  it('parallel keeps lexical scores raw when no score exceeds one', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([[alpha, 0.5], [beta, 0.25]]) as any);

    const result = await executor.execute(graph, 'alpha');

    expect(entries(result.lexicalResults)).toStrictEqual([['Alpha', 0.5], ['Beta', 0.25]]);
  });

  it('both callers keep negative lexical scores raw', async () => {
    const hybrid = new HybridSearchManager(null, rankedWith([[alpha, -1], [beta, -2]]) as any);
    const executor = new ParallelSearchExecutor(null, rankedWith([[alpha, -1], [beta, -2]]) as any);

    const hybridScores = await (hybrid as any).executeLexicalSearch('alpha', {}, 10);
    const result = await executor.execute(graph, 'alpha');

    expect(entries(hybridScores)).toStrictEqual([['Alpha', -1], ['Beta', -2]]);
    expect(entries(result.lexicalResults)).toStrictEqual([['Alpha', -1], ['Beta', -2]]);
  });

  it('hybrid maps each symbolic score unchanged in result order', () => {
    const hybrid = new HybridSearchManager(null, rankedWith([]) as any);
    vi.spyOn((hybrid as any).symbolicSearch, 'search').mockReturnValue(symbolicHits);

    const scores = (hybrid as any).executeSymbolicSearch(graph.entities, symbolicFilters);

    expect(entries(scores)).toStrictEqual([['Beta', 0.9], ['Alpha', 0.3]]);
  });

  it('parallel maps each symbolic score unchanged in result order', async () => {
    const executor = new ParallelSearchExecutor(null, rankedWith([]) as any);
    vi.spyOn((executor as any).symbolicSearch, 'search').mockReturnValue(symbolicHits);

    const result = await executor.execute(graph, 'alpha', { symbolic: symbolicFilters });

    expect(entries(result.symbolicResults)).toStrictEqual([['Beta', 0.9], ['Alpha', 0.3]]);
  });
});
