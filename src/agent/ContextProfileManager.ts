/**
 * Context Profile Manager
 *
 * Manages named context profiles that tune retrieval strategy based on task type.
 * Profiles configure salience weights, temporal focus, and budget allocation
 * to optimize memory retrieval for different scenarios (planning, incident response, etc.).
 *
 * @module agent/ContextProfileManager
 */

import type { SalienceContext, TemporalFocus } from '../types/agent-memory.js';

// ==================== Types ====================

/**
 * Built-in context profile names.
 * - default: Balanced weights for general use
 * - planning: Emphasizes importance and context for architectural decisions
 * - incident: Prioritizes recency and importance for urgent situations
 * - handoff: Optimizes for session continuity and context
 * - review: Balanced with high context weight for retrospectives
 * - auto: Automatically inferred from query text
 */
export type ContextProfile = 'default' | 'planning' | 'incident' | 'handoff' | 'review' | 'auto';

/**
 * Configuration for a context profile.
 *
 * Defines salience weights, temporal focus, budget allocation,
 * and optional entity type preferences for memory retrieval.
 *
 * @example
 * ```typescript
 * const config: ProfileConfig = {
 *   salienceWeights: {
 *     importanceWeight: 0.35,
 *     recencyWeight: 0.10,
 *     frequencyWeight: 0.15,
 *     contextWeight: 0.30,
 *     noveltyWeight: 0.10,
 *   },
 *   temporalFocus: 'historical',
 *   budgetAllocation: { working: 20, episodic: 30, semantic: 50 },
 *   preferredEntityTypes: ['concept', 'project', 'architecture'],
 * };
 * ```
 */
export interface ProfileConfig {
  /** Weights for salience scoring components */
  salienceWeights: {
    importanceWeight: number;
    recencyWeight: number;
    frequencyWeight: number;
    contextWeight: number;
    noveltyWeight: number;
  };
  /** Temporal focus for retrieval prioritization */
  temporalFocus: TemporalFocus;
  /** Budget allocation percentages (should sum to ~100) */
  budgetAllocation: { working: number; episodic: number; semantic: number };
  /** Preferred entity types for filtering */
  preferredEntityTypes?: string[];
  /** Override max tokens for this profile */
  maxTokens?: number;
}

// ==================== Auto-Detection Patterns ====================

const INCIDENT_PATTERN = /outage|sev[0-4]|broken|down|emergency|incident|alert|page/i;
const PLANNING_PATTERN = /plan|architect|design|roadmap|strategy|proposal/i;
const HANDOFF_PATTERN = /resume|continue|where.*left|pick.*up|hand.*off|catch.*up/i;
const REVIEW_PATTERN = /review|retrospect|recap|summary|what.*happened/i;

// ==================== Preset Profiles ====================

function createPresetProfiles(): Map<string, ProfileConfig> {
  const profiles = new Map<string, ProfileConfig>();

  profiles.set('default', {
    salienceWeights: {
      importanceWeight: 0.25,
      recencyWeight: 0.25,
      frequencyWeight: 0.20,
      contextWeight: 0.20,
      noveltyWeight: 0.10,
    },
    temporalFocus: 'balanced',
    budgetAllocation: { working: 34, episodic: 33, semantic: 33 },
  });

  profiles.set('planning', {
    salienceWeights: {
      importanceWeight: 0.35,
      recencyWeight: 0.10,
      frequencyWeight: 0.15,
      contextWeight: 0.30,
      noveltyWeight: 0.10,
    },
    temporalFocus: 'historical',
    budgetAllocation: { working: 20, episodic: 30, semantic: 50 },
    preferredEntityTypes: ['concept', 'project', 'architecture'],
  });

  profiles.set('incident', {
    salienceWeights: {
      importanceWeight: 0.30,
      recencyWeight: 0.40,
      frequencyWeight: 0.10,
      contextWeight: 0.15,
      noveltyWeight: 0.05,
    },
    temporalFocus: 'recent',
    budgetAllocation: { working: 50, episodic: 30, semantic: 20 },
  });

  profiles.set('handoff', {
    salienceWeights: {
      importanceWeight: 0.20,
      recencyWeight: 0.35,
      frequencyWeight: 0.10,
      contextWeight: 0.25,
      noveltyWeight: 0.10,
    },
    temporalFocus: 'recent',
    budgetAllocation: { working: 40, episodic: 40, semantic: 20 },
  });

  profiles.set('review', {
    salienceWeights: {
      importanceWeight: 0.25,
      recencyWeight: 0.15,
      frequencyWeight: 0.15,
      contextWeight: 0.30,
      noveltyWeight: 0.15,
    },
    temporalFocus: 'balanced',
    budgetAllocation: { working: 20, episodic: 50, semantic: 30 },
  });

  return profiles;
}

// ==================== ContextProfileManager ====================

/**
 * Manages named context profiles for tuning retrieval strategy.
 *
 * Provides preset profiles for common scenarios and supports
 * custom profile registration. Can auto-detect appropriate profiles
 * from query text using regex pattern matching.
 *
 * @example
 * ```typescript
 * const manager = new ContextProfileManager();
 *
 * // Get a preset profile
 * const config = manager.getProfile('incident');
 *
 * // Auto-detect from query
 * const profile = manager.inferProfile("There's an outage in production");
 * // Returns 'incident'
 *
 * // Register a custom profile
 * manager.registerProfile('debugging', {
 *   salienceWeights: { importanceWeight: 0.20, recencyWeight: 0.40, ... },
 *   temporalFocus: 'recent',
 *   budgetAllocation: { working: 50, episodic: 30, semantic: 20 },
 * });
 * ```
 */
export class ContextProfileManager {
  private readonly profiles: Map<string, ProfileConfig>;

  constructor() {
    this.profiles = createPresetProfiles();
  }

  /**
   * Get profile configuration by name.
   *
   * For 'auto' profile, returns the default profile config.
   * Use `inferProfile()` to determine the appropriate profile from query text,
   * then call `getProfile()` with the inferred name.
   *
   * @param name - Profile name (built-in or custom)
   * @returns Profile configuration
   * @throws Error if profile name is not registered
   */
  getProfile(name: ContextProfile | string): ProfileConfig {
    // 'auto' resolves to 'default' when no query context is available
    const resolvedName = name === 'auto' ? 'default' : name;
    const profile = this.profiles.get(resolvedName);
    if (!profile) {
      throw new Error(`Unknown context profile: '${name}'. Available profiles: ${this.getAvailableProfiles().join(', ')}`);
    }
    return profile;
  }

  /**
   * Register a custom profile.
   *
   * @param name - Profile name (can override built-in profiles)
   * @param config - Profile configuration
   */
  registerProfile(name: string, config: ProfileConfig): void {
    this.profiles.set(name, config);
  }

  /**
   * Infer appropriate profile from query text using regex pattern matching.
   *
   * Tests query against known patterns in priority order:
   * 1. incident (outage, sev0-4, broken, emergency, etc.)
   * 2. planning (plan, architect, design, roadmap, etc.)
   * 3. handoff (resume, continue, where left off, etc.)
   * 4. review (review, retrospect, recap, summary, etc.)
   * 5. default (fallback)
   *
   * @param query - Query text to analyze
   * @returns Inferred profile name
   */
  inferProfile(query: string): ContextProfile {
    if (!query) return 'default';

    if (INCIDENT_PATTERN.test(query)) return 'incident';
    if (PLANNING_PATTERN.test(query)) return 'planning';
    if (HANDOFF_PATTERN.test(query)) return 'handoff';
    if (REVIEW_PATTERN.test(query)) return 'review';

    return 'default';
  }

  /**
   * Build a SalienceContext from a profile configuration.
   *
   * Merges profile settings (temporal focus, metadata) with an optional
   * base context. Profile settings take precedence unless explicitly
   * overridden in the base context.
   *
   * @param profile - Profile name to build context from
   * @param baseContext - Optional base context to merge with
   * @returns SalienceContext configured for the profile
   */
  buildSalienceContext(profile: ContextProfile | string, baseContext?: SalienceContext): SalienceContext {
    const resolvedProfile = profile === 'auto'
      ? this.inferProfile(baseContext?.queryText ?? '')
      : profile;
    const config = this.getProfile(resolvedProfile);

    const context: SalienceContext = {
      ...baseContext,
      temporalFocus: baseContext?.temporalFocus ?? config.temporalFocus,
      metadata: {
        ...baseContext?.metadata,
        contextProfile: resolvedProfile,
        preferredEntityTypes: config.preferredEntityTypes,
      },
    };

    return context;
  }

  /**
   * Get all registered profile names.
   *
   * @returns Array of profile names (built-in and custom)
   */
  getAvailableProfiles(): string[] {
    return Array.from(this.profiles.keys());
  }
}
