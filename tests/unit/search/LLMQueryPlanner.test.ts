/**
 * LLMQueryPlanner Unit Tests
 *
 * Tests for natural language → StructuredQuery decomposition and
 * LLMSearchExecutor result combination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LLMQueryPlanner,
  type LLMProvider,
  type StructuredQuery,
} from '../../../src/search/LLMQueryPlanner.js';
import { LLMSearchExecutor } from '../../../src/search/LLMSearchExecutor.js';
import type { Entity } from '../../../src/types/index.js';

// ==================== Helpers ====================

/** Build a mock LLMProvider that returns a pre-set string. */
function makeMockProvider(response: string): LLMProvider {
  return { complete: vi.fn().mockResolvedValue(response) };
}

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

// ==================== LLMQueryPlanner ====================

describe('LLMQueryPlanner', () => {

  // ── keywordFallback ──────────────────────────────────────────────────────

  describe('keywordFallback', () => {
    it('extracts meaningful terms from a simple sentence', () => {
      const planner = new LLMQueryPlanner();
      const result = planner.keywordFallback('find senior engineers in the backend team');
      expect(result.keywords).toContain('senior');
      expect(result.keywords).toContain('engineers');
      expect(result.keywords).toContain('backend');
      expect(result.keywords).toContain('team');
    });

    it('filters out stop words', () => {
      const planner = new LLMQueryPlanner();
      const result = planner.keywordFallback('find the best results for a query');
      expect(result.keywords).not.toContain('the');
      expect(result.keywords).not.toContain('for');
      expect(result.keywords).not.toContain('a');
    });

    it('lowercases all keywords', () => {
      const planner = new LLMQueryPlanner();
      const result = planner.keywordFallback('Machine Learning Engineers');
      expect(result.keywords).toContain('machine');
      expect(result.keywords).toContain('learning');
      expect(result.keywords).toContain('engineers');
    });

    it('deduplicates keywords', () => {
      const planner = new LLMQueryPlanner();
      const result = planner.keywordFallback('search search search results results');
      const countSearch = result.keywords.filter(k => k === 'search').length;
      const countResults = result.keywords.filter(k => k === 'results').length;
      expect(countSearch).toBe(1);
      expect(countResults).toBe(1);
    });

    it('returns empty keywords for empty input', () => {
      const planner = new LLMQueryPlanner();
      expect(planner.keywordFallback('').keywords).toEqual([]);
    });

    it('returns empty keywords for whitespace-only input', () => {
      const planner = new LLMQueryPlanner();
      expect(planner.keywordFallback('   ').keywords).toEqual([]);
    });

    it('filters tokens shorter than 2 characters', () => {
      const planner = new LLMQueryPlanner();
      const result = planner.keywordFallback('a b c do re mi');
      // 'a','b','c' < 2 chars; 'do' is in stop words; 're','mi' stay
      expect(result.keywords).not.toContain('a');
      expect(result.keywords).not.toContain('b');
      expect(result.keywords).not.toContain('c');
    });

    it('handles punctuation and special characters', () => {
      const planner = new LLMQueryPlanner();
      // Note: underscore (_) is a word character (\w), so neural_networks stays as one token
      const result = planner.keywordFallback('machine-learning, deep.learning; neural-networks!');
      expect(result.keywords).toContain('machine');
      expect(result.keywords).toContain('learning');
      expect(result.keywords).toContain('deep');
      expect(result.keywords).toContain('neural');
      expect(result.keywords).toContain('networks');
    });
  });

  // ── planQuery – LLM path ─────────────────────────────────────────────────

  describe('planQuery with mock LLM provider', () => {
    it('returns valid StructuredQuery from well-formed LLM JSON', async () => {
      const json: StructuredQuery = {
        keywords: ['engineer', 'senior'],
        entityTypes: ['person'],
        tags: ['backend'],
        importance: { min: 7, max: 10 },
        limit: 10,
      };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('find senior backend engineers with high importance');

      expect(result.keywords).toEqual(['engineer', 'senior']);
      expect(result.entityTypes).toEqual(['person']);
      expect(result.tags).toEqual(['backend']);
      expect(result.importance).toEqual({ min: 7, max: 10 });
      expect(result.limit).toBe(10);
      expect(provider.complete).toHaveBeenCalledOnce();
    });

    it('extracts structured query with all fields populated', async () => {
      const json = {
        keywords: ['project', 'alpha'],
        entityTypes: ['project'],
        timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' },
        importance: { min: 5, max: 9 },
        tags: ['active', 'priority'],
        relations: [{ type: 'manages', target: 'Alice' }],
        limit: 5,
      };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('active high priority projects managed by Alice');

      expect(result.keywords).toEqual(['project', 'alpha']);
      expect(result.entityTypes).toEqual(['project']);
      expect(result.timeRange).toBeDefined();
      expect(result.timeRange!.start).toBeInstanceOf(Date);
      expect(result.timeRange!.end).toBeInstanceOf(Date);
      expect(result.tags).toEqual(['active', 'priority']);
      expect(result.relations).toEqual([{ type: 'manages', target: 'Alice' }]);
      expect(result.limit).toBe(5);
    });

    it('returns StructuredQuery with minimal fields (only keywords)', async () => {
      const json = { keywords: ['database'] };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('database');

      expect(result.keywords).toEqual(['database']);
      expect(result.entityTypes).toBeUndefined();
      expect(result.timeRange).toBeUndefined();
      expect(result.importance).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.relations).toBeUndefined();
      expect(result.limit).toBeUndefined();
    });

    it('parses JSON wrapped in markdown code fences', async () => {
      const json = { keywords: ['machine', 'learning'] };
      const fencedResponse = '```json\n' + JSON.stringify(json) + '\n```';
      const provider = makeMockProvider(fencedResponse);
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('machine learning topics');
      expect(result.keywords).toEqual(['machine', 'learning']);
    });

    it('falls back to keyword extraction when LLM returns invalid JSON', async () => {
      const provider = makeMockProvider('This is not JSON at all.');
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('senior backend engineers');

      // Should have fallen back to keyword extraction
      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.keywords).toContain('senior');
      expect(result.keywords).toContain('backend');
      expect(result.keywords).toContain('engineers');
    });

    it('falls back to keyword extraction when LLM response has no keywords array', async () => {
      const provider = makeMockProvider(JSON.stringify({ entityTypes: ['person'] }));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('any person entity');

      // keywords is required; invalid response triggers fallback
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('falls back to keyword extraction when LLM throws an error', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('network error')),
      };
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('find project entities');

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.keywords).toContain('project');
      expect(result.keywords).toContain('entities');
    });

    it('returns empty keywords for empty input even with LLM provider', async () => {
      const provider = makeMockProvider(JSON.stringify({ keywords: ['x'] }));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('');

      expect(result.keywords).toEqual([]);
      // LLM should NOT be called for empty input
      expect(provider.complete).not.toHaveBeenCalled();
    });

    it('returns empty keywords for whitespace-only input', async () => {
      const provider = makeMockProvider(JSON.stringify({ keywords: ['x'] }));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('   ');

      expect(result.keywords).toEqual([]);
      expect(provider.complete).not.toHaveBeenCalled();
    });
  });

  // ── planQuery – no LLM ───────────────────────────────────────────────────

  describe('planQuery without LLM provider', () => {
    it('uses keyword fallback when no provider configured', async () => {
      const planner = new LLMQueryPlanner();
      const result = await planner.planQuery('show me all high importance project entities');

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.keywords).toContain('high');
      expect(result.keywords).toContain('importance');
      expect(result.keywords).toContain('project');
      expect(result.keywords).toContain('entities');
    });
  });

  // ── sanitize edge cases ──────────────────────────────────────────────────

  describe('LLM output validation', () => {
    it('clamps importance values to 0-10 range', async () => {
      const json = { keywords: ['test'], importance: { min: -5, max: 15 } };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.importance!.min).toBe(0);
      expect(result.importance!.max).toBe(10);
    });

    it('rejects timeRange where start is after end', async () => {
      const json = {
        keywords: ['test'],
        timeRange: { start: '2024-12-31', end: '2024-01-01' },
      };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test query');
      // Invalid range should be omitted
      expect(result.timeRange).toBeUndefined();
    });

    it('ignores empty entityTypes arrays', async () => {
      const json = { keywords: ['test'], entityTypes: [] };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.entityTypes).toBeUndefined();
    });

    it('lowercases keywords from LLM response', async () => {
      const json = { keywords: ['ENGINEER', 'Senior'] };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('find Senior ENGINEER');
      expect(result.keywords).toEqual(['engineer', 'senior']);
    });

    it('handles relations without target field', async () => {
      const json = { keywords: ['test'], relations: [{ type: 'works_on' }] };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.relations).toEqual([{ type: 'works_on' }]);
    });

    it('rejects non-integer limit', async () => {
      const json = { keywords: ['test'], limit: 3.7 };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.limit).toBeUndefined();
    });

    it('rejects non-positive limit', async () => {
      const json = { keywords: ['test'], limit: 0 };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.limit).toBeUndefined();
    });

    it('falls back when LLM returns JSON with empty keywords array after filtering', async () => {
      // All keyword entries are blank — sanitize should return null → fallback
      const json = { keywords: ['', '  ', ' '] };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('real query words here');
      // Should fall back to keyword extraction
      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.keywords).toContain('real');
    });

    it('parses JSON object embedded in surrounding text', async () => {
      const json = { keywords: ['embedded'] };
      // Response with text surrounding a JSON block (no code fence)
      const response = 'Here is my answer: ' + JSON.stringify(json) + ' end.';
      const provider = makeMockProvider(response);
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('embedded test');
      expect(result.keywords).toEqual(['embedded']);
    });

    it('falls back when LLM returns an array instead of an object', async () => {
      const provider = makeMockProvider(JSON.stringify([1, 2, 3]));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test array case');
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('ignores timeRange with non-parseable date strings', async () => {
      const json = { keywords: ['test'], timeRange: { start: 'not-a-date', end: 'also-bad' } };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.timeRange).toBeUndefined();
    });

    it('ignores timeRange with numeric values (non-string/non-Date)', async () => {
      const json = { keywords: ['test'], timeRange: { start: 12345, end: 67890 } };
      const provider = makeMockProvider(JSON.stringify(json));
      const planner = new LLMQueryPlanner({ llmProvider: provider });

      const result = await planner.planQuery('test');
      expect(result.timeRange).toBeUndefined();
    });
  });
});

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
});
