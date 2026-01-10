/**
 * Backup Compression Integration Tests
 *
 * Tests for Phase 3 Sprint 2: Backup compression functionality.
 * Verifies that backups are compressed correctly, can be restored,
 * and maintain data integrity through the compress/decompress cycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IOManager } from '../../src/features/IOManager.js';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { KnowledgeGraph } from '../../src/types/index.js';

describe('Backup Compression Integration', () => {
  let storage: GraphStorage;
  let manager: IOManager;
  let testDir: string;
  let testFilePath: string;

  // Sample graph for testing
  const sampleGraph: KnowledgeGraph = {
    entities: [
      {
        name: 'Alice',
        entityType: 'person',
        observations: [
          'Works at TechCorp',
          'Senior software engineer',
          'Loves TypeScript and Node.js',
          'Has been with the company for 5 years',
        ],
        tags: ['employee', 'developer', 'senior'],
        importance: 8,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-15T00:00:00.000Z',
      },
      {
        name: 'Bob',
        entityType: 'person',
        observations: [
          'Junior developer',
          'Learning from Alice',
          'Interested in machine learning',
        ],
        tags: ['employee', 'developer', 'junior'],
        importance: 6,
        createdAt: '2024-02-01T00:00:00.000Z',
        lastModified: '2024-02-01T00:00:00.000Z',
      },
      {
        name: 'TechCorp',
        entityType: 'company',
        observations: [
          'Technology startup',
          'Founded in 2020',
          'Specializes in AI solutions',
          'Has 50 employees',
        ],
        tags: ['company', 'tech', 'startup'],
        importance: 9,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      },
    ],
    relations: [
      {
        from: 'Alice',
        to: 'TechCorp',
        relationType: 'works_at',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        from: 'Bob',
        to: 'TechCorp',
        relationType: 'works_at',
        createdAt: '2024-02-01T00:00:00.000Z',
      },
      {
        from: 'Alice',
        to: 'Bob',
        relationType: 'mentors',
        createdAt: '2024-02-01T00:00:00.000Z',
      },
    ],
  };

  beforeEach(async () => {
    testDir = join(tmpdir(), `backup-compression-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    storage = new GraphStorage(testFilePath);
    manager = new IOManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Compressed Backup Creation', () => {
    it('should create compressed backup by default', async () => {
      await storage.saveGraph(sampleGraph);

      const result = await manager.createBackup({ description: 'Test backup' });

      expect(result.compressed).toBe(true);
      expect(result.path).toContain('.jsonl.br');
      expect(result.entityCount).toBe(3);
      expect(result.relationCount).toBe(3);
      expect(result.compressionRatio).toBeLessThan(1);
      expect(result.compressedSize).toBeLessThan(result.originalSize);

      // Verify file exists
      const exists = await fs.access(result.path).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create uncompressed backup when compress is false', async () => {
      await storage.saveGraph(sampleGraph);

      const result = await manager.createBackup({ compress: false, description: 'Uncompressed backup' });

      expect(result.compressed).toBe(false);
      expect(result.path).toContain('.jsonl');
      expect(result.path).not.toContain('.jsonl.br');
      expect(result.compressionRatio).toBe(1);
      expect(result.compressedSize).toBe(result.originalSize);
    });

    it('should create metadata file with compression info', async () => {
      await storage.saveGraph(sampleGraph);

      const result = await manager.createBackup({ description: 'Metadata test' });
      const metadataPath = `${result.path}.meta.json`;

      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);

      expect(metadata.compressed).toBe(true);
      expect(metadata.compressionFormat).toBe('brotli');
      expect(metadata.originalSize).toBe(result.originalSize);
      expect(metadata.compressionRatio).toBe(result.compressionRatio);
      expect(metadata.entityCount).toBe(3);
      expect(metadata.relationCount).toBe(3);
    });

    it('should achieve at least 50% compression on typical graph', async () => {
      // Create a larger graph for better compression ratio measurement
      const largeGraph: KnowledgeGraph = {
        entities: [],
        relations: [],
      };

      for (let i = 0; i < 100; i++) {
        largeGraph.entities.push({
          name: `Entity_${i}`,
          entityType: 'test',
          observations: [
            `This is observation ${i} with some detailed text content`,
            `Another observation for entity ${i} with more information`,
            `Third observation containing various keywords and data points for entity ${i}`,
          ],
          tags: ['test', 'generated', `group_${i % 10}`],
          importance: i % 10,
          createdAt: '2024-01-01T00:00:00.000Z',
          lastModified: '2024-01-01T00:00:00.000Z',
        });
      }

      for (let i = 0; i < 99; i++) {
        largeGraph.relations.push({
          from: `Entity_${i}`,
          to: `Entity_${i + 1}`,
          relationType: 'connected_to',
          createdAt: '2024-01-01T00:00:00.000Z',
        });
      }

      await storage.saveGraph(largeGraph);
      const result = await manager.createBackup();

      // With repetitive JSON data, brotli should achieve at least 50% compression
      expect(result.compressionRatio).toBeLessThan(0.5);
    });

    it('should handle legacy string description argument', async () => {
      await storage.saveGraph(sampleGraph);

      const result = await manager.createBackup('Legacy description');

      expect(result.description).toBe('Legacy description');
      expect(result.compressed).toBe(true);
    });
  });

  describe('Compressed Backup Restoration', () => {
    it('should restore compressed backup correctly', async () => {
      await storage.saveGraph(sampleGraph);
      const backupResult = await manager.createBackup();

      // Modify the graph
      await storage.saveGraph({
        entities: [{ name: 'Modified', entityType: 'test', observations: [] }],
        relations: [],
      });

      // Restore from compressed backup
      const restoreResult = await manager.restoreFromBackup(backupResult.path);

      expect(restoreResult.wasCompressed).toBe(true);
      expect(restoreResult.entityCount).toBe(3);
      expect(restoreResult.relationCount).toBe(3);
      expect(restoreResult.restoredFrom).toBe(backupResult.path);

      // Verify restored data
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(3);
      expect(graph.entities.find(e => e.name === 'Alice')).toBeDefined();
      expect(graph.relations).toHaveLength(3);
    });

    it('should restore uncompressed backup correctly', async () => {
      await storage.saveGraph(sampleGraph);
      const backupResult = await manager.createBackup({ compress: false });

      // Modify the graph
      await storage.saveGraph({
        entities: [{ name: 'Modified', entityType: 'test', observations: [] }],
        relations: [],
      });

      // Restore from uncompressed backup
      const restoreResult = await manager.restoreFromBackup(backupResult.path);

      expect(restoreResult.wasCompressed).toBe(false);
      expect(restoreResult.entityCount).toBe(3);
      expect(restoreResult.relationCount).toBe(3);

      // Verify restored data
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(3);
    });

    it('should maintain data integrity through compress/decompress cycle', async () => {
      await storage.saveGraph(sampleGraph);
      const backupResult = await manager.createBackup();

      // Clear and restore
      await storage.saveGraph({ entities: [], relations: [] });
      await manager.restoreFromBackup(backupResult.path);

      // Verify all data is intact
      const graph = await storage.loadGraph();

      // Check entities
      expect(graph.entities).toHaveLength(3);
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice).toBeDefined();
      expect(alice?.observations).toHaveLength(4);
      expect(alice?.tags).toContain('developer');
      expect(alice?.importance).toBe(8);

      // Check relations
      expect(graph.relations).toHaveLength(3);
      const mentorsRelation = graph.relations.find(r => r.relationType === 'mentors');
      expect(mentorsRelation).toBeDefined();
      expect(mentorsRelation?.from).toBe('Alice');
      expect(mentorsRelation?.to).toBe('Bob');
    });
  });

  describe('Listing Backups with Compression Info', () => {
    it('should list backups with compression information', async () => {
      await storage.saveGraph(sampleGraph);

      await manager.createBackup({ description: 'First backup' });
      await new Promise(r => setTimeout(r, 10));
      await manager.createBackup({ description: 'Second backup' });

      const backups = await manager.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0].compressed).toBe(true);
      expect(backups[0].metadata.compressed).toBe(true);
      expect(backups[0].metadata.compressionFormat).toBe('brotli');
      expect(backups[0].size).toBeGreaterThan(0);
    });

    it('should handle mixed compressed/uncompressed backups', async () => {
      await storage.saveGraph(sampleGraph);

      await manager.createBackup({ compress: false, description: 'Uncompressed' });
      await new Promise(r => setTimeout(r, 10));
      await manager.createBackup({ compress: true, description: 'Compressed' });

      const backups = await manager.listBackups();

      expect(backups).toHaveLength(2);
      // Newest first
      expect(backups[0].metadata.description).toBe('Compressed');
      expect(backups[0].compressed).toBe(true);
      expect(backups[1].metadata.description).toBe('Uncompressed');
      expect(backups[1].compressed).toBe(false);
    });

    it('should show compression ratio in metadata', async () => {
      await storage.saveGraph(sampleGraph);

      await manager.createBackup({ description: 'Ratio test' });

      const backups = await manager.listBackups();

      expect(backups[0].metadata.compressionRatio).toBeDefined();
      expect(backups[0].metadata.compressionRatio).toBeLessThan(1);
      expect(backups[0].metadata.originalSize).toBeGreaterThan(backups[0].metadata.fileSize);
    });
  });

  describe('Backward Compatibility', () => {
    it('should detect legacy uncompressed backups by file extension', async () => {
      await storage.saveGraph(sampleGraph);

      // Create a legacy-style uncompressed backup manually
      const backupDir = manager.getBackupDir();
      await fs.mkdir(backupDir, { recursive: true });

      const legacyBackupPath = join(backupDir, 'backup_2024-01-01_00-00-00-000.jsonl');
      const legacyMetadataPath = `${legacyBackupPath}.meta.json`;

      const legacyContent = JSON.stringify(sampleGraph);
      await fs.writeFile(legacyBackupPath, legacyContent);
      await fs.writeFile(legacyMetadataPath, JSON.stringify({
        timestamp: '2024-01-01T00:00:00.000Z',
        entityCount: 3,
        relationCount: 3,
        fileSize: Buffer.byteLength(legacyContent),
        // No compression fields (legacy backup)
      }));

      const backups = await manager.listBackups();

      const legacyBackup = backups.find(b => b.fileName.includes('2024-01-01'));
      expect(legacyBackup).toBeDefined();
      expect(legacyBackup?.compressed).toBe(false);
      // Backward compatibility: compression fields should be added
      expect(legacyBackup?.metadata.compressionFormat).toBe('none');
    });

    it('should restore legacy uncompressed backups', async () => {
      await storage.saveGraph(sampleGraph);

      // Create legacy backup
      const backupResult = await manager.createBackup({ compress: false });

      // Modify data
      await storage.saveGraph({ entities: [], relations: [] });

      // Restore legacy backup
      const restoreResult = await manager.restoreFromBackup(backupResult.path);

      expect(restoreResult.wasCompressed).toBe(false);
      expect(restoreResult.entityCount).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty graph backup', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const result = await manager.createBackup();

      expect(result.entityCount).toBe(0);
      expect(result.relationCount).toBe(0);
      expect(result.compressed).toBe(true);

      // Restore empty backup
      const restoreResult = await manager.restoreFromBackup(result.path);
      expect(restoreResult.entityCount).toBe(0);
    });

    it('should handle special characters in entity data', async () => {
      const graphWithSpecialChars: KnowledgeGraph = {
        entities: [
          {
            name: 'Test "Entity"',
            entityType: 'special',
            observations: [
              'Contains "quotes"',
              'Has\nnewlines',
              'Unicode: 你好世界 🌍',
              'Special chars: <>&\'',
            ],
          },
        ],
        relations: [],
      };

      await storage.saveGraph(graphWithSpecialChars);
      const backupResult = await manager.createBackup();

      await storage.saveGraph({ entities: [], relations: [] });
      await manager.restoreFromBackup(backupResult.path);

      const graph = await storage.loadGraph();
      expect(graph.entities[0].name).toBe('Test "Entity"');
      expect(graph.entities[0].observations).toContain('Unicode: 你好世界 🌍');
    });

    it('should handle very small data (minimal compression benefit)', async () => {
      await storage.saveGraph({
        entities: [{ name: 'A', entityType: 'x', observations: [] }],
        relations: [],
      });

      const result = await manager.createBackup();

      // Even with minimal compression benefit, should still work
      expect(result.compressed).toBe(true);
      expect(result.originalSize).toBeGreaterThan(0);

      const restoreResult = await manager.restoreFromBackup(result.path);
      expect(restoreResult.entityCount).toBe(1);
    });
  });
});
