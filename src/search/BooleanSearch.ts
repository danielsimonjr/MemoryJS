/**
 * Boolean Search
 *
 * Advanced search with boolean operators (AND, OR, NOT) and field-specific queries.
 *
 * @module search/BooleanSearch
 */

import type { BooleanQueryNode, Entity, KnowledgeGraph } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { SEARCH_LIMITS, QUERY_LIMITS } from '../utils/constants.js';
import { ValidationError } from '../utils/errors.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';

/**
 * Phase 4 Sprint 4: Cache entry for Boolean search AST and results.
 */
interface BooleanCacheEntry {
  /** Parsed AST */
  ast: BooleanQueryNode;
  /** Cached entity names that matched */
  entityNames: string[];
  /** Entity count when cache was created (for invalidation) */
  entityCount: number;
  /** Timestamp when cached */
  timestamp: number;
}

/**
 * Phase 4 Sprint 4: Maximum AST cache size.
 */
const AST_CACHE_MAX_SIZE = 50;

/**
 * Phase 4 Sprint 4: Result cache max size.
 */
const RESULT_CACHE_MAX_SIZE = 100;

/**
 * Phase 4 Sprint 4: Cache TTL in milliseconds (5 minutes).
 */
const BOOLEAN_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Performs boolean search with query parsing and AST evaluation.
 */
export class BooleanSearch {
  /**
   * Phase 4 Sprint 4: AST cache to avoid re-parsing queries.
   * Maps query string -> parsed AST.
   */
  private astCache: Map<string, BooleanQueryNode> = new Map();

  /**
   * Phase 4 Sprint 4: Result cache for boolean search.
   * Maps cache key -> cached results.
   */
  private resultCache: Map<string, BooleanCacheEntry> = new Map();

  constructor(private storage: GraphStorage) {}

  /**
   * Phase 4 Sprint 4: Generate cache key for boolean search.
   */
  private generateCacheKey(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    offset?: number,
    limit?: number
  ): string {
    return JSON.stringify({
      q: query,
      tags: tags?.sort().join(',') ?? '',
      min: minImportance,
      max: maxImportance,
      off: offset,
      lim: limit,
    });
  }

  /**
   * Phase 4 Sprint 4: Clear all caches.
   */
  clearCache(): void {
    this.astCache.clear();
    this.resultCache.clear();
  }

  /**
   * Phase 4 Sprint 4: Cleanup old cache entries.
   */
  private cleanupResultCache(): void {
    const now = Date.now();
    const entries = Array.from(this.resultCache.entries());

    // Remove expired entries
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > BOOLEAN_CACHE_TTL_MS) {
        this.resultCache.delete(key);
      }
    }

    // If still over limit, remove oldest entries
    if (this.resultCache.size > RESULT_CACHE_MAX_SIZE) {
      const sortedEntries = entries
        .filter(([k]) => this.resultCache.has(k))
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = sortedEntries.slice(0, this.resultCache.size - RESULT_CACHE_MAX_SIZE);
      for (const [key] of toRemove) {
        this.resultCache.delete(key);
      }
    }
  }

  /**
   * Phase 4 Sprint 4: Get or parse AST for a query.
   */
  private getOrParseAST(query: string): BooleanQueryNode {
    // Check AST cache
    const cached = this.astCache.get(query);
    if (cached) {
      return cached;
    }

    // Parse and cache
    const ast = this.parseBooleanQuery(query);

    // Enforce cache size limit
    if (this.astCache.size >= AST_CACHE_MAX_SIZE) {
      // Remove first entry (oldest)
      const firstKey = this.astCache.keys().next().value;
      if (firstKey) this.astCache.delete(firstKey);
    }

    this.astCache.set(query, ast);
    return ast;
  }

  /**
   * Boolean search with support for AND, OR, NOT operators, field-specific queries, and pagination.
   *
   * Phase 4 Sprint 4: Implements AST caching and result caching for repeated queries.
   *
   * Query syntax examples:
   * - "alice AND programming" - Both terms must match
   * - "type:person OR type:organization" - Either type matches
   * - "NOT archived" - Exclude archived items
   * - "name:alice AND (observation:coding OR observation:teaching)"
   *
   * @param query - Boolean query string
   * @param tags - Optional tags filter
   * @param minImportance - Optional minimum importance
   * @param maxImportance - Optional maximum importance
   * @param offset - Number of results to skip (default: 0)
   * @param limit - Maximum number of results (default: 50, max: 200)
   * @returns Filtered knowledge graph matching the boolean query with pagination applied
   */
  async booleanSearch(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    offset: number = 0,
    limit: number = SEARCH_LIMITS.DEFAULT
  ): Promise<KnowledgeGraph> {
    // Validate query length
    if (query.length > QUERY_LIMITS.MAX_QUERY_LENGTH) {
      throw new ValidationError(
        'Query too long',
        [`Query length ${query.length} exceeds maximum of ${QUERY_LIMITS.MAX_QUERY_LENGTH} characters`]
      );
    }

    const graph = await this.storage.loadGraph();

    // Phase 4 Sprint 4: Check result cache
    const cacheKey = this.generateCacheKey(query, tags, minImportance, maxImportance, offset, limit);
    const cached = this.resultCache.get(cacheKey);

    if (cached && cached.entityCount === graph.entities.length) {
      const now = Date.now();
      if (now - cached.timestamp < BOOLEAN_CACHE_TTL_MS) {
        // Return cached results
        const cachedNameSet = new Set(cached.entityNames);
        const cachedEntities = graph.entities.filter(e => cachedNameSet.has(e.name));
        const cachedRelations = graph.relations.filter(
          r => cachedNameSet.has(r.from) && cachedNameSet.has(r.to)
        );
        return { entities: cachedEntities as Entity[], relations: cachedRelations };
      }
    }

    // Phase 4 Sprint 4: Use cached AST or parse new one
    let queryAst: BooleanQueryNode;
    try {
      queryAst = this.getOrParseAST(query);
    } catch (error) {
      throw new Error(
        `Failed to parse boolean query: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Validate query complexity
    this.validateQueryComplexity(queryAst);

    // First filter by boolean query evaluation (search-specific)
    const booleanMatched = graph.entities.filter(e =>
      this.evaluateBooleanQuery(queryAst, e)
    );

    // Apply tag and importance filters using SearchFilterChain
    const filters: SearchFilters = { tags, minImportance, maxImportance };
    const filteredEntities = SearchFilterChain.applyFilters(booleanMatched, filters);

    // Apply pagination using SearchFilterChain
    const pagination = SearchFilterChain.validatePagination(offset, limit);
    const paginatedEntities = SearchFilterChain.paginate(filteredEntities, pagination);

    // Phase 4 Sprint 4: Cache the results
    this.resultCache.set(cacheKey, {
      ast: queryAst,
      entityNames: paginatedEntities.map(e => e.name),
      entityCount: graph.entities.length,
      timestamp: Date.now(),
    });

    // Cleanup old cache entries periodically
    if (this.resultCache.size > RESULT_CACHE_MAX_SIZE / 2) {
      this.cleanupResultCache();
    }

    const filteredEntityNames = new Set(paginatedEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(
      r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    return { entities: paginatedEntities, relations: filteredRelations };
  }

  /**
   * Tokenize a boolean query into tokens.
   *
   * Handles quoted strings, parentheses, and operators.
   */
  private tokenizeBooleanQuery(query: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if (char === '"') {
        if (inQuotes) {
          // End of quoted string
          tokens.push(current);
          current = '';
          inQuotes = false;
        } else {
          // Start of quoted string
          if (current.trim()) {
            tokens.push(current.trim());
            current = '';
          }
          inQuotes = true;
        }
      } else if (!inQuotes && (char === '(' || char === ')')) {
        // Parentheses are separate tokens
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        tokens.push(char);
      } else if (!inQuotes && /\s/.test(char)) {
        // Whitespace outside quotes
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      tokens.push(current.trim());
    }

    return tokens;
  }

  /**
   * Parse a boolean search query into an AST.
   *
   * Supports: AND, OR, NOT, parentheses, field-specific queries (field:value)
   */
  private parseBooleanQuery(query: string): BooleanQueryNode {
    const tokens = this.tokenizeBooleanQuery(query);
    let position = 0;

    const peek = (): string | undefined => tokens[position];
    const consume = (): string | undefined => tokens[position++];

    // Parse OR expressions (lowest precedence)
    const parseOr = (): BooleanQueryNode => {
      let left = parseAnd();

      while (peek()?.toUpperCase() === 'OR') {
        consume(); // consume 'OR'
        const right = parseAnd();
        left = { type: 'OR', children: [left, right] };
      }

      return left;
    };

    // Parse AND expressions
    const parseAnd = (): BooleanQueryNode => {
      let left = parseNot();

      while (peek() && peek()?.toUpperCase() !== 'OR' && peek() !== ')') {
        // Implicit AND if next token is not OR or )
        if (peek()?.toUpperCase() === 'AND') {
          consume(); // consume 'AND'
        }
        const right = parseNot();
        left = { type: 'AND', children: [left, right] };
      }

      return left;
    };

    // Parse NOT expressions
    const parseNot = (): BooleanQueryNode => {
      if (peek()?.toUpperCase() === 'NOT') {
        consume(); // consume 'NOT'
        const child = parseNot();
        return { type: 'NOT', child };
      }
      return parsePrimary();
    };

    // Parse primary expressions (terms, field queries, parentheses)
    const parsePrimary = (): BooleanQueryNode => {
      const token = peek();

      if (!token) {
        throw new Error('Unexpected end of query');
      }

      // Parentheses
      if (token === '(') {
        consume(); // consume '('
        const node = parseOr();
        if (consume() !== ')') {
          throw new Error('Expected closing parenthesis');
        }
        return node;
      }

      // Field-specific query (field:value)
      if (token.includes(':')) {
        consume();
        const [field, ...valueParts] = token.split(':');
        const value = valueParts.join(':'); // Handle colons in value
        return { type: 'TERM', field: field.toLowerCase(), value: value.toLowerCase() };
      }

      // Regular term
      consume();
      return { type: 'TERM', value: token.toLowerCase() };
    };

    const result = parseOr();

    // Check for unconsumed tokens
    if (position < tokens.length) {
      throw new Error(`Unexpected token: ${tokens[position]}`);
    }

    return result;
  }

  /**
   * Evaluate a boolean query AST against an entity.
   */
  private evaluateBooleanQuery(node: BooleanQueryNode, entity: Entity): boolean {
    switch (node.type) {
      case 'AND':
        return node.children.every(child => this.evaluateBooleanQuery(child, entity));

      case 'OR':
        return node.children.some(child => this.evaluateBooleanQuery(child, entity));

      case 'NOT':
        return !this.evaluateBooleanQuery(node.child, entity);

      case 'TERM': {
        const value = node.value;
        // OPTIMIZED: Use pre-computed lowercase cache
        const lowercased = this.storage.getLowercased(entity.name);

        // Field-specific search
        if (node.field) {
          switch (node.field) {
            case 'name':
              return lowercased ? lowercased.name.includes(value) : entity.name.toLowerCase().includes(value);
            case 'type':
            case 'entitytype':
              return lowercased ? lowercased.entityType.includes(value) : entity.entityType.toLowerCase().includes(value);
            case 'observation':
            case 'observations':
              // OPTIMIZED: Use observation index for simple single-word terms (O(1) vs O(n))
              // The index only matches complete words, not substrings, so we can only
              // use it as a quick positive check. If not found in index, fall through
              // to substring matching for compatibility.
              if (this.isSimpleTerm(value) && !value.includes(' ')) {
                const candidateNames = this.storage.getEntitiesByObservationWord(value);
                if (candidateNames.has(entity.name)) {
                  return true; // O(1) positive match
                }
                // Not found in index - entity doesn't have this complete word,
                // but might contain it as substring - fall through to check
              }
              // Linear scan for substring matches, phrases, and patterns
              return lowercased
                ? lowercased.observations.some(obs => obs.includes(value))
                : entity.observations.some(obs => obs.toLowerCase().includes(value));
            case 'tag':
            case 'tags':
              return lowercased
                ? lowercased.tags.some(tag => tag.includes(value))
                : (entity.tags?.some(tag => tag.toLowerCase().includes(value)) || false);
            default:
              // Unknown field, search all text fields
              return this.entityMatchesTerm(entity, value, lowercased);
          }
        }

        // General search across all fields
        return this.entityMatchesTerm(entity, value, lowercased);
      }
    }
  }

  /**
   * Check if a search term is simple (no regex or wildcards).
   * Simple terms can use the O(1) observation index.
   */
  private isSimpleTerm(term: string): boolean {
    const specialChars = /[.*+?^${}()|\\[\]]/;
    return !specialChars.test(term);
  }

  /**
   * Check if entity matches a search term in any text field.
   * OPTIMIZED: Uses pre-computed lowercase data when available.
   */
  private entityMatchesTerm(entity: Entity, term: string, lowercased?: ReturnType<typeof this.storage.getLowercased>): boolean {
    if (lowercased) {
      return (
        lowercased.name.includes(term) ||
        lowercased.entityType.includes(term) ||
        lowercased.observations.some(obs => obs.includes(term)) ||
        lowercased.tags.some(tag => tag.includes(term))
      );
    }

    // Fallback for entities not in cache
    const termLower = term.toLowerCase();
    return (
      entity.name.toLowerCase().includes(termLower) ||
      entity.entityType.toLowerCase().includes(termLower) ||
      entity.observations.some(obs => obs.toLowerCase().includes(termLower)) ||
      (entity.tags?.some(tag => tag.toLowerCase().includes(termLower)) || false)
    );
  }

  /**
   * Validate query complexity to prevent resource exhaustion.
   * Checks nesting depth, term count, and operator count against configured limits.
   */
  private validateQueryComplexity(node: BooleanQueryNode, depth: number = 0): void {
    // Check nesting depth
    if (depth > QUERY_LIMITS.MAX_DEPTH) {
      throw new ValidationError(
        'Query too complex',
        [`Query nesting depth ${depth} exceeds maximum of ${QUERY_LIMITS.MAX_DEPTH}`]
      );
    }

    // Count terms and operators recursively
    const complexity = this.calculateQueryComplexity(node);

    if (complexity.terms > QUERY_LIMITS.MAX_TERMS) {
      throw new ValidationError(
        'Query too complex',
        [`Query has ${complexity.terms} terms, exceeds maximum of ${QUERY_LIMITS.MAX_TERMS}`]
      );
    }

    if (complexity.operators > QUERY_LIMITS.MAX_OPERATORS) {
      throw new ValidationError(
        'Query too complex',
        [`Query has ${complexity.operators} operators, exceeds maximum of ${QUERY_LIMITS.MAX_OPERATORS}`]
      );
    }
  }

  /**
   * Calculate query complexity metrics.
   */
  private calculateQueryComplexity(
    node: BooleanQueryNode,
    depth: number = 0
  ): { terms: number; operators: number; maxDepth: number } {
    switch (node.type) {
      case 'AND':
      case 'OR':
        const childResults = node.children.map(child => this.calculateQueryComplexity(child, depth + 1));
        return {
          terms: childResults.reduce((sum, r) => sum + r.terms, 0),
          operators: childResults.reduce((sum, r) => sum + r.operators, 1), // +1 for current operator
          maxDepth: Math.max(depth, ...childResults.map(r => r.maxDepth)),
        };

      case 'NOT':
        const notResult = this.calculateQueryComplexity(node.child, depth + 1);
        return {
          terms: notResult.terms,
          operators: notResult.operators + 1,
          maxDepth: Math.max(depth, notResult.maxDepth),
        };

      case 'TERM':
        return {
          terms: 1,
          operators: 0,
          maxDepth: depth,
        };
    }
  }
}
