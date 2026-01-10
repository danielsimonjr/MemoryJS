/**
 * ObservationManager Unit Tests
 *
 * Tests for observation CRUD operations for entities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityNotFoundError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ObservationManager', () => {
  let storage: GraphStorage;
  let observationManager: ObservationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `observation-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
    observationManager = new ObservationManager(storage);

    // Create test entities
    await storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['Developer', 'Team lead'] },
        { name: 'Bob', entityType: 'person', observations: ['Designer'] },
        { name: 'Project', entityType: 'project', observations: [] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('addObservations', () => {
    it('should add observations to a single entity', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['New observation 1', 'New observation 2'] },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].entityName).toBe('Alice');
      expect(results[0].addedObservations).toEqual(['New observation 1', 'New observation 2']);

      // Verify in storage
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toContain('New observation 1');
      expect(alice!.observations).toContain('New observation 2');
    });

    it('should add observations to multiple entities atomically', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Alice obs'] },
        { entityName: 'Bob', contents: ['Bob obs 1', 'Bob obs 2'] },
        { entityName: 'Project', contents: ['Project obs'] },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].addedObservations).toEqual(['Alice obs']);
      expect(results[1].addedObservations).toEqual(['Bob obs 1', 'Bob obs 2']);
      expect(results[2].addedObservations).toEqual(['Project obs']);
    });

    it('should filter out duplicate observations', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Developer', 'New one', 'Team lead'] },
      ]);

      expect(results[0].addedObservations).toEqual(['New one']);
    });

    it('should return empty array when all observations are duplicates', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Developer', 'Team lead'] },
      ]);

      expect(results[0].addedObservations).toEqual([]);
    });

    it('should update lastModified when observations are added', async () => {
      const graphBefore = await storage.loadGraph();
      const aliceBefore = graphBefore.entities.find(e => e.name === 'Alice');
      const modifiedBefore = aliceBefore!.lastModified;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Brand new observation'] },
      ]);

      const graphAfter = await storage.loadGraph();
      const aliceAfter = graphAfter.entities.find(e => e.name === 'Alice');

      expect(aliceAfter!.lastModified).toBeDefined();
      if (modifiedBefore) {
        expect(aliceAfter!.lastModified! > modifiedBefore).toBe(true);
      }
    });

    it('should not update lastModified when no observations are added', async () => {
      // First, set a known lastModified
      const graph = await storage.getGraphForMutation();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      alice.lastModified = '2024-01-01T00:00:00.000Z';
      await storage.saveGraph(graph);

      // Try to add duplicate observation
      await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Developer'] },
      ]);

      const graphAfter = await storage.loadGraph();
      const aliceAfter = graphAfter.entities.find(e => e.name === 'Alice');
      expect(aliceAfter!.lastModified).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        observationManager.addObservations([
          { entityName: 'NonExistent', contents: ['Some observation'] },
        ])
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw EntityNotFoundError on first non-existent entity in batch', async () => {
      await expect(
        observationManager.addObservations([
          { entityName: 'Alice', contents: ['Valid'] },
          { entityName: 'NonExistent', contents: ['Invalid'] },
        ])
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should handle empty observations array', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: [] },
      ]);

      expect(results[0].addedObservations).toEqual([]);
    });

    it('should handle empty batch', async () => {
      const results = await observationManager.addObservations([]);
      expect(results).toEqual([]);
    });
  });

  describe('deleteObservations', () => {
    it('should delete observations from a single entity', async () => {
      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Developer'] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).not.toContain('Developer');
      expect(alice!.observations).toContain('Team lead');
    });

    it('should delete observations from multiple entities atomically', async () => {
      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Developer'] },
        { entityName: 'Bob', observations: ['Designer'] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      const bob = graph.entities.find(e => e.name === 'Bob');

      expect(alice!.observations).not.toContain('Developer');
      expect(bob!.observations).not.toContain('Designer');
    });

    it('should delete multiple observations from single entity', async () => {
      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Developer', 'Team lead'] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toEqual([]);
    });

    it('should silently ignore non-existent entities', async () => {
      // Should not throw
      await observationManager.deleteObservations([
        { entityName: 'NonExistent', observations: ['Some observation'] },
      ]);
    });

    it('should silently ignore non-existent observations', async () => {
      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Non-existent observation'] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toEqual(['Developer', 'Team lead']);
    });

    it('should update lastModified when observations are deleted', async () => {
      // Set a known lastModified
      const graph = await storage.getGraphForMutation();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      alice.lastModified = '2024-01-01T00:00:00.000Z';
      await storage.saveGraph(graph);

      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Developer'] },
      ]);

      const graphAfter = await storage.loadGraph();
      const aliceAfter = graphAfter.entities.find(e => e.name === 'Alice');
      expect(aliceAfter!.lastModified).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should not update lastModified when no observations are deleted', async () => {
      // Set a known lastModified
      const graph = await storage.getGraphForMutation();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      alice.lastModified = '2024-01-01T00:00:00.000Z';
      await storage.saveGraph(graph);

      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: ['Non-existent'] },
      ]);

      const graphAfter = await storage.loadGraph();
      const aliceAfter = graphAfter.entities.find(e => e.name === 'Alice');
      expect(aliceAfter!.lastModified).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should handle empty batch', async () => {
      // Should not throw or change anything
      await observationManager.deleteObservations([]);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(3);
    });

    it('should handle empty observations array', async () => {
      await observationManager.deleteObservations([
        { entityName: 'Alice', observations: [] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toEqual(['Developer', 'Team lead']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle observations with special characters', async () => {
      const specialObs = 'Contains "quotes", <tags>, and & symbols';

      await observationManager.addObservations([
        { entityName: 'Alice', contents: [specialObs] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toContain(specialObs);
    });

    it('should handle observations with unicode', async () => {
      const unicodeObs = 'Contains unicode: 日本語, emoji: 🎉, Arabic: مرحبا';

      await observationManager.addObservations([
        { entityName: 'Alice', contents: [unicodeObs] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toContain(unicodeObs);
    });

    it('should handle very long observations', async () => {
      const longObs = 'x'.repeat(10000);

      await observationManager.addObservations([
        { entityName: 'Alice', contents: [longObs] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toContain(longObs);
    });

    it('should handle many observations in a single batch', async () => {
      const manyObs = Array.from({ length: 100 }, (_, i) => `Observation ${i}`);

      await observationManager.addObservations([
        { entityName: 'Alice', contents: manyObs },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations.length).toBe(102); // 2 original + 100 new
    });

    it('should handle observations with newlines', async () => {
      const multilineObs = 'Line 1\nLine 2\nLine 3';

      await observationManager.addObservations([
        { entityName: 'Alice', contents: [multilineObs] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice!.observations).toContain(multilineObs);
    });

    it('should handle empty string observations', async () => {
      await observationManager.addObservations([
        { entityName: 'Alice', contents: ['', 'Valid observation', ''] },
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      // Empty strings should be added (no filtering at this level)
      expect(alice!.observations).toContain('');
      expect(alice!.observations).toContain('Valid observation');
    });

    it('should maintain observation order', async () => {
      await observationManager.addObservations([
        { entityName: 'Project', contents: ['First', 'Second', 'Third'] },
      ]);

      const graph = await storage.loadGraph();
      const project = graph.entities.find(e => e.name === 'Project');
      expect(project!.observations).toEqual(['First', 'Second', 'Third']);
    });
  });

  describe('Atomic Operations', () => {
    it('should add observations to all entities or none (atomic success)', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Alice new'] },
        { entityName: 'Bob', contents: ['Bob new'] },
        { entityName: 'Project', contents: ['Project new'] },
      ]);

      expect(results).toHaveLength(3);

      const graph = await storage.loadGraph();
      expect(graph.entities.find(e => e.name === 'Alice')!.observations).toContain('Alice new');
      expect(graph.entities.find(e => e.name === 'Bob')!.observations).toContain('Bob new');
      expect(graph.entities.find(e => e.name === 'Project')!.observations).toContain('Project new');
    });

    it('should not partially add when one entity fails', async () => {
      try {
        await observationManager.addObservations([
          { entityName: 'Alice', contents: ['Should not be added'] },
          { entityName: 'NonExistent', contents: ['Will fail'] },
          { entityName: 'Bob', contents: ['Should not be added'] },
        ]);
      } catch {
        // Expected to throw
      }

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      // Note: Due to the order of processing, Alice might have been processed before the error
      // The atomic guarantee is that the save happens after all processing
      // So if any entity fails, no save occurs
      expect(alice!.observations).not.toContain('Should not be added');
    });
  });
});
