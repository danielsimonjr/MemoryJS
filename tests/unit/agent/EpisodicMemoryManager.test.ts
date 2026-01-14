/**
 * EpisodicMemoryManager Unit Tests
 *
 * Tests for episodic memory management including event sequencing,
 * timeline queries, and causal relationships.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EpisodicMemoryManager,
  EpisodicRelations,
} from '../../../src/agent/EpisodicMemoryManager.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

/**
 * Create a mock storage with configurable behavior.
 */
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
    loadGraph: vi.fn(async () => ({
      entities: storedEntities,
      relations: storedRelations,
    })),
    getEntityByName: vi.fn((name: string) => {
      return storedEntities.find((e) => e.name === name);
    }),
    getRelationsFrom: vi.fn((name: string) => {
      return storedRelations.filter((r) => r.from === name);
    }),
    getRelationsTo: vi.fn((name: string) => {
      return storedRelations.filter((r) => r.to === name);
    }),
    saveGraph: vi.fn(async () => {}),
    updateEntity: vi.fn(async () => {}),
    deleteEntity: vi.fn(async () => {}),
    deleteRelation: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  } as unknown as IGraphStorage;
}

/**
 * Create a test episodic entity.
 */
function createTestEpisode(
  name: string,
  sessionId: string,
  createdAt: string,
  content: string = 'Test content'
): AgentEntity {
  return {
    name,
    entityType: 'episode',
    observations: [content],
    createdAt,
    lastModified: createdAt,
    importance: 5,
    memoryType: 'episodic',
    sessionId,
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
  };
}

describe('EpisodicMemoryManager', () => {
  let storage: IGraphStorage;
  let emm: EpisodicMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    emm = new EpisodicMemoryManager(storage);
  });

  // ==================== Episode Creation ====================

  describe('createEpisode', () => {
    it('should create an episodic memory with default values', async () => {
      const episode = await emm.createEpisode('User asked about hotels');

      expect(episode.name).toMatch(/^episode_\d+_[a-z0-9]+$/);
      expect(episode.entityType).toBe('episode');
      expect(episode.observations).toContain('User asked about hotels');
      expect(episode.memoryType).toBe('episodic');
      expect(episode.importance).toBe(5);
      expect(episode.confidence).toBe(0.8);
      expect(storage.appendEntity).toHaveBeenCalledWith(episode);
    });

    it('should create an episode with custom options', async () => {
      const episode = await emm.createEpisode('Custom episode', {
        sessionId: 'session_123',
        taskId: 'task_456',
        entityType: 'conversation',
        importance: 8,
        confidence: 0.95,
        agentId: 'agent_1',
      });

      expect(episode.sessionId).toBe('session_123');
      expect(episode.taskId).toBe('task_456');
      expect(episode.entityType).toBe('conversation');
      expect(episode.importance).toBe(8);
      expect(episode.confidence).toBe(0.95);
      expect(episode.agentId).toBe('agent_1');
    });

    it('should auto-link to previous event when specified', async () => {
      const first = await emm.createEpisode('First event');
      const second = await emm.createEpisode('Second event', {
        previousEventId: first.name,
      });

      // Should have created precedes and follows relations
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: first.name,
          to: second.name,
          relationType: EpisodicRelations.PRECEDES,
        })
      );
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: second.name,
          to: first.name,
          relationType: EpisodicRelations.FOLLOWS,
        })
      );
    });

    it('should not auto-link when autoLinkTemporal is false', async () => {
      const customEmm = new EpisodicMemoryManager(storage, {
        autoLinkTemporal: false,
      });

      const first = await customEmm.createEpisode('First event');
      await customEmm.createEpisode('Second event', {
        previousEventId: first.name,
      });

      // Should only have entity appends, no relation appends for linking
      const relationCalls = (storage.appendRelation as ReturnType<typeof vi.fn>).mock.calls;
      expect(relationCalls.length).toBe(0);
    });
  });

  // ==================== Event Sequences ====================

  describe('createEventSequence', () => {
    it('should create multiple events as a linked sequence', async () => {
      const events = await emm.createEventSequence([
        'User logged in',
        'User searched for flights',
        'User booked a flight',
      ]);

      expect(events).toHaveLength(3);
      expect(events[0].observations[0]).toBe('User logged in');
      expect(events[1].observations[0]).toBe('User searched for flights');
      expect(events[2].observations[0]).toBe('User booked a flight');

      // Each event should be linked to the previous
      // First to second (precedes + follows)
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: events[0].name,
          to: events[1].name,
          relationType: EpisodicRelations.PRECEDES,
        })
      );
      // Second to third
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: events[1].name,
          to: events[2].name,
          relationType: EpisodicRelations.PRECEDES,
        })
      );
    });

    it('should apply shared options to all events', async () => {
      const events = await emm.createEventSequence(
        ['Event 1', 'Event 2'],
        { sessionId: 'session_shared', importance: 7 }
      );

      expect(events[0].sessionId).toBe('session_shared');
      expect(events[0].importance).toBe(7);
      expect(events[1].sessionId).toBe('session_shared');
      expect(events[1].importance).toBe(7);
    });
  });

  describe('linkSequence', () => {
    it('should link multiple events into a sequence', async () => {
      const e1 = await emm.createEpisode('Event 1');
      const e2 = await emm.createEpisode('Event 2');
      const e3 = await emm.createEpisode('Event 3');

      // Reset mock to only count linkSequence calls
      vi.clearAllMocks();

      await emm.linkSequence([e1.name, e2.name, e3.name]);

      // Should create precedes/follows for e1->e2 and e2->e3
      expect(storage.appendRelation).toHaveBeenCalledTimes(4); // 2 pairs * 2 relations each
    });

    it('should do nothing for empty or single-element arrays', async () => {
      vi.clearAllMocks();

      await emm.linkSequence([]);
      await emm.linkSequence(['single']);

      expect(storage.appendRelation).not.toHaveBeenCalled();
    });

    it('should throw when sequence exceeds max length', async () => {
      const customEmm = new EpisodicMemoryManager(storage, {
        maxSequenceLength: 3,
      });

      await expect(
        customEmm.linkSequence(['a', 'b', 'c', 'd'])
      ).rejects.toThrow('Sequence exceeds max length');
    });
  });

  // ==================== Timeline Queries ====================

  describe('getTimeline', () => {
    it('should return episodes for a session in ascending order', async () => {
      const sessionId = 'session_timeline';
      const entities = [
        createTestEpisode('ep3', sessionId, '2026-01-13T12:00:00Z', 'Third'),
        createTestEpisode('ep1', sessionId, '2026-01-13T10:00:00Z', 'First'),
        createTestEpisode('ep2', sessionId, '2026-01-13T11:00:00Z', 'Second'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const timeline = await emm.getTimeline(sessionId, { order: 'asc' });

      expect(timeline).toHaveLength(3);
      expect(timeline[0].name).toBe('ep1');
      expect(timeline[1].name).toBe('ep2');
      expect(timeline[2].name).toBe('ep3');
    });

    it('should return episodes in descending order', async () => {
      const sessionId = 'session_desc';
      const entities = [
        createTestEpisode('ep1', sessionId, '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', sessionId, '2026-01-13T11:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const timeline = await emm.getTimeline(sessionId, { order: 'desc' });

      expect(timeline[0].name).toBe('ep2');
      expect(timeline[1].name).toBe('ep1');
    });

    it('should filter by time range', async () => {
      const sessionId = 'session_range';
      const entities = [
        createTestEpisode('ep1', sessionId, '2026-01-13T08:00:00Z'),
        createTestEpisode('ep2', sessionId, '2026-01-13T10:00:00Z'),
        createTestEpisode('ep3', sessionId, '2026-01-13T12:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const timeline = await emm.getTimeline(sessionId, {
        startTime: '2026-01-13T09:00:00Z',
        endTime: '2026-01-13T11:00:00Z',
      });

      expect(timeline).toHaveLength(1);
      expect(timeline[0].name).toBe('ep2');
    });

    it('should apply pagination', async () => {
      const sessionId = 'session_page';
      const entities = [
        createTestEpisode('ep1', sessionId, '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', sessionId, '2026-01-13T11:00:00Z'),
        createTestEpisode('ep3', sessionId, '2026-01-13T12:00:00Z'),
        createTestEpisode('ep4', sessionId, '2026-01-13T13:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const page = await emm.getTimeline(sessionId, { offset: 1, limit: 2 });

      expect(page).toHaveLength(2);
      expect(page[0].name).toBe('ep2');
      expect(page[1].name).toBe('ep3');
    });

    it('should only include episodic memories, not sessions', async () => {
      const sessionId = 'session_filter';
      const sessionEntity: AgentEntity = {
        name: sessionId,
        entityType: 'session',
        observations: ['Session started'],
        memoryType: 'episodic',
        sessionId: sessionId,
        createdAt: '2026-01-13T10:00:00Z',
        accessCount: 0,
        confirmationCount: 0,
      };
      const episode = createTestEpisode('ep1', sessionId, '2026-01-13T11:00:00Z');

      storage = createMockStorage([sessionEntity, episode]);
      emm = new EpisodicMemoryManager(storage);

      const timeline = await emm.getTimeline(sessionId);

      expect(timeline).toHaveLength(1);
      expect(timeline[0].name).toBe('ep1');
    });
  });

  describe('iterateForward and iterateBackward', () => {
    it('should iterate forward through timeline', async () => {
      const sessionId = 'session_iter';
      const entities = [
        createTestEpisode('ep2', sessionId, '2026-01-13T11:00:00Z'),
        createTestEpisode('ep1', sessionId, '2026-01-13T10:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const results: AgentEntity[] = [];
      for await (const episode of emm.iterateForward(sessionId)) {
        results.push(episode);
      }

      expect(results[0].name).toBe('ep1');
      expect(results[1].name).toBe('ep2');
    });

    it('should iterate backward through timeline', async () => {
      const sessionId = 'session_iter_back';
      const entities = [
        createTestEpisode('ep1', sessionId, '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', sessionId, '2026-01-13T11:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const results: AgentEntity[] = [];
      for await (const episode of emm.iterateBackward(sessionId)) {
        results.push(episode);
      }

      expect(results[0].name).toBe('ep2');
      expect(results[1].name).toBe('ep1');
    });
  });

  describe('getNextEvent and getPreviousEvent', () => {
    it('should get the next event via precedes relation', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      const ep2 = createTestEpisode('ep2', 'sess', '2026-01-13T11:00:00Z');
      const relations: Relation[] = [
        { from: 'ep1', to: 'ep2', relationType: EpisodicRelations.PRECEDES },
      ];

      storage = createMockStorage([ep1, ep2], relations);
      emm = new EpisodicMemoryManager(storage);

      const next = await emm.getNextEvent('ep1');

      expect(next?.name).toBe('ep2');
    });

    it('should get the previous event via follows relation', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      const ep2 = createTestEpisode('ep2', 'sess', '2026-01-13T11:00:00Z');
      const relations: Relation[] = [
        { from: 'ep2', to: 'ep1', relationType: EpisodicRelations.FOLLOWS },
      ];

      storage = createMockStorage([ep1, ep2], relations);
      emm = new EpisodicMemoryManager(storage);

      const prev = await emm.getPreviousEvent('ep2');

      expect(prev?.name).toBe('ep1');
    });

    it('should return undefined when no next/previous exists', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      storage = createMockStorage([ep1]);
      emm = new EpisodicMemoryManager(storage);

      const next = await emm.getNextEvent('ep1');
      const prev = await emm.getPreviousEvent('ep1');

      expect(next).toBeUndefined();
      expect(prev).toBeUndefined();
    });
  });

  // ==================== Causal Relationships ====================

  describe('addCausalLink', () => {
    it('should create bidirectional causal relations', async () => {
      const cause = createTestEpisode('cause', 'sess', '2026-01-13T10:00:00Z');
      const effect = createTestEpisode('effect', 'sess', '2026-01-13T11:00:00Z');

      storage = createMockStorage([cause, effect]);
      emm = new EpisodicMemoryManager(storage);

      await emm.addCausalLink('cause', 'effect');

      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'cause',
          to: 'effect',
          relationType: EpisodicRelations.CAUSES,
        })
      );
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'effect',
          to: 'cause',
          relationType: EpisodicRelations.CAUSED_BY,
        })
      );
    });

    it('should throw when cause entity not found', async () => {
      const effect = createTestEpisode('effect', 'sess', '2026-01-13T10:00:00Z');
      storage = createMockStorage([effect]);
      emm = new EpisodicMemoryManager(storage);

      await expect(emm.addCausalLink('nonexistent', 'effect')).rejects.toThrow(
        'Cause entity not found'
      );
    });

    it('should throw when effect entity not found', async () => {
      const cause = createTestEpisode('cause', 'sess', '2026-01-13T10:00:00Z');
      storage = createMockStorage([cause]);
      emm = new EpisodicMemoryManager(storage);

      await expect(emm.addCausalLink('cause', 'nonexistent')).rejects.toThrow(
        'Effect entity not found'
      );
    });
  });

  describe('getCausalChain', () => {
    it('should traverse causes chain', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      const ep2 = createTestEpisode('ep2', 'sess', '2026-01-13T11:00:00Z');
      const ep3 = createTestEpisode('ep3', 'sess', '2026-01-13T12:00:00Z');
      const relations: Relation[] = [
        { from: 'ep1', to: 'ep2', relationType: EpisodicRelations.CAUSES },
        { from: 'ep2', to: 'ep3', relationType: EpisodicRelations.CAUSES },
      ];

      storage = createMockStorage([ep1, ep2, ep3], relations);
      emm = new EpisodicMemoryManager(storage);

      const chain = await emm.getCausalChain('ep1', 'causes');

      expect(chain).toHaveLength(3);
      expect(chain.map((e) => e.name)).toEqual(['ep1', 'ep2', 'ep3']);
    });

    it('should traverse caused_by chain', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      const ep2 = createTestEpisode('ep2', 'sess', '2026-01-13T11:00:00Z');
      const ep3 = createTestEpisode('ep3', 'sess', '2026-01-13T12:00:00Z');
      const relations: Relation[] = [
        { from: 'ep3', to: 'ep2', relationType: EpisodicRelations.CAUSED_BY },
        { from: 'ep2', to: 'ep1', relationType: EpisodicRelations.CAUSED_BY },
      ];

      storage = createMockStorage([ep1, ep2, ep3], relations);
      emm = new EpisodicMemoryManager(storage);

      const chain = await emm.getCausalChain('ep3', 'caused_by');

      expect(chain).toHaveLength(3);
      expect(chain.map((e) => e.name)).toEqual(['ep3', 'ep2', 'ep1']);
    });

    it('should prevent infinite loops in cyclic chains', async () => {
      const ep1 = createTestEpisode('ep1', 'sess', '2026-01-13T10:00:00Z');
      const ep2 = createTestEpisode('ep2', 'sess', '2026-01-13T11:00:00Z');
      const relations: Relation[] = [
        { from: 'ep1', to: 'ep2', relationType: EpisodicRelations.CAUSES },
        { from: 'ep2', to: 'ep1', relationType: EpisodicRelations.CAUSES }, // Cycle
      ];

      storage = createMockStorage([ep1, ep2], relations);
      emm = new EpisodicMemoryManager(storage);

      const chain = await emm.getCausalChain('ep1', 'causes');

      // Should only include each entity once
      expect(chain).toHaveLength(2);
    });
  });

  describe('getDirectCauses and getDirectEffects', () => {
    it('should get direct causes of an event', async () => {
      const cause1 = createTestEpisode('cause1', 'sess', '2026-01-13T10:00:00Z');
      const cause2 = createTestEpisode('cause2', 'sess', '2026-01-13T10:30:00Z');
      const effect = createTestEpisode('effect', 'sess', '2026-01-13T11:00:00Z');
      const relations: Relation[] = [
        { from: 'cause1', to: 'effect', relationType: EpisodicRelations.CAUSES },
        { from: 'cause2', to: 'effect', relationType: EpisodicRelations.CAUSES },
      ];

      storage = createMockStorage([cause1, cause2, effect], relations);
      emm = new EpisodicMemoryManager(storage);

      const causes = await emm.getDirectCauses('effect');

      expect(causes).toHaveLength(2);
      expect(causes.map((e) => e.name).sort()).toEqual(['cause1', 'cause2']);
    });

    it('should get direct effects of an event', async () => {
      const cause = createTestEpisode('cause', 'sess', '2026-01-13T10:00:00Z');
      const effect1 = createTestEpisode('effect1', 'sess', '2026-01-13T11:00:00Z');
      const effect2 = createTestEpisode('effect2', 'sess', '2026-01-13T11:30:00Z');
      const relations: Relation[] = [
        { from: 'cause', to: 'effect1', relationType: EpisodicRelations.CAUSES },
        { from: 'cause', to: 'effect2', relationType: EpisodicRelations.CAUSES },
      ];

      storage = createMockStorage([cause, effect1, effect2], relations);
      emm = new EpisodicMemoryManager(storage);

      const effects = await emm.getDirectEffects('cause');

      expect(effects).toHaveLength(2);
      expect(effects.map((e) => e.name).sort()).toEqual(['effect1', 'effect2']);
    });
  });

  // ==================== Utility Methods ====================

  describe('getAllEpisodes', () => {
    it('should return all episodic memories across sessions', async () => {
      const entities = [
        createTestEpisode('ep1', 'sess1', '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', 'sess2', '2026-01-13T11:00:00Z'),
        createTestEpisode('ep3', 'sess1', '2026-01-13T12:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const all = await emm.getAllEpisodes();

      expect(all).toHaveLength(3);
    });

    it('should filter and paginate all episodes', async () => {
      const entities = [
        createTestEpisode('ep1', 'sess1', '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', 'sess1', '2026-01-13T11:00:00Z'),
        createTestEpisode('ep3', 'sess1', '2026-01-13T12:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const page = await emm.getAllEpisodes({
        order: 'desc',
        limit: 2,
      });

      expect(page).toHaveLength(2);
      expect(page[0].name).toBe('ep3');
      expect(page[1].name).toBe('ep2');
    });
  });

  describe('getEpisodeCount', () => {
    it('should count episodes for a session', async () => {
      const entities = [
        createTestEpisode('ep1', 'sess1', '2026-01-13T10:00:00Z'),
        createTestEpisode('ep2', 'sess1', '2026-01-13T11:00:00Z'),
        createTestEpisode('ep3', 'sess2', '2026-01-13T12:00:00Z'),
      ];

      storage = createMockStorage(entities);
      emm = new EpisodicMemoryManager(storage);

      const count = await emm.getEpisodeCount('sess1');

      expect(count).toBe(2);
    });
  });
});
