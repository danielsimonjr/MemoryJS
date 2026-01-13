/**
 * Unit tests for AccessTracker
 *
 * Tests memory access tracking functionality including:
 * - Recording accesses with context
 * - Access statistics calculation
 * - Recency scoring with exponential decay
 * - Frequently/recently accessed retrieval
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AccessTracker, type AccessTrackerConfig } from '../../../src/agent/AccessTracker.js';
import type { IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

// ==================== Mock Storage ====================

function createMockStorage(entities: Record<string, AgentEntity> = {}): IGraphStorage {
  const entityMap = new Map(Object.entries(entities));

  return {
    getEntityByName: vi.fn((name: string) => entityMap.get(name) ?? null),
    updateEntity: vi.fn(async () => {}),
    // Add other required methods with minimal implementations
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

function createAgentEntity(name: string, overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name,
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

// ==================== Constructor Tests ====================

describe('AccessTracker Constructor', () => {
  it('should create instance with default config', () => {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);

    expect(tracker).toBeInstanceOf(AccessTracker);
    expect(tracker.getTrackedEntities()).toHaveLength(0);
    expect(tracker.isDirty()).toBe(false);
  });

  it('should create instance with custom config', () => {
    const storage = createMockStorage();
    const config: AccessTrackerConfig = {
      historyBufferSize: 50,
      recencyHalfLifeHours: 12,
      frequentThreshold: 20,
      occasionalThreshold: 5,
    };
    const tracker = new AccessTracker(storage, config);

    expect(tracker).toBeInstanceOf(AccessTracker);
  });

  it('should use default values for unspecified config options', () => {
    const storage = createMockStorage();
    const config: AccessTrackerConfig = {
      historyBufferSize: 50,
      // Other options use defaults
    };
    const tracker = new AccessTracker(storage, config);

    expect(tracker).toBeInstanceOf(AccessTracker);
  });
});

// ==================== recordAccess Tests ====================

describe('AccessTracker.recordAccess', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage({
      test_entity: createAgentEntity('test_entity'),
    });
    tracker = new AccessTracker(storage);
  });

  it('should create new record for first access', async () => {
    await tracker.recordAccess('test_entity');

    expect(tracker.getTrackedEntities()).toContain('test_entity');
    expect(tracker.isDirty()).toBe(true);
  });

  it('should increment access count on repeated access', async () => {
    await tracker.recordAccess('test_entity');
    await tracker.recordAccess('test_entity');
    await tracker.recordAccess('test_entity');

    const stats = await tracker.getAccessStats('test_entity');
    expect(stats.totalAccesses).toBe(3);
  });

  it('should update lastAccessedAt timestamp', async () => {
    await tracker.recordAccess('test_entity');

    const stats = await tracker.getAccessStats('test_entity');
    expect(stats.lastAccessedAt).toBeTruthy();
    expect(new Date(stats.lastAccessedAt).getTime()).toBeCloseTo(Date.now(), -3);
  });

  it('should track session-specific access counts', async () => {
    await tracker.recordAccess('test_entity', { sessionId: 'session_1' });
    await tracker.recordAccess('test_entity', { sessionId: 'session_1' });
    await tracker.recordAccess('test_entity', { sessionId: 'session_2' });

    const stats = await tracker.getAccessStats('test_entity');
    expect(stats.accessesBySession['session_1']).toBe(2);
    expect(stats.accessesBySession['session_2']).toBe(1);
  });

  it('should track accesses without session context', async () => {
    await tracker.recordAccess('test_entity');
    await tracker.recordAccess('test_entity', { taskId: 'task_1' });

    const stats = await tracker.getAccessStats('test_entity');
    expect(stats.totalAccesses).toBe(2);
    expect(Object.keys(stats.accessesBySession)).toHaveLength(0);
  });

  it('should maintain circular buffer of recent accesses', async () => {
    const smallBufferTracker = new AccessTracker(storage, { historyBufferSize: 3 });

    await smallBufferTracker.recordAccess('test_entity');
    await smallBufferTracker.recordAccess('test_entity');
    await smallBufferTracker.recordAccess('test_entity');
    await smallBufferTracker.recordAccess('test_entity');
    await smallBufferTracker.recordAccess('test_entity');

    const stats = await smallBufferTracker.getAccessStats('test_entity');
    // Total accesses should still be 5
    expect(stats.totalAccesses).toBe(5);
    // But interval calculation uses only buffer size
  });

  it('should call storage updateEntity for existing entities', async () => {
    await tracker.recordAccess('test_entity');

    expect(storage.updateEntity).toHaveBeenCalledWith('test_entity', expect.any(Object));
  });

  it('should not call storage updateEntity for non-existent entities', async () => {
    await tracker.recordAccess('non_existent');

    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('should handle multiple entities independently', async () => {
    const multiStorage = createMockStorage({
      entity_a: createAgentEntity('entity_a'),
      entity_b: createAgentEntity('entity_b'),
    });
    const multiTracker = new AccessTracker(multiStorage);

    await multiTracker.recordAccess('entity_a');
    await multiTracker.recordAccess('entity_a');
    await multiTracker.recordAccess('entity_b');

    const statsA = await multiTracker.getAccessStats('entity_a');
    const statsB = await multiTracker.getAccessStats('entity_b');

    expect(statsA.totalAccesses).toBe(2);
    expect(statsB.totalAccesses).toBe(1);
  });
});

// ==================== getAccessStats Tests ====================

describe('AccessTracker.getAccessStats', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage);
  });

  it('should return default stats for untracked entity', async () => {
    const stats = await tracker.getAccessStats('unknown_entity');

    expect(stats.totalAccesses).toBe(0);
    expect(stats.lastAccessedAt).toBe('');
    expect(stats.accessPattern).toBe('rare');
    expect(stats.averageAccessInterval).toBe(Infinity);
    expect(stats.accessesBySession).toEqual({});
  });

  it('should return accurate stats after multiple accesses', async () => {
    await tracker.recordAccess('entity');
    await tracker.recordAccess('entity');
    await tracker.recordAccess('entity');

    const stats = await tracker.getAccessStats('entity');

    expect(stats.totalAccesses).toBe(3);
    expect(stats.lastAccessedAt).toBeTruthy();
    expect(stats.accessesBySession).toEqual({});
  });

  it('should return copy of session access counts', async () => {
    await tracker.recordAccess('entity', { sessionId: 'session_1' });

    const stats = await tracker.getAccessStats('entity');
    stats.accessesBySession['session_1'] = 999; // Modify returned object

    const stats2 = await tracker.getAccessStats('entity');
    expect(stats2.accessesBySession['session_1']).toBe(1); // Original unchanged
  });
});

// ==================== Access Pattern Classification Tests ====================

describe('AccessTracker Access Pattern Classification', () => {
  let storage: IGraphStorage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('should classify as rare with single access', async () => {
    const tracker = new AccessTracker(storage);
    await tracker.recordAccess('entity');

    const stats = await tracker.getAccessStats('entity');
    expect(stats.accessPattern).toBe('rare');
  });

  it('should classify based on frequency thresholds', async () => {
    const tracker = new AccessTracker(storage, {
      frequentThreshold: 10,
      occasionalThreshold: 1,
    });

    // Record many accesses in quick succession (same day = high frequency)
    for (let i = 0; i < 15; i++) {
      await tracker.recordAccess('frequent_entity');
    }

    const stats = await tracker.getAccessStats('frequent_entity');
    // With 15 accesses in milliseconds (effectively same moment),
    // days_diff would be ~1, so accessesPerDay = 15 >= 10 = 'frequent'
    expect(stats.accessPattern).toBe('frequent');
  });
});

// ==================== calculateRecencyScore Tests ====================

describe('AccessTracker.calculateRecencyScore', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage, { recencyHalfLifeHours: 24 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 for untracked entity', () => {
    const score = tracker.calculateRecencyScore('unknown');
    expect(score).toBe(0);
  });

  it('should return ~1.0 for just-accessed entity', async () => {
    await tracker.recordAccess('entity');

    const score = tracker.calculateRecencyScore('entity');
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should return ~0.5 after one half-life', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity');

    // Advance 24 hours (one half-life)
    vi.setSystemTime(now + 24 * 60 * 60 * 1000);

    const score = tracker.calculateRecencyScore('entity');
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('should return ~0.25 after two half-lives', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity');

    // Advance 48 hours (two half-lives)
    vi.setSystemTime(now + 48 * 60 * 60 * 1000);

    const score = tracker.calculateRecencyScore('entity');
    expect(score).toBeCloseTo(0.25, 1);
  });

  it('should support custom half-life parameter', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity');

    // Advance 12 hours
    vi.setSystemTime(now + 12 * 60 * 60 * 1000);

    // With half-life of 12 hours, should be ~0.5
    const score = tracker.calculateRecencyScore('entity', 12);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('should always return value between 0 and 1', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity');

    // Test various time intervals
    const intervals = [0, 1, 24, 168, 720, 8760]; // hours

    for (const hours of intervals) {
      vi.setSystemTime(now + hours * 60 * 60 * 1000);
      const score = tracker.calculateRecencyScore('entity');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ==================== Static calculateRecencyScoreFromTimestamp Tests ====================

describe('AccessTracker.calculateRecencyScoreFromTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 for empty timestamp', () => {
    const score = AccessTracker.calculateRecencyScoreFromTimestamp('');
    expect(score).toBe(0);
  });

  it('should return ~1.0 for current timestamp', () => {
    const now = new Date().toISOString();
    const score = AccessTracker.calculateRecencyScoreFromTimestamp(now);
    expect(score).toBeGreaterThan(0.99);
  });

  it('should return ~0.5 after one half-life', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const pastTime = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const score = AccessTracker.calculateRecencyScoreFromTimestamp(pastTime, 24);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('should use default half-life of 24 hours', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const pastTime = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const score = AccessTracker.calculateRecencyScoreFromTimestamp(pastTime);
    expect(score).toBeCloseTo(0.5, 1);
  });
});

// ==================== getFrequentlyAccessed Tests ====================

describe('AccessTracker.getFrequentlyAccessed', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage({
      entity_a: createAgentEntity('entity_a'),
      entity_b: createAgentEntity('entity_b'),
      entity_c: createAgentEntity('entity_c'),
    });
    tracker = new AccessTracker(storage);
  });

  it('should return empty array when no accesses recorded', async () => {
    const result = await tracker.getFrequentlyAccessed(10);
    expect(result).toEqual([]);
  });

  it('should return entities sorted by frequency descending', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');
    await tracker.recordAccess('entity_b');
    await tracker.recordAccess('entity_c');
    await tracker.recordAccess('entity_c');
    await tracker.recordAccess('entity_c');

    const result = await tracker.getFrequentlyAccessed(10);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('entity_c'); // 3 accesses
    expect(result[1].name).toBe('entity_b'); // 2 accesses
    expect(result[2].name).toBe('entity_a'); // 1 access
  });

  it('should respect limit parameter', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');
    await tracker.recordAccess('entity_c');

    const result = await tracker.getFrequentlyAccessed(2);
    expect(result).toHaveLength(2);
  });

  it('should filter by time window', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity_a');

    // Advance 2 hours
    vi.setSystemTime(now + 2 * 60 * 60 * 1000);
    await tracker.recordAccess('entity_b');

    // Get accesses in last hour only
    const result = await tracker.getFrequentlyAccessed(10, 1);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('entity_b');

    vi.useRealTimers();
  });

  it('should return empty array when entities not in storage', async () => {
    await tracker.recordAccess('non_existent_entity');

    const result = await tracker.getFrequentlyAccessed(10);
    expect(result).toEqual([]);
  });
});

// ==================== getRecentlyAccessed Tests ====================

describe('AccessTracker.getRecentlyAccessed', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage({
      entity_a: createAgentEntity('entity_a'),
      entity_b: createAgentEntity('entity_b'),
      entity_c: createAgentEntity('entity_c'),
    });
    tracker = new AccessTracker(storage);
  });

  it('should return empty array when no accesses recorded', async () => {
    const result = await tracker.getRecentlyAccessed(10);
    expect(result).toEqual([]);
  });

  it('should return entities sorted by recency descending', async () => {
    vi.useFakeTimers();
    const now = Date.now();

    vi.setSystemTime(now);
    await tracker.recordAccess('entity_a');

    vi.setSystemTime(now + 1000);
    await tracker.recordAccess('entity_b');

    vi.setSystemTime(now + 2000);
    await tracker.recordAccess('entity_c');

    const result = await tracker.getRecentlyAccessed(10);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('entity_c'); // Most recent
    expect(result[1].name).toBe('entity_b');
    expect(result[2].name).toBe('entity_a'); // Oldest

    vi.useRealTimers();
  });

  it('should respect limit parameter', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');
    await tracker.recordAccess('entity_c');

    const result = await tracker.getRecentlyAccessed(2);
    expect(result).toHaveLength(2);
  });

  it('should filter by time window', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    await tracker.recordAccess('entity_a');

    // Advance 2 hours
    vi.setSystemTime(now + 2 * 60 * 60 * 1000);
    await tracker.recordAccess('entity_b');

    // Get accesses in last hour only
    const result = await tracker.getRecentlyAccessed(10, 1);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('entity_b');

    vi.useRealTimers();
  });
});

// ==================== Utility Method Tests ====================

describe('AccessTracker Utility Methods', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage);
  });

  it('getTrackedEntities should return all tracked entity names', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');

    const tracked = tracker.getTrackedEntities();
    expect(tracked).toContain('entity_a');
    expect(tracked).toContain('entity_b');
    expect(tracked).toHaveLength(2);
  });

  it('isDirty should return false initially', () => {
    expect(tracker.isDirty()).toBe(false);
  });

  it('isDirty should return true after recording access', async () => {
    await tracker.recordAccess('entity');
    expect(tracker.isDirty()).toBe(true);
  });

  it('flush should clear dirty flag', async () => {
    await tracker.recordAccess('entity');
    expect(tracker.isDirty()).toBe(true);

    await tracker.flush();
    expect(tracker.isDirty()).toBe(false);
  });

  it('clearAccessRecords should remove records for entity', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');

    tracker.clearAccessRecords('entity_a');

    expect(tracker.getTrackedEntities()).not.toContain('entity_a');
    expect(tracker.getTrackedEntities()).toContain('entity_b');
  });

  it('clearAllAccessRecords should remove all records', async () => {
    await tracker.recordAccess('entity_a');
    await tracker.recordAccess('entity_b');

    tracker.clearAllAccessRecords();

    expect(tracker.getTrackedEntities()).toHaveLength(0);
  });
});

// ==================== Average Access Interval Tests ====================

describe('AccessTracker Average Access Interval', () => {
  let storage: IGraphStorage;
  let tracker: AccessTracker;

  beforeEach(() => {
    storage = createMockStorage();
    tracker = new AccessTracker(storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return Infinity for single access', async () => {
    await tracker.recordAccess('entity');

    const stats = await tracker.getAccessStats('entity');
    expect(stats.averageAccessInterval).toBe(Infinity);
  });

  it('should calculate average interval from access history', async () => {
    vi.useFakeTimers();
    const now = Date.now();

    vi.setSystemTime(now);
    await tracker.recordAccess('entity');

    vi.setSystemTime(now + 1000); // 1 second later
    await tracker.recordAccess('entity');

    vi.setSystemTime(now + 3000); // 2 seconds later (3 seconds total)
    await tracker.recordAccess('entity');

    const stats = await tracker.getAccessStats('entity');
    // Average: (1000 + 2000) / 2 = 1500ms
    expect(stats.averageAccessInterval).toBe(1500);
  });
});
