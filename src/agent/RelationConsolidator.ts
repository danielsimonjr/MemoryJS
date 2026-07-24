/**
 * Relation Consolidator — R3 (brainapi2 "Janitor" pattern for relations)
 *
 * MemoryJS consolidation has historically been entity/observation-centric;
 * relations received no semantic dedup, no neighborhood validation, and no
 * corrective feedback. `RelationConsolidator` closes that gap with a
 * three-tier pass:
 *
 * - **Tier 1 — exact/near-exact**: relations sharing a `(from, to)` pair whose
 *   `relationType`s are trivial spelling variants (case / underscore / hyphen /
 *   camelCase, e.g. `works_at` vs `works-at` vs `WorksAt`) are merged onto the
 *   canonical spelling (most-used graph-wide, tie → oldest). Also flags
 *   inverse duplicates: a relation marked `properties.bidirectional` that
 *   exists in both directions.
 * - **Tier 2 — semantic (embedding-gated)**: when an `EmbeddingService`-
 *   compatible provider is injected, same-pair relations whose descriptors
 *   (`"<from> <relationType> <to>"` plus `properties.custom.description`)
 *   have cosine similarity at/above the threshold (default 0.90) are flagged
 *   as semantic duplicates; the merge keeps the higher-confidence/weight
 *   relation and sums `confirmationCount`. No provider = tier skipped.
 * - **Tier 3 — neighborhood validation (LLM-gated)**: when an `LLMProvider`
 *   is injected, a caller-supplied batch of NEW relations (e.g. from an
 *   ingest) is validated against a 2-hop neighborhood snapshot; the LLM
 *   returns structured verdicts (`ok` | `suspect` | `wrong`) as a
 *   `ConsolidationFeedback` report. This tier NEVER mutates — the caller
 *   decides what to do with the feedback. No provider = tier skipped.
 *
 * Merge semantics on `consolidate({ apply: true })` (tiers 1+2 only):
 * each merge group is applied as `deleteRelations(members)` followed by
 * `createRelations([merged])`. The merged relation carries the earliest
 * `createdAt`, the max `weight`/`confidence`, the survivor's `properties`
 * with `confirmationCount` summed across the group. Free-form
 * `Relation.metadata` is NOT carried over (the relation-creation schema
 * rejects it); flagged groups with load-bearing metadata should be merged
 * manually from the dry-run report.
 *
 * @module agent/RelationConsolidator
 * @experimental
 */

import type { Entity, Relation, RelationProperties } from '../types/types.js';
import type { LLMProvider } from '../search/LLMQueryPlanner.js';
import { extractJson } from './reconstruction/MemoryDistiller.js';
import type { PipelineStage, StageResult } from './ConsolidationPipeline.js';
import type { AgentEntity, ConsolidateOptions } from '../types/agent-memory.js';

// ==================== Structural dependency interfaces ====================

/**
 * Structural subset of `RelationManager` consumed by the consolidator.
 * Any object with these three methods works (real manager or test fake).
 */
export interface RelationConsolidatorRelationOps {
  getRelations(entityName: string): Promise<Relation[]>;
  createRelations(relations: Relation[]): Promise<Relation[]>;
  deleteRelations(relations: Relation[]): Promise<void>;
}

/**
 * Structural subset of `EntityManager` used to enumerate the graph for
 * tier 1/2 scans. Optional — without it, only tier 3 (which derives its
 * scope from the caller-supplied `newRelations`) can run.
 */
export interface RelationConsolidatorEntityOps {
  listEntities(filter?: { entityType?: string }): Promise<Entity[]>;
}

/**
 * Structural subset of `EmbeddingService` (mirrors how `SemanticSearch`
 * consumes it). A full `EmbeddingService` is assignable; so is any object
 * exposing `embed` (and optionally `embedBatch`).
 */
export interface RelationEmbeddingProvider {
  embed(text: string, mode?: 'query' | 'document'): Promise<number[]>;
  embedBatch?(texts: string[], mode?: 'query' | 'document'): Promise<number[][]>;
}

// ==================== Options ====================

/** Threshold knobs for `RelationConsolidator`. */
export interface RelationConsolidatorThresholds {
  /**
   * Cosine similarity at/above which two same-pair relations count as
   * semantic duplicates (tier 2). Default 0.90.
   */
  semantic?: number;
}

/** Constructor options for `RelationConsolidator`. */
export interface RelationConsolidatorOptions {
  /** Embedding provider enabling tier 2. Omitted = tier 2 skipped silently. */
  embedding?: RelationEmbeddingProvider;
  /** LLM provider enabling tier 3. Omitted = tier 3 skipped silently. */
  llm?: LLMProvider;
  thresholds?: RelationConsolidatorThresholds;
  /** Circuit breaker: max `(from, to)` groups analyzed per run. Default 100. */
  maxGroups?: number;
  /** Circuit breaker: max new relations sent to the LLM tier. Default 50. */
  maxLlmBatch?: number;
  /**
   * Cap on neighborhood relations serialized into the tier-3 prompt.
   * Default 200.
   */
  maxNeighborhoodRelations?: number;
}

/** Options for `analyze()`. */
export interface RelationAnalyzeOptions {
  /**
   * NEW relations (e.g. freshly extracted by an ingest) to validate in
   * tier 3 against their 2-hop graph neighborhood. Ignored when no
   * `LLMProvider` is configured.
   */
  newRelations?: Relation[];
}

/** Options for `consolidate()`. */
export interface RelationConsolidateOptions extends RelationAnalyzeOptions {
  /**
   * When `true`, tier 1+2 merges are applied via
   * `deleteRelations`/`createRelations`. Default `false` (dry-run —
   * identical to `analyze()`). Tier 3 is ALWAYS report-only.
   */
  apply?: boolean;
}

// ==================== Report types ====================

/** A same-pair group of trivial `relationType` spelling variants (tier 1). */
export interface ExactDuplicateGroup {
  from: string;
  to: string;
  /** Canonical literal spelling (most-used graph-wide, tie → oldest). */
  canonicalType: string;
  /** Normalization key shared by all members (e.g. `works_at`). */
  normalizedType: string;
  /** All same-pair spelling variants, including the canonical one if present. */
  members: Relation[];
  /** The single relation that exists after the merge is applied. */
  merged: Relation;
}

/** A bidirectional-marked relation that exists in both directions (tier 1). */
export interface InverseDuplicatePair {
  /** Survivor (the bidirectional-marked one; both marked → the older). */
  kept: Relation;
  /** The redundant mirror. */
  dropped: Relation;
  /** `kept` with `confirmationCount` summed across the pair. */
  merged: Relation;
  normalizedType: string;
}

/** A same-pair cluster of semantically equivalent relations (tier 2). */
export interface SemanticDuplicateGroup {
  from: string;
  to: string;
  /** Survivor (higher confidence, then weight, then older). */
  kept: Relation;
  dropped: Relation[];
  /** `kept` with `confirmationCount` summed across the cluster. */
  merged: Relation;
  /** Weakest link similarity that admitted the cluster (≥ threshold). */
  similarity: number;
}

/** Structured verdict for one validated relation (tier 3). */
export interface RelationVerdict {
  /** `"<from>|<relationType>|<to>"` — see `relationKey()`. */
  relationKey: string;
  verdict: 'ok' | 'suspect' | 'wrong';
  reason: string;
  suggestedFix?: string;
}

/** Tier-3 corrective-feedback report. Never applied by the consolidator. */
export interface ConsolidationFeedback {
  verdicts: RelationVerdict[];
  /** Relations actually sent to the LLM (post `maxLlmBatch` clipping). */
  batchSize: number;
  /** `true` when `maxLlmBatch` clipped the caller's batch. */
  truncated: boolean;
  /** Relations included in the 2-hop neighborhood snapshot. */
  neighborhoodSize: number;
}

/** Dry-run report across all three tiers. */
export interface RelationConsolidationReport {
  relationsScanned: number;
  groupsScanned: number;
  /** `true` when `maxGroups` truncated the `(from, to)` group scan. */
  groupsTruncated: boolean;
  exactDuplicates: ExactDuplicateGroup[];
  inverseDuplicates: InverseDuplicatePair[];
  semanticDuplicates: SemanticDuplicateGroup[];
  /** `true` when tier 2 was skipped (no embedding provider). */
  semanticTierSkipped: boolean;
  /** `true` when tier 3 was skipped (no LLM provider or no `newRelations`). */
  llmTierSkipped: boolean;
  /** Present only when tier 3 ran successfully. */
  feedback?: ConsolidationFeedback;
  errors: string[];
}

/** `consolidate()` result — the report plus what was actually applied. */
export interface RelationConsolidationResult extends RelationConsolidationReport {
  applied: boolean;
  relationsDeleted: number;
  relationsCreated: number;
}

// ==================== Helpers ====================

/**
 * Normalize a `relationType` for trivial-variant comparison:
 * camelCase → snake, hyphens/spaces → underscores, lowercase.
 * `WorksAt`, `works-at`, `Works At`, `works_at` all normalize to `works_at`.
 */
export function normalizeRelationType(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Stable identity key for a relation: `"<from>|<relationType>|<to>"`. */
export function relationKey(r: Pick<Relation, 'from' | 'to' | 'relationType'>): string {
  return `${r.from}|${r.relationType}|${r.to}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function timestampOf(r: Relation): number {
  const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Minimal triple for `deleteRelations` (schema rejects extra fields). */
function toTriple(r: Relation): Relation {
  return { from: r.from, to: r.to, relationType: r.relationType };
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Strip a merged relation down to the fields `CreateRelationSchema`
 * accepts (`metadata` and unknown top-level keys are rejected by the
 * strict schema; `properties` sub-keys pass through in strip mode).
 */
function sanitizeForCreate(r: Relation): Relation {
  const out: Relation = { from: r.from, to: r.to, relationType: r.relationType };
  if (r.createdAt !== undefined) out.createdAt = r.createdAt;
  if (r.weight !== undefined) out.weight = clamp01(r.weight);
  if (r.confidence !== undefined) out.confidence = clamp01(r.confidence);
  if (r.properties !== undefined) out.properties = { ...r.properties };
  return out;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  let max: number | undefined;
  for (const v of values) {
    if (typeof v === 'number' && (max === undefined || v > max)) max = v;
  }
  return max;
}

function sumConfirmations(relations: Relation[]): number | undefined {
  let any = false;
  let sum = 0;
  for (const r of relations) {
    const c = r.properties?.confirmationCount;
    if (typeof c === 'number') {
      any = true;
      sum += c;
    }
  }
  return any ? sum : undefined;
}

/**
 * Build the merged survivor for a group: `base`'s fields, earliest
 * `createdAt`, max `weight`/`confidence`, summed `confirmationCount`.
 */
function mergeGroup(base: Relation, members: Relation[], relationType: string): Relation {
  const earliest = members.reduce(
    (min, r) => Math.min(min, timestampOf(r)),
    Number.POSITIVE_INFINITY
  );
  const merged: Relation = {
    from: base.from,
    to: base.to,
    relationType,
  };
  if (Number.isFinite(earliest)) merged.createdAt = new Date(earliest).toISOString();
  const weight = maxDefined(members.map((r) => r.weight));
  if (weight !== undefined) merged.weight = weight;
  const confidence = maxDefined(members.map((r) => r.confidence));
  if (confidence !== undefined) merged.confidence = confidence;
  const confirmations = sumConfirmations(members);
  const properties: RelationProperties = { ...(base.properties ?? {}) };
  if (confirmations !== undefined) properties.confirmationCount = confirmations;
  if (Object.keys(properties).length > 0) merged.properties = properties;
  return merged;
}

function relationDescriptor(r: Relation): string {
  const description = r.properties?.custom?.description;
  const suffix = typeof description === 'string' && description.trim().length > 0
    ? ` — ${description.trim()}`
    : '';
  return `${r.from} ${r.relationType} ${r.to}${suffix}`;
}

/** Preference order for tier-2 survivors: confidence, weight, age, key. */
function preferKept(a: Relation, b: Relation): Relation {
  const ca = a.confidence ?? -1;
  const cb = b.confidence ?? -1;
  if (ca !== cb) return ca > cb ? a : b;
  const wa = a.weight ?? -1;
  const wb = b.weight ?? -1;
  if (wa !== wb) return wa > wb ? a : b;
  const ta = timestampOf(a);
  const tb = timestampOf(b);
  if (ta !== tb) return ta < tb ? a : b;
  return relationKey(a) <= relationKey(b) ? a : b;
}

const VALID_VERDICTS = new Set<RelationVerdict['verdict']>(['ok', 'suspect', 'wrong']);

/** Tolerant coercion of LLM output into `RelationVerdict[]`. */
function coerceVerdicts(parsed: unknown): RelationVerdict[] {
  let items: unknown[] = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    const maybe = (parsed as Record<string, unknown>).verdicts;
    if (Array.isArray(maybe)) items = maybe;
  }
  const verdicts: RelationVerdict[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = rec.relationKey;
    const verdict = rec.verdict;
    if (typeof key !== 'string' || key.length === 0) continue;
    if (typeof verdict !== 'string' || !VALID_VERDICTS.has(verdict as RelationVerdict['verdict'])) {
      continue;
    }
    const out: RelationVerdict = {
      relationKey: key,
      verdict: verdict as RelationVerdict['verdict'],
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    };
    if (typeof rec.suggestedFix === 'string' && rec.suggestedFix.length > 0) {
      out.suggestedFix = rec.suggestedFix;
    }
    verdicts.push(out);
  }
  return verdicts;
}

// ==================== RelationConsolidator ====================

const GROUP_SEP = '\u0000';

/**
 * Three-tier relation janitor. See module doc for tier semantics.
 *
 * @example
 * ```typescript
 * const janitor = new RelationConsolidator(relationManager, entityManager, {
 *   embedding: semanticSearch.getEmbeddingService(), // optional → tier 2
 *   llm: myProvider,                                 // optional → tier 3
 * });
 *
 * // Dry-run: every tier reports, nothing mutates.
 * const report = await janitor.analyze({ newRelations: freshlyIngested });
 *
 * // Apply tier 1+2 merges (tier 3 stays report-only).
 * const result = await janitor.consolidate({ apply: true });
 * ```
 *
 * @experimental
 */
export class RelationConsolidator {
  private readonly embedding?: RelationEmbeddingProvider;
  private readonly llm?: LLMProvider;
  private readonly semanticThreshold: number;
  private readonly maxGroups: number;
  private readonly maxLlmBatch: number;
  private readonly maxNeighborhoodRelations: number;

  constructor(
    private readonly relationOps: RelationConsolidatorRelationOps,
    private readonly entityOps?: RelationConsolidatorEntityOps,
    options: RelationConsolidatorOptions = {}
  ) {
    this.embedding = options.embedding;
    this.llm = options.llm;
    this.semanticThreshold = options.thresholds?.semantic ?? 0.9;
    this.maxGroups = options.maxGroups ?? 100;
    this.maxLlmBatch = options.maxLlmBatch ?? 50;
    this.maxNeighborhoodRelations = options.maxNeighborhoodRelations ?? 200;
  }

  // ==================== Public API ====================

  /**
   * Dry-run all tiers and return the consolidated report. Never mutates
   * the graph (all tiers report-only).
   */
  async analyze(options: RelationAnalyzeOptions = {}): Promise<RelationConsolidationReport> {
    const report: RelationConsolidationReport = {
      relationsScanned: 0,
      groupsScanned: 0,
      groupsTruncated: false,
      exactDuplicates: [],
      inverseDuplicates: [],
      semanticDuplicates: [],
      semanticTierSkipped: this.embedding === undefined,
      llmTierSkipped: true,
      errors: [],
    };

    const all = await this.collectAllRelations(report.errors);
    report.relationsScanned = all.length;

    // Group by exact (from, to) pair.
    const groups = new Map<string, Relation[]>();
    for (const r of all) {
      const key = `${r.from}${GROUP_SEP}${r.to}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    const orderedKeys = [...groups.keys()].sort();
    const scannedKeys = orderedKeys.slice(0, this.maxGroups);
    report.groupsScanned = scannedKeys.length;
    report.groupsTruncated = orderedKeys.length > scannedKeys.length;

    // Graph-wide spelling statistics (canonical-spelling election).
    const spellingStats = this.buildSpellingStats(all);

    // Tier 1a — spelling-variant groups.
    for (const groupKey of scannedKeys) {
      const members = groups.get(groupKey)!;
      const byNorm = new Map<string, Relation[]>();
      for (const r of members) {
        const norm = normalizeRelationType(r.relationType);
        const bucket = byNorm.get(norm);
        if (bucket) bucket.push(r);
        else byNorm.set(norm, [r]);
      }
      for (const [norm, bucket] of byNorm) {
        if (bucket.length < 2) continue;
        const canonicalType = this.pickCanonicalSpelling(norm, spellingStats);
        const sorted = [...bucket].sort(
          (a, b) => timestampOf(a) - timestampOf(b) || relationKey(a).localeCompare(relationKey(b))
        );
        const base = sorted.find((r) => r.relationType === canonicalType) ?? sorted[0];
        report.exactDuplicates.push({
          from: base.from,
          to: base.to,
          canonicalType,
          normalizedType: norm,
          members: sorted,
          merged: mergeGroup(base, sorted, canonicalType),
        });
      }
    }

    // Tier 1b — bidirectional inverse duplicates.
    this.detectInverseDuplicates(groups, scannedKeys, report);

    // Tier 2 — semantic duplicates (embedding-gated).
    if (this.embedding) {
      await this.detectSemanticDuplicates(groups, scannedKeys, report);
    }

    // Tier 3 — neighborhood validation (LLM-gated; never mutates).
    const newRelations = options.newRelations ?? [];
    if (this.llm && newRelations.length > 0) {
      report.llmTierSkipped = false;
      await this.validateNewRelations(newRelations, report);
    }

    return report;
  }

  /**
   * Run `analyze()` and — when `apply: true` — apply tier 1+2 merges via
   * `deleteRelations`/`createRelations`. Tier 3 is always report-only.
   * With `apply` unset/false this is an alias for `analyze()`.
   */
  async consolidate(
    options: RelationConsolidateOptions = {}
  ): Promise<RelationConsolidationResult> {
    const report = await this.analyze(options);
    const result: RelationConsolidationResult = {
      ...report,
      applied: options.apply === true,
      relationsDeleted: 0,
      relationsCreated: 0,
    };
    if (options.apply !== true) return result;

    // Keys deleted by an earlier action and not (yet) recreated. A later
    // group only proceeds when all its physical members still exist.
    const dead = new Set<string>();

    // Tier 1a — spelling merges.
    for (const g of result.exactDuplicates) {
      if (g.members.some((m) => dead.has(relationKey(m)))) continue;
      await this.applyMerge(g.members, g.merged, dead, result);
    }

    // Tier 1b — inverse duplicates.
    for (const p of result.inverseDuplicates) {
      if (dead.has(relationKey(p.kept)) || dead.has(relationKey(p.dropped))) continue;
      await this.applyMerge([p.kept, p.dropped], p.merged, dead, result);
    }

    // Tier 2 — semantic merges.
    for (const g of result.semanticDuplicates) {
      const members = [g.kept, ...g.dropped];
      if (members.some((m) => dead.has(relationKey(m)))) continue;
      await this.applyMerge(members, g.merged, dead, result);
    }

    return result;
  }

  // ==================== Internals ====================

  /** Delete a group's members and create the merged survivor. */
  private async applyMerge(
    members: Relation[],
    merged: Relation,
    dead: Set<string>,
    result: RelationConsolidationResult
  ): Promise<void> {
    try {
      await this.relationOps.deleteRelations(members.map(toTriple));
      result.relationsDeleted += members.length;
      for (const m of members) dead.add(relationKey(m));
      await this.relationOps.createRelations([sanitizeForCreate(merged)]);
      result.relationsCreated += 1;
      dead.delete(relationKey(merged));
    } catch (err) {
      result.errors.push(
        `RelationConsolidator: merge failed for ${relationKey(merged)}: ${errMsg(err)}`
      );
    }
  }

  /**
   * Enumerate every relation in the graph (deduped by identity key).
   * Requires the entity source; without it the tier 1/2 scan is skipped
   * with a diagnostic.
   */
  private async collectAllRelations(errors: string[]): Promise<Relation[]> {
    if (!this.entityOps) {
      errors.push(
        '[info] RelationConsolidator: no entity source configured; tier 1/2 graph scan skipped'
      );
      return [];
    }
    const seen = new Map<string, Relation>();
    let entities: Entity[];
    try {
      entities = await this.entityOps.listEntities();
    } catch (err) {
      errors.push(`RelationConsolidator: listEntities failed: ${errMsg(err)}`);
      return [];
    }
    for (const entity of entities) {
      try {
        for (const r of await this.relationOps.getRelations(entity.name)) {
          const key = relationKey(r);
          if (!seen.has(key)) seen.set(key, r);
        }
      } catch (err) {
        errors.push(
          `RelationConsolidator: getRelations('${entity.name}') failed: ${errMsg(err)}`
        );
      }
    }
    return [...seen.values()];
  }

  private buildSpellingStats(
    all: Relation[]
  ): Map<string, Map<string, { count: number; oldest: number }>> {
    const stats = new Map<string, Map<string, { count: number; oldest: number }>>();
    for (const r of all) {
      const norm = normalizeRelationType(r.relationType);
      let spellings = stats.get(norm);
      if (!spellings) {
        spellings = new Map();
        stats.set(norm, spellings);
      }
      const entry = spellings.get(r.relationType);
      const ts = timestampOf(r);
      if (entry) {
        entry.count += 1;
        if (ts < entry.oldest) entry.oldest = ts;
      } else {
        spellings.set(r.relationType, { count: 1, oldest: ts });
      }
    }
    return stats;
  }

  /** Most-used spelling graph-wide; tie → oldest; final tie → lexicographic. */
  private pickCanonicalSpelling(
    norm: string,
    stats: Map<string, Map<string, { count: number; oldest: number }>>
  ): string {
    const spellings = stats.get(norm);
    if (!spellings || spellings.size === 0) return norm;
    let best: { spelling: string; count: number; oldest: number } | undefined;
    for (const [spelling, s] of spellings) {
      if (
        !best ||
        s.count > best.count ||
        (s.count === best.count && s.oldest < best.oldest) ||
        (s.count === best.count && s.oldest === best.oldest && spelling < best.spelling)
      ) {
        best = { spelling, count: s.count, oldest: s.oldest };
      }
    }
    return best!.spelling;
  }

  private detectInverseDuplicates(
    groups: Map<string, Relation[]>,
    scannedKeys: string[],
    report: RelationConsolidationReport
  ): void {
    const seenPairs = new Set<string>();
    for (const groupKey of scannedKeys) {
      const sepIndex = groupKey.indexOf(GROUP_SEP);
      const from = groupKey.slice(0, sepIndex);
      const to = groupKey.slice(sepIndex + 1);
      if (from === to) continue;
      const reverse = groups.get(`${to}${GROUP_SEP}${from}`);
      if (!reverse) continue;
      for (const r of groups.get(groupKey)!) {
        const norm = normalizeRelationType(r.relationType);
        for (const s of reverse) {
          if (normalizeRelationType(s.relationType) !== norm) continue;
          const rBid = r.properties?.bidirectional === true;
          const sBid = s.properties?.bidirectional === true;
          if (!rBid && !sBid) continue;
          const pairId = [relationKey(r), relationKey(s)].sort().join('||');
          if (seenPairs.has(pairId)) continue;
          seenPairs.add(pairId);

          let kept: Relation;
          if (rBid && sBid) {
            kept =
              timestampOf(r) < timestampOf(s) ||
              (timestampOf(r) === timestampOf(s) && relationKey(r) <= relationKey(s))
                ? r
                : s;
          } else {
            kept = rBid ? r : s;
          }
          const dropped = kept === r ? s : r;
          report.inverseDuplicates.push({
            kept,
            dropped,
            merged: mergeGroup(kept, [kept, dropped], kept.relationType),
            normalizedType: norm,
          });
        }
      }
    }
  }

  private async detectSemanticDuplicates(
    groups: Map<string, Relation[]>,
    scannedKeys: string[],
    report: RelationConsolidationReport
  ): Promise<void> {
    const embedding = this.embedding!;

    // Index tier-1 groups by pair so representatives use the post-merge form.
    const exactByPair = new Map<string, ExactDuplicateGroup[]>();
    for (const g of report.exactDuplicates) {
      const key = `${g.from}${GROUP_SEP}${g.to}`;
      const list = exactByPair.get(key);
      if (list) list.push(g);
      else exactByPair.set(key, [g]);
    }

    for (const groupKey of scannedKeys) {
      const members = groups.get(groupKey)!;
      const exactGroups = exactByPair.get(groupKey) ?? [];
      const mergedByNorm = new Map(exactGroups.map((g) => [g.normalizedType, g.merged]));

      // One representative per normalized type: the tier-1 merged form when
      // that type had spelling variants, the lone relation otherwise.
      const reps = new Map<string, Relation>();
      for (const r of members) {
        const norm = normalizeRelationType(r.relationType);
        if (!reps.has(norm)) reps.set(norm, mergedByNorm.get(norm) ?? r);
      }
      if (reps.size < 2) continue;

      const entries = [...reps.entries()].sort(([a], [b]) => a.localeCompare(b));
      const relations = entries.map(([, r]) => r);
      let vectors: number[][];
      try {
        const descriptors = relations.map(relationDescriptor);
        vectors = embedding.embedBatch
          ? await embedding.embedBatch(descriptors)
          : await Promise.all(descriptors.map((d) => embedding.embed(d)));
      } catch (err) {
        report.errors.push(
          `RelationConsolidator: embedding failed for pair ${groupKey.replace(GROUP_SEP, ' -> ')}: ${errMsg(err)}`
        );
        continue;
      }

      // Greedy star clustering: each unclaimed relation seeds a cluster and
      // absorbs unclaimed relations whose similarity to the seed >= threshold.
      const claimed = new Array<boolean>(relations.length).fill(false);
      for (let i = 0; i < relations.length; i++) {
        if (claimed[i]) continue;
        const cluster = [relations[i]];
        let weakestLink = Number.POSITIVE_INFINITY;
        for (let j = i + 1; j < relations.length; j++) {
          if (claimed[j]) continue;
          const sim = cosineSimilarity(vectors[i], vectors[j]);
          if (sim >= this.semanticThreshold) {
            claimed[j] = true;
            cluster.push(relations[j]);
            if (sim < weakestLink) weakestLink = sim;
          }
        }
        if (cluster.length < 2) continue;
        claimed[i] = true;
        const kept = cluster.reduce((best, r) => preferKept(best, r));
        const dropped = cluster.filter((r) => r !== kept);
        report.semanticDuplicates.push({
          from: kept.from,
          to: kept.to,
          kept,
          dropped,
          merged: mergeGroup(kept, cluster, kept.relationType),
          similarity: weakestLink,
        });
      }
    }
  }

  private async validateNewRelations(
    newRelations: Relation[],
    report: RelationConsolidationReport
  ): Promise<void> {
    const llm = this.llm!;
    const batch = newRelations.slice(0, this.maxLlmBatch);
    const truncated = newRelations.length > batch.length;
    const neighborhood = await this.buildNeighborhood(batch, report.errors);
    const prompt = this.buildValidationPrompt(batch, neighborhood);
    try {
      const raw = await llm.complete(prompt);
      const verdicts = coerceVerdicts(extractJson<unknown>(raw));
      report.feedback = {
        verdicts,
        batchSize: batch.length,
        truncated,
        neighborhoodSize: neighborhood.length,
      };
    } catch (err) {
      report.errors.push(`RelationConsolidator: LLM validation failed: ${errMsg(err)}`);
    }
  }

  /**
   * 2-hop BFS over `getRelations` from the batch's endpoints. Simple and
   * decoupled — deliberately does not pull in `GraphTraversal`.
   */
  private async buildNeighborhood(batch: Relation[], errors: string[]): Promise<Relation[]> {
    const collected = new Map<string, Relation>();
    const batchKeys = new Set(batch.map(relationKey));
    const visited = new Set<string>();
    let frontier = [...new Set(batch.flatMap((r) => [r.from, r.to]))].sort();
    for (const name of frontier) visited.add(name);

    let full = false;
    for (let hop = 0; hop < 2 && frontier.length > 0 && !full; hop++) {
      const next: string[] = [];
      for (const name of frontier) {
        if (full) break;
        let relations: Relation[];
        try {
          relations = await this.relationOps.getRelations(name);
        } catch (err) {
          errors.push(
            `RelationConsolidator: neighborhood lookup failed for '${name}': ${errMsg(err)}`
          );
          continue;
        }
        for (const r of relations) {
          const key = relationKey(r);
          if (!batchKeys.has(key) && !collected.has(key)) {
            if (collected.size >= this.maxNeighborhoodRelations) {
              full = true;
              break;
            }
            collected.set(key, r);
          }
          for (const endpoint of [r.from, r.to]) {
            if (!visited.has(endpoint)) {
              visited.add(endpoint);
              next.push(endpoint);
            }
          }
        }
      }
      frontier = next.sort();
    }
    return [...collected.values()];
  }

  private buildValidationPrompt(batch: Relation[], neighborhood: Relation[]): string {
    const describe = (r: Relation): string => `${r.from} -[${r.relationType}]-> ${r.to}`;
    const snapshot =
      neighborhood.length > 0
        ? neighborhood.map((r) => `- ${describe(r)}`).join('\n')
        : '- (empty — no existing relations within 2 hops)';
    const items = batch
      .map((r) => `- key: "${relationKey(r)}" | ${describe(r)}`)
      .join('\n');
    return `You are a knowledge-graph janitor validating newly proposed relations against a snapshot of the existing graph neighborhood (all relations within 2 hops of the new relations' endpoints).

Existing neighborhood relations:
${snapshot}

New relations to validate:
${items}

For EACH new relation return one verdict object:
- "ok": consistent with the neighborhood
- "suspect": possibly redundant or questionable given the neighborhood (explain why)
- "wrong": contradicts the neighborhood (explain why; suggest a corrected relation in suggestedFix)

Respond with ONLY a JSON array, no prose:
[{"relationKey": "<key from above>", "verdict": "ok" | "suspect" | "wrong", "reason": "<short reason>", "suggestedFix": "<optional corrected relation, e.g. A -[works_at]-> B>"}]`;
  }
}

// ==================== RelationConsolidationStage ====================

/** Configuration for `RelationConsolidationStage`. */
export interface RelationConsolidationStageConfig {
  /**
   * When `true`, the stage applies tier 1+2 merges each run. Default
   * `false` — report-only, mirroring `ObservationDedupReportStage`'s
   * diagnostic style.
   */
  apply?: boolean;
  /** Optional batch of new relations forwarded to tier 3 each run. */
  newRelations?: Relation[];
}

/**
 * `PipelineStage` wrapper for `RelationConsolidator`. Report-only by
 * default: emits one `[info]`-prefixed entry per finding on
 * `StageResult.errors` (the `[info]` prefix marks entries as non-fatal —
 * aggregators that gate on `errors.length` should filter it out) and
 * leaves the graph untouched. With `apply: true`, tier 1+2 merges are
 * applied and `transformed` reports the number of merged relations
 * created. Tier 3 stays report-only in both modes.
 *
 * Not auto-registered on `ConsolidationPipeline` — construct and
 * `registerStage()` explicitly:
 *
 * ```typescript
 * pipeline.registerStage(new RelationConsolidationStage(consolidator));
 * ```
 */
export class RelationConsolidationStage implements PipelineStage {
  readonly name = 'relation-consolidation';
  private readonly apply: boolean;
  private readonly newRelations?: Relation[];

  constructor(
    private readonly consolidator: RelationConsolidator,
    config: RelationConsolidationStageConfig = {}
  ) {
    this.apply = config.apply ?? false;
    this.newRelations = config.newRelations;
  }

  async process(_entities: AgentEntity[], _options: ConsolidateOptions): Promise<StageResult> {
    const errors: string[] = [];
    try {
      const result = await this.consolidator.consolidate({
        apply: this.apply,
        newRelations: this.newRelations,
      });
      errors.push(...result.errors);
      const suffix = result.applied ? ', applied' : '';
      for (const g of result.exactDuplicates) {
        errors.push(
          `[info] RelationConsolidationStage: ${g.members.length} spelling variants of '${g.normalizedType}' on ${g.from} -> ${g.to} (canonical='${g.canonicalType}', tier=exact${suffix})`
        );
      }
      for (const p of result.inverseDuplicates) {
        errors.push(
          `[info] RelationConsolidationStage: inverse duplicate '${p.normalizedType}' between ${p.kept.from} <-> ${p.kept.to} (kept ${relationKey(p.kept)}, tier=inverse${suffix})`
        );
      }
      for (const s of result.semanticDuplicates) {
        errors.push(
          `[info] RelationConsolidationStage: ${s.dropped.length + 1} semantically equivalent relations on ${s.from} -> ${s.to} (kept '${s.kept.relationType}', sim=${s.similarity.toFixed(2)}, tier=semantic${suffix})`
        );
      }
      if (result.feedback) {
        for (const v of result.feedback.verdicts) {
          if (v.verdict === 'ok') continue;
          errors.push(
            `[info] RelationConsolidationStage: verdict=${v.verdict} for ${v.relationKey}${v.reason ? ` (${v.reason})` : ''}${v.suggestedFix ? ` fix: ${v.suggestedFix}` : ''} (tier=llm, report-only)`
          );
        }
      }
      return {
        processed: result.relationsScanned,
        transformed: result.applied ? result.relationsCreated : 0,
        errors,
      };
    } catch (err) {
      return {
        processed: 0,
        transformed: 0,
        errors: [`RelationConsolidationStage failed: ${errMsg(err)}`],
      };
    }
  }
}
