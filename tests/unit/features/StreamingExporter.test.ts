/**
 * Unit Tests: StreamingExporter
 *
 * Tests for streaming export functionality including JSONL and CSV formats,
 * special character handling, and memory efficiency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamingExporter } from '../../../src/features/StreamingExporter.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Entity, KnowledgeGraph } from '../../../src/types/types.js';

describe('StreamingExporter', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `streaming-exporter-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper function to create a test knowledge graph with specified number of entities.
   *
   * @param entityCount - Number of entities to create
   * @returns Knowledge graph with test entities
   */
  function createTestGraph(entityCount: number): KnowledgeGraph {
    const entities: Entity[] = [];
    const relations = [];

    for (let i = 0; i < entityCount; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`, `Another observation for entity ${i}`],
        tags: [`tag${i % 5}`, 'common-tag'],
        importance: (i % 10) + 1,
        createdAt: new Date(2024, 0, 1 + i).toISOString(),
        lastModified: new Date(2024, 0, 1 + i).toISOString(),
      });

      // Add some relations
      if (i > 0) {
        relations.push({
          from: `Entity${i}`,
          to: `Entity${i - 1}`,
          relationType: 'relates_to',
          createdAt: new Date(2024, 0, 1 + i).toISOString(),
        });
      }
    }

    return { entities, relations };
  }

  describe('streamJSONL', () => {
    it('should export a small graph to JSONL format', async () => {
      const graph = createTestGraph(10);
      const outputPath = join(testDir, 'small-export.jsonl');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamJSONL(graph);

      // Verify result statistics
      expect(result.entitiesWritten).toBe(10);
      expect(result.relationsWritten).toBe(9);
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');
      expect(lines.length).toBe(19); // 10 entities + 9 relations

      // Verify first line is an entity
      const firstEntity = JSON.parse(lines[0]);
      expect(firstEntity).toHaveProperty('name');
      expect(firstEntity).toHaveProperty('entityType');
      expect(firstEntity).toHaveProperty('observations');

      // Verify last line is a relation
      const lastRelation = JSON.parse(lines[lines.length - 1]);
      expect(lastRelation).toHaveProperty('from');
      expect(lastRelation).toHaveProperty('to');
      expect(lastRelation).toHaveProperty('relationType');
    });

    it('should export a large graph to JSONL format', async () => {
      const graph = createTestGraph(1000);
      const outputPath = join(testDir, 'large-export.jsonl');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamJSONL(graph);

      // Verify result statistics
      expect(result.entitiesWritten).toBe(1000);
      expect(result.relationsWritten).toBe(999);
      expect(result.bytesWritten).toBeGreaterThan(0);

      // Verify file was created
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBe(result.bytesWritten);

      // Spot check a few lines
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');
      expect(lines.length).toBe(1999); // 1000 entities + 999 relations

      // Verify middle entity
      const middleEntity = JSON.parse(lines[500]);
      expect(middleEntity.name).toBe('Entity500');
    });

    it('should handle empty graph', async () => {
      const graph: KnowledgeGraph = { entities: [], relations: [] };
      const outputPath = join(testDir, 'empty-export.jsonl');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamJSONL(graph);

      // Verify result statistics
      expect(result.entitiesWritten).toBe(0);
      expect(result.relationsWritten).toBe(0);
      expect(result.bytesWritten).toBe(0);

      // Verify file was created but is empty
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      expect(fileContent).toBe('');
    });
  });

  describe('streamCSV', () => {
    it('should export graph with CSV header', async () => {
      const graph = createTestGraph(5);
      const outputPath = join(testDir, 'export.csv');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamCSV(graph);

      // Verify result statistics
      expect(result.entitiesWritten).toBe(5);
      expect(result.relationsWritten).toBe(0); // CSV doesn't export relations
      expect(result.bytesWritten).toBeGreaterThan(0);

      // Verify file content
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');
      expect(lines.length).toBe(6); // 1 header + 5 entities

      // Verify header
      expect(lines[0]).toBe('name,type,observations,tags,importance,createdAt,lastModified');

      // Verify first data row
      expect(lines[1]).toContain('Entity0');
      expect(lines[1]).toContain('test');
    });

    it('should properly escape special characters in CSV', async () => {
      const graph: KnowledgeGraph = {
        entities: [
          {
            name: 'Entity "with quotes"',
            entityType: 'Type, with comma',
            observations: ['Observation with "quotes"', 'Another; with semicolon'],
            tags: ['tag"1', 'tag,2'],
            importance: 5,
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
        relations: [],
      };

      const outputPath = join(testDir, 'special-chars.csv');
      const exporter = new StreamingExporter(outputPath);

      await exporter.streamCSV(graph);

      // Verify file content
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');

      // Verify the row has properly escaped quotes (doubled)
      expect(lines[1]).toContain('""with quotes""');
      expect(lines[1]).toContain('Type, with comma');
      expect(lines[1]).toContain('tag""1');
      expect(lines[1]).toContain('tag,2');
    });

    it('should handle entities without optional fields', async () => {
      const graph: KnowledgeGraph = {
        entities: [
          {
            name: 'MinimalEntity',
            entityType: 'minimal',
            observations: ['Just one observation'],
            // No tags, importance, createdAt, or lastModified
          },
        ],
        relations: [],
      };

      const outputPath = join(testDir, 'minimal.csv');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamCSV(graph);

      expect(result.entitiesWritten).toBe(1);

      // Verify file content
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');
      expect(lines.length).toBe(2); // header + 1 entity

      // Verify empty fields are present
      const dataRow = lines[1];
      expect(dataRow).toContain('MinimalEntity');
      expect(dataRow).toContain('minimal');
      // Should have empty values for missing fields
      expect(dataRow.split(',').length).toBe(7);
    });
  });

  describe('Memory efficiency', () => {
    it('should keep memory usage bounded for large graphs', async () => {
      // This test verifies that memory doesn't grow proportionally with graph size
      const graph = createTestGraph(5000);
      const outputPath = join(testDir, 'memory-test.jsonl');
      const exporter = new StreamingExporter(outputPath);

      // Measure memory before export
      if (global.gc) {
        global.gc();
      }
      const memBefore = process.memoryUsage().heapUsed;

      // Run export
      await exporter.streamJSONL(graph);

      // Measure memory after export
      if (global.gc) {
        global.gc();
      }
      const memAfter = process.memoryUsage().heapUsed;

      const memIncrease = memAfter - memBefore;

      // Memory increase should be less than 10MB for 5000 entities
      // (Streaming should keep memory constant regardless of graph size)
      expect(memIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should verify file integrity for large export', async () => {
      const graph = createTestGraph(1000);
      const outputPath = join(testDir, 'integrity-test.jsonl');
      const exporter = new StreamingExporter(outputPath);

      const result = await exporter.streamJSONL(graph);

      // Verify all entities and relations can be parsed
      const fileContent = await fs.readFile(outputPath, 'utf-8');
      const lines = fileContent.trim().split('\n');

      expect(lines.length).toBe(result.entitiesWritten + result.relationsWritten);

      // Parse all lines to ensure valid JSON
      const parsed = lines.map((line) => JSON.parse(line));
      expect(parsed.length).toBe(1999);

      // Verify first 1000 are entities
      for (let i = 0; i < 1000; i++) {
        expect(parsed[i]).toHaveProperty('entityType');
      }

      // Verify remaining are relations
      for (let i = 1000; i < parsed.length; i++) {
        expect(parsed[i]).toHaveProperty('relationType');
      }
    });
  });

  describe('Performance', () => {
    it('should complete export in reasonable time', async () => {
      const graph = createTestGraph(1000);
      const outputPath = join(testDir, 'perf-test.jsonl');
      const exporter = new StreamingExporter(outputPath);

      const startTime = Date.now();
      const result = await exporter.streamJSONL(graph);
      const endTime = Date.now();

      // Export should complete in less than 2 seconds
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result.durationMs).toBeLessThan(2000);
    });
  });
});
