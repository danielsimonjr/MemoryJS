/**
 * RuleEvaluator Unit Tests
 *
 * Tests for consolidation rule condition evaluation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEvaluator } from '../../../src/agent/RuleEvaluator.js';
import type { AgentEntity, RuleConditions } from '../../../src/types/agent-memory.js';

/**
 * Create a test agent entity.
 */
function createTestEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
    ...overrides,
  };
}

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator;

  beforeEach(() => {
    evaluator = new RuleEvaluator();
  });

  describe('evaluate', () => {
    it('should return true for empty conditions', () => {
      const entity = createTestEntity();
      const result = evaluator.evaluate(entity, {});
      expect(result.passed).toBe(true);
      expect(Object.keys(result.details)).toHaveLength(0);
    });

    it('should evaluate minConfidence condition', () => {
      const entity = createTestEntity({ confidence: 0.8 });

      const passResult = evaluator.evaluate(entity, { minConfidence: 0.7 });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.minConfidence).toBe(true);

      const failResult = evaluator.evaluate(entity, { minConfidence: 0.9 });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.minConfidence).toBe(false);
    });

    it('should evaluate minConfirmations condition', () => {
      const entity = createTestEntity({ confirmationCount: 3 });

      const passResult = evaluator.evaluate(entity, { minConfirmations: 2 });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.minConfirmations).toBe(true);

      const failResult = evaluator.evaluate(entity, { minConfirmations: 5 });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.minConfirmations).toBe(false);
    });

    it('should evaluate minAccessCount condition', () => {
      const entity = createTestEntity({ accessCount: 10 });

      const passResult = evaluator.evaluate(entity, { minAccessCount: 5 });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.minAccessCount).toBe(true);

      const failResult = evaluator.evaluate(entity, { minAccessCount: 15 });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.minAccessCount).toBe(false);
    });

    it('should evaluate memoryType condition', () => {
      const entity = createTestEntity({ memoryType: 'working' });

      const passResult = evaluator.evaluate(entity, { memoryType: 'working' });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.memoryType).toBe(true);

      const failResult = evaluator.evaluate(entity, { memoryType: 'episodic' });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.memoryType).toBe(false);
    });

    it('should evaluate entityType condition', () => {
      const entity = createTestEntity({ entityType: 'preference' });

      const passResult = evaluator.evaluate(entity, { entityType: 'preference' });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.entityType).toBe(true);

      const failResult = evaluator.evaluate(entity, { entityType: 'event' });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.entityType).toBe(false);
    });

    it('should evaluate minAgeHours condition', () => {
      const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({ createdAt: hourAgo });

      const passResult = evaluator.evaluate(entity, { minAgeHours: 1 });
      expect(passResult.passed).toBe(true);
      expect(passResult.details.minAgeHours).toBe(true);

      const failResult = evaluator.evaluate(entity, { minAgeHours: 5 });
      expect(failResult.passed).toBe(false);
      expect(failResult.details.minAgeHours).toBe(false);
    });

    it('should use AND logic by default', () => {
      const entity = createTestEntity({ confidence: 0.8, confirmationCount: 3 });

      // Both conditions pass
      const allPass = evaluator.evaluate(entity, {
        minConfidence: 0.7,
        minConfirmations: 2,
      });
      expect(allPass.passed).toBe(true);

      // One condition fails
      const oneFails = evaluator.evaluate(entity, {
        minConfidence: 0.9, // Fails
        minConfirmations: 2, // Passes
      });
      expect(oneFails.passed).toBe(false);
    });

    it('should use OR logic when useAnd is false', () => {
      const entity = createTestEntity({ confidence: 0.8, confirmationCount: 3 });

      // One condition passes, one fails
      const result = evaluator.evaluate(entity, {
        minConfidence: 0.9, // Fails
        minConfirmations: 2, // Passes
        useAnd: false,
      });
      expect(result.passed).toBe(true);

      // Both fail
      const allFail = evaluator.evaluate(entity, {
        minConfidence: 0.95,
        minConfirmations: 10,
        useAnd: false,
      });
      expect(allFail.passed).toBe(false);
    });

    it('should handle missing fields gracefully', () => {
      const entity = createTestEntity({
        confidence: undefined,
        confirmationCount: undefined,
        accessCount: undefined,
      });

      const result = evaluator.evaluate(entity, {
        minConfidence: 0.5,
        minConfirmations: 1,
        minAccessCount: 1,
      });

      // All should fail because undefined defaults to 0
      expect(result.passed).toBe(false);
      expect(result.details.minConfidence).toBe(false);
      expect(result.details.minConfirmations).toBe(false);
      expect(result.details.minAccessCount).toBe(false);
    });

    it('should cache evaluation results', () => {
      const entity = createTestEntity();
      const conditions: RuleConditions = { minConfidence: 0.5 };

      // First evaluation
      const result1 = evaluator.evaluate(entity, conditions);

      // Second evaluation (should use cache)
      const result2 = evaluator.evaluate(entity, conditions);

      expect(result1).toEqual(result2);
      expect(evaluator.getCacheSize()).toBe(1);
    });

    it('should invalidate cache when entity changes', () => {
      const entity1 = createTestEntity({ lastModified: '2024-01-01T00:00:00Z' });
      const entity2 = createTestEntity({ lastModified: '2024-01-02T00:00:00Z' });
      const conditions: RuleConditions = { minConfidence: 0.5 };

      evaluator.evaluate(entity1, conditions);
      evaluator.evaluate(entity2, conditions);

      // Different lastModified = different cache entries
      expect(evaluator.getCacheSize()).toBe(2);
    });

    it('should evaluate all conditions together', () => {
      const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({
        confidence: 0.9,
        confirmationCount: 5,
        accessCount: 20,
        memoryType: 'working',
        entityType: 'preference',
        createdAt: hourAgo,
      });

      const result = evaluator.evaluate(entity, {
        minConfidence: 0.8,
        minConfirmations: 3,
        minAccessCount: 10,
        memoryType: 'working',
        entityType: 'preference',
        minAgeHours: 1,
      });

      expect(result.passed).toBe(true);
      expect(Object.keys(result.details)).toHaveLength(6);
      expect(Object.values(result.details).every((v) => v === true)).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached evaluations', () => {
      const entity = createTestEntity();
      evaluator.evaluate(entity, { minConfidence: 0.5 });
      expect(evaluator.getCacheSize()).toBeGreaterThan(0);

      evaluator.clearCache();
      expect(evaluator.getCacheSize()).toBe(0);
    });
  });

  describe('getCacheSize', () => {
    it('should return current cache size', () => {
      expect(evaluator.getCacheSize()).toBe(0);

      const entity = createTestEntity();
      evaluator.evaluate(entity, { minConfidence: 0.5 });
      expect(evaluator.getCacheSize()).toBe(1);

      evaluator.evaluate(entity, { minConfidence: 0.7 });
      expect(evaluator.getCacheSize()).toBe(2);
    });
  });
});
