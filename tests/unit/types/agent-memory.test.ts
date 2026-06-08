/**
 * Unit tests for Agent Memory Type Guards and Classes
 *
 * Tests the type guards and utility classes defined in src/types/agent-memory.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isAgentEntity,
  isSessionEntity,
  isWorkingMemory,
  isEpisodicMemory,
  isSemanticMemory,
  isProceduralMemory,
  AccessContextBuilder,
  type AgentEntity,
  type SessionEntity,
  type MemoryType,
  type MemoryVisibility,
} from '../../../src/types/index.js';

// ==================== Test Fixtures ====================

/**
 * Creates a minimal valid AgentEntity for testing
 */
function createAgentEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name: 'test_entity',
    entityType: 'test',
    observations: [],
    memoryType: 'working',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
    ...overrides,
  };
}

/**
 * Creates a minimal valid SessionEntity for testing
 */
function createSessionEntity(overrides: Partial<SessionEntity> = {}): SessionEntity {
  return {
    name: 'test_session',
    entityType: 'session',
    observations: [],
    memoryType: 'episodic',
    accessCount: 0,
    confidence: 1.0,
    confirmationCount: 0,
    visibility: 'private',
    startedAt: new Date().toISOString(),
    status: 'active',
    memoryCount: 0,
    consolidatedCount: 0,
    ...overrides,
  };
}

// ==================== isAgentEntity Tests ====================

describe('isAgentEntity', () => {
  it('should return true for valid AgentEntity', () => {
    const entity = createAgentEntity();
    expect(isAgentEntity(entity)).toBe(true);
  });

  it('should return true for all memory types', () => {
    const memoryTypes: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural'];
    for (const memoryType of memoryTypes) {
      const entity = createAgentEntity({ memoryType });
      expect(isAgentEntity(entity)).toBe(true);
    }
  });

  it('should return true for all visibility levels', () => {
    const visibilities: MemoryVisibility[] = ['private', 'shared', 'public'];
    for (const visibility of visibilities) {
      const entity = createAgentEntity({ visibility });
      expect(isAgentEntity(entity)).toBe(true);
    }
  });

  it('should return true for entity with optional fields', () => {
    const entity = createAgentEntity({
      sessionId: 'session_123',
      expiresAt: '2024-12-31T23:59:59Z',
      lastAccessedAt: '2024-01-15T10:30:00Z',
      agentId: 'agent_001',
      source: {
        agentId: 'agent_001',
        timestamp: '2024-01-15T10:30:00Z',
        method: 'observed',
        reliability: 0.95,
      },
    });
    expect(isAgentEntity(entity)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isAgentEntity(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAgentEntity(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(isAgentEntity('string')).toBe(false);
    expect(isAgentEntity(123)).toBe(false);
    expect(isAgentEntity(true)).toBe(false);
    expect(isAgentEntity([])).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isAgentEntity({})).toBe(false);
  });

  it('should return false when missing required name', () => {
    const entity = createAgentEntity();
    const { name, ...withoutName } = entity;
    expect(isAgentEntity(withoutName)).toBe(false);
  });

  it('should return false when missing required entityType', () => {
    const entity = createAgentEntity();
    const { entityType, ...withoutType } = entity;
    expect(isAgentEntity(withoutType)).toBe(false);
  });

  it('should return false when missing required memoryType', () => {
    const entity = createAgentEntity();
    const { memoryType, ...withoutMemoryType } = entity;
    expect(isAgentEntity(withoutMemoryType)).toBe(false);
  });

  it('should return false for invalid memoryType value', () => {
    const entity = { ...createAgentEntity(), memoryType: 'invalid' };
    expect(isAgentEntity(entity)).toBe(false);
  });

  it('should return false when missing required accessCount', () => {
    const entity = createAgentEntity();
    const { accessCount, ...withoutAccessCount } = entity;
    expect(isAgentEntity(withoutAccessCount)).toBe(false);
  });

  it('should return false when missing required confidence', () => {
    const entity = createAgentEntity();
    const { confidence, ...withoutConfidence } = entity;
    expect(isAgentEntity(withoutConfidence)).toBe(false);
  });

  it('should return false when missing required confirmationCount', () => {
    const entity = createAgentEntity();
    const { confirmationCount, ...withoutConfirmationCount } = entity;
    expect(isAgentEntity(withoutConfirmationCount)).toBe(false);
  });

  it('should return false when missing required visibility', () => {
    const entity = createAgentEntity();
    const { visibility, ...withoutVisibility } = entity;
    expect(isAgentEntity(withoutVisibility)).toBe(false);
  });

  it('should return false for invalid visibility value', () => {
    const entity = { ...createAgentEntity(), visibility: 'invalid' };
    expect(isAgentEntity(entity)).toBe(false);
  });

  it('should return false when required fields have wrong types', () => {
    expect(isAgentEntity({ ...createAgentEntity(), name: 123 })).toBe(false);
    expect(isAgentEntity({ ...createAgentEntity(), entityType: 123 })).toBe(false);
    expect(isAgentEntity({ ...createAgentEntity(), accessCount: 'string' })).toBe(false);
    expect(isAgentEntity({ ...createAgentEntity(), confidence: 'string' })).toBe(false);
    expect(isAgentEntity({ ...createAgentEntity(), confirmationCount: 'string' })).toBe(false);
  });
});

// ==================== isSessionEntity Tests ====================

describe('isSessionEntity', () => {
  it('should return true for valid SessionEntity', () => {
    const session = createSessionEntity();
    expect(isSessionEntity(session)).toBe(true);
  });

  it('should return true for all session statuses', () => {
    const statuses = ['active', 'completed', 'abandoned'] as const;
    for (const status of statuses) {
      const session = createSessionEntity({ status });
      expect(isSessionEntity(session)).toBe(true);
    }
  });

  it('should return true for session with optional fields', () => {
    const session = createSessionEntity({
      endedAt: '2024-01-15T12:00:00Z',
      goalDescription: 'Help user plan trip',
      taskType: 'travel_planning',
      previousSessionId: 'session_prev',
      relatedSessionIds: ['session_a', 'session_b'],
    });
    expect(isSessionEntity(session)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isSessionEntity(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isSessionEntity(undefined)).toBe(false);
  });

  it('should return false for regular AgentEntity', () => {
    const entity = createAgentEntity();
    expect(isSessionEntity(entity)).toBe(false);
  });

  it('should return false when entityType is not session', () => {
    const session = createSessionEntity({ entityType: 'task' as 'session' });
    expect(isSessionEntity(session)).toBe(false);
  });

  it('should return false when memoryType is not episodic', () => {
    const session = createSessionEntity({ memoryType: 'working' as 'episodic' });
    expect(isSessionEntity(session)).toBe(false);
  });

  it('should return false when missing startedAt', () => {
    const session = createSessionEntity();
    const { startedAt, ...withoutStartedAt } = session;
    expect(isSessionEntity(withoutStartedAt)).toBe(false);
  });

  it('should return false when missing status', () => {
    const session = createSessionEntity();
    const { status, ...withoutStatus } = session;
    expect(isSessionEntity(withoutStatus)).toBe(false);
  });

  it('should return false for invalid status value', () => {
    const session = { ...createSessionEntity(), status: 'invalid' };
    expect(isSessionEntity(session)).toBe(false);
  });

  it('should return false when missing memoryCount', () => {
    const session = createSessionEntity();
    const { memoryCount, ...withoutMemoryCount } = session;
    expect(isSessionEntity(withoutMemoryCount)).toBe(false);
  });

  it('should return false when missing consolidatedCount', () => {
    const session = createSessionEntity();
    const { consolidatedCount, ...withoutConsolidatedCount } = session;
    expect(isSessionEntity(withoutConsolidatedCount)).toBe(false);
  });
});

// ==================== isWorkingMemory Tests ====================

describe('isWorkingMemory', () => {
  it('should return true for working memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'working' });
    expect(isWorkingMemory(entity)).toBe(true);
  });

  it('should return false for episodic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'episodic' });
    expect(isWorkingMemory(entity)).toBe(false);
  });

  it('should return false for semantic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'semantic' });
    expect(isWorkingMemory(entity)).toBe(false);
  });

  it('should return false for procedural memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'procedural' });
    expect(isWorkingMemory(entity)).toBe(false);
  });

  it('should return false for non-AgentEntity', () => {
    expect(isWorkingMemory({})).toBe(false);
    expect(isWorkingMemory(null)).toBe(false);
  });
});

// ==================== isEpisodicMemory Tests ====================

describe('isEpisodicMemory', () => {
  it('should return true for episodic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'episodic' });
    expect(isEpisodicMemory(entity)).toBe(true);
  });

  it('should return true for SessionEntity (which is episodic)', () => {
    const session = createSessionEntity();
    expect(isEpisodicMemory(session)).toBe(true);
  });

  it('should return false for working memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'working' });
    expect(isEpisodicMemory(entity)).toBe(false);
  });

  it('should return false for semantic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'semantic' });
    expect(isEpisodicMemory(entity)).toBe(false);
  });

  it('should return false for procedural memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'procedural' });
    expect(isEpisodicMemory(entity)).toBe(false);
  });

  it('should return false for non-AgentEntity', () => {
    expect(isEpisodicMemory({})).toBe(false);
    expect(isEpisodicMemory(null)).toBe(false);
  });
});

// ==================== isSemanticMemory Tests ====================

describe('isSemanticMemory', () => {
  it('should return true for semantic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'semantic' });
    expect(isSemanticMemory(entity)).toBe(true);
  });

  it('should return false for working memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'working' });
    expect(isSemanticMemory(entity)).toBe(false);
  });

  it('should return false for episodic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'episodic' });
    expect(isSemanticMemory(entity)).toBe(false);
  });

  it('should return false for procedural memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'procedural' });
    expect(isSemanticMemory(entity)).toBe(false);
  });

  it('should return false for non-AgentEntity', () => {
    expect(isSemanticMemory({})).toBe(false);
    expect(isSemanticMemory(null)).toBe(false);
  });
});

// ==================== isProceduralMemory Tests ====================

describe('isProceduralMemory', () => {
  it('should return true for procedural memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'procedural' });
    expect(isProceduralMemory(entity)).toBe(true);
  });

  it('should return false for working memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'working' });
    expect(isProceduralMemory(entity)).toBe(false);
  });

  it('should return false for episodic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'episodic' });
    expect(isProceduralMemory(entity)).toBe(false);
  });

  it('should return false for semantic memory entity', () => {
    const entity = createAgentEntity({ memoryType: 'semantic' });
    expect(isProceduralMemory(entity)).toBe(false);
  });

  it('should return false for non-AgentEntity', () => {
    expect(isProceduralMemory({})).toBe(false);
    expect(isProceduralMemory(null)).toBe(false);
  });
});

// ==================== AccessContextBuilder Tests ====================

describe('AccessContextBuilder', () => {
  it('should build empty context by default', () => {
    const context = new AccessContextBuilder().build();
    expect(context).toEqual({});
  });

  it('should set sessionId with forSession()', () => {
    const context = new AccessContextBuilder()
      .forSession('session_123')
      .build();
    expect(context.sessionId).toBe('session_123');
  });

  it('should set taskId with forTask()', () => {
    const context = new AccessContextBuilder()
      .forTask('task_456')
      .build();
    expect(context.taskId).toBe('task_456');
  });

  it('should set queryContext with withQuery()', () => {
    const context = new AccessContextBuilder()
      .withQuery('budget hotels')
      .build();
    expect(context.queryContext).toBe('budget hotels');
  });

  it('should set retrievalMethod to search with viaSearch()', () => {
    const context = new AccessContextBuilder()
      .viaSearch()
      .build();
    expect(context.retrievalMethod).toBe('search');
  });

  it('should set retrievalMethod to direct with viaDirect()', () => {
    const context = new AccessContextBuilder()
      .viaDirect()
      .build();
    expect(context.retrievalMethod).toBe('direct');
  });

  it('should set retrievalMethod to traversal with viaTraversal()', () => {
    const context = new AccessContextBuilder()
      .viaTraversal()
      .build();
    expect(context.retrievalMethod).toBe('traversal');
  });

  it('should support method chaining', () => {
    const context = new AccessContextBuilder()
      .forSession('session_123')
      .forTask('task_456')
      .withQuery('hotel preferences')
      .viaSearch()
      .build();

    expect(context).toEqual({
      sessionId: 'session_123',
      taskId: 'task_456',
      queryContext: 'hotel preferences',
      retrievalMethod: 'search',
    });
  });

  it('should allow overriding values', () => {
    const context = new AccessContextBuilder()
      .viaSearch()
      .viaDirect() // override
      .build();
    expect(context.retrievalMethod).toBe('direct');
  });

  it('should return a new object on each build', () => {
    const builder = new AccessContextBuilder().forSession('session_123');
    const context1 = builder.build();
    const context2 = builder.build();

    expect(context1).toEqual(context2);
    expect(context1).not.toBe(context2); // different object references
  });
});

// ==================== Type Guard Edge Cases ====================

describe('Type Guard Edge Cases', () => {
  it('should handle entity with all optional fields set', () => {
    const entity: AgentEntity = {
      name: 'full_entity',
      entityType: 'test',
      observations: ['obs1', 'obs2'],
      memoryType: 'working',
      sessionId: 'session_123',
      conversationId: 'conv_456',
      taskId: 'task_789',
      expiresAt: '2024-12-31T23:59:59Z',
      isWorkingMemory: true,
      promotedAt: '2024-01-15T10:30:00Z',
      promotedFrom: 'entity_old',
      markedForPromotion: true,
      accessCount: 10,
      lastAccessedAt: '2024-01-15T10:30:00Z',
      accessPattern: 'frequent',
      confidence: 0.95,
      confirmationCount: 5,
      decayRate: 0.5,
      agentId: 'agent_001',
      visibility: 'shared',
      source: {
        agentId: 'agent_001',
        timestamp: '2024-01-15T10:30:00Z',
        method: 'observed',
        reliability: 0.95,
      },
    };
    expect(isAgentEntity(entity)).toBe(true);
  });

  it('should handle entity with zero values', () => {
    const entity = createAgentEntity({
      accessCount: 0,
      confidence: 0,
      confirmationCount: 0,
    });
    expect(isAgentEntity(entity)).toBe(true);
  });

  it('should handle entity with empty string name', () => {
    const entity = createAgentEntity({ name: '' });
    expect(isAgentEntity(entity)).toBe(true); // empty string is still a string
  });

  it('should properly narrow types after guard', () => {
    const maybeEntity: unknown = createAgentEntity({ memoryType: 'semantic' });

    if (isAgentEntity(maybeEntity)) {
      // TypeScript should know this is AgentEntity
      expect(maybeEntity.memoryType).toBe('semantic');
      expect(maybeEntity.accessCount).toBe(0);
    }
  });

  it('should properly narrow session types', () => {
    const maybeSession: unknown = createSessionEntity();

    if (isSessionEntity(maybeSession)) {
      // TypeScript should know this is SessionEntity
      expect(maybeSession.status).toBe('active');
      expect(maybeSession.memoryCount).toBe(0);
    }
  });
});
