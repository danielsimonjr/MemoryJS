/**
 * Connectivity Signals Unit Tests
 *
 * Tests for the opt-in graph connectivity signals:
 * - SalienceEngine `connectivityWeight` (degree-normalized salience boost)
 * - DecayEngine `connectivityProtection` (well-connected entities decay slower)
 * - Shared degree helpers in src/agent/connectivity.ts
 * - Env var parsing (MEMORY_SALIENCE_CONNECTIVITY_WEIGHT,
 *   MEMORY_DECAY_CONNECTIVITY_PROTECTION, AGENT_MEMORY_* equivalents)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SalienceEngine, type SalienceEngineConfig } from '../../../src/agent/SalienceEngine.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { computeDegreeMap, normalizedDegree } from '../../../src/agent/connectivity.js';
import {
  loadConfigFromEnv,
  validateConfig,
} from '../../../src/agent/AgentMemoryConfig.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity, SalienceContext } from '../../../src/types/agent-memory.js';

/**
 * Create a mock storage with entities and relations.
 * The same graph object is returned on every loadGraph call, so tests
 * can mutate `relations` in place to simulate graph changes.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  const graph = { entities, relations };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find(e => e.name === name)),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
}

/**
 * Create a test agent entity.
 */
function createTestEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
    ...overrides,
  };
}

function relation(from: string, to: string, relationType = 'related_to'): Relation {
  return { from, to, relationType };
}

describe('connectivity helpers', () => {
  it('computes degree as count of relations touching the entity', () => {
    const map = computeDegreeMap({
      relations: [relation('a', 'b'), relation('a', 'c'), relation('d', 'a')],
    });

    expect(map.degrees.get('a')).toBe(3);
    expect(map.degrees.get('b')).toBe(1);
    expect(map.maxDegree).toBe(3);
  });

  it('counts a self-loop once', () => {
    const map = computeDegreeMap({ relations: [relation('a', 'a')] });

    expect(map.degrees.get('a')).toBe(1);
    expect(map.maxDegree).toBe(1);
  });

  it('normalizes degree by max degree', () => {
    const map = computeDegreeMap({
      relations: [relation('a', 'b'), relation('a', 'c')],
    });

    expect(normalizedDegree(map, 'a')).toBe(1);
    expect(normalizedDegree(map, 'b')).toBe(0.5);
    expect(normalizedDegree(map, 'isolated')).toBe(0);
  });

  it('returns 0 for a graph with no relations', () => {
    const map = computeDegreeMap({ relations: [] });

    expect(map.maxDegree).toBe(0);
    expect(normalizedDegree(map, 'anything')).toBe(0);
  });
});

describe('SalienceEngine connectivity signal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildEngine(
    entities: Entity[],
    relations: Relation[],
    config: SalienceEngineConfig = {}
  ): SalienceEngine {
    const storage = createMockStorage(entities, relations);
    const accessTracker = new AccessTracker(storage);
    const decayEngine = new DecayEngine(storage, accessTracker);
    return new SalienceEngine(storage, accessTracker, decayEngine, config);
  }

  it('defaults connectivityWeight to 0', () => {
    const engine = buildEngine([], []);
    expect(engine.getConfig().connectivityWeight).toBe(0);
  });

  it('with weight 0, scores are bit-identical to prior behavior (weighted-sum formula)', async () => {
    const entity = createTestEntity({ name: 'hub' });
    const relations = [relation('hub', 'x'), relation('hub', 'y')];
    // freshnessWeight 0 isolates the pure weighted sum of the five
    // pre-existing factors — the exact pre-connectivity formula.
    const engine = buildEngine([entity], relations, { freshnessWeight: 0 });
    const context: SalienceContext = {};

    const result = await engine.calculateSalience(entity, context);
    const c = result.components;

    // Recompute the historical formula in the same operation order.
    const expected =
      c.baseImportance * 0.25 +
      c.recencyBoost * 0.25 +
      c.frequencyBoost * 0.2 +
      c.contextRelevance * 0.2 +
      c.noveltyBoost * 0.1 +
      0 * 0; // connectivity term contributes exactly +0 at weight 0

    expect(result.salienceScore).toBe(expected);
    expect(c.connectivityBoost).toBe(0);
  });

  it('with weight 0, relations do not affect the score at all', async () => {
    const hub = createTestEntity({ name: 'hub' });
    const isolated = createTestEntity({ name: 'isolated' });
    const relations = [relation('hub', 'a'), relation('hub', 'b'), relation('hub', 'c')];
    const engine = buildEngine([hub, isolated], relations);
    const context: SalienceContext = {};

    const hubResult = await engine.calculateSalience(hub, context);
    const isolatedResult = await engine.calculateSalience(isolated, context);

    // Identical entities apart from name/degree → identical scores when disabled
    expect(hubResult.salienceScore).toBe(isolatedResult.salienceScore);
  });

  it('with weight 0, explicit and omitted config produce identical scores', async () => {
    const entity = createTestEntity({ name: 'hub' });
    const relations = [relation('hub', 'x')];
    const defaultEngine = buildEngine([entity], relations);
    const explicitEngine = buildEngine([entity], relations, { connectivityWeight: 0 });
    const context: SalienceContext = { currentTask: 'test task' };

    const a = await defaultEngine.calculateSalience(entity, context);
    const b = await explicitEngine.calculateSalience(entity, context);

    expect(a.salienceScore).toBe(b.salienceScore);
  });

  it('with weight > 0, a hub entity scores above an isolated entity, all else equal', async () => {
    const hub = createTestEntity({ name: 'hub' });
    const isolated = createTestEntity({ name: 'isolated' });
    const relations = [relation('hub', 'a'), relation('hub', 'b'), relation('hub', 'c')];
    const engine = buildEngine([hub, isolated], relations, { connectivityWeight: 0.5 });
    const context: SalienceContext = {};

    const hubResult = await engine.calculateSalience(hub, context);
    const isolatedResult = await engine.calculateSalience(isolated, context);

    expect(hubResult.components.connectivityBoost).toBe(1);
    expect(isolatedResult.components.connectivityBoost).toBe(0);
    expect(hubResult.salienceScore).toBeGreaterThan(isolatedResult.salienceScore);
    // The gap is exactly weight × (normalizedDegree difference)
    expect(hubResult.salienceScore - isolatedResult.salienceScore).toBeCloseTo(0.5, 10);
  });

  it('partial degree yields proportional boost', async () => {
    const half = createTestEntity({ name: 'half' });
    const relations = [
      relation('hub', 'a'),
      relation('hub', 'b'),
      relation('half', 'a'),
    ];
    const engine = buildEngine([half], relations, { connectivityWeight: 1 });

    const result = await engine.calculateSalience(half, {});

    expect(result.components.connectivityBoost).toBe(0.5);
  });

  describe('degree cache (mirrors _cachedMaxAccessCount semantics)', () => {
    it('relation changes between ranking batches are reflected (recomputed per batch)', async () => {
      const a = createTestEntity({ name: 'a' });
      const b = createTestEntity({ name: 'b' });
      const relations: Relation[] = [relation('a', 'x'), relation('a', 'y')];
      const engine = buildEngine([a, b], relations, { connectivityWeight: 1 });
      const context: SalienceContext = {};

      const first = await engine.rankEntitiesBySalience([a, b], context);
      const firstA = first.find(s => s.entity.name === 'a')!;
      const firstB = first.find(s => s.entity.name === 'b')!;
      expect(firstA.components.connectivityBoost).toBe(1);
      expect(firstB.components.connectivityBoost).toBe(0);

      // Mutate the graph: b becomes the hub (degree 4), a keeps degree 2
      relations.push(
        relation('b', 'p'),
        relation('b', 'q'),
        relation('b', 'r'),
        relation('b', 's')
      );

      const second = await engine.rankEntitiesBySalience([a, b], context);
      const secondA = second.find(s => s.entity.name === 'a')!;
      const secondB = second.find(s => s.entity.name === 'b')!;
      expect(secondB.components.connectivityBoost).toBe(1);
      expect(secondA.components.connectivityBoost).toBe(0.5);
    });

    it('standalone calculateSalience recomputes degrees on every call (no stale cache)', async () => {
      const a = createTestEntity({ name: 'a' });
      const relations: Relation[] = [relation('a', 'x')];
      const engine = buildEngine([a], relations, { connectivityWeight: 1 });

      const before = await engine.calculateSalience(a, {});
      expect(before.components.connectivityBoost).toBe(1);

      // a loses its hub status relative to a new max-degree entity
      relations.push(relation('z', 'p'), relation('z', 'q'), relation('z', 'r'));

      const after = await engine.calculateSalience(a, {});
      expect(after.components.connectivityBoost).toBeCloseTo(1 / 3, 10);
    });
  });
});

describe('DecayEngine connectivity protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Entity last accessed exactly one half-life (24h) ago. */
  function agedEntity(name: string, importance = 8): AgentEntity {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return createTestEntity({
      name,
      importance,
      createdAt: dayAgo,
      lastModified: dayAgo,
      lastAccessedAt: dayAgo,
      accessCount: 0,
      confirmationCount: 0,
      confidence: undefined,
    });
  }

  /** Config that makes decay math clean: pure exponential, no modulation. */
  const cleanDecayConfig = {
    halfLifeHours: 24,
    importanceModulation: false,
    accessModulation: false,
    minImportance: 0.1,
  };

  it('defaults connectivityProtection to 0', () => {
    const storage = createMockStorage();
    const decay = new DecayEngine(storage, new AccessTracker(storage));
    expect(decay.getConfig().connectivityProtection).toBe(0);
  });

  it('clamps connectivityProtection to [0, 1]', () => {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);
    expect(
      new DecayEngine(storage, tracker, { connectivityProtection: 1.5 }).getConfig()
        .connectivityProtection
    ).toBe(1);
    expect(
      new DecayEngine(storage, tracker, { connectivityProtection: -0.5 }).getConfig()
        .connectivityProtection
    ).toBe(0);
  });

  it('protection 0 leaves effective importance bit-identical, even with a degree snapshot', async () => {
    const hub = agedEntity('hub');
    const relations = [relation('hub', 'a'), relation('hub', 'b')];
    const storage = createMockStorage([hub], relations);
    const tracker = new AccessTracker(storage);

    const baseline = new DecayEngine(storage, tracker, cleanDecayConfig);
    const withZeroProtection = new DecayEngine(storage, tracker, {
      ...cleanDecayConfig,
      connectivityProtection: 0,
    });
    await withZeroProtection.refreshConnectivitySnapshot();

    expect(withZeroProtection.calculateEffectiveImportance(hub)).toBe(
      baseline.calculateEffectiveImportance(hub)
    );
    // One half-life elapsed → effective ≈ importance / 2
    expect(baseline.calculateEffectiveImportance(hub)).toBeCloseTo(4, 6);
  });

  it('protection 1: max-degree entity keeps full importance, isolated entity decays normally', async () => {
    const hub = agedEntity('hub');
    const isolated = agedEntity('isolated');
    const relations = [relation('hub', 'a'), relation('hub', 'b'), relation('hub', 'c')];
    const storage = createMockStorage([hub, isolated], relations);
    const decay = new DecayEngine(storage, new AccessTracker(storage), {
      ...cleanDecayConfig,
      connectivityProtection: 1,
    });
    await decay.refreshConnectivitySnapshot();

    // Hub: effectiveDecayFactor = d + (1 - d) × 1 × 1 = 1 → no decay
    expect(decay.calculateEffectiveImportance(hub)).toBeCloseTo(8, 10);
    // Isolated: normalizedDegree 0 → unchanged exponential decay (≈ half)
    expect(decay.calculateEffectiveImportance(isolated)).toBeCloseTo(4, 6);
  });

  it('intermediate protection interpolates between decayed and full importance', async () => {
    const hub = agedEntity('hub');
    const relations = [relation('hub', 'a')];
    const storage = createMockStorage([hub], relations);
    const decay = new DecayEngine(storage, new AccessTracker(storage), {
      ...cleanDecayConfig,
      connectivityProtection: 0.5,
    });
    await decay.refreshConnectivitySnapshot();

    // d ≈ 0.5 → effectiveDecayFactor = 0.5 + 0.5 × 0.5 × 1 = 0.75 → 8 × 0.75 = 6
    expect(decay.calculateEffectiveImportance(hub)).toBeCloseTo(6, 6);
  });

  it('applies no protection before the first degree snapshot is taken', () => {
    const hub = agedEntity('hub');
    const relations = [relation('hub', 'a')];
    const storage = createMockStorage([hub], relations);
    const decay = new DecayEngine(storage, new AccessTracker(storage), {
      ...cleanDecayConfig,
      connectivityProtection: 1,
    });

    // No refreshConnectivitySnapshot / batch op yet → normal decay
    expect(decay.calculateEffectiveImportance(hub)).toBeCloseTo(4, 6);
  });

  it('batch operations refresh the degree snapshot automatically', async () => {
    const hub = agedEntity('hub');
    const relations = [relation('hub', 'a'), relation('hub', 'b')];
    const storage = createMockStorage([hub], relations);
    const decay = new DecayEngine(storage, new AccessTracker(storage), {
      ...cleanDecayConfig,
      connectivityProtection: 1,
    });

    // applyDecay loads the graph and refreshes the snapshot as a side effect
    await decay.applyDecay();

    expect(decay.calculateEffectiveImportance(hub)).toBeCloseTo(8, 10);
  });

  it('protection never affects the PRD variant calculatePrdEffectiveImportance', async () => {
    const hub = agedEntity('hub');
    const relations = [relation('hub', 'a')];
    const storage = createMockStorage([hub], relations);
    const tracker = new AccessTracker(storage);

    const unprotected = new DecayEngine(storage, tracker, cleanDecayConfig);
    const fullyProtected = new DecayEngine(storage, tracker, {
      ...cleanDecayConfig,
      connectivityProtection: 1,
    });
    await fullyProtected.refreshConnectivitySnapshot();

    const now = Date.now();
    expect(fullyProtected.calculatePrdEffectiveImportance(hub, undefined, now)).toBe(
      unprotected.calculatePrdEffectiveImportance(hub, undefined, now)
    );
  });
});

describe('connectivity env var parsing', () => {
  const originalEnv = { ...process.env };
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'connectivity-env-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(testDir, { recursive: true, force: true });
  });

  it('parses MEMORY_SALIENCE_CONNECTIVITY_WEIGHT into SalienceEngine config', () => {
    process.env.MEMORY_SALIENCE_CONNECTIVITY_WEIGHT = '0.4';
    const ctx = new ManagerContext(join(testDir, 'salience-connectivity.jsonl'));

    expect(ctx.salienceEngine.getConfig().connectivityWeight).toBe(0.4);
  });

  it('defaults MEMORY_SALIENCE_CONNECTIVITY_WEIGHT to 0 when unset', () => {
    delete process.env.MEMORY_SALIENCE_CONNECTIVITY_WEIGHT;
    const ctx = new ManagerContext(join(testDir, 'salience-default.jsonl'));

    expect(ctx.salienceEngine.getConfig().connectivityWeight).toBe(0);
  });

  it('parses MEMORY_DECAY_CONNECTIVITY_PROTECTION into DecayEngine config', () => {
    process.env.MEMORY_DECAY_CONNECTIVITY_PROTECTION = '0.6';
    const ctx = new ManagerContext(join(testDir, 'decay-connectivity.jsonl'));

    expect(ctx.decayEngine.getConfig().connectivityProtection).toBe(0.6);
  });

  it('defaults MEMORY_DECAY_CONNECTIVITY_PROTECTION to 0 when unset', () => {
    delete process.env.MEMORY_DECAY_CONNECTIVITY_PROTECTION;
    const ctx = new ManagerContext(join(testDir, 'decay-default.jsonl'));

    expect(ctx.decayEngine.getConfig().connectivityProtection).toBe(0);
  });

  it('parses AGENT_MEMORY_* equivalents via loadConfigFromEnv', () => {
    process.env.AGENT_MEMORY_SALIENCE_CONNECTIVITY_WEIGHT = '0.3';
    process.env.AGENT_MEMORY_DECAY_CONNECTIVITY_PROTECTION = '0.7';

    const config = loadConfigFromEnv();

    expect(config.salience?.connectivityWeight).toBe(0.3);
    expect(config.decay?.connectivityProtection).toBe(0.7);
  });

  it('validateConfig rejects out-of-range connectivity values', () => {
    expect(() =>
      validateConfig({ salience: { connectivityWeight: 1.5 } })
    ).toThrow('Salience weights must be between 0 and 1');
    expect(() =>
      validateConfig({ decay: { connectivityProtection: 2 } })
    ).toThrow('decay.connectivityProtection must be between 0 and 1');
    expect(() =>
      validateConfig({
        salience: { connectivityWeight: 0.5 },
        decay: { connectivityProtection: 0.5 },
      })
    ).not.toThrow();
  });
});
