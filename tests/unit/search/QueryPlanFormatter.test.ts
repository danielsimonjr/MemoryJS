import { describe, it, expect } from 'vitest';
import { formatQueryPlanAscii } from '../../../src/search/QueryPlanFormatter.js';
import type { QueryPlan } from '../../../src/types/types.js';

describe('QueryPlanFormatter', () => {
  it('should format a simple query plan without sub-queries', () => {
    const plan: QueryPlan = {
      originalQuery: 'test query',
      subQueries: [],
      executionStrategy: 'sequential',
      mergeStrategy: 'union',
      estimatedComplexity: 1.5,
    };

    const output = formatQueryPlanAscii(plan);
    expect(output).toContain('QueryPlan: test query');
    expect(output).toContain('├─ Strategy:             sequential');
    expect(output).toContain('├─ Merge:                union');
    expect(output).toContain('├─ Estimated complexity: 1.50');
    expect(output).toContain('└─ SubQueries: (none)');
  });

  it('should format a query plan with sub-queries', () => {
    const plan: QueryPlan = {
      originalQuery: 'complex query',
      subQueries: [
        {
          id: 'sq1',
          query: 'first part',
          targetLayer: 'semantic',
          priority: 1,
        },
        {
          id: 'sq2',
          query: 'second part',
          targetLayer: 'lexical',
          priority: 2,
        },
      ],
      executionStrategy: 'parallel',
      mergeStrategy: 'intersection',
      estimatedComplexity: 2.75,
    };

    const output = formatQueryPlanAscii(plan);

    // Check main branch
    expect(output).toContain('QueryPlan: complex query');
    expect(output).toContain('└─ SubQueries (2):');

    // Check first subquery formatting (branch)
    expect(output).toContain('   ├─ [sq1] semantic | priority 1');
    expect(output).toContain('   │  query: first part');

    // Check second subquery formatting (leaf)
    expect(output).toContain('   └─ [sq2] lexical  | priority 2');
    expect(output).toContain('      query: second part');
  });

  it('should format sub-queries with dependencies and filters', () => {
    const plan: QueryPlan = {
      originalQuery: 'filtered query',
      subQueries: [
        {
          id: 'sq1',
          query: 'test dependencies',
          targetLayer: 'semantic',
          priority: 1,
          dependsOn: ['sq0'],
          filters: { type: 'test' }
        }
      ],
      executionStrategy: 'sequential',
      mergeStrategy: 'union',
      estimatedComplexity: 1.0,
    };

    const output = formatQueryPlanAscii(plan);

    expect(output).toContain('   └─ [sq1] semantic | priority 1');
    expect(output).toContain('      query: test dependencies');
    expect(output).toContain('      depends-on: sq0');
    expect(output).toContain('      filters: type');
  });

  it('should truncate long queries', () => {
    const longQuery = 'A'.repeat(100);
    const longSubQuery = 'B'.repeat(100);

    const plan: QueryPlan = {
      originalQuery: longQuery,
      subQueries: [
        {
          id: 'sq1',
          query: longSubQuery,
          targetLayer: 'semantic',
          priority: 1,
        }
      ],
      executionStrategy: 'sequential',
      mergeStrategy: 'union',
      estimatedComplexity: 1.0,
    };

    const output = formatQueryPlanAscii(plan);

    // 80 char limit for original query (79 chars + ellipsis)
    const expectedOriginal = 'A'.repeat(79) + '…';
    expect(output).toContain(`QueryPlan: ${expectedOriginal}`);

    // 70 char limit for sub query (69 chars + ellipsis)
    const expectedSubQuery = 'B'.repeat(69) + '…';
    expect(output).toContain(`      query: ${expectedSubQuery}`);
  });

  it('should normalise whitespace in original query', () => {
    const plan: QueryPlan = {
      originalQuery: '  test \n\t query  with   spaces  ',
      subQueries: [],
      executionStrategy: 'sequential',
      mergeStrategy: 'union',
      estimatedComplexity: 1.0,
    };

    const output = formatQueryPlanAscii(plan);
    expect(output).toContain('QueryPlan: test query with spaces');
  });
});
