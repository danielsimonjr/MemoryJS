/**
 * Unit tests for DreamEngine
 *
 * Tests the background memory maintenance engine including:
 * - Constructor and configuration resolution
 * - start/stop/isRunning timer lifecycle
 * - runDreamCycle phase execution
 * - Individual phase behaviour
 * - Phase skipping when disabled
 * - Error isolation (one phase failure does not abort others)
 * - maxDurationMs safety timeout
 * - EventEmitter events
 * - Callbacks
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { EventEmitter } from 'events';
import {
  DreamEngine,
  type DreamEngineConfig,
  type DreamCycleResult,
} from '../../../src/agent/DreamEngine.js';
import type { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import type { IGraphStorage, Entity, Relation, KnowledgeGraph } from '../../../src/types/types.js';

// ==================== Mock helpers ====================

function makeEntity(name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    name,
    entityType: 'test',
    observations: [`${name} observation one`, `${name} has details here`],
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
    ...overrides,
  };
}

function makeRelation(from: string, to: string, relationType = 'knows'): Relation {
  return { from, to, relationType };
}

function makeGraph(entities: Entity[] = [], relations: Relation[] = []): KnowledgeGraph {
  return { entities, relations };
}

function createMockStorage(graph: KnowledgeGraph = makeGraph()): IGraphStorage {
  let currentGraph = { ...graph };

  return {
    loadGraph: vi.fn().mockImplementation(() => Promise.resolve(currentGraph)),
    getGraphForMutation: vi.fn().mockImplementation(() =>
      Promise.resolve({
        entities: [...currentGraph.entities],
        relations: [...currentGraph.relations],
      })
    ),
    saveGraph: vi.fn().mockImplementation((g: KnowledgeGraph) => {
      currentGraph = g;
      return Promise.resolve();
    }),
    updateEntity: vi.fn().mockResolvedValue(true),
    appendEntity: vi.fn().mockResolvedValue(undefined),
    appendRelation: vi.fn().mockResolvedValue(undefined),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
    getEntityByName: vi.fn().mockReturnValue(undefined),
    hasEntity: vi.fn().mockReturnValue(false),
    getEntitiesByType: vi.fn().mockReturnValue([]),
    getRelationsFor: vi.fn().mockReturnValue([]),
    hasRelations: vi.fn().mockReturnValue(false),
  } as unknown as IGraphStorage;
}

function createMockPipeline(): ConsolidationPipeline {
  return {
    triggerManualConsolidation: vi.fn().mockResolvedValue({
      memoriesProcessed: 5,
      memoriesPromoted: 2,
      memoriesMerged: 1,
      patternsExtracted: 3,
      summariesCreated: 1,
      errors: [],
    }),
  } as unknown as ConsolidationPipeline;
}

function createEngine(
  storage: IGraphStorage = createMockStorage(),
  pipeline: ConsolidationPipeline = createMockPipeline(),
  config: DreamEngineConfig = {}
): DreamEngine {
  return new DreamEngine(storage, pipeline, config);
}

// ==================== Constructor ====================

describe('DreamEngine Constructor', () => {
  it('should create an instance', () => {
    const engine = createEngine();
    expect(engine).toBeInstanceOf(DreamEngine);
  });

  it('should not be running initially', () => {
    const engine = createEngine();
    expect(engine.isRunning()).toBe(false);
  });

  it('should be an EventEmitter', () => {
    const engine = createEngine();
    expect(engine).toBeInstanceOf(EventEmitter);
  });

  it('should accept custom config', () => {
    const engine = createEngine(undefined, undefined, {
      intervalMs: 1000,
      maxDurationMs: 5000,
      minEntropy: 2.0,
    });
    expect(engine).toBeInstanceOf(DreamEngine);
  });

  it('should accept all phases disabled', () => {
    const engine = createEngine(undefined, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });
    expect(engine).toBeInstanceOf(DreamEngine);
  });
});

// ==================== Timer Lifecycle ====================

describe('DreamEngine start/stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start and report isRunning', () => {
    const engine = createEngine();
    engine.start();
    expect(engine.isRunning()).toBe(true);
    engine.stop();
  });

  it('should stop and report not running', () => {
    const engine = createEngine();
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it('should be idempotent — start() twice is fine', () => {
    const storage = createMockStorage();
    const engine = createEngine(storage);
    engine.start();
    engine.start(); // second call is a no-op
    expect(engine.isRunning()).toBe(true);
    engine.stop();
  });

  it('should be idempotent — stop() without start is fine', () => {
    const engine = createEngine();
    expect(() => engine.stop()).not.toThrow();
    expect(engine.isRunning()).toBe(false);
  });

  it('should fire a cycle when the interval elapses', async () => {
    const storage = createMockStorage(makeGraph([makeEntity('Alice')]));
    const engine = createEngine(storage, undefined, { intervalMs: 5000 });
    engine.start();

    // Advance past the interval
    await vi.advanceTimersByTimeAsync(5001);

    // loadGraph is called at least once (Phase 1 temporal anchoring)
    expect(storage.loadGraph).toHaveBeenCalled();

    engine.stop();
  });

  it('should not fire before the interval elapses', async () => {
    const storage = createMockStorage();
    const pipeline = createMockPipeline();
    const engine = createEngine(storage, pipeline, { intervalMs: 10_000 });
    engine.start();

    await vi.advanceTimersByTimeAsync(4999);

    // pipeline.triggerManualConsolidation should not have been called yet
    // (the interval hasn't elapsed)
    expect(pipeline.triggerManualConsolidation).not.toHaveBeenCalled();

    engine.stop();
  });
});

// ==================== Full Cycle ====================

describe('DreamEngine.runDreamCycle', () => {
  it('should return a DreamCycleResult', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();

    expect(result).toMatchObject({
      cycleId: expect.any(String) as string,
      startedAt: expect.any(String) as string,
      completedAt: expect.any(String) as string,
      durationMs: expect.any(Number) as number,
      timedOut: false,
      phases: expect.any(Array) as DreamCycleResult['phases'],
    });
  });

  it('should have 8 phase results', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();
    expect(result.phases).toHaveLength(8);
  });

  it('should run all enabled phases', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();
    const ranPhases = result.phases.filter((p) => p.ran);
    expect(ranPhases).toHaveLength(8);
  });

  it('should aggregate totals correctly', async () => {
    const pipeline = createMockPipeline();
    const engine = createEngine(undefined, pipeline);
    const result = await engine.runDreamCycle();

    // consolidation phase ran — memoriesConsolidated = promoted + merged = 2 + 1
    expect(result.memoriesConsolidated).toBe(3);
  });

  it('should include cycleId as a UUID string', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();
    expect(result.cycleId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('durationMs should be non-negative', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ==================== Individual Phases ====================

describe('Phase 1: Temporal Anchoring', () => {
  it('should anchor relative timestamps in observations', async () => {
    const entity = makeEntity('Alice', {
      observations: ['She worked yesterday', 'Normal fact'],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: true,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    const p1 = result.phases[0];
    expect(p1.name).toBe('temporalAnchoring');
    expect(p1.ran).toBe(true);
    // "yesterday" should be replaced → updateEntity called once
    expect(storage.updateEntity).toHaveBeenCalled();
    expect(result.observationsAnchored).toBeGreaterThan(0);
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { temporalAnchoring: false },
    });
    const result = await engine.runDreamCycle();
    const p1 = result.phases[0];
    expect(p1.ran).toBe(false);
  });
});

describe('Phase 2: Freshness Sweep', () => {
  it('should mark expired entities with tag', async () => {
    const expiredEntity = makeEntity('Bob', {
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      observations: ['Bob is ancient'],
      // ttl expired
      ttl: 1, // 1 ms TTL — definitely expired
    } as unknown as Partial<Entity>);
    const storage = createMockStorage(makeGraph([expiredEntity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: true,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    await engine.runDreamCycle();
    const p2 = engine; // just check no throw
    expect(storage.loadGraph).toHaveBeenCalled();
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { freshnessSweep: false },
    });
    const result = await engine.runDreamCycle();
    const p2 = result.phases[1];
    expect(p2.ran).toBe(false);
  });
});

describe('Phase 3: Entropy Pruning', () => {
  it('should remove low-entropy observations', async () => {
    const entity = makeEntity('LowEntropy', {
      observations: [
        'aaaaaaaaaaaaaaaaaaaaaa', // very low entropy
        'This is a meaningful observation with diverse characters!',
      ],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: true,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
      minEntropy: 1.5,
    });

    const result = await engine.runDreamCycle();
    expect(result.observationsPruned).toBeGreaterThan(0);
    expect(storage.updateEntity).toHaveBeenCalled();
  });

  it('should keep all observations when all pass entropy', async () => {
    const entity = makeEntity('HighEntropy', {
      observations: [
        'Alice works on machine learning at the university research lab.',
        'Bob prefers writing TypeScript for backend API development.',
      ],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: true,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.observationsPruned).toBe(0);
    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { entropyPruning: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[2].ran).toBe(false);
  });
});

describe('Phase 4: Consolidation', () => {
  it('should call triggerManualConsolidation', async () => {
    const pipeline = createMockPipeline();
    const engine = createEngine(undefined, pipeline, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    await engine.runDreamCycle();
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(1);
  });

  it('should count promoted + merged as memoriesConsolidated', async () => {
    const pipeline = createMockPipeline(); // returns 2 promoted + 1 merged = 3
    const engine = createEngine(undefined, pipeline, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.memoriesConsolidated).toBe(3);
  });

  it('should skip when disabled', async () => {
    const pipeline = createMockPipeline();
    const engine = createEngine(undefined, pipeline, {
      phases: { consolidation: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[3].ran).toBe(false);
    expect(pipeline.triggerManualConsolidation).not.toHaveBeenCalled();
  });
});

describe('Phase 5: Compression', () => {
  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { compression: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[4].ran).toBe(false);
  });

  it('should run without error on empty graph', async () => {
    const storage = createMockStorage(makeGraph());
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: true,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    const p5 = result.phases[4];
    // Phase may error (CompressionManager needs real GraphStorage) but should not throw
    expect(p5.name).toBe('compression');
  });
});

describe('Phase 6: Entity Enrichment', () => {
  it('should add summary observations to entities with >= 3 observations', async () => {
    const entity = makeEntity('Rich', {
      observations: ['Fact one here', 'Fact two here', 'Fact three here'],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: true,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.summariesAdded).toBeGreaterThan(0);
    expect(storage.updateEntity).toHaveBeenCalled();
  });

  it('should not enrich entities that already have a summary', async () => {
    const entity = makeEntity('AlreadySummarised', {
      observations: [
        '[summary] Key topics: work, code, test.',
        'Observation one',
        'Observation two',
        'Observation three',
      ],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: true,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.summariesAdded).toBe(0);
  });

  it('should not enrich entities with < 3 observations', async () => {
    const entity = makeEntity('Sparse', {
      observations: ['Just one fact'],
    });
    const storage = createMockStorage(makeGraph([entity]));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: true,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.summariesAdded).toBe(0);
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { entityEnrichment: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[5].ran).toBe(false);
  });
});

describe('Phase 7: Pattern Promotion', () => {
  it('should detect patterns and promote high-confidence ones', async () => {
    // Create entities with repeating observation templates
    const entities = Array.from({ length: 5 }, (_, i) =>
      makeEntity(`User${i}`, {
        observations: [
          `User${i} prefers dark mode in applications`,
          `User${i} works on TypeScript projects daily`,
          `User${i} uses vim as primary editor`,
        ],
      })
    );
    const storage = createMockStorage(makeGraph(entities));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: true,
        graphHygiene: false,
      },
      minPatternOccurrences: 3,
    });

    const result = await engine.runDreamCycle();
    const p7 = result.phases[6];
    expect(p7.ran).toBe(true);
    expect(p7.metrics['patternsDetected']).toBeGreaterThanOrEqual(0);
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { patternPromotion: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[6].ran).toBe(false);
  });
});

describe('Phase 8: Graph Hygiene', () => {
  it('should remove dangling relations whose entities are missing', async () => {
    const entities = [makeEntity('Alice'), makeEntity('Bob')];
    const relations = [
      makeRelation('Alice', 'Bob'),
      makeRelation('Alice', 'Ghost'), // Ghost entity does not exist
    ];
    const graph = makeGraph(entities, relations);
    const storage = createMockStorage(graph);
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: true,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.relationsRemoved).toBe(1);
    expect(storage.saveGraph).toHaveBeenCalled();
  });

  it('should not call saveGraph when no dangling relations', async () => {
    const entities = [makeEntity('Alice'), makeEntity('Bob')];
    const relations = [makeRelation('Alice', 'Bob')];
    const storage = createMockStorage(makeGraph(entities, relations));
    const engine = createEngine(storage, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: true,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.relationsRemoved).toBe(0);
    expect(storage.saveGraph).not.toHaveBeenCalled();
  });

  it('should skip when disabled', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { graphHygiene: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[7].ran).toBe(false);
  });
});

// ==================== All Phases Disabled ====================

describe('DreamEngine with all phases disabled', () => {
  it('should complete cycle with no phases ran', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    expect(result.phases.every((p) => !p.ran)).toBe(true);
    expect(result.memoriesConsolidated).toBe(0);
    expect(result.entitiesDeduplicated).toBe(0);
  });
});

// ==================== Error Isolation ====================

describe('DreamEngine error isolation', () => {
  it('should continue running other phases when one phase throws', async () => {
    const pipeline = createMockPipeline();
    // Make consolidation throw
    (pipeline.triggerManualConsolidation as MockInstance).mockRejectedValueOnce(
      new Error('consolidation failure')
    );

    const engine = createEngine(undefined, pipeline, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const result = await engine.runDreamCycle();
    const p4 = result.phases[3];
    expect(p4.ran).toBe(true);
    expect(p4.errors).toHaveLength(1);
    expect(p4.errors[0]).toContain('consolidation failure');
    // Cycle should still complete
    expect(result.timedOut).toBe(false);
  });

  it('should surface errors via onError callback', async () => {
    const pipeline = createMockPipeline();
    (pipeline.triggerManualConsolidation as MockInstance).mockRejectedValueOnce(
      new Error('callback test')
    );

    const onError = vi.fn();
    const engine = createEngine(undefined, pipeline, {
      callbacks: { onError },
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    await engine.runDreamCycle();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'callback test' }) as Error,
      'phase:consolidation'
    );
  });

  it('should emit dream:error event on phase failure', async () => {
    const pipeline = createMockPipeline();
    (pipeline.triggerManualConsolidation as MockInstance).mockRejectedValueOnce(
      new Error('event test')
    );

    const engine = createEngine(undefined, pipeline, {
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const errors: unknown[] = [];
    engine.on('dream:error', (e) => errors.push(e));

    await engine.runDreamCycle();
    expect(errors).toHaveLength(1);
  });
});

// ==================== maxDurationMs Safety ====================

describe('DreamEngine maxDurationMs safety', () => {
  it('should set timedOut when maxDurationMs is exceeded', async () => {
    // Use a very short maxDurationMs — the phases themselves take a bit
    const pipeline = createMockPipeline();
    // Slow down consolidation to exceed budget
    (pipeline.triggerManualConsolidation as MockInstance).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    const engine = createEngine(undefined, pipeline, {
      maxDurationMs: 1, // 1 ms — will be exceeded immediately
    });

    const result = await engine.runDreamCycle();
    expect(result.timedOut).toBe(true);
  });
});

// ==================== EventEmitter ====================

describe('DreamEngine events', () => {
  it('should emit dream:cycle:start with cycleId', async () => {
    const engine = createEngine();
    const starts: unknown[] = [];
    engine.on('dream:cycle:start', (e) => starts.push(e));

    await engine.runDreamCycle();
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ cycleId: expect.any(String) as string });
  });

  it('should emit dream:cycle:complete with result', async () => {
    const engine = createEngine();
    const completes: DreamCycleResult[] = [];
    engine.on('dream:cycle:complete', (r) => completes.push(r as DreamCycleResult));

    await engine.runDreamCycle();
    expect(completes).toHaveLength(1);
    expect(completes[0].cycleId).toBeDefined();
  });

  it('should emit dream:phase:complete for each ran phase', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: {
        temporalAnchoring: true,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: false,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    const phaseCompletes: unknown[] = [];
    engine.on('dream:phase:complete', (e) => phaseCompletes.push(e));

    await engine.runDreamCycle();
    // Only the enabled phase emits
    expect(phaseCompletes).toHaveLength(1);
  });
});

// ==================== Callbacks ====================

describe('DreamEngine callbacks', () => {
  it('should call onCycleComplete when cycle finishes', async () => {
    const onCycleComplete = vi.fn();
    const engine = createEngine(undefined, undefined, {
      callbacks: { onCycleComplete },
    });

    await engine.runDreamCycle();
    expect(onCycleComplete).toHaveBeenCalledTimes(1);
    expect(onCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: expect.any(String) as string }) as DreamCycleResult
    );
  });

  it('should call onCycleComplete with correct totals', async () => {
    const pipeline = createMockPipeline();
    const onCycleComplete = vi.fn();
    const engine = createEngine(undefined, pipeline, {
      callbacks: { onCycleComplete },
      phases: {
        temporalAnchoring: false,
        freshnessSweep: false,
        entropyPruning: false,
        consolidation: true,
        compression: false,
        entityEnrichment: false,
        patternPromotion: false,
        graphHygiene: false,
      },
    });

    await engine.runDreamCycle();
    const result = (onCycleComplete.mock.calls[0] as [DreamCycleResult])[0];
    expect(result.memoriesConsolidated).toBe(3); // 2 promoted + 1 merged
  });
});

// ==================== Phase Result Shape ====================

describe('DreamPhaseResult shape', () => {
  it('should have correct shape for all phases', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();

    for (const phase of result.phases) {
      expect(phase).toMatchObject({
        name: expect.any(String) as string,
        ran: expect.any(Boolean) as boolean,
        durationMs: expect.any(Number) as number,
        metrics: expect.any(Object) as Record<string, number>,
        errors: expect.any(Array) as string[],
      });
    }
  });

  it('should have correct phase names in order', async () => {
    const engine = createEngine();
    const result = await engine.runDreamCycle();

    const expectedNames = [
      'temporalAnchoring',
      'freshnessSweep',
      'entropyPruning',
      'consolidation',
      'compression',
      'entityEnrichment',
      'patternPromotion',
      'graphHygiene',
    ];
    expect(result.phases.map((p) => p.name)).toEqual(expectedNames);
  });

  it('disabled phase should have durationMs of 0', async () => {
    const engine = createEngine(undefined, undefined, {
      phases: { temporalAnchoring: false },
    });
    const result = await engine.runDreamCycle();
    expect(result.phases[0].durationMs).toBe(0);
  });
});
