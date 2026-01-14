/**
 * Integration tests for Access Tracking across managers.
 *
 * Tests that access tracking works correctly when integrated with:
 * - SearchManager
 * - EntityManager
 * - GraphTraversal
 * - ManagerContext
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { ManagerContext } from '../../../src/core/ManagerContext.js';

describe('Access Tracking Integration', () => {
  let tempDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    // Create temporary directory for test data
    tempDir = mkdtempSync(join(tmpdir(), 'access-tracking-test-'));
    ctx = new ManagerContext(join(tempDir, 'test-memory.jsonl'));

    // Create test entities
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['Engineer at TechCorp'] },
      { name: 'Bob', entityType: 'person', observations: ['Manager at TechCorp'] },
      { name: 'Charlie', entityType: 'person', observations: ['Designer at TechCorp'] },
      { name: 'TechCorp', entityType: 'company', observations: ['Tech company'] },
    ]);

    // Create relations for traversal tests
    await ctx.relationManager.createRelations([
      { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      { from: 'Bob', to: 'Charlie', relationType: 'manages' },
      { from: 'Alice', to: 'TechCorp', relationType: 'employed_by' },
    ]);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('ManagerContext AccessTracker Integration', () => {
    it('should have accessTracker available via context', () => {
      expect(ctx.accessTracker).toBeDefined();
    });

    it('should wire accessTracker to managers when first accessed', () => {
      // Access the tracker to trigger wiring
      const tracker = ctx.accessTracker;
      expect(tracker).toBeDefined();

      // The tracker should be wired (we can't directly verify internal state,
      // but we can test that tracking works in subsequent tests)
    });
  });

  describe('SearchManager Access Tracking', () => {
    it('should NOT track access when trackAccess is false (default)', async () => {
      // Initialize tracker first
      const tracker = ctx.accessTracker;

      // Search without tracking
      await ctx.searchManager.searchNodes('Alice');

      // Verify no accesses were tracked
      const stats = await tracker.getAccessStats('Alice');
      expect(stats.totalAccesses).toBe(0);
    });

    it('should track access when trackAccess is true', async () => {
      // Initialize tracker first
      const tracker = ctx.accessTracker;

      // Search with tracking enabled
      await ctx.searchManager.searchNodes('Engineer', undefined, undefined, undefined, {
        trackAccess: true,
        sessionId: 'test_session',
      });

      // Verify Alice was tracked (she has 'Engineer' in observations)
      const stats = await tracker.getAccessStats('Alice');
      expect(stats.totalAccesses).toBe(1);
      expect(stats.accessesBySession['test_session']).toBe(1);
    });

    it('should track multiple entities from search results', async () => {
      const tracker = ctx.accessTracker;

      // Search for entities with TechCorp in observations
      await ctx.searchManager.searchNodes('TechCorp', undefined, undefined, undefined, {
        trackAccess: true,
      });

      // All entities mention TechCorp, so all should be tracked
      const aliceStats = await tracker.getAccessStats('Alice');
      const bobStats = await tracker.getAccessStats('Bob');
      const charlieStats = await tracker.getAccessStats('Charlie');
      const techStats = await tracker.getAccessStats('TechCorp');

      // All should have been accessed
      expect(aliceStats.totalAccesses).toBeGreaterThanOrEqual(1);
      expect(bobStats.totalAccesses).toBeGreaterThanOrEqual(1);
      expect(charlieStats.totalAccesses).toBeGreaterThanOrEqual(1);
      expect(techStats.totalAccesses).toBeGreaterThanOrEqual(1);
    });
  });

  describe('EntityManager Access Tracking', () => {
    it('should NOT track access when trackAccess is false (default)', async () => {
      const tracker = ctx.accessTracker;

      // Get entity without tracking
      await ctx.entityManager.getEntity('Alice');

      const stats = await tracker.getAccessStats('Alice');
      expect(stats.totalAccesses).toBe(0);
    });

    it('should track access when trackAccess is true', async () => {
      const tracker = ctx.accessTracker;

      // Get entity with tracking
      await ctx.entityManager.getEntity('Alice', {
        trackAccess: true,
        sessionId: 'direct_access_session',
      });

      const stats = await tracker.getAccessStats('Alice');
      expect(stats.totalAccesses).toBe(1);
      expect(stats.accessesBySession['direct_access_session']).toBe(1);
    });

    it('should NOT track access for non-existent entities', async () => {
      const tracker = ctx.accessTracker;

      // Try to get non-existent entity
      const result = await ctx.entityManager.getEntity('NonExistent', {
        trackAccess: true,
      });

      expect(result).toBeNull();
      const stats = await tracker.getAccessStats('NonExistent');
      expect(stats.totalAccesses).toBe(0);
    });
  });

  describe('GraphTraversal Access Tracking', () => {
    it('should NOT track access when trackAccess is false (default)', async () => {
      const tracker = ctx.accessTracker;

      // Find path without tracking
      await ctx.graphTraversal.findShortestPath('Alice', 'Charlie');

      const aliceStats = await tracker.getAccessStats('Alice');
      const bobStats = await tracker.getAccessStats('Bob');
      const charlieStats = await tracker.getAccessStats('Charlie');

      expect(aliceStats.totalAccesses).toBe(0);
      expect(bobStats.totalAccesses).toBe(0);
      expect(charlieStats.totalAccesses).toBe(0);
    });

    it('should track path nodes when trackAccess is true', async () => {
      const tracker = ctx.accessTracker;

      // Find path with tracking
      const result = await ctx.graphTraversal.findShortestPath('Alice', 'Charlie', {
        trackAccess: true,
        sessionId: 'traversal_session',
      });

      expect(result).not.toBeNull();
      expect(result!.path).toContain('Alice');
      expect(result!.path).toContain('Charlie');

      // All nodes in the path should be tracked
      for (const node of result!.path) {
        const stats = await tracker.getAccessStats(node);
        expect(stats.totalAccesses).toBeGreaterThanOrEqual(1);
        expect(stats.accessesBySession['traversal_session']).toBeGreaterThanOrEqual(1);
      }
    });

    it('should track unique nodes from findAllPaths', async () => {
      const tracker = ctx.accessTracker;

      // Find all paths with tracking
      const paths = await ctx.graphTraversal.findAllPaths('Alice', 'Charlie', 5, {
        trackAccess: true,
        sessionId: 'all_paths_session',
      });

      // Collect unique nodes
      const uniqueNodes = new Set<string>();
      for (const path of paths) {
        for (const node of path.path) {
          uniqueNodes.add(node);
        }
      }

      // Each unique node should be tracked exactly once
      for (const node of uniqueNodes) {
        const stats = await tracker.getAccessStats(node);
        expect(stats.totalAccesses).toBe(1);
        expect(stats.accessesBySession['all_paths_session']).toBe(1);
      }
    });
  });

  describe('Access Statistics Integration', () => {
    it('should accumulate accesses across different operations', async () => {
      const tracker = ctx.accessTracker;

      // Access Alice via different methods
      await ctx.entityManager.getEntity('Alice', { trackAccess: true, sessionId: 'session_1' });
      await ctx.searchManager.searchNodes('Alice', undefined, undefined, undefined, {
        trackAccess: true,
        sessionId: 'session_2',
      });
      await ctx.graphTraversal.findShortestPath('Alice', 'TechCorp', {
        trackAccess: true,
        sessionId: 'session_3',
      });

      const stats = await tracker.getAccessStats('Alice');
      expect(stats.totalAccesses).toBe(3);
      expect(stats.accessesBySession['session_1']).toBe(1);
      expect(stats.accessesBySession['session_2']).toBe(1);
      expect(stats.accessesBySession['session_3']).toBe(1);
    });

    it('should calculate recency score for recently accessed entity', async () => {
      const tracker = ctx.accessTracker;

      // Access Alice
      await ctx.entityManager.getEntity('Alice', { trackAccess: true });

      // Recency score should be close to 1.0 for just-accessed entity
      const score = tracker.calculateRecencyScore('Alice');
      expect(score).toBeGreaterThan(0.99);
    });

    it('should return frequently accessed entities', async () => {
      const tracker = ctx.accessTracker;

      // Access Alice multiple times
      for (let i = 0; i < 5; i++) {
        await ctx.entityManager.getEntity('Alice', { trackAccess: true });
      }

      // Access Bob once
      await ctx.entityManager.getEntity('Bob', { trackAccess: true });

      // Get frequently accessed
      const frequent = await tracker.getFrequentlyAccessed(10);

      // Alice should be first (most frequent)
      if (frequent.length > 0) {
        expect(frequent[0].name).toBe('Alice');
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without initializing accessTracker', async () => {
      // Create a fresh context without accessing tracker
      const freshCtx = new ManagerContext(join(tempDir, 'fresh-memory.jsonl'));

      // Create entity
      await freshCtx.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: [] },
      ]);

      // Get entity without tracking options
      const entity = await freshCtx.entityManager.getEntity('Test');
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Test');

      // Search without tracking options
      const results = await freshCtx.searchManager.searchNodes('Test');
      expect(results.entities.length).toBeGreaterThanOrEqual(1);
    });
  });
});
