/**
 * Archive Operations Unit Tests
 *
 * Tests for entity archival based on age, importance, and tags.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArchiveManager } from '../../../src/features/ArchiveManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ArchiveManager', () => {
  let storage: GraphStorage;
  let archiveManager: ArchiveManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `archive-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    storage = new GraphStorage(testFilePath);
    archiveManager = new ArchiveManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('archiveEntities - Date Criteria', () => {
    it('should archive entities older than specified date', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-06-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('Old');
      expect(result.entityNames).not.toContain('New');
    });

    it('should not archive entities without lastModified when using olderThan', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'NoDate', entityType: 'test', observations: [] },
          { name: 'Old', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('Old');
      expect(result.entityNames).not.toContain('NoDate');
    });

    it('should archive all entities older than cutoff', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old1', entityType: 'test', observations: [], lastModified: '2019-01-01T00:00:00Z' },
          { name: 'Old2', entityType: 'test', observations: [], lastModified: '2020-06-01T00:00:00Z' },
          { name: 'Old3', entityType: 'test', observations: [], lastModified: '2022-12-31T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(3);
      expect(result.entityNames).toContain('Old1');
      expect(result.entityNames).toContain('Old2');
      expect(result.entityNames).toContain('Old3');
    });

    it('should not archive entities on exact cutoff date', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Exact', entityType: 'test', observations: [], lastModified: '2023-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(0);
    });
  });

  describe('archiveEntities - Importance Criteria', () => {
    it('should archive entities with importance below threshold', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Low', entityType: 'test', observations: [], importance: 2 },
          { name: 'High', entityType: 'test', observations: [], importance: 8 },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ importanceLessThan: 5 });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('Low');
      expect(result.entityNames).not.toContain('High');
    });

    it('should archive entities without importance when using importanceLessThan', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'NoImportance', entityType: 'test', observations: [] },
          { name: 'High', entityType: 'test', observations: [], importance: 8 },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ importanceLessThan: 5 });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('NoImportance');
    });

    it('should not archive entities at exactly the threshold', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'AtThreshold', entityType: 'test', observations: [], importance: 5 },
          { name: 'Below', entityType: 'test', observations: [], importance: 4 },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ importanceLessThan: 5 });

      expect(result.archived).toBe(1);
      expect(result.entityNames).not.toContain('AtThreshold');
      expect(result.entityNames).toContain('Below');
    });

    it('should archive entities with importance 0', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Zero', entityType: 'test', observations: [], importance: 0 },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ importanceLessThan: 1 });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('Zero');
    });
  });

  describe('archiveEntities - Tag Criteria', () => {
    it('should archive entities with matching tags', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Tagged', entityType: 'test', observations: [], tags: ['archive', 'old'] },
          { name: 'NotTagged', entityType: 'test', observations: [], tags: ['keep'] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ tags: ['archive'] });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('Tagged');
      expect(result.entityNames).not.toContain('NotTagged');
    });

    it('should be case-insensitive for tag matching', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Upper', entityType: 'test', observations: [], tags: ['ARCHIVE'] },
          { name: 'Lower', entityType: 'test', observations: [], tags: ['archive'] },
          { name: 'Mixed', entityType: 'test', observations: [], tags: ['Archive'] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ tags: ['archive'] });

      expect(result.archived).toBe(3);
    });

    it('should archive entity if any tag matches (OR logic)', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'HasFirst', entityType: 'test', observations: [], tags: ['deprecated'] },
          { name: 'HasSecond', entityType: 'test', observations: [], tags: ['obsolete'] },
          { name: 'HasNeither', entityType: 'test', observations: [], tags: ['active'] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ tags: ['deprecated', 'obsolete'] });

      expect(result.archived).toBe(2);
      expect(result.entityNames).toContain('HasFirst');
      expect(result.entityNames).toContain('HasSecond');
    });

    it('should not archive entities without tags when using tag criteria', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'NoTags', entityType: 'test', observations: [] },
          { name: 'EmptyTags', entityType: 'test', observations: [], tags: [] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ tags: ['archive'] });

      expect(result.archived).toBe(0);
    });
  });

  describe('archiveEntities - Multiple Criteria (OR)', () => {
    it('should archive entities matching ANY criteria', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'OldOnly', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z', importance: 8 },
          { name: 'LowImportanceOnly', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z', importance: 1 },
          { name: 'TaggedOnly', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z', importance: 8, tags: ['archive'] },
          { name: 'KeepMe', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z', importance: 8, tags: ['keep'] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({
        olderThan: '2023-01-01T00:00:00Z',
        importanceLessThan: 5,
        tags: ['archive'],
      });

      expect(result.archived).toBe(3);
      expect(result.entityNames).toContain('OldOnly');
      expect(result.entityNames).toContain('LowImportanceOnly');
      expect(result.entityNames).toContain('TaggedOnly');
      expect(result.entityNames).not.toContain('KeepMe');
    });

    it('should archive entity matching multiple criteria only once', async () => {
      await storage.saveGraph({
        entities: [
          {
            name: 'MatchesAll',
            entityType: 'test',
            observations: [],
            lastModified: '2020-01-01T00:00:00Z',
            importance: 1,
            tags: ['archive']
          },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({
        olderThan: '2023-01-01T00:00:00Z',
        importanceLessThan: 5,
        tags: ['archive'],
      });

      expect(result.archived).toBe(1);
      expect(result.entityNames).toHaveLength(1);
    });
  });

  describe('archiveEntities - Dry Run', () => {
    it('should preview without making changes', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'ToKeep', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' }, true);

      expect(result.archived).toBe(1);
      expect(result.entityNames).toContain('ToArchive');

      // Verify graph unchanged
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(2);
      expect(graph.entities.some(e => e.name === 'ToArchive')).toBe(true);
    });

    it('should return same results as actual archive', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old1', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'Old2', entityType: 'test', observations: [], lastModified: '2021-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const dryRunResult = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' }, true);
      const actualResult = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' }, false);

      expect(dryRunResult.archived).toBe(actualResult.archived);
      expect(dryRunResult.entityNames.sort()).toEqual(actualResult.entityNames.sort());
    });
  });

  describe('archiveEntities - Entity and Relation Removal', () => {
    it('should remove archived entities from graph', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'ToKeep', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('ToKeep');
    });

    it('should remove relations involving archived entities', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [
          { from: 'Old', to: 'New', relationType: 'knows' },
          { from: 'New', to: 'Old', relationType: 'knows' },
          { from: 'New', to: 'New', relationType: 'self' },
        ],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].relationType).toBe('self');
    });

    it('should remove relations where archived entity is source', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [
          { from: 'Old', to: 'New', relationType: 'knows' },
        ],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(0);
    });

    it('should remove relations where archived entity is target', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [
          { from: 'New', to: 'Old', relationType: 'knows' },
        ],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(0);
    });

    it('should remove relations between two archived entities', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old1', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'Old2', entityType: 'test', observations: [], lastModified: '2021-01-01T00:00:00Z' },
        ],
        relations: [
          { from: 'Old1', to: 'Old2', relationType: 'knows' },
        ],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(0);
      expect(graph.relations).toHaveLength(0);
    });
  });

  describe('archiveEntities - Edge Cases', () => {
    it('should handle empty graph', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(0);
      expect(result.entityNames).toEqual([]);
    });

    it('should handle no matching entities', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'New', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(0);
      expect(result.entityNames).toEqual([]);
    });

    it('should handle archiving all entities', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'E1', entityType: 'test', observations: [], importance: 1 },
          { name: 'E2', entityType: 'test', observations: [], importance: 2 },
        ],
        relations: [
          { from: 'E1', to: 'E2', relationType: 'knows' },
        ],
      });

      const result = await archiveManager.archiveEntities({ importanceLessThan: 10 });

      expect(result.archived).toBe(2);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(0);
      expect(graph.relations).toHaveLength(0);
    });

    it('should handle empty criteria (no archiving)', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'E1', entityType: 'test', observations: [] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({});

      expect(result.archived).toBe(0);
    });

    it('should handle empty tags array (no tag matching)', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Tagged', entityType: 'test', observations: [], tags: ['something'] },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ tags: [] });

      expect(result.archived).toBe(0);
    });

    it('should preserve entity order for remaining entities', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'C', entityType: 'test', observations: [], lastModified: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const graph = await storage.loadGraph();
      expect(graph.entities.map(e => e.name)).toEqual(['A', 'C']);
    });

    it('should handle invalid date format gracefully', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'BadDate', entityType: 'test', observations: [], lastModified: 'not-a-date' },
          { name: 'GoodDate', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      // Invalid date will create NaN comparison, so it won't match
      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      // GoodDate should still be archived
      expect(result.entityNames).toContain('GoodDate');
    });
  });

  describe('archiveEntities - Persistence', () => {
    it('should persist changes after archiving', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      // Create new storage instance to verify persistence
      const newStorage = new GraphStorage(testFilePath);
      const graph = await newStorage.loadGraph();
      expect(graph.entities).toHaveLength(0);
    });

    it('should not persist changes in dry run mode', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' }, true);

      // Create new storage instance to verify no persistence
      const newStorage = new GraphStorage(testFilePath);
      const graph = await newStorage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });
  });

  describe('archiveEntities - Compression (Phase 3 Sprint 5)', () => {
    it('should create compressed archive file by default', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive1', entityType: 'test', observations: ['Observation 1', 'Observation 2'], lastModified: '2020-01-01T00:00:00Z' },
          { name: 'ToArchive2', entityType: 'test', observations: ['Observation 3', 'Observation 4'], lastModified: '2020-06-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(2);
      expect(result.archivePath).toBeDefined();
      expect(result.archivePath).toMatch(/\.jsonl\.br$/);
      expect(result.originalSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeDefined();
    });

    it('should achieve compression on typical entities', async () => {
      // Create entities with substantial content for compression
      await storage.saveGraph({
        entities: Array.from({ length: 20 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [
            `This is a longer observation text for Entity${i} that should compress well due to repetitive patterns.`,
            `Another observation with similar structure and content that brotli can compress efficiently.`,
            `Third observation to add more content and ensure we have enough data for meaningful compression.`,
          ],
          lastModified: '2020-01-01T00:00:00Z',
          tags: ['test', 'archive', 'compression'],
          importance: i % 10,
        })),
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(20);
      expect(result.compressionRatio).toBeDefined();
      expect(result.compressionRatio!).toBeLessThan(1); // Compressed size < original
      expect(result.compressionRatio!).toBeLessThan(0.8); // At least 20% compression
    });

    it('should not create archive file when saveToFile is false', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities(
        { olderThan: '2023-01-01T00:00:00Z' },
        { saveToFile: false }
      );

      expect(result.archived).toBe(1);
      expect(result.archivePath).toBeUndefined();
      expect(result.originalSize).toBeUndefined();
      expect(result.compressedSize).toBeUndefined();
    });

    it('should handle options object correctly', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: ['Test observation'], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      // Test with new options object format
      const result = await archiveManager.archiveEntities(
        { olderThan: '2023-01-01T00:00:00Z' },
        { dryRun: false, saveToFile: true }
      );

      expect(result.archived).toBe(1);
      expect(result.archivePath).toBeDefined();
    });

    it('should support legacy boolean dryRun parameter', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      // Legacy boolean parameter should still work
      const dryRunResult = await archiveManager.archiveEntities(
        { olderThan: '2023-01-01T00:00:00Z' },
        true // Legacy boolean for dryRun
      );

      expect(dryRunResult.archived).toBe(1);
      expect(dryRunResult.archivePath).toBeUndefined(); // No file in dry run

      // Verify graph unchanged
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });

    it('should create archive directory if it does not exist', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: ['Test'], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      // Archive directory should not exist initially
      const archiveDir = archiveManager.getArchiveDir();

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      expect(result.archived).toBe(1);
      expect(result.archivePath).toContain(archiveDir);

      // Verify archive file exists
      const stats = await fs.stat(result.archivePath!);
      expect(stats.isFile()).toBe(true);
    });

    it('should create metadata file alongside archive', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: ['Test observation'], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const result = await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const metadataPath = `${result.archivePath}.meta.json`;
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);

      expect(metadata.entityCount).toBe(1);
      expect(metadata.entityNames).toContain('ToArchive');
      expect(metadata.compressed).toBe(true);
      expect(metadata.compressionFormat).toBe('brotli');
      expect(metadata.originalSize).toBeGreaterThan(0);
      expect(metadata.compressedSize).toBeGreaterThan(0);
    });
  });

  describe('listArchives', () => {
    it('should return empty array when no archives exist', async () => {
      const archives = await archiveManager.listArchives();
      expect(archives).toEqual([]);
    });

    it('should list archives after archiving', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'ToArchive', entityType: 'test', observations: ['Test'], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const archives = await archiveManager.listArchives();
      expect(archives).toHaveLength(1);
      expect(archives[0].compressed).toBe(true);
      expect(archives[0].entityCount).toBe(1);
    });

    it('should list multiple archives sorted by timestamp', async () => {
      // Create first archive
      await storage.saveGraph({
        entities: [
          { name: 'First', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });
      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create second archive
      await storage.saveGraph({
        entities: [
          { name: 'Second', entityType: 'test', observations: [], lastModified: '2020-01-01T00:00:00Z' },
        ],
        relations: [],
      });
      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const archives = await archiveManager.listArchives();
      expect(archives).toHaveLength(2);

      // Should be sorted newest first
      const timestamps = archives.map(a => new Date(a.timestamp).getTime());
      expect(timestamps[0]).toBeGreaterThan(timestamps[1]);
    });

    it('should include compression statistics in archive list', async () => {
      await storage.saveGraph({
        entities: Array.from({ length: 10 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: ['Some observation text that can be compressed efficiently.'],
          lastModified: '2020-01-01T00:00:00Z',
        })),
        relations: [],
      });

      await archiveManager.archiveEntities({ olderThan: '2023-01-01T00:00:00Z' });

      const archives = await archiveManager.listArchives();
      expect(archives).toHaveLength(1);

      const archive = archives[0];
      expect(archive.originalSize).toBeGreaterThan(0);
      expect(archive.compressedSize).toBeGreaterThan(0);
      expect(archive.compressionRatio).toBeDefined();
      expect(archive.compressionRatio).toBeLessThan(1);
    });
  });
});
