/**
 * Synonym Manager
 *
 * Bidirectional synonym map plus query expansion. The map can be
 * caller-supplied (explicit synonyms via `add(group)`) or auto-detected
 * from observation co-occurrence (cheap heuristic — terms that show up
 * together in the same observation more than `minSupport` times are
 * treated as soft synonyms with a fixed boost weight below the
 * original-term weight).
 *
 * Gated behind `MEMORY_SYNONYM_EXPANSION` (default `false`) — auto-
 * expansion is opt-in; explicit `add()` always works regardless of the
 * env var.
 *
 * Companion to `SearchSuggestions.correctQuery` (Phase 2 step 18) — call
 * `correctQuery` first, then `expand` on the corrected output.
 *
 * @module search/SynonymManager
 */

import type { GraphStorage } from '../core/GraphStorage.js';

/** Result of a query-expansion pass. */
export interface ExpandedQuery {
  /** The original query string, unchanged. */
  original: string;
  /** Per-token expansion: each token maps to itself plus added synonyms. */
  terms: Array<{ original: string; expansions: string[] }>;
  /**
   * Joined expansion. By default, an OR-ish join with parentheses around
   * each token's group: `(car automobile) AND (price)`. Callers that need
   * a different join can read `terms` directly.
   */
  expanded: string;
  /** True when at least one token gained an expansion. */
  hadExpansion: boolean;
}

/** Options for `expand`. */
export interface ExpandOptions {
  /** Cap synonyms per token (default: 3). */
  maxSynonymsPerToken?: number;
  /** Skip tokens shorter than this (default: 3). Common short terms like
   * "car" / "ai" / "ml" are exactly the ones likely to have synonyms,
   * so the threshold is intentionally lower than the spell-correction
   * threshold (which is 4 to suppress false-positive corrections). */
  minTokenLength?: number;
}

/**
 * Bidirectional synonym map. Symmetric: `add(['car', 'auto'])` makes
 * `car → [auto]` and `auto → [car]` queryable.
 */
export class SynonymManager {
  /**
   * Whether `MEMORY_SYNONYM_EXPANSION` was set at construction time.
   * Used by `expand()` and `autoDetectFromGraph()` as the opt-in gate.
   */
  readonly enabled: boolean;

  private readonly synonyms: Map<string, Set<string>> = new Map();

  constructor(private storage: GraphStorage) {
    const raw = process.env.MEMORY_SYNONYM_EXPANSION;
    this.enabled = raw === 'true' || raw === '1';
  }

  /**
   * Add a synonym group. All terms in the group become symmetric synonyms
   * of every other term. Idempotent — re-adding the same group is a no-op.
   * Adds even when `enabled === false`; the env var only gates auto-detect
   * and `expand()`'s output, not the underlying map.
   */
  add(group: string[]): void {
    if (group.length < 2) return;
    const lowered = group.map((t) => t.toLowerCase()).filter((t) => t.length > 0);
    if (lowered.length < 2) return;

    for (const term of lowered) {
      const existing = this.synonyms.get(term) ?? new Set<string>();
      for (const other of lowered) {
        if (other !== term) existing.add(other);
      }
      this.synonyms.set(term, existing);
    }
  }

  /**
   * Lookup synonyms for a single term. Returns an empty array when no
   * mapping exists or when expansion is disabled. Lowercase-insensitive.
   */
  lookup(term: string): string[] {
    if (!this.enabled) return [];
    const set = this.synonyms.get(term.toLowerCase());
    return set ? [...set] : [];
  }

  /**
   * Expand each whitespace-separated token in `query` with its synonyms.
   * No-op when `enabled === false` — returns the original query unchanged
   * with `hadExpansion: false`.
   */
  expand(query: string, options: ExpandOptions = {}): ExpandedQuery {
    const maxPerToken = options.maxSynonymsPerToken ?? 3;
    const minTokenLength = options.minTokenLength ?? 3;

    const tokens = query.split(/\s+/).filter((t) => t.length > 0);
    const terms: ExpandedQuery['terms'] = [];
    let hadExpansion = false;

    for (const token of tokens) {
      const expansions = this.enabled && token.length >= minTokenLength
        ? this.lookup(token).slice(0, maxPerToken)
        : [];
      if (expansions.length > 0) hadExpansion = true;
      terms.push({ original: token, expansions });
    }

    const expanded = terms
      .map(({ original, expansions }) =>
        expansions.length === 0 ? original : `(${original} ${expansions.join(' ')})`,
      )
      .join(' ');

    return { original: query, terms, expanded, hadExpansion };
  }

  /**
   * Co-occurrence-based auto-detection: scans every observation, builds
   * a `(term1, term2) → count` map, and registers groups where the count
   * exceeds `minSupport`. Conservative — only adds pairs that don't
   * already have an explicit synonym mapping, and skips short tokens.
   *
   * Returns the number of new pairs added. No-op when expansion is
   * disabled.
   */
  async autoDetectFromGraph(options: { minSupport?: number; minTokenLength?: number } = {}): Promise<number> {
    if (!this.enabled) return 0;

    const minSupport = options.minSupport ?? 5;
    const minTokenLength = options.minTokenLength ?? 4;

    const graph = await this.storage.loadGraph();
    const pairCount = new Map<string, number>();

    const tokenize = (s: string): string[] =>
      s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= minTokenLength);

    for (const entity of graph.entities) {
      // Dedup per entity: a pair counts once per entity even if the two
      // tokens co-occur in multiple observations. Without this, an
      // entity with the same observation duplicated N times would
      // inflate pair counts N-fold and lower the effective minSupport.
      const entityTokens = new Set<string>();
      for (const obs of entity.observations) {
        for (const tok of tokenize(obs)) entityTokens.add(tok);
      }
      const tokens = [...entityTokens];
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const a = tokens[i]!;
          const b = tokens[j]!;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }

    let added = 0;
    for (const [key, count] of pairCount) {
      if (count < minSupport) continue;
      const [a, b] = key.split('|') as [string, string];
      const existing = this.synonyms.get(a);
      if (existing && existing.has(b)) continue; // already mapped
      this.add([a, b]);
      added++;
    }
    return added;
  }

  /**
   * Drop every learned mapping. Caller-supplied `add()` mappings are
   * also removed — there is no separate "explicit vs auto-detected"
   * partition by design (keeping the structure simple).
   */
  clear(): void {
    this.synonyms.clear();
  }

  /**
   * Number of distinct terms with at least one synonym registered.
   */
  size(): number {
    return this.synonyms.size;
  }
}
