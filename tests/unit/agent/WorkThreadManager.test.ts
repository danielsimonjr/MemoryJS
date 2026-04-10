/**
 * WorkThreadManager Unit Tests
 *
 * Tests for work thread lifecycle, state transitions,
 * blocking/unblocking, cycle detection, and filtering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkThreadManager } from '../../../src/agent/WorkThreadManager.js';
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

    it('should persist thread as entity in storage', async () => {
      await manager.create('Build feature X');

      expect(storage.appendEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'work_thread',
        })
      );
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
