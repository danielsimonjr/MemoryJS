/**
 * GraphRankPrior Unit Tests
 *
 * Graph connectivity as a first-class ranking signal: normalized scores,
 * caching, event-driven invalidation, degree-only fallback, and dispose.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity, Relation } from '../../../src/types/index.js';

const createEntity = (name: string): Entity => ({
  name,
  entityType: 'test',
  observations: [`Observation for ${name}`],
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
});

const createRelation = (from: string, to: string): Relation => ({
  from,
  to,
  relationType: 'links_to',
});

/**
 * Minimal in-memory stand-in for GraphStorage — implements the three methods
 * GraphTraversal needs (loadGraph, getRelationsFrom, getRelationsTo).
 */
function makeFakeStorage(entities: Entity[], relations: Relation[]): GraphStorage {
  return {
    loadGraph: async () => ({ entities, relations }),
    getRelationsFrom: (name: string) => relations.filter(r => r.from === name),
    getRelationsTo: (name: string) => relations.filter(r => r.to === name),
  } as unknown as GraphStorage;
}

/** Hub receives links from A, B, C; Lone is isolated. */
function makeHubGraph(): { entities: Entity[]; relations: Relation[] } {
  return {
    entities: ['Hub', 'A', 'B', 'C', 'Lone'].map(createEntity),
    relations: [
      createRelation('A', 'Hub'),
      createRelation('B', 'Hub'),
      createRelation('C', 'Hub'),
    ],
  };
}

describe('GraphRankPrior', () => {
  describe('normalized scores', () => {
    it('should return min-max normalized PageRank scores in [0, 1]', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const prior = new GraphRankPrior(traversal);

      const scores = await prior.getScores(['Hub', 'A', 'B', 'C', 'Lone']);

      for (const score of scores.values()) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
      // Hub has all incoming links: highest PageRank -> normalizes to 1
      expect(scores.get('Hub')).toBe(1);
      // Hub strictly outranks the isolated entity
      expect(scores.get('Hub')!).toBeGreaterThan(scores.get('Lone')!);
    });

    it('should map unknown entity names to 0', async () => {
      const { entities, relations } = makeHubGraph();
      const prior = new GraphRankPrior(
        new GraphTraversal(makeFakeStorage(entities, relations))
      );

      const scores = await prior.getScores(['NoSuchEntity']);
      expect(scores.get('NoSuchEntity')).toBe(0);
    });

    it('should accept a GraphStorage directly (wrapping it in a traversal)', async () => {
      const { entities, relations } = makeHubGraph();
      const prior = new GraphRankPrior(makeFakeStorage(entities, relations));

      const scores = await prior.getScores(['Hub', 'Lone']);
      expect(scores.get('Hub')!).toBeGreaterThan(scores.get('Lone')!);
    });

    it('should handle an empty graph', async () => {
      const prior = new GraphRankPrior(new GraphTraversal(makeFakeStorage([], [])));
      const scores = await prior.getScores(['Anything']);
      expect(scores.get('Anything')).toBe(0);
    });
  });

  describe('getPageRank and getDegree', () => {
    it('should return raw PageRank and raw degree per entity', async () => {
      const { entities, relations } = makeHubGraph();
      const prior = new GraphRankPrior(
        new GraphTraversal(makeFakeStorage(entities, relations))
      );

      // Raw degree: Hub touches 3 relations, A touches 1, Lone touches 0
      expect(await prior.getDegree('Hub')).toBe(3);
      expect(await prior.getDegree('A')).toBe(1);
      expect(await prior.getDegree('Lone')).toBe(0);

      // Raw PageRank: positive for all, highest for Hub
      const hubRank = await prior.getPageRank('Hub');
      const loneRank = await prior.getPageRank('Lone');
      expect(hubRank).toBeGreaterThan(loneRank);
      expect(loneRank).toBeGreaterThan(0);

      // Unknown entities
      expect(await prior.getPageRank('Nope')).toBe(0);
      expect(await prior.getDegree('Nope')).toBe(0);
    });
  });

  describe('caching', () => {
    it('should compute once and serve subsequent calls from cache', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const pageRankSpy = vi.spyOn(traversal, 'calculatePageRank');
      const degreeSpy = vi.spyOn(traversal, 'calculateDegreeCentrality');
      const prior = new GraphRankPrior(traversal);

      await prior.getScores(['Hub']);
      await prior.getScores(['A', 'Lone']);
      await prior.getPageRank('Hub');
      await prior.getDegree('B');

      expect(pageRankSpy).toHaveBeenCalledTimes(1);
      expect(degreeSpy).toHaveBeenCalledTimes(1);
    });

    it('should share a single computation between concurrent callers', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const pageRankSpy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal);

      await Promise.all([prior.getScores(['Hub']), prior.getScores(['Lone'])]);

      expect(pageRankSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('event-driven invalidation', () => {
    it('should recompute after entity events', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);

      // No recompute without a mutation
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);

      events.emitEntityCreated(createEntity('New'));
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);

      events.emitEntityUpdated('Hub', {});
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(3);

      events.emitEntityDeleted('Lone');
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it('should recompute after relation events', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);

      events.emitRelationCreated(createRelation('Lone', 'Hub'));
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);

      events.emitRelationDeleted('Lone', 'Hub', 'links_to');
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('degree-only fallback', () => {
    it('should skip PageRank beyond maxPageRankEntities and use degree', async () => {
      const { entities, relations } = makeHubGraph(); // 5 entities
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const pageRankSpy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { maxPageRankEntities: 2 });

      const scores = await prior.getScores(['Hub', 'A', 'Lone']);

      expect(pageRankSpy).not.toHaveBeenCalled();
      expect(prior.isDegreeFallback()).toBe(true);
      // Degree-based normalization: Hub (degree 3) -> 1, Lone (degree 0) -> 0
      expect(scores.get('Hub')).toBe(1);
      expect(scores.get('Lone')).toBe(0);
      expect(scores.get('A')!).toBeGreaterThan(0);
      expect(scores.get('A')!).toBeLessThan(1);
      // Raw PageRank unavailable in fallback mode
      expect(await prior.getPageRank('Hub')).toBe(0);
      // Raw degree still available
      expect(await prior.getDegree('Hub')).toBe(3);
    });

    it('should use PageRank when the graph is within the threshold', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const pageRankSpy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { maxPageRankEntities: 5 });

      await prior.getScores(['Hub']);

      expect(pageRankSpy).toHaveBeenCalledTimes(1);
      expect(prior.isDegreeFallback()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from events so mutations no longer invalidate', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(events.listenerCount('entity:created')).toBeGreaterThan(0);

      prior.dispose();
      expect(events.listenerCount('entity:created')).toBe(0);

      // dispose() drops the cache, so one recompute happens on next access...
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);

      // ...but graph events no longer trigger invalidation
      events.emitEntityCreated(createEntity('AfterDispose'));
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('S4: update-event connectivity filtering', () => {
    it('should NOT invalidate on an observation-only update (cache object preserved)', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);
      const cacheBefore = (prior as unknown as { cache: object | null }).cache;
      expect(cacheBefore).not.toBeNull();

      // Observation content cannot change relations or entity membership.
      events.emitEntityUpdated('Hub', { observations: ['new observation'] });

      const scores = await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1); // no recompute
      // The cached scores are literally the same object — not a rebuild.
      expect((prior as unknown as { cache: object | null }).cache).toBe(cacheBefore);
      expect(scores.get('Hub')).toBe(1);
    });

    it('should NOT invalidate on tag/importance-only updates', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      events.emitEntityUpdated('Hub', { tags: ['t1'], importance: 9 });
      events.emitEntityUpdated(
        'Hub',
        { observations: ['x'] },
        { observations: ['Observation for Hub'] }
      );
      await prior.getScores(['Hub']);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should invalidate when an update touches the name field', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      events.emitEntityUpdated('Hub', { name: 'RenamedHub' });
      await prior.getScores(['Hub']);

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should invalidate conservatively when the update carries no field information', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      events.emitEntityUpdated('Hub', {}); // empty changes, no previousValues
      await prior.getScores(['Hub']);

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should still invalidate on relation events', async () => {
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, { events });

      await prior.getScores(['Hub']);
      events.emitRelationCreated(createRelation('Lone', 'Hub'));
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);

      events.emitRelationDeleted('Lone', 'Hub', 'links_to');
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('S4: invalidation debounce', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should coalesce N invalidations in the window into one recompute and serve the stale cache meanwhile', async () => {
      vi.useFakeTimers();
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, {
        events,
        invalidationDebounceMs: 100,
      });

      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);
      const cacheBefore = (prior as unknown as { cache: object | null }).cache;

      // N invalidation triggers within the window
      for (let i = 0; i < 5; i++) {
        events.emitRelationCreated(createRelation('Lone', `N${i}`));
      }

      // Inside the window: stale cache is served, no recompute yet.
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((prior as unknown as { cache: object | null }).cache).toBe(cacheBefore);

      // Window elapses: the coalesced invalidation fires once.
      vi.advanceTimersByTime(100);
      expect((prior as unknown as { cache: object | null }).cache).toBeNull();

      await prior.getScores(['Hub']);
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2); // exactly one recompute for all 5 events
    });

    it('should open a new window for events after the previous one fired', async () => {
      vi.useFakeTimers();
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const spy = vi.spyOn(traversal, 'calculatePageRank');
      const prior = new GraphRankPrior(traversal, {
        events,
        invalidationDebounceMs: 50,
      });

      await prior.getScores(['Hub']);
      events.emitRelationCreated(createRelation('A', 'B'));
      vi.advanceTimersByTime(50);
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(2);

      events.emitRelationCreated(createRelation('B', 'C'));
      vi.advanceTimersByTime(50);
      await prior.getScores(['Hub']);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('should keep direct invalidate() immediate even with a debounce configured', async () => {
      vi.useFakeTimers();
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const prior = new GraphRankPrior(traversal, {
        events: new GraphEventEmitter(),
        invalidationDebounceMs: 100,
      });

      await prior.getScores(['Hub']);
      expect((prior as unknown as { cache: object | null }).cache).not.toBeNull();
      prior.invalidate();
      expect((prior as unknown as { cache: object | null }).cache).toBeNull();
    });

    it('should cancel a pending debounced invalidation on dispose', async () => {
      vi.useFakeTimers();
      const { entities, relations } = makeHubGraph();
      const traversal = new GraphTraversal(makeFakeStorage(entities, relations));
      const events = new GraphEventEmitter();
      const prior = new GraphRankPrior(traversal, {
        events,
        invalidationDebounceMs: 100,
      });

      await prior.getScores(['Hub']);
      events.emitRelationCreated(createRelation('A', 'B'));
      prior.dispose();

      // Advancing past the window must not throw or resurrect the timer.
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      expect(events.listenerCount('relation:created')).toBe(0);
    });
  });

  describe('neighbors', () => {
    it('should return unique one-hop neighbors in both directions', () => {
      const entities = ['A', 'B', 'C'].map(createEntity);
      const relations = [
        createRelation('A', 'B'),
        createRelation('C', 'A'),
        createRelation('A', 'B'), // duplicate edge
      ];
      const prior = new GraphRankPrior(
        new GraphTraversal(makeFakeStorage(entities, relations))
      );

      const neighbors = prior.neighbors('A');
      expect(neighbors.sort()).toEqual(['B', 'C']);
    });
  });
});
