/**
 * Keyword Extractor
 *
 * Phase 11: Extracts and scores keywords from text
 * for lexical search enhancement.
 *
 * @module features/KeywordExtractor
 */

/**
 * A keyword with importance score.
 */
export interface ScoredKeyword {
  keyword: string;
  score: number;
  positions: number[];
}

/**
 * Keyword Extractor extracts and scores keywords from text.
 *
 * Features:
 * - Position-based scoring (earlier = more important)
 * - Domain-specific keyword boosting
 * - Length-based scoring (longer words often more specific)
 * - Stopword filtering
 *
 * @example
 * ```typescript
 * const extractor = new KeywordExtractor();
 * const keywords = extractor.extract('The software project was completed on time');
 * // Returns scored keywords sorted by importance
 * ```
 */
export class KeywordExtractor {
  private stopwords: Set<string>;
  private domainBoosts: Map<string, number>;

  constructor() {
    this.stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'can', 'to', 'of', 'in', 'for', 'on',
      'with', 'at', 'by', 'from', 'as', 'and', 'or', 'but',
    ]);
    this.domainBoosts = new Map([
      ['project', 1.5],
      ['task', 1.5],
      ['meeting', 1.3],
      ['deadline', 1.4],
      ['completed', 1.2],
      ['started', 1.2],
      ['person', 1.3],
      ['company', 1.3],
      ['team', 1.3],
      ['release', 1.4],
      ['feature', 1.3],
      ['bug', 1.2],
      ['issue', 1.2],
      ['milestone', 1.4],
    ]);
  }

  /**
   * Extract keywords with scores from text.
   */
  extract(text: string): ScoredKeyword[] {
    const words = this.tokenize(text);
    const keywordMap = new Map<string, ScoredKeyword>();

    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase();
      if (this.isKeyword(word)) {
        const existing = keywordMap.get(word);
        if (existing) {
          existing.positions.push(i);
          existing.score += this.calculateScore(word, i, words.length);
        } else {
          keywordMap.set(word, {
            keyword: word,
            score: this.calculateScore(word, i, words.length),
            positions: [i],
          });
        }
      }
    }

    return Array.from(keywordMap.values())
      .sort((a, b) => b.score - a.score);
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  private isKeyword(word: string): boolean {
    return word.length > 2 && !this.stopwords.has(word);
  }

  private calculateScore(word: string, position: number, totalWords: number): number {
    let score = 1.0;

    // Position boost (earlier = more important)
    const positionFactor = 1 - (position / totalWords) * 0.3;
    score *= positionFactor;

    // Domain boost
    const boost = this.domainBoosts.get(word) ?? 1.0;
    score *= boost;

    // Length boost (longer words often more specific)
    if (word.length > 6) score *= 1.1;

    return score;
  }

  /**
   * Extract top N keywords.
   */
  extractTop(text: string, n: number): string[] {
    return this.extract(text)
      .slice(0, n)
      .map(k => k.keyword);
  }

  /**
   * Add custom domain boost for a keyword.
   */
  addDomainBoost(keyword: string, boost: number): void {
    this.domainBoosts.set(keyword.toLowerCase(), boost);
  }

  /**
   * Remove a domain boost.
   */
  removeDomainBoost(keyword: string): boolean {
    return this.domainBoosts.delete(keyword.toLowerCase());
  }

  /**
   * Get all domain boosts.
   */
  getDomainBoosts(): Map<string, number> {
    return new Map(this.domainBoosts);
  }
}
