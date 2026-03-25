/**
 * Unit tests for FailureDistillation (Feature S6)
 *
 * Tests failure-driven memory distillation including:
 * - Full distillation creates procedural entities
 * - Non-failure session returns zero lessons
 * - High minLessonConfidence suppresses lesson creation
 * - Causal chain is traced correctly
 * - Session with no episodes returns episodesAnalyzed: 0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FailureDistillation,
  type FailureDistillationConfig,
} from '../../../src/agent/FailureDistillation.js';
import type { IGraphStorage, Entity, Relation, KnowledgeGraph } from '../../../src/types/types.js';
import type { AgentEntity, SessionEntity } from '../../../src/types/agent-memory.js';

// ==================== Mock Storage ====================

function createMockStorage(
  entities: Entity[] = [],
  relations: Relation[] = []
): IGraphStorage {
  const storedEntities = [...entities];
  const storedRelations = [...relations];

  return {
    appendEntity: vi.fn(async (entity: Entity) => {
      storedEntities.push(entity);
    }),
    appendRelation: vi.fn(async (relation: Relation) => {
      storedRelations.push(relation);
    }),
    loadGraph: vi.fn(async (): Promise<KnowledgeGraph> => ({
      entities: [...storedEntities],
      relations: [...storedRelations],
    })),
    getEntityByName: vi.fn((name: string) => {
      return storedEntities.find((e) => e.name === name) ?? null;
    }),
    getRelationsFrom: vi.fn((name: string) => {
      return storedRelations.filter((r) => r.from === name);
    }),
    getRelationsTo: vi.fn((name: string) => {
      return storedRelations.filter((r) => r.to === name);
    }),
    updateEntity: vi.fn(async () => {}),
    saveGraph: vi.fn(async () => {}),
    ensureLoaded: vi.fn(async () => {}),
    deleteEntity: vi.fn(async () => {}),
    deleteRelation: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    getGraphForMutation: vi.fn(async (): Promise<KnowledgeGraph> => ({
      entities: [...storedEntities],
      relations: [...storedRelations],
    })),
  } as unknown as IGraphStorage;
}

// ==================== Test Fixtures ====================

const NOW = '2026-03-24T12:00:00.000Z';

function createSessionEntity(
  sessionId: string,
  outcome: 'success' | 'failure' | 'partial' | 'unknown' | undefined = 'failure'
): SessionEntity {
  return {
    name: sessionId,
    entityType: 'session',
    observations: [`Session goal: Test`],
    createdAt: NOW,
    lastModified: NOW,
    importance: 5,
    memoryType: 'episodic',
    sessionId,
    accessCount: 0,
    lastAccessedAt: NOW,
    confidence: 1.0,
    confirmationCount: 0,
    visibility: 'private',
    agentId: 'default',
    startedAt: NOW,
    status: 'completed',
    memoryCount: 0,
    consolidatedCount: 0,
    relatedSessionIds: [],
    outcome,
  };
}

function createEpisodeEntity(
  name: string,
  sessionId: string,
  content: string = 'Something went wrong'
): AgentEntity {
  return {
    name,
    entityType: 'episode',
    observations: [content],
    createdAt: NOW,
    lastModified: NOW,
    importance: 5,
    memoryType: 'episodic',
    sessionId,
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
  };
}

function createCausalRelation(from: string, to: string): Relation {
  return {
    from,
    to,
    relationType: 'caused_by',
    createdAt: NOW,
  };
}

// ==================== Tests ====================

describe('FailureDistillation', () => {
  const SESSION_ID = 'session_failure_001';

  // ==================== Full distillation ====================

  describe('distillFromSession - failure session with episodes', () => {
    it('should create procedural entities for each episode above confidence threshold', async () => {
      // episode_a has no causal chain → chain length 0 → confidence 0.5
      // The default minLessonConfidence is 0.6, so episode_a should NOT produce a lesson
      // episode_b has a 2-step causal chain (b → c → d) → chain length 2 → confidence 0.7 ✓
      const session = createSessionEntity(SESSION_ID, 'failure');
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Terminal failure A');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Terminal failure B');
      const ep_c = createEpisodeEntity('ep_c', SESSION_ID, 'Intermediate cause C');
      const ep_d = createEpisodeEntity('ep_d', SESSION_ID, 'Root cause D');

      // ep_b -> caused_by -> ep_c -> caused_by -> ep_d
      const rel_bc = createCausalRelation('ep_b', 'ep_c');
      const rel_cd = createCausalRelation('ep_c', 'ep_d');

      const storage = createMockStorage(
        [session, ep_a, ep_b, ep_c, ep_d],
        [rel_bc, rel_cd]
      );

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      // ep_a: chain length 0, confidence 0.5 → below default threshold 0.6 → no lesson
      // ep_b: chain length 2, confidence 0.7 → lesson created
      // ep_c and ep_d are episodes but are part of causal chain, not "terminal" failures
      //   However they are still in the session's episodes, so they get analyzed too.
      //   ep_c: chain length 1 (ep_c → ep_d), confidence 0.6 → exactly at threshold → created
      //   ep_d: chain length 0, confidence 0.5 → below threshold → no lesson

      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.episodesAnalyzed).toBeGreaterThanOrEqual(3); // a, b, c, d
      expect(result.lessons.length).toBeGreaterThanOrEqual(1);
      expect(result.createdEntities.length).toBe(result.lessons.length);

      // All created entities should be named lesson_<uuid>
      for (const name of result.createdEntities) {
        expect(name).toMatch(/^lesson_[0-9a-f-]+$/);
      }
    });

    it('should persist each lesson as a procedural memory entity in storage', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // ep_b has chain length 2 → confidence 0.7 → lesson created
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Critical failure');
      const ep_c = createEpisodeEntity('ep_c', SESSION_ID, 'Cause step');
      const ep_d = createEpisodeEntity('ep_d', SESSION_ID, 'Root');

      const rel_bc = createCausalRelation('ep_b', 'ep_c');
      const rel_cd = createCausalRelation('ep_c', 'ep_d');

      const storage = createMockStorage([session, ep_b, ep_c, ep_d], [rel_bc, rel_cd]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      // appendEntity should have been called for each created lesson
      expect(storage.appendEntity).toHaveBeenCalledTimes(result.createdEntities.length);

      // Each persisted entity should have memoryType 'procedural'
      const calls = vi.mocked(storage.appendEntity).mock.calls;
      for (const [entity] of calls) {
        const agentEntity = entity as AgentEntity;
        expect(agentEntity.memoryType).toBe('procedural');
        expect(agentEntity.entityType).toBe('lesson');
        expect(agentEntity.sessionId).toBe(SESSION_ID);
      }
    });

    it('should include lesson content and sourceSessionId in each distilled lesson', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Deployment failed');
      const ep_c = createEpisodeEntity('ep_c', SESSION_ID, 'Config missing');
      const ep_d = createEpisodeEntity('ep_d', SESSION_ID, 'Environment not set');

      const rel_bc = createCausalRelation('ep_b', 'ep_c');
      const rel_cd = createCausalRelation('ep_c', 'ep_d');

      const storage = createMockStorage([session, ep_b, ep_c, ep_d], [rel_bc, rel_cd]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      // Find the lesson for ep_b
      const lessonForB = result.lessons.find((l) =>
        l.sourceEpisodes.includes('ep_b')
      );
      expect(lessonForB).toBeDefined();
      expect(lessonForB!.sourceSessionId).toBe(SESSION_ID);
      expect(lessonForB!.failureDescription).toContain('Deployment failed');
      expect(lessonForB!.lesson).toContain('Environment not set'); // root cause
      expect(lessonForB!.causeChain).toEqual(['ep_c', 'ep_d']);
    });
  });

  // ==================== Non-failure session ====================

  describe('distillFromSession - non-failure outcomes', () => {
    it.each(['success', 'partial', 'unknown'] as const)(
      'should return zero lessons for outcome=%s',
      async (outcome) => {
        const session = createSessionEntity(SESSION_ID, outcome);
        const ep = createEpisodeEntity('ep_x', SESSION_ID, 'Something happened');
        const storage = createMockStorage([session, ep]);

        const fd = new FailureDistillation(storage);
        const result = await fd.distillFromSession(SESSION_ID);

        expect(result.lessons).toHaveLength(0);
        expect(result.createdEntities).toHaveLength(0);
        expect(result.episodesAnalyzed).toBe(0);
      }
    );

    it('should return zero lessons for session with no outcome set', async () => {
      const session = createSessionEntity(SESSION_ID, undefined);
      const ep = createEpisodeEntity('ep_x', SESSION_ID, 'Some episode');
      const storage = createMockStorage([session, ep]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result.lessons).toHaveLength(0);
      expect(result.createdEntities).toHaveLength(0);
    });

    it('should return zero lessons for a non-existent session', async () => {
      const storage = createMockStorage([]);
      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession('session_does_not_exist');

      expect(result.lessons).toHaveLength(0);
      expect(result.episodesAnalyzed).toBe(0);
    });

    it('should return zero lessons for a non-session entity (wrong entityType)', async () => {
      // An entity that is NOT a session
      const fakeSession: Entity = {
        name: SESSION_ID,
        entityType: 'person', // not 'session'
        observations: [],
        createdAt: NOW,
      };
      const storage = createMockStorage([fakeSession]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result.lessons).toHaveLength(0);
    });
  });

  // ==================== High minLessonConfidence suppresses creation ====================

  describe('distillFromSession - high minLessonConfidence suppresses creation', () => {
    it('should create no lessons when confidence is below minLessonConfidence', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // Single episode with no causal chain → confidence 0.5
      const ep = createEpisodeEntity('ep_single', SESSION_ID, 'Isolated failure');
      const storage = createMockStorage([session, ep]);

      // Set minLessonConfidence very high
      const config: FailureDistillationConfig = { minLessonConfidence: 0.95 };
      const fd = new FailureDistillation(storage, config);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result.lessons).toHaveLength(0);
      expect(result.createdEntities).toHaveLength(0);
      // But it should still have analyzed the episode
      expect(result.episodesAnalyzed).toBe(1);
      // appendEntity should NOT have been called
      expect(storage.appendEntity).not.toHaveBeenCalled();
    });

    it('should create lessons when confidence equals minLessonConfidence exactly', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // chain length 1: ep_a → caused_by → ep_b → confidence = 0.5 + 0.1 = 0.6
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Failure A');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Cause B');
      const rel = createCausalRelation('ep_a', 'ep_b');

      const storage = createMockStorage([session, ep_a, ep_b], [rel]);

      // minLessonConfidence = 0.6, chain length 1 gives confidence 0.6 → exactly at threshold
      const config: FailureDistillationConfig = { minLessonConfidence: 0.6 };
      const fd = new FailureDistillation(storage, config);
      const result = await fd.distillFromSession(SESSION_ID);

      // ep_a: confidence 0.6 → created
      // ep_b: chain length 0, confidence 0.5 → not created
      const lessonForA = result.lessons.find((l) => l.sourceEpisodes.includes('ep_a'));
      expect(lessonForA).toBeDefined();
      expect(lessonForA!.confidence).toBeCloseTo(0.6, 5);
    });
  });

  // ==================== Causal chain traced correctly ====================

  describe('distillFromSession - causal chain tracing', () => {
    it('should trace a causal chain of length 3 correctly', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // ep_a → caused_by → ep_b → caused_by → ep_c → caused_by → ep_d
      // chain from ep_a: [ep_b, ep_c, ep_d], length 3 → confidence = 0.5 + 0.3 = 0.8
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Final failure');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Step B');
      const ep_c = createEpisodeEntity('ep_c', SESSION_ID, 'Step C');
      const ep_d = createEpisodeEntity('ep_d', SESSION_ID, 'Root cause D');

      const storage = createMockStorage(
        [session, ep_a, ep_b, ep_c, ep_d],
        [
          createCausalRelation('ep_a', 'ep_b'),
          createCausalRelation('ep_b', 'ep_c'),
          createCausalRelation('ep_c', 'ep_d'),
        ]
      );

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      const lessonForA = result.lessons.find((l) => l.sourceEpisodes.includes('ep_a'));
      expect(lessonForA).toBeDefined();
      expect(lessonForA!.causeChain).toEqual(['ep_b', 'ep_c', 'ep_d']);
      expect(lessonForA!.confidence).toBeCloseTo(0.8, 5);
    });

    it('should cap confidence at 0.9 regardless of chain length', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // Build a very long chain (10 steps) — confidence would be 0.5 + 1.0 = 1.5 without cap
      const entities: AgentEntity[] = [];
      const relations: Relation[] = [];

      entities.push(createEpisodeEntity('ep_0', SESSION_ID, 'Root failure'));

      for (let i = 1; i <= 10; i++) {
        entities.push(createEpisodeEntity(`ep_${i}`, SESSION_ID, `Step ${i}`));
        relations.push(createCausalRelation(`ep_${i - 1}`, `ep_${i}`));
      }

      const storage = createMockStorage([createSessionEntity(SESSION_ID, 'failure'), ...entities], relations);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      const lessonForRoot = result.lessons.find((l) => l.sourceEpisodes.includes('ep_0'));
      expect(lessonForRoot).toBeDefined();
      expect(lessonForRoot!.confidence).toBeLessThanOrEqual(0.9);
    });

    it('should respect maxCauseChainLength and not trace beyond it', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // Chain of 6 steps, but maxCauseChainLength = 3
      const entities: AgentEntity[] = [];
      const relations: Relation[] = [];

      for (let i = 0; i <= 6; i++) {
        entities.push(createEpisodeEntity(`ep_${i}`, SESSION_ID, `Step ${i}`));
        if (i > 0) {
          relations.push(createCausalRelation(`ep_${i - 1}`, `ep_${i}`));
        }
      }

      const storage = createMockStorage(
        [createSessionEntity(SESSION_ID, 'failure'), ...entities],
        relations
      );

      const config: FailureDistillationConfig = { maxCauseChainLength: 3 };
      const fd = new FailureDistillation(storage, config);
      const result = await fd.distillFromSession(SESSION_ID);

      const lessonForRoot = result.lessons.find((l) => l.sourceEpisodes.includes('ep_0'));
      expect(lessonForRoot).toBeDefined();
      // Chain should be capped at length 3
      expect(lessonForRoot!.causeChain.length).toBeLessThanOrEqual(3);
    });

    it('should not follow cycles in causal chains', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // Cycle: ep_a → caused_by → ep_b → caused_by → ep_a (cycle!)
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Failure A');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Failure B');

      const storage = createMockStorage(
        [session, ep_a, ep_b],
        [createCausalRelation('ep_a', 'ep_b'), createCausalRelation('ep_b', 'ep_a')]
      );

      const fd = new FailureDistillation(storage);
      // Should not throw or infinite loop
      const result = await fd.distillFromSession(SESSION_ID);
      expect(result).toBeDefined();
    });
  });

  // ==================== Session with no episodes ====================

  describe('distillFromSession - session with no episodes', () => {
    it('should return episodesAnalyzed: 0 when session has no episodes', async () => {
      // Session exists and is a failure, but there are no episodic memories
      const session = createSessionEntity(SESSION_ID, 'failure');
      const storage = createMockStorage([session]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.episodesAnalyzed).toBe(0);
      expect(result.lessons).toHaveLength(0);
      expect(result.createdEntities).toHaveLength(0);
    });

    it('should not count session entity itself as an episode', async () => {
      // The session entity itself has memoryType 'episodic' and entityType 'session'
      // It should be excluded from episode analysis
      const session = createSessionEntity(SESSION_ID, 'failure');
      const storage = createMockStorage([session]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result.episodesAnalyzed).toBe(0);
    });
  });

  // ==================== Custom configuration ====================

  describe('FailureDistillationConfig', () => {
    it('should use custom lessonEntityType', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      // ep with chain length 2 → confidence 0.7 → passes default 0.6 threshold
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Failure');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Cause');
      const ep_c = createEpisodeEntity('ep_c', SESSION_ID, 'Root');

      const storage = createMockStorage(
        [session, ep_a, ep_b, ep_c],
        [createCausalRelation('ep_a', 'ep_b'), createCausalRelation('ep_b', 'ep_c')]
      );

      const config: FailureDistillationConfig = { lessonEntityType: 'procedure' };
      const fd = new FailureDistillation(storage, config);
      await fd.distillFromSession(SESSION_ID);

      const calls = vi.mocked(storage.appendEntity).mock.calls;
      for (const [entity] of calls) {
        expect((entity as AgentEntity).entityType).toBe('procedure');
      }
    });

    it('should default config values correctly', async () => {
      const fd = new FailureDistillation(createMockStorage([]));
      // Access via distillFromSession on non-existent session — just verify no throws
      const result = await fd.distillFromSession('nonexistent');
      expect(result.episodesAnalyzed).toBe(0);
    });
  });

  // ==================== DistillationResult shape ====================

  describe('DistillationResult shape', () => {
    it('should return the correct result shape on success', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Failure A');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Cause B');
      const rel = createCausalRelation('ep_a', 'ep_b');

      const storage = createMockStorage([session, ep_a, ep_b], [rel]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      expect(result).toMatchObject({
        sessionId: SESSION_ID,
        lessons: expect.any(Array),
        createdEntities: expect.any(Array),
        episodesAnalyzed: expect.any(Number),
      });

      // lessons and createdEntities should have the same count
      expect(result.lessons.length).toBe(result.createdEntities.length);
    });

    it('should include all required fields in each DistilledLesson', async () => {
      const session = createSessionEntity(SESSION_ID, 'failure');
      const ep_a = createEpisodeEntity('ep_a', SESSION_ID, 'Failure root');
      const ep_b = createEpisodeEntity('ep_b', SESSION_ID, 'Direct cause');
      const rel = createCausalRelation('ep_a', 'ep_b');

      const storage = createMockStorage([session, ep_a, ep_b], [rel]);

      const fd = new FailureDistillation(storage);
      const result = await fd.distillFromSession(SESSION_ID);

      for (const lesson of result.lessons) {
        expect(typeof lesson.failureDescription).toBe('string');
        expect(Array.isArray(lesson.causeChain)).toBe(true);
        expect(typeof lesson.lesson).toBe('string');
        expect(typeof lesson.confidence).toBe('number');
        expect(lesson.confidence).toBeGreaterThanOrEqual(0);
        expect(lesson.confidence).toBeLessThanOrEqual(1);
        expect(lesson.sourceSessionId).toBe(SESSION_ID);
        expect(Array.isArray(lesson.sourceEpisodes)).toBe(true);
        expect(lesson.sourceEpisodes.length).toBeGreaterThan(0);
      }
    });
  });
});
