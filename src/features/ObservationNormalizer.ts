/**
 * Observation Normalizer
 *
 * Phase 11: Transforms observations to be self-contained facts
 * through coreference resolution and temporal anchoring.
 *
 * @module features/ObservationNormalizer
 */

import type { Entity } from '../types/index.js';

/**
 * Options for observation normalization.
 */
export interface NormalizationOptions {
  /** Resolve pronouns to entity names */
  resolveCoreferences?: boolean;
  /** Convert relative dates to absolute dates */
  anchorTimestamps?: boolean;
  /** Extract and tag keywords */
  extractKeywords?: boolean;
  /** Reference date for relative date conversion (default: now) */
  referenceDate?: Date;
}

/**
 * Result of normalizing an observation.
 */
export interface NormalizationResult {
  original: string;
  normalized: string;
  changes: string[];
  keywords?: string[];
}

/**
 * Observation Normalizer transforms observations to self-contained facts.
 *
 * Applies transformations:
 * 1. Coreference resolution: 'He works' -> 'Alice works'
 * 2. Temporal anchoring: 'yesterday' -> '2026-01-07'
 * 3. Keyword extraction: Identifies important terms
 *
 * @example
 * ```typescript
 * const normalizer = new ObservationNormalizer();
 * const result = normalizer.normalize(
 *   'He started the project yesterday',
 *   { name: 'Bob', entityType: 'person', observations: [] }
 * );
 * // result.normalized = 'Bob started the project on 2026-01-07'
 * ```
 */
export class ObservationNormalizer {
  private pronounPatterns = {
    masculine: /\b(he|him|his)\b/gi,
    feminine: /\b(she|her|hers)\b/gi,
    neutral: /\b(they|them|their|theirs)\b/gi,
  };

  private relativeTimePatterns: [RegExp, (ref: Date) => string][] = [
    [/\byesterday\b/i, (ref) => this.formatDate(this.addDays(ref, -1))],
    [/\btoday\b/i, (ref) => this.formatDate(ref)],
    [/\btomorrow\b/i, (ref) => this.formatDate(this.addDays(ref, 1))],
    [/\blast week\b/i, (ref) => `week of ${this.formatDate(this.addDays(ref, -7))}`],
    [/\blast month\b/i, (ref) => this.formatMonth(this.addMonths(ref, -1))],
    [/\blast year\b/i, (ref) => `${ref.getFullYear() - 1}`],
    [/\bthis week\b/i, (ref) => `week of ${this.formatDate(ref)}`],
    [/\bthis month\b/i, (ref) => this.formatMonth(ref)],
    [/\bthis year\b/i, (ref) => `${ref.getFullYear()}`],
  ];

  /**
   * Normalize an observation for an entity.
   */
  normalize(
    observation: string,
    entity: Entity,
    options: NormalizationOptions = {}
  ): NormalizationResult {
    const {
      resolveCoreferences = true,
      anchorTimestamps = true,
      extractKeywords = false,
      referenceDate = new Date(),
    } = options;

    let normalized = observation;
    const changes: string[] = [];

    if (resolveCoreferences) {
      const corefResult = this.resolveCoreferences(normalized, entity);
      if (corefResult.changed) {
        normalized = corefResult.text;
        changes.push(`Resolved pronouns to '${entity.name}'`);
      }
    }

    if (anchorTimestamps) {
      const timeResult = this.anchorTimestamps(normalized, referenceDate);
      if (timeResult.changed) {
        normalized = timeResult.text;
        changes.push(...timeResult.replacements);
      }
    }

    const keywords = extractKeywords
      ? this.extractKeywords(normalized)
      : undefined;

    return {
      original: observation,
      normalized,
      changes,
      keywords,
    };
  }

  /**
   * Resolve pronouns to entity name.
   */
  resolveCoreferences(
    text: string,
    entity: Entity
  ): { text: string; changed: boolean } {
    let result = text;
    let changed = false;

    // Determine gender hint from entity type or name patterns
    const isMasculine = this.guessMasculine(entity);
    const isFeminine = this.guessFeminine(entity);

    // Replace pronouns based on detected gender
    if (isMasculine) {
      const newText = result
        .replace(this.pronounPatterns.masculine, entity.name);
      if (newText !== result) {
        result = newText;
        changed = true;
      }
    } else if (isFeminine) {
      const newText = result
        .replace(this.pronounPatterns.feminine, entity.name);
      if (newText !== result) {
        result = newText;
        changed = true;
      }
    }

    // Always try neutral pronouns for non-person entities
    if (entity.entityType.toLowerCase() !== 'person') {
      const newText = result
        .replace(this.pronounPatterns.neutral, entity.name);
      if (newText !== result) {
        result = newText;
        changed = true;
      }
    }

    return { text: result, changed };
  }

  private guessMasculine(entity: Entity): boolean {
    const masculineNames = ['john', 'james', 'bob', 'mike', 'david', 'alex'];
    return masculineNames.some(n => entity.name.toLowerCase().includes(n));
  }

  private guessFeminine(entity: Entity): boolean {
    const feminineNames = ['alice', 'jane', 'sarah', 'mary', 'emma', 'lisa'];
    return feminineNames.some(n => entity.name.toLowerCase().includes(n));
  }

  /**
   * Convert relative timestamps to absolute dates.
   */
  anchorTimestamps(
    text: string,
    referenceDate: Date
  ): { text: string; changed: boolean; replacements: string[] } {
    let result = text;
    const replacements: string[] = [];

    for (const [pattern, resolver] of this.relativeTimePatterns) {
      const match = result.match(pattern);
      if (match) {
        const replacement = resolver(referenceDate);
        result = result.replace(pattern, replacement);
        replacements.push(`'${match[0]}' -> '${replacement}'`);
      }
    }

    return {
      text: result,
      changed: replacements.length > 0,
      replacements,
    };
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Extract important keywords from text.
   */
  extractKeywords(text: string): string[] {
    const stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
      'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 's', 't', 'just', 'don', 'now', 'and', 'but', 'or',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w));

    // Return unique keywords
    return [...new Set(words)];
  }

  /**
   * Normalize all observations for an entity.
   */
  normalizeEntity(
    entity: Entity,
    options: NormalizationOptions = {}
  ): { entity: Entity; results: NormalizationResult[] } {
    const results = entity.observations.map(obs =>
      this.normalize(obs, entity, options)
    );

    return {
      entity: {
        ...entity,
        observations: results.map(r => r.normalized),
      },
      results,
    };
  }
}
