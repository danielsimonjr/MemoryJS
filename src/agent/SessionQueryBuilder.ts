/**
 * Session Query Builder
 *
 * Fluent interface for building session-scoped queries with
 * temporal filtering and cross-session search support.
 *
 * @module agent/SessionQueryBuilder
 */

import type { Entity, SearchResult } from '../types/types.js';
import type { AgentEntity, SessionEntity, MemoryType } from '../types/agent-memory.js';
import { isAgentEntity, isSessionEntity } from '../types/agent-memory.js';
import type { IGraphStorage } from '../types/types.js';
import type { SessionManager } from './SessionManager.js';

/**
 * Session search options for filtering results.
 */
export interface SessionSearchOptions {
  /** Restrict to specific session */
  sessionId?: string;
  /** Include memories from related sessions */
  includeRelatedSessions?: boolean;
  /** Only include memories from active sessions */
  activeSessionsOnly?: boolean;
}

/**
 * Entity result with optional session context.
 */
export interface EntityWithContext {
  entity: AgentEntity;
  session?: SessionEntity;
  relatedSessions?: SessionEntity[];
}

/**
 * Search function type for flexibility in search implementation.
 */
export type SearchFunction = (query: string) => Promise<Entity[] | SearchResult[]>;

/**
 * Builds session-scoped queries with fluent API.
 *
 * SessionQueryBuilder provides a chainable interface for building
 * complex session-scoped queries. All filters are accumulated and
 * applied when search() or execute() is called.
 *
 * @example
 * ```typescript
 * const builder = new SessionQueryBuilder(storage, sessionManager);
 *
 * // Simple session-scoped search
 * const results = await builder
 *   .forSession('session_123')
 *   .search('hotels');
 *
 * // Complex query with temporal filter
 * const results = await builder
 *   .forSession('session_123')
 *   .withRelatedSessions()
 *   .withTaskId('trip_planning')
 *   .createdInLastDays(7)
 *   .withImportance(5, 10)
 *   .withLimit(20)
 *   .search('budget');
 *
 * // Query across recent sessions
 * const results = await builder
 *   .fromLastNSessions(5)
 *   .ofTypes('episodic', 'semantic')
 *   .search('user preferences');
 * ```
 */
export class SessionQueryBuilder {
  private readonly storage: IGraphStorage;
  private readonly sessionManager: SessionManager;
  private searchFunction?: SearchFunction;

  private sessionId?: string;
  private _sessionIds?: string[];
  private taskId?: string;
  private includeRelated: boolean = false;
  private startDate?: string;
  private endDate?: string;
  private minImportance?: number;
  private maxImportance?: number;
  private memoryTypes?: MemoryType[];
  private limit?: number;
  private offset?: number;

  constructor(storage: IGraphStorage, sessionManager: SessionManager) {
    this.storage = storage;
    this.sessionManager = sessionManager;
  }

  /**
   * Set a custom search function for executing queries.
   * If not set, searches will use storage's basic entity search.
   *
   * @param fn - Search function
   */
  setSearchFunction(fn: SearchFunction): this {
    this.searchFunction = fn;
    return this;
  }

  // ==================== Session Scoping ====================

  /**
   * Restrict search to a specific session.
   *
   * @param sessionId - Session identifier
   */
  forSession(sessionId: string): this {
    this.sessionId = sessionId;
    return this;
  }

  /**
   * Include memories from sessions related to the primary session.
   * Must be used with forSession().
   */
  withRelatedSessions(): this {
    this.includeRelated = true;
    return this;
  }

  /**
   * Restrict search to specific sessions by IDs.
   *
   * @param sessionIds - Array of session identifiers
   */
  forSessions(sessionIds: string[]): this {
    this._sessionIds = sessionIds;
    return this;
  }

  /**
   * Restrict search to the current active session.
   * Returns this for chaining (async operation performed at search time).
   */
  async fromCurrentSession(): Promise<this> {
    const active = await this.sessionManager.getActiveSession();
    if (active) {
      this.sessionId = active.name;
    }
    return this;
  }

  /**
   * Query memories from the last N sessions.
   *
   * @param n - Number of recent sessions to include
   */
  async fromLastNSessions(n: number): Promise<this> {
    const history = await this.sessionManager.getSessionHistory({ limit: n });
    this._sessionIds = history.map((s) => s.name);
    return this;
  }

  // ==================== Task Filtering ====================

  /**
   * Filter to memories associated with a specific task.
   *
   * @param taskId - Task identifier
   */
  withTaskId(taskId: string): this {
    this.taskId = taskId;
    return this;
  }

  // ==================== Temporal Filtering ====================

  /**
   * Filter to memories within a time range.
   *
   * @param start - Start date (ISO 8601)
   * @param end - End date (ISO 8601)
   */
  inTimeRange(start: string, end: string): this {
    this.startDate = start;
    this.endDate = end;
    return this;
  }

  /**
   * Filter to memories created today.
   */
  createdToday(): this {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.startDate = today.toISOString();

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.endDate = tomorrow.toISOString();

    return this;
  }

  /**
   * Filter to memories created in the last N hours.
   *
   * @param hours - Number of hours
   */
  createdInLastHours(hours: number): this {
    const now = new Date();
    const past = new Date(now.getTime() - hours * 60 * 60 * 1000);
    this.startDate = past.toISOString();
    return this;
  }

  /**
   * Filter to memories created in the last N days.
   *
   * @param days - Number of days
   */
  createdInLastDays(days: number): this {
    const now = new Date();
    const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    this.startDate = past.toISOString();
    return this;
  }

  // ==================== Importance Filtering ====================

  /**
   * Filter by importance range.
   *
   * @param min - Minimum importance (0-10)
   * @param max - Maximum importance (0-10)
   */
  withImportance(min?: number, max?: number): this {
    this.minImportance = min;
    this.maxImportance = max;
    return this;
  }

  // ==================== Type Filtering ====================

  /**
   * Filter to specific memory types.
   *
   * @param types - Memory types to include
   */
  ofTypes(...types: MemoryType[]): this {
    this.memoryTypes = types;
    return this;
  }

  // ==================== Pagination ====================

  /**
   * Limit the number of results.
   *
   * @param limit - Maximum results to return
   */
  withLimit(limit: number): this {
    this.limit = limit;
    return this;
  }

  /**
   * Skip a number of results (for pagination).
   *
   * @param offset - Number of results to skip
   */
  withOffset(offset: number): this {
    this.offset = offset;
    return this;
  }

  // ==================== Session Resolution ====================

  /**
   * Get all session IDs to search, resolving related sessions if needed.
   * @internal
   */
  private async resolveSessionIds(): Promise<Set<string> | undefined> {
    // If explicit session IDs provided, use them
    if (this._sessionIds && this._sessionIds.length > 0) {
      return new Set(this._sessionIds);
    }

    // If single session specified
    if (this.sessionId) {
      const sessionIds = new Set([this.sessionId]);

      // Include related sessions if requested
      if (this.includeRelated) {
        const session = this.storage.getEntityByName(this.sessionId);
        if (session && isSessionEntity(session)) {
          for (const relatedId of session.relatedSessionIds ?? []) {
            sessionIds.add(relatedId);
          }
        }
      }

      return sessionIds;
    }

    // No session filter
    return undefined;
  }

  // ==================== Filter Application ====================

  /**
   * Apply all accumulated filters to results.
   * @internal
   */
  private applyFilters(
    results: AgentEntity[],
    sessionIds?: Set<string>
  ): AgentEntity[] {
    return results.filter((entity) => {
      // Session filter
      if (sessionIds && entity.sessionId) {
        if (!sessionIds.has(entity.sessionId)) return false;
      } else if (sessionIds) {
        // Entity has no sessionId but we're filtering by session
        return false;
      }

      // Task filter
      if (this.taskId && entity.taskId !== this.taskId) return false;

      // Temporal filters
      if (this.startDate && entity.createdAt) {
        if (new Date(entity.createdAt) < new Date(this.startDate)) return false;
      }
      if (this.endDate && entity.createdAt) {
        if (new Date(entity.createdAt) >= new Date(this.endDate)) return false;
      }

      // Importance filters
      if (this.minImportance !== undefined) {
        if ((entity.importance ?? 0) < this.minImportance) return false;
      }
      if (this.maxImportance !== undefined) {
        if ((entity.importance ?? 10) > this.maxImportance) return false;
      }

      // Memory type filter
      if (this.memoryTypes && this.memoryTypes.length > 0) {
        if (!this.memoryTypes.includes(entity.memoryType)) return false;
      }

      return true;
    });
  }

  // ==================== Execution ====================

  /**
   * Execute search with the accumulated filters.
   *
   * @param query - Search query string
   * @returns Matching AgentEntity results
   */
  async search(query: string): Promise<AgentEntity[]> {
    const sessionIds = await this.resolveSessionIds();

    let results: AgentEntity[];

    if (this.searchFunction) {
      // Use custom search function
      const searchResults = await this.searchFunction(query);
      results = searchResults
        .map((r) => {
          // Handle both Entity and SearchResult types
          if ('entity' in r) return r.entity as AgentEntity;
          return r as AgentEntity;
        })
        .filter(isAgentEntity);
    } else {
      // Default: search all entities in storage
      const graph = await this.storage.loadGraph();
      const queryLower = query.toLowerCase();
      results = graph.entities
        .filter((e) => {
          if (!isAgentEntity(e)) return false;
          // Simple text search on name and observations
          const nameMatch = e.name.toLowerCase().includes(queryLower);
          const obsMatch = e.observations.some((o) =>
            o.toLowerCase().includes(queryLower)
          );
          return nameMatch || obsMatch;
        })
        .map((e) => e as AgentEntity);
    }

    // Apply filters
    results = this.applyFilters(results, sessionIds);

    // Apply pagination
    if (this.offset) {
      results = results.slice(this.offset);
    }
    if (this.limit) {
      results = results.slice(0, this.limit);
    }

    return results;
  }

  /**
   * Execute search across sessions with recency-based ranking.
   * More recent sessions get a boost to their relevance scores.
   *
   * @param query - Search query string
   * @param recencyWeight - Weight for recency boost (default: 0.1)
   * @returns Matching AgentEntity results ranked by relevance and recency
   */
  async searchWithRecencyRanking(
    query: string,
    recencyWeight: number = 0.1
  ): Promise<AgentEntity[]> {
    // Get sessions to search
    let sessionIds = this._sessionIds ?? (this.sessionId ? [this.sessionId] : []);

    if (sessionIds.length === 0) {
      // Get recent session history
      const history = await this.sessionManager.getSessionHistory({ limit: 10 });
      sessionIds = history.map((s) => s.name);
    }

    // Search each session and apply recency boost
    const allResults: Map<string, { entity: AgentEntity; score: number }> =
      new Map();

    for (let i = 0; i < sessionIds.length; i++) {
      const sessId = sessionIds[i];
      const recencyBoost = 1 + recencyWeight * (sessionIds.length - i);

      // Build query for this session
      const builder = new SessionQueryBuilder(this.storage, this.sessionManager);
      builder.forSession(sessId);
      if (this.taskId) builder.withTaskId(this.taskId);
      if (this.minImportance !== undefined || this.maxImportance !== undefined) {
        builder.withImportance(this.minImportance, this.maxImportance);
      }
      if (this.memoryTypes) builder.ofTypes(...this.memoryTypes);
      if (this.startDate && this.endDate) {
        builder.inTimeRange(this.startDate, this.endDate);
      }
      if (this.searchFunction) builder.setSearchFunction(this.searchFunction);

      const sessResults = await builder.search(query);

      for (const entity of sessResults) {
        const score = recencyBoost; // Base score from recency
        const existing = allResults.get(entity.name);

        if (!existing || score > existing.score) {
          allResults.set(entity.name, { entity, score });
        }
      }
    }

    // Sort by score and return entities
    const sorted = Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .map((r) => r.entity);

    // Apply limit
    if (this.limit) {
      return sorted.slice(0, this.limit);
    }

    return sorted;
  }

  /**
   * Get all entities matching filters without search query.
   *
   * @returns Matching AgentEntity results
   */
  async execute(): Promise<AgentEntity[]> {
    const sessionIds = await this.resolveSessionIds();
    const graph = await this.storage.loadGraph();

    let results = graph.entities.filter(isAgentEntity) as AgentEntity[];
    results = this.applyFilters(results, sessionIds);

    // Apply pagination
    if (this.offset) {
      results = results.slice(this.offset);
    }
    if (this.limit) {
      results = results.slice(0, this.limit);
    }

    return results;
  }

  /**
   * Get entity with session context.
   *
   * @param name - Entity name
   * @param includeRelatedSessions - Include related sessions
   * @returns Entity with session context or undefined
   */
  async getEntityWithContext(
    name: string,
    includeRelatedSessions: boolean = false
  ): Promise<EntityWithContext | undefined> {
    const entity = this.storage.getEntityByName(name);
    if (!entity || !isAgentEntity(entity)) {
      return undefined;
    }

    const agentEntity = entity as AgentEntity;
    const result: EntityWithContext = { entity: agentEntity };

    // Get session if entity has one
    if (agentEntity.sessionId) {
      const session = this.storage.getEntityByName(agentEntity.sessionId);
      if (session && isSessionEntity(session)) {
        result.session = session;

        // Get related sessions if requested
        if (includeRelatedSessions && session.relatedSessionIds) {
          result.relatedSessions = [];
          for (const relatedId of session.relatedSessionIds) {
            const related = this.storage.getEntityByName(relatedId);
            if (related && isSessionEntity(related)) {
              result.relatedSessions.push(related);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Reset all filters for reuse.
   */
  reset(): this {
    this.sessionId = undefined;
    this._sessionIds = undefined;
    this.taskId = undefined;
    this.includeRelated = false;
    this.startDate = undefined;
    this.endDate = undefined;
    this.minImportance = undefined;
    this.maxImportance = undefined;
    this.memoryTypes = undefined;
    this.limit = undefined;
    this.offset = undefined;
    return this;
  }
}
