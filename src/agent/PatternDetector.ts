/**
 * Pattern Detector
 *
 * Identifies recurring templates in text observations using token-based matching.
 * Extracts patterns with variable slots for generalization into semantic memory.
 *
 * @module agent/PatternDetector
 */

import type { PatternResult } from '../types/agent-memory.js';

/**
 * Internal candidate for pattern detection.
 */
interface PatternCandidate {
  /** Template pattern with {X} slots */
  pattern: string;
  /** Extracted variable values */
  variables: string[];
  /** Number of matches */
  occurrences: number;
  /** Source texts that matched */
  sourceTexts: string[];
}

/**
 * Detects recurring patterns in text observations.
 *
 * PatternDetector identifies common templates by comparing tokenized
 * observations and finding shared structure with variable parts.
 *
 * @example
 * ```typescript
 * const detector = new PatternDetector();
 *
 * const observations = [
 *   'User prefers Italian food',
 *   'User prefers Mexican food',
 *   'User prefers Japanese food',
 *   'Meeting scheduled for Monday',
 * ];
 *
 * const patterns = detector.detectPatterns(observations, 2);
 * // Returns: [{ pattern: 'User prefers {X} food', variables: ['Italian', 'Mexican', 'Japanese'], ... }]
 * ```
 */
export class PatternDetector {
  /**
   * Detect patterns in a list of observations.
   *
   * Compares pairs of observations to identify common templates
   * with variable slots. Patterns must appear at least minOccurrences
   * times to be returned.
   *
   * @param observations - Text observations to analyze
   * @param minOccurrences - Minimum pattern frequency (default: 2)
   * @returns Array of detected patterns
   */
  detectPatterns(
    observations: string[],
    minOccurrences: number = 2
  ): PatternResult[] {
    if (observations.length < 2) {
      return [];
    }

    const patterns = new Map<string, PatternCandidate>();

    // Compare each pair of observations
    for (let i = 0; i < observations.length; i++) {
      for (let j = i + 1; j < observations.length; j++) {
        const template = this.extractTemplate(observations[i], observations[j]);
        if (template) {
          const key = template.pattern;
          if (!patterns.has(key)) {
            patterns.set(key, {
              pattern: template.pattern,
              variables: [],
              occurrences: 0,
              sourceTexts: [],
            });
          }
          const p = patterns.get(key)!;
          p.occurrences++;
          p.variables.push(...template.variables);
          if (!p.sourceTexts.includes(observations[i])) {
            p.sourceTexts.push(observations[i]);
          }
          if (!p.sourceTexts.includes(observations[j])) {
            p.sourceTexts.push(observations[j]);
          }
        }
      }
    }

    // Check for additional matches against existing patterns
    for (const candidate of patterns.values()) {
      for (const obs of observations) {
        if (!candidate.sourceTexts.includes(obs)) {
          if (this.matchesPattern(obs, candidate.pattern)) {
            const extracted = this.extractVariables(obs, candidate.pattern);
            if (extracted) {
              candidate.variables.push(...extracted);
              candidate.sourceTexts.push(obs);
              candidate.occurrences++;
            }
          }
        }
      }
    }

    // Filter by minimum occurrences and convert to PatternResult
    return Array.from(patterns.values())
      .filter((p) => p.sourceTexts.length >= minOccurrences)
      .map((p) => ({
        pattern: p.pattern,
        variables: [...new Set(p.variables)],
        occurrences: p.sourceTexts.length,
        confidence: Math.min(1, p.sourceTexts.length / observations.length),
        sourceEntities: [],
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Extract a template pattern from two observations.
   *
   * Compares tokens and identifies common structure with variable parts.
   * Returns null if observations don't share a meaningful pattern.
   *
   * @param text1 - First observation
   * @param text2 - Second observation
   * @returns Template with pattern and variables, or null
   * @internal
   */
  private extractTemplate(
    text1: string,
    text2: string
  ): { pattern: string; variables: string[] } | null {
    const tokens1 = this.tokenize(text1);
    const tokens2 = this.tokenize(text2);

    // Must have same number of tokens
    if (tokens1.length !== tokens2.length) {
      return null;
    }

    // Must have at least 2 tokens
    if (tokens1.length < 2) {
      return null;
    }

    const pattern: string[] = [];
    const variables: string[] = [];
    let variableCount = 0;
    let fixedCount = 0;

    for (let i = 0; i < tokens1.length; i++) {
      if (tokens1[i].toLowerCase() === tokens2[i].toLowerCase()) {
        pattern.push(tokens1[i]);
        fixedCount++;
      } else {
        pattern.push('{X}');
        variables.push(tokens1[i], tokens2[i]);
        variableCount++;
      }
    }

    // Require at least one variable and at least one fixed token
    // Also require more fixed tokens than variables for meaningful patterns
    if (variableCount === 0 || fixedCount === 0) {
      return null;
    }

    // Patterns should have more context than variables
    if (fixedCount < variableCount) {
      return null;
    }

    return { pattern: pattern.join(' '), variables };
  }

  /**
   * Check if an observation matches a pattern template.
   *
   * @param text - Observation to check
   * @param pattern - Pattern template with {X} slots
   * @returns True if observation matches pattern
   * @internal
   */
  private matchesPattern(text: string, pattern: string): boolean {
    const textTokens = this.tokenize(text);
    const patternTokens = pattern.split(' ');

    if (textTokens.length !== patternTokens.length) {
      return false;
    }

    for (let i = 0; i < patternTokens.length; i++) {
      if (patternTokens[i] !== '{X}') {
        if (textTokens[i].toLowerCase() !== patternTokens[i].toLowerCase()) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Extract variable values from an observation that matches a pattern.
   *
   * @param text - Observation to extract from
   * @param pattern - Pattern template with {X} slots
   * @returns Array of extracted variable values, or null if no match
   * @internal
   */
  private extractVariables(text: string, pattern: string): string[] | null {
    const textTokens = this.tokenize(text);
    const patternTokens = pattern.split(' ');

    if (textTokens.length !== patternTokens.length) {
      return null;
    }

    const variables: string[] = [];
    for (let i = 0; i < patternTokens.length; i++) {
      if (patternTokens[i] === '{X}') {
        variables.push(textTokens[i]);
      }
    }

    return variables.length > 0 ? variables : null;
  }

  /**
   * Tokenize text into words.
   *
   * @param text - Text to tokenize
   * @returns Array of word tokens
   * @internal
   */
  private tokenize(text: string): string[] {
    return text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  /**
   * Merge variable slots in a pattern where consecutive {X} tokens appear.
   * This creates more generalized patterns.
   *
   * @param pattern - Pattern with {X} slots
   * @returns Pattern with merged consecutive variable slots
   */
  mergeConsecutiveVariables(pattern: string): string {
    return pattern.replace(/(\{X\}\s*)+/g, '{X} ').trim();
  }

  /**
   * Calculate the specificity of a pattern.
   * Higher values indicate more specific (less generalized) patterns.
   *
   * @param pattern - Pattern to analyze
   * @returns Specificity score (0-1)
   */
  calculatePatternSpecificity(pattern: string): number {
    const tokens = pattern.split(' ');
    const fixedTokens = tokens.filter((t) => t !== '{X}').length;
    return fixedTokens / tokens.length;
  }
}
