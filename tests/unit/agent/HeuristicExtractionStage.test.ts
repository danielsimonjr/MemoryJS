/**
 * HeuristicExtractionStage — Phase 3B.8b unit tests.
 *
 * Covers:
 * - resolved-failure → heuristic extraction
 * - qualifying-reflection → one heuristic per keyInsight
 * - skip rules: open failures, archived reflections, low-confidence
 *   reflections, missing experienceType, missing alternative_taken
 * - content-hash idempotency across re-runs
 * - maxPerRun circuit-breaker
 * - runOnResolution scopes to one failure (ignores reflections)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeuristicExtractionStage } from '../../../src/agent/ConsolidationPipeline.js';
import { HeuristicManager } from '../../../src/agent/HeuristicManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';
import type {
  ConsolidateOptions,
  FailureEntity,
  ReflectionEntity,
} from '../../../src/types/agent-memory.js';
import { VersionConflictError, EntityNotFoundError } from '../../../src/utils/errors.js';

function createMockStorage(): IGraphStorage & { _entities: Map<string, Entity> } {
  const entities = new Map<string, Entity>();
  return {
    _entities: entities,
    async appendEntity(entity: Entity) {
      entities.set(entity.name, entity);
    },
    async updateEntity(name: string, updates: Partial<Entity>): Promise<boolean> {
      const cur = entities.get(name);
      if (!cur) return false;
      entities.set(name, { ...cur, ...updates });
      return true;
    },
    getEntityByName(name: string): Entity | undefined {
      return entities.get(name);
    },
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    async getGraphForMutation() {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    async saveGraph(g: KnowledgeGraph) {
      entities.clear();
      for (const e of g.entities) entities.set(e.name, e);
    },
  } as unknown as IGraphStorage & { _entities: Map<string, Entity> };
}

function createFakeEntityManager(storage: IGraphStorage): EntityManager {
  return {
    updateEntity: vi.fn(async (
      name: string,
      updates: Partial<Entity>,
      options?: { expectedVersion?: number },
    ) => {
      const entity = storage.getEntityByName(name);
      if (!entity) throw new EntityNotFoundError(name);
      if (options?.expectedVersion !== undefined) {
        const live = entity.version ?? 1;
        if (live !== options.expectedVersion) {
          throw new VersionConflictError(name, options.expectedVersion, live);
        }
      }
      const merged: Partial<Entity> = { ...updates };
      if (options?.expectedVersion !== undefined) {
        merged.version = (entity.version ?? 1) + 1;
      }
      const ok = await storage.updateEntity(name, merged);
      if (!ok) throw new EntityNotFoundError(name);
      return { ...entity, ...merged } as Entity;
    }),
    deleteEntities: vi.fn(),
  } as unknown as EntityManager;
}

function makeResolvedFailure(
  name: string,
  applicability_hint: string,
  attempted: string,
  alternative_taken: string,
  resolvedReason: string,
): FailureEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'failure',
    observations: [],
    createdAt: now,
    lastModified: now,
    importance: 7,
    memoryType: 'failure',
    visibility: 'private',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    failureRecord: {
      id: name,
      timestamp: now,
      context: `context for ${name}`,
      attempted,
      failure_mode: 'fm',
      root_cause: 'rc',
      alternative_taken,
      applicability_hint,
      lifecycle: { status: 'resolved', resolvedAt: now, resolvedReason },
    },
  } as FailureEntity;
}

function makeOpenFailure(name: string, applicability_hint: string): FailureEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'failure',
    observations: [],
    createdAt: now,
    lastModified: now,
    importance: 7,
    memoryType: 'failure',
    visibility: 'private',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    failureRecord: {
      id: name,
      timestamp: now,
      context: 'c',
      attempted: 'a',
      failure_mode: 'fm',
      root_cause: 'rc',
      applicability_hint,
      lifecycle: { status: 'open' },
    },
  } as FailureEntity;
}

function makeReflection(
  name: string,
  summary: string,
  keyInsights: string[],
  confidence: number,
  experienceType: string | undefined,
  archived = false,
): ReflectionEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'reflection',
    observations: [`[reflection:session] ${summary}`],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'reflection',
    visibility: 'private',
    accessCount: 0,
    confidence,
    confirmationCount: 0,
    reflectionRecord: {
      id: name,
      timestamp: now,
      scope: 'session',
      summary,
      keyInsights,
      evidence: ['e1'],
      generalization_confidence: confidence,
      experienceType,
      evidenceHash: 'stub-hash',
      archived,
    },
  } as ReflectionEntity;
}

const emptyOptions: ConsolidateOptions = {} as ConsolidateOptions;

describe('HeuristicExtractionStage', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let manager: HeuristicManager;
  let stage: HeuristicExtractionStage;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    manager = new HeuristicManager(storage, entityManager);
    stage = new HeuristicExtractionStage(storage, manager);
  });

  it('extracts a heuristic from a resolved failure with alternative_taken', async () => {
    storage._entities.set(
      'failure-1',
      makeResolvedFailure(
        'failure-1',
        'Setting up password hashing for auth flows',
        'bcrypt.hash with default salt rounds',
        'argon2id with sensible memory cost',
        'upgraded to argon2id',
      ),
    );

    const result = await stage.process([], emptyOptions);
    expect(result.processed).toBe(1);
    expect(result.transformed).toBe(1);

    const all = await manager.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.condition).toBe('Setting up password hashing for auth flows');
    expect(all[0]!.action).toMatch(/^Avoid: /);
    expect(all[0]!.action).toMatch(/Prefer: argon2id/);
    expect(all[0]!.confidence).toBeCloseTo(0.6, 5);
  });

  it('skips open failures, archived reflections, and reflections without experienceType', async () => {
    storage._entities.set('failure-open', makeOpenFailure('failure-open', 'something'));
    storage._entities.set(
      'reflection-archived',
      makeReflection('reflection-archived', 'summary', ['insight'], 0.9, 'heuristic', true),
    );
    storage._entities.set(
      'reflection-no-type',
      makeReflection('reflection-no-type', 'summary', ['insight'], 0.9, undefined),
    );

    const result = await stage.process([], emptyOptions);
    expect(result.processed).toBe(0);
    expect(result.transformed).toBe(0);
    expect(await manager.size()).toBe(0);
  });

  it('extracts one heuristic per keyInsight from a qualifying reflection', async () => {
    storage._entities.set(
      'reflection-1',
      makeReflection(
        'reflection-1',
        'Morning planning then afternoon execution',
        ['Plan before coding', 'Break tasks into 30-min chunks', 'Review at end of session'],
        0.85,
        'heuristic',
      ),
    );

    const result = await stage.process([], emptyOptions);
    expect(result.processed).toBe(1);
    expect(result.transformed).toBe(3);
    expect(await manager.size()).toBe(3);
    const all = await manager.list();
    const actions = all.map((h) => h.action).sort();
    expect(actions).toEqual([
      'Break tasks into 30-min chunks',
      'Plan before coding',
      'Review at end of session',
    ]);
    // Confidence capped at reflectionConfidenceCap (0.7) even though
    // generalization_confidence is 0.85.
    for (const h of all) expect(h.confidence).toBeCloseTo(0.7, 5);
  });

  it('skips low-confidence reflections (below minConfidence)', async () => {
    storage._entities.set(
      'reflection-low',
      makeReflection('reflection-low', 'summary', ['insight'], 0.2, 'heuristic'),
    );

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
  });

  it('is idempotent: re-running over the same sources produces no duplicates', async () => {
    storage._entities.set(
      'failure-1',
      makeResolvedFailure('failure-1', 'a hint', 'old way', 'new way', 'reason'),
    );

    await stage.process([], emptyOptions);
    const second = await stage.process([], emptyOptions);
    expect(second.processed).toBe(1);
    expect(second.transformed).toBe(0); // second run found existing entity, no new write
    expect(await manager.size()).toBe(1);
  });

  it('respects maxPerRun circuit-breaker', async () => {
    for (let i = 0; i < 10; i++) {
      storage._entities.set(
        `f-${i}`,
        makeResolvedFailure(`f-${i}`, `hint ${i}`, `attempted ${i}`, `alt ${i}`, 'reason'),
      );
    }
    const cappedStage = new HeuristicExtractionStage(storage, manager, { maxPerRun: 3 });
    const result = await cappedStage.process([], emptyOptions);
    expect(result.transformed).toBe(3);
    expect(await manager.size()).toBe(3);
  });

  it('runOnResolution scopes to the named failure and ignores reflections', async () => {
    storage._entities.set(
      'failure-target',
      makeResolvedFailure('failure-target', 'target hint', 'old', 'new', 'reason'),
    );
    storage._entities.set(
      'failure-other',
      makeResolvedFailure('failure-other', 'other hint', 'o', 'p', 'reason'),
    );
    storage._entities.set(
      'reflection-1',
      makeReflection('reflection-1', 'summary', ['should not appear'], 0.9, 'heuristic'),
    );

    const result = await stage.runOnResolution('failure-target');
    expect(result.processed).toBe(1);
    expect(result.transformed).toBe(1);
    const all = await manager.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.condition).toBe('target hint');
  });

  it('runOnResolution throws on empty failureId', async () => {
    await expect(stage.runOnResolution('')).rejects.toThrow(/non-empty string/);
    await expect(stage.runOnResolution('   ')).rejects.toThrow(/non-empty string/);
  });
});
