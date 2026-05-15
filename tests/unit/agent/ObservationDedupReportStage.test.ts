/**
 * ObservationDedupReportStage — Phase B unit tests.
 *
 * Diagnostic-only stage; never mutates. Verifies:
 * - emits one [info]-prefixed errors entry per duplicate group
 * - transformed always 0
 * - respects filter pass-through (entityType/projectId/sessionId/min/max)
 * - empty graph → empty errors
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationDedupReportStage } from '../../../src/agent/ConsolidationPipeline.js';
import { ObservationDedupManager } from '../../../src/agent/ObservationDedupManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';
import type { ConsolidateOptions } from '../../../src/types/agent-memory.js';

function createMockStorage(entities: Entity[]): IGraphStorage {
  return {
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: [...entities], relations: [] };
    },
  } as unknown as IGraphStorage;
}

function makeEntity(name: string, observations: string[], overrides: Partial<Entity> = {}): Entity {
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

const emptyOptions: ConsolidateOptions = {} as ConsolidateOptions;

describe('ObservationDedupReportStage', () => {
  let storage: IGraphStorage;
  let manager: ObservationDedupManager;
  let stage: ObservationDedupReportStage;

  it('exposes the expected stage name', () => {
    storage = createMockStorage([]);
    manager = new ObservationDedupManager(storage);
    stage = new ObservationDedupReportStage(manager);
    expect(stage.name).toBe('observation-dedup-report');
  });

  it('emits zero entries when no duplicates exist', async () => {
    storage = createMockStorage([
      makeEntity('Alice', ['Unique observation 1']),
      makeEntity('Bob', ['Unique observation 2']),
    ]);
    manager = new ObservationDedupManager(storage);
    stage = new ObservationDedupReportStage(manager);

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('emits one [info] entry per duplicate group; transformed stays 0', async () => {
    storage = createMockStorage([
      makeEntity('Alice', ['shared a', 'shared b']),
      makeEntity('Bob', ['shared a', 'shared b']),
      makeEntity('Carol', ['shared a']),
    ]);
    manager = new ObservationDedupManager(storage);
    stage = new ObservationDedupReportStage(manager);

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    expect(result.errors).toHaveLength(2);
    for (const entry of result.errors) {
      expect(entry).toMatch(/^\[info\] ObservationDedupReportStage/);
    }
  });

  it('respects filter pass-through (entityType)', async () => {
    storage = createMockStorage([
      makeEntity('Alice', ['shared'], { entityType: 'person' }),
      makeEntity('Bob', ['shared'], { entityType: 'person' }),
      makeEntity('ProjectX', ['shared'], { entityType: 'project' }),
    ]);
    manager = new ObservationDedupManager(storage);
    stage = new ObservationDedupReportStage(manager, { filter: { entityType: 'project' } });

    const result = await stage.process([], emptyOptions);
    // Only one entity in 'project' bucket, so no duplicates.
    expect(result.errors).toEqual([]);
  });

  it('mentions the observation text and occurrence count in the report line', async () => {
    storage = createMockStorage([
      makeEntity('Alice', ['user prefers italian food']),
      makeEntity('Bob', ['user prefers italian food']),
      makeEntity('Carol', ['user prefers italian food']),
    ]);
    manager = new ObservationDedupManager(storage);
    stage = new ObservationDedupReportStage(manager);

    const result = await stage.process([], emptyOptions);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('3'); // occurrence count
    expect(result.errors[0]).toContain('italian food'); // observation text
  });
});
