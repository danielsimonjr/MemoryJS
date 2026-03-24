/**
 * Memory Formatter
 *
 * Formats memories for LLM consumption with customizable templates.
 * Respects token limits and provides both prompt and JSON formats.
 *
 * @module agent/MemoryFormatter
 */

import type { AgentEntity, ContextPackage } from '../types/agent-memory.js';

/**
 * Configuration for MemoryFormatter.
 */
export interface MemoryFormatterConfig {
  /** Default maximum output tokens (default: 2000) */
  defaultMaxTokens?: number;
  /** Token estimation multiplier (default: 1.3) */
  tokenMultiplier?: number;
  /** Include timestamps in output (default: true) */
  includeTimestamps?: boolean;
  /** Include salience scores in output (default: false) */
  includeSalience?: boolean;
  /** Include memory type in output (default: true) */
  includeMemoryType?: boolean;
  /** Custom template for prompt format */
  promptTemplate?: string;
}

/**
 * Formats memories for LLM consumption.
 *
 * Provides multiple output formats optimized for different use cases:
 * - Prompt format: Human-readable text for inclusion in prompts
 * - JSON format: Structured data for tool use
 * - Compact format: Minimal tokens for constrained contexts
 *
 * @example
 * ```typescript
 * const formatter = new MemoryFormatter();
 * const promptText = formatter.formatForPrompt(memories, { maxTokens: 1000 });
 * const jsonData = formatter.formatAsJSON(contextPackage);
 * ```
 */
export class MemoryFormatter {
  private readonly config: Required<MemoryFormatterConfig>;
  private readonly defaultPromptTemplate: string;

  constructor(config: MemoryFormatterConfig = {}) {
    this.config = {
      defaultMaxTokens: config.defaultMaxTokens ?? 2000,
      tokenMultiplier: config.tokenMultiplier ?? 1.3,
      includeTimestamps: config.includeTimestamps ?? true,
      includeSalience: config.includeSalience ?? false,
      includeMemoryType: config.includeMemoryType ?? true,
      promptTemplate: config.promptTemplate ?? '',
    };

    this.defaultPromptTemplate = `## {name} ({type})
{observations}
{metadata}`;
  }

  // ==================== Prompt Format ====================

  /**
   * Format memories as text for LLM prompts.
   *
   * @param memories - Memories to format
   * @param options - Formatting options
   * @returns Formatted text string
   */
  formatForPrompt(
    memories: AgentEntity[],
    options: {
      maxTokens?: number;
      header?: string;
      separator?: string;
    } = {}
  ): string {
    const { maxTokens = this.config.defaultMaxTokens, header, separator = '\n\n' } = options;

    const parts: string[] = [];
    let estimatedTokens = 0;

    // Add header if provided
    if (header) {
      parts.push(header);
      estimatedTokens += this.estimateTokens(header);
    }

    // Format each memory
    for (const memory of memories) {
      const formatted = this.formatSingleMemory(memory);
      const memoryTokens = this.estimateTokens(formatted);

      if (estimatedTokens + memoryTokens > maxTokens) {
        // Add truncation indicator
        parts.push('... (additional memories truncated)');
        break;
      }

      parts.push(formatted);
      estimatedTokens += memoryTokens;
    }

    return parts.join(separator);
  }

  /**
   * Format a single memory entry.
   *
   * @param memory - Memory to format
   * @returns Formatted string
   */
  formatSingleMemory(memory: AgentEntity): string {
    const template = this.config.promptTemplate || this.defaultPromptTemplate;

    // Build observations text
    const observations = (memory.observations ?? [])
      .map((o) => `- ${o}`)
      .join('\n');

    // Build metadata text
    const metadataParts: string[] = [];
    if (this.config.includeMemoryType && memory.memoryType) {
      metadataParts.push(`Type: ${memory.memoryType}`);
    }
    if (this.config.includeTimestamps) {
      if (memory.createdAt) {
        metadataParts.push(`Created: ${this.formatTimestamp(memory.createdAt)}`);
      }
      if (memory.lastAccessedAt) {
        metadataParts.push(`Last accessed: ${this.formatTimestamp(memory.lastAccessedAt)}`);
      }
    }
    const metadata = metadataParts.length > 0 ? `[${metadataParts.join(' | ')}]` : '';

    // Apply template
    return template
      .replace('{name}', memory.name)
      .replace('{type}', memory.entityType)
      .replace('{observations}', observations)
      .replace('{metadata}', metadata)
      .trim();
  }

  // ==================== JSON Format ====================

  /**
   * Format memories as JSON for tool use.
   *
   * @param contextPackage - Context package with memories
   * @param options - Formatting options
   * @returns JSON-serializable object
   */
  formatAsJSON(
    contextPackage: ContextPackage,
    options: {
      includeBreakdown?: boolean;
      includeSuggestions?: boolean;
      compact?: boolean;
    } = {}
  ): object {
    const { includeBreakdown = true, includeSuggestions = true, compact = false } = options;

    if (compact) {
      return this.formatCompactJSON(contextPackage);
    }

    const result: Record<string, unknown> = {
      memories: contextPackage.memories.map((m) => this.memoryToJSON(m)),
      totalTokens: contextPackage.totalTokens,
    };

    if (includeBreakdown) {
      result.breakdown = contextPackage.breakdown;
    }

    if (includeSuggestions && contextPackage.suggestions.length > 0) {
      result.suggestions = contextPackage.suggestions;
    }

    if (contextPackage.excluded.length > 0) {
      result.excludedCount = contextPackage.excluded.length;
    }

    return result;
  }

  /**
   * Convert a single memory to JSON format.
   *
   * @param memory - Memory to convert
   * @returns JSON-serializable object
   */
  memoryToJSON(memory: AgentEntity): object {
    const result: Record<string, unknown> = {
      name: memory.name,
      type: memory.entityType,
      observations: memory.observations ?? [],
    };

    if (this.config.includeMemoryType && memory.memoryType) {
      result.memoryType = memory.memoryType;
    }

    if (this.config.includeTimestamps) {
      if (memory.createdAt) result.createdAt = memory.createdAt;
      if (memory.lastAccessedAt) result.lastAccessedAt = memory.lastAccessedAt;
    }

    if (memory.sessionId) result.sessionId = memory.sessionId;
    if (memory.taskId) result.taskId = memory.taskId;
    if (memory.importance !== undefined) result.importance = memory.importance;
    if (memory.confidence !== undefined) result.confidence = memory.confidence;

    return result;
  }

  /**
   * Format as compact JSON with minimal fields.
   * @internal
   */
  private formatCompactJSON(contextPackage: ContextPackage): object {
    return {
      m: contextPackage.memories.map((m) => ({
        n: m.name,
        t: m.entityType,
        o: m.observations ?? [],
      })),
      tokens: contextPackage.totalTokens,
    };
  }

  // ==================== Compact Format ====================

  /**
   * Format memories in minimal token format.
   * Useful for very constrained contexts.
   *
   * @param memories - Memories to format
   * @param maxTokens - Maximum tokens
   * @returns Compact text string
   */
  formatCompact(memories: AgentEntity[], maxTokens: number): string {
    const parts: string[] = [];
    let estimatedTokens = 0;

    for (const memory of memories) {
      // Ultra-compact format: name: first observation
      const firstObs = (memory.observations ?? [])[0] ?? '';
      const compact = `${memory.name}: ${firstObs}`;
      const tokens = this.estimateTokens(compact);

      if (estimatedTokens + tokens > maxTokens) break;

      parts.push(compact);
      estimatedTokens += tokens;
    }

    return parts.join('\n');
  }

  // ==================== Specialized Formats ====================

  /**
   * Format memories grouped by type.
   *
   * @param memories - Memories to format
   * @returns Grouped text format
   */
  formatByType(memories: AgentEntity[]): string {
    const groups = new Map<string, AgentEntity[]>();

    for (const memory of memories) {
      const type = memory.memoryType ?? 'other';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(memory);
    }

    const sections: string[] = [];
    const typeOrder = ['working', 'episodic', 'semantic', 'procedural', 'other'];

    for (const type of typeOrder) {
      const typeMemories = groups.get(type);
      if (typeMemories && typeMemories.length > 0) {
        sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} Memory\n`);
        sections.push(
          typeMemories
            .map((m) => this.formatSingleMemory(m))
            .join('\n\n')
        );
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Format memories as a summary.
   *
   * @param contextPackage - Context package
   * @returns Summary text
   */
  formatSummary(contextPackage: ContextPackage): string {
    const lines: string[] = [
      `## Memory Context Summary`,
      `Total memories: ${contextPackage.memories.length}`,
      `Estimated tokens: ${contextPackage.totalTokens}`,
      ``,
    ];

    // Breakdown
    const { breakdown } = contextPackage;
    lines.push('### Token Breakdown');
    if (breakdown.working > 0) lines.push(`- Working: ${breakdown.working} tokens`);
    if (breakdown.episodic > 0) lines.push(`- Episodic: ${breakdown.episodic} tokens`);
    if (breakdown.semantic > 0) lines.push(`- Semantic: ${breakdown.semantic} tokens`);
    if (breakdown.procedural > 0) lines.push(`- Procedural: ${breakdown.procedural} tokens`);
    if (breakdown.mustInclude > 0) lines.push(`- Must-include: ${breakdown.mustInclude} tokens`);

    // Excluded info
    if (contextPackage.excluded.length > 0) {
      lines.push('');
      lines.push(`### Excluded: ${contextPackage.excluded.length} memories`);
    }

    // Suggestions
    if (contextPackage.suggestions.length > 0) {
      lines.push('');
      lines.push('### Suggestions');
      for (const suggestion of contextPackage.suggestions) {
        lines.push(`- ${suggestion}`);
      }
    }

    return lines.join('\n');
  }

  // ==================== Helper Methods ====================

  /**
   * Estimate token count for text.
   * @internal
   */
  private estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * this.config.tokenMultiplier);
  }

  /**
   * Format timestamp for display.
   * @internal
   */
  private formatTimestamp(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // ==================== Salience Budget Allocation ====================

  /**
   * Format memories with token space allocated proportionally to salience score.
   *
   * Rather than truncating at a hard cut-off, this method distributes the
   * available token budget across memories in proportion to their salience
   * scores. High-salience memories get more tokens; low-salience memories
   * may be trimmed or dropped entirely when the budget is tight.
   *
   * Algorithm:
   * 1. Normalise salience scores to a probability distribution (sum = 1).
   * 2. Allocate `score_i / total * totalTokenBudget` tokens per memory.
   * 3. Format each memory; truncate observations to fit its allocation.
   * 4. Return the concatenated result.
   *
   * Memories with zero or missing salience score receive an equal share of
   * the remainder.
   *
   * @param memories - Memories to format (order not significant)
   * @param salienceScores - Map of entity name → salience score (0–1)
   * @param totalTokenBudget - Total token budget to distribute
   * @param options - Optional separator and header
   * @returns Formatted text respecting the salience-proportional budget
   *
   * @example
   * ```typescript
   * const scores = new Map([['mem_a', 0.9], ['mem_b', 0.1]]);
   * const text = formatter.formatWithSalienceBudget(memories, scores, 500);
   * ```
   */
  formatWithSalienceBudget(
    memories: AgentEntity[],
    salienceScores: Map<string, number>,
    totalTokenBudget: number,
    options: { separator?: string; header?: string } = {}
  ): string {
    if (memories.length === 0) return '';

    const { separator = '\n\n', header } = options;
    const parts: string[] = [];

    if (header) {
      const headerTokens = this.estimateTokens(header);
      totalTokenBudget = Math.max(0, totalTokenBudget - headerTokens);
      parts.push(header);
    }

    // Resolve salience scores, defaulting to equal weight for unknowns
    const rawScores = memories.map((m) => Math.max(0, salienceScores.get(m.name) ?? 0));
    const totalScore = rawScores.reduce((a, b) => a + b, 0);

    // If all scores are 0 fall back to equal allocation
    const normalised =
      totalScore === 0
        ? memories.map(() => 1 / memories.length)
        : rawScores.map((s) => s / totalScore);

    // Allocate token budgets proportionally
    const tokenAllocations = normalised.map((frac) =>
      Math.floor(frac * totalTokenBudget)
    );

    // Format each memory within its allocation
    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const allocation = tokenAllocations[i];
      if (allocation <= 0) continue;

      const formatted = this.formatSingleMemoryWithBudget(memory, allocation);
      if (formatted) {
        parts.push(formatted);
      }
    }

    return parts.join(separator);
  }

  /**
   * Format a single memory constrained to a token budget.
   *
   * Observations are included one-by-one until the budget is exhausted.
   * The memory header (name + type) is always included if it fits.
   *
   * @param memory - Memory to format
   * @param tokenBudget - Maximum tokens for this memory
   * @returns Formatted string (may be empty if budget is too small for header)
   *
   * @example
   * ```typescript
   * const formatted = formatter.formatSingleMemoryWithBudget(memory, 100);
   * ```
   */
  formatSingleMemoryWithBudget(memory: AgentEntity, tokenBudget: number): string {
    // Build header line
    const headerLine = `## ${memory.name} (${memory.entityType})`;
    const headerTokens = this.estimateTokens(headerLine);

    if (headerTokens > tokenBudget) return ''; // Not even header fits

    let usedTokens = headerTokens;
    const lines: string[] = [headerLine];

    // Add observations until budget exhausted
    for (const obs of memory.observations ?? []) {
      const obsLine = `- ${obs}`;
      const obsTokens = this.estimateTokens(obsLine);
      if (usedTokens + obsTokens > tokenBudget) break;
      lines.push(obsLine);
      usedTokens += obsTokens;
    }

    // Append metadata if space remains and config requests it
    const metaParts: string[] = [];
    if (this.config.includeMemoryType && memory.memoryType) {
      metaParts.push(`Type: ${memory.memoryType}`);
    }
    if (this.config.includeTimestamps && memory.createdAt) {
      metaParts.push(`Created: ${this.formatTimestamp(memory.createdAt)}`);
    }
    if (metaParts.length > 0) {
      const metaLine = `[${metaParts.join(' | ')}]`;
      if (usedTokens + this.estimateTokens(metaLine) <= tokenBudget) {
        lines.push(metaLine);
      }
    }

    return lines.join('\n').trim();
  }

  /**
   * Estimate token count for text.
   * Exposed as public for use in salience budget allocation tests.
   */
  estimateTokenCount(text: string): number {
    return this.estimateTokens(text);
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<MemoryFormatterConfig>> {
    return { ...this.config };
  }
}
