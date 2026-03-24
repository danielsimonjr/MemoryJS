/**
 * CollaborativeSynthesis Unit Tests
 *
 * Tests for graph-neighbor traversal, salience filtering, and
 * observation synthesis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollaborativeSynthesis } from '../../../src/agent/CollaborativeSynthesis.js';
import type { CollaborativeSynthesisConfig } from '../../../src/agent/CollaborativeSynthesis.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity, SalienceContext, ScoredEntity, SalienceComponents } from '../../../src/types/agent-memory.js';
import type { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import type { SalienceEngine } from '../../../src/agent/SalienceEngine.js';

// ==================== Helpers ====================

function makeAgentEntity(overrides: Partial<AgentEntity> & { name: string; entityType: string }): AgentEntity {
  const now = new Date().toISOString();
  return {
    entityType: overrides.entityType,
    name: overrides.name,
    observations: overrides.observations ?? [`Observation about ${overrides.name}`],
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: overrides.importance ?? 5,
    memoryType: overrides.memoryType ?? 'semantic',
    accessCount: overrides.accessCount ?? 1,
    confidence: overrides.confidence ?? 0.8,
    confirmationCount: overrides.confirmationCount ?? 1,
    visibility: overrides.visibility ?? 'public',
    ...overrides,
  };
}

function makeScoredEntity(entity: AgentEntity, score: number): ScoredEntity {
  const components: SalienceComponents = {
    baseImportance: score,
    recencyBoost: 0,
    frequencyBoost: 0,
    contextRelevance: 0,
    noveltyBoost: 0,
  };
  return { entity, salienceScore: score, components };
}

/**
 * Build a minimal mock IGraphStorage.
 * `entityMap` maps name → entity.
 */
function makeMockStorage(entityMap: Record<string, AgentEntity> = {}): IGraphStorage {
  const entities = Object.values(entityMap);
  const graph = { entities, relations: [] as Relation[] };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getGraphForMutation: vi.fn().mockResolvedValue({ ...graph }),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    appendEntity: vi.fn().mockResolvedValue(undefined),
    appendRelation: vi.fn().mockResolvedValue(undefined),
    updateEntity: vi.fn().mockResolvedValue(true),
    compact: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
    getEntityByName: vi.fn((name: string) => entityMap[name] as Entity | undefined),
    hasEntity: vi.fn((name: string) => name in entityMap),
    getEntitiesByType: vi.fn(() => []),
    getEntityTypes: vi.fn(() => []),
    getLowercased: vi.fn(() => undefined),
    getRelationsFrom: vi.fn(() => []),
    getRelationsTo: vi.fn(() => []),
    getRelationsFor: vi.fn(() => []),
    hasRelations: vi.fn(() => false),
  } as unknown as IGraphStorage;
}

/**
 * Build a minimal mock GraphTraversal.
 * `bfsNodes` is the list returned by bfs() (seed + neighbors in order).
 */
function makeMockTraversal(bfsNodes: string[]): GraphTraversal {
  return {
    bfs: vi.fn().mockReturnValue({
      nodes: bfsNodes,
      depths: new Map(bfsNodes.map((n, i) => [n, i])),
      parents: new Map(),
    }),
    getNeighborsWithRelations: vi.fn().mockReturnValue([]),
    dfs: vi.fn(),
    findShortestPath: vi.fn(),
    findAllPaths: vi.fn(),
    getConnectedComponents: vi.fn(),
    getCentrality: vi.fn(),
    setAccessTracker: vi.fn(),
  } as unknown as GraphTraversal;
}

/**
 * Build a minimal mock SalienceEngine.
 * `scoreMap` maps entity name → salience score.
 */
function makeMockSalienceEngine(scoreMap: Record<string, number> = {}): SalienceEngine {
  return {
    rankEntitiesBySalience: vi.fn(async (entities: AgentEntity[]) => {
      const scored = entities.map((e) => makeScoredEntity(e, scoreMap[e.name] ?? 0.5));
      return scored.sort((a, b) => b.salienceScore - a.salienceScore);
    }),
    calculateSalience: vi.fn(async (entity: AgentEntity) =>
      makeScoredEntity(entity, scoreMap[entity.name] ?? 0.5)
    ),
    getTopSalient: vi.fn().mockResolvedValue([]),
  } as unknown as SalienceEngine;
}

// ==================== Tests ====================

describe('CollaborativeSynthesis', () => {
  const SEED = 'Alice';

  // Default entities used across multiple tests
  const entityA = makeAgentEntity({ name: 'Bob', entityType: 'person', observations: ['Bob works with Alice'] });
  const entityB = makeAgentEntity({ name: 'ProjectX', entityType: 'project', observations: ['ProjectX ships in Q4'] });
  const entityC = makeAgentEntity({ name: 'Carol', entityType: 'person', observations: ['Carol is a designer'] });

  describe('basic synthesis', () => {
    it('returns neighbors with seed excluded from neighbor list', async () => {
      const storage = makeMockStorage({ [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }), Bob: entityA });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const salience = makeMockSalienceEngine({ Bob: 0.8 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      const result = await synth.synthesize(SEED);

      expect(result.seedEntity).toBe(SEED);
      expect(result.neighbors.every((n) => n.entity.name !== SEED)).toBe(true);
      expect(result.neighbors).toHaveLength(1);
      expect(result.neighbors[0].entity.name).toBe('Bob');
    });

    it('traversedCount equals number of bfs nodes minus seed', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
        ProjectX: entityB,
      });
      const traversal = makeMockTraversal([SEED, 'Bob', 'ProjectX']);
      const salience = makeMockSalienceEngine({ Bob: 0.8, ProjectX: 0.7 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      const result = await synth.synthesize(SEED);

      expect(result.traversedCount).toBe(2);
    });
  });

  describe('filteredCount', () => {
    it('filteredCount matches entities below minNeighborSalience', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
        Carol: entityC,
        ProjectX: entityB,
      });
      const traversal = makeMockTraversal([SEED, 'Bob', 'Carol', 'ProjectX']);
      // Bob passes (0.8), Carol fails (0.2), ProjectX passes (0.5)
      const salience = makeMockSalienceEngine({ Bob: 0.8, Carol: 0.2, ProjectX: 0.5 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      expect(result.filteredCount).toBe(1); // Carol filtered
      expect(result.neighbors).toHaveLength(2);
    });

    it('filteredCount is 0 when all entities pass the threshold', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const salience = makeMockSalienceEngine({ Bob: 0.9 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      expect(result.filteredCount).toBe(0);
      expect(result.neighbors).toHaveLength(1);
    });

    it('filteredCount equals traversedCount when all entities fail the threshold', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
        Carol: entityC,
      });
      const traversal = makeMockTraversal([SEED, 'Bob', 'Carol']);
      const salience = makeMockSalienceEngine({ Bob: 0.1, Carol: 0.05 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      expect(result.filteredCount).toBe(2);
      expect(result.neighbors).toHaveLength(0);
    });
  });

  describe('synthesizedObservations', () => {
    it('synthesizedObservations[0] contains the seed name', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const salience = makeMockSalienceEngine({ Bob: 0.8 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      const result = await synth.synthesize(SEED);

      expect(result.synthesizedObservations[0]).toContain(SEED);
    });

    it('generates one summary line per entity type group', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,       // person
        Carol: entityC,     // person
        ProjectX: entityB,  // project
      });
      const traversal = makeMockTraversal([SEED, 'Bob', 'Carol', 'ProjectX']);
      const salience = makeMockSalienceEngine({ Bob: 0.9, Carol: 0.8, ProjectX: 0.7 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      // 2 entity types → 2 summary lines + 2 top-obs lines = 4 total
      const summaryLines = result.synthesizedObservations.filter(
        (l) => l.includes('context —')
      );
      expect(summaryLines).toHaveLength(2);
    });

    it('includes top observation from highest-scoring entity in each group', async () => {
      const highBob = makeAgentEntity({
        name: 'Bob',
        entityType: 'person',
        observations: ['Bob is the lead engineer'],
      });
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: highBob,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const salience = makeMockSalienceEngine({ Bob: 0.9 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      const result = await synth.synthesize(SEED);

      const obsLines = result.synthesizedObservations.filter((l) => l.startsWith('  ['));
      expect(obsLines.some((l) => l.includes('Bob is the lead engineer'))).toBe(true);
    });
  });

  describe('maxNeighbors', () => {
    it('maxNeighbors limits the neighbor output', async () => {
      const entities: Record<string, AgentEntity> = {
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
      };
      const bfsNodes = [SEED];
      for (let i = 1; i <= 10; i++) {
        const name = `Entity${i}`;
        entities[name] = makeAgentEntity({ name, entityType: 'concept' });
        bfsNodes.push(name);
      }

      const storage = makeMockStorage(entities);
      const traversal = makeMockTraversal(bfsNodes);
      const scores: Record<string, number> = {};
      for (let i = 1; i <= 10; i++) {
        scores[`Entity${i}`] = 0.9 - i * 0.05; // all above 0.3 threshold
      }
      const salience = makeMockSalienceEngine(scores);

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        maxNeighbors: 5,
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      expect(result.neighbors).toHaveLength(5);
    });

    it('maxNeighbors of 0 returns no neighbors', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const salience = makeMockSalienceEngine({ Bob: 0.9 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        maxNeighbors: 0,
      });
      const result = await synth.synthesize(SEED);

      expect(result.neighbors).toHaveLength(0);
    });
  });

  describe('empty graph / no neighbors', () => {
    it('returns "No salient neighbors" message when graph is empty', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
      });
      // BFS returns only the seed (no neighbors)
      const traversal = makeMockTraversal([SEED]);
      const salience = makeMockSalienceEngine({});

      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      const result = await synth.synthesize(SEED);

      expect(result.traversedCount).toBe(0);
      expect(result.neighbors).toHaveLength(0);
      expect(result.synthesizedObservations[0]).toMatch(/No salient neighbors/i);
    });

    it('returns "No salient neighbors" when all neighbors are filtered by salience', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      // Bob's score is 0.1, below default minNeighborSalience of 0.3
      const salience = makeMockSalienceEngine({ Bob: 0.1 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      expect(result.neighbors).toHaveLength(0);
      expect(result.synthesizedObservations[0]).toMatch(/No salient neighbors/i);
    });
  });

  describe('configuration', () => {
    it('passes relationTypes to bfs traversal', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
      });
      const bfsMock = vi.fn().mockReturnValue({ nodes: [SEED], depths: new Map(), parents: new Map() });
      const traversal = { bfs: bfsMock } as unknown as GraphTraversal;
      const salience = makeMockSalienceEngine({});

      const config: CollaborativeSynthesisConfig = { relationTypes: ['works_with', 'manages'] };
      const synth = new CollaborativeSynthesis(storage, traversal, salience, config);
      await synth.synthesize(SEED);

      expect(bfsMock).toHaveBeenCalledWith(
        SEED,
        expect.objectContaining({ relationTypes: ['works_with', 'manages'] })
      );
    });

    it('passes maxDepth to bfs traversal', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
      });
      const bfsMock = vi.fn().mockReturnValue({ nodes: [SEED], depths: new Map(), parents: new Map() });
      const traversal = { bfs: bfsMock } as unknown as GraphTraversal;
      const salience = makeMockSalienceEngine({});

      const synth = new CollaborativeSynthesis(storage, traversal, salience, { maxDepth: 3 });
      await synth.synthesize(SEED);

      expect(bfsMock).toHaveBeenCalledWith(SEED, expect.objectContaining({ maxDepth: 3 }));
    });

    it('uses default config when no config provided', () => {
      const storage = makeMockStorage();
      const traversal = makeMockTraversal([]);
      const salience = makeMockSalienceEngine({});

      // Should not throw
      expect(
        () => new CollaborativeSynthesis(storage, traversal, salience)
      ).not.toThrow();
    });
  });

  describe('salience context forwarding', () => {
    it('forwards salience context to rankEntitiesBySalience', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
      });
      const traversal = makeMockTraversal([SEED, 'Bob']);
      const rankMock = vi.fn().mockResolvedValue([makeScoredEntity(entityA, 0.8)]);
      const salience = {
        rankEntitiesBySalience: rankMock,
        calculateSalience: vi.fn(),
        getTopSalient: vi.fn(),
      } as unknown as SalienceEngine;

      const ctx: SalienceContext = { currentTask: 'planning', queryText: 'teamwork' };
      const synth = new CollaborativeSynthesis(storage, traversal, salience);
      await synth.synthesize(SEED, ctx);

      expect(rankMock).toHaveBeenCalledWith(expect.any(Array), ctx);
    });
  });

  describe('neighbor ordering', () => {
    it('neighbors are returned sorted by salience score descending', async () => {
      const storage = makeMockStorage({
        [SEED]: makeAgentEntity({ name: SEED, entityType: 'person' }),
        Bob: entityA,
        Carol: entityC,
        ProjectX: entityB,
      });
      const traversal = makeMockTraversal([SEED, 'Bob', 'Carol', 'ProjectX']);
      const salience = makeMockSalienceEngine({ Bob: 0.6, Carol: 0.9, ProjectX: 0.75 });

      const synth = new CollaborativeSynthesis(storage, traversal, salience, {
        minNeighborSalience: 0.3,
      });
      const result = await synth.synthesize(SEED);

      const scores = result.neighbors.map((n) => n.salienceScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    });
  });
});
