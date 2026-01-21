/**
 * Tests for Search Types
 *
 * Tests the search type utilities defined in src/types/search.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QueryTraceBuilder,
  type QueryTrace,
  type QueryStage,
  type SearchExplanation,
  type ScoringSignal,
  type MatchedTerm,
  type ScoreBoost,
  type QueryLogEntry,
  type LogLevel,
  type QueryNode,
  type TermNode,
  type PhraseNode,
  type WildcardNode,
  type ProximityNode,
  type FieldNode,
  type BooleanOpNode,
} from '../../../src/types/search.js';

// ==================== QueryTraceBuilder Tests ====================

describe('QueryTraceBuilder', () => {
  let builder: QueryTraceBuilder;

  beforeEach(() => {
    builder = new QueryTraceBuilder('query-123', 'test search', 'basic');
  });

  describe('Constructor', () => {
    it('should initialize with query ID, text, and type', () => {
      const trace = builder.complete(0);

      expect(trace.queryId).toBe('query-123');
      expect(trace.queryText).toBe('test search');
      expect(trace.queryType).toBe('basic');
    });

    it('should set startTime on creation', () => {
      const trace = builder.complete(0);

      expect(trace.startTime).toBeDefined();
      expect(new Date(trace.startTime).toISOString()).toBe(trace.startTime);
    });

    it('should initialize empty stages array', () => {
      const trace = builder.complete(0);

      expect(trace.stages).toEqual([]);
    });
  });

  describe('startStage', () => {
    it('should return this for method chaining', () => {
      const result = builder.startStage('parsing');

      expect(result).toBe(builder);
    });
  });

  describe('endStage', () => {
    it('should record stage duration', () => {
      builder.startStage('parsing');
      builder.endStage('parsing');

      const trace = builder.complete(0);

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe('parsing');
      expect(trace.stages[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include metadata when provided', () => {
      builder.startStage('parsing');
      builder.endStage('parsing', { tokensFound: 5 });

      const trace = builder.complete(0);

      expect(trace.stages[0].metadata).toEqual({ tokensFound: 5 });
    });

    it('should return this for method chaining', () => {
      builder.startStage('parsing');
      const result = builder.endStage('parsing');

      expect(result).toBe(builder);
    });

    it('should not add stage if startStage was not called', () => {
      builder.endStage('parsing');

      const trace = builder.complete(0);

      expect(trace.stages).toHaveLength(0);
    });

    it('should clear stageStart after ending', () => {
      builder.startStage('parsing');
      builder.endStage('parsing');
      builder.endStage('parsing'); // Second call should do nothing

      const trace = builder.complete(0);

      expect(trace.stages).toHaveLength(1);
    });
  });

  describe('addStage', () => {
    it('should add a completed stage directly', () => {
      builder.addStage('indexLookup', 15);

      const trace = builder.complete(0);

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe('indexLookup');
      expect(trace.stages[0].durationMs).toBe(15);
    });

    it('should include metadata when provided', () => {
      builder.addStage('scoring', 25, { algorithm: 'bm25' });

      const trace = builder.complete(0);

      expect(trace.stages[0].metadata).toEqual({ algorithm: 'bm25' });
    });

    it('should return this for method chaining', () => {
      const result = builder.addStage('test', 10);

      expect(result).toBe(builder);
    });
  });

  describe('complete', () => {
    it('should set endTime', () => {
      const trace = builder.complete(10);

      expect(trace.endTime).toBeDefined();
      expect(new Date(trace.endTime).toISOString()).toBe(trace.endTime);
    });

    it('should calculate durationMs', () => {
      const trace = builder.complete(10);

      expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should set resultCount', () => {
      const trace = builder.complete(42);

      expect(trace.resultCount).toBe(42);
    });

    it('should include metadata when provided', () => {
      const trace = builder.complete(10, { cacheHit: true });

      expect(trace.metadata).toEqual({ cacheHit: true });
    });

    it('should return valid QueryTrace', () => {
      builder.addStage('parsing', 5);
      builder.addStage('indexLookup', 10);
      builder.addStage('scoring', 8);

      const trace = builder.complete(25);

      expect(trace.queryId).toBe('query-123');
      expect(trace.queryText).toBe('test search');
      expect(trace.queryType).toBe('basic');
      expect(trace.startTime).toBeDefined();
      expect(trace.endTime).toBeDefined();
      expect(trace.durationMs).toBeGreaterThanOrEqual(0);
      expect(trace.resultCount).toBe(25);
      expect(trace.stages).toHaveLength(3);
    });
  });

  describe('Method Chaining', () => {
    it('should support full method chain', () => {
      const trace = new QueryTraceBuilder('qid', 'query', 'hybrid')
        .startStage('parse')
        .endStage('parse')
        .addStage('filter', 5)
        .startStage('score')
        .endStage('score', { scoringMethod: 'bm25' })
        .complete(15, { hybrid: true });

      expect(trace.stages).toHaveLength(3);
      expect(trace.resultCount).toBe(15);
      expect(trace.metadata?.hybrid).toBe(true);
    });
  });

  describe('Different Query Types', () => {
    it('should handle fuzzy query type', () => {
      const builder = new QueryTraceBuilder('id', 'fuzzy query', 'fuzzy');
      const trace = builder.complete(5);

      expect(trace.queryType).toBe('fuzzy');
    });

    it('should handle boolean query type', () => {
      const builder = new QueryTraceBuilder('id', 'A AND B', 'boolean');
      const trace = builder.complete(3);

      expect(trace.queryType).toBe('boolean');
    });

    it('should handle ranked query type', () => {
      const builder = new QueryTraceBuilder('id', 'ranked search', 'ranked');
      const trace = builder.complete(10);

      expect(trace.queryType).toBe('ranked');
    });

    it('should handle bm25 query type', () => {
      const builder = new QueryTraceBuilder('id', 'bm25 search', 'bm25');
      const trace = builder.complete(8);

      expect(trace.queryType).toBe('bm25');
    });

    it('should handle semantic query type', () => {
      const builder = new QueryTraceBuilder('id', 'semantic search', 'semantic');
      const trace = builder.complete(5);

      expect(trace.queryType).toBe('semantic');
    });

    it('should handle hybrid query type', () => {
      const builder = new QueryTraceBuilder('id', 'hybrid search', 'hybrid');
      const trace = builder.complete(12);

      expect(trace.queryType).toBe('hybrid');
    });
  });
});

// ==================== Type Interface Tests ====================

describe('QueryLogEntry Interface', () => {
  it('should accept valid log entry', () => {
    const entry: QueryLogEntry = {
      timestamp: new Date().toISOString(),
      queryId: 'query-123',
      level: 'info',
      event: 'query_start',
    };

    expect(entry.timestamp).toBeDefined();
    expect(entry.queryId).toBe('query-123');
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('query_start');
  });

  it('should support all log levels', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

    for (const level of levels) {
      const entry: QueryLogEntry = {
        timestamp: new Date().toISOString(),
        queryId: 'q1',
        level,
        event: 'test',
      };
      expect(entry.level).toBe(level);
    }
  });

  it('should support optional fields', () => {
    const entry: QueryLogEntry = {
      timestamp: new Date().toISOString(),
      queryId: 'query-123',
      level: 'info',
      event: 'query_complete',
      queryText: 'search term',
      queryType: 'basic',
      duration: 150,
      resultCount: 10,
      metadata: { cached: true },
    };

    expect(entry.queryText).toBe('search term');
    expect(entry.queryType).toBe('basic');
    expect(entry.duration).toBe(150);
    expect(entry.resultCount).toBe(10);
    expect(entry.metadata?.cached).toBe(true);
  });
});

describe('SearchExplanation Interface', () => {
  it('should accept valid explanation', () => {
    const explanation: SearchExplanation = {
      entityName: 'test_entity',
      totalScore: 0.85,
      signals: [],
      matchedTerms: [],
      boosts: [],
      summary: 'Matched on name and observations',
    };

    expect(explanation.entityName).toBe('test_entity');
    expect(explanation.totalScore).toBe(0.85);
    expect(explanation.summary).toBe('Matched on name and observations');
  });

  it('should support scoring signals', () => {
    const signal: ScoringSignal = {
      name: 'tf-idf',
      value: 0.5,
      weight: 1.0,
      contribution: 0.5,
      percentage: 60,
    };

    const explanation: SearchExplanation = {
      entityName: 'entity',
      totalScore: 0.83,
      signals: [signal],
      matchedTerms: [],
      boosts: [],
      summary: 'Test',
    };

    expect(explanation.signals[0].name).toBe('tf-idf');
    expect(explanation.signals[0].contribution).toBe(0.5);
  });

  it('should support matched terms', () => {
    const term: MatchedTerm = {
      term: 'budget',
      field: 'observation',
      frequency: 3,
      termScore: 0.4,
    };

    const explanation: SearchExplanation = {
      entityName: 'entity',
      totalScore: 0.75,
      signals: [],
      matchedTerms: [term],
      boosts: [],
      summary: 'Test',
    };

    expect(explanation.matchedTerms[0].term).toBe('budget');
    expect(explanation.matchedTerms[0].field).toBe('observation');
  });

  it('should support all matched term fields', () => {
    const fields: MatchedTerm['field'][] = ['name', 'entityType', 'observation', 'tag'];

    for (const field of fields) {
      const term: MatchedTerm = {
        term: 'test',
        field,
        frequency: 1,
        termScore: 0.5,
      };
      expect(term.field).toBe(field);
    }
  });

  it('should support score boosts', () => {
    const boost: ScoreBoost = {
      name: 'recency',
      multiplier: 1.2,
      reason: 'Entity modified recently',
    };

    const explanation: SearchExplanation = {
      entityName: 'entity',
      totalScore: 0.9,
      signals: [],
      matchedTerms: [],
      boosts: [boost],
      summary: 'Test',
    };

    expect(explanation.boosts[0].name).toBe('recency');
    expect(explanation.boosts[0].multiplier).toBe(1.2);
  });

  it('should support signal details', () => {
    const signal: ScoringSignal = {
      name: 'bm25',
      value: 0.7,
      weight: 1.0,
      contribution: 0.7,
      percentage: 70,
      details: { k1: 1.2, b: 0.75 },
    };

    expect(signal.details?.k1).toBe(1.2);
    expect(signal.details?.b).toBe(0.75);
  });
});

describe('QueryNode Types', () => {
  it('should create TermNode', () => {
    const node: TermNode = {
      type: 'term',
      value: 'budget',
    };

    expect(node.type).toBe('term');
    expect(node.value).toBe('budget');
  });

  it('should create PhraseNode', () => {
    const node: PhraseNode = {
      type: 'phrase',
      terms: ['budget', 'travel'],
    };

    expect(node.type).toBe('phrase');
    expect(node.terms).toEqual(['budget', 'travel']);
  });

  it('should create WildcardNode', () => {
    const node: WildcardNode = {
      type: 'wildcard',
      pattern: 'budget*',
      regex: /^budget.*/,
    };

    expect(node.type).toBe('wildcard');
    expect(node.pattern).toBe('budget*');
    expect(node.regex.test('budget_travel')).toBe(true);
  });

  it('should create ProximityNode', () => {
    const node: ProximityNode = {
      type: 'proximity',
      terms: ['budget', 'hotel'],
      distance: 3,
    };

    expect(node.type).toBe('proximity');
    expect(node.terms).toEqual(['budget', 'hotel']);
    expect(node.distance).toBe(3);
  });

  it('should create FieldNode', () => {
    const termNode: TermNode = { type: 'term', value: 'person' };
    const node: FieldNode = {
      type: 'field',
      field: 'entityType',
      query: termNode,
    };

    expect(node.type).toBe('field');
    expect(node.field).toBe('entityType');
    expect(node.query).toBe(termNode);
  });

  it('should create BooleanOpNode', () => {
    const term1: TermNode = { type: 'term', value: 'budget' };
    const term2: TermNode = { type: 'term', value: 'travel' };

    const node: BooleanOpNode = {
      type: 'boolean',
      operator: 'AND',
      operands: [term1, term2],
    };

    expect(node.type).toBe('boolean');
    expect(node.operator).toBe('AND');
    expect(node.operands).toHaveLength(2);
  });

  it('should support all boolean operators', () => {
    const operators: BooleanOpNode['operator'][] = ['AND', 'OR', 'NOT'];

    for (const operator of operators) {
      const node: BooleanOpNode = {
        type: 'boolean',
        operator,
        operands: [],
      };
      expect(node.operator).toBe(operator);
    }
  });

  it('should support QueryNode union type', () => {
    const nodes: QueryNode[] = [
      { type: 'term', value: 'test' },
      { type: 'phrase', terms: ['a', 'b'] },
      { type: 'wildcard', pattern: 't*', regex: /^t.*/ },
      { type: 'proximity', terms: ['x', 'y'], distance: 2 },
      { type: 'field', field: 'name', query: { type: 'term', value: 'test' } },
      { type: 'boolean', operator: 'OR', operands: [] },
    ];

    expect(nodes).toHaveLength(6);
    expect(nodes.map(n => n.type)).toEqual([
      'term', 'phrase', 'wildcard', 'proximity', 'field', 'boolean'
    ]);
  });
});

describe('QueryStage Interface', () => {
  it('should have required fields', () => {
    const stage: QueryStage = {
      name: 'parsing',
      durationMs: 5,
    };

    expect(stage.name).toBe('parsing');
    expect(stage.durationMs).toBe(5);
  });

  it('should support optional fields', () => {
    const stage: QueryStage = {
      name: 'indexLookup',
      durationMs: 15,
      itemsProcessed: 1000,
      metadata: { indexName: 'entities' },
    };

    expect(stage.itemsProcessed).toBe(1000);
    expect(stage.metadata?.indexName).toBe('entities');
  });
});

describe('QueryTrace Interface', () => {
  it('should have all required fields', () => {
    const trace: QueryTrace = {
      queryId: 'q-123',
      queryText: 'test search',
      queryType: 'basic',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 100,
      resultCount: 5,
      stages: [],
    };

    expect(trace.queryId).toBe('q-123');
    expect(trace.queryText).toBe('test search');
    expect(trace.queryType).toBe('basic');
    expect(trace.resultCount).toBe(5);
  });

  it('should support all query types', () => {
    const types: QueryTrace['queryType'][] = [
      'basic', 'fuzzy', 'boolean', 'ranked', 'bm25', 'semantic', 'hybrid'
    ];

    for (const queryType of types) {
      const trace: QueryTrace = {
        queryId: 'q-1',
        queryText: 'test',
        queryType,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 10,
        resultCount: 0,
        stages: [],
      };
      expect(trace.queryType).toBe(queryType);
    }
  });

  it('should support optional metadata', () => {
    const trace: QueryTrace = {
      queryId: 'q-123',
      queryText: 'test',
      queryType: 'hybrid',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 50,
      resultCount: 3,
      stages: [],
      metadata: {
        cacheHit: false,
        weights: { semantic: 0.6, lexical: 0.4 },
      },
    };

    expect(trace.metadata?.cacheHit).toBe(false);
    expect((trace.metadata?.weights as Record<string, number>)?.semantic).toBe(0.6);
  });
});
