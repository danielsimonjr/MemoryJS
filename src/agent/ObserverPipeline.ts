/**
 * Observer Pipeline
 *
 * Event-driven observation processing pipeline that scores, categorizes,
 * and optionally tags/routes observations as they are added to the graph.
 *
 * Listens to `observation:added` events from GraphEventEmitter and
 * applies heuristic scoring, category detection, and auto-tagging.
 *
 * @module agent/ObserverPipeline
 */

import type { EntityManager } from '../core/EntityManager.js';
import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import type { ObservationAddedEvent } from '../types/types.js';

// ==================== Types ====================

/**
 * Scored observation with metadata from the pipeline.
 */
export interface ObservationScore {
  /** The observation text */
  observation: string;
  /** Entity the observation belongs to */
  entityName: string;
  /** Importance score (0-1) */
  score: number;
  /** Detected category (task, decision, fact, preference, etc.) */
  category?: string;
  /** Auto-detected tags based on content */
  suggestedTags?: string[];
  /** Suggested entity type for routing */
  suggestedType?: string;
}

/**
 * Configuration options for the ObserverPipeline.
 */
export interface ObserverPipelineOptions {
  /** Minimum importance threshold; observations below this are dropped (default: 0.3) */
  minImportanceThreshold?: number;
  /** Automatically tag entities based on observation content (default: true) */
  autoTag?: boolean;
  /** Automatically suggest entity type routing (default: false) */
  autoRoute?: boolean;
  /** Custom category patterns to override or extend defaults */
  categoryPatterns?: Record<string, RegExp>;
}

/**
 * Processing statistics for the pipeline.
 */
export interface ObserverPipelineStats {
  /** Total observations processed */
  processed: number;
  /** Observations dropped below threshold */
  dropped: number;
  /** Observations that triggered auto-tagging */
  tagged: number;
  /** Observations that triggered auto-routing */
  routed: number;
}

// ==================== Default Category Patterns ====================

const DEFAULT_CATEGORY_PATTERNS: Record<string, RegExp> = {
  'task': /(?:TODO|FIXME|HACK|task|action item|need to|should|must)\b/i,
  'decision': /(?:decided|agreed|chosen|selected|will use|going with)\b/i,
  'fact': /(?:is a|works at|located in|created by|owned by|uses)\b/i,
  'preference': /(?:prefers?|likes?|wants?|favorites?|dislikes?)\b/i,
  'problem': /(?:bug|issue|error|broken|fails?|crash(?:es|ed)?|problem)\b/i,
  'learning': /(?:learned|discovered|found out|realized|TIL)\b/i,
};

// ==================== Category to Tag Mapping ====================

const CATEGORY_TAG_MAP: Record<string, string[]> = {
  'task': ['actionable'],
  'decision': ['decision'],
  'fact': ['factual'],
  'preference': ['preference'],
  'problem': ['issue'],
  'learning': ['insight'],
};

// ==================== Category to Entity Type Mapping ====================

const CATEGORY_TYPE_MAP: Record<string, string> = {
  'task': 'task',
  'decision': 'decision',
  'fact': 'fact',
  'preference': 'preference',
  'problem': 'issue',
  'learning': 'learning',
};

/**
 * Event-driven observation processing pipeline.
 *
 * Scores, categorizes, and optionally tags observations as they are added
 * to the knowledge graph. Integrates with GraphEventEmitter for automatic
 * processing and provides manual batch processing.
 *
 * @example
 * ```typescript
 * const pipeline = new ObserverPipeline(entityManager, {
 *   minImportanceThreshold: 0.3,
 *   autoTag: true,
 * });
 *
 * // Attach to event emitter for automatic processing
 * const detach = pipeline.attach(emitter);
 *
 * // Listen for scored observations
 * pipeline.onScored((scored) => {
 *   console.log(`${scored.entityName}: ${scored.score} (${scored.category})`);
 * });
 *
 * // Later: detach();
 * ```
 */
export class ObserverPipeline {
  private stats: ObserverPipelineStats;
  private categoryPatterns: Map<string, RegExp>;
  private listeners: Array<(scored: ObservationScore) => void>;
  private active: boolean;
  private readonly minImportanceThreshold: number;
  private readonly autoTag: boolean;
  private readonly autoRoute: boolean;

  constructor(
    private entityManager: EntityManager,
    options?: ObserverPipelineOptions
  ) {
    this.stats = { processed: 0, dropped: 0, tagged: 0, routed: 0 };
    this.listeners = [];
    this.active = false;

    this.minImportanceThreshold = options?.minImportanceThreshold ?? 0.3;
    this.autoTag = options?.autoTag ?? true;
    this.autoRoute = options?.autoRoute ?? false;

    // Build category patterns from defaults + custom overrides
    this.categoryPatterns = new Map<string, RegExp>();
    if (options?.categoryPatterns) {
      // Custom patterns replace defaults entirely
      for (const [category, pattern] of Object.entries(options.categoryPatterns)) {
        this.categoryPatterns.set(category, pattern);
      }
    } else {
      for (const [category, pattern] of Object.entries(DEFAULT_CATEGORY_PATTERNS)) {
        this.categoryPatterns.set(category, pattern);
      }
    }
  }

  // ==================== Event Attachment ====================

  /**
   * Start listening to observation events from a GraphEventEmitter.
   *
   * Subscribes to `observation:added` events and processes each
   * observation through the scoring pipeline.
   *
   * @param emitter - GraphEventEmitter to attach to
   * @returns Detach function to stop listening
   */
  attach(emitter: GraphEventEmitter): () => void {
    this.active = true;

    const handler = (event: ObservationAddedEvent) => {
      if (!this.active) return;

      for (const observation of event.observations) {
        const scored = this.scoreObservation(observation, event.entityName);
        this.stats.processed++;

        if (scored.score < this.minImportanceThreshold) {
          this.stats.dropped++;
          continue;
        }

        // Auto-tag if enabled
        if (this.autoTag && scored.suggestedTags && scored.suggestedTags.length > 0) {
          this.stats.tagged++;
          // Fire-and-forget tag update (don't block the pipeline)
          this.entityManager.addTags(scored.entityName, scored.suggestedTags).catch(() => {
            // Silently ignore tag errors (entity may not exist yet in race conditions)
          });
        }

        // Track routed observations
        if (this.autoRoute && scored.suggestedType) {
          this.stats.routed++;
        }

        // Notify listeners
        for (const listener of this.listeners) {
          try {
            listener(scored);
          } catch {
            // Silently ignore listener errors
          }
        }
      }
    };

    const unsubscribe = emitter.on('observation:added', handler);

    return () => {
      this.active = false;
      unsubscribe();
    };
  }

  // ==================== Scoring ====================

  /**
   * Score a single observation using heuristic analysis.
   *
   * Scoring factors:
   * - Length: Longer observations (up to a point) score higher
   * - Named entities: Capitalized words boost score
   * - Specificity: Numbers and dates boost score
   * - Category match: Matching a known category boosts score
   *
   * @param observation - The observation text to score
   * @param entityName - The entity this observation belongs to
   * @returns Scored observation with category and tag suggestions
   */
  scoreObservation(observation: string, entityName: string): ObservationScore {
    const factors: number[] = [];

    // Factor 1: Length scoring (0-1)
    // Short observations (< 10 chars) score low, optimal at ~80 chars
    const lengthScore = Math.min(1, observation.length / 80);
    factors.push(lengthScore);

    // Factor 2: Named entities (capitalized words that aren't sentence starters)
    const words = observation.split(/\s+/);
    const capitalizedWords = words.filter((w, i) => {
      if (i === 0) return false; // Skip first word
      return w.length > 1 && /^[A-Z][a-z]/.test(w);
    });
    const entityScore = Math.min(1, capitalizedWords.length * 0.3);
    factors.push(entityScore);

    // Factor 3: Specificity (numbers, dates, measurements)
    const hasNumbers = /\d+/.test(observation);
    const hasDates = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(observation);
    const specificityScore = (hasNumbers ? 0.4 : 0) + (hasDates ? 0.4 : 0);
    factors.push(Math.min(1, specificityScore));

    // Factor 4: Category match
    const category = this.categorize(observation);
    const categoryScore = category ? 0.6 : 0;
    factors.push(categoryScore);

    // Combine factors with equal weights
    const weights = [0.25, 0.25, 0.25, 0.25];
    let score = factors.reduce((sum, factor, i) => sum + factor * weights[i], 0);

    // Normalize to 0-1
    score = Math.min(1, Math.max(0, score));

    // Build suggested tags from category
    const suggestedTags: string[] = [];
    if (category && CATEGORY_TAG_MAP[category]) {
      suggestedTags.push(...CATEGORY_TAG_MAP[category]);
    }

    // Build suggested type from category
    let suggestedType: string | undefined;
    if (this.autoRoute && category && CATEGORY_TYPE_MAP[category]) {
      suggestedType = CATEGORY_TYPE_MAP[category];
    }

    return {
      observation,
      entityName,
      score,
      category,
      suggestedTags: suggestedTags.length > 0 ? suggestedTags : undefined,
      suggestedType,
    };
  }

  // ==================== Categorization ====================

  /**
   * Categorize observation text using registered patterns.
   *
   * Tests the observation against all registered category patterns
   * and returns the first match.
   *
   * @param text - Observation text to categorize
   * @returns Category name if matched, undefined otherwise
   */
  categorize(text: string): string | undefined {
    for (const [category, pattern] of this.categoryPatterns) {
      if (pattern.test(text)) {
        return category;
      }
    }
    return undefined;
  }

  // ==================== Batch Processing ====================

  /**
   * Process a batch of observations through the scoring pipeline.
   *
   * Scores all observations and filters by the importance threshold.
   *
   * @param observations - Array of entity names and observation contents
   * @returns Scored observations that pass the threshold
   */
  processBatch(
    observations: { entityName: string; contents: string[] }[]
  ): ObservationScore[] {
    const results: ObservationScore[] = [];

    for (const { entityName, contents } of observations) {
      for (const content of contents) {
        const scored = this.scoreObservation(content, entityName);
        this.stats.processed++;

        if (scored.score >= this.minImportanceThreshold) {
          results.push(scored);
        } else {
          this.stats.dropped++;
        }
      }
    }

    return results;
  }

  // ==================== Listener Management ====================

  /**
   * Register a listener for scored observations.
   *
   * Listeners are called for each observation that passes the threshold
   * during event-driven processing via attach().
   *
   * @param listener - Callback to invoke with scored observations
   * @returns Unsubscribe function to remove the listener
   */
  onScored(listener: (scored: ObservationScore) => void): () => void {
    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // ==================== Statistics ====================

  /**
   * Get current processing statistics.
   *
   * @returns Copy of the current stats
   */
  getStats(): ObserverPipelineStats {
    return { ...this.stats };
  }

  /**
   * Reset all processing statistics to zero.
   */
  resetStats(): void {
    this.stats = { processed: 0, dropped: 0, tagged: 0, routed: 0 };
  }
}
