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

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<MemoryFormatterConfig>> {
    return { ...this.config };
  }
}
