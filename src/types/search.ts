/**
 * Search Types
 *
 * Type definitions for search operations, tracing, and explanation.
 * Phase 1 Sprint 6-7: Query logging, tracing, and result explanation.
 *
 * @module types/search
 */

// ==================== Query Tracing Types (Sprint 6) ====================

/**
 * Log level for query logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Entry in the query log.
 */
export interface QueryLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Unique identifier for the query */
  queryId: string;
  /** Log level */
  level: LogLevel;
  /** Event name */
  event: string;
  /** Original query text */
  queryText?: string;
  /** Type of search performed */
  queryType?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Number of results */
  resultCount?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Complete trace of a search query execution.
 */
export interface QueryTrace {
  /** Unique identifier for this query */
  queryId: string;
  /** Original query text */
  queryText: string;
  /** Type of search performed */
  queryType: 'basic' | 'fuzzy' | 'boolean' | 'ranked' | 'bm25' | 'semantic' | 'hybrid';
  /** ISO 8601 timestamp when query started */
  startTime: string;
  /** ISO 8601 timestamp when query completed */
  endTime: string;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Number of results returned */
  resultCount: number;
  /** Breakdown of time spent in each stage */
  stages: QueryStage[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A single stage in query execution.
 */
export interface QueryStage {
  /** Name of this stage */
  name: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Items processed in this stage */
  itemsProcessed?: number;
  /** Additional stage-specific data */
  metadata?: Record<string, unknown>;
}

// ==================== Search Explanation Types (Sprint 7) ====================

/**
 * Explanation of why an entity matched a search query.
 */
export interface SearchExplanation {
  /** Entity that was matched */
  entityName: string;
  /** Final computed score */
  totalScore: number;
  /** Breakdown of scoring signals */
  signals: ScoringSignal[];
  /** Terms from query that matched */
  matchedTerms: MatchedTerm[];
  /** Boost factors applied */
  boosts: ScoreBoost[];
  /** Human-readable summary */
  summary: string;
}

/**
 * A single scoring signal contributing to the total score.
 */
export interface ScoringSignal {
  /** Name of this signal (e.g., 'tf-idf', 'bm25', 'semantic') */
  name: string;
  /** Raw value of this signal */
  value: number;
  /** Weight applied to this signal */
  weight: number;
  /** Contribution to final score (value * weight) */
  contribution: number;
  /** Percentage of total score from this signal */
  percentage: number;
  /** Additional signal-specific details */
  details?: Record<string, unknown>;
}

/**
 * Information about a matched term.
 */
export interface MatchedTerm {
  /** The term that matched */
  term: string;
  /** Where it matched (name, observation, tag) */
  field: 'name' | 'entityType' | 'observation' | 'tag';
  /** Number of times it matched */
  frequency: number;
  /** TF-IDF or similar score for this term */
  termScore: number;
}

/**
 * A boost factor applied to the score.
 */
export interface ScoreBoost {
  /** Name of the boost */
  name: string;
  /** Multiplier applied */
  multiplier: number;
  /** Reason for the boost */
  reason: string;
}

/**
 * Search result with explanation attached.
 */
export interface ExplainedSearchResult<T = unknown> {
  /** The matched entity */
  entity: T;
  /** Computed score */
  score: number;
  /** Detailed explanation */
  explanation: SearchExplanation;
}

// ==================== Query Parser Types (Sprint 8) ====================

/**
 * Union of all query node types.
 */
export type QueryNode =
  | TermNode
  | PhraseNode
  | WildcardNode
  | ProximityNode
  | FieldNode
  | BooleanOpNode;

/**
 * A simple term node.
 */
export interface TermNode {
  type: 'term';
  value: string;
}

/**
 * An exact phrase node.
 */
export interface PhraseNode {
  type: 'phrase';
  terms: string[];
}

/**
 * A wildcard pattern node.
 */
export interface WildcardNode {
  type: 'wildcard';
  pattern: string;
  regex: RegExp;
}

/**
 * A proximity search node.
 */
export interface ProximityNode {
  type: 'proximity';
  terms: string[];
  distance: number;
}

/**
 * A field-specific search node.
 */
export interface FieldNode {
  type: 'field';
  field: string;
  query: QueryNode;
}

/**
 * A boolean operator node in the query parser.
 * Note: Different from BooleanQueryNode in types.ts which is for AST representation.
 */
export interface BooleanOpNode {
  type: 'boolean';
  operator: 'AND' | 'OR' | 'NOT';
  operands: QueryNode[];
}

// ==================== Builder Classes ====================

/**
 * Builder for creating QueryTrace objects.
 */
export class QueryTraceBuilder {
  private trace: Partial<QueryTrace>;
  private stageStart?: number;

  constructor(queryId: string, queryText: string, queryType: QueryTrace['queryType']) {
    this.trace = {
      queryId,
      queryText,
      queryType,
      startTime: new Date().toISOString(),
      stages: [],
    };
  }

  /**
   * Start timing a stage.
   */
  startStage(_name: string): this {
    this.stageStart = performance.now();
    return this;
  }

  /**
   * End timing the current stage and record it.
   */
  endStage(name: string, metadata?: Record<string, unknown>): this {
    if (this.stageStart !== undefined) {
      this.trace.stages!.push({
        name,
        durationMs: performance.now() - this.stageStart,
        metadata,
      });
      this.stageStart = undefined;
    }
    return this;
  }

  /**
   * Add a completed stage with known duration.
   */
  addStage(name: string, durationMs: number, metadata?: Record<string, unknown>): this {
    this.trace.stages!.push({
      name,
      durationMs,
      metadata,
    });
    return this;
  }

  /**
   * Complete the trace and return the final QueryTrace.
   */
  complete(resultCount: number, metadata?: Record<string, unknown>): QueryTrace {
    const endTime = new Date();
    const startTime = new Date(this.trace.startTime!);

    return {
      ...this.trace,
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      resultCount,
      metadata,
    } as QueryTrace;
  }
}
