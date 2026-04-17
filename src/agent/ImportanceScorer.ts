export interface ImportanceScorerConfig {
  domainKeywords?: Set<string>;
  lengthWeight?: number;
  keywordWeight?: number;
  overlapWeight?: number;
}

export interface ScoreOptions {
  queryContext?: string;
  recentTurns?: string[];
}

export class ImportanceScorer {
  private readonly domainKeywords: Set<string>;
  private readonly lengthWeight: number;
  private readonly keywordWeight: number;
  private readonly overlapWeight: number;

  constructor(config: ImportanceScorerConfig = {}) {
    this.domainKeywords = config.domainKeywords ?? new Set();
    this.lengthWeight = config.lengthWeight ?? 0.3;
    this.keywordWeight = config.keywordWeight ?? 0.4;
    this.overlapWeight = config.overlapWeight ?? 0.3;
  }

  /**
   * Score new content at creation time.
   *
   * PRD MEM-02: "Auto-importance scoring evaluates: content length
   * (log-scaled), domain keyword presence, query token overlap with
   * recent turns" (PRD §8 line 409).
   *
   * Returns integer in [0, 10] (memoryjs scale). PRD's narrower [1.0, 3.0]
   * range is out of scope here; the Decay Extensions spec owns the mapping.
   */
  score(content: string, options: ScoreOptions = {}): number {
    if (content.length === 0) return 0;

    const contentTokens = tokenise(content);

    const lengthSignal = Math.min(1, Math.log10(content.length) / 4); // log10(10000) = 4
    const keywordSignal =
      this.domainKeywords.size > 0
        ? countIntersection(contentTokens, this.domainKeywords) / this.domainKeywords.size
        : 0;

    const overlapCorpus: string[] = [];
    if (options.queryContext) overlapCorpus.push(options.queryContext);
    if (options.recentTurns) overlapCorpus.push(...options.recentTurns);

    let overlapSignal: number;
    if (overlapCorpus.length === 0) {
      overlapSignal = 0.5;
    } else {
      const corpusTokens = tokenise(overlapCorpus.join(' '));
      overlapSignal =
        contentTokens.size > 0
          ? countIntersection(contentTokens, corpusTokens) / contentTokens.size
          : 0;
    }

    const raw =
      this.lengthWeight * lengthSignal +
      this.keywordWeight * keywordSignal +
      this.overlapWeight * overlapSignal;

    return Math.max(0, Math.min(10, Math.round(raw * 10)));
  }
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}
