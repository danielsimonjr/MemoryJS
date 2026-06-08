import { describe, it, expect } from 'vitest';
import { formatQueryPlanAscii } from '../../../src/search/QueryPlanFormatter.js';
import type { QueryPlan } from '../../../src/types/index.js';

describe('QueryPlanFormatter', () => {
  describe('formatQueryPlanAscii', () => {
    it('formats a basic query plan with one sub-query', () => {
      const plan: QueryPlan = {
        originalQuery: 'test query',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.5,
        subQueries: [
          {
            id: 'q1',
            query: 'sub query 1',
            targetLayer: 'lexical',
            priority: 1,
          },
        ],
      };

      const output = formatQueryPlanAscii(plan);
      expect(output).toContain('QueryPlan: test query');
      expect(output).toContain('├─ Strategy:             parallel');
      expect(output).toContain('├─ Merge:                union');
      expect(output).toContain('├─ Estimated complexity: 1.50');
      expect(output).toContain('└─ SubQueries (1):');
      expect(output).toContain('   └─ [q1] lexical  | priority 1');
      expect(output).toContain('      query: sub query 1');
    });

    it('formats a plan with multiple sub-queries correctly using tree branches', () => {
      const plan: QueryPlan = {
        originalQuery: 'complex query',
        executionStrategy: 'sequential',
        mergeStrategy: 'weighted',
        estimatedComplexity: 2.75,
        subQueries: [
          {
            id: 'q1',
            query: 'first sub query',
            targetLayer: 'semantic',
            priority: 1,
          },
          {
            id: 'q2',
            query: 'second sub query',
            targetLayer: 'symbolic',
            priority: 2,
            dependsOn: ['q1'],
          },
        ],
      };

      const output = formatQueryPlanAscii(plan);
      expect(output).toContain('└─ SubQueries (2):');
      // First sub-query should have ├─
      expect(output).toContain('   ├─ [q1] semantic | priority 1');
      expect(output).toContain('   │  query: first sub query');
      // Last sub-query should have └─
      expect(output).toContain('   └─ [q2] symbolic | priority 2');
      expect(output).toContain('      query: second sub query');
      expect(output).toContain('      depends-on: q1');
    });

    it('handles plans with no sub-queries', () => {
      const plan: QueryPlan = {
        originalQuery: 'simple',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 0.5,
        subQueries: [],
      };

      const output = formatQueryPlanAscii(plan);
      expect(output).toContain('└─ SubQueries: (none)');
    });

    it('includes filters if present in sub-queries', () => {
      const plan: QueryPlan = {
        originalQuery: 'filtered query',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.0,
        subQueries: [
          {
            id: 'q1',
            query: 'query with filters',
            targetLayer: 'hybrid',
            priority: 1,
            filters: {
              tags: ['important'],
              entityTypes: ['person'],
            },
          },
        ],
      };

      const output = formatQueryPlanAscii(plan);
      expect(output).toContain('      filters: tags, entityTypes');
    });

    it('truncates long original query strings', () => {
      const longQuery = 'a'.repeat(100);
      const plan: QueryPlan = {
        originalQuery: longQuery,
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.0,
        subQueries: [],
      };

      const output = formatQueryPlanAscii(plan);
      // Max length for original query is 80
      expect(output).toContain('QueryPlan: ' + 'a'.repeat(79) + '…');
    });

    it('truncates long sub-query strings', () => {
      const longSubQuery = 'b'.repeat(100);
      const plan: QueryPlan = {
        originalQuery: 'test',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.0,
        subQueries: [
          {
            id: 'q1',
            query: longSubQuery,
            targetLayer: 'lexical',
            priority: 1,
          },
        ],
      };

      const output = formatQueryPlanAscii(plan);
      // Max length for sub-query is 70
      expect(output).toContain('query: ' + 'b'.repeat(69) + '…');
    });

    it('normalizes whitespace in the original query', () => {
      const plan: QueryPlan = {
        originalQuery: '  test  \n  query\twith\rwhitespace  ',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.0,
        subQueries: [],
      };

      const output = formatQueryPlanAscii(plan);
      expect(output).toContain('QueryPlan: test query with whitespace');
    });

    it('pads target layer name in sub-queries', () => {
      const plan: QueryPlan = {
        originalQuery: 'test',
        executionStrategy: 'parallel',
        mergeStrategy: 'union',
        estimatedComplexity: 1.0,
        subQueries: [
          {
            id: 'q1',
            query: 'q',
            targetLayer: 'a', // short layer name
            priority: 1,
          },
        ],
      };

      const output = formatQueryPlanAscii(plan);
      // padRight width is 8
      expect(output).toContain('[q1] a        | priority 1');
    });
  });
});
