/**
 * Operation Progress Integration Tests
 *
 * Phase 9B: Integration tests verifying progress tracking and cancellation
 * work correctly across all enhanced managers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { IOManager } from '../../src/features/IOManager.js';
import { ArchiveManager } from '../../src/features/ArchiveManager.js';
import { TransactionManager } from '../../src/core/TransactionManager.js';
import { StreamingExporter } from '../../src/features/StreamingExporter.js';
import { OperationCancelledError } from '../../src/utils/errors.js';
import type { Entity } from '../../src/types/types.js';

describe('Operation Progress Integration', () => {
  let testDir: string;
  let storage: GraphStorage;

  beforeEach(async () => {
    testDir = join(tmpdir(), `memory-mcp-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('EntityManager.createEntities', () => {
    it('should report progress during entity creation', async () => {
      const entityManager = new EntityManager(storage);
      const progressUpdates: number[] = [];

      const entities: Entity[] = Array.from({ length: 10 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));

      await entityManager.createEntities(entities, {
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const entityManager = new EntityManager(storage);
      const controller = new AbortController();
      controller.abort();

      const entities: Entity[] = [
        { name: 'Test', entityType: 'test', observations: [] },
      ];

      await expect(
        entityManager.createEntities(entities, { signal: controller.signal })
      ).rejects.toThrow(OperationCancelledError);
    });
  });

  describe('CompressionManager.findDuplicates', () => {
    it('should report progress during duplicate finding', async () => {
      const compressionManager = new CompressionManager(storage);
      const progressUpdates: number[] = [];

      // Create some entities first
      await storage.saveGraph({
        entities: Array.from({ length: 20 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Observation ${i}`],
        })),
        relations: [],
      });

      await compressionManager.findDuplicates(0.9, {
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const compressionManager = new CompressionManager(storage);
      const controller = new AbortController();
      controller.abort();

      await expect(
        compressionManager.findDuplicates(0.9, { signal: controller.signal })
      ).rejects.toThrow(OperationCancelledError);
    });
  });

  describe('IOManager.importGraph', () => {
    it('should report progress during import', async () => {
      const ioManager = new IOManager(storage);
      const progressUpdates: number[] = [];

      const importData = JSON.stringify({
        entities: [
          { name: 'Imported1', entityType: 'test', observations: [] },
          { name: 'Imported2', entityType: 'test', observations: [] },
        ],
        relations: [],
      });

      await ioManager.importGraph('json', importData, 'skip', false, {
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const ioManager = new IOManager(storage);
      const controller = new AbortController();
      controller.abort();

      await expect(
        ioManager.importGraph('json', '{}', 'skip', false, { signal: controller.signal })
      ).rejects.toThrow(OperationCancelledError);
    });
  });

  describe('ArchiveManager.archiveEntities', () => {
    it('should report progress during archival', async () => {
      const archiveManager = new ArchiveManager(storage);
      const progressUpdates: number[] = [];

      // Create some entities first
      await storage.saveGraph({
        entities: Array.from({ length: 10 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
          importance: i,
          lastModified: '2020-01-01T00:00:00Z',
        })),
        relations: [],
      });

      await archiveManager.archiveEntities(
        { importanceLessThan: 5 },
        {
          saveToFile: false,
          onProgress: (p) => progressUpdates.push(p.percentage),
        }
      );

      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const archiveManager = new ArchiveManager(storage);
      const controller = new AbortController();
      controller.abort();

      await expect(
        archiveManager.archiveEntities({ importanceLessThan: 5 }, { signal: controller.signal })
      ).rejects.toThrow(OperationCancelledError);
    });
  });

  describe('TransactionManager.commit', () => {
    it('should report progress during commit', async () => {
      const txManager = new TransactionManager(storage);
      const progressUpdates: number[] = [];

      txManager.begin();
      txManager.createEntity({ name: 'TxEntity', entityType: 'test', observations: [] });

      const result = await txManager.commit({
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(result.success).toBe(true);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const txManager = new TransactionManager(storage);
      const controller = new AbortController();
      controller.abort();

      txManager.begin();
      txManager.createEntity({ name: 'TxEntity', entityType: 'test', observations: [] });

      // Cancellation should cause rollback
      const result = await txManager.commit({ signal: controller.signal });

      // Since we catch the error and rollback, result.success should be false
      expect(result.success).toBe(false);
    });
  });

  describe('StreamingExporter', () => {
    it('should report progress during JSONL export', async () => {
      // Create some entities first
      await storage.saveGraph({
        entities: Array.from({ length: 20 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
        })),
        relations: Array.from({ length: 10 }, (_, i) => ({
          from: `Entity${i}`,
          to: `Entity${i + 1}`,
          relationType: 'related',
        })),
      });

      const graph = await storage.loadGraph();
      const exporter = new StreamingExporter(join(testDir, 'export.jsonl'));
      const progressUpdates: number[] = [];

      await exporter.streamJSONL(graph, {
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should report progress during CSV export', async () => {
      // Create some entities first
      await storage.saveGraph({
        entities: Array.from({ length: 20 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
        })),
        relations: [],
      });

      const graph = await storage.loadGraph();
      const exporter = new StreamingExporter(join(testDir, 'export.csv'));
      const progressUpdates: number[] = [];

      await exporter.streamCSV(graph, {
        onProgress: (p) => progressUpdates.push(p.percentage),
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const graph = await storage.loadGraph();
      const exporter = new StreamingExporter(join(testDir, 'export.jsonl'));
      const controller = new AbortController();
      controller.abort();

      await expect(
        exporter.streamJSONL(graph, { signal: controller.signal })
      ).rejects.toThrow(OperationCancelledError);
    });
  });
});
