/**
 * Query Planner - generates execution plans for queries based on analysis.
 * @module search/QueryPlanner
 */

import type { QueryAnalysis, QueryPlan, SubQuery, SymbolicFilters } from '../types/index.js';

/** Generates execution plans from query analysis, selecting layers and strategies. */
export class QueryPlanner {
  /** Create an execution plan from query analysis. */
  createPlan(query: string, analysis: QueryAnalysis): QueryPlan {
    const subQueries = this.createSubQueries(query, analysis);
    const executionStrategy = this.selectExecutionStrategy(subQueries);
    const mergeStrategy = this.selectMergeStrategy(analysis);

    return {
      originalQuery: query,
      subQueries,
      executionStrategy,
      mergeStrategy,
      estimatedComplexity: this.calculateComplexity(subQueries),
    };
  }

  /**
   * Create sub-queries from analysis.
   */
  private createSubQueries(query: string, analysis: QueryAnalysis): SubQuery[] {
    const subQueries: SubQuery[] = [];
    let id = 0;

    // If query was decomposed, create sub-query for each part
    if (analysis.subQueries && analysis.subQueries.length > 1) {
      for (const sq of analysis.subQueries) {
        subQueries.push({
          id: `sq_${id++}`,
          query: sq,
          targetLayer: this.selectLayer(analysis),
          priority: id === 1 ? 1 : 2,
          dependsOn: id > 1 ? [`sq_${id - 2}`] : undefined,
        });
      }
    } else {
      // Single query
      subQueries.push({
        id: `sq_${id}`,
        query,
        targetLayer: this.selectLayer(analysis),
        priority: 1,
        filters: this.buildFilters(analysis),
      });
    }

    return subQueries;
  }

  /**
   * Select the most appropriate search layer.
   */
  private selectLayer(analysis: QueryAnalysis): SubQuery['targetLayer'] {
    // Use symbolic for tag/type/date filtered queries
    if (analysis.temporalRange || analysis.requiredInfoTypes.includes('temporal')) {
      return 'symbolic';
    }
    // Use semantic for complex concept queries
    if (analysis.complexity === 'high' || analysis.questionType === 'comparative') {
      return 'semantic';
    }
    // Use hybrid for balanced approach
    return 'hybrid';
  }

  /**
   * Select execution strategy based on sub-queries.
   */
  private selectExecutionStrategy(subQueries: SubQuery[]): QueryPlan['executionStrategy'] {
    const hasDependencies = subQueries.some(sq => sq.dependsOn && sq.dependsOn.length > 0);
    if (hasDependencies) return 'sequential';
    if (subQueries.length > 1) return 'parallel';
    return 'iterative';
  }

  /**
   * Select merge strategy based on question type.
   */
  private selectMergeStrategy(analysis: QueryAnalysis): QueryPlan['mergeStrategy'] {
    switch (analysis.questionType) {
      case 'aggregation': return 'union';
      case 'comparative': return 'intersection';
      default: return 'weighted';
    }
  }

  /**
   * Build symbolic filters from analysis.
   */
  private buildFilters(analysis: QueryAnalysis): SymbolicFilters | undefined {
    const filters: SymbolicFilters = {};
    let hasFilters = false;

    if (analysis.temporalRange) {
      filters.dateRange = {
        start: analysis.temporalRange.start || '',
        end: analysis.temporalRange.end || '',
      };
      hasFilters = true;
    }

    return hasFilters ? filters : undefined;
  }

  /**
   * Calculate plan complexity score.
   */
  private calculateComplexity(subQueries: SubQuery[]): number {
    let complexity = subQueries.length;
    for (const sq of subQueries) {
      if (sq.dependsOn) complexity += sq.dependsOn.length * 0.5;
      if (sq.filters) complexity += 0.5;
    }
    return Math.min(complexity, 10);
  }
}
