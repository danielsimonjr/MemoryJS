/**
 * LLMSearchExecutor Explain Threading Unit Tests
 *
 * R2: `explain: true` on execute() annotates results with evidence paths
 * derived from the query's filter-matched anchor entities.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMSearchExecutor } from '../../../src/search/LLMSearchExecutor.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

function makeEntity(name: string, type = 'person', importance = 5): Entity {
  return {
    name,
    entityType: type,
    observations: [`${name} is a ${type}`],
    importance,
  };
}

const alice = makeEntity('Alice', 'person', 9);
const bob = makeEntity('Bob', 'person', 5);
const projectX = makeEntity('ProjectX', 'project', 8);
const carol = makeEntity('Carol', 'person', 7);

const testGraph: ReadonlyKnowledgeGraph = {
  entities: [alice, bob, projectX, carol],
  relations: [
    { from: 'Bob', to: 'Alice', relationType: 'reports_to' },
    { from: 'ProjectX', to: 'Alice', relationType: 'led_by' },
    { from: 'Carol', to: 'ProjectX', relationType: 'works_on' },
  ],
};

function makeMockSearchManager(overrides: Partial<{
  searchNodesRanked: ReturnType<typeof vi.fn>;
  searchNodes: ReturnType<typeof vi.fn>;
  searchByDateRange: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    searchNodesRanked: overrides.searchNodesRanked ?? vi.fn().mockResolvedValue([
      { entity: alice, score: 0.9 },
      { entity: bob, score: 0.5 },
    ]),
    searchNodes: overrides.searchNodes ?? vi.fn().mockResolvedValue({
      entities: [alice, bob],
      relations: [],
    }),
    searchByDateRange: overrides.searchByDateRange ?? vi.fn().mockResolvedValue({
      entities: [projectX],
      relations: [],
    }),
  } as unknown as import('../../../src/search/SearchManager.js').SearchManager;
}

describe('LLMSearchExecutor explain threading (R2)', () => {
  it('execute without options keeps the plain Entity[] contract', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const results = await executor.execute({ keywords: ['engineer'] });

    expect(results.some(e => e.name === 'Alice')).toBe(true);
    for (const result of results) {
      expect('evidencePaths' in result).toBe(false);
    }
  });

  it('explain: false behaves identically to no options', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const plain = await executor.execute({ keywords: ['engineer'] });
    const explicitOff = await executor.execute({ keywords: ['engineer'] }, { explain: false });

    expect(explicitOff).toEqual(plain);
  });

  it('explain: true wraps results with evidencePaths and evidenceTruncated', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const results = await executor.execute(
      { keywords: ['engineer'] },
      { explain: true, graph: testGraph }
    );

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.entity).toBeDefined();
      expect(Array.isArray(result.evidencePaths)).toBe(true);
      expect(typeof result.evidenceTruncated).toBe('boolean');
    }
  });

  it('uses filter-matched entities as anchors with the proper layers', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const results = await executor.execute(
      {
        keywords: ['engineer'],
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31') },
      },
      { explain: true, graph: testGraph }
    );

    const aliceResult = results.find(r => r.entity.name === 'Alice')!;
    const paths = aliceResult.evidencePaths;

    // Alice matched keywords directly: trivial self-path via lexical
    const selfPath = paths.find(p => p.anchor === 'Alice')!;
    expect(selfPath.nodes).toEqual(['Alice']);
    expect(selfPath.viaLayer).toBe('lexical');

    // Bob (keyword anchor) connects Bob -> Alice
    const fromBob = paths.find(p => p.anchor === 'Bob')!;
    expect(fromBob.viaLayer).toBe('lexical');
    expect(fromBob.nodes).toEqual(['Bob', 'Alice']);

    // ProjectX (date-range anchor) connects ProjectX -> Alice via symbolic
    const fromProject = paths.find(p => p.anchor === 'ProjectX')!;
    expect(fromProject.viaLayer).toBe('symbolic');
    expect(fromProject.nodes).toEqual(['ProjectX', 'Alice']);
  });

  it('threads explainOptions caps through to path construction', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const results = await executor.execute(
      {
        keywords: ['engineer'],
        timeRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31') },
      },
      { explain: true, graph: testGraph, explainOptions: { maxPathsPerResult: 1 } }
    );

    const aliceResult = results.find(r => r.entity.name === 'Alice')!;
    expect(aliceResult.evidencePaths).toHaveLength(1);
    expect(aliceResult.evidenceTruncated).toBe(true);
  });

  it('prefers the constructor graphSource when no per-call graph is given', async () => {
    const loadGraph = vi.fn().mockResolvedValue(testGraph);
    const executor = new LLMSearchExecutor(makeMockSearchManager(), {
      graphSource: { loadGraph },
    });

    const results = await executor.execute({ keywords: ['engineer'] }, { explain: true });

    expect(loadGraph).toHaveBeenCalledTimes(1);
    const aliceResult = results.find(r => r.entity.name === 'Alice')!;
    expect(aliceResult.evidencePaths.length).toBeGreaterThan(0);
  });

  it('does not touch the graph source when explain is off', async () => {
    const loadGraph = vi.fn().mockResolvedValue(testGraph);
    const executor = new LLMSearchExecutor(makeMockSearchManager(), {
      graphSource: { loadGraph },
    });

    await executor.execute({ keywords: ['engineer'] });

    expect(loadGraph).not.toHaveBeenCalled();
  });

  it('degrades gracefully to empty evidence when no graph is available', async () => {
    const executor = new LLMSearchExecutor(makeMockSearchManager());

    const results = await executor.execute({ keywords: ['engineer'] }, { explain: true });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.evidencePaths).toEqual([]);
      expect(result.evidenceTruncated).toBe(false);
    }
  });

  it('keeps the basic-search fallback working and anchoring via lexical', async () => {
    const executor = new LLMSearchExecutor(
      makeMockSearchManager({
        searchNodesRanked: vi.fn().mockRejectedValue(new Error('index unavailable')),
      })
    );

    const results = await executor.execute(
      { keywords: ['engineer'] },
      { explain: true, graph: testGraph }
    );

    const aliceResult = results.find(r => r.entity.name === 'Alice')!;
    const selfPath = aliceResult.evidencePaths.find(p => p.anchor === 'Alice')!;
    expect(selfPath.viaLayer).toBe('lexical');
    expect(selfPath.nodes).toEqual(['Alice']);
  });
});
