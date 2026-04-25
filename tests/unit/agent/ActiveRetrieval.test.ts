/**
 * 3B.5 — ActiveRetrievalController + QueryRewriter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { QueryRewriter, ActiveRetrievalController } from '../../../src/agent/retrieval/index.js';
import type { RankedSearch } from '../../../src/search/RankedSearch.js';
import type { SearchResult } from '../../../src/types/index.js';

// ==================== Helpers ====================

function searchResult(name: string, score: number, observations: string[]): SearchResult {
  return {
    entity: {
      name,
      entityType: 'doc',
      observations,
    },
    score,
    matchedTerms: [],
  } as unknown as SearchResult;
}

function makeMockRankedSearch(perQueryResults: Map<string, SearchResult[]>): RankedSearch {
  return {
    searchNodesRanked: vi.fn(async (query: string) => {
      // Longest-match wins. Sort keys by length desc so the most-
      // specific prefix is checked first.
      const keys = [...perQueryResults.keys()].sort((a, b) => b.length - a.length);
      for (const k of keys) {
        if (query === k || query.startsWith(k)) return perQueryResults.get(k)!;
      }
      return [];
    }),
  } as unknown as RankedSearch;
}

// ==================== QueryRewriter ====================

describe('3B.5 QueryRewriter', () => {
  const r = new QueryRewriter();

  it('extracts top co-occurring tokens from snippets', () => {
    const result = r.rewrite('fix bug', [
      'memory leak in worker pool',
      'memory consumption spikes during worker startup',
      'worker pool memory exhaustion',
    ]);
    expect(result.expansionTokens).toContain('memory');
    expect(result.expansionTokens).toContain('worker');
    expect(result.query).toMatch(/fix bug.*memory.*worker/i);
  });

  it('excludes query tokens from expansion', () => {
    const result = r.rewrite('memory leak', [
      'memory leak detected', // both query tokens; nothing to add
    ]);
    expect(result.expansionTokens).not.toContain('memory');
    expect(result.expansionTokens).not.toContain('leak');
  });

  it('excludes stopwords', () => {
    const result = r.rewrite('issue', [
      'the the the the the of the of', // pure stopwords
    ]);
    expect(result.expansionTokens).toEqual([]);
    expect(result.query).toBe('issue'); // unchanged
  });

  it('respects expansionLimit', () => {
    const result = r.rewrite('q', [
      'apple banana cherry date elderberry fig grape',
    ], 2);
    expect(result.expansionTokens).toHaveLength(2);
  });

  it('returns the original query unchanged when no candidates exist', () => {
    expect(r.rewrite('alpha', []).query).toBe('alpha');
    expect(r.rewrite('alpha', []).expansionTokens).toEqual([]);
  });

  it('counts each token at most once per snippet (co-occurrence-style)', () => {
    const result = r.rewrite('q', [
      'cat cat cat cat cat',
      'cat cat',
      'dog cat',
    ]);
    // 'cat' counted in 3 snippets; 'dog' in 1.
    expect(result.expansionTokens[0]).toBe('cat');
  });
});

// ==================== ActiveRetrievalController ====================

describe('3B.5 ActiveRetrievalController', () => {
  describe('shouldRetrieve', () => {
    it('rejects empty query', () => {
      const search = makeMockRankedSearch(new Map());
      const ctrl = new ActiveRetrievalController(search);
      expect(ctrl.shouldRetrieve({ query: '   ' }).retrieve).toBe(false);
    });

    it('grants when cost is within budget', () => {
      const search = makeMockRankedSearch(new Map());
      const ctrl = new ActiveRetrievalController(search, {
        costThreshold: 100000, maxRounds: 1, resultsPerRound: 1,
      });
      const decision = ctrl.shouldRetrieve({ query: 'simple short query' });
      expect(decision.retrieve).toBe(true);
    });

    it('denies when cost exceeds budget', () => {
      const search = makeMockRankedSearch(new Map());
      const ctrl = new ActiveRetrievalController(search, {
        costThreshold: 50, maxRounds: 5, resultsPerRound: 50,
      });
      expect(ctrl.shouldRetrieve({ query: 'q' }).retrieve).toBe(false);
    });

    it('per-call budgetTokens overrides config costThreshold', () => {
      const search = makeMockRankedSearch(new Map());
      const ctrl = new ActiveRetrievalController(search, { costThreshold: 50 });
      // Per-call budget high enough to grant
      expect(ctrl.shouldRetrieve({ query: 'q', budgetTokens: 100000 }).retrieve).toBe(true);
    });
  });

  describe('adaptiveRetrieve', () => {
    it('returns first-round results when coverage threshold is met immediately', async () => {
      const search = makeMockRankedSearch(new Map([
        ['initial', [searchResult('A', 0.9, ['foo'])]],
      ]));
      const ctrl = new ActiveRetrievalController(search, { minCoverage: 0.5 });
      const result = await ctrl.adaptiveRetrieve({ query: 'initial' });
      expect(result.rounds).toHaveLength(1);
      expect(result.bestCoverage).toBeGreaterThanOrEqual(0.5);
      expect(result.bestResults[0].entity.name).toBe('A');
    });

    it('runs additional rounds until threshold or maxRounds', async () => {
      const round1 = [searchResult('A', 0.2, ['memory leak in worker'])];
      const round2 = [searchResult('B', 0.5, ['memory worker pool'])];
      const round3 = [searchResult('C', 0.8, ['memory worker'])];
      // The rewriter will expand the query each round; we approximate by
      // matching on prefix to make the tracker behave.
      const search = makeMockRankedSearch(new Map([
        ['initial', round1],
        ['initial m', round2], // after first expansion
        ['initial me', round3], // after second expansion
      ]));
      const ctrl = new ActiveRetrievalController(search, {
        maxRounds: 3, minCoverage: 0.7, resultsPerRound: 5,
      });
      const result = await ctrl.adaptiveRetrieve({ query: 'initial' });
      expect(result.rounds.length).toBeGreaterThanOrEqual(2);
      // Best coverage should reach the highest round's score (0.8 or 0.5).
      expect(result.bestCoverage).toBeGreaterThan(0.4);
    });

    it('stops early when no expansion tokens are available', async () => {
      const search = makeMockRankedSearch(new Map([
        ['initial', [searchResult('A', 0.1, ['initial'])]], // only stopwords / query terms
      ]));
      const ctrl = new ActiveRetrievalController(search, {
        maxRounds: 5, minCoverage: 0.99,
      });
      const result = await ctrl.adaptiveRetrieve({ query: 'initial' });
      expect(result.rounds).toHaveLength(1); // first round + no expansion → stop
    });

    it('stops early when zero results returned', async () => {
      const search = makeMockRankedSearch(new Map());
      const ctrl = new ActiveRetrievalController(search);
      const result = await ctrl.adaptiveRetrieve({ query: 'nothing' });
      expect(result.rounds).toHaveLength(1);
      expect(result.bestResults).toEqual([]);
      expect(result.bestCoverage).toBe(0);
    });

    it('returns the highest-coverage round even when later rounds underperform', async () => {
      const search = makeMockRankedSearch(new Map([
        ['q', [searchResult('best', 0.9, ['memory'])]],
        ['q m', [searchResult('worse', 0.3, ['something'])]],
      ]));
      const ctrl = new ActiveRetrievalController(search, {
        maxRounds: 2, minCoverage: 0.99, // never met
      });
      const result = await ctrl.adaptiveRetrieve({ query: 'q' });
      // Even though we ran 2 rounds, bestResults should be from round 1.
      expect(result.bestResults[0].entity.name).toBe('best');
    });
  });
});
