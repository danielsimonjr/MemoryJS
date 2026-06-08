import { describe, it, expect, beforeEach } from 'vitest';
import { QueryPlanner } from '../../../src/search/QueryPlanner.js';
import type { QueryAnalysis } from '../../../src/types/index.js';
describe('QueryPlanner', () => {
  let planner: QueryPlanner;
  beforeEach(() => {
    planner = new QueryPlanner();
  });
  const createMockAnalysis = (overrides: Partial<QueryAnalysis> = {}): QueryAnalysis => ({
    query: 'Default query',
    entities: [],
    persons: [],
    locations: [],
    organizations: [],
    temporalRange: null,
    questionType: 'factual',
    complexity: 'medium',
    confidence: 0.8,
    requiredInfoTypes: [],
    ...overrides,
  });
  describe('plan creation', () => {
    it('should create plan from analysis', () => {
      const analysis = createMockAnalysis();
      const query = 'Find projects by Alice';
      const plan = planner.createPlan(query, analysis);
      expect(plan.originalQuery).toBe(query);
      expect(plan.subQueries.length).toBeGreaterThan(0);
      expect(plan.executionStrategy).toBeDefined();
      expect(plan.mergeStrategy).toBeDefined();
    });
    it('should set correct original query', () => {
      const query = 'What are the active projects?';
      const analysis = createMockAnalysis();
      const plan = planner.createPlan(query, analysis);
      expect(plan.originalQuery).toBe(query);
    });
  });
  describe('sub-query creation', () => {
    it('should create single sub-query for simple queries', () => {
      const analysis = createMockAnalysis({ subQueries: undefined });
      const plan = planner.createPlan('Find Alice', analysis);
      expect(plan.subQueries.length).toBe(1);
      expect(plan.subQueries[0].query).toBe('Find Alice');
      expect(plan.subQueries[0].priority).toBe(1);
    });
    it('should create multiple sub-queries when decomposed', () => {
      const analysis = createMockAnalysis({
        subQueries: ['Find Alice', 'show her projects'],
      });
      const plan = planner.createPlan('Find Alice and then show her projects', analysis);
      expect(plan.subQueries.length).toBe(2);
      expect(plan.subQueries[0].query).toBe('Find Alice');
      expect(plan.subQueries[1].query).toBe('show her projects');
      expect(plan.subQueries[0].priority).toBe(1);
      expect(plan.subQueries[1].priority).toBe(2);
    });
    it('should set dependencies for sequential sub-queries', () => {
      const analysis = createMockAnalysis({
        subQueries: ['Find Alice', 'show projects'],
      });
      const plan = planner.createPlan('Find Alice and then show projects', analysis);
      expect(plan.subQueries.length).toBe(2);
      expect(plan.subQueries[0].dependsOn).toBeUndefined();
      expect(plan.subQueries[1].dependsOn).toBeDefined();
      expect(plan.subQueries[1].dependsOn).toContain(plan.subQueries[0].id);
    });
  });
  describe('execution strategy', () => {
    it('should select iterative for single queries', () => {
      const analysis = createMockAnalysis();
      const plan = planner.createPlan('Find Alice', analysis);
      expect(plan.executionStrategy).toBe('iterative');
    });
    it('should select sequential for queries with dependencies', () => {
      const analysis = createMockAnalysis({
        subQueries: ['Find Alice', 'show her projects'],
      });
      const plan = planner.createPlan('Find Alice and then show her projects', analysis);
      expect(plan.executionStrategy).toBe('sequential');
    });
    it('should select sequential for multiple subqueries', () => {
      const analysis = createMockAnalysis({
        subQueries: ['Query 1', 'Query 2'],
      });
      const plan = planner.createPlan('Multi query', analysis);
      expect(plan.executionStrategy).toBe('sequential');
    });
  });
  describe('merge strategy', () => {
    it('should select weighted for factual queries', () => {
      const analysis = createMockAnalysis({ questionType: 'factual' });
      const plan = planner.createPlan('What is the project status?', analysis);
      expect(plan.mergeStrategy).toBe('weighted');
    });
    it('should select union for aggregation queries', () => {
      const analysis = createMockAnalysis({ questionType: 'aggregation' });
      const plan = planner.createPlan('How many projects are there?', analysis);
      expect(plan.mergeStrategy).toBe('union');
    });
    it('should select intersection for comparative queries', () => {
      const analysis = createMockAnalysis({ questionType: 'comparative' });
      const plan = planner.createPlan('Compare Alice and Bob', analysis);
      expect(plan.mergeStrategy).toBe('intersection');
    });
  });
  describe('layer selection', () => {
    it('should select symbolic for temporal queries', () => {
      const analysis = createMockAnalysis({
        temporalRange: { start: '2024-01-01', end: '2024-12-31' },
      });
      const plan = planner.createPlan('What happened last month?', analysis);
      expect(plan.subQueries[0].targetLayer).toBe('symbolic');
    });
    it('should select symbolic if requiredInfoTypes includes temporal', () => {
      const analysis = createMockAnalysis({
        requiredInfoTypes: ['temporal'],
      });
      const plan = planner.createPlan('When did it happen?', analysis);
      expect(plan.subQueries[0].targetLayer).toBe('symbolic');
    });
    it('should select semantic for complex queries', () => {
      const analysis = createMockAnalysis({ complexity: 'high' });
      const plan = planner.createPlan('Complex query', analysis);
      expect(plan.subQueries[0].targetLayer).toBe('semantic');
    });
    it('should select semantic for comparative queries', () => {
      const analysis = createMockAnalysis({ questionType: 'comparative' });
      const plan = planner.createPlan('Compare A and B', analysis);
      expect(plan.subQueries[0].targetLayer).toBe('semantic');
    });
    it('should select hybrid for balanced queries (default)', () => {
      const analysis = createMockAnalysis({
        complexity: 'medium',
        questionType: 'factual',
        temporalRange: null,
        requiredInfoTypes: [],
      });
      const plan = planner.createPlan('Find projects', analysis);
      expect(plan.subQueries[0].targetLayer).toBe('hybrid');
    });
  });
  describe('complexity calculation', () => {
    it('should calculate complexity based on sub-queries', () => {
      const simpleAnalysis = createMockAnalysis();
      const simplePlan = planner.createPlan('Find Alice', simpleAnalysis);
      const complexAnalysis = createMockAnalysis({
        subQueries: ['Find Alice', 'show projects', 'and tasks'],
      });
      const complexPlan = planner.createPlan('Find Alice and then show projects and tasks', complexAnalysis);
      expect(simplePlan.estimatedComplexity).toBeLessThanOrEqual(complexPlan.estimatedComplexity);
      expect(simplePlan.estimatedComplexity).toBe(1); // 1 query + 0 dependsOn + 0 filters
    });
    it('should add to complexity for dependsOn and filters', () => {
      const complexAnalysis = createMockAnalysis({
        subQueries: ['Find Alice', 'show projects'],
      });
      const plan = planner.createPlan('Find Alice and then show projects', complexAnalysis);
      // 2 subqueries = 2
      // 1 has dependsOn (length 1 * 0.5) = 0.5
      expect(plan.estimatedComplexity).toBe(2.5);
    });
    it('should cap complexity at 10', () => {
      // 15 subqueries, each starting from 2nd has 1 dependency
      const subQueries = Array.from({ length: 15 }, (_, i) => `Query ${i}`);
      const analysis = createMockAnalysis({ subQueries });
      const plan = planner.createPlan('...', analysis);
      expect(plan.estimatedComplexity).toBe(10);
    });
  });
  describe('filters', () => {
    it('should include date range filter for temporal queries', () => {
      const analysis = createMockAnalysis({
        temporalRange: { start: '2024-01-01', end: '2024-12-31' },
      });
      const plan = planner.createPlan('Find events from 2024-01-01 to 2024-12-31', analysis);
      expect(plan.subQueries[0].filters?.dateRange).toBeDefined();
      expect(plan.subQueries[0].filters?.dateRange?.start).toBe('2024-01-01');
      expect(plan.subQueries[0].filters?.dateRange?.end).toBe('2024-12-31');
    });
    it('should fall back to empty string if temporalRange start/end are undefined', () => {
      const analysis = createMockAnalysis({
        // @ts-expect-error Intentionally invalid input for test
        temporalRange: { start: undefined, end: undefined },
      });
      const plan = planner.createPlan('Find events', analysis);
      expect(plan.subQueries[0].filters?.dateRange?.start).toBe('');
      expect(plan.subQueries[0].filters?.dateRange?.end).toBe('');
    });
    it('should not include filters for non-temporal queries', () => {
      const analysis = createMockAnalysis();
      const plan = planner.createPlan('Find all projects', analysis);
      expect(plan.subQueries[0].filters).toBeUndefined();
    });
  });
});
