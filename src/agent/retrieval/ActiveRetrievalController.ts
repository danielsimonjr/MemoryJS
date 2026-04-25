/**
 * Active Retrieval Controller (3B.5)
 *
 * Decides *when* to retrieve, *what* to retrieve, and runs an iterative
 * query-rewriting loop that refines the query each round based on the
 * previous round's results. Wraps `RankedSearch` for the actual search
 * step and `QueryRewriter` for the expansion step.
 *
 * Out of scope (this module): LLM-driven query planning. The
 * `LLMQueryPlanner` already covers that path; `ActiveRetrievalController`
 * uses purely symbolic token-overlap expansion so it works without any
 * LLM provider.
 *
 * @module agent/retrieval/ActiveRetrievalController
 */

import type { RankedSearch } from '../../search/RankedSearch.js';
import type { SearchResult } from '../../types/index.js';
import { QueryRewriter } from './QueryRewriter.js';

/** Caller-supplied context for a retrieval decision. */
export interface RetrievalContext {
  /** Free-text query. */
  query: string;
  /** Optional task hint for `selectMemoryTypes`. */
  task?: string;
  /** Optional token budget cap. */
  budgetTokens?: number;
}

/** Output of `shouldRetrieve`. */
export interface RetrievalDecision {
  retrieve: boolean;
  /** Estimated cost in tokens (rough — proportional to query length). */
  estimatedCost: number;
  /** Free-text rationale. */
  reason: string;
}

/** Per-round trace for debugging / introspection. */
export interface RetrievalRound {
  query: string;
  results: SearchResult[];
  /** Coverage score in [0, 1] — average top-result score, capped. */
  coverage: number;
  /** Tokens added by `QueryRewriter`. Empty on the first round. */
  expansionTokens: string[];
}

/** Final result of `adaptiveRetrieve`. */
export interface AdaptiveResult {
  /** Highest-coverage round's results. */
  bestResults: SearchResult[];
  /** Coverage of `bestResults`. */
  bestCoverage: number;
  /** All rounds executed (for trace). */
  rounds: RetrievalRound[];
}

export interface ActiveRetrievalConfig {
  /** Max retrieval rounds. Default 3. */
  maxRounds?: number;
  /** Coverage threshold; rounds stop early when reached. Default 0.6. */
  minCoverage?: number;
  /** Per-round result limit. Default 10. */
  resultsPerRound?: number;
  /** Cost-budget cutoff for `shouldRetrieve`. Default 1000 tokens. */
  costThreshold?: number;
  /** How many tokens to add per round via `QueryRewriter`. Default 3. */
  expansionLimit?: number;
}

export class ActiveRetrievalController {
  private readonly rewriter = new QueryRewriter();
  private readonly maxRounds: number;
  private readonly minCoverage: number;
  private readonly resultsPerRound: number;
  private readonly costThreshold: number;
  private readonly expansionLimit: number;

  constructor(
    private readonly rankedSearch: RankedSearch,
    config: ActiveRetrievalConfig = {},
  ) {
    this.maxRounds = config.maxRounds ?? 3;
    this.minCoverage = config.minCoverage ?? 0.6;
    this.resultsPerRound = config.resultsPerRound ?? 10;
    this.costThreshold = config.costThreshold ?? 1000;
    this.expansionLimit = config.expansionLimit ?? 3;
  }

  /**
   * Decide whether retrieval is worth the cost. Currently a simple
   * heuristic: tokens(query) × resultsPerRound × maxRounds × constant.
   * Returns `retrieve: false` when estimated cost > budget OR query is
   * empty.
   */
  shouldRetrieve(context: RetrievalContext): RetrievalDecision {
    const tokens = context.query.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return { retrieve: false, estimatedCost: 0, reason: 'Empty query' };
    }
    // Rough cost = ~50 tokens per result + query overhead.
    const estimatedCost = tokens.length * 5
      + this.resultsPerRound * this.maxRounds * 50;
    const budget = context.budgetTokens ?? this.costThreshold;
    if (estimatedCost > budget) {
      return {
        retrieve: false,
        estimatedCost,
        reason: `Estimated cost ${estimatedCost} exceeds budget ${budget}`,
      };
    }
    return {
      retrieve: true,
      estimatedCost,
      reason: 'Cost within budget',
    };
  }

  /**
   * Run up to `maxRounds` of (search → score coverage → rewrite). Stops
   * early when coverage hits `minCoverage` or no expansion tokens are
   * available. Returns the highest-coverage round's results plus the
   * full per-round trace.
   */
  async adaptiveRetrieve(context: RetrievalContext): Promise<AdaptiveResult> {
    const rounds: RetrievalRound[] = [];
    let currentQuery = context.query;
    let bestRound: RetrievalRound | null = null;

    for (let i = 0; i < this.maxRounds; i++) {
      const results = await this.rankedSearch.searchNodesRanked(
        currentQuery,
        undefined,
        undefined,
        undefined,
        this.resultsPerRound,
      );
      const coverage = this.estimateCoverage(results);
      const round: RetrievalRound = {
        query: currentQuery,
        results,
        coverage,
        expansionTokens: i === 0 ? [] : (rounds[i - 1].expansionTokens ?? []),
      };
      rounds.push(round);

      if (!bestRound || coverage > bestRound.coverage) bestRound = round;
      if (coverage >= this.minCoverage) break;
      if (results.length === 0) break;

      // Rewrite for next round using the current results' observations.
      const snippets = results.flatMap(r => r.entity.observations).slice(0, 20);
      const rewrite = this.rewriter.rewrite(currentQuery, snippets, this.expansionLimit);
      if (rewrite.expansionTokens.length === 0) break;
      currentQuery = rewrite.query;
      // Patch the next round's `expansionTokens` once it executes.
      rounds[rounds.length - 1].expansionTokens = rewrite.expansionTokens;
    }

    return {
      bestResults: bestRound?.results ?? [],
      bestCoverage: bestRound?.coverage ?? 0,
      rounds,
    };
  }

  /**
   * Quick coverage estimate: average of the top-3 results' scores,
   * clamped to [0, 1]. Empty results → 0. Score normalization assumes
   * `RankedSearch` returns BM25-ish positive numbers; we cap at 1.0 to
   * keep the threshold comparison meaningful.
   */
  private estimateCoverage(results: SearchResult[]): number {
    if (results.length === 0) return 0;
    const top = results.slice(0, 3);
    const avg = top.reduce((acc, r) => acc + (r.score ?? 0), 0) / top.length;
    return Math.min(1, Math.max(0, avg));
  }
}
