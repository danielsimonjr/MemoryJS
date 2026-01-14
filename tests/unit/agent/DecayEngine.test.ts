/**
 * Unit tests for DecayEngine
 *
 * Tests the decay engine functionality including:
 * - Decay factor calculation with exponential decay
 * - Effective importance calculation
 * - Decayed memory queries
 * - Memory reinforcement
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DecayEngine, type DecayEngineConfig } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

// ==================== Mock Storage ====================

function createMockStorage(entities: AgentEntity[] = []): IGraphStorage {
  const entityMap = new Map(entities.map((e) => [e.name, e]));

  return {
    getEntityByName: vi.fn((name: string) => entityMap.get(name) ?? null),
    updateEntity: vi.fn(async () => {}),
    loadGraph: vi.fn(async () => ({ entities: Array.from(entityMap.values()), relations: [] })),
    load: vi.fn(async () => ({ entities: [], relations: [] })),
    save: vi.fn(async () => {}),
    createEntity: vi.fn(async () => {}),
    deleteEntity: vi.fn(async () => {}),
    getAllEntities: vi.fn(() => Array.from(entityMap.values())),
    createRelation: vi.fn(async () => {}),
    deleteRelation: vi.fn(async () => {}),
    getAllRelations: vi.fn(() => []),
    addObservation: vi.fn(async () => {}),
    deleteObservation: vi.fn(async () => {}),
    close: vi.fn(() => {}),
  } as unknown as IGraphStorage;
}

// ==================== Test Fixtures ====================

function createAgentEntity(
  name: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'test',
    observations: [],
    memoryType: 'working',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    ...overrides,
  };
}

// ==================== Constructor Tests ====================

describe('DecayEngine Constructor', () => {
  it('should create instance with default config', () => {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    expect(decay).toBeInstanceOf(DecayEngine);
    const config = decay.getConfig();
    expect(config.halfLifeHours).toBe(168);
    expect(config.importanceModulation).toBe(true);
    expect(config.accessModulation).toBe(true);
    expect(config.minImportance).toBe(0.1);
  });

  it('should create instance with custom config', () => {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);
    const config: DecayEngineConfig = {
      halfLifeHours: 24,
      importanceModulation: false,
      accessModulation: false,
      minImportance: 0.5,
    };
    const decay = new DecayEngine(storage, tracker, config);

    const actualConfig = decay.getConfig();
    expect(actualConfig.halfLifeHours).toBe(24);
    expect(actualConfig.importanceModulation).toBe(false);
    expect(actualConfig.accessModulation).toBe(false);
    expect(actualConfig.minImportance).toBe(0.5);
  });
});

// ==================== calculateDecayFactor Tests ====================

describe('DecayEngine.calculateDecayFactor', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;
  let decay: DecayEngine;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage);
    decay = new DecayEngine(storage, tracker, { halfLifeHours: 24 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 for empty timestamp', () => {
    const factor = decay.calculateDecayFactor('', 24);
    expect(factor).toBe(0);
  });

  it('should return ~1.0 for just-accessed memory', () => {
    const now = new Date().toISOString();
    const factor = decay.calculateDecayFactor(now, 24);
    expect(factor).toBeGreaterThan(0.99);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('should return ~0.5 after one half-life', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const past = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const factor = decay.calculateDecayFactor(past, 24);

    expect(factor).toBeCloseTo(0.5, 1);
  });

  it('should return ~0.25 after two half-lives', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const past = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const factor = decay.calculateDecayFactor(past, 24);

    expect(factor).toBeCloseTo(0.25, 1);
  });

  it('should apply importance boost to half-life', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // 24 hours ago
    const past = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    // Without boost (half-life = 24h)
    const factorWithoutBoost = decay.calculateDecayFactor(past, 24, undefined);

    // With importance boost of 10 (half-life = 24 * 2 = 48h)
    const factorWithBoost = decay.calculateDecayFactor(past, 24, 10);

    // With boost, should be higher (less decay)
    expect(factorWithBoost).toBeGreaterThan(factorWithoutBoost);
    // With 10 importance, half-life doubles, so after 24h should be ~0.707
    expect(factorWithBoost).toBeCloseTo(0.707, 1);
  });

  it('should always return value between 0 and 1', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const intervals = [0, 1, 24, 168, 720, 8760]; // hours

    for (const hours of intervals) {
      const past = new Date(now - hours * 60 * 60 * 1000).toISOString();
      const factor = decay.calculateDecayFactor(past, 24);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });
});

// ==================== Static calculateDecayFactorStatic Tests ====================

describe('DecayEngine.calculateDecayFactorStatic', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 for empty timestamp', () => {
    const factor = DecayEngine.calculateDecayFactorStatic('');
    expect(factor).toBe(0);
  });

  it('should use default half-life of 168 hours', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // 168 hours ago (1 week)
    const past = new Date(now - 168 * 60 * 60 * 1000).toISOString();
    const factor = DecayEngine.calculateDecayFactorStatic(past);

    expect(factor).toBeCloseTo(0.5, 1);
  });

  it('should work with custom half-life', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const past = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const factor = DecayEngine.calculateDecayFactorStatic(past, 24);

    expect(factor).toBeCloseTo(0.5, 1);
  });
});

// ==================== calculateEffectiveImportance Tests ====================

describe('DecayEngine.calculateEffectiveImportance', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return base importance for just-accessed memory', () => {
    const decay = new DecayEngine(storage, tracker);
    const entity = createAgentEntity('test', {
      importance: 8,
      lastAccessedAt: new Date().toISOString(),
    });

    const effective = decay.calculateEffectiveImportance(entity);
    expect(effective).toBeCloseTo(8, 0);
  });

  it('should apply decay factor based on age', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const decay = new DecayEngine(storage, tracker, { halfLifeHours: 24 });
    const entity = createAgentEntity('test', {
      importance: 10,
      lastAccessedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    });

    const effective = decay.calculateEffectiveImportance(entity);
    // After one half-life with importance modulation, effective should be reduced
    expect(effective).toBeLessThan(10);
    expect(effective).toBeGreaterThan(0);
  });

  it('should apply strength multiplier from confirmations', () => {
    const decay = new DecayEngine(storage, tracker);
    const entityWithConfirmations = createAgentEntity('test', {
      importance: 5,
      confirmationCount: 10, // +100% strength
      lastAccessedAt: new Date().toISOString(),
    });
    const entityWithoutConfirmations = createAgentEntity('test2', {
      importance: 5,
      confirmationCount: 0,
      lastAccessedAt: new Date().toISOString(),
    });

    const effectiveWith = decay.calculateEffectiveImportance(entityWithConfirmations);
    const effectiveWithout = decay.calculateEffectiveImportance(entityWithoutConfirmations);

    expect(effectiveWith).toBeGreaterThan(effectiveWithout);
  });

  it('should apply strength multiplier from access count', () => {
    const decay = new DecayEngine(storage, tracker);
    const entityWithAccesses = createAgentEntity('test', {
      importance: 5,
      accessCount: 100, // +1% strength per 100
      lastAccessedAt: new Date().toISOString(),
    });
    const entityWithoutAccesses = createAgentEntity('test2', {
      importance: 5,
      accessCount: 0,
      lastAccessedAt: new Date().toISOString(),
    });

    const effectiveWith = decay.calculateEffectiveImportance(entityWithAccesses);
    const effectiveWithout = decay.calculateEffectiveImportance(entityWithoutAccesses);

    expect(effectiveWith).toBeGreaterThan(effectiveWithout);
  });

  it('should respect minimum importance floor', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 1, // Very short half-life
      minImportance: 0.5,
    });

    // Entity accessed long ago
    const entity = createAgentEntity('test', {
      importance: 1,
      lastAccessedAt: new Date(now - 1000 * 60 * 60 * 1000).toISOString(), // 1000 hours ago
    });

    const effective = decay.calculateEffectiveImportance(entity);
    expect(effective).toBeGreaterThanOrEqual(0.5);
  });

  it('should use createdAt if lastAccessedAt is not available', () => {
    const decay = new DecayEngine(storage, tracker);
    const entity = createAgentEntity('test', {
      importance: 5,
      lastAccessedAt: undefined,
      createdAt: new Date().toISOString(),
    });

    const effective = decay.calculateEffectiveImportance(entity);
    expect(effective).toBeGreaterThan(0);
  });

  it('should return base importance with floor if no timestamps', () => {
    const decay = new DecayEngine(storage, tracker, { minImportance: 0.5 });
    const entity = createAgentEntity('test', {
      importance: 3,
      lastAccessedAt: undefined,
      createdAt: undefined,
    });

    const effective = decay.calculateEffectiveImportance(entity);
    expect(effective).toBe(3); // base importance since no decay applies
  });

  it('should disable importance modulation when configured', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const decayWithMod = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      importanceModulation: true,
    });
    const decayWithoutMod = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      importanceModulation: false,
    });

    // High importance entity accessed 24 hours ago
    const entity = createAgentEntity('test', {
      importance: 10, // High importance should slow decay with modulation
      lastAccessedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    });

    const effectiveWithMod = decayWithMod.calculateEffectiveImportance(entity);
    const effectiveWithoutMod = decayWithoutMod.calculateEffectiveImportance(entity);

    // With modulation, high importance should slow decay
    expect(effectiveWithMod).toBeGreaterThan(effectiveWithoutMod);
  });

  it('should disable access modulation when configured', () => {
    const decayWithMod = new DecayEngine(storage, tracker, { accessModulation: true });
    const decayWithoutMod = new DecayEngine(storage, tracker, { accessModulation: false });

    const entity = createAgentEntity('test', {
      importance: 5,
      confirmationCount: 10,
      accessCount: 100,
      lastAccessedAt: new Date().toISOString(),
    });

    const effectiveWithMod = decayWithMod.calculateEffectiveImportance(entity);
    const effectiveWithoutMod = decayWithoutMod.calculateEffectiveImportance(entity);

    // With access modulation, confirmations and accesses should boost importance
    expect(effectiveWithMod).toBeGreaterThan(effectiveWithoutMod);
  });
});

// ==================== getDecayedMemories Tests ====================

describe('DecayEngine.getDecayedMemories', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty array when no memories', async () => {
    storage = createMockStorage([]);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const decayed = await decay.getDecayedMemories(1.0);
    expect(decayed).toEqual([]);
  });

  it('should return empty array when all memories above threshold', async () => {
    const entities = [
      createAgentEntity('entity1', { importance: 5, lastAccessedAt: new Date().toISOString() }),
      createAgentEntity('entity2', { importance: 8, lastAccessedAt: new Date().toISOString() }),
    ];
    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const decayed = await decay.getDecayedMemories(0.1);
    expect(decayed).toEqual([]);
  });

  it('should return decayed memories below threshold', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      // Fresh entity - high effective importance
      createAgentEntity('fresh', {
        importance: 5,
        lastAccessedAt: new Date().toISOString(),
      }),
      // Old entity - low effective importance
      createAgentEntity('old', {
        importance: 1,
        lastAccessedAt: new Date(now - 1000 * 60 * 60 * 1000).toISOString(), // Very old
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.05,
    });

    const decayed = await decay.getDecayedMemories(1.0);

    // Old entity should be decayed below 1.0
    expect(decayed.some((e) => e.name === 'old')).toBe(true);
    // Fresh entity should not be included
    expect(decayed.some((e) => e.name === 'fresh')).toBe(false);
  });

  it('should skip non-AgentEntity entities', async () => {
    // Create a regular entity without memoryType
    const entities = [
      { name: 'regular', entityType: 'test', observations: [] },
    ] as unknown as AgentEntity[];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const decayed = await decay.getDecayedMemories(10);
    expect(decayed).toEqual([]);
  });
});

// ==================== getMemoriesAtRisk Tests ====================

describe('DecayEngine.getMemoriesAtRisk', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return memories between minImportance and threshold', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      // Fresh - above threshold
      createAgentEntity('fresh', {
        importance: 5,
        lastAccessedAt: new Date().toISOString(),
      }),
      // At risk - between min and threshold
      createAgentEntity('atRisk', {
        importance: 2,
        lastAccessedAt: new Date(now - 100 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    const storage = createMockStorage(entities);
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.1,
    });

    const atRisk = await decay.getMemoriesAtRisk(3.0);

    // atRisk should have decayed but not below min
    expect(atRisk.length).toBeGreaterThan(0);
  });
});

// ==================== reinforceMemory Tests ====================

describe('DecayEngine.reinforceMemory', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    const entity = createAgentEntity('test_entity', {
      confirmationCount: 5,
      confidence: 0.5,
    });
    storage = createMockStorage([entity]);
    tracker = new AccessTracker(storage);
  });

  it('should throw error for non-existent entity', async () => {
    const decay = new DecayEngine(storage, tracker);

    await expect(decay.reinforceMemory('non_existent')).rejects.toThrow(
      'Entity not found: non_existent'
    );
  });

  it('should update lastAccessedAt to reset decay', async () => {
    const decay = new DecayEngine(storage, tracker);

    await decay.reinforceMemory('test_entity');

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'test_entity',
      expect.objectContaining({
        lastAccessedAt: expect.any(String),
      })
    );
  });

  it('should increment confirmationCount by default', async () => {
    const decay = new DecayEngine(storage, tracker);

    await decay.reinforceMemory('test_entity');

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'test_entity',
      expect.objectContaining({
        confirmationCount: 6, // 5 + 1
      })
    );
  });

  it('should increment confirmationCount by custom amount', async () => {
    const decay = new DecayEngine(storage, tracker);

    await decay.reinforceMemory('test_entity', { confirmationBoost: 5 });

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'test_entity',
      expect.objectContaining({
        confirmationCount: 10, // 5 + 5
      })
    );
  });

  it('should boost confidence when specified', async () => {
    const decay = new DecayEngine(storage, tracker);

    await decay.reinforceMemory('test_entity', { confidenceBoost: 0.2 });

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'test_entity',
      expect.objectContaining({
        confidence: 0.7, // 0.5 + 0.2
      })
    );
  });

  it('should cap confidence at 1.0', async () => {
    // Create entity with high confidence
    const entity = createAgentEntity('high_conf', { confidence: 0.9 });
    storage = createMockStorage([entity]);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    await decay.reinforceMemory('high_conf', { confidenceBoost: 0.5 });

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'high_conf',
      expect.objectContaining({
        confidence: 1.0, // Capped
      })
    );
  });

  it('should record access via AccessTracker', async () => {
    const decay = new DecayEngine(storage, tracker);
    const recordAccessSpy = vi.spyOn(tracker, 'recordAccess');

    await decay.reinforceMemory('test_entity');

    expect(recordAccessSpy).toHaveBeenCalledWith('test_entity', {
      retrievalMethod: 'direct',
    });
  });
});

// ==================== applyDecay Tests ====================

describe('DecayEngine.applyDecay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return statistics for batch operation', async () => {
    const entities = [
      createAgentEntity('entity1', {
        importance: 5,
        lastAccessedAt: new Date().toISOString(),
      }),
      createAgentEntity('entity2', {
        importance: 8,
        lastAccessedAt: new Date().toISOString(),
      }),
    ];

    const storage = createMockStorage(entities);
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const result = await decay.applyDecay();

    expect(result.entitiesProcessed).toBe(2);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.averageDecay).toBeGreaterThanOrEqual(0);
    expect(result.averageDecay).toBeLessThanOrEqual(1);
  });

  it('should count memories at risk', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      // Moderately decayed
      createAgentEntity('atRisk', {
        importance: 2,
        lastAccessedAt: new Date(now - 50 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    const storage = createMockStorage(entities);
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.1,
    });

    const result = await decay.applyDecay();

    expect(result.memoriesAtRisk).toBeGreaterThanOrEqual(0);
  });

  it('should return zero for empty graph', async () => {
    const storage = createMockStorage([]);
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const result = await decay.applyDecay();

    expect(result.entitiesProcessed).toBe(0);
    expect(result.averageDecay).toBe(0);
    expect(result.memoriesAtRisk).toBe(0);
  });
});

// ==================== forgetWeakMemories Tests ====================

describe('DecayEngine.forgetWeakMemories', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty result when no memories below threshold', async () => {
    const entities = [
      createAgentEntity('strong', {
        importance: 10,
        lastAccessedAt: new Date().toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 1.0,
      dryRun: true,
    });

    expect(result.memoriesForgotten).toBe(0);
    expect(result.forgottenNames).toEqual([]);
    expect(result.dryRun).toBe(true);
  });

  it('should identify memories below threshold in dry-run mode', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('strong', {
        importance: 10,
        lastAccessedAt: new Date().toISOString(),
      }),
      createAgentEntity('weak', {
        importance: 0.5,
        lastAccessedAt: new Date(now - 500 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 5.0,
      dryRun: true,
    });

    expect(result.forgottenNames).toContain('weak');
    expect(result.forgottenNames).not.toContain('strong');
    expect(result.memoriesForgotten).toBe(1);
    expect(result.dryRun).toBe(true);
  });

  it('should not delete in dry-run mode', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('weak', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 1000 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    // Add saveGraph mock
    storage.saveGraph = vi.fn(async () => {});

    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 5.0,
      dryRun: true,
    });

    expect(storage.saveGraph).not.toHaveBeenCalled();
  });

  it('should actually delete in non-dry-run mode', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('weak', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 1000 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    storage.saveGraph = vi.fn(async () => {});

    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 5.0,
      dryRun: false,
    });

    expect(storage.saveGraph).toHaveBeenCalled();
    expect(result.dryRun).toBe(false);
  });

  it('should respect olderThanHours filter', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      // Old and weak - should be forgotten
      createAgentEntity('oldWeak', {
        importance: 0.1,
        createdAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
      }),
      // Young and weak - should be protected by age
      createAgentEntity('youngWeak', {
        importance: 0.1,
        createdAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    storage.saveGraph = vi.fn(async () => {});

    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 10.0,
      olderThanHours: 100, // Must be older than 100 hours
      dryRun: true,
    });

    expect(result.forgottenNames).toContain('oldWeak');
    expect(result.forgottenNames).not.toContain('youngWeak');
    expect(result.memoriesTooYoung).toBe(1);
  });

  it('should respect excludeTags protection', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('protectedWeak', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 500 * 60 * 60 * 1000).toISOString(),
        tags: ['important', 'preserve'],
      }),
      createAgentEntity('unprotectedWeak', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 500 * 60 * 60 * 1000).toISOString(),
        tags: ['temporary'],
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 10.0,
      excludeTags: ['important', 'permanent'],
      dryRun: true,
    });

    expect(result.forgottenNames).not.toContain('protectedWeak');
    expect(result.forgottenNames).toContain('unprotectedWeak');
    expect(result.memoriesProtected).toBe(1);
  });

  it('should be case-insensitive for tag matching', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('mixedCaseTags', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 500 * 60 * 60 * 1000).toISOString(),
        tags: ['IMPORTANT', 'Protected'],
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 10.0,
      excludeTags: ['important'],
      dryRun: true,
    });

    expect(result.forgottenNames).not.toContain('mixedCaseTags');
    expect(result.memoriesProtected).toBe(1);
  });

  it('should skip non-AgentEntity records', async () => {
    const entities = [
      { name: 'regularEntity', entityType: 'test', observations: [] },
    ] as unknown as AgentEntity[];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 10.0,
      dryRun: true,
    });

    expect(result.memoriesForgotten).toBe(0);
  });

  it('should combine all filters correctly', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      // Should be forgotten: old, weak, no protected tags
      createAgentEntity('candidate', {
        importance: 0.1,
        createdAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
        tags: ['temporary'],
      }),
      // Should NOT be forgotten: protected by tag
      createAgentEntity('protectedByTag', {
        importance: 0.1,
        createdAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 200 * 60 * 60 * 1000).toISOString(),
        tags: ['permanent'],
      }),
      // Should NOT be forgotten: too young
      createAgentEntity('tooYoung', {
        importance: 0.1,
        createdAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
      }),
      // Should NOT be forgotten: above threshold
      createAgentEntity('aboveThreshold', {
        importance: 10,
        lastAccessedAt: new Date().toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 5.0,
      olderThanHours: 100,
      excludeTags: ['permanent'],
      dryRun: true,
    });

    expect(result.forgottenNames).toEqual(['candidate']);
    expect(result.memoriesForgotten).toBe(1);
    expect(result.memoriesProtected).toBe(1);
    expect(result.memoriesTooYoung).toBe(1);
  });

  it('should default dryRun to false when not specified', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const entities = [
      createAgentEntity('weak', {
        importance: 0.1,
        lastAccessedAt: new Date(now - 1000 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    storage = createMockStorage(entities);
    storage.saveGraph = vi.fn(async () => {});

    tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 24,
      minImportance: 0.01,
    });

    const result = await decay.forgetWeakMemories({
      effectiveImportanceThreshold: 5.0,
    });

    expect(result.dryRun).toBe(false);
    expect(storage.saveGraph).toHaveBeenCalled();
  });
});

// ==================== getConfig Tests ====================

describe('DecayEngine.getConfig', () => {
  it('should return readonly copy of config', () => {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker, {
      halfLifeHours: 100,
    });

    const config1 = decay.getConfig();
    const config2 = decay.getConfig();

    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2); // Different object references
    expect(config1.halfLifeHours).toBe(100);
  });
});
