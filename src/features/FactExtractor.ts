/**
 * Fact Extractor
 *
 * Phase 3B: Extracts structured facts (subject-relation-object triples)
 * from observation text using rule-based pattern matching.
 *
 * @module features/FactExtractor
 */

import type { EntityManager } from '../core/EntityManager.js';
import type { RelationManager } from '../core/RelationManager.js';

/**
 * A structured fact extracted from observation text.
 */
export interface ExtractedFact {
  /** Normalized entity name (subject of the fact) */
  subject: string;
  /** Relation type (e.g., 'works_at', 'is_a', 'uses', 'prefers') */
  relation: string;
  /** Normalized entity/value name (object of the fact) */
  object: string;
  /** Extraction confidence (0-1) */
  confidence: number;
  /** Original observation text the fact was extracted from */
  sourceText: string;
}

/**
 * Options for fact extraction.
 */
export interface FactExtractionOptions {
  /** Extraction mode (only 'rule' supported for now) */
  mode?: 'rule';
  /** Minimum confidence to keep (default: 0.5) */
  minConfidence?: number;
  /** Lowercase + strip titles (default: true) */
  normalizeNames?: boolean;
  /** Auto-create extracted entities (default: false) */
  createEntities?: boolean;
  /** Auto-create extracted relations (default: true) */
  createRelations?: boolean;
}

/**
 * Result of extracting and persisting facts.
 */
export interface FactExtractionResult {
  /** All extracted facts (after filtering by minConfidence) */
  facts: ExtractedFact[];
  /** Names of entities that were created */
  entitiesCreated: string[];
  /** Number of relations created */
  relationsCreated: number;
}

/**
 * A pattern definition for rule-based extraction.
 */
interface ExtractionPattern {
  pattern: RegExp;
  relation: string;
  confidence: number;
  subjectGroup: number;
  objectGroup: number;
}

/**
 * Common title prefixes to strip during name normalization.
 */
const TITLE_PREFIXES = /^(dr\.|mr\.|mrs\.|ms\.|prof\.|sr\.|jr\.)\s*/i;

/**
 * Fact Extractor extracts structured facts from observation text.
 *
 * Uses rule-based pattern matching to identify subject-relation-object triples.
 * Can optionally persist extracted facts as entities and relations in the knowledge graph.
 *
 * @example
 * ```typescript
 * const extractor = new FactExtractor();
 * const facts = extractor.extract('Alice works at Google');
 * // [{ subject: 'alice', relation: 'works_at', object: 'google', confidence: 0.9, sourceText: '...' }]
 * ```
 *
 * @example
 * ```typescript
 * // With persistence
 * const extractor = new FactExtractor(entityManager, relationManager);
 * const result = await extractor.extractAndPersist('Alice', ['Alice works at Google']);
 * // result.relationsCreated === 1
 * ```
 */
export class FactExtractor {
  private patterns: ExtractionPattern[];

  constructor(
    private entityManager?: EntityManager,
    private relationManager?: RelationManager
  ) {
    this.patterns = this.buildPatterns();
  }

  /**
   * Extract facts from text using rule-based patterns.
   *
   * @param text - The observation text to extract facts from
   * @param options - Extraction options
   * @returns Array of extracted facts
   */
  extract(text: string, options: FactExtractionOptions = {}): ExtractedFact[] {
    const {
      minConfidence = 0.5,
      normalizeNames = true,
    } = options;

    const facts: ExtractedFact[] = [];

    for (const { pattern, relation, confidence, subjectGroup, objectGroup } of this.patterns) {
      const match = text.match(pattern);
      if (match && match[subjectGroup] && match[objectGroup]) {
        let subject = match[subjectGroup].trim();
        let object = match[objectGroup].trim();

        if (normalizeNames) {
          subject = this.normalizeName(subject);
          object = this.normalizeName(object);
        }

        // Skip empty subjects or objects after normalization
        if (!subject || !object) {
          continue;
        }

        if (confidence >= minConfidence) {
          facts.push({
            subject,
            relation,
            object,
            confidence,
            sourceText: text,
          });
        }
      }
    }

    return facts;
  }

  /**
   * Extract facts from observations and persist them to the knowledge graph.
   *
   * @param entityName - The entity whose observations are being processed
   * @param observations - Array of observation strings to extract facts from
   * @param options - Extraction and persistence options
   * @returns Result with extracted facts, created entities, and created relations
   */
  async extractAndPersist(
    _entityName: string,
    observations: string[],
    options: FactExtractionOptions = {}
  ): Promise<FactExtractionResult> {
    const {
      minConfidence = 0.5,
      createEntities = false,
      createRelations = true,
    } = options;

    // Extract facts from all observations
    const allFacts: ExtractedFact[] = [];
    for (const observation of observations) {
      const facts = this.extract(observation, { ...options, minConfidence });
      allFacts.push(...facts);
    }

    // Deduplicate by subject+relation+object
    const seen = new Set<string>();
    const uniqueFacts = allFacts.filter(fact => {
      const key = `${fact.subject}\0${fact.relation}\0${fact.object}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const entitiesCreated: string[] = [];
    let relationsCreated = 0;

    // Create entities if enabled
    if (createEntities && this.entityManager) {
      const entityNames = new Set<string>();
      for (const fact of uniqueFacts) {
        entityNames.add(fact.subject);
        entityNames.add(fact.object);
      }

      for (const name of entityNames) {
        const existing = await this.entityManager.getEntity(name);
        if (!existing) {
          const created = await this.entityManager.createEntities([{
            name,
            entityType: 'extracted',
            observations: [],
          }]);
          if (created.length > 0) {
            entitiesCreated.push(name);
          }
        }
      }
    }

    // Create relations if enabled
    if (createRelations && this.relationManager) {
      for (const fact of uniqueFacts) {
        const fromName = fact.subject;
        const toName = fact.object;

        const weight = fact.confidence;

        try {
          const created = await this.relationManager.createRelations([{
            from: fromName,
            to: toName,
            relationType: fact.relation,
            weight,
            confidence: fact.confidence,
          }]);
          relationsCreated += created.length;
        } catch {
          // Silently skip relations that can't be created
          // (e.g., entities don't exist and createEntities is false)
        }
      }
    }

    return {
      facts: uniqueFacts,
      entitiesCreated,
      relationsCreated,
    };
  }

  /**
   * Normalize an entity name.
   *
   * - Convert to lowercase
   * - Strip common titles (Dr., Mr., Mrs., Ms., Prof., Sr., Jr.)
   * - Trim whitespace
   * - Collapse multiple spaces
   *
   * @param name - The name to normalize
   * @returns Normalized name
   */
  normalizeName(name: string): string {
    let normalized = name.toLowerCase().trim();

    // Strip common titles
    normalized = normalized.replace(TITLE_PREFIXES, '');

    // Collapse multiple spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  /**
   * Build the set of extraction patterns.
   * Patterns are ordered by specificity (more specific first).
   */
  private buildPatterns(): ExtractionPattern[] {
    // Object capture group stops at clause boundaries (punctuation, conjunctions,
    // prepositions) to avoid greedily matching trailing words.
    // e.g. "Alice works at Google on Mondays" captures "Google" not "Google on Mondays"
    // Allows hyphens in names (e.g. "US-East", "AT&T") via [\w\s-]
    const OBJ = '([\\w][\\w\\s-]*?)(?=\\s+(?:on|in|at|for|with|from|since|during|after|before|and|or|but|who|which|that)\\b|[.,;!?]|$)';

    return [
      // High confidence (0.85-0.9)
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+works?\\s+(?:at|for)\\s+${OBJ}`, 'i'),
        relation: 'works_at',
        confidence: 0.9,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+(?:is\\s+)?located\\s+in\\s+${OBJ}`, 'i'),
        relation: 'located_in',
        confidence: 0.9,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+is\\s+(?:a|an)\\s+${OBJ}`, 'i'),
        relation: 'is_a',
        confidence: 0.85,
        subjectGroup: 1,
        objectGroup: 2,
      },

      // Medium confidence (0.7-0.8)
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+(?:was\\s+)?created\\s+by\\s+${OBJ}`, 'i'),
        relation: 'created_by',
        confidence: 0.8,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+(?:is\\s+)?owned\\s+by\\s+${OBJ}`, 'i'),
        relation: 'owned_by',
        confidence: 0.8,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+(?:is\\s+)?part\\s+of\\s+${OBJ}`, 'i'),
        relation: 'part_of',
        confidence: 0.8,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+prefers?\\s+${OBJ}`, 'i'),
        relation: 'prefers',
        confidence: 0.75,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+depends?\\s+on\\s+${OBJ}`, 'i'),
        relation: 'depends_on',
        confidence: 0.75,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+uses?\\s+${OBJ}`, 'i'),
        relation: 'uses',
        confidence: 0.7,
        subjectGroup: 1,
        objectGroup: 2,
      },
      {
        pattern: new RegExp(`([\\w][\\w\\s-]*?)\\s+manages?\\s+${OBJ}`, 'i'),
        relation: 'manages',
        confidence: 0.7,
        subjectGroup: 1,
        objectGroup: 2,
      },
    ];
  }
}
