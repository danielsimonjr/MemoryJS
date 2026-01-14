/**
 * Rule Evaluator
 *
 * Evaluates consolidation rule conditions against entities.
 * Supports AND/OR logic and caches evaluation results for performance.
 *
 * @module agent/RuleEvaluator
 */

import type {
  AgentEntity,
  RuleConditions,
  RuleEvaluationResult,
} from '../types/agent-memory.js';

/**
 * Evaluates rule conditions against entities.
 *
 * @example
 * ```typescript
 * const evaluator = new RuleEvaluator();
 * const result = evaluator.evaluate(entity, {
 *   minConfidence: 0.8,
 *   minConfirmations: 2,
 *   memoryType: 'working',
 * });
 * console.log(`Passed: ${result.passed}`);
 * ```
 */
export class RuleEvaluator {
  private cache = new Map<string, RuleEvaluationResult>();

  /**
   * Evaluate conditions against an entity.
   *
   * @param entity - Entity to evaluate
   * @param conditions - Conditions to check
   * @returns Evaluation result with details
   */
  evaluate(entity: AgentEntity, conditions: RuleConditions): RuleEvaluationResult {
    const cacheKey = `${entity.name}:${entity.lastModified}:${JSON.stringify(conditions)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const details: Record<string, boolean> = {};
    const useAnd = conditions.useAnd !== false;

    // Check each condition
    if (conditions.minConfidence !== undefined) {
      details.minConfidence = (entity.confidence ?? 0) >= conditions.minConfidence;
    }

    if (conditions.minConfirmations !== undefined) {
      details.minConfirmations =
        (entity.confirmationCount ?? 0) >= conditions.minConfirmations;
    }

    if (conditions.minAccessCount !== undefined) {
      details.minAccessCount = (entity.accessCount ?? 0) >= conditions.minAccessCount;
    }

    if (conditions.memoryType !== undefined) {
      details.memoryType = entity.memoryType === conditions.memoryType;
    }

    if (conditions.entityType !== undefined) {
      details.entityType = entity.entityType === conditions.entityType;
    }

    if (conditions.minAgeHours !== undefined) {
      const ageHours = this.calculateAgeHours(entity);
      details.minAgeHours = ageHours >= conditions.minAgeHours;
    }

    // Combine results based on AND/OR logic
    const values = Object.values(details);
    const passed =
      values.length === 0
        ? true
        : useAnd
          ? values.every((v) => v)
          : values.some((v) => v);

    const result: RuleEvaluationResult = { passed, details };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Calculate entity age in hours.
   *
   * @param entity - Entity to calculate age for
   * @returns Age in hours
   */
  private calculateAgeHours(entity: AgentEntity): number {
    const created = entity.createdAt
      ? new Date(entity.createdAt).getTime()
      : Date.now();
    return (Date.now() - created) / (1000 * 60 * 60);
  }

  /**
   * Clear the evaluation cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size for monitoring.
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
