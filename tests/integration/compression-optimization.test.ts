/**
 * Integration tests for compression optimization - reduced graph reloads.
 * Verifies that compressGraph loads graph minimally and saves only once.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Compression Optimization - Reduced Graph Reloads', () => {
  let testDir: string;
  let storage: GraphStorage;
  let compressionManager: CompressionManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `compress-opt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    const storagePath = join(testDir, 'test.jsonl');
    storage = new GraphStorage(storagePath);
    compressionManager = new CompressionManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should only load graph minimal times for multiple merge groups', async () => {
    // Create entities with duplicates in multiple groups
    // Using very similar names and observations to ensure high similarity
    const entities = [
      { name: 'Entity1', entityType: 'test', observations: ['observation one', 'common'] },
      { name: 'entity1', entityType: 'test', observations: ['observation one', 'common', 'extra'] },
      { name: 'Entity2', entityType: 'test', observations: ['observation two', 'common'] },
      { name: 'entity2', entityType: 'test', observations: ['observation two', 'common', 'extra2'] },
      { name: 'Entity3', entityType: 'test', observations: ['observation three', 'common'] },
      { name: 'entity3', entityType: 'test', observations: ['observation three', 'common', 'extra3'] },
    ];

    await storage.saveGraph({ entities, relations: [] });

    // Spy on loadGraph, getGraphForMutation, and saveGraph to count calls
    const loadSpy = vi.spyOn(storage, 'loadGraph');
    const getMutationSpy = vi.spyOn(storage, 'getGraphForMutation');
    const saveSpy = vi.spyOn(storage, 'saveGraph');

    // Compress with high threshold to force merges
    await compressionManager.compressGraph(0.8, false);

    // findDuplicates calls loadGraph once
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // compressGraph calls getGraphForMutation once
    expect(getMutationSpy).toHaveBeenCalledTimes(1);

    // Should only save once at the end
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('should correctly merge all groups in single transaction', async () => {
    // Create entities with very similar names and observations to ensure merging
    const entities = [
      { name: 'Alpha', entityType: 'person', observations: ['works at company', 'loves coding'] },
      { name: 'alpha', entityType: 'person', observations: ['works at company', 'loves coding', 'senior dev'] },
      { name: 'Beta', entityType: 'person', observations: ['manager role', 'leads team'] },
      { name: 'beta', entityType: 'person', observations: ['manager role', 'leads team', 'experienced'] },
    ];

    await storage.saveGraph({ entities, relations: [] });

    const result = await compressionManager.compressGraph(0.8, false);

    expect(result.entitiesMerged).toBeGreaterThan(0);

    const finalGraph = await storage.loadGraph();
    expect(finalGraph.entities.length).toBe(2);

    // The kept entities should be the first ones (Alpha and Beta)
    const alphaEntity = finalGraph.entities.find(e => e.name === 'Alpha');
    const betaEntity = finalGraph.entities.find(e => e.name === 'Beta');

    expect(alphaEntity).toBeDefined();
    expect(betaEntity).toBeDefined();

    // The duplicates should be removed
    expect(finalGraph.entities.find(e => e.name === 'alpha')).toBeUndefined();
    expect(finalGraph.entities.find(e => e.name === 'beta')).toBeUndefined();
  });

  it('should handle multiple merge groups efficiently', async () => {
    // Create 6 entities forming 3 duplicate pairs with very similar names
    const entities = [
      { name: 'Project1', entityType: 'project', observations: ['web development', 'uses React'] },
      { name: 'project1', entityType: 'project', observations: ['web development', 'uses React', 'frontend'] },
      { name: 'User1', entityType: 'user', observations: ['admin access', 'team lead'] },
      { name: 'user1', entityType: 'user', observations: ['admin access', 'team lead', 'senior'] },
      { name: 'Task1', entityType: 'task', observations: ['high priority', 'urgent'] },
      { name: 'task1', entityType: 'task', observations: ['high priority', 'urgent', 'critical'] },
    ];

    await storage.saveGraph({ entities, relations: [] });

    // Spy on storage methods
    const loadSpy = vi.spyOn(storage, 'loadGraph');
    const getMutationSpy = vi.spyOn(storage, 'getGraphForMutation');
    const saveSpy = vi.spyOn(storage, 'saveGraph');

    const result = await compressionManager.compressGraph(0.8, false);

    // findDuplicates calls loadGraph once
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // compressGraph calls getGraphForMutation once
    expect(getMutationSpy).toHaveBeenCalledTimes(1);

    // Verify optimization: only 1 save at the end
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // Verify merge results
    expect(result.entitiesMerged).toBeGreaterThan(0);
    expect(result.mergedEntities.length).toBeGreaterThan(0);

    // Verify final state
    const finalGraph = await storage.loadGraph();
    expect(finalGraph.entities.length).toBe(3);
  });
});
