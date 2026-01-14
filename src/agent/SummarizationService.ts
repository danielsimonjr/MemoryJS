/**
 * Summarization Service
 *
 * Provides text summarization using LLM providers or fallback algorithms.
 * Supports similarity detection, observation grouping, and abstraction levels.
 *
 * @module agent/SummarizationService
 */

/**
 * Interface for summarization providers.
 */
export interface ISummarizationProvider {
  /** Summarize multiple texts into one */
  summarize(texts: string[]): Promise<string>;
  /** Check if provider is available */
  isAvailable(): boolean;
}

/**
 * Configuration for SummarizationService.
 */
export interface SummarizationConfig {
  /** Provider name ('openai', 'local', or 'none') */
  provider?: string;
  /** API key for LLM provider */
  apiKey?: string;
  /** Model to use for summarization */
  model?: string;
  /** Maximum tokens for summary output */
  maxTokens?: number;
  /** Default similarity threshold (0-1) */
  defaultSimilarityThreshold?: number;
}

/**
 * Result of grouping similar observations.
 */
export interface GroupingResult {
  /** Groups of similar observations */
  groups: string[][];
  /** Number of groups created */
  groupCount: number;
  /** Original observation count */
  originalCount: number;
}

/**
 * Service for summarizing text using LLM or fallback algorithms.
 *
 * SummarizationService provides text summarization capabilities with:
 * - LLM provider support (when configured)
 * - Fallback concatenation for local operation
 * - Text similarity calculation using TF-IDF
 * - Observation grouping by similarity
 *
 * @example
 * ```typescript
 * const service = new SummarizationService();
 *
 * // Summarize multiple observations
 * const summary = await service.summarize([
 *   'User likes Italian food',
 *   'User prefers Italian cuisine',
 *   'User enjoys pasta dishes'
 * ]);
 *
 * // Calculate similarity between texts
 * const similarity = service.calculateSimilarity(
 *   'User likes Italian food',
 *   'User prefers Italian cuisine'
 * );
 *
 * // Group similar observations
 * const groups = await service.groupSimilarObservations(
 *   observations,
 *   0.8 // threshold
 * );
 * ```
 */
export class SummarizationService {
  private provider?: ISummarizationProvider;
  private readonly config: Required<SummarizationConfig>;

  constructor(config: SummarizationConfig = {}) {
    this.config = {
      provider: config.provider ?? 'none',
      apiKey: config.apiKey ?? '',
      model: config.model ?? '',
      maxTokens: config.maxTokens ?? 150,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.8,
    };
    this.initProvider();
  }

  /**
   * Initialize LLM provider if configured.
   * @internal
   */
  private initProvider(): void {
    // Provider implementations would be registered here
    // For now, we use fallback summarization only
    if (
      this.config.provider === 'openai' &&
      this.config.apiKey
    ) {
      // OpenAI provider would be initialized here
      // this.provider = new OpenAISummarizer(this.config);
    }
  }

  // ==================== Summarization ====================

  /**
   * Summarize multiple texts into a single summary.
   *
   * Uses LLM provider if available, otherwise falls back to
   * algorithmic summarization.
   *
   * @param texts - Array of texts to summarize
   * @returns Combined summary
   */
  async summarize(texts: string[]): Promise<string> {
    if (texts.length === 0) return '';
    if (texts.length === 1) return texts[0];

    if (this.provider?.isAvailable()) {
      try {
        return await this.provider.summarize(texts);
      } catch {
        // Fall through to fallback
      }
    }

    return this.fallbackSummarize(texts);
  }

  /**
   * Fallback summarization using sentence extraction.
   *
   * Extracts unique sentences from all texts and combines them.
   *
   * @param texts - Array of texts to summarize
   * @returns Combined summary
   * @internal
   */
  private fallbackSummarize(texts: string[]): string {
    if (texts.length === 0) return '';
    if (texts.length === 1) return texts[0];

    // Extract unique sentences/phrases
    const sentences = new Set<string>();
    for (const text of texts) {
      // Split by sentence endings or newlines
      const parts = text
        .split(/[.!?]+|\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      parts.forEach((p) => sentences.add(p));
    }

    // If we have too many sentences, take the most informative
    const sentenceArray = Array.from(sentences);
    if (sentenceArray.length <= 3) {
      return sentenceArray.join('. ') + '.';
    }

    // For longer groups, pick representative sentences
    // Take first, middle, and last to capture breadth
    const representative = [
      sentenceArray[0],
      sentenceArray[Math.floor(sentenceArray.length / 2)],
      sentenceArray[sentenceArray.length - 1],
    ];

    return representative.join('. ') + '.';
  }

  // ==================== Similarity Detection ====================

  /**
   * Calculate similarity between two texts using TF-IDF cosine similarity.
   *
   * @param text1 - First text
   * @param text2 - Second text
   * @returns Similarity score (0-1)
   */
  calculateSimilarity(text1: string, text2: string): number {
    const tokens1 = this.tokenize(text1);
    const tokens2 = this.tokenize(text2);

    if (tokens1.length === 0 || tokens2.length === 0) {
      return 0;
    }

    // Build vocabulary from both texts
    const allTokens = new Set([...tokens1, ...tokens2]);

    // Build term frequency vectors
    const vec1 = this.buildTFVector(tokens1, allTokens);
    const vec2 = this.buildTFVector(tokens2, allTokens);

    // Calculate cosine similarity
    return this.cosineSimilarity(vec1, vec2);
  }

  /**
   * Tokenize text into words.
   * @internal
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Build term frequency vector.
   * @internal
   */
  private buildTFVector(tokens: string[], vocab: Set<string>): number[] {
    const freq = new Map<string, number>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return Array.from(vocab).map((t) => freq.get(t) ?? 0);
  }

  /**
   * Calculate cosine similarity between vectors.
   * @internal
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dot += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  // ==================== Observation Grouping ====================

  /**
   * Group similar observations by similarity threshold.
   *
   * @param observations - Array of observations to group
   * @param threshold - Similarity threshold (0-1, default from config)
   * @returns Grouped observations
   */
  async groupSimilarObservations(
    observations: string[],
    threshold?: number
  ): Promise<GroupingResult> {
    const effectiveThreshold = threshold ?? this.config.defaultSimilarityThreshold;

    if (observations.length <= 1) {
      return {
        groups: observations.length === 1 ? [observations] : [],
        groupCount: observations.length,
        originalCount: observations.length,
      };
    }

    const groups: string[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < observations.length; i++) {
      if (assigned.has(i)) continue;

      const group = [observations[i]];
      assigned.add(i);

      for (let j = i + 1; j < observations.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.calculateSimilarity(
          observations[i],
          observations[j]
        );

        if (similarity >= effectiveThreshold) {
          group.push(observations[j]);
          assigned.add(j);
        }
      }

      groups.push(group);
    }

    return {
      groups,
      groupCount: groups.length,
      originalCount: observations.length,
    };
  }

  /**
   * Summarize grouped observations.
   *
   * @param groups - Groups of observations from groupSimilarObservations
   * @returns Array of summaries (one per group)
   */
  async summarizeGroups(groups: string[][]): Promise<string[]> {
    const summaries: string[] = [];

    for (const group of groups) {
      if (group.length === 1) {
        summaries.push(group[0]);
      } else {
        const summary = await this.summarize(group);
        summaries.push(summary);
      }
    }

    return summaries;
  }

  // ==================== Configuration Access ====================

  /**
   * Check if LLM provider is available.
   */
  isLLMAvailable(): boolean {
    return this.provider?.isAvailable() ?? false;
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<SummarizationConfig>> {
    return { ...this.config };
  }

  /**
   * Register a summarization provider.
   *
   * @param provider - Provider to register
   */
  registerProvider(provider: ISummarizationProvider): void {
    this.provider = provider;
  }
}
