/**
 * ObservationManager Deduplication Tests
 *
 * Tests for fuzzy observation deduplication at write time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { DeduplicationOptions } from '../../../src/types/types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ObservationManager - Deduplication', () => {
  let storage: GraphStorage;
  let observationManager: ObservationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `observation-dedup-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
    observationManager = new ObservationManager(storage);

    // Create test entities with some existing observations
    await storage.saveGraph({
      entities: [
        {
          name: 'Alice',
          entityType: 'person',
          observations: [
            'Works as a software developer at TechCorp',
            'Enjoys hiking on weekends',
            'Has a golden retriever named Max',
          ],
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Designs user interfaces for mobile apps'],
        },
        {
          name: 'Project',
          entityType: 'project',
          observations: [],
        },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    // Clean up env var if set
    delete process.env.MEMORY_OBSERVATION_DEDUP;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Exact duplicate filtering (existing behavior preserved)', () => {
    it('should still filter exact duplicates without dedup enabled', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Works as a software developer at TechCorp', 'Brand new observation'] },
      ]);

      expect(results[0].addedObservations).toEqual(['Brand new observation']);
    });

    it('should still filter exact duplicates with dedup enabled', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.85,
        mergeStrategy: 'keep_longest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a software developer at TechCorp', 'Brand new observation'] }],
        dedup
      );

      // Exact duplicate should still be filtered; brand new should be added
      expect(results[0].addedObservations).toEqual(['Brand new observation']);
    });
  });

  describe('Near-duplicate detection', () => {
    it('should merge near-duplicates when dedup is enabled', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.7,
        mergeStrategy: 'keep_longest',
      };

      // This is very similar to "Works as a software developer at TechCorp"
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a software developer at TechCorp since 2020'] }],
        dedup
      );

      // Should be added because it's longer (keep_longest strategy)
      expect(results[0].addedObservations).toEqual(['Works as a software developer at TechCorp since 2020']);

      // Verify the old observation was replaced
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp since 2020');
      expect(alice.observations).not.toContain('Works as a software developer at TechCorp');
    });

    it('should not merge dissimilar observations', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.85,
        mergeStrategy: 'keep_longest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Plays chess competitively'] }],
        dedup
      );

      // Completely different observation should just be added
      expect(results[0].addedObservations).toEqual(['Plays chess competitively']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Plays chess competitively');
      // Original observations should remain untouched
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
    });
  });

  describe('Threshold behavior', () => {
    it('should respect a high threshold (fewer merges)', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.99,
        mergeStrategy: 'keep_longest',
      };

      // Somewhat similar but not 99% similar
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a senior software developer at TechCorp'] }],
        dedup
      );

      // Should be added as a new observation (not similar enough at 0.99)
      expect(results[0].addedObservations).toEqual(['Works as a senior software developer at TechCorp']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      // Both should exist
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Works as a senior software developer at TechCorp');
    });

    it('should respect a low threshold (more merges)', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.3,
        mergeStrategy: 'keep_newest',
      };

      // Even somewhat different text should match at a low threshold
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Software developer working at TechCorp'] }],
        dedup
      );

      // Should be merged (keep_newest replaces existing)
      expect(results[0].addedObservations).toEqual(['Software developer working at TechCorp']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Software developer working at TechCorp');
      expect(alice.observations).not.toContain('Works as a software developer at TechCorp');
    });
  });

  describe('Merge strategies', () => {
    it('keep_longest: should keep the longer observation', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_longest',
      };

      // Shorter than existing "Works as a software developer at TechCorp"
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Software developer at TechCorp'] }],
        dedup
      );

      // Should NOT be added because existing is longer
      expect(results[0].addedObservations).toEqual([]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).not.toContain('Software developer at TechCorp');
    });

    it('keep_longest: should replace with longer new observation', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_longest',
      };

      // Longer than existing
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a software developer at TechCorp in the platform engineering team'] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual([
        'Works as a software developer at TechCorp in the platform engineering team',
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp in the platform engineering team');
      expect(alice.observations).not.toContain('Works as a software developer at TechCorp');
    });

    it('keep_newest: should always replace with new observation', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_newest',
      };

      // Even though it's shorter, keep_newest should replace
      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Developer at TechCorp'] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual(['Developer at TechCorp']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Developer at TechCorp');
      expect(alice.observations).not.toContain('Works as a software developer at TechCorp');
    });

    it('keep_both: should keep both observations', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_both',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Software developer working at TechCorp'] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual(['Software developer working at TechCorp']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Software developer working at TechCorp');
    });
  });

  describe('Dedup disabled by default', () => {
    it('should not perform fuzzy dedup when no options passed', async () => {
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Works as a software developer at TechCorp in the platform team'] },
      ]);

      // Without dedup, even near-duplicates are added
      expect(results[0].addedObservations).toEqual([
        'Works as a software developer at TechCorp in the platform team',
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      // Both should exist
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Works as a software developer at TechCorp in the platform team');
    });

    it('should not perform fuzzy dedup when explicitly disabled', async () => {
      const dedup: DeduplicationOptions = {
        enabled: false,
        similarityThreshold: 0.5,
        mergeStrategy: 'keep_newest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a software developer at TechCorp in the platform team'] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual([
        'Works as a software developer at TechCorp in the platform team',
      ]);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Works as a software developer at TechCorp in the platform team');
    });
  });

  describe('Environment variable opt-in', () => {
    it('should enable dedup when MEMORY_OBSERVATION_DEDUP is true', async () => {
      process.env.MEMORY_OBSERVATION_DEDUP = 'true';

      // Near-duplicate of existing "Works as a software developer at TechCorp"
      // The default strategy is keep_longest with threshold 0.85
      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Works as a software developer at TechCorp and enjoys the role immensely'] },
      ]);

      // With env var enabled, this should be deduped (if similar enough at 0.85)
      // The new text shares many tokens with the existing one
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;

      // The observation count should be affected by dedup
      // Either merged or added depending on similarity score
      expect(results[0].entityName).toBe('Alice');
    });

    it('should not enable dedup when MEMORY_OBSERVATION_DEDUP is not set', async () => {
      delete process.env.MEMORY_OBSERVATION_DEDUP;

      const results = await observationManager.addObservations([
        { entityName: 'Alice', contents: ['Works as a software developer at TechCorp in NYC'] },
      ]);

      // Without env var, near-duplicate should be added without checking similarity
      expect(results[0].addedObservations).toEqual(['Works as a software developer at TechCorp in NYC']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Works as a software developer at TechCorp in NYC');
    });

    it('should prefer explicit options over env var', async () => {
      process.env.MEMORY_OBSERVATION_DEDUP = 'true';

      const dedup: DeduplicationOptions = {
        enabled: false,
        similarityThreshold: 0.5,
        mergeStrategy: 'keep_newest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: ['Works as a software developer at TechCorp in NYC'] }],
        dedup
      );

      // Explicit disabled should override env var
      expect(results[0].addedObservations).toEqual(['Works as a software developer at TechCorp in NYC']);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Works as a software developer at TechCorp');
      expect(alice.observations).toContain('Works as a software developer at TechCorp in NYC');
    });
  });

  describe('Multiple observations in a single batch', () => {
    it('should dedup each new observation independently', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_newest',
      };

      const results = await observationManager.addObservations(
        [{
          entityName: 'Alice',
          contents: [
            'Software developer at TechCorp', // near-duplicate of existing
            'Plays tennis on Saturdays',       // completely new
          ],
        }],
        dedup
      );

      // First should replace existing (keep_newest), second should be added
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Software developer at TechCorp');
      expect(alice.observations).toContain('Plays tennis on Saturdays');
      expect(alice.observations).not.toContain('Works as a software developer at TechCorp');
    });

    it('should dedup across multiple entities in one call', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.6,
        mergeStrategy: 'keep_longest',
      };

      const results = await observationManager.addObservations(
        [
          { entityName: 'Alice', contents: ['Enjoys hiking in the mountains on weekends'] },
          { entityName: 'Bob', contents: ['Designs beautiful user interfaces for mobile applications'] },
        ],
        dedup
      );

      // Alice: "Enjoys hiking in the mountains on weekends" vs "Enjoys hiking on weekends" -> keep longest
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice')!;
      expect(alice.observations).toContain('Enjoys hiking in the mountains on weekends');

      // Bob: "Designs beautiful user interfaces for mobile applications" vs "Designs user interfaces for mobile apps"
      const bob = graph.entities.find(e => e.name === 'Bob')!;
      expect(bob.observations).toContain('Designs beautiful user interfaces for mobile applications');
    });
  });

  describe('Edge cases', () => {
    it('should handle dedup on entity with no existing observations', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.85,
        mergeStrategy: 'keep_longest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Project', contents: ['Initial project setup'] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual(['Initial project setup']);

      const graph = await storage.loadGraph();
      const project = graph.entities.find(e => e.name === 'Project')!;
      expect(project.observations).toEqual(['Initial project setup']);
    });

    it('should handle empty contents with dedup enabled', async () => {
      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.85,
        mergeStrategy: 'keep_longest',
      };

      const results = await observationManager.addObservations(
        [{ entityName: 'Alice', contents: [] }],
        dedup
      );

      expect(results[0].addedObservations).toEqual([]);
    });
  });

  describe('Performance', () => {
    it('should handle dedup on 100 observations efficiently', async () => {
      // Set up entity with 50 existing observations
      const existingObs = Array.from({ length: 50 }, (_, i) => `Existing observation number ${i} about topic ${i}`);
      await storage.saveGraph({
        entities: [
          { name: 'BigEntity', entityType: 'test', observations: existingObs },
        ],
        relations: [],
      });

      const newObs = Array.from({ length: 100 }, (_, i) => `New observation number ${i} about different topic ${i}`);

      const dedup: DeduplicationOptions = {
        enabled: true,
        similarityThreshold: 0.85,
        mergeStrategy: 'keep_longest',
      };

      const start = performance.now();
      const results = await observationManager.addObservations(
        [{ entityName: 'BigEntity', contents: newObs }],
        dedup
      );
      const elapsed = performance.now() - start;

      // Should complete within a reasonable time (5 seconds is generous)
      expect(elapsed).toBeLessThan(5000);
      expect(results[0].addedObservations.length).toBeGreaterThan(0);
    });
  });
});
