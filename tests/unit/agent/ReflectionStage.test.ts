/**
 * ReflectionStage — Phase 2 Sprint 8 Unit Tests
 *
 * Covers:
 * - empty-observation early return
 * - pattern-below-threshold skip
 * - happy path produces one ReflectionEntity per run
 * - confidence scoring combines pattern + compression
 * - runOnSessionEnd helper scopes to session entities
 * - error surfacing when create() throws
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReflectionStage } from '../../../src/agent/ConsolidationPipeline.js';
import { ReflectionManager } from '../../../src/agent/ReflectionManager.js';
import { PatternDetector } from '../../../src/agent/PatternDetector.js';
import { ExperienceExtractor } from '../../../src/agent/ExperienceExtractor.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { TrajectoryCompressor } from '../../../src/agent/TrajectoryCompressor.js';
import { VersionConflictError, EntityNotFoundError } from '../../../src/utils/errors.js';
import type { Entity, KnowledgeGraph, IGraphStorage } from '../../../src/types/types.js';
import type { ConsolidateOptions } from '../../../src/types/agent-memory.js';

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
  } as unknown as EntityManager;
}

function createMockStorage(): IGraphStorage & { _entities: Map<string, Entity> } {
  const entities = new Map<string, Entity>();
  return {
    _entities: entities,
    async appendEntity(entity: Entity) {
      entities.set(entity.name, entity);
    },
    async updateEntity(name: string, updates: Partial<Entity>): Promise<boolean> {
      const current = entities.get(name);
      if (!current) return false;
      entities.set(name, { ...current, ...updates });
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

function makeEpisodicEntity(
  name: string,
  observations: string[],
  sessionId = 'sess_1'
): Entity {
  return {
    name,
    entityType: 'event',
    observations,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    importance: 5,
    memoryType: 'episodic',
    sessionId,
    visibility: 'private',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
  } as Entity;
}

function makeTrajectoryCompressorStub(
  overrides: Partial<{
    summary: string;
    compressionRatio: number;
    keyFacts: string[];
  }> = {}
): TrajectoryCompressor {
  return {
    distill: vi.fn(async () => ({
      summary: overrides.summary ?? 'distilled summary',
      keyFacts: overrides.keyFacts ?? ['fact 1'],
      originalCount: 4,
      compressionRatio: overrides.compressionRatio ?? 0.4,
      preservedDetails: [],
      discardedDetails: [],
    })),
  } as unknown as TrajectoryCompressor;
}

const emptyOptions: ConsolidateOptions = {} as ConsolidateOptions;

describe('ReflectionStage', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let rm: ReflectionManager;
  let pd: PatternDetector;
  let tc: TrajectoryCompressor;
  let stage: ReflectionStage;

  beforeEach(() => {
    storage = createMockStorage();
    rm = new ReflectionManager(storage, createFakeEntityManager(storage));
    pd = new PatternDetector();
    tc = makeTrajectoryCompressorStub();
    stage = new ReflectionStage(storage, rm, pd, tc, { minConfidence: 0.4 });
  });

  it('exposes stage name', () => {
    expect(stage.name).toBe('reflection');
  });

  it('returns early with zero transformed when no episodic entities', async () => {
    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('returns early when no patterns meet minConfidence threshold', async () => {
    // Two entities with no shared structure
    storage._entities.set('e1', makeEpisodicEntity('e1', ['Singular fact about weather']));
    storage._entities.set('e2', makeEpisodicEntity('e2', ['Completely unrelated cooking note']));

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    // `[info]` prefix surfaces the skip reason without flagging a fatal
    // error — see ReflectionStage diagnostic contract.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^\[info\] ReflectionStage: skipped/);
    const reflections = await rm.list();
    expect(reflections).toHaveLength(0);
  });

  it('returns early with [info] error when no candidate entities exist', async () => {
    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    expect(result.processed).toBe(0);
    // Zero-candidate path stays errors=[] (it's a different signal from
    // "candidates existed but didn't qualify").
    expect(result.errors).toEqual([]);
  });

  it('throws when runOnSessionEnd is called with empty sessionId', async () => {
    await expect(stage.runOnSessionEnd('')).rejects.toThrow(/non-empty string/);
    await expect(stage.runOnSessionEnd('   ')).rejects.toThrow(/non-empty string/);
  });

  it('creates a ReflectionEntity when patterns meet threshold', async () => {
    // Five entities with a clear pattern: "User prefers X"
    for (let i = 0; i < 5; i++) {
      const cuisines = ['Italian', 'Mexican', 'Japanese', 'Thai', 'Indian'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`User prefers ${cuisines[i]} food`])
      );
    }

    const result = await stage.process([], emptyOptions);

    expect(result.transformed).toBe(1);
    expect(result.errors).toEqual([]);

    const reflections = await rm.list();
    expect(reflections).toHaveLength(1);
    expect(reflections[0].evidence.length).toBeGreaterThan(0);
    expect(reflections[0].scope).toBe('session');
  });

  it('confidence combines compression ratio and pattern confidence', async () => {
    for (let i = 0; i < 4; i++) {
      const variants = ['A', 'B', 'C', 'D'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`A common pattern with ${variants[i]} variant`])
      );
    }

    // High compression ratio = less compression = lower derived confidence component.
    tc = makeTrajectoryCompressorStub({ compressionRatio: 0.95 });
    stage = new ReflectionStage(storage, rm, pd, tc, { minConfidence: 0.0 });

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(1);
    const reflection = (await rm.list())[0];
    // min(1 - 0.95, patternConfidence). 1 - 0.95 = 0.05 (modulo float
    // precision; `toBeCloseTo` handles the IEEE-754 wobble).
    expect(reflection.generalization_confidence).toBeCloseTo(0.05, 2);
  });

  it('runOnSessionEnd scopes to entities from one session', async () => {
    // Two sessions' worth of pattern-bearing entities
    for (let i = 0; i < 4; i++) {
      const variants = ['A', 'B', 'C', 'D'];
      storage._entities.set(
        `s1_e${i}`,
        makeEpisodicEntity(`s1_e${i}`, [`Session pattern ${variants[i]} happened`], 'sess_1')
      );
      storage._entities.set(
        `s2_e${i}`,
        makeEpisodicEntity(`s2_e${i}`, [`Other session ${variants[i]} occurred`], 'sess_2')
      );
    }

    const result = await stage.runOnSessionEnd('sess_1');
    expect(result.transformed).toBe(1);

    const reflections = await rm.list();
    expect(reflections).toHaveLength(1);
    expect(reflections[0].sourceSessionId).toBe('sess_1');
    expect(reflections[0].evidence.every((e) => e.startsWith('s1_'))).toBe(true);
  });

  it('surfaces ReflectionManager.create errors on result.errors', async () => {
    for (let i = 0; i < 4; i++) {
      const variants = ['A', 'B', 'C', 'D'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`A pattern with ${variants[i]}`])
      );
    }
    // Force ReflectionManager.create to throw
    const broken = {
      create: vi.fn(async () => {
        throw new Error('synthetic storage failure');
      }),
    } as unknown as ReflectionManager;
    const brokenStage = new ReflectionStage(storage, broken, pd, tc, { minConfidence: 0.0 });

    const result = await brokenStage.process([], emptyOptions);
    expect(result.transformed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/synthetic storage failure/);
  });

  it('dedup at ReflectionManager.create means re-running the stage is idempotent', async () => {
    for (let i = 0; i < 5; i++) {
      const variants = ['A', 'B', 'C', 'D', 'E'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`Repeated pattern variant ${variants[i]}`])
      );
    }

    await stage.process([], emptyOptions);
    await stage.process([], emptyOptions);
    await stage.process([], emptyOptions);

    const reflections = await rm.list();
    expect(reflections).toHaveLength(1);
  });

  it('sets experienceType on the reflection when ExperienceExtractor is wired', async () => {
    for (let i = 0; i < 5; i++) {
      const cuisines = ['Italian', 'Mexican', 'Japanese', 'Thai', 'Indian'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`User prefers ${cuisines[i]} food`])
      );
    }
    const ee = new ExperienceExtractor(pd);
    const wiredStage = new ReflectionStage(storage, rm, pd, tc, {
      minConfidence: 0.4,
      experienceExtractor: ee,
    });

    const result = await wiredStage.process([], emptyOptions);
    expect(result.transformed).toBe(1);

    const reflection = (await rm.list())[0];
    // Entities carry no actions, so synthesizeExperience's heuristic
    // classifies observation-heavy clusters as 'heuristic'.
    expect(reflection.experienceType).toBe('heuristic');
  });

  it('leaves experienceType undefined when no ExperienceExtractor is wired', async () => {
    for (let i = 0; i < 5; i++) {
      const cuisines = ['Italian', 'Mexican', 'Japanese', 'Thai', 'Indian'];
      storage._entities.set(
        `e${i}`,
        makeEpisodicEntity(`e${i}`, [`User prefers ${cuisines[i]} food`])
      );
    }

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(1);

    const reflection = (await rm.list())[0];
    expect(reflection.experienceType).toBeUndefined();
  });

  it('narrows evidence to entities that contributed to a pattern, excluding noise', async () => {
    // Five pattern-bearing entities...
    for (let i = 0; i < 5; i++) {
      const cuisines = ['Italian', 'Mexican', 'Japanese', 'Thai', 'Indian'];
      storage._entities.set(
        `pref${i}`,
        makeEpisodicEntity(`pref${i}`, [`User prefers ${cuisines[i]} food`])
      );
    }
    // ...plus one noise entity whose observation matches no pattern
    // (different token count → never joins the "User prefers {X} food" template).
    storage._entities.set(
      'noise1',
      makeEpisodicEntity('noise1', ['Weather today is quite cold'])
    );

    const result = await stage.process([], emptyOptions);
    expect(result.transformed).toBe(1);

    const reflection = (await rm.list())[0];
    expect(reflection.evidence).toEqual(
      expect.arrayContaining(['pref0', 'pref1', 'pref2', 'pref3', 'pref4'])
    );
    expect(reflection.evidence).not.toContain('noise1');
  });
});
