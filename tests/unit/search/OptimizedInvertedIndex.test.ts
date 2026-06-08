/**
 * OptimizedInvertedIndex Unit Tests
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OptimizedInvertedIndex } from '../../../src/search/OptimizedInvertedIndex.js';

describe('OptimizedInvertedIndex', () => {
  let index: OptimizedInvertedIndex;

  beforeEach(() => {
    index = new OptimizedInvertedIndex();
  });

  describe('Document Management', () => {
    it('should add documents to the index', () => {
      index.addDocument('entity1', ['machine', 'learning', 'ai']);
      index.addDocument('entity2', ['deep', 'learning', 'neural']);

      expect(index.documentCount).toBe(2);
      expect(index.hasDocument('entity1')).toBe(true);
      expect(index.hasDocument('entity2')).toBe(true);
    });

    it('should track terms correctly', () => {
      index.addDocument('entity1', ['machine', 'learning']);

      expect(index.termCount).toBe(2);
      expect(index.hasTerm('machine')).toBe(true);
      expect(index.hasTerm('learning')).toBe(true);
      expect(index.hasTerm('unknown')).toBe(false);
    });

    it('should handle duplicate terms in same document', () => {
      index.addDocument('entity1', ['test', 'test', 'test']);

      const results = index.search('test');
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('entity1');
    });

    it('should remove documents from index', () => {
      index.addDocument('entity1', ['machine', 'learning']);
      index.addDocument('entity2', ['deep', 'learning']);

      const removed = index.removeDocument('entity1');
      expect(removed).toBe(true);
      expect(index.documentCount).toBe(1);
      expect(index.hasDocument('entity1')).toBe(false);
    });

    it('should return false when removing non-existent document', () => {
      const removed = index.removeDocument('nonexistent');
      expect(removed).toBe(false);
    });

    it('should update posting lists on document removal', () => {
      index.addDocument('entity1', ['unique', 'shared']);
      index.addDocument('entity2', ['shared', 'other']);

      index.removeDocument('entity1');

      // 'unique' should be removed entirely
      expect(index.hasTerm('unique')).toBe(false);
      // 'shared' should still exist for entity2
      expect(index.hasTerm('shared')).toBe(true);
    });
  });

  describe('Finalization', () => {
    it('should finalize index with Uint32Array posting lists', () => {
      index.addDocument('entity1', ['test']);
      index.addDocument('entity2', ['test']);

      index.finalize();

      const posting = index.getPostingList('test');
      expect(posting).not.toBeNull();
      expect(posting!.docIds).toBeInstanceOf(Uint32Array);
    });

    it('should sort posting lists on finalization', () => {
      // Add documents in reverse order to test sorting
      index.addDocument('entity3', ['test']);
      index.addDocument('entity1', ['test']);
      index.addDocument('entity2', ['test']);

      index.finalize();

      const posting = index.getPostingList('test');
      expect(posting).not.toBeNull();

      // IDs should be sorted
      for (let i = 1; i < posting!.docIds.length; i++) {
        expect(posting!.docIds[i]).toBeGreaterThan(posting!.docIds[i - 1]);
      }
    });

    it('should allow updates after finalization', () => {
      index.addDocument('entity1', ['original']);
      index.finalize();

      index.addDocument('entity2', ['new']);

      expect(index.hasDocument('entity2')).toBe(true);
      expect(index.hasTerm('new')).toBe(true);
    });
  });

  describe('Search Operations', () => {
    beforeEach(() => {
      index.addDocument('entity1', ['machine', 'learning', 'ai']);
      index.addDocument('entity2', ['deep', 'learning', 'neural']);
      index.addDocument('entity3', ['machine', 'vision', 'ai']);
      index.addDocument('entity4', ['python', 'programming']);
    });

    it('should search for single term', () => {
      const results = index.search('machine');

      expect(results).toHaveLength(2);
      expect(results).toContain('entity1');
      expect(results).toContain('entity3');
    });

    it('should return empty for unknown terms', () => {
      const results = index.search('unknown');
      expect(results).toEqual([]);
    });

    it('should intersect multiple terms (AND)', () => {
      const results = index.intersect(['machine', 'ai']);

      expect(results).toHaveLength(2);
      expect(results).toContain('entity1');
      expect(results).toContain('entity3');
    });

    it('should return empty for intersection with no matches', () => {
      const results = index.intersect(['machine', 'python']);
      expect(results).toEqual([]);
    });

    it('should return empty for intersection with unknown term', () => {
      const results = index.intersect(['machine', 'unknown']);
      expect(results).toEqual([]);
    });

    it('should union multiple terms (OR)', () => {
      const results = index.union(['machine', 'deep']);

      expect(results).toHaveLength(3);
      expect(results).toContain('entity1');
      expect(results).toContain('entity2');
      expect(results).toContain('entity3');
    });

    it('should handle empty terms array for intersect', () => {
      const results = index.intersect([]);
      expect(results).toEqual([]);
    });

    it('should handle empty terms array for union', () => {
      const results = index.union([]);
      expect(results).toEqual([]);
    });
  });

  describe('Posting Lists', () => {
    it('should return posting list for known term', () => {
      index.addDocument('entity1', ['test']);
      index.addDocument('entity2', ['test']);

      const posting = index.getPostingList('test');

      expect(posting).not.toBeNull();
      expect(posting!.term).toBe('test');
      expect(posting!.docIds.length).toBe(2);
    });

    it('should return null for unknown term', () => {
      const posting = index.getPostingList('unknown');
      expect(posting).toBeNull();
    });

    it('should return Uint32Array for posting list', () => {
      index.addDocument('entity1', ['test']);
      index.finalize();

      const posting = index.getPostingList('test');
      expect(posting!.docIds).toBeInstanceOf(Uint32Array);
    });
  });

  describe('Memory Usage', () => {
    it('should report memory usage statistics', () => {
      index.addDocument('entity1', ['machine', 'learning', 'ai']);
      index.addDocument('entity2', ['deep', 'learning', 'neural']);
      index.finalize();

      const usage = index.getMemoryUsage();

      expect(usage.documentCount).toBe(2);
      expect(usage.termCount).toBe(5);
      expect(usage.postingListBytes).toBeGreaterThan(0);
      expect(usage.totalBytes).toBeGreaterThan(0);
    });

    it('should report different memory for finalized vs unfinalized', () => {
      index.addDocument('entity1', ['test', 'data', 'here']);

      const unfinalizedUsage = index.getMemoryUsage();

      index.finalize();

      const finalizedUsage = index.getMemoryUsage();

      // Finalized should use less memory per posting (4 bytes vs 8 bytes per ID)
      expect(finalizedUsage.postingListBytes).toBeLessThan(unfinalizedUsage.postingListBytes);
    });
  });

  describe('Clear', () => {
    it('should clear all data', () => {
      index.addDocument('entity1', ['test']);
      index.addDocument('entity2', ['data']);
      index.finalize();

      index.clear();

      expect(index.documentCount).toBe(0);
      expect(index.termCount).toBe(0);
      expect(index.hasDocument('entity1')).toBe(false);
      expect(index.hasTerm('test')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document terms', () => {
      index.addDocument('empty', []);
      expect(index.documentCount).toBe(1);
      expect(index.termCount).toBe(0);
    });

    it('should handle many documents efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        index.addDocument(`entity${i}`, ['common', 'term', `unique${i}`]);
      }

      index.finalize();

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      expect(index.documentCount).toBe(1000);
    });

    it('should handle intersection with sorted smallest-first optimization', () => {
      // Create documents where one term is rare and one is common
      for (let i = 0; i < 100; i++) {
        index.addDocument(`entity${i}`, ['common']);
      }
      index.addDocument('rare_entity', ['common', 'rare']);

      // Intersection should use the smaller posting list first
      const results = index.intersect(['common', 'rare']);
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('rare_entity');
    });
  });
});
