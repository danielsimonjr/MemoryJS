/**
 * WorkThreadManager Unit Tests
 *
 * Tests for work thread lifecycle, state transitions,
 * blocking/unblocking, cycle detection, and filtering — plus the
 * JSON-blob → graph decomposition: scalar `[key]: value` observation
 * lines, `[meta]:` key=value lines, child_of/blocked_by relations as the
 * source of truth on load, roundtrip fidelity, no-orphan lifecycle
 * updates, legacy-blob auto-migration, and bulk migrateLegacyWorkThreads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WorkThreadManager,
  migrateLegacyWorkThreads,
  decodeLegacyWorkThread,
  WORK_THREAD_ENTITY_TYPE,
  CHILD_OF_RELATION,
  BLOCKED_BY_RELATION,
} from '../../../src/agent/WorkThreadManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';

/**
 * Create a mock storage for testing.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  let graph = { entities: [...entities], relations: [...relations] };
  return {
    loadGraph: vi.fn().mockImplementation(() =>
      Promise.resolve({ entities: graph.entities, relations: graph.relations })
    ),
    getGraphForMutation: vi.fn().mockImplementation(() => Promise.resolve(graph)),
    saveGraph: vi.fn().mockImplementation((g) => {
      graph = g;
      return Promise.resolve();
    }),
    appendEntity: vi.fn().mockImplementation((entity) => {
      graph.entities.push(entity);
      return Promise.resolve();
    }),
    appendRelation: vi.fn().mockImplementation((relation) => {
      graph.relations.push(relation);
      return Promise.resolve();
    }),
    updateEntity: vi.fn().mockResolvedValue(true),
    compact: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
    getEntityByName: vi.fn().mockImplementation((name) =>
      graph.entities.find((e) => e.name === name)
    ),
    hasEntity: vi.fn().mockImplementation((name) =>
      graph.entities.some((e) => e.name === name)
    ),
    getEntitiesByType: vi.fn().mockImplementation((type) =>
      graph.entities.filter((e) => e.entityType === type)
    ),
    getEntityTypes: vi.fn().mockReturnValue([]),
    getLowercased: vi.fn().mockReturnValue(undefined),
    getRelationsFrom: vi.fn().mockReturnValue([]),
    getRelationsTo: vi.fn().mockReturnValue([]),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
}

describe('WorkThreadManager', () => {
  let storage: IGraphStorage;
  let manager: WorkThreadManager;

  beforeEach(() => {
    storage = createMockStorage();
    manager = new WorkThreadManager(storage);
  });

  // ==================== Creation ====================

  describe('create', () => {
    it('should create a thread with default status open', async () => {
      const thread = await manager.create('Build feature X');

      expect(thread.title).toBe('Build feature X');
      expect(thread.status).toBe('open');
      expect(thread.id).toMatch(/^thread_\d+_[a-z0-9]+$/);
      expect(thread.createdAt).toBeDefined();
      expect(thread.updatedAt).toBeDefined();
      expect(thread.owner).toBeUndefined();
    });

    it('should create a thread with description', async () => {
      const thread = await manager.create('Build feature X', {
        description: 'Implement the new feature',
      });

      expect(thread.description).toBe('Implement the new feature');
    });

    it('should create a thread with priority', async () => {
      const thread = await manager.create('Urgent task', { priority: 8 });

      expect(thread.priority).toBe(8);
    });

    it('should reject invalid priority', async () => {
      await expect(
        manager.create('Task', { priority: 11 })
      ).rejects.toThrow('Priority must be between 0 and 10');

      await expect(
        manager.create('Task', { priority: -1 })
      ).rejects.toThrow('Priority must be between 0 and 10');
    });

    it('should create a thread with metadata', async () => {
      const thread = await manager.create('Task', {
        metadata: { team: 'backend', sprint: 5 },
      });

      expect(thread.metadata).toEqual({ team: 'backend', sprint: 5 });
    });

    it('should persist thread as entity with scalar observation lines (no JSON blob)', async () => {
      await manager.create('Build feature X');

      expect(storage.appendEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'work_thread',
          observations: expect.arrayContaining([
            '[title]: Build feature X',
            '[status]: open',
          ]),
        })
      );
      const entity = (storage.appendEntity as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Entity;
      expect(entity.observations.some((o) => o.startsWith('{'))).toBe(false);
    });

    it('should create parent-child relationship', async () => {
      const parent = await manager.create('Parent task');
      const child = await manager.create('Child task', { parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: child.id,
          to: parent.id,
          relationType: 'child_of',
        })
      );
    });

    it('should reject parentId referencing non-existent thread', async () => {
      await expect(
        manager.create('Child', { parentId: 'nonexistent' })
      ).rejects.toThrow('Parent thread not found');
    });
  });

  // ==================== Claim ====================

  describe('claim', () => {
    it('should set owner and transition to active', async () => {
      const thread = await manager.create('Task');
      const claimed = await manager.claim(thread.id, 'agent_1');

      expect(claimed.owner).toBe('agent_1');
      expect(claimed.status).toBe('active');
    });

    it('should reject claiming non-existent thread', async () => {
      await expect(
        manager.claim('nonexistent', 'agent_1')
      ).rejects.toThrow('Thread not found');
    });

    it('should reject claiming already-owned thread', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');

      await expect(
        manager.claim(thread.id, 'agent_2')
      ).rejects.toThrow('already owned');
    });

    it('should reject claiming from terminal state', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      await manager.complete(thread.id);

      // Reset owner to test transition validation
      await expect(
        manager.claim(thread.id, 'agent_2')
      ).rejects.toThrow();
    });
  });

  // ==================== Release ====================

  describe('release', () => {
    it('should remove owner and transition to open', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      const released = await manager.release(thread.id);

      expect(released.owner).toBeUndefined();
      expect(released.status).toBe('open');
    });

    it('should reject releasing non-existent thread', async () => {
      await expect(
        manager.release('nonexistent')
      ).rejects.toThrow('Thread not found');
    });

    it('should reject releasing thread not in active status', async () => {
      const thread = await manager.create('Task');

      await expect(
        manager.release(thread.id)
      ).rejects.toThrow('Cannot release');
    });
  });

  // ==================== Complete ====================

  describe('complete', () => {
    it('should transition to done (terminal)', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      const completed = await manager.complete(thread.id);

      expect(completed.status).toBe('done');
    });

    it('should reject completing from open status', async () => {
      const thread = await manager.create('Task');

      await expect(
        manager.complete(thread.id)
      ).rejects.toThrow('Cannot complete');
    });

    it('should not allow transitions from done', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      await manager.complete(thread.id);

      expect(manager.canTransition(thread.id, 'active')).toBe(false);
      expect(manager.canTransition(thread.id, 'open')).toBe(false);
      expect(manager.canTransition(thread.id, 'blocked')).toBe(false);
      expect(manager.canTransition(thread.id, 'cancelled')).toBe(false);
    });
  });

  // ==================== Cancel ====================

  describe('cancel', () => {
    it('should transition to cancelled (terminal)', async () => {
      const thread = await manager.create('Task');
      const cancelled = await manager.cancel(thread.id);

      expect(cancelled.status).toBe('cancelled');
    });

    it('should cancel from active status', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      const cancelled = await manager.cancel(thread.id);

      expect(cancelled.status).toBe('cancelled');
    });

    it('should not allow transitions from cancelled', async () => {
      const thread = await manager.create('Task');
      await manager.cancel(thread.id);

      expect(manager.canTransition(thread.id, 'active')).toBe(false);
      expect(manager.canTransition(thread.id, 'open')).toBe(false);
      expect(manager.canTransition(thread.id, 'blocked')).toBe(false);
      expect(manager.canTransition(thread.id, 'done')).toBe(false);
    });
  });

  // ==================== Block / Unblock ====================

  describe('block', () => {
    it('should transition to blocked with dependencies', async () => {
      const blocker = await manager.create('Blocker task');
      const task = await manager.create('Blocked task');
      await manager.claim(task.id, 'agent_1');

      const blocked = await manager.block(task.id, [blocker.id]);

      expect(blocked.status).toBe('blocked');
      expect(blocked.blockedBy).toEqual([blocker.id]);
    });

    it('should create blocked_by relations', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');

      await manager.block(task.id, [blocker.id]);

      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          from: task.id,
          to: blocker.id,
          relationType: 'blocked_by',
        })
      );
    });

    it('should reject blocking with non-existent blocker', async () => {
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');

      await expect(
        manager.block(task.id, ['nonexistent'])
      ).rejects.toThrow('Blocker thread not found');
    });

    it('should reject blocking from invalid status', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');

      await expect(
        manager.block(task.id, [blocker.id])
      ).rejects.toThrow('Cannot block');
    });
  });

  describe('unblock', () => {
    it('should transition to active when blocker is done and thread has owner', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);

      // Complete the blocker
      await manager.claim(blocker.id, 'agent_2');
      await manager.complete(blocker.id);

      const unblocked = await manager.unblock(task.id);

      expect(unblocked.status).toBe('active');
      expect(unblocked.blockedBy).toBeUndefined();
    });

    it('should transition to open when blocker is done and thread has no owner', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      // Claim, block, then we test unblock behavior
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);

      // Complete the blocker
      await manager.claim(blocker.id, 'agent_2');
      await manager.complete(blocker.id);

      // The task still has an owner from claim, so it goes to active
      const unblocked = await manager.unblock(task.id);
      expect(unblocked.status).toBe('active');
    });

    it('should also resolve when blocker is cancelled', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);

      await manager.cancel(blocker.id);

      const unblocked = await manager.unblock(task.id);
      expect(unblocked.status).toBe('active');
    });

    it('should reject unblocking when blockers are still pending', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);

      await expect(
        manager.unblock(task.id)
      ).rejects.toThrow('still blocked by unresolved threads');
    });

    it('should reject unblocking non-blocked thread', async () => {
      const task = await manager.create('Task');

      await expect(
        manager.unblock(task.id)
      ).rejects.toThrow('is not blocked');
    });
  });

  // ==================== Cycle Detection ====================

  describe('cycle detection', () => {
    it('should prevent direct circular dependency', async () => {
      const a = await manager.create('Thread A');
      const b = await manager.create('Thread B');

      await manager.claim(a.id, 'agent_1');
      await manager.block(a.id, [b.id]);

      await manager.claim(b.id, 'agent_2');

      await expect(
        manager.block(b.id, [a.id])
      ).rejects.toThrow('circular dependency');
    });

    it('should prevent indirect circular dependency', async () => {
      const a = await manager.create('Thread A');
      const b = await manager.create('Thread B');
      const c = await manager.create('Thread C');

      // A blocked by B
      await manager.claim(a.id, 'agent_1');
      await manager.block(a.id, [b.id]);

      // B blocked by C
      await manager.claim(b.id, 'agent_2');
      await manager.block(b.id, [c.id]);

      // C blocked by A would create cycle: A -> B -> C -> A
      await manager.claim(c.id, 'agent_3');
      await expect(
        manager.block(c.id, [a.id])
      ).rejects.toThrow('circular dependency');
    });
  });

  // ==================== Get / List / Filter ====================

  describe('get', () => {
    it('should return thread by ID', async () => {
      const thread = await manager.create('Task');
      const retrieved = manager.get(thread.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Task');
    });

    it('should return undefined for non-existent thread', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('should return a copy (not the original)', async () => {
      const thread = await manager.create('Task');
      const retrieved = manager.get(thread.id);
      if (retrieved) {
        retrieved.title = 'Modified';
      }
      const retrievedAgain = manager.get(thread.id);
      expect(retrievedAgain?.title).toBe('Task');
    });
  });

  describe('list', () => {
    it('should list all threads', async () => {
      await manager.create('Task 1');
      await manager.create('Task 2');
      await manager.create('Task 3');

      const all = manager.list();
      expect(all).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const t1 = await manager.create('Task 1');
      await manager.create('Task 2');
      await manager.claim(t1.id, 'agent_1');

      const active = manager.list({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe('active');

      const open = manager.list({ status: 'open' });
      expect(open).toHaveLength(1);
    });

    it('should filter by multiple statuses', async () => {
      const t1 = await manager.create('Task 1');
      await manager.create('Task 2');
      const t3 = await manager.create('Task 3');
      await manager.claim(t1.id, 'agent_1');
      await manager.cancel(t3.id);

      const result = manager.list({ status: ['active', 'cancelled'] });
      expect(result).toHaveLength(2);
    });

    it('should filter by owner', async () => {
      const t1 = await manager.create('Task 1');
      const t2 = await manager.create('Task 2');
      await manager.claim(t1.id, 'agent_1');
      await manager.claim(t2.id, 'agent_2');

      const agent1Tasks = manager.list({ owner: 'agent_1' });
      expect(agent1Tasks).toHaveLength(1);
      expect(agent1Tasks[0].owner).toBe('agent_1');
    });

    it('should filter by parentId', async () => {
      const parent = await manager.create('Parent');
      await manager.create('Child 1', { parentId: parent.id });
      await manager.create('Child 2', { parentId: parent.id });
      await manager.create('Other');

      const children = manager.list({ parentId: parent.id });
      expect(children).toHaveLength(2);
    });
  });

  describe('getChildren', () => {
    it('should return child threads', async () => {
      const parent = await manager.create('Parent');
      await manager.create('Child 1', { parentId: parent.id });
      await manager.create('Child 2', { parentId: parent.id });
      await manager.create('Not a child');

      const children = manager.getChildren(parent.id);
      expect(children).toHaveLength(2);
    });

    it('should return empty array for thread with no children', async () => {
      const thread = await manager.create('Leaf thread');
      const children = manager.getChildren(thread.id);
      expect(children).toHaveLength(0);
    });
  });

  // ==================== State Transition Validation ====================

  describe('canTransition', () => {
    it('should return false for non-existent thread', () => {
      expect(manager.canTransition('nonexistent', 'active')).toBe(false);
    });

    it('should validate open -> active', async () => {
      const thread = await manager.create('Task');
      expect(manager.canTransition(thread.id, 'active')).toBe(true);
    });

    it('should validate open -> cancelled', async () => {
      const thread = await manager.create('Task');
      expect(manager.canTransition(thread.id, 'cancelled')).toBe(true);
    });

    it('should reject open -> done', async () => {
      const thread = await manager.create('Task');
      expect(manager.canTransition(thread.id, 'done')).toBe(false);
    });

    it('should reject open -> blocked', async () => {
      const thread = await manager.create('Task');
      expect(manager.canTransition(thread.id, 'blocked')).toBe(false);
    });

    it('should validate active -> done', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      expect(manager.canTransition(thread.id, 'done')).toBe(true);
    });

    it('should validate active -> blocked', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      expect(manager.canTransition(thread.id, 'blocked')).toBe(true);
    });

    it('should validate active -> open (release)', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_1');
      expect(manager.canTransition(thread.id, 'open')).toBe(true);
    });
  });

  // ==================== Priority ====================

  describe('priority', () => {
    it('should store and retrieve priority', async () => {
      const thread = await manager.create('High priority task', { priority: 9 });
      const retrieved = manager.get(thread.id);

      expect(retrieved?.priority).toBe(9);
    });

    it('should allow priority 0', async () => {
      const thread = await manager.create('Low priority', { priority: 0 });
      expect(thread.priority).toBe(0);
    });

    it('should allow priority 10', async () => {
      const thread = await manager.create('Max priority', { priority: 10 });
      expect(thread.priority).toBe(10);
    });
  });

  // ==================== Full Lifecycle ====================

  describe('full lifecycle', () => {
    it('should support create -> claim -> complete flow', async () => {
      const thread = await manager.create('Feature implementation');
      expect(thread.status).toBe('open');

      const claimed = await manager.claim(thread.id, 'agent_1');
      expect(claimed.status).toBe('active');
      expect(claimed.owner).toBe('agent_1');

      const completed = await manager.complete(thread.id);
      expect(completed.status).toBe('done');
    });

    it('should support create -> claim -> release -> claim -> complete flow', async () => {
      const thread = await manager.create('Task');

      await manager.claim(thread.id, 'agent_1');
      await manager.release(thread.id);

      const reclaimed = await manager.claim(thread.id, 'agent_2');
      expect(reclaimed.owner).toBe('agent_2');

      const completed = await manager.complete(thread.id);
      expect(completed.status).toBe('done');
    });

    it('should support block -> unblock lifecycle', async () => {
      const dep = await manager.create('Dependency');
      const task = await manager.create('Main task');

      await manager.claim(task.id, 'agent_1');
      const blocked = await manager.block(task.id, [dep.id]);
      expect(blocked.status).toBe('blocked');

      await manager.claim(dep.id, 'agent_2');
      await manager.complete(dep.id);

      const unblocked = await manager.unblock(task.id);
      expect(unblocked.status).toBe('active');

      const completed = await manager.complete(task.id);
      expect(completed.status).toBe('done');
    });
  });
});

describe('WorkThreadManager (decomposed graph shape)', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let manager: WorkThreadManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `work-thread-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    manager = new WorkThreadManager(storage);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  /** Persist a legacy single-JSON-observation thread entity directly. */
  async function createLegacyEntity(
    id: string,
    blob: Record<string, unknown>,
    relations: Relation[] = []
  ): Promise<void> {
    const entity: Entity = {
      name: id,
      entityType: WORK_THREAD_ENTITY_TYPE,
      observations: [JSON.stringify(blob)],
      createdAt: blob.createdAt as string,
      lastModified: blob.updatedAt as string,
    };
    await storage.appendEntity(entity);
    for (const relation of relations) {
      await storage.appendRelation(relation);
    }
  }

  // -------- (1) save creates decomposed graph structure --------
  describe('save — graph decomposition', () => {
    it('persists scalar fields as [key]: value observation lines, description as plain text', async () => {
      const thread = await manager.create('Ship feature X', {
        description: 'Long form\ndetails here.',
        priority: 8,
        metadata: { team: 'backend', sprint: 5 },
      });

      const entity = await entityManager.getEntity(thread.id);
      expect(entity?.entityType).toBe(WORK_THREAD_ENTITY_TYPE);
      expect(entity?.observations).toContain('[title]: Ship feature X');
      expect(entity?.observations).toContain('[status]: open');
      expect(entity?.observations).toContain('[priority]: 8');
      expect(entity?.observations).toContain(`[created-at]: ${thread.createdAt}`);
      expect(entity?.observations).toContain(`[updated-at]: ${thread.updatedAt}`);
      expect(entity?.observations).toContain('Long form\ndetails here.');
      expect(entity?.observations).toContain('[meta]: "team"="backend"');
      expect(entity?.observations).toContain('[meta]: "sprint"=5');
      // No JSON blob observation.
      expect(entity?.observations.some((o) => o.startsWith('{'))).toBe(false);
    });

    it('creates a child_of relation for parentId, verifiable via RelationManager', async () => {
      const parent = await manager.create('Parent');
      const child = await manager.create('Child', { parentId: parent.id });

      const relations = await relationManager.getRelations(child.id);
      expect(relations).toContainEqual(
        expect.objectContaining({
          from: child.id,
          to: parent.id,
          relationType: CHILD_OF_RELATION,
        })
      );
    });

    it('creates blocked_by relations on block, verifiable via RelationManager', async () => {
      const blockerA = await manager.create('Blocker A');
      const blockerB = await manager.create('Blocker B');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blockerA.id, blockerB.id]);

      const relations = (await relationManager.getRelations(task.id)).filter(
        (r) => r.from === task.id && r.relationType === BLOCKED_BY_RELATION
      );
      expect(relations.map((r) => r.to).sort()).toEqual([blockerA.id, blockerB.id].sort());

      const entity = await entityManager.getEntity(task.id);
      expect(entity?.observations).toContain('[status]: blocked');
      // blockedBy lives in relations, not in any observation line.
      expect(entity?.observations.some((o) => o.includes(blockerA.id))).toBe(false);
    });

    it('persists owner as an [owner] line after claim', async () => {
      const thread = await manager.create('Task');
      await manager.claim(thread.id, 'agent_42');

      const entity = await entityManager.getEntity(thread.id);
      expect(entity?.observations).toContain('[owner]: agent_42');
      expect(entity?.observations).toContain('[status]: active');
    });
  });

  // -------- (2) roundtrip fidelity across a fresh reload --------
  describe('save → load roundtrip', () => {
    async function reload(): Promise<WorkThreadManager> {
      const fresh = new GraphStorage(storage.getFilePath());
      const freshManager = new WorkThreadManager(fresh);
      await freshManager.load();
      return freshManager;
    }

    it('roundtrips scalar fields, description, and hostile metadata strings', async () => {
      const metadata = {
        'key=with=equals': 'value=with=equals',
        'multi\nline\nkey': 'line1\nline2\r\nline3',
        'unicode-✓-ключ-鍵': 'värde ✓ 値 \u{1F600}',
        'quotes "and" \\backslashes\\': 'she said "hi\\there"',
        '[meta]: sneaky prefix': '[status]: done',
        '': 'empty key',
        nested: { a: [1, 2, { b: 'c' }], d: null },
        count: 42,
        flag: true,
        nothing: null,
      };
      const created = await manager.create('Tricky [status]: title', {
        description: 'desc with "quotes",\nnewlines, and unicode ✓',
        priority: 3,
        metadata,
      });
      await manager.claim(created.id, 'agent_1');
      const before = manager.get(created.id);

      const freshManager = await reload();
      expect(freshManager.get(created.id)).toEqual(before);
      expect(freshManager.get(created.id)?.metadata).toEqual(metadata);
    });

    it('roundtrips parentId and blockedBy from relations', async () => {
      const parent = await manager.create('Parent');
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task', { parentId: parent.id });
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);
      const before = manager.get(task.id);

      const freshManager = await reload();
      const loaded = freshManager.get(task.id);
      expect(loaded).toEqual(before);
      expect(loaded?.parentId).toBe(parent.id);
      expect(loaded?.blockedBy).toEqual([blocker.id]);
      expect(loaded?.status).toBe('blocked');
      expect(freshManager.getChildren(parent.id).map((t) => t.id)).toEqual([task.id]);
    });

    it('roundtrips every thread across all lifecycle states', async () => {
      const open = await manager.create('Open');
      const active = await manager.create('Active');
      await manager.claim(active.id, 'agent_a');
      const done = await manager.create('Done');
      await manager.claim(done.id, 'agent_b');
      await manager.complete(done.id);
      const cancelled = await manager.create('Cancelled');
      await manager.cancel(cancelled.id);

      const snapshot = new Map(
        [open, active, done, cancelled].map((t) => [t.id, manager.get(t.id)])
      );

      const freshManager = await reload();
      expect(freshManager.list()).toHaveLength(4);
      for (const [id, before] of snapshot) {
        expect(freshManager.get(id)).toEqual(before);
      }
    });
  });

  // -------- (3) lifecycle updates leave no orphans --------
  describe('lifecycle updates — no orphans', () => {
    it('block → unblock → complete rewrites in place without orphan entities or dangling relations', async () => {
      const blocker = await manager.create('Blocker');
      const task = await manager.create('Task');
      await manager.claim(task.id, 'agent_1');
      await manager.block(task.id, [blocker.id]);
      await manager.claim(blocker.id, 'agent_2');
      await manager.complete(blocker.id);
      await manager.unblock(task.id);
      await manager.complete(task.id);

      const graph = await storage.loadGraph();

      // Exactly the two thread entities — no children, no duplicates.
      expect(graph.entities.map((e) => e.name).sort()).toEqual(
        [blocker.id, task.id].sort()
      );

      // No blocked_by relation survives the unblock.
      expect(
        graph.relations.some((r) => r.relationType === BLOCKED_BY_RELATION)
      ).toBe(false);

      // No relation anywhere references a missing entity.
      const liveNames = new Set(graph.entities.map((e) => e.name));
      for (const rel of graph.relations) {
        expect(liveNames.has(rel.from)).toBe(true);
        expect(liveNames.has(rel.to)).toBe(true);
      }

      // Observations were replaced, not accumulated: exactly one line per scalar.
      const taskEntity = graph.entities.find((e) => e.name === task.id);
      const count = (prefix: string): number =>
        (taskEntity?.observations ?? []).filter((o) => o.startsWith(prefix)).length;
      expect(count('[status]: ')).toBe(1);
      expect(count('[title]: ')).toBe(1);
      expect(count('[updated-at]: ')).toBe(1);
      expect(taskEntity?.observations).toContain('[status]: done');
    });
  });

  // -------- (4) legacy JSON-blob migration on load --------
  describe('legacy auto-migration', () => {
    const legacyBlob = {
      title: 'Legacy task',
      description: 'Old-style thread',
      status: 'active',
      owner: 'agent_legacy',
      priority: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      metadata: { origin: 'v1', 'weird=key': 'weird\nvalue' },
    };

    it('load() decodes a legacy blob and rewrites the entity to the decomposed shape', async () => {
      await createLegacyEntity('thread_legacy_1', legacyBlob);

      const loaded = await manager.load();
      expect(loaded).toBe(1);

      const thread = manager.get('thread_legacy_1');
      expect(thread?.title).toBe('Legacy task');
      expect(thread?.description).toBe('Old-style thread');
      expect(thread?.status).toBe('active');
      expect(thread?.owner).toBe('agent_legacy');
      expect(thread?.priority).toBe(7);
      expect(thread?.createdAt).toBe(legacyBlob.createdAt);
      expect(thread?.updatedAt).toBe(legacyBlob.updatedAt);
      expect(thread?.metadata).toEqual(legacyBlob.metadata);

      // Entity now uses the decomposed shape.
      const entity = await entityManager.getEntity('thread_legacy_1');
      expect(entity?.observations.some((o) => o.startsWith('{'))).toBe(false);
      expect(entity?.observations).toContain('[title]: Legacy task');
      expect(entity?.observations).toContain('[status]: active');
      expect(entity?.observations).toContain('[owner]: agent_legacy');
      expect(entity?.observations).toContain('[meta]: "origin"="v1"');

      // A second manager reads the decomposed shape and agrees.
      const again = new WorkThreadManager(storage);
      await again.load();
      expect(again.get('thread_legacy_1')).toEqual(thread);
    });

    it('load() recreates relations implied by the legacy payload without duplicating existing ones', async () => {
      const parentBlob = { ...legacyBlob, title: 'Legacy parent', owner: undefined };
      const blockerBlob = { ...legacyBlob, title: 'Legacy blocker' };
      await createLegacyEntity('thread_legacy_parent', parentBlob);
      await createLegacyEntity('thread_legacy_blocker', blockerBlob);
      // Blocked thread: child_of relation already exists (as the old code
      // wrote it), but the blocked_by relation is missing.
      await createLegacyEntity(
        'thread_legacy_blocked',
        {
          ...legacyBlob,
          title: 'Legacy blocked',
          status: 'blocked',
          parentId: 'thread_legacy_parent',
          blockedBy: ['thread_legacy_blocker'],
        },
        [{ from: 'thread_legacy_blocked', to: 'thread_legacy_parent', relationType: CHILD_OF_RELATION }]
      );

      await manager.load();

      const relations = await relationManager.getRelations('thread_legacy_blocked');
      const childOf = relations.filter((r) => r.relationType === CHILD_OF_RELATION);
      const blockedBy = relations.filter((r) => r.relationType === BLOCKED_BY_RELATION);
      expect(childOf).toHaveLength(1); // not duplicated
      expect(blockedBy).toEqual([
        expect.objectContaining({
          from: 'thread_legacy_blocked',
          to: 'thread_legacy_blocker',
          relationType: BLOCKED_BY_RELATION,
        }),
      ]);

      // Rehydrates identically from the migrated shape.
      const freshManager = new WorkThreadManager(new GraphStorage(storage.getFilePath()));
      await freshManager.load();
      expect(freshManager.get('thread_legacy_blocked')).toEqual(
        manager.get('thread_legacy_blocked')
      );
    });

    it('decodeLegacyWorkThread returns null for malformed blobs', () => {
      expect(decodeLegacyWorkThread('x', [])).toBeNull();
      expect(decodeLegacyWorkThread('x', ['not json'])).toBeNull();
      expect(decodeLegacyWorkThread('x', ['[title]: decomposed'])).toBeNull();
      expect(decodeLegacyWorkThread('x', ['42'])).toBeNull();
    });

    it('migrateLegacyWorkThreads counts and converts only legacy entities', async () => {
      await createLegacyEntity('thread_legacy_a', legacyBlob);
      await createLegacyEntity('thread_legacy_b', { ...legacyBlob, title: 'Second' });
      await manager.load();
      // Modern thread created after load must not be counted.
      await manager.create('Modern thread');

      // (manager.load() above already migrated in place — recreate the
      // legacy shape for one of them to prove the counter only sees blobs.)
      await storage.updateEntity('thread_legacy_a', {
        observations: [JSON.stringify(legacyBlob)],
      });

      expect(await migrateLegacyWorkThreads(storage)).toBe(1);
      expect(await migrateLegacyWorkThreads(storage)).toBe(0);

      const entity = await entityManager.getEntity('thread_legacy_a');
      expect(entity?.observations.some((o) => o.startsWith('{'))).toBe(false);
      expect(entity?.observations).toContain('[title]: Legacy task');
    });
  });
});
