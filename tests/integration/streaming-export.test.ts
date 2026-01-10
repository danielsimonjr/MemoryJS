/**
 * Integration tests for streaming export functionality.
 *
 * Tests the integration of StreamingExporter with IOManager for
 * automatic and manual streaming exports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { IOManager } from '../../src/features/IOManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Entity } from '../../src/types/types.js';

describe('Streaming Export Integration', () => {
  let storage: GraphStorage;
  let ioManager: IOManager;
  let tempDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `streaming-export-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    testFilePath = join(tempDir, 'memory.jsonl');

    // Initialize storage and IOManager
    storage = new GraphStorage(testFilePath);
    ioManager = new IOManager(storage);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should use in-memory export for small graphs (< 5000 entities)', async () => {
    // Create a small graph (10 entities)
    const entities: Entity[] = [];
    for (let i = 0; i < 10; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export without streaming flag - should use in-memory
    const result = await ioManager.exportGraphWithCompression(graph, 'json');

    expect(result.streamed).toBeFalsy();
    expect(result.outputPath).toBeUndefined();
    expect(result.content).toBeTruthy();
    expect(result.entityCount).toBe(10);
  });

  it('should stream when explicitly requested with streaming: true', async () => {
    // Create a small graph
    const entities: Entity[] = [];
    for (let i = 0; i < 10; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export with streaming flag explicitly set
    const outputPath = join(tempDir, 'export.jsonl');
    const result = await ioManager.exportGraphWithCompression(graph, 'json', {
      streaming: true,
      outputPath,
    });

    expect(result.streamed).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.content).toBe(`Streamed to ${outputPath}`);
    expect(result.entityCount).toBe(10);

    // Verify file exists and has content
    const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);

    const fileContent = await fs.readFile(outputPath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    expect(lines.length).toBe(10); // 10 entities
  });

  it('should stream CSV format correctly', async () => {
    // Create entities with various fields
    const entities: Entity[] = [];
    for (let i = 0; i < 100; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`, `Another observation ${i}`],
        tags: ['test', `tag${i}`],
        importance: i % 10,
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export as CSV with streaming
    const outputPath = join(tempDir, 'export.csv');
    const result = await ioManager.exportGraphWithCompression(graph, 'csv', {
      streaming: true,
      outputPath,
    });

    expect(result.streamed).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.entityCount).toBe(100);

    // Verify CSV file structure
    const fileContent = await fs.readFile(outputPath, 'utf-8');
    const lines = fileContent.trim().split('\n');

    // Should have header + 100 entity rows
    expect(lines.length).toBe(101);

    // Verify header
    expect(lines[0]).toBe('name,type,observations,tags,importance,createdAt,lastModified');

    // Verify first data row contains expected values
    expect(lines[1]).toContain('Entity0');
    expect(lines[1]).toContain('test');
  });

  it('should fallback to in-memory for unsupported streaming formats', async () => {
    // Create a small graph
    const entities: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      entities.push({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export as markdown (unsupported for streaming) with streaming flag
    const outputPath = join(tempDir, 'export.md');
    const result = await ioManager.exportGraphWithCompression(graph, 'markdown', {
      streaming: true,
      outputPath,
    });

    // Should still mark as streamed since outputPath was provided
    expect(result.streamed).toBe(true);
    expect(result.outputPath).toBe(outputPath);

    // Verify file exists with markdown content
    const fileContent = await fs.readFile(outputPath, 'utf-8');
    expect(fileContent).toContain('# Knowledge Graph Export');
    expect(fileContent).toContain('Entity0');
  });

  it('should auto-stream for large graphs (>= 5000 entities) when outputPath provided', async () => {
    // Note: This test creates 5000 entities which may be slow
    // We'll create a minimal test with exactly 5000 to verify threshold
    const entities: Entity[] = [];
    for (let i = 0; i < 5000; i++) {
      entities.push({
        name: `E${i}`,
        entityType: 'test',
        observations: [`Obs${i}`],
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export without streaming flag but with outputPath
    // Should auto-trigger streaming due to entity count
    const outputPath = join(tempDir, 'large-export.jsonl');
    const result = await ioManager.exportGraphWithCompression(graph, 'json', {
      outputPath,
    });

    expect(result.streamed).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.entityCount).toBe(5000);

    // Verify file exists
    const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should not stream when outputPath is not provided, even for large graphs', async () => {
    // Create a graph at the threshold
    const entities: Entity[] = [];
    for (let i = 0; i < 5000; i++) {
      entities.push({
        name: `E${i}`,
        entityType: 'test',
        observations: [`Obs${i}`],
      });
    }

    await storage.saveGraph({ entities, relations: [] });
    const graph = await storage.loadGraph();

    // Export without outputPath - should NOT stream even though count >= 5000
    const result = await ioManager.exportGraphWithCompression(graph, 'json');

    expect(result.streamed).toBeFalsy();
    expect(result.outputPath).toBeUndefined();
    expect(result.content).toBeTruthy();
    expect(result.content).not.toBe('Streamed to undefined');
  });
});
