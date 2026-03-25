/**
 * LLM Query Planner
 *
 * Decomposes natural language queries into structured query objects
 * that can be executed against the search infrastructure.
 *
 * @module search/LLMQueryPlanner
 */

// ==================== Interfaces ====================

/**
 * Provider interface for LLM completion.
 * Implement this to integrate any LLM backend.
 *
 * @example
 * ```typescript
 * const openAIProvider: LLMProvider = {
 *   async complete(prompt: string): Promise<string> {
 *     const res = await openai.chat.completions.create({
 *       model: 'gpt-4o-mini',
 *       messages: [{ role: 'user', content: prompt }],
 *     });
 *     return res.choices[0].message.content ?? '';
 *   }
 * };
 * ```
 */
export interface LLMProvider {
  /** Send a prompt to the LLM and return the text completion. */
  complete(prompt: string): Promise<string>;
}

/**
 * Structured query derived from natural language input.
 * All fields are optional except `keywords`, which always has at least one term.
 */
export interface StructuredQuery {
  /** Core search terms extracted from the query */
  keywords: string[];
  /** Entity type filters (e.g., ["person", "project"]) */
  entityTypes?: string[];
  /** Date range filter */
  timeRange?: { start: Date; end: Date };
  /** Importance range filter (0-10 scale) */
  importance?: { min: number; max: number };
  /** Tag filters */
  tags?: string[];
  /** Relation filters */
  relations?: { type: string; target?: string }[];
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Configuration for the LLM Query Planner.
 */
export interface LLMQueryPlannerConfig {
  /** LLM provider for query decomposition. When absent, falls back to keyword extraction. */
  llmProvider?: LLMProvider;
  /** Default result limit if none is specified in the query */
  defaultLimit?: number;
}

// ==================== Stop words for keyword filtering ====================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'that', 'this',
  'these', 'those', 'it', 'its', 'about', 'show', 'me', 'find', 'get',
  'list', 'all', 'any', 'some', 'my', 'i', 'we', 'you', 'he', 'she',
  'they', 'what', 'which', 'who', 'how', 'when', 'where', 'why', 'not',
  'no', 'so', 'if', 'then', 'than', 'as', 'up', 'out', 'into', 'over',
  'after', 'before', 'between', 'tell', 'give', 'related', 'like',
]);

// ==================== Prompt Template ====================

function buildPlannerPrompt(naturalLanguage: string): string {
  return `You are a search query planner for a knowledge graph database.
Convert the following natural language query into a structured JSON search plan.

Natural language query: "${naturalLanguage}"

Output ONLY a valid JSON object (no markdown, no explanation) matching this schema:
{
  "keywords": string[],           // required: 1+ meaningful search terms
  "entityTypes": string[],        // optional: entity type filters (e.g. ["person","project"])
  "timeRange": {                  // optional: date range
    "start": "ISO8601 date",
    "end": "ISO8601 date"
  },
  "importance": {                 // optional: importance range 0-10
    "min": number,
    "max": number
  },
  "tags": string[],               // optional: tag filters
  "relations": [                  // optional: relation filters
    { "type": string, "target": string }
  ],
  "limit": number                 // optional: max results (integer)
}

Rules:
- keywords must contain at least one term; filter out stop words
- Only include fields that are explicitly or strongly implied by the query
- Do not invent constraints not present in the query
- Return raw JSON only, no code fences or explanation`;
}

// ==================== LLMQueryPlanner ====================

/**
 * Decomposes natural language queries into StructuredQuery objects.
 *
 * When an LLM provider is configured, it calls the LLM to parse intent.
 * If the LLM is unavailable or returns invalid output, it falls back to
 * simple keyword tokenisation.
 *
 * @example
 * ```typescript
 * const planner = new LLMQueryPlanner({ llmProvider: myProvider });
 * const query = await planner.planQuery('find senior engineers tagged backend');
 * // { keywords: ['senior', 'engineers'], tags: ['backend'] }
 * ```
 */
export class LLMQueryPlanner {
  private readonly llmProvider?: LLMProvider;
  // defaultLimit is stored for future use (e.g. injecting into StructuredQuery when LLM omits it)
  readonly defaultLimit: number;

  constructor(config: LLMQueryPlannerConfig = {}) {
    this.llmProvider = config.llmProvider;
    this.defaultLimit = config.defaultLimit ?? 20;
  }

  // ==================== Public API ====================

  /**
   * Decompose a natural language string into a StructuredQuery.
   *
   * Tries the LLM provider first; falls back to keyword extraction on failure.
   *
   * @param naturalLanguage - Free-text search query
   * @returns Validated StructuredQuery
   */
  async planQuery(naturalLanguage: string): Promise<StructuredQuery> {
    const trimmed = naturalLanguage.trim();
    if (!trimmed) {
      return { keywords: [] };
    }

    if (this.llmProvider) {
      try {
        const prompt = buildPlannerPrompt(trimmed);
        const response = await this.llmProvider.complete(prompt);
        const parsed = this.parseLLMResponse(response);
        if (parsed) {
          const sanitized = this.sanitize(parsed);
          if (sanitized) {
            return sanitized;
          }
        }
      } catch {
        // Fall through to keyword fallback
      }
    }

    return this.keywordFallback(trimmed);
  }

  /**
   * Simple tokenizer fallback when LLM is unavailable or returns invalid output.
   *
   * Splits the text on non-word characters, lowercases tokens, and removes
   * stop words and short tokens (< 2 chars).
   *
   * @param text - Input text to tokenize
   * @returns Minimal StructuredQuery with only keywords populated
   */
  keywordFallback(text: string): StructuredQuery {
    const trimmed = text.trim();
    if (!trimmed) {
      return { keywords: [] };
    }

    const tokens = trimmed
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t));

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        keywords.push(t);
      }
    }

    return { keywords };
  }

  // ==================== Private Helpers ====================

  /**
   * Extract a JSON object from raw LLM response text.
   * Handles markdown code fences and leading/trailing text.
   */
  private parseLLMResponse(response: string): unknown | null {
    const trimmed = response.trim();

    // Try direct parse first
    try {
      return JSON.parse(trimmed);
    } catch {
      // Try to extract JSON object from surrounding text
    }

    // Strip markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Continue
      }
    }

    // Find first { ... } block
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Fall through
      }
    }

    return null;
  }

  /**
   * Validate and sanitize a parsed LLM response into a StructuredQuery.
   * Returns null if the response doesn't meet minimum requirements.
   */
  private sanitize(raw: unknown): StructuredQuery | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const obj = raw as Record<string, unknown>;

    // keywords is required and must be a non-empty string array (cap at 20)
    const rawKeywords = obj['keywords'];
    if (!Array.isArray(rawKeywords)) {
      return null;
    }
    const keywords = rawKeywords
      .slice(0, 20)
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map(k => k.trim().toLowerCase());

    if (keywords.length === 0) {
      return null;
    }

    const result: StructuredQuery = { keywords };

    // entityTypes (cap at 10)
    const rawEntityTypes = obj['entityTypes'];
    if (Array.isArray(rawEntityTypes)) {
      const entityTypes = rawEntityTypes
        .slice(0, 10)
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.trim());
      if (entityTypes.length > 0) {
        result.entityTypes = entityTypes;
      }
    }

    // timeRange
    const rawTimeRange = obj['timeRange'];
    if (rawTimeRange && typeof rawTimeRange === 'object' && !Array.isArray(rawTimeRange)) {
      const tr = rawTimeRange as Record<string, unknown>;
      const start = this.parseDate(tr['start']);
      const end = this.parseDate(tr['end']);
      if (start && end && start <= end) {
        result.timeRange = { start, end };
      }
    }

    // importance
    const rawImportance = obj['importance'];
    if (rawImportance && typeof rawImportance === 'object' && !Array.isArray(rawImportance)) {
      const imp = rawImportance as Record<string, unknown>;
      const min = typeof imp['min'] === 'number' ? imp['min'] : undefined;
      const max = typeof imp['max'] === 'number' ? imp['max'] : undefined;
      if (min !== undefined || max !== undefined) {
        result.importance = {
          min: Math.max(0, Math.min(10, min ?? 0)),
          max: Math.max(0, Math.min(10, max ?? 10)),
        };
      }
    }

    // tags (cap at 20)
    const rawTags = obj['tags'];
    if (Array.isArray(rawTags)) {
      const tags = rawTags
        .slice(0, 20)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map(t => t.trim().toLowerCase());
      if (tags.length > 0) {
        result.tags = tags;
      }
    }

    // relations (cap at 10)
    const rawRelations = obj['relations'];
    if (Array.isArray(rawRelations)) {
      const relations = rawRelations
        .slice(0, 10)
        .filter(
          (r): r is { type: string; target?: string } =>
            r !== null &&
            typeof r === 'object' &&
            !Array.isArray(r) &&
            typeof (r as Record<string, unknown>)['type'] === 'string'
        )
        .map(r => {
          const rel: { type: string; target?: string } = {
            type: (r as Record<string, unknown>)['type'] as string,
          };
          const target = (r as Record<string, unknown>)['target'];
          if (typeof target === 'string' && target.trim().length > 0) {
            rel.target = target.trim();
          }
          return rel;
        });
      if (relations.length > 0) {
        result.relations = relations;
      }
    }

    // limit (cap at 200 to prevent unbounded result sets from LLM output)
    const rawLimit = obj['limit'];
    if (typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0) {
      result.limit = Math.min(rawLimit, 200);
    }

    return result;
  }

  /** Parse a value into a Date, returning null on failure. */
  private parseDate(value: unknown): Date | null {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
}
