/**
 * Incremental TF-IDF Index Tests
 *
 * Phase 10 Sprint 3: Tests for incremental TF-IDF index updates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import { TFIDFEventSync } from '../../../src/search/TFIDFEventSync.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity } from '../../../src/types/types.js';

describe('TFIDFIndexManager Incremental Updates', () => {
  let tempDir: string;
  let indexManager: TFIDFIndexManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tfidf-incremental-test-'));
    indexManager = new TFIDFIndexManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('addDocument', () => {
    it('should add a new document to the index', async () => {
      // Build initial index
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['Developer'] },
        ],
        relations: [],
      });

      expect(indexManager.getDocumentCount()).toBe(1);

      // Add new document incrementally
      indexManager.addDocument({
        name: 'Bob',
        entityType: 'person',
        observations: ['Designer'],
      });

      expect(indexManager.getDocumentCount()).toBe(2);

      const index = indexManager.getIndex();
      expect(index?.documents.has('Bob')).toBe(true);
      expect(index?.documents.get('Bob')?.terms).toHaveProperty('designer');
    });

    it('should update IDF scores when adding document', async () => {
      // Build initial index with one document that has unique term
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['engineer'] },
        ],
        relations: [],
      });

      const initialIndex = indexManager.getIndex();
      // With only 1 doc containing 'engineer', IDF = log(1/1) = 0
      const initialEngineerIDF = initialIndex?.idf.get('engineer');
      expect(initialEngineerIDF).toBe(0);

      // Add another document WITHOUT 'engineer' term
      indexManager.addDocument({
        name: 'Bob',
        entityType: 'person',
        observations: ['designer'],
      });

      const updatedIndex = indexManager.getIndex();
      const updatedEngineerIDF = updatedIndex?.idf.get('engineer');

      // IDF should INCREASE because 'engineer' is now more rare (1 of 2 docs)
      // IDF = log(2/1) = log(2) ≈ 0.69
      expect(updatedEngineerIDF).toBeGreaterThan(0);
    });

    it('should do nothing when index is not initialized', () => {
      // No index built yet
      expect(indexManager.isInitialized()).toBe(false);

      // Should not throw
      indexManager.addDocument({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(indexManager.getDocumentCount()).toBe(0);
    });
  });

  describe('removeDocument', () => {
    it('should remove a document from the index', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['Developer'] },
          { name: 'Bob', entityType: 'person', observations: ['Designer'] },
        ],
        relations: [],
      });

      expect(indexManager.getDocumentCount()).toBe(2);

      indexManager.removeDocument('Bob');

      expect(indexManager.getDocumentCount()).toBe(1);
      expect(indexManager.getIndex()?.documents.has('Bob')).toBe(false);
    });

    it('should update IDF scores when removing document', async () => {
      // Build index with 2 docs - one has 'unique' term, one doesn't
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['unique'] },
          { name: 'Bob', entityType: 'person', observations: ['common'] },
        ],
        relations: [],
      });

      // With 2 docs, 1 containing 'unique': IDF = log(2/1) = log(2) ≈ 0.69
      const initialIDF = indexManager.getIndex()?.idf.get('unique');
      expect(initialIDF).toBeGreaterThan(0);

      // Remove Bob (who doesn't have 'unique')
      indexManager.removeDocument('Bob');

      // Now with 1 doc containing 'unique': IDF = log(1/1) = 0
      const updatedIDF = indexManager.getIndex()?.idf.get('unique');

      // IDF should DECREASE because 'unique' is now less rare (only doc has it)
      expect(updatedIDF).toBe(0);
    });

    it('should remove IDF entry when term no longer exists in any document', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['developer'] },
          { name: 'Bob', entityType: 'person', observations: ['designer'] },
        ],
        relations: [],
      });

      expect(indexManager.getIndex()?.idf.has('designer')).toBe(true);

      indexManager.removeDocument('Bob');

      // 'designer' term should be removed from IDF
      expect(indexManager.getIndex()?.idf.has('designer')).toBe(false);
    });

    it('should handle removing non-existent document', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [] },
        ],
        relations: [],
      });

      // Should not throw
      indexManager.removeDocument('NonExistent');

      expect(indexManager.getDocumentCount()).toBe(1);
    });
  });

  describe('updateDocument', () => {
    it('should update an existing document', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['developer'] },
        ],
        relations: [],
      });

      const initialDoc = indexManager.getIndex()?.documents.get('Alice');
      expect(initialDoc?.terms).toHaveProperty('developer');

      indexManager.updateDocument({
        name: 'Alice',
        entityType: 'person',
        observations: ['manager'],
      });

      const updatedDoc = indexManager.getIndex()?.documents.get('Alice');
      expect(updatedDoc?.terms).not.toHaveProperty('developer');
      expect(updatedDoc?.terms).toHaveProperty('manager');
    });

    it('should update IDF for changed terms only', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['developer python'] },
          { name: 'Bob', entityType: 'person', observations: ['developer java'] },
        ],
        relations: [],
      });

      const initialPythonIDF = indexManager.getIndex()?.idf.get('python');
      const initialDeveloperIDF = indexManager.getIndex()?.idf.get('developer');

      // Update Alice - remove python, add rust
      indexManager.updateDocument({
        name: 'Alice',
        entityType: 'person',
        observations: ['developer rust'],
      });

      const index = indexManager.getIndex();

      // 'python' should be removed from IDF (no longer in any doc)
      expect(index?.idf.has('python')).toBe(false);

      // 'rust' should be added to IDF
      expect(index?.idf.has('rust')).toBe(true);

      // 'developer' IDF should remain similar (still in both docs)
      const updatedDeveloperIDF = index?.idf.get('developer');
      expect(updatedDeveloperIDF).toBe(initialDeveloperIDF);
    });

    it('should handle updating non-existent document (acts as add)', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [] },
        ],
        relations: [],
      });

      // Update non-existent document - should add it
      indexManager.updateDocument({
        name: 'Bob',
        entityType: 'person',
        observations: ['new'],
      });

      expect(indexManager.getDocumentCount()).toBe(2);
      expect(indexManager.getIndex()?.documents.has('Bob')).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false when no index', () => {
      expect(indexManager.isInitialized()).toBe(false);
    });

    it('should return true after building index', async () => {
      await indexManager.buildIndex({ entities: [], relations: [] });
      expect(indexManager.isInitialized()).toBe(true);
    });

    it('should return true after loading index', async () => {
      // Build and save
      await indexManager.buildIndex({ entities: [], relations: [] });
      await indexManager.saveIndex();

      // Create new manager and load
      const manager2 = new TFIDFIndexManager(tempDir);
      await manager2.loadIndex();

      expect(manager2.isInitialized()).toBe(true);
    });
  });

  describe('getDocumentCount', () => {
    it('should return 0 when not initialized', () => {
      expect(indexManager.getDocumentCount()).toBe(0);
    });

    it('should return correct count', async () => {
      await indexManager.buildIndex({
        entities: [
          { name: 'A', entityType: 't', observations: [] },
          { name: 'B', entityType: 't', observations: [] },
          { name: 'C', entityType: 't', observations: [] },
        ],
        relations: [],
      });

      expect(indexManager.getDocumentCount()).toBe(3);
    });
  });
});

describe('TFIDFEventSync', () => {
  let tempDir: string;
  let storage: GraphStorage;
  let indexManager: TFIDFIndexManager;
  let sync: TFIDFEventSync;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tfidf-sync-test-'));
    storage = new GraphStorage(path.join(tempDir, 'memory.jsonl'));
    indexManager = new TFIDFIndexManager(tempDir);

    // Build initial index
    await indexManager.buildIndex({ entities: [], relations: [] });

    // Create sync
    sync = new TFIDFEventSync(indexManager, storage.events, storage);
  });

  afterEach(async () => {
    sync.disable();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('enable/disable', () => {
    it('should track enabled state', () => {
      expect(sync.isEnabled()).toBe(false);

      sync.enable();
      expect(sync.isEnabled()).toBe(true);

      sync.disable();
      expect(sync.isEnabled()).toBe(false);
    });

    it('should not double-enable', () => {
      sync.enable();
      sync.enable(); // Should not throw
      expect(sync.isEnabled()).toBe(true);
    });

    it('should not double-disable', () => {
      sync.enable();
      sync.disable();
      sync.disable(); // Should not throw
      expect(sync.isEnabled()).toBe(false);
    });
  });

  describe('automatic index updates', () => {
    it('should add document when entity is created', async () => {
      sync.enable();

      expect(indexManager.getDocumentCount()).toBe(0);

      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(indexManager.getDocumentCount()).toBe(1);
      expect(indexManager.getIndex()?.documents.has('Alice')).toBe(true);
    });

    it('should update document when entity is updated', async () => {
      // Add initial entity
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Rebuild index with entity
      await indexManager.buildIndex(await storage.loadGraph());

      sync.enable();

      const initialDoc = indexManager.getIndex()?.documents.get('Alice');
      expect(initialDoc?.terms).toHaveProperty('developer');

      // Update entity
      await storage.updateEntity('Alice', {
        observations: ['Manager'],
      });

      // Wait a tick for async event handler
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedDoc = indexManager.getIndex()?.documents.get('Alice');
      expect(updatedDoc?.terms).toHaveProperty('manager');
    });

    it('should not update index when disabled', async () => {
      // Don't enable sync

      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(indexManager.getDocumentCount()).toBe(0);
    });

    it('should not update when index is not initialized', async () => {
      // Clear index
      await indexManager.clearIndex();
      expect(indexManager.isInitialized()).toBe(false);

      sync.enable();

      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Should not throw, just skip
      expect(indexManager.getDocumentCount()).toBe(0);
    });
  });
});
