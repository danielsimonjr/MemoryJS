/**
 * ExperienceExtractor — Phase δ.3 (ROADMAP §3B.3).
 *
 * Experience-stage service that abstracts universal patterns from
 * trajectory clusters, enabling zero-shot transfer to new scenarios.
 * Wraps `PatternDetector.detectPatterns` for the pattern-abstraction
 * method (per ADR-011 wrap-and-extend), and adds four new methods
 * natively:
 *
 * - `extractFromContrastivePairs(success, failure)` — derive `Rule`s
 *   from differences between successful and failed trajectories.
 * - `abstractPattern(trajectories, similarityThreshold)` — delegates
 *   to `PatternDetector.detectPatterns` over flattened observations.
 * - `learnDecisionBoundary(trajectories, outcomeField)` — separate
 *   trajectories by outcome and surface the most distinguishing tokens.
 * - `clusterTrajectories(trajectories, method)` — group by structural,
 *   semantic, or outcome similarity.
 * - `synthesizeExperience(cluster)` — produce a single transferable
 *   `Experience` artifact from a cluster.
 *
 * @module agent/ExperienceExtractor
 */

import type { PatternDetector } from './PatternDetector.js';
import type { PatternResult } from '../types/agent-memory.js';

export type Outcome = 'success' | 'failure' | 'partial' | 'unknown';

export interface Action {
  name: string;
  parameters?: Record<string, unknown>;
  result?: 'ok' | 'error';
}

export interface Trajectory {
  id: string;
  sessionId: string;
  observations: string[];
  actions: Action[];
  outcome: Outcome;
  context: Record<string, unknown>;
  timestamp: string;
}

export interface Rule {
  /** When this rule applies (textual condition). */
  condition: string;
  /** What to do when the condition holds. */
  action: string;
  confidence: number;
  /** Trajectories that support this rule. */
  supportCount: number;
  /** Trajectories that contradict this rule. */
  contraCount: number;
}

export interface HeuristicGuideline {
  pattern: string;
  variables: string[];
  occurrences: number;
  /** Trajectory IDs that exhibited this pattern. */
  sourceTrajectoryIds: string[];
}

export interface DecisionRule {
  /** Tokens whose presence indicates `outcomeIfPresent` outcome. */
  presenceTokens: string[];
  /** Tokens whose absence indicates `outcomeIfAbsent` outcome. */
  absenceTokens: string[];
  outcomeIfPresent: Outcome;
  outcomeIfAbsent: Outcome;
  confidence: number;
}

export type ClusterMethod = 'semantic' | 'structural' | 'outcome';

export interface TrajectoryCluster {
  id: string;
  method: ClusterMethod;
  trajectories: Trajectory[];
  /** Average pairwise similarity within the cluster, 0..1. */
  cohesion: number;
}

export type ExperienceType = 'heuristic' | 'procedure' | 'constraint' | 'preference';

export interface Experience {
  id: string;
  type: ExperienceType;
  content: string;
  /** Task types this applies to. */
  applicability: string[];
  confidence: number;
  /** Trajectory IDs that produced this experience. */
  sourceTrajectories: string[];
  createdAt: string;
}

export interface ExperienceExtractorConfig {
  /** Default min-occurrence count for `abstractPattern`. Default 2. */
  minPatternOccurrences?: number;
  /** Default similarity threshold for clustering. Default 0.6. */
  similarityThreshold?: number;
}

export class ExperienceExtractor {
  private readonly patternDetector: PatternDetector;
  private readonly minPatternOccurrences: number;
  private readonly similarityThreshold: number;

  constructor(
    patternDetector: PatternDetector,
    config: ExperienceExtractorConfig = {},
  ) {
    this.patternDetector = patternDetector;
    this.minPatternOccurrences = config.minPatternOccurrences ?? 2;
    this.similarityThreshold = config.similarityThreshold ?? 0.6;
  }

  /**
   * Derive rules from contrastive pairs. Strategy: tokens appearing
   * disproportionately in successes (vs. failures) become condition
   * antecedents; the next action after the distinguishing token
   * becomes the rule's recommended action.
   *
   * Lightweight — no embeddings or LLMs. Suitable for the "what does
   * the agent do differently when it succeeds" question at scale.
   */
  async extractFromContrastivePairs(
    success: Trajectory[],
    failure: Trajectory[],
  ): Promise<Rule[]> {
    if (success.length === 0 || failure.length === 0) return [];

    const successTokens = countTokens(success.flatMap((t) => t.observations));
    const failureTokens = countTokens(failure.flatMap((t) => t.observations));

    const rules: Rule[] = [];
    for (const [tok, sCount] of successTokens.entries()) {
      const fCount = failureTokens.get(tok) ?? 0;
      // Token appears at least 2x more often in successes than failures.
      if (sCount >= 2 && sCount >= 2 * fCount) {
        // Recommended action: most-common action across success trajectories
        // that contained this token.
        const actionCounts = new Map<string, number>();
        for (const t of success) {
          if (t.observations.some((o) => o.toLowerCase().includes(tok))) {
            for (const a of t.actions) {
              actionCounts.set(a.name, (actionCounts.get(a.name) ?? 0) + 1);
            }
          }
        }
        const topAction = Array.from(actionCounts.entries())
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
        rules.push({
          condition: `observation contains "${tok}"`,
          action: topAction,
          confidence: sCount / (sCount + fCount + 1),
          supportCount: sCount,
          contraCount: fCount,
        });
      }
    }
    // Top 10 by confidence so the result is bounded.
    return rules.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  }

  /**
   * Abstract a pattern across trajectories' observations. Delegates
   * to `PatternDetector.detectPatterns` and lifts the result onto
   * the spec's `HeuristicGuideline` shape with trajectory provenance.
   *
   * `similarityThreshold` is currently unused by the underlying
   * `detectPatterns` (it operates on token-template equality, not
   * similarity); kept in the signature for spec compliance and future
   * use when an embedding-based variant lands.
   */
  async abstractPattern(
    trajectories: Trajectory[],
    similarityThreshold: number,
  ): Promise<HeuristicGuideline> {
    void similarityThreshold; // reserved for future embedding-based path
    const allObs = trajectories.flatMap((t) => t.observations);
    const patterns: PatternResult[] = this.patternDetector.detectPatterns(
      allObs,
      this.minPatternOccurrences,
    );
    if (patterns.length === 0) {
      return { pattern: '', variables: [], occurrences: 0, sourceTrajectoryIds: [] };
    }
    // Pick the most frequent pattern as "the heuristic".
    const top = patterns.sort((a, b) => b.occurrences - a.occurrences)[0];
    // Source trajectories: any trajectory whose observations include
    // any of the variable values from the pattern (PatternResult exposes
    // `variables` and `sourceEntities`, not raw source texts; we use
    // variables as a tractable proxy for "this trajectory contributed").
    const sourceIds = new Set<string>();
    const variableValues = new Set(top.variables);
    for (const t of trajectories) {
      for (const o of t.observations) {
        if (Array.from(variableValues).some((v) => o.includes(v))) {
          sourceIds.add(t.id);
          break;
        }
      }
    }
    return {
      pattern: top.pattern,
      variables: top.variables ?? [],
      occurrences: top.occurrences,
      sourceTrajectoryIds: Array.from(sourceIds),
    };
  }

  /**
   * Learn the decision boundary for a binary outcome split. Currently
   * supports `outcome` field (success vs. failure); other field names
   * fall back to the `Outcome` lookup. Returns the most-distinguishing
   * tokens per side.
   */
  async learnDecisionBoundary(
    trajectories: Trajectory[],
    outcomeField: string,
  ): Promise<DecisionRule> {
    const positive = trajectories.filter(
      (t) => extractField(t, outcomeField) === 'success',
    );
    const negative = trajectories.filter(
      (t) => extractField(t, outcomeField) === 'failure',
    );

    const posTokens = countTokens(positive.flatMap((t) => t.observations));
    const negTokens = countTokens(negative.flatMap((t) => t.observations));

    // Top tokens biased toward each side.
    const presence: string[] = [];
    const absence: string[] = [];
    for (const [tok, p] of posTokens) {
      const n = negTokens.get(tok) ?? 0;
      if (p >= 2 && p >= 2 * n) presence.push(tok);
    }
    for (const [tok, n] of negTokens) {
      const p = posTokens.get(tok) ?? 0;
      if (n >= 2 && n >= 2 * p) absence.push(tok);
    }

    const total = positive.length + negative.length;
    return {
      presenceTokens: presence.slice(0, 10),
      absenceTokens: absence.slice(0, 10),
      outcomeIfPresent: 'success',
      outcomeIfAbsent: 'failure',
      confidence: total === 0 ? 0 : Math.min(positive.length, negative.length) / total,
    };
  }

  /**
   * Cluster trajectories by the chosen method. Lightweight: no
   * embeddings — `semantic` and `structural` both use token-Jaccard
   * with different normalization; `outcome` simply groups by the
   * `Outcome` value.
   *
   * Algorithmic caveat (greedy single-link for semantic/structural):
   * a trajectory is absorbed into the FIRST seed it overlaps with
   * above the configured similarity threshold, regardless of whether
   * a later seed would match more strongly. Results therefore depend
   * on input ordering, and "chain" clusters (A↔B, B↔C, but A↔C far
   * apart) can form under low thresholds. The `cohesion` field on
   * each `TrajectoryCluster` surfaces this — downstream
   * `synthesizeExperience` already passes cohesion through to
   * `Experience.confidence`. For higher-quality clustering, a
   * complete-link or union-find variant would be the natural
   * extension.
   */
  async clusterTrajectories(
    trajectories: Trajectory[],
    method: ClusterMethod,
  ): Promise<TrajectoryCluster[]> {
    if (trajectories.length === 0) return [];

    if (method === 'outcome') {
      const groups = new Map<Outcome, Trajectory[]>();
      for (const t of trajectories) {
        const arr = groups.get(t.outcome) ?? [];
        arr.push(t);
        groups.set(t.outcome, arr);
      }
      return Array.from(groups.entries()).map(([outcome, ts], i) => ({
        id: `cluster-outcome-${i}-${outcome}`,
        method: 'outcome' as const,
        trajectories: ts,
        cohesion: 1.0, // outcome equality = perfect cohesion by definition
      }));
    }

    // semantic / structural: greedy single-link clustering by Jaccard.
    const clusters: Trajectory[][] = [];
    const sims: number[][] = [];
    const visited = new Set<string>();

    for (const t of trajectories) {
      if (visited.has(t.id)) continue;
      const cluster = [t];
      const cSims: number[] = [];
      visited.add(t.id);
      const tTokens = trajectoryTokens(t, method);

      for (const u of trajectories) {
        if (visited.has(u.id)) continue;
        const sim = jaccard(tTokens, trajectoryTokens(u, method));
        if (sim >= this.similarityThreshold) {
          cluster.push(u);
          cSims.push(sim);
          visited.add(u.id);
        }
      }
      clusters.push(cluster);
      sims.push(cSims);
    }

    return clusters.map((cluster, i) => ({
      id: `cluster-${method}-${i}`,
      method,
      trajectories: cluster,
      cohesion: sims[i].length === 0 ? 1.0 : sims[i].reduce((a, b) => a + b, 0) / sims[i].length,
    }));
  }

  /**
   * Synthesize a transferable `Experience` from a cluster. Picks the
   * `type` heuristically (procedure if cluster is action-heavy;
   * heuristic otherwise) and uses the most-common-pattern across the
   * cluster as the experience content.
   */
  async synthesizeExperience(cluster: TrajectoryCluster): Promise<Experience> {
    const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const obs = cluster.trajectories.flatMap((t) => t.observations);
    const actionCount = cluster.trajectories.reduce((acc, t) => acc + t.actions.length, 0);

    // Type heuristic: more actions per trajectory → procedural;
    // observation-heavy → heuristic.
    const type: ExperienceType =
      actionCount > cluster.trajectories.length * 2 ? 'procedure' : 'heuristic';

    // Content: top pattern, or fallback to "common observation".
    const patterns = this.patternDetector.detectPatterns(obs, 2);
    const content = patterns[0]?.pattern ?? obs[0] ?? '';

    // Applicability: top tokens in observations.
    const counts = countTokens(obs);
    const applicability = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    return {
      id,
      type,
      content,
      applicability,
      confidence: cluster.cohesion,
      sourceTrajectories: cluster.trajectories.map((t) => t.id),
      createdAt: new Date().toISOString(),
    };
  }
}

// ---------- helpers ----------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function countTokens(texts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const text of texts) {
    for (const tok of tokenize(text)) {
      out.set(tok, (out.get(tok) ?? 0) + 1);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function trajectoryTokens(t: Trajectory, method: ClusterMethod): Set<string> {
  if (method === 'structural') {
    // Action sequence = structure
    return new Set(t.actions.map((a) => a.name));
  }
  // semantic = observation tokens
  const all = new Set<string>();
  for (const o of t.observations) for (const tok of tokenize(o)) all.add(tok);
  return all;
}

function extractField(t: Trajectory, field: string): unknown {
  if (field === 'outcome') return t.outcome;
  return t.context[field];
}
