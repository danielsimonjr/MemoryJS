/**
 * ObserverPipeline Unit Tests
 *
 * Tests for event-driven observation processing pipeline including
 * scoring, categorization, batch processing, event attachment, and stats.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ObserverPipeline,
  type ObservationScore,
} from '../../../src/agent/ObserverPipeline.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';

// ==================== Test Helpers ====================

function createMockEntityManager(): EntityManager {
  return {
    addTags: vi.fn().mockResolvedValue({ entityName: 'test', addedTags: [] }),
  } as unknown as EntityManager;
}

describe('ObserverPipeline', () => {
  let pipeline: ObserverPipeline;
  let entityManager: EntityManager;

  beforeEach(() => {
    entityManager = createMockEntityManager();
    pipeline = new ObserverPipeline(entityManager);
  });

  // ==================== scoreObservation ====================

  describe('scoreObservation', () => {
    it('should return a valid score between 0 and 1', () => {
      const result = pipeline.scoreObservation(
        'Alice works at Google as a software engineer',
        'Alice'
      );

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.observation).toBe('Alice works at Google as a software engineer');
      expect(result.entityName).toBe('Alice');
    });

    it('should score longer observations higher than short ones', () => {
      const short = pipeline.scoreObservation('hi', 'Test');
      const long = pipeline.scoreObservation(
        'Alice works at Google as a software engineer and lives in Seattle, Washington',
        'Test'
      );

      expect(long.score).toBeGreaterThan(short.score);
    });

    it('should score observations with capitalized words (named entities) higher', () => {
      const withNames = pipeline.scoreObservation(
        'Met with Alice and Bob at Google headquarters',
        'Test'
      );
      const withoutNames = pipeline.scoreObservation(
        'met with someone at some place in the area',
        'Test'
      );

      expect(withNames.score).toBeGreaterThan(withoutNames.score);
    });

    it('should score observations with numbers higher', () => {
      const withNumbers = pipeline.scoreObservation(
        'Project has 42 contributors and 1500 stars',
        'Test'
      );
      const withoutNumbers = pipeline.scoreObservation(
        'project has many contributors and stars',
        'Test'
      );

      expect(withNumbers.score).toBeGreaterThan(withoutNumbers.score);
    });

    it('should score observations with dates higher', () => {
      const withDate = pipeline.scoreObservation(
        'Meeting scheduled for 2024-01-15 at the office',
        'Test'
      );
      const withoutDate = pipeline.scoreObservation(
        'meeting scheduled for sometime at the office',
        'Test'
      );

      expect(withDate.score).toBeGreaterThan(withoutDate.score);
    });

    it('should detect category and include it in the result', () => {
      const task = pipeline.scoreObservation(
        'TODO: fix the login page styling issue',
        'Project'
      );
      expect(task.category).toBe('task');

      const decision = pipeline.scoreObservation(
        'Team decided to use React for the frontend',
        'Project'
      );
      expect(decision.category).toBe('decision');
    });

    it('should suggest tags based on detected category', () => {
      const task = pipeline.scoreObservation(
        'TODO: update the documentation for the API',
        'Project'
      );
      expect(task.suggestedTags).toContain('actionable');

      const problem = pipeline.scoreObservation(
        'The payment system has a critical bug that crashes',
        'Project'
      );
      expect(problem.suggestedTags).toContain('issue');
    });

    it('should not include suggestedTags when no category is detected', () => {
      const result = pipeline.scoreObservation('hello world', 'Test');
      expect(result.suggestedTags).toBeUndefined();
    });

    it('should not include suggestedType when autoRoute is disabled (default)', () => {
      const result = pipeline.scoreObservation(
        'TODO: fix the login page',
        'Project'
      );
      expect(result.suggestedType).toBeUndefined();
    });

    it('should include suggestedType when autoRoute is enabled', () => {
      const routingPipeline = new ObserverPipeline(
        entityManager,
        { autoRoute: true }
      );

      const result = routingPipeline.scoreObservation(
        'TODO: fix the login page styling issue here',
        'Project'
      );
      expect(result.suggestedType).toBe('task');
    });
  });

  // ==================== categorize ====================

  describe('categorize', () => {
    it('should categorize task-related observations', () => {
      expect(pipeline.categorize('TODO: fix the bug')).toBe('task');
      expect(pipeline.categorize('We need to update the docs')).toBe('task');
      expect(pipeline.categorize('FIXME: broken test')).toBe('task');
    });

    it('should categorize decision-related observations', () => {
      expect(pipeline.categorize('Team decided to use TypeScript')).toBe('decision');
      expect(pipeline.categorize('We agreed on the new API design')).toBe('decision');
      expect(pipeline.categorize('Going with the monorepo approach')).toBe('decision');
    });

    it('should categorize fact-related observations', () => {
      expect(pipeline.categorize('Alice is a software engineer')).toBe('fact');
      expect(pipeline.categorize('Bob works at Microsoft')).toBe('fact');
      expect(pipeline.categorize('The server is located in US-East')).toBe('fact');
    });

    it('should categorize preference-related observations', () => {
      expect(pipeline.categorize('User prefers dark mode')).toBe('preference');
      expect(pipeline.categorize('She likes Italian food')).toBe('preference');
      expect(pipeline.categorize('He dislikes spicy food')).toBe('preference');
    });

    it('should categorize problem-related observations', () => {
      expect(pipeline.categorize('Found a bug in the payment flow')).toBe('problem');
      expect(pipeline.categorize('Login page crashes on mobile')).toBe('problem');
      expect(pipeline.categorize('The API returns error 500')).toBe('problem');
    });

    it('should categorize learning-related observations', () => {
      expect(pipeline.categorize('I learned that Node 20 supports fetch natively')).toBe('learning');
      expect(pipeline.categorize('TIL about TypeScript decorators')).toBe('learning');
      expect(pipeline.categorize('We realized the cache was stale')).toBe('learning');
    });

    it('should return undefined for uncategorizable text', () => {
      expect(pipeline.categorize('hello world')).toBeUndefined();
      expect(pipeline.categorize('some random text')).toBeUndefined();
    });

    it('should use custom category patterns when provided', () => {
      const customPipeline = new ObserverPipeline(
        entityManager,
        {
          categoryPatterns: {
            'urgent': /\b(?:URGENT|ASAP|critical|emergency)\b/i,
          },
        }
      );

      expect(customPipeline.categorize('URGENT: deploy fix now')).toBe('urgent');
      // Default patterns should not be active
      expect(customPipeline.categorize('TODO: fix the bug')).toBeUndefined();
    });
  });

  // ==================== processBatch ====================

  describe('processBatch', () => {
    it('should score all observations and filter by threshold', () => {
      const results = pipeline.processBatch([
        {
          entityName: 'Project',
          contents: [
            'TODO: fix the critical bug in the payment processing system immediately',
            'x',  // Very short, should be dropped
          ],
        },
      ]);

      // The longer task observation should pass, the short one likely won't
      const longResult = results.find(r => r.observation.includes('TODO'));
      expect(longResult).toBeDefined();

      // Short observation 'x' should be filtered out
      const shortResult = results.find(r => r.observation === 'x');
      expect(shortResult).toBeUndefined();
    });

    it('should process multiple entities in a single batch', () => {
      const results = pipeline.processBatch([
        {
          entityName: 'Alice',
          contents: ['Alice is a software engineer who works at Google in Seattle'],
        },
        {
          entityName: 'Bob',
          contents: ['Bob decided to use TypeScript for the new project architecture'],
        },
      ]);

      expect(results.length).toBe(2);
      expect(results[0].entityName).toBe('Alice');
      expect(results[1].entityName).toBe('Bob');
    });

    it('should update stats during batch processing', () => {
      pipeline.processBatch([
        {
          entityName: 'Test',
          contents: [
            'TODO: fix the critical authentication bug in production server',
            'x',  // Will be dropped
          ],
        },
      ]);

      const stats = pipeline.getStats();
      expect(stats.processed).toBe(2);
      expect(stats.dropped).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array for empty input', () => {
      const results = pipeline.processBatch([]);
      expect(results).toEqual([]);
    });

    it('should respect custom threshold', () => {
      const strictPipeline = new ObserverPipeline(
        entityManager,
        { minImportanceThreshold: 0.9 }
      );

      const results = strictPipeline.processBatch([
        {
          entityName: 'Test',
          contents: ['A moderate length observation about something'],
        },
      ]);

      // With a very high threshold, most observations should be dropped
      expect(results.length).toBe(0);
    });
  });

  // ==================== attach/detach ====================

  describe('attach/detach', () => {
    it('should process observations when attached to emitter', () => {
      const emitter = new GraphEventEmitter();
      const scored: ObservationScore[] = [];

      pipeline.onScored((s) => scored.push(s));
      const detach = pipeline.attach(emitter);

      emitter.emitObservationAdded('Alice', [
        'Alice is a senior software engineer at Google who leads the platform team',
      ]);

      expect(scored.length).toBe(1);
      expect(scored[0].entityName).toBe('Alice');

      detach();
    });

    it('should stop processing after detach', () => {
      const emitter = new GraphEventEmitter();
      const scored: ObservationScore[] = [];

      pipeline.onScored((s) => scored.push(s));
      const detach = pipeline.attach(emitter);

      emitter.emitObservationAdded('Alice', [
        'Alice is a senior software engineer at Google who leads the platform team',
      ]);
      expect(scored.length).toBe(1);

      detach();

      emitter.emitObservationAdded('Bob', [
        'Bob is a senior software engineer at Microsoft who works on Azure platform',
      ]);
      // Should not receive any more events
      expect(scored.length).toBe(1);
    });

    it('should auto-tag entities when autoTag is enabled', async () => {
      const emitter = new GraphEventEmitter();
      pipeline.attach(emitter);

      emitter.emitObservationAdded('Project', [
        'TODO: fix the critical authentication bug in the production payment system',
      ]);

      // Give the async addTags call a tick to execute
      await vi.waitFor(() => {
        expect(entityManager.addTags).toHaveBeenCalledWith('Project', ['actionable']);
      });

      const stats = pipeline.getStats();
      expect(stats.tagged).toBeGreaterThanOrEqual(1);
    });

    it('should not auto-tag when autoTag is disabled', () => {
      const noTagPipeline = new ObserverPipeline(
        entityManager,
        { autoTag: false }
      );

      const emitter = new GraphEventEmitter();
      noTagPipeline.attach(emitter);

      emitter.emitObservationAdded('Project', [
        'TODO: fix the critical authentication bug in the production payment system',
      ]);

      expect(entityManager.addTags).not.toHaveBeenCalled();
    });

    it('should track routed observations when autoRoute is enabled', () => {
      const routingPipeline = new ObserverPipeline(
        entityManager,
        { autoRoute: true }
      );

      const emitter = new GraphEventEmitter();
      routingPipeline.attach(emitter);

      emitter.emitObservationAdded('Project', [
        'TODO: fix the critical authentication bug in the production payment system',
      ]);

      const stats = routingPipeline.getStats();
      expect(stats.routed).toBeGreaterThanOrEqual(1);
    });

    it('should drop observations below threshold and track stats', () => {
      const emitter = new GraphEventEmitter();
      const scored: ObservationScore[] = [];

      pipeline.onScored((s) => scored.push(s));
      pipeline.attach(emitter);

      emitter.emitObservationAdded('Test', ['x']);

      // Very short observation should be dropped
      expect(scored.length).toBe(0);
      const stats = pipeline.getStats();
      expect(stats.dropped).toBe(1);
      expect(stats.processed).toBe(1);
    });

    it('should handle listener errors gracefully', () => {
      const emitter = new GraphEventEmitter();

      // Add a listener that throws
      pipeline.onScored(() => {
        throw new Error('Listener error');
      });

      // Add a second listener that should still receive events
      const scored: ObservationScore[] = [];
      pipeline.onScored((s) => scored.push(s));

      pipeline.attach(emitter);

      // Should not throw
      expect(() => {
        emitter.emitObservationAdded('Alice', [
          'Alice is a senior software engineer at Google who leads the platform team',
        ]);
      }).not.toThrow();

      // Second listener should still receive the event
      expect(scored.length).toBe(1);
    });
  });

  // ==================== onScored ====================

  describe('onScored', () => {
    it('should register and call listeners', () => {
      const emitter = new GraphEventEmitter();
      const scored: ObservationScore[] = [];

      pipeline.onScored((s) => scored.push(s));
      pipeline.attach(emitter);

      emitter.emitObservationAdded('Test', [
        'This is a sufficiently long observation about something with Important Names',
      ]);

      expect(scored.length).toBe(1);
    });

    it('should support unsubscribe', () => {
      const emitter = new GraphEventEmitter();
      const scored: ObservationScore[] = [];

      const unsub = pipeline.onScored((s) => scored.push(s));
      pipeline.attach(emitter);

      emitter.emitObservationAdded('Test', [
        'Alice is a senior software engineer at Google who leads the platform team',
      ]);
      expect(scored.length).toBe(1);

      unsub();

      emitter.emitObservationAdded('Test', [
        'Bob is a senior software engineer at Microsoft who works on Azure platform',
      ]);
      expect(scored.length).toBe(1); // Should not increase
    });
  });

  // ==================== Stats ====================

  describe('stats', () => {
    it('should start with zero stats', () => {
      const stats = pipeline.getStats();
      expect(stats).toEqual({
        processed: 0,
        dropped: 0,
        tagged: 0,
        routed: 0,
      });
    });

    it('should track processing stats', () => {
      pipeline.processBatch([
        {
          entityName: 'Test',
          contents: [
            'TODO: fix the critical authentication bug in the production payment system',
            'x',
          ],
        },
      ]);

      const stats = pipeline.getStats();
      expect(stats.processed).toBe(2);
    });

    it('should reset stats', () => {
      pipeline.processBatch([
        {
          entityName: 'Test',
          contents: ['TODO: update all the documentation files for the API reference'],
        },
      ]);

      pipeline.resetStats();
      const stats = pipeline.getStats();
      expect(stats).toEqual({
        processed: 0,
        dropped: 0,
        tagged: 0,
        routed: 0,
      });
    });

    it('should return a copy of stats (not a reference)', () => {
      const stats1 = pipeline.getStats();
      pipeline.processBatch([
        {
          entityName: 'Test',
          contents: ['TODO: fix the critical authentication bug in the production system'],
        },
      ]);
      const stats2 = pipeline.getStats();

      // stats1 should not have changed
      expect(stats1.processed).toBe(0);
      expect(stats2.processed).toBe(1);
    });
  });

  // ==================== Default Options ====================

  describe('default options', () => {
    it('should use default threshold of 0.3', () => {
      // A very short observation should be dropped with default threshold
      const results = pipeline.processBatch([
        { entityName: 'Test', contents: ['hi'] },
      ]);
      expect(results.length).toBe(0);
    });

    it('should have autoTag enabled by default', () => {
      const emitter = new GraphEventEmitter();
      pipeline.attach(emitter);

      emitter.emitObservationAdded('Project', [
        'TODO: fix the critical authentication bug in the production payment system',
      ]);

      // Should have called addTags because autoTag defaults to true
      expect(entityManager.addTags).toHaveBeenCalled();
    });

    it('should have autoRoute disabled by default', () => {
      const result = pipeline.scoreObservation(
        'TODO: fix the critical authentication bug in the production system',
        'Project'
      );
      expect(result.suggestedType).toBeUndefined();
    });
  });
});
