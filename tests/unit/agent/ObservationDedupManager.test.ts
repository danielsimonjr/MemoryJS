/**
 * ObservationDedupManager — Phase A unit tests.
 *
 * Covers:
 * - exact-tier finds verbatim duplicate observations across entities
 * - entityType / projectId / sessionId filters
 * - minOccurrences threshold
 * - maxGroups circuit-breaker
 * - Jaccard tier (separate method) finds near-duplicates exact misses
 * - empty input / single-occurrence input does not crash
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationDedupManager } from '../../../src/agent/ObservationDedupManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';

function createMockStorage(entities: Entity[]): IGraphStorage {
  return {
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: [...entities], relations: [] };
    },
  } as unknown as IGraphStorage;
}

function makeEntity(
  name: string,
  observations: string[],
  overrides: Partial<Entity> = {},
): Entity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'person',
    observations,
    createdAt: now,
    lastModified: now,
    importance: 5,
    ...overrides,
  } as Entity;
}

describe('ObservationDedupManager', () => {
  it('finds verbatim duplicates across entities (exact tier)', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['Prefers Italian food', 'Lives in Boston']),
      makeEntity('Bob', ['Prefers Italian food', 'Works at Acme']),
      makeEntity('Carol', ['Drives a sedan']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations();
    expect(groups).toHaveLength(1);
    // `observation` is the canonical (lowercase, whitespace-collapsed)
    // form; the original casing lives on each occurrence's source entity.
    expect(groups[0]!.observation).toBe('prefers italian food');
    expect(groups[0]!.tier).toBe('exact');
    expect(groups[0]!.occurrences).toHaveLength(2);
    expect(groups[0]!.occurrences.map((o) => o.entityName).sort()).toEqual(['Alice', 'Bob']);
  });

  it('returns empty when no observation appears more than once', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['A unique observation']),
      makeEntity('Bob', ['A different observation']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    expect(await mgr.findDuplicateObservations()).toEqual([]);
  });

  it('handles an empty graph without crashing', async () => {
    const storage = createMockStorage([]);
    const mgr = new ObservationDedupManager(storage);
    expect(await mgr.findDuplicateObservations()).toEqual([]);
  });

  it('respects entityType filter (single value)', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['shared text'], { entityType: 'person' }),
      makeEntity('Bob', ['shared text'], { entityType: 'person' }),
      makeEntity('ProjectX', ['shared text'], { entityType: 'project' }),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations({ entityType: 'person' });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toHaveLength(2);
    expect(groups[0]!.occurrences.map((o) => o.entityName).sort()).toEqual(['Alice', 'Bob']);
  });

  it('respects entityType filter (array)', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['shared text'], { entityType: 'person' }),
      makeEntity('ProjectX', ['shared text'], { entityType: 'project' }),
      makeEntity('ProjectY', ['shared text'], { entityType: 'project' }),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations({ entityType: ['person', 'project'] });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toHaveLength(3);
  });

  it('respects projectId filter', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['shared'], { projectId: 'p1' } as unknown as Partial<Entity>),
      makeEntity('Bob', ['shared'], { projectId: 'p1' } as unknown as Partial<Entity>),
      makeEntity('Carol', ['shared'], { projectId: 'p2' } as unknown as Partial<Entity>),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations({ projectId: 'p1' });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toHaveLength(2);
  });

  it('respects minOccurrences threshold (default 2)', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['twice']),
      makeEntity('Bob', ['twice']),
      makeEntity('Carol', ['thrice']),
      makeEntity('Dan', ['thrice']),
      makeEntity('Eve', ['thrice']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations({ minOccurrences: 3 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.observation).toBe('thrice');
  });

  it('respects maxGroups circuit-breaker', async () => {
    const storage = createMockStorage([
      makeEntity('A1', ['x1']),
      makeEntity('A2', ['x1']),
      makeEntity('B1', ['x2']),
      makeEntity('B2', ['x2']),
      makeEntity('C1', ['x3']),
      makeEntity('C2', ['x3']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations({ maxGroups: 2 });
    expect(groups).toHaveLength(2);
  });

  it('sorts groups by occurrence count descending', async () => {
    const storage = createMockStorage([
      makeEntity('A1', ['small-group']),
      makeEntity('A2', ['small-group']),
      makeEntity('B1', ['big-group']),
      makeEntity('B2', ['big-group']),
      makeEntity('B3', ['big-group']),
      makeEntity('B4', ['big-group']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations();
    expect(groups[0]!.observation).toBe('big-group');
    expect(groups[0]!.occurrences).toHaveLength(4);
    expect(groups[1]!.observation).toBe('small-group');
  });

  it('records observationIndex correctly for each occurrence', async () => {
    const storage = createMockStorage([
      makeEntity('Alice', ['first', 'shared text', 'third']),
      makeEntity('Bob', ['shared text', 'second']),
    ]);
    const mgr = new ObservationDedupManager(storage);
    const groups = await mgr.findDuplicateObservations();
    expect(groups).toHaveLength(1);
    const aliceOcc = groups[0]!.occurrences.find((o) => o.entityName === 'Alice')!;
    const bobOcc = groups[0]!.occurrences.find((o) => o.entityName === 'Bob')!;
    expect(aliceOcc.observationIndex).toBe(1);
    expect(bobOcc.observationIndex).toBe(0);
  });

  describe('findJaccardDuplicates', () => {
    it('finds near-duplicates that exact tier misses', async () => {
      const storage = createMockStorage([
        makeEntity('Alice', ['User prefers Italian food']),
        makeEntity('Bob', ['User prefers italian food']), // case variation
        makeEntity('Carol', ['Completely different observation here']),
      ]);
      const mgr = new ObservationDedupManager(storage, { jaccardThreshold: 0.85 });
      const groups = await mgr.findJaccardDuplicates();
      expect(groups.length).toBeGreaterThan(0);
      // The near-pair forms one group
      const grp = groups.find((g) =>
        g.occurrences.some((o) => o.entityName === 'Alice') &&
        g.occurrences.some((o) => o.entityName === 'Bob'),
      );
      expect(grp).toBeDefined();
      expect(grp!.tier).toBe('jaccard');
    });

    it('respects jaccardThreshold (high threshold rejects loose matches)', async () => {
      const storage = createMockStorage([
        makeEntity('Alice', ['the cat sat on the mat']),
        makeEntity('Bob', ['the dog ran in the park']),
      ]);
      const mgr = new ObservationDedupManager(storage, { jaccardThreshold: 0.9 });
      const groups = await mgr.findJaccardDuplicates();
      expect(groups).toEqual([]);
    });
  });
});
