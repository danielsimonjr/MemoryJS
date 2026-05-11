/**
 * Heuristic Guidelines Manager
 *
 * Crystallises implicit patterns into explicit natural-language
 * strategies (heuristics). Each heuristic is a `condition → action`
 * rule with a confidence score, support count, and conflict status.
 *
 * Phase 3 step 34 — closes the last unshipped Phase 3B item. v1 is
 * a pure in-memory store with explicit `add` / `match` / `reinforce`
 * APIs; semantic-similarity matching and graph-induction are
 * follow-ups (the API is shaped so they can be added without breaking
 * the current shape).
 *
 * @module agent/HeuristicManager
 * @experimental Match algorithm (Jaccard token-overlap × confidence)
 *   and conflict-detection heuristics are conservative v1; may evolve
 *   toward semantic-similarity matching.
 */

/**
 * A single heuristic — a natural-language condition mapped to an
 * action, with provenance and confidence tracking.
 */
export interface Heuristic {
  /** Stable id, generated at registration time. */
  id: string;
  /** Natural-language condition that triggers the action. */
  condition: string;
  /** Recommended action when the condition matches. */
  action: string;
  /** Optional priority for tie-breaking when multiple heuristics match (higher wins). */
  priority?: number;
  /** Number of times the heuristic was reinforced via `reinforce()`. */
  support: number;
  /** Number of times a contradiction with this heuristic was reported via `recordContradiction()`. */
  contradictions: number;
  /** Confidence score in [0, 1], updated on every reinforce/contradict. */
  confidence: number;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of last reinforce/contradict. */
  lastUpdatedAt: string;
}

/** Input shape for `add`. */
export interface AddHeuristicOptions {
  condition: string;
  action: string;
  priority?: number;
  /** Initial confidence (default 0.5 — neutral). */
  initialConfidence?: number;
}

/** Result of a `match` query. */
export interface HeuristicMatch {
  heuristic: Heuristic;
  /** Confidence-weighted match score. Higher = better. */
  score: number;
}

/** Pair-wise conflict detection result. */
export interface HeuristicConflict {
  a: Heuristic;
  b: Heuristic;
  /** `'overlap'` = same condition, different actions; `'contradiction'` = directly opposing actions on overlapping conditions. */
  kind: 'overlap' | 'contradiction';
  /** Free-text explanation suitable for surfacing to the user. */
  reason: string;
}

/**
 * In-memory heuristic registry.
 *
 * @example
 * ```typescript
 * const mgr = new HeuristicManager();
 * const id = mgr.add({ condition: 'user asks for code review', action: 'request the PR URL first' });
 * const matches = mgr.match('please review my code');
 * mgr.reinforce(id);
 * ```
 */
export class HeuristicManager {
  private readonly heuristics: Map<string, Heuristic> = new Map();
  private nextId: number = 1;

  /** Register a new heuristic. Returns the generated id. */
  add(options: AddHeuristicOptions): string {
    const id = this.generateId();
    const now = new Date().toISOString();
    this.heuristics.set(id, {
      id,
      condition: options.condition,
      action: options.action,
      priority: options.priority,
      support: 0,
      contradictions: 0,
      confidence: clamp01(options.initialConfidence ?? 0.5),
      createdAt: now,
      lastUpdatedAt: now,
    });
    return id;
  }

  /** Look up by id. */
  get(id: string): Heuristic | undefined {
    return this.heuristics.get(id);
  }

  /** Number of registered heuristics. */
  size(): number {
    return this.heuristics.size;
  }

  /** Remove a heuristic. Returns true if it existed. */
  remove(id: string): boolean {
    return this.heuristics.delete(id);
  }

  /** Drop every heuristic. */
  clear(): void {
    this.heuristics.clear();
    this.nextId = 1;
  }

  /**
   * Find heuristics whose condition matches the supplied input. The
   * v1 matcher uses a simple keyword-overlap score (intersection of
   * token sets, weighted by the heuristic's confidence). Returns
   * matches sorted by descending score, then by priority.
   */
  match(input: string, options: { limit?: number; minScore?: number } = {}): HeuristicMatch[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.1;
    const inputTokens = tokenSet(input);
    if (inputTokens.size === 0) return [];

    const matches: HeuristicMatch[] = [];
    for (const h of this.heuristics.values()) {
      const condTokens = tokenSet(h.condition);
      if (condTokens.size === 0) continue;
      let intersect = 0;
      for (const t of inputTokens) if (condTokens.has(t)) intersect++;
      // Jaccard similarity: |A ∩ B| / |A ∪ B|. Symmetric so a
      // one-token query against a richer condition isn't penalised
      // out of proportion. Equivalent to
      // `intersect / (a.size + b.size - intersect)`.
      const unionSize = inputTokens.size + condTokens.size - intersect;
      const overlap = unionSize === 0 ? 0 : intersect / unionSize;
      const score = overlap * h.confidence;
      if (score >= minScore) {
        matches.push({ heuristic: h, score });
      }
    }
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const pa = a.heuristic.priority ?? 0;
      const pb = b.heuristic.priority ?? 0;
      return pb - pa;
    });
    return matches.slice(0, limit);
  }

  /**
   * Reinforce a heuristic: record a successful application. Increases
   * confidence asymptotically toward 1 via a fixed-step rule
   * (`new = old + (1 - old) * 0.1`). Bumps `support`.
   */
  reinforce(id: string): Heuristic | undefined {
    const h = this.heuristics.get(id);
    if (!h) return undefined;
    h.support++;
    h.confidence = clamp01(h.confidence + (1 - h.confidence) * 0.1);
    h.lastUpdatedAt = new Date().toISOString();
    return h;
  }

  /**
   * Record a contradiction: a counter-example where the heuristic's
   * action did NOT lead to the desired outcome. Decreases confidence
   * symmetrically (`new = old - old * 0.2`) and bumps `contradictions`.
   */
  recordContradiction(id: string): Heuristic | undefined {
    const h = this.heuristics.get(id);
    if (!h) return undefined;
    h.contradictions++;
    h.confidence = clamp01(h.confidence - h.confidence * 0.2);
    h.lastUpdatedAt = new Date().toISOString();
    return h;
  }

  /**
   * Detect conflicts across registered heuristics. Pair-wise
   * comparison is O(n²) but n is expected to stay small (typically
   * < 100). Returns `overlap` when two heuristics fire on the same
   * condition tokens with different actions, and `contradiction` when
   * one heuristic's action verbatim negates another's.
   */
  detectConflicts(): HeuristicConflict[] {
    const all = [...this.heuristics.values()];
    const conflicts: HeuristicConflict[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const aTokens = tokenSet(a.condition);
        const bTokens = tokenSet(b.condition);
        let intersect = 0;
        for (const t of aTokens) if (bTokens.has(t)) intersect++;
        const overlap = intersect / Math.max(aTokens.size, bTokens.size, 1);
        if (overlap < 0.5) continue;
        if (a.action === b.action) continue; // identical actions don't conflict
        const kind: HeuristicConflict['kind'] = isContradiction(a.action, b.action)
          ? 'contradiction'
          : 'overlap';
        conflicts.push({
          a,
          b,
          kind,
          reason:
            kind === 'contradiction'
              ? `Heuristics "${a.id}" and "${b.id}" prescribe opposing actions on overlapping conditions`
              : `Heuristics "${a.id}" and "${b.id}" overlap on conditions but recommend different actions`,
        });
      }
    }
    return conflicts;
  }

  /**
   * Iterate every registered heuristic. Useful for serialisation /
   * diagnostics.
   */
  list(): Heuristic[] {
    return [...this.heuristics.values()];
  }

  private generateId(): string {
    return `h_${this.nextId++}`;
  }
}

/**
 * Common English stopwords filtered from condition / input tokens.
 * Replaces the previous `length >= 3` filter so important short tokens
 * like "PR", "AI", "go" are retained, while noise like "is", "the",
 * "an" still gets dropped. List is conservative — favours retaining
 * tokens over filtering them out.
 */
const HEURISTIC_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'be', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'at', 'by', 'for', 'with', 'and', 'or', 'but', 'if', 'as', 'it', 'its',
  'this', 'that', 'these', 'those',
]);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !HEURISTIC_STOPWORDS.has(t)),
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Coarse contradiction heuristic: an action contradicts another when
 * one is the literal negation of the other (e.g. "do X" vs "don't do
 * X"). Conservative — false negatives are preferred over false
 * positives so the user isn't bombarded with phantom conflicts.
 */
function isContradiction(a: string, b: string): boolean {
  const an = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const bn = b.toLowerCase().replace(/\s+/g, ' ').trim();
  const negationPrefixes = ["don't ", 'do not ', 'never ', 'avoid '];
  for (const p of negationPrefixes) {
    if (an.startsWith(p) && bn === an.slice(p.length)) return true;
    if (bn.startsWith(p) && an === bn.slice(p.length)) return true;
  }
  return false;
}
