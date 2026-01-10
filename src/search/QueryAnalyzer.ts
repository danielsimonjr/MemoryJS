/**
 * Query Analyzer
 *
 * Phase 11: Extracts structured information from natural language queries
 * to enable intelligent search planning.
 *
 * @module search/QueryAnalyzer
 */

import type { QueryAnalysis, ExtractedEntity, TemporalRange } from '../types/index.js';

/**
 * Query Analyzer extracts structured information from queries.
 *
 * Uses rule-based heuristics for reliable extraction of:
 * - Person names
 * - Location names
 * - Organization names
 * - Temporal references
 * - Question type
 * - Query complexity
 *
 * @example
 * ```typescript
 * const analyzer = new QueryAnalyzer();
 * const analysis = analyzer.analyze(
 *   'What projects did Alice work on last month?'
 * );
 * // { query: '...', entities: [...], persons: ['Alice'], temporalRange: { relative: 'last month' }, ... }
 * ```
 */
export class QueryAnalyzer {
  private personIndicators = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.'];
  private temporalKeywords = [
    'yesterday', 'today', 'tomorrow',
    'last week', 'last month', 'last year',
    'this week', 'this month', 'this year',
    'next week', 'next month', 'next year',
  ];
  private questionKeywords = {
    factual: ['what', 'who', 'where', 'which'],
    temporal: ['when', 'how long', 'since', 'until'],
    comparative: ['compare', 'difference', 'vs', 'versus', 'better', 'worse'],
    aggregation: ['how many', 'count', 'total', 'sum', 'average'],
    'multi-hop': ['and then', 'which means', 'therefore', 'related to'],
    conceptual: ['explain', 'why', 'how does', 'what is the meaning', 'understand'],
  };

  /**
   * Analyze a query using rule-based heuristics.
   * Main entry point - returns full QueryAnalysis.
   */
  analyze(query: string): QueryAnalysis {
    const lowerQuery = query.toLowerCase();
    const persons = this.extractPersons(query);
    const locations = this.extractLocations(query);
    const organizations = this.extractOrganizations(query);
    const questionType = this.detectQuestionType(lowerQuery);
    const complexity = this.estimateComplexity(query);

    // Build entities array from extracted names
    const entities: ExtractedEntity[] = [
      ...persons.map(name => ({ name, type: 'person' as const })),
      ...locations.map(name => ({ name, type: 'location' as const })),
      ...organizations.map(name => ({ name, type: 'organization' as const })),
    ];

    // Calculate confidence based on extraction quality
    const confidence = this.calculateConfidence(entities, complexity, questionType);

    return {
      query,
      entities,
      persons,
      locations,
      organizations,
      temporalRange: this.extractTemporalRange(query) ?? null,
      questionType,
      complexity,
      confidence,
      requiredInfoTypes: this.detectRequiredInfoTypes(lowerQuery),
      subQueries: this.decomposeQuery(query),
    };
  }

  /**
   * Calculate confidence score for the analysis.
   */
  private calculateConfidence(
    entities: ExtractedEntity[],
    complexity: 'low' | 'medium' | 'high',
    questionType: QueryAnalysis['questionType']
  ): number {
    let confidence = 0.5;

    // Higher confidence for simple queries
    if (complexity === 'low') confidence += 0.3;
    else if (complexity === 'medium') confidence += 0.1;

    // Higher confidence when entities are detected
    if (entities.length > 0) confidence += 0.1;

    // Lower confidence for conceptual queries (harder to satisfy)
    if (questionType === 'conceptual') confidence -= 0.2;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Extract person names from query.
   */
  private extractPersons(query: string): string[] {
    const persons: string[] = [];
    const words = query.split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      // Check for titles followed by names
      if (this.personIndicators.some(ind => word.startsWith(ind))) {
        if (i + 1 < words.length) {
          persons.push(words[i + 1].replace(/[^a-zA-Z]/g, ''));
        }
      }
      // Check for capitalized words that might be names
      if (/^[A-Z][a-z]+$/.test(word) && i > 0 && !/^[A-Z]/.test(words[i - 1])) {
        persons.push(word);
      }
    }

    return [...new Set(persons)];
  }

  /**
   * Extract location names from query.
   */
  private extractLocations(query: string): string[] {
    const locationIndicators = ['in', 'at', 'from', 'to', 'near'];
    const locations: string[] = [];
    const words = query.split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      if (locationIndicators.includes(words[i].toLowerCase())) {
        if (i + 1 < words.length && /^[A-Z]/.test(words[i + 1])) {
          locations.push(words[i + 1].replace(/[^a-zA-Z]/g, ''));
        }
      }
    }

    return [...new Set(locations)];
  }

  /**
   * Extract organization names from query.
   */
  private extractOrganizations(query: string): string[] {
    const orgIndicators = ['Inc.', 'Corp.', 'LLC', 'Ltd.', 'Company', 'Co.'];
    const organizations: string[] = [];

    for (const indicator of orgIndicators) {
      const regex = new RegExp(`([A-Z][a-zA-Z]*)\\s*${indicator.replace('.', '\\.')}`, 'g');
      const matches = query.match(regex);
      if (matches) {
        organizations.push(...matches);
      }
    }

    return [...new Set(organizations)];
  }

  /**
   * Extract temporal range from query.
   */
  private extractTemporalRange(query: string): TemporalRange | undefined {
    const lowerQuery = query.toLowerCase();

    for (const keyword of this.temporalKeywords) {
      if (lowerQuery.includes(keyword)) {
        return { relative: keyword };
      }
    }

    // Check for date patterns
    const datePattern = /\d{4}-\d{2}-\d{2}/g;
    const dates = query.match(datePattern);
    if (dates && dates.length >= 1) {
      return {
        start: dates[0],
        end: dates.length > 1 ? dates[1] : undefined,
      };
    }

    return undefined;
  }

  /**
   * Detect the type of question.
   */
  private detectQuestionType(query: string): QueryAnalysis['questionType'] {
    for (const [type, keywords] of Object.entries(this.questionKeywords)) {
      if (keywords.some(kw => query.includes(kw))) {
        return type as QueryAnalysis['questionType'];
      }
    }
    return 'factual';
  }

  /**
   * Estimate query complexity.
   */
  private estimateComplexity(query: string): QueryAnalysis['complexity'] {
    const wordCount = query.split(/\s+/).length;
    const hasConjunctions = /\b(and|or|but|then|therefore)\b/i.test(query);
    const hasMultipleClauses = /[,;]/.test(query);

    if (wordCount > 20 || (hasConjunctions && hasMultipleClauses)) {
      return 'high';
    }
    if (wordCount > 10 || hasConjunctions || hasMultipleClauses) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Detect what types of information are being requested.
   */
  private detectRequiredInfoTypes(query: string): string[] {
    const infoTypes: string[] = [];

    if (/\b(who|person|people|name)\b/.test(query)) infoTypes.push('person');
    if (/\b(where|location|place|city)\b/.test(query)) infoTypes.push('location');
    if (/\b(when|date|time|year|month)\b/.test(query)) infoTypes.push('temporal');
    if (/\b(how many|count|number|total)\b/.test(query)) infoTypes.push('quantity');
    if (/\b(why|reason|because)\b/.test(query)) infoTypes.push('reason');
    if (/\b(what|which|project|task)\b/.test(query)) infoTypes.push('entity');

    return infoTypes;
  }

  /**
   * Decompose complex queries into sub-queries.
   */
  private decomposeQuery(query: string): string[] | undefined {
    // Split on conjunctions
    const parts = query.split(/\b(and then|and|but|or)\b/i)
      .map(p => p.trim())
      .filter(p => p && !/^(and then|and|but|or)$/i.test(p));

    if (parts.length > 1) {
      return parts;
    }

    return undefined;
  }
}
