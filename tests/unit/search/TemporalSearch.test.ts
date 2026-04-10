/**
 * Unit tests for TemporalSearch
 *
 * Feature 3 (Must-Have): Temporal Range Queries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemporalSearch } from '../../../src/search/TemporalSearch.js';
import { TemporalQueryParser } from '../../../src/search/TemporalQueryParser.js';
import type { ParsedTemporalRange } from '../../../src/search/TemporalQueryParser.js';
import type { Entity } from '../../../src/types/index.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';

// ==================== Mock storage ====================

/**
 * Create a minimal mock of IGraphStorage that returns a fixed graph.
 */
function createMockStorage(entities: Entity[]) {
  const graph: KnowledgeGraph = { entities, relations: [] };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
  };
}

// ==================== Fixtures ====================

/**
 * Reference time: 2024-06-15 12:00:00 UTC
 */
const REF_TIME = new Date('2024-06-15T12:00:00.000Z');

/** Entity created 5 minutes ago */
const ENTITY_5MIN_AGO: Entity = {
  name: 'recent_5min',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() - 5 * 60_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() - 5 * 60_000).toISOString(),
};

/** Entity created 30 minutes ago */
const ENTITY_30MIN_AGO: Entity = {
  name: 'recent_30min',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() - 30 * 60_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() - 30 * 60_000).toISOString(),
};

/** Entity created 2 hours ago */
const ENTITY_2H_AGO: Entity = {
  name: 'older_2h',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() - 2 * 3_600_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() - 2 * 3_600_000).toISOString(),
};

/** Entity created 3 days ago */
const ENTITY_3DAYS_AGO: Entity = {
  name: 'older_3days',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() - 3 * 24 * 3_600_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() - 3 * 24 * 3_600_000).toISOString(),
};

/** Entity created in the future (1 hour after ref) */
const ENTITY_FUTURE: Entity = {
  name: 'future_1h',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() + 1 * 3_600_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() + 1 * 3_600_000).toISOString(),
};

/** Entity with no timestamps */
const ENTITY_NO_TIMESTAMP: Entity = {
  name: 'undated',
  entityType: 'test',
  observations: [],
};

/** Entity with only lastModified (no createdAt) */
const ENTITY_MODIFIED_ONLY: Entity = {
  name: 'modified_only',
  entityType: 'test',
  observations: [],
  lastModified: new Date(REF_TIME.getTime() - 10 * 60_000).toISOString(),
};

/** Entity with createdAt inside range but lastModified outside */
const ENTITY_CREATED_IN_MODIFIED_OUT: Entity = {
  name: 'created_in_modified_out',
  entityType: 'test',
  observations: [],
  createdAt: new Date(REF_TIME.getTime() - 20 * 60_000).toISOString(),
  lastModified: new Date(REF_TIME.getTime() - 120 * 60_000).toISOString(), // 2h ago - outside 1h range
};

const ALL_ENTITIES = [
  ENTITY_5MIN_AGO,
  ENTITY_30MIN_AGO,
  ENTITY_2H_AGO,
  ENTITY_3DAYS_AGO,
  ENTITY_FUTURE,
  ENTITY_NO_TIMESTAMP,
  ENTITY_MODIFIED_ONLY,
  ENTITY_CREATED_IN_MODIFIED_OUT,
];

// ==================== Helper to build ranges ====================

/**
 * Build a ParsedTemporalRange relative to REF_TIME.
 */
function range(startMsOffset: number, endMsOffset: number = 0): ParsedTemporalRange {
  return {
    start: new Date(REF_TIME.getTime() + startMsOffset),
    end: new Date(REF_TIME.getTime() + endMsOffset),
    originalExpression: 'test',
  };
}

// ==================== Tests ====================

describe('TemporalSearch', () => {
  let search: TemporalSearch;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage(ALL_ENTITIES);
    search = new TemporalSearch(storage as any);
  });

  // ==================== Entities within range ====================

  describe('entities within range', () => {
    it('should return only entities within the range', async () => {
      // Range: last 60 minutes
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r);

      const names = results.map(e => e.name);
      expect(names).toContain('recent_5min');
      expect(names).toContain('recent_30min');
      expect(names).toContain('modified_only'); // lastModified within range
    });

    it('should exclude entities outside the range', async () => {
      // Range: last 60 minutes
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r);

      const names = results.map(e => e.name);
      expect(names).not.toContain('older_2h');
      expect(names).not.toContain('older_3days');
    });

    it('should include entity exactly at start boundary', async () => {
      // Range starts exactly when ENTITY_2H_AGO was created
      const r: ParsedTemporalRange = {
        start: new Date(ENTITY_2H_AGO.createdAt!),
        end: new Date(REF_TIME),
        originalExpression: 'test',
      };
      const results = await search.searchByTimeRange(r);
      const names = results.map(e => e.name);
      expect(names).toContain('older_2h');
    });

    it('should include entity exactly at end boundary', async () => {
      const r: ParsedTemporalRange = {
        start: new Date(REF_TIME.getTime() - 10 * 3_600_000),
        end: new Date(ENTITY_2H_AGO.createdAt!),
        originalExpression: 'test',
      };
      const results = await search.searchByTimeRange(r);
      const names = results.map(e => e.name);
      expect(names).toContain('older_2h');
    });
  });

  // ==================== Entities outside range ====================

  describe('entities outside range', () => {
    it('should return empty array for a future range', async () => {
      // Range entirely in the future
      const r = range(1 * 3_600_000, 2 * 3_600_000);
      const results = await search.searchByTimeRange(r);
      // Only ENTITY_FUTURE has a timestamp at +1h which is at the boundary
      const names = results.map(e => e.name);
      expect(names).not.toContain('recent_5min');
      expect(names).not.toContain('older_2h');
    });

    it('should return empty array when range is before all entities', async () => {
      // Range: a week ago to 4 days ago
      const r = range(
        -7 * 24 * 3_600_000,
        -4 * 24 * 3_600_000
      );
      const results = await search.searchByTimeRange(r);
      const names = results.map(e => e.name);
      expect(names).not.toContain('recent_5min');
      expect(names).not.toContain('recent_30min');
      expect(names).not.toContain('older_2h');
    });
  });

  // ==================== Empty result for future range ====================

  describe('empty result for future range', () => {
    it('should return [] for a range entirely in the future', async () => {
      const r = range(2 * 3_600_000, 5 * 3_600_000);
      const results = await search.searchByTimeRange(r);
      expect(results).toHaveLength(0);
    });
  });

  // ==================== createdAt vs lastModified filtering ====================

  describe('field filtering', () => {
    it('should filter only by createdAt when field="createdAt"', async () => {
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { field: 'createdAt' });
      const names = results.map(e => e.name);

      // ENTITY_MODIFIED_ONLY has no createdAt, should be excluded
      expect(names).not.toContain('modified_only');

      // ENTITY_5MIN_AGO and ENTITY_30MIN_AGO have createdAt in range
      expect(names).toContain('recent_5min');
      expect(names).toContain('recent_30min');
    });

    it('should filter only by lastModified when field="lastModified"', async () => {
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { field: 'lastModified' });
      const names = results.map(e => e.name);

      // ENTITY_MODIFIED_ONLY has lastModified 10min ago, should be included
      expect(names).toContain('modified_only');
    });

    it('should filter by either field when field="any" (default)', async () => {
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { field: 'any' });
      const names = results.map(e => e.name);

      // Both timestamp-based fields are considered
      expect(names).toContain('modified_only'); // only lastModified set, in range
      expect(names).toContain('recent_5min');
    });

    it('should match entity where createdAt is in range but lastModified is out (field=createdAt)', async () => {
      // Range: last 60 minutes
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { field: 'createdAt' });
      const names = results.map(e => e.name);
      expect(names).toContain('created_in_modified_out');
    });

    it('should NOT match entity where only createdAt is in range when field=lastModified', async () => {
      // Range: last 60 minutes; ENTITY_CREATED_IN_MODIFIED_OUT has lastModified at -2h
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { field: 'lastModified' });
      const names = results.map(e => e.name);
      expect(names).not.toContain('created_in_modified_out');
    });
  });

  // ==================== Undated entities ====================

  describe('undated entities', () => {
    it('should exclude undated entities by default', async () => {
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r);
      const names = results.map(e => e.name);
      expect(names).not.toContain('undated');
    });

    it('should include undated entities when includeUndated=true', async () => {
      const r = range(-60 * 60_000, 0);
      const results = await search.searchByTimeRange(r, { includeUndated: true });
      const names = results.map(e => e.name);
      expect(names).toContain('undated');
    });
  });

  // ==================== Sort order ====================

  describe('sort order', () => {
    it('should return entities sorted oldest-first', async () => {
      // Range covering 5min, 30min, and 2h old entities
      const r = range(-3 * 3_600_000, 0);
      const results = await search.searchByTimeRange(r);

      const timestampedResults = results.filter(
        e => e.createdAt !== undefined
      );

      for (let i = 1; i < timestampedResults.length; i++) {
        const prev = new Date(timestampedResults[i - 1].createdAt!).getTime();
        const curr = new Date(timestampedResults[i].createdAt!).getTime();
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });
  });

  // ==================== searchByTimeQuery convenience method ====================

  describe('searchByTimeQuery', () => {
    it('should parse and search using a natural language query', async () => {
      // Force storage to return only the recent entities
      const recentStorage = createMockStorage([ENTITY_5MIN_AGO, ENTITY_30MIN_AGO, ENTITY_2H_AGO]);
      const recentSearch = new TemporalSearch(recentStorage as any);

      // Use a fixed reference so we can compute the expected range
      const results = await recentSearch.searchByTimeQuery(
        'last hour',
        {},
        REF_TIME
      );

      const names = results.map(e => e.name);
      expect(names).toContain('recent_5min');
      expect(names).toContain('recent_30min');
      expect(names).not.toContain('older_2h');
    });

    it('should return empty array for unparseable query', async () => {
      const results = await search.searchByTimeQuery('not a date expression at all xyz');
      expect(results).toEqual([]);
    });

    it('should return empty array for empty query', async () => {
      const results = await search.searchByTimeQuery('');
      expect(results).toEqual([]);
    });
  });

  // ==================== Storage calls ====================

  describe('storage interaction', () => {
    it('should call loadGraph once per searchByTimeRange', async () => {
      const r = range(-3_600_000, 0);
      await search.searchByTimeRange(r);
      expect(storage.loadGraph).toHaveBeenCalledOnce();
    });

    it('should call loadGraph once per searchByTimeQuery', async () => {
      await search.searchByTimeQuery('last hour', {}, REF_TIME);
      expect(storage.loadGraph).toHaveBeenCalledOnce();
    });
  });
});
