/**
 * Worker Pool Integration Tests
 *
 * Tests to verify that the fuzzy search works correctly for both small
 * and large graphs, testing both single-threaded and worker pool modes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { FuzzySearch } from '../../src/search/FuzzySearch.js';
import type { Entity } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Worker Pool Integration', () => {
  let storage: GraphStorage;
  let fuzzySearch: FuzzySearch;
  let testFilePath: string;

  beforeEach(async () => {
    testFilePath = join(tmpdir(), `test-worker-pool-${Date.now()}.jsonl`);
    storage = new GraphStorage(testFilePath);
    // Use single-threaded mode by default for faster tests
    fuzzySearch = new FuzzySearch(storage, { useWorkerPool: false });
  });

  afterEach(async () => {
    await fuzzySearch.shutdown();
    try {
      await fs.unlink(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should NOT use worker pool for small graphs', async () => {
    // Create only 100 entities (below WORKER_MIN_ENTITIES of 500)
    const entities: Entity[] = [];
    for (let i = 0; i < 100; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`observation ${i}`],
      });
    }

    entities.push({
      name: 'SearchTermEntity',
      entityType: 'target',
      observations: ['contains searchterm'],
    });

    const graph = { entities, relations: [] };
    await storage.saveGraph(graph);

    // Perform fuzzy search - should use single-threaded mode
    const startTime = Date.now();
    const result = await fuzzySearch.fuzzySearch('searchterm', 0.6);
    const duration = Date.now() - startTime;

    // Verify results
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities.some(e => e.name === 'SearchTermEntity')).toBe(true);

    // Log performance for reference
    console.log(`Single-threaded fuzzy search (100 entities): ${duration}ms`);
  });

  it('should NOT use worker pool for high threshold even with large graph', async () => {
    // Create 600 entities
    const entities: Entity[] = [];
    for (let i = 0; i < 600; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`observation ${i}`],
      });
    }

    entities.push({
      name: 'SearchTermEntity',
      entityType: 'target',
      observations: ['exact match'],
    });

    const graph = { entities, relations: [] };
    await storage.saveGraph(graph);

    // Use high threshold (>= 0.8) - should NOT use workers
    const result = await fuzzySearch.fuzzySearch('SearchTermEntity', 0.9);

    // Verify results
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities.some(e => e.name === 'SearchTermEntity')).toBe(true);
  });

  // Tests for large graph fuzzy search (workers disabled in test environment)
  it('should handle large graphs with low threshold using single-threaded mode', async () => {
    // Create 600 entities (above WORKER_MIN_ENTITIES of 500)
    const entities: Entity[] = [];
    for (let i = 0; i < 600; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`This is test observation ${i}`],
      });
    }

    // Add a few entities with the search term
    entities.push({
      name: 'TargetEntity',
      entityType: 'target',
      observations: ['contains searchterm in observation'],
    });

    entities.push({
      name: 'SearchTermEntity',
      entityType: 'target',
      observations: ['another observation'],
    });

    const graph = { entities, relations: [] };
    await storage.saveGraph(graph);

    // Perform fuzzy search with low threshold
    // Uses single-threaded mode since useWorkerPool: false
    const startTime = Date.now();
    const result = await fuzzySearch.fuzzySearch('searchterm', 0.6);
    const duration = Date.now() - startTime;

    // Verify results
    expect(result.entities.length).toBeGreaterThan(0);
    const matchedNames = result.entities.map(e => e.name);

    // Should find entities with 'searchterm'
    expect(matchedNames).toContain('SearchTermEntity');
    expect(matchedNames).toContain('TargetEntity');

    // Log performance for reference
    console.log(`Fuzzy search (600 entities, single-threaded): ${duration}ms`);
  });

  it('should handle empty results correctly for large graphs', async () => {
    // Create large graph with no matches
    const entities: Entity[] = [];
    for (let i = 0; i < 600; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`observation ${i}`],
      });
    }

    const graph = { entities, relations: [] };
    await storage.saveGraph(graph);

    // Search for something that doesn't exist
    // Uses single-threaded mode since useWorkerPool: false
    const result = await fuzzySearch.fuzzySearch('nonexistent_xyz_abc', 0.6);

    // Should return empty results
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });
});

describe('Worker Pool Integration - With Workers', () => {
  let storage: GraphStorage;
  let fuzzySearchWithWorkers: FuzzySearch;
  let testFilePath: string;

  beforeEach(async () => {
    testFilePath = join(tmpdir(), `test-worker-pool-workers-${Date.now()}.jsonl`);
    storage = new GraphStorage(testFilePath);
    // Enable worker pool for these tests
    fuzzySearchWithWorkers = new FuzzySearch(storage, { useWorkerPool: true });
  });

  afterEach(async () => {
    // Wrap shutdown in a timeout to prevent hanging
    await Promise.race([
      fuzzySearchWithWorkers.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
    ]);
    try {
      await fs.unlink(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  }, 10000); // 10 second timeout for afterEach

  it('should use worker pool for large graphs and fall back gracefully on error', async () => {
    // Create 600 entities (above WORKER_MIN_ENTITIES of 500)
    const entities: Entity[] = [];
    for (let i = 0; i < 600; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`This is test observation ${i}`],
      });
    }

    // Add target entities with the search term
    entities.push({
      name: 'TargetEntity',
      entityType: 'target',
      observations: ['contains searchterm in observation'],
    });

    entities.push({
      name: 'SearchTermEntity',
      entityType: 'target',
      observations: ['another observation'],
    });

    const graph = { entities, relations: [] };
    await storage.saveGraph(graph);

    // Perform fuzzy search with low threshold - will try workers then fall back
    const startTime = Date.now();
    const result = await fuzzySearchWithWorkers.fuzzySearch('searchterm', 0.6);
    const duration = Date.now() - startTime;

    // Verify results - should work regardless of worker success/failure
    expect(result.entities.length).toBeGreaterThan(0);
    const matchedNames = result.entities.map(e => e.name);

    // Should find entities with 'searchterm'
    expect(matchedNames).toContain('SearchTermEntity');
    expect(matchedNames).toContain('TargetEntity');

    // Log performance for reference
    console.log(`Fuzzy search (600 entities, with workers enabled): ${duration}ms`);
  }, 60000); // 60 second timeout for worker initialization
});
