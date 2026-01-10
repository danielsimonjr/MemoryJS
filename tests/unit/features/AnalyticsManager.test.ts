/**
 * Analytics Operations Unit Tests
 *
 * Tests for graph validation and statistics.
 * (Originally AnalyticsManager, merged into SearchManager in Sprint 11.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalyticsManager } from '../../../src/features/AnalyticsManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AnalyticsManager', () => {
  let storage: GraphStorage;
  let analyticsManager: AnalyticsManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `analytics-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    storage = new GraphStorage(testFilePath);
    analyticsManager = new AnalyticsManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('validateGraph', () => {
    it('should return valid for empty graph', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const report = await analyticsManager.validateGraph();

      expect(report.isValid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should return valid for well-formed graph', async () => {
      await storage.saveGraph({
        entities: [
          {
            name: 'Alice',
            entityType: 'person',
            observations: ['Developer'],
            createdAt: '2024-01-01T00:00:00Z',
            lastModified: '2024-01-02T00:00:00Z',
          },
          {
            name: 'Bob',
            entityType: 'person',
            observations: ['Manager'],
            createdAt: '2024-01-01T00:00:00Z',
            lastModified: '2024-01-02T00:00:00Z',
          },
        ],
        relations: [{ from: 'Alice', to: 'Bob', relationType: 'knows' }],
      });

      const report = await analyticsManager.validateGraph();

      expect(report.isValid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    describe('Issue Detection', () => {
      it('should detect orphaned relation (missing source)', async () => {
        await storage.saveGraph({
          entities: [{ name: 'Bob', entityType: 'person', observations: [] }],
          relations: [{ from: 'Alice', to: 'Bob', relationType: 'knows' }],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.isValid).toBe(false);
        expect(report.issues.some(i => i.type === 'orphaned_relation')).toBe(true);
        expect(report.summary.orphanedRelationsCount).toBeGreaterThan(0);
      });

      it('should detect orphaned relation (missing target)', async () => {
        await storage.saveGraph({
          entities: [{ name: 'Alice', entityType: 'person', observations: [] }],
          relations: [{ from: 'Alice', to: 'Bob', relationType: 'knows' }],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.isValid).toBe(false);
        expect(report.issues.some(i => i.type === 'orphaned_relation')).toBe(true);
      });

      it('should detect duplicate entity names', async () => {
        await storage.saveGraph({
          entities: [
            { name: 'Alice', entityType: 'person', observations: ['One'] },
            { name: 'Alice', entityType: 'person', observations: ['Two'] },
          ],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.isValid).toBe(false);
        expect(report.issues.some(i => i.type === 'duplicate_entity')).toBe(true);
      });

      it('should detect entity with empty name', async () => {
        await storage.saveGraph({
          entities: [{ name: '', entityType: 'person', observations: [] }],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.isValid).toBe(false);
        expect(report.issues.some(i => i.type === 'invalid_data')).toBe(true);
      });

      it('should detect entity with empty entityType', async () => {
        await storage.saveGraph({
          entities: [{ name: 'Test', entityType: '', observations: [] }],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.isValid).toBe(false);
        expect(report.issues.some(i => i.type === 'invalid_data')).toBe(true);
      });
    });

    describe('Warning Detection', () => {
      it('should warn about isolated entities', async () => {
        await storage.saveGraph({
          entities: [
            { name: 'Connected', entityType: 'person', observations: [] },
            { name: 'Isolated', entityType: 'person', observations: [] },
          ],
          relations: [{ from: 'Connected', to: 'Connected', relationType: 'self' }],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.warnings.some(w => w.type === 'isolated_entity')).toBe(true);
        expect(report.summary.entitiesWithoutRelationsCount).toBeGreaterThan(0);
      });

      it('should warn about empty observations', async () => {
        await storage.saveGraph({
          entities: [{ name: 'Empty', entityType: 'person', observations: [] }],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.warnings.some(w => w.type === 'empty_observations')).toBe(true);
      });

      it('should warn about missing createdAt', async () => {
        await storage.saveGraph({
          entities: [{ name: 'NoDate', entityType: 'person', observations: ['test'] }],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.warnings.some(w => w.type === 'missing_metadata')).toBe(true);
      });

      it('should warn about missing lastModified', async () => {
        await storage.saveGraph({
          entities: [
            {
              name: 'NoModDate',
              entityType: 'person',
              observations: ['test'],
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(
          report.warnings.some(
            w => w.type === 'missing_metadata' && w.details?.field === 'lastModified'
          )
        ).toBe(true);
      });
    });

    describe('Summary', () => {
      it('should include total error count', async () => {
        await storage.saveGraph({
          entities: [],
          relations: [{ from: 'Missing1', to: 'Missing2', relationType: 'test' }],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.summary.totalErrors).toBeGreaterThan(0);
      });

      it('should include total warning count', async () => {
        await storage.saveGraph({
          entities: [{ name: 'NoObs', entityType: 'person', observations: [] }],
          relations: [],
        });

        const report = await analyticsManager.validateGraph();

        expect(report.summary.totalWarnings).toBeGreaterThan(0);
      });
    });
  });

  describe('getGraphStats', () => {
    it('should return stats for empty graph', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelations).toBe(0);
    });

    it('should return correct entity count', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'person', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'person', observations: [], createdAt: '2024-01-02T00:00:00Z' },
          { name: 'C', entityType: 'project', observations: [], createdAt: '2024-01-03T00:00:00Z' },
        ],
        relations: [],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.totalEntities).toBe(3);
    });

    it('should return correct relation count', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'person', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'person', observations: [], createdAt: '2024-01-02T00:00:00Z' },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'knows', createdAt: '2024-01-03T00:00:00Z' },
          { from: 'B', to: 'A', relationType: 'knows', createdAt: '2024-01-04T00:00:00Z' },
        ],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.totalRelations).toBe(2);
    });

    it('should return entity type distribution', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'person', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'person', observations: [], createdAt: '2024-01-02T00:00:00Z' },
          { name: 'C', entityType: 'project', observations: [], createdAt: '2024-01-03T00:00:00Z' },
        ],
        relations: [],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.entityTypesCounts['person']).toBe(2);
      expect(stats.entityTypesCounts['project']).toBe(1);
    });

    it('should return relation type distribution', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'person', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'person', observations: [], createdAt: '2024-01-02T00:00:00Z' },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'knows', createdAt: '2024-01-03T00:00:00Z' },
          { from: 'A', to: 'B', relationType: 'knows', createdAt: '2024-01-04T00:00:00Z' },
          { from: 'A', to: 'B', relationType: 'works_with', createdAt: '2024-01-05T00:00:00Z' },
        ],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.relationTypesCounts['knows']).toBe(2);
      expect(stats.relationTypesCounts['works_with']).toBe(1);
    });

    it('should find oldest entity', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'New', entityType: 'test', observations: [], createdAt: '2024-06-01T00:00:00Z' },
          { name: 'Old', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'Mid', entityType: 'test', observations: [], createdAt: '2024-03-01T00:00:00Z' },
        ],
        relations: [],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.oldestEntity?.name).toBe('Old');
    });

    it('should find newest entity', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'New', entityType: 'test', observations: [], createdAt: '2024-06-01T00:00:00Z' },
          { name: 'Old', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
        ],
        relations: [],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.newestEntity?.name).toBe('New');
    });

    it('should find oldest relation', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'test', observations: [], createdAt: '2024-01-02T00:00:00Z' },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'new', createdAt: '2024-06-01T00:00:00Z' },
          { from: 'A', to: 'B', relationType: 'old', createdAt: '2024-01-01T00:00:00Z' },
        ],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.oldestRelation?.relationType).toBe('old');
    });

    it('should find newest relation', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'test', observations: [], createdAt: '2024-01-02T00:00:00Z' },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'new', createdAt: '2024-06-01T00:00:00Z' },
          { from: 'A', to: 'B', relationType: 'old', createdAt: '2024-01-01T00:00:00Z' },
        ],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.newestRelation?.relationType).toBe('new');
    });

    it('should return entity date range', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Old', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'New', entityType: 'test', observations: [], createdAt: '2024-06-01T00:00:00Z' },
        ],
        relations: [],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.entityDateRange).toBeDefined();
      expect(stats.entityDateRange?.earliest).toContain('2024-01-01');
      expect(stats.entityDateRange?.latest).toContain('2024-06-01');
    });

    it('should return relation date range', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'test', observations: [], createdAt: '2024-01-01T00:00:00Z' },
          { name: 'B', entityType: 'test', observations: [], createdAt: '2024-01-02T00:00:00Z' },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'old', createdAt: '2024-01-01T00:00:00Z' },
          { from: 'A', to: 'B', relationType: 'new', createdAt: '2024-06-01T00:00:00Z' },
        ],
      });

      const stats = await analyticsManager.getGraphStats();

      expect(stats.relationDateRange).toBeDefined();
    });
  });
});
