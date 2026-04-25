/**
 * TrajectoryCompressor — Phase δ.2 (ROADMAP §3B.2).
 *
 * Reflection-stage service that distills verbose interaction histories
 * into compact, reusable representations. Wraps `ContextWindowManager.compressForContext`
 * for the `foldContext` method (per ADR-011 wrap-and-extend), and adds
 * four new methods natively:
 *
 * - `distill(observations, options)` — compress an observation sequence
 *   into a `CompressedMemory` summary with key facts.
 * - `abstractAtLevel(memories, granularity)` — produce three coarseness
 *   levels (`fine` / `medium` / `coarse`) from a set of entities.
 * - `foldContext(workingMemory, maxTokens)` — delegates to
 *   `ContextWindowManager.compressForContext`.
 * - `findRedundancies(entities)` — identify groups of entities whose
 *   observations are largely duplicates of each other.
 * - `mergeRedundant(group, strategy)` — collapse a redundancy group
 *   into a single canonical entity per the chosen merge strategy.
 *
 * @module agent/TrajectoryCompressor
 */

import type { Entity } from '../types/types.js';
import type { ContextWindowManager } from './ContextWindowManager.js';

export interface DistillOptions {
  /** Keep events in the order they arrived. Default true. */
  preserveTemporalOrder?: boolean;
  /** Hard cap on the produced summary length (chars). Default 2000. */
  maxLength?: number;
  /** Drop observations whose embedded importance signal is below this.
   *  Currently uses a simple length-based heuristic (PatternDetector
   *  doesn't expose a per-observation score). Default 0. */
  importanceThreshold?: number;
  /** Entity names whose observations should be preserved verbatim. */
  preserveEntities?: string[];
}

export interface CompressedMemory {
  /** Plain-text rollup spanning the compressed observations. */
  summary: string;
  /** Bullet-style key facts extracted from the input. */
  keyFacts: string[];
  /** Number of input observations. */
  originalCount: number;
  /** Output-length / input-length ratio (0..1; lower = more compression). */
  compressionRatio: number;
  /** Observations explicitly retained (e.g., from `preserveEntities`). */
  preservedDetails: string[];
  /** Observations that were dropped from the summary. */
  discardedDetails: string[];
}

export type Granularity = 'fine' | 'medium' | 'coarse';

export interface RedundancyGroup {
  /** All entities considered duplicates of each other. */
  entities: Entity[];
  /** Suggested canonical name for the merged result. */
  canonicalName: string;
  /** Average pairwise similarity within the group, 0..1. */
  avgSimilarity: number;
}

export type MergeStrategy =
  | 'keep-newest'
  | 'keep-most-confident'
  | 'union-observations';

export interface TrajectoryCompressorConfig {
  /** Min token-overlap ratio to call two entities redundant. Default 0.7. */
  redundancyThreshold?: number;
}

export class TrajectoryCompressor {
  private readonly contextWindow: ContextWindowManager;
  private readonly redundancyThreshold: number;

  constructor(
    contextWindow: ContextWindowManager,
    config: TrajectoryCompressorConfig = {},
  ) {
    this.contextWindow = contextWindow;
    this.redundancyThreshold = config.redundancyThreshold ?? 0.7;
  }

  /**
   * Compress an observation sequence into a CompressedMemory.
   * Strategy: keep observations whose tokens overlap heavily with the
   * majority (these are the "core" facts), drop low-overlap outliers.
   * Length-truncate the summary at `maxLength`. No LLM dependency yet —
   * pluggable later via a summarizer config option.
   */
  async distill(
    observations: string[],
    options: DistillOptions = {},
  ): Promise<CompressedMemory> {
    const preserveTemporalOrder = options.preserveTemporalOrder ?? true;
    const maxLength = options.maxLength ?? 2000;
    // `preserveEntities` is reserved for callers that pass entity-tagged
    // observations; not used in this scalar-observation surface yet.
    void options.preserveEntities;

    const originalCount = observations.length;
    if (originalCount === 0) {
      return {
        summary: '',
        keyFacts: [],
        originalCount: 0,
        compressionRatio: 0,
        preservedDetails: [],
        discardedDetails: [],
      };
    }

    // Score each observation by inverse-novelty: count how many tokens
    // it shares with the rest. High-overlap = "core"; low = outlier.
    const tokenSets = observations.map((o) => tokenize(o));
    const scores = tokenSets.map((set, i) => {
      let overlap = 0;
      for (let j = 0; j < tokenSets.length; j += 1) {
        if (i === j) continue;
        for (const t of set) if (tokenSets[j].has(t)) overlap += 1;
      }
      return { idx: i, score: overlap, obs: observations[i] };
    });

    // Drop observations below importanceThreshold (uses score as proxy).
    const threshold = options.importanceThreshold ?? 0;
    const kept = scores.filter((s) => s.score >= threshold);
    const dropped = scores.filter((s) => s.score < threshold);

    // Sort by index (preserve order) or by score (importance).
    if (preserveTemporalOrder) kept.sort((a, b) => a.idx - b.idx);
    else kept.sort((a, b) => b.score - a.score);

    const keyFacts = kept.slice(0, Math.min(kept.length, 10)).map((s) => s.obs);
    let summary = keyFacts.join(' ');
    if (summary.length > maxLength) summary = summary.slice(0, maxLength).trimEnd() + '…';

    const totalLength = observations.join(' ').length || 1;
    return {
      summary,
      keyFacts,
      originalCount,
      compressionRatio: summary.length / totalLength,
      preservedDetails: kept.map((s) => s.obs),
      discardedDetails: dropped.map((s) => s.obs),
    };
  }

  /**
   * Produce a coarsened view of a set of entities at one of three
   * granularities. `fine` returns the entities unchanged; `medium`
   * trims observations to the top-3 most overlap-y per entity;
   * `coarse` distills each entity's observations into a single summary.
   */
  async abstractAtLevel(
    memories: Entity[],
    granularity: Granularity,
  ): Promise<Entity[]> {
    if (granularity === 'fine') return memories;

    const out: Entity[] = [];
    for (const e of memories) {
      if (granularity === 'medium') {
        const top3 = pickTop3(e.observations);
        out.push({ ...e, observations: top3 });
      } else {
        // coarse — distill into single-line summary
        const distilled = await this.distill(e.observations, { maxLength: 200 });
        out.push({ ...e, observations: [distilled.summary] });
      }
    }
    return out;
  }

  /**
   * Compress a working-memory text blob to fit within `maxTokens`.
   * Delegates to `ContextWindowManager.compressForContext` and chooses
   * the compression level based on how aggressively we need to shrink.
   * The `working` parameter is intentionally typed `string` here — the
   * spec talks about `WorkingMemory` but in practice the compressor
   * operates on serialized text.
   */
  async foldContext(working: string, maxTokens: number): Promise<string> {
    // Token estimate: ~4 chars/token (matches the project's ContextWindowManager default).
    const estTokens = Math.ceil(working.length / 4);
    if (estTokens <= maxTokens) return working;

    const ratio = estTokens / maxTokens;
    const level = ratio > 2 ? 'aggressive' : ratio > 1.3 ? 'medium' : 'light';
    const result = this.contextWindow.compressForContext(working, { level });
    return result.compressed;
  }

  /**
   * Identify groups of entities whose observation sets are largely
   * duplicates. Pairs entities whose union-of-observations Jaccard
   * exceeds the configured threshold. O(n²) pairwise; suitable for
   * graphs up to ~1k entities — beyond that, a candidate-blocking
   * pass on tags/projectId would be the natural extension.
   */
  async findRedundancies(entities: Entity[]): Promise<RedundancyGroup[]> {
    const groups: RedundancyGroup[] = [];
    const visited = new Set<string>();

    for (let i = 0; i < entities.length; i += 1) {
      if (visited.has(entities[i].name)) continue;
      const cluster: Entity[] = [entities[i]];
      const sims: number[] = [];
      visited.add(entities[i].name);

      for (let j = i + 1; j < entities.length; j += 1) {
        if (visited.has(entities[j].name)) continue;
        const sim = jaccard(
          new Set(entities[i].observations.flatMap((o) => Array.from(tokenize(o)))),
          new Set(entities[j].observations.flatMap((o) => Array.from(tokenize(o)))),
        );
        if (sim >= this.redundancyThreshold) {
          cluster.push(entities[j]);
          sims.push(sim);
          visited.add(entities[j].name);
        }
      }

      if (cluster.length > 1) {
        const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
        groups.push({
          entities: cluster,
          canonicalName: cluster[0].name,
          avgSimilarity: avg,
        });
      }
    }
    return groups;
  }

  /**
   * Collapse a redundancy group into a single canonical entity per
   * strategy. Doesn't persist — caller is responsible for the actual
   * `EntityManager.deleteEntities(...)` + `createEntity(merged)` dance
   * if they want the change durable.
   */
  async mergeRedundant(group: RedundancyGroup, strategy: MergeStrategy): Promise<Entity> {
    if (group.entities.length === 0) {
      throw new Error('TrajectoryCompressor.mergeRedundant: empty group');
    }

    let canonical: Entity;
    switch (strategy) {
      case 'keep-newest':
        canonical = group.entities.reduce((acc, e) =>
          (Date.parse(e.lastModified ?? '0') > Date.parse(acc.lastModified ?? '0')) ? e : acc,
        );
        break;
      case 'keep-most-confident':
        canonical = group.entities.reduce((acc, e) => {
          const ac = (acc as { confidence?: number }).confidence ?? 0;
          const ec = (e as { confidence?: number }).confidence ?? 0;
          return ec > ac ? e : acc;
        });
        break;
      case 'union-observations': {
        // Take the first as the carrier, union all observations dedup'd.
        const head = group.entities[0];
        const allObs = new Set<string>();
        for (const e of group.entities) for (const o of e.observations) allObs.add(o);
        canonical = { ...head, observations: Array.from(allObs) };
        break;
      }
    }
    return canonical;
  }
}

/** Tokenize for redundancy detection (lowercase, alpha-numeric). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function pickTop3(observations: string[]): string[] {
  if (observations.length <= 3) return observations;
  const tokens = observations.map(tokenize);
  const scores = tokens.map((set, i) => {
    let overlap = 0;
    for (let j = 0; j < tokens.length; j += 1) {
      if (i !== j) for (const t of set) if (tokens[j].has(t)) overlap += 1;
    }
    return { idx: i, score: overlap };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 3).map((s) => observations[s.idx]);
}
