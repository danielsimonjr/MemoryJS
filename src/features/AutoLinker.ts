/**
 * Auto-Linker
 *
 * Automatically detects entity mentions in observation text and creates
 * 'mentions' relations between entities. Supports configurable matching
 * with word boundary detection, case sensitivity, and entity type filters.
 *
 * @module features/AutoLinker
 */

import type { Entity, Relation, IGraphStorage } from '../types/index.js';
import type { RelationManager } from '../core/RelationManager.js';

/**
 * Configuration options for auto-linking behavior.
 */
export interface AutoLinkOptions {
  /** Minimum entity name length to consider for matching (default: 4 characters) */
  minNameLength?: number;
  /** Only link entities of these types (default: all types) */
  allowedEntityTypes?: string[];
  /** Never link entities of these types */
  excludedEntityTypes?: string[];
  /** Whether matching is case-sensitive (default: false) */
  caseSensitive?: boolean;
  /** Relation type to create for mentions (default: 'mentions') */
  createRelationType?: string;
}

/**
 * Result of an auto-link operation.
 */
export interface AutoLinkResult {
  /** Name of the entity whose observations were scanned */
  sourceEntity: string;
  /** Names of entities that were mentioned in observations */
  mentionedEntities: string[];
  /** Number of new relations created (excludes duplicates) */
  relationsCreated: number;
}

/**
 * Common English words that should not be matched as entity names.
 * Prevents false positives when entity names coincide with common words.
 */
const STOPWORDS = new Set([
  'the', 'this', 'that', 'with', 'from', 'have', 'been',
  'were', 'they', 'their', 'them', 'then', 'than', 'what',
  'when', 'where', 'which', 'while', 'will', 'would', 'could',
  'should', 'about', 'after', 'before', 'between', 'each',
  'every', 'some', 'such', 'into', 'over', 'under', 'also',
  'does', 'done', 'doing', 'being', 'here', 'there', 'these',
  'those', 'just', 'only', 'very', 'much', 'many', 'more',
  'most', 'other', 'same', 'both', 'made', 'make', 'like',
  'well', 'back', 'even', 'still', 'also', 'know', 'take',
  'come', 'your', 'true', 'false', 'null', 'undefined', 'void',
  'test', 'type', 'name', 'data', 'none',
]);

/**
 * Escapes special regex characters in a string.
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in RegExp constructor
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Automatically detects entity mentions in observation text and creates relations.
 *
 * @example
 * ```typescript
 * const autoLinker = new AutoLinker(entityManager, relationManager, {
 *   minNameLength: 4,
 *   caseSensitive: false,
 * });
 *
 * // Detect mentions in text
 * const mentions = autoLinker.detectMentions(
 *   'Alice works with Bob on Project Apollo',
 *   knownEntities
 * );
 * // Returns: ['Alice', 'Project Apollo'] (if 'Bob' is < minNameLength)
 *
 * // Process observations and create relations
 * const result = await autoLinker.linkObservations('Charlie', [
 *   'Met with Alice to discuss Project Apollo'
 * ]);
 * ```
 */
export class AutoLinker {
  private defaultOptions: AutoLinkOptions;

  constructor(
    private storage: IGraphStorage,
    private relationManager: RelationManager,
    options?: AutoLinkOptions
  ) {
    this.defaultOptions = options || {};
  }

  /**
   * Detect entity mentions in text using word boundary matching.
   *
   * Filters candidates by minNameLength, entity type, and stopwords.
   * Skips self-references (the source entity itself).
   *
   * @param text - Text to scan for entity mentions
   * @param knownEntities - List of known entities to match against
   * @param sourceEntityName - Name of the source entity (excluded from matches)
   * @param options - Override options for this call
   * @returns Array of matched entity names
   */
  detectMentions(
    text: string,
    knownEntities: readonly Entity[],
    sourceEntityName?: string,
    options?: AutoLinkOptions
  ): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const opts = this.getEffectiveOptions(options);
    const mentions: string[] = [];

    // Filter candidate entities
    const candidates = knownEntities.filter(entity => {
      // Skip self-references
      if (sourceEntityName && entity.name === sourceEntityName) {
        return false;
      }

      // Skip short names
      if (entity.name.length < opts.minNameLength) {
        return false;
      }

      // Skip stopwords (case-insensitive check)
      if (STOPWORDS.has(entity.name.toLowerCase())) {
        return false;
      }

      // Filter by allowed entity types
      if (opts.allowedEntityTypes.length > 0) {
        if (!opts.allowedEntityTypes.includes(entity.entityType)) {
          return false;
        }
      }

      // Filter by excluded entity types
      if (opts.excludedEntityTypes.length > 0) {
        if (opts.excludedEntityTypes.includes(entity.entityType)) {
          return false;
        }
      }

      return true;
    });

    // Sort candidates by name length descending to match longer names first
    // This prevents shorter names from matching substrings of longer entity names
    candidates.sort((a, b) => b.name.length - a.name.length);

    for (const entity of candidates) {
      const escapedName = escapeRegExp(entity.name);
      const flags = opts.caseSensitive ? '' : 'i';
      const pattern = new RegExp(`\\b${escapedName}\\b`, flags);

      if (pattern.test(text)) {
        mentions.push(entity.name);
      }
    }

    return mentions;
  }

  /**
   * Process observations for an entity and create 'mentions' relations.
   *
   * Scans all provided observations for entity name mentions, checks for
   * existing relations to avoid duplicates, and creates new relations.
   *
   * @param entityName - Name of the entity whose observations to scan
   * @param observations - Array of observation texts to scan
   * @param options - Override options for this call
   * @returns Summary of auto-link results
   */
  async linkObservations(
    entityName: string,
    observations: string[],
    options?: AutoLinkOptions
  ): Promise<AutoLinkResult> {
    const opts = this.getEffectiveOptions(options);
    const result: AutoLinkResult = {
      sourceEntity: entityName,
      mentionedEntities: [],
      relationsCreated: 0,
    };

    if (observations.length === 0) {
      return result;
    }

    // Get all entities from storage
    const graph = await this.storage.loadGraph();
    const knownEntities = graph.entities;

    // Collect all unique mentions across all observations
    const allMentions = new Set<string>();
    for (const observation of observations) {
      const mentions = this.detectMentions(observation, knownEntities, entityName, options);
      for (const mention of mentions) {
        allMentions.add(mention);
      }
    }

    if (allMentions.size === 0) {
      return result;
    }

    // Get existing relations for the source entity to check for duplicates
    const existingRelations = await this.relationManager.getRelations(entityName);
    const existingMentionTargets = new Set(
      existingRelations
        .filter(r => r.from === entityName && r.relationType === opts.createRelationType)
        .map(r => r.to)
    );

    // Create new relations for mentions that don't already exist
    const newRelations: Relation[] = [];
    for (const mentionedEntity of allMentions) {
      if (!existingMentionTargets.has(mentionedEntity)) {
        newRelations.push({
          from: entityName,
          to: mentionedEntity,
          relationType: opts.createRelationType,
        });
      }
    }

    result.mentionedEntities = Array.from(allMentions);

    if (newRelations.length > 0) {
      const created = await this.relationManager.createRelations(newRelations);
      result.relationsCreated = created.length;
    }

    return result;
  }

  /**
   * Merge instance defaults with call-specific options, applying defaults for unset values.
   *
   * @param options - Call-specific options to merge
   * @returns Fully resolved options with all required fields
   */
  private getEffectiveOptions(options?: AutoLinkOptions): Required<AutoLinkOptions> {
    return {
      minNameLength: options?.minNameLength ?? this.defaultOptions.minNameLength ?? 4,
      allowedEntityTypes: options?.allowedEntityTypes ?? this.defaultOptions.allowedEntityTypes ?? [],
      excludedEntityTypes: options?.excludedEntityTypes ?? this.defaultOptions.excludedEntityTypes ?? [],
      caseSensitive: options?.caseSensitive ?? this.defaultOptions.caseSensitive ?? false,
      createRelationType: options?.createRelationType ?? this.defaultOptions.createRelationType ?? 'mentions',
    };
  }
}
