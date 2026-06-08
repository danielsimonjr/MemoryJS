import { describe, it, expect, vi } from 'vitest';
import { LLMSearchExecutor } from '../../../src/search/LLMSearchExecutor.js';
import type { Entity } from '../../../src/types/index.js';

// ==================== Helpers ====================

/** Minimal entity factory */
function makeEntity(name: string, type = 'person', importance = 5, tags: string[] = []): Entity {
  return {
    name,
    entityType: type,
    observations: [`${name} is a ${type}`],
    tags,
    importance,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
}

// ==================== LLMSearchExecutor ====================

describe('LLMSearchExecutor', () => {
  const alice = makeEntity('Alice', 'person', 9, ['backend', 'senior']);
  const bob = makeEntity('Bob', 'person', 5, ['frontend']);
  const projectX = makeEntity('ProjectX', 'project', 8, ['active']);
  const projectY = makeEntity('ProjectY', 'project', 3, ['archived']);

  /** Build a minimal mock SearchManager */
  function makeMockSearchManager(overrides: Partial<{
    searchNodesRanked: ReturnType<typeof vi.fn>;
    searchNodes: ReturnType<typeof vi.fn>;
    searchByDateRange: ReturnType<typeof vi.fn>;
  }> = {}) {
    return {
      searchNodesRanked: overrides.searchNodesRanked ?? vi.fn().mockResolvedValue([
        { entity: alice, score: 0.9 },
        { entity: bob, score: 0.5 },
        { entity: projectX, score: 0.3 },
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

  it('executes keyword search and returns entities', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({ keywords: ['engineer'] });

    expect(manager.searchNodesRanked).toHaveBeenCalledWith(
      'engineer',
      undefined,
      undefined,
      undefined,
      expect.any(Number)
    );
    expect(results.some(e => e.name === 'Alice')).toBe(true);
  });

  it('combines results from date-range and keyword searches', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({
      keywords: ['project'],
      timeRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31') },
    });

    expect(manager.searchByDateRange).toHaveBeenCalled();
    expect(manager.searchNodesRanked).toHaveBeenCalled();
    // Both ProjectX (from date-range) and alice/bob (from keyword) should appear
    expect(results.some(e => e.name === 'ProjectX')).toBe(true);
  });

  it('deduplicates entities appearing in multiple search results', async () => {
    // Both date-range and keyword return Alice
    const manager = makeMockSearchManager({
      searchByDateRange: vi.fn().mockResolvedValue({ entities: [alice], relations: [] }),
      searchNodesRanked: vi.fn().mockResolvedValue([{ entity: alice, score: 0.9 }]),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({
      keywords: ['alice'],
      timeRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31') },
    });

    const aliceCount = results.filter(e => e.name === 'Alice').length;
    expect(aliceCount).toBe(1);
  });

  it('filters results by entityType', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockResolvedValue([
        { entity: alice, score: 0.9 },
        { entity: projectX, score: 0.7 },
      ]),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({
      keywords: ['active'],
      entityTypes: ['project'],
    });

    expect(results.every(e => e.entityType === 'project')).toBe(true);
    expect(results.some(e => e.name === 'ProjectX')).toBe(true);
    expect(results.some(e => e.name === 'Alice')).toBe(false);
  });

  it('filters results by importance range', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockResolvedValue([
        { entity: alice, score: 0.9 },   // importance 9 — in range
        { entity: bob, score: 0.5 },     // importance 5 — out of range
        { entity: projectY, score: 0.3 }, // importance 3 — out of range
      ]),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({
      keywords: ['test'],
      importance: { min: 7, max: 10 },
    });

    expect(results.every(e => (e.importance ?? 0) >= 7)).toBe(true);
    expect(results.some(e => e.name === 'Alice')).toBe(true);
    expect(results.some(e => e.name === 'Bob')).toBe(false);
  });

  it('applies limit to results', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockResolvedValue([
        { entity: alice, score: 0.9 },
        { entity: bob, score: 0.8 },
        { entity: projectX, score: 0.7 },
        { entity: projectY, score: 0.6 },
      ]),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({ keywords: ['test'], limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('falls back to basic search when ranked search throws', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockRejectedValue(new Error('index not ready')),
      searchNodes: vi.fn().mockResolvedValue({ entities: [alice], relations: [] }),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({ keywords: ['alice'] });

    expect(manager.searchNodes).toHaveBeenCalled();
    expect(results.some(e => e.name === 'Alice')).toBe(true);
  });

  it('returns empty array for empty keywords and no timeRange', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockResolvedValue([]),
    });
    const executor = new LLMSearchExecutor(manager);

    const results = await executor.execute({ keywords: [] });
    expect(results).toEqual([]);
    expect(manager.searchNodesRanked).not.toHaveBeenCalled();
  });

  it('uses defaultLimit from options when query.limit is not set', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager, { defaultLimit: 5 });

    const results = await executor.execute({ keywords: ['test'] });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('passes tags to ranked search', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager);

    await executor.execute({ keywords: ['engineer'], tags: ['backend'] });

    expect(manager.searchNodesRanked).toHaveBeenCalledWith(
      'engineer',
      ['backend'],
      undefined,
      undefined,
      expect.any(Number)
    );
  });

  it('passes importance to ranked search', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager);

    await executor.execute({ keywords: ['test'], importance: { min: 6, max: 9 } });

    expect(manager.searchNodesRanked).toHaveBeenCalledWith(
      'test',
      undefined,
      6,
      9,
      expect.any(Number)
    );
  });

  it('passes tags and importance to basic search when ranked search throws', async () => {
    const manager = makeMockSearchManager({
      searchNodesRanked: vi.fn().mockRejectedValue(new Error('index not ready')),
      searchNodes: vi.fn().mockResolvedValue({ entities: [alice], relations: [] }),
    });
    const executor = new LLMSearchExecutor(manager);

    await executor.execute({ keywords: ['test'], tags: ['backend'], importance: { min: 6, max: 9 } });

    expect(manager.searchNodes).toHaveBeenCalledWith('test', ['backend'], 6, 9);
  });

  it('passes tags to date-range search', async () => {
    const manager = makeMockSearchManager();
    const executor = new LLMSearchExecutor(manager);

    const start = new Date('2024-01-01');
    const end = new Date('2024-12-31');

    await executor.execute({
      keywords: [],
      tags: ['active'],
      timeRange: { start, end },
    });

    expect(manager.searchByDateRange).toHaveBeenCalledWith(
      start.toISOString(),
      end.toISOString(),
      undefined,
      ['active']
    );
  });
});
