/**
 * Query Rewriter (3B.5)
 *
 * Token-overlap query expansion. Given a base query and a set of result
 * snippets, extracts the highest-co-occurrence tokens from the snippets
 * (excluding the query's own tokens and a small stopword set) and emits
 * an expanded query that combines the original with the top expansion
 * candidates.
 *
 * Pure function — no LLM, no IO. Sufficient for retrieval refinement
 * loops where each round uses the previous round's results to seed the
 * next query.
 *
 * @module agent/retrieval/QueryRewriter
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'to', 'for', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'about', 'as', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'it', 'we', 'they', 'his', 'her', 'its', 'our', 'their',
  'me', 'him', 'them', 'us', 'my', 'your',
]);

/** Minimal token interface — extracted from any text. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

export interface RewriteResult {
  /** The expanded query string. */
  query: string;
  /** Tokens added to the original query. */
  expansionTokens: string[];
}

export class QueryRewriter {
  /**
   * Expand `query` with the top-`expansionLimit` co-occurring tokens
   * from `snippets`. Tokens already present in the query (case-
   * insensitive) and stopwords are excluded.
   */
  rewrite(
    query: string,
    snippets: ReadonlyArray<string>,
    expansionLimit: number = 3,
  ): RewriteResult {
    const queryTokens = new Set(tokenize(query));
    const counts = new Map<string, number>();

    for (const s of snippets) {
      const seen = new Set<string>();
      for (const t of tokenize(s)) {
        if (queryTokens.has(t)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }

    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, expansionLimit)
      .map(([t]) => t);

    if (top.length === 0) {
      return { query, expansionTokens: [] };
    }

    return {
      query: `${query} ${top.join(' ')}`,
      expansionTokens: top,
    };
  }
}
