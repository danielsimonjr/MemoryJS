/**
 * Anomaly Detector
 *
 * Phase 5 step 51 (§13.3) — flags outliers in a knowledge graph
 * along two axes:
 *
 * 1. **Structural** anomalies — entities whose graph-degree (in-degree,
 *    out-degree, or total) is unusually high or low relative to the
 *    population (z-score outlier with configurable threshold).
 *
 * 2. **Semantic** anomalies — entities whose embedding sits far from
 *    the centroid of its type cluster (k-NN distance > population
 *    z-score threshold). Used after `computeNode2Vec` or any other
 *    embedding source.
 *
 * **No external deps.** Pure TS. Same style as the other Phase 5
 * statistical features — give callers diagnostic statistics they can
 * route into alerting / review queues without bringing in a stats
 * library.
 *
 * @module features/AnomalyDetector
 * @experimental Outlier-threshold semantics (z-score vs IQR vs LOF)
 *   may evolve in non-breaking ways — new methods will be added as
 *   `detectXxx` rather than reshaping existing ones.
 */

import type { Entity, KnowledgeGraph, Relation } from '../types/types.js';

// ==================== Types ====================

export type AnomalyKind = 'high-degree' | 'low-degree' | 'semantic-outlier';

export interface AnomalyReport {
  entityName: string;
  kind: AnomalyKind;
  /** How many standard deviations from the mean. */
  zScore: number;
  /** Direction-agnostic |zScore|, for sorting. */
  magnitude: number;
  /** Per-kind diagnostic detail. */
  detail: Record<string, number | string>;
}

export interface StructuralAnomalyOptions {
  /** z-score magnitude above which an entity is flagged. Default: 3. */
  zThreshold?: number;
  /** Which degree to evaluate. Default: 'total'. */
  metric?: 'in' | 'out' | 'total';
  /** Cap result count (sorted by |z|). Default: unlimited. */
  topK?: number;
}

export interface SemanticAnomalyOptions {
  /** z-score magnitude above which an entity is flagged. Default: 3. */
  zThreshold?: number;
  /** Number of nearest neighbors to average for outlier-distance. Default: 5. */
  k?: number;
  /** Cap result count. Default: unlimited. */
  topK?: number;
}

// ==================== Structural anomalies ====================

/**
 * Flag entities with unusually high or low connectivity. Uses z-score
 * on the chosen degree metric — for graphs with a power-law degree
 * distribution, the z-score over the raw count surfaces the
 * power-law tail (hub nodes) plus completely-disconnected ones.
 *
 * Note: a single z-score pass on a power-law distribution will tend
 * to flag the top of the tail rather than the tail's "elbow". For
 * deeper graph-shape analysis, run this then filter by domain rules.
 *
 * @example
 * ```typescript
 * const report = detectStructuralAnomalies(graph, { metric: 'total', zThreshold: 2.5 });
 * for (const r of report) console.log(`${r.entityName} degree=${r.detail.degree}, z=${r.zScore.toFixed(2)}`);
 * ```
 */
export function detectStructuralAnomalies(
  graph: KnowledgeGraph,
  options: StructuralAnomalyOptions = {},
): AnomalyReport[] {
  const zThreshold = options.zThreshold ?? 3;
  const metric = options.metric ?? 'total';

  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of graph.entities) {
    inDeg.set(e.name, 0);
    outDeg.set(e.name, 0);
  }
  for (const r of graph.relations) {
    outDeg.set(r.from, (outDeg.get(r.from) ?? 0) + 1);
    inDeg.set(r.to, (inDeg.get(r.to) ?? 0) + 1);
  }

  const degrees: number[] = [];
  const perEntity = new Map<string, number>();
  for (const e of graph.entities) {
    const d =
      metric === 'in'
        ? inDeg.get(e.name) ?? 0
        : metric === 'out'
        ? outDeg.get(e.name) ?? 0
        : (inDeg.get(e.name) ?? 0) + (outDeg.get(e.name) ?? 0);
    perEntity.set(e.name, d);
    degrees.push(d);
  }

  const { mean, stdDev } = meanStdDev(degrees);
  // No variance → no anomalies are well-defined.
  if (stdDev === 0) return [];

  const reports: AnomalyReport[] = [];
  for (const [name, degree] of perEntity) {
    const z = (degree - mean) / stdDev;
    if (Math.abs(z) < zThreshold) continue;
    reports.push({
      entityName: name,
      kind: z > 0 ? 'high-degree' : 'low-degree',
      zScore: z,
      magnitude: Math.abs(z),
      detail: { degree, mean, stdDev, metric },
    });
  }

  reports.sort((a, b) => b.magnitude - a.magnitude);
  return options.topK !== undefined ? reports.slice(0, options.topK) : reports;
}

// ==================== Semantic anomalies ====================

/**
 * Flag entities whose embedding's average distance to its `k` nearest
 * neighbors is unusually high (i.e. it lives in a sparse region of
 * the embedding space). This is the building block of LOF-style
 * outlier detection without the full "reachability density" stage —
 * good enough for surfacing semantic misfits in a typed graph.
 *
 * `embeddings` is a `name -> L2-normalized vector` map (compatible
 * with `Node2VecResult.embeddings`). When embeddings are normalized,
 * `distance = 1 - cosineSimilarity`.
 *
 * @example
 * ```typescript
 * const { embeddings } = computeNode2Vec(graph, { seed: 1 });
 * const outliers = detectSemanticAnomalies(embeddings, { zThreshold: 2 });
 * ```
 */
export function detectSemanticAnomalies(
  embeddings: Map<string, Float32Array>,
  options: SemanticAnomalyOptions = {},
): AnomalyReport[] {
  const zThreshold = options.zThreshold ?? 3;
  const k = options.k ?? 5;
  const ids = [...embeddings.keys()];
  if (ids.length < k + 2) return [];

  // Precompute L2 norms once. Falling back to true cosine distance
  // (`1 - dot/(|u||v|)`) protects callers who pass un-normalized
  // embeddings — without this guard, dot products > 1 produce
  // negative "distances" and silently break the z-score logic.
  const norms = new Map<string, number>();
  for (const id of ids) {
    const v = embeddings.get(id)!;
    norms.set(id, l2Norm(v));
  }

  const avgDistances = new Map<string, number>();
  for (const id of ids) {
    const v = embeddings.get(id)!;
    const nv = norms.get(id)!;
    const distances: number[] = [];
    for (const other of ids) {
      if (other === id) continue;
      const u = embeddings.get(other)!;
      if (u.length !== v.length) continue;
      const nu = norms.get(other)!;
      const denom = nu * nv;
      const cos = denom === 0 ? 0 : dotProduct(u, v) / denom;
      // Cosine distance in `[0, 2]`. Clamp on top to avoid float drift
      // pushing distance slightly negative when the norm reconstruction
      // is imperfect.
      distances.push(Math.max(0, 1 - cos));
    }
    distances.sort((a, b) => a - b);
    const slice = distances.slice(0, k);
    const sum = slice.reduce((s, d) => s + d, 0);
    avgDistances.set(id, sum / Math.max(1, slice.length));
  }

  const values = [...avgDistances.values()];
  const { mean, stdDev } = meanStdDev(values);
  if (stdDev === 0) return [];

  const reports: AnomalyReport[] = [];
  for (const [name, dist] of avgDistances) {
    const z = (dist - mean) / stdDev;
    if (z < zThreshold) continue; // only "far" matters for semantic outliers
    reports.push({
      entityName: name,
      kind: 'semantic-outlier',
      zScore: z,
      magnitude: z,
      detail: { avgKnnDistance: dist, mean, stdDev, k },
    });
  }

  reports.sort((a, b) => b.magnitude - a.magnitude);
  return options.topK !== undefined ? reports.slice(0, options.topK) : reports;
}

// ==================== Combined helper ====================

/**
 * Run both structural and semantic anomaly detection in one pass.
 * Useful for "show me everything weird about this graph" reports.
 *
 * Pass `embeddings: null` to skip the semantic stage.
 */
export function detectAllAnomalies(
  graph: KnowledgeGraph,
  embeddings: Map<string, Float32Array> | null,
  structuralOptions: StructuralAnomalyOptions = {},
  semanticOptions: SemanticAnomalyOptions = {},
): AnomalyReport[] {
  const structural = detectStructuralAnomalies(graph, structuralOptions);
  const semantic = embeddings ? detectSemanticAnomalies(embeddings, semanticOptions) : [];
  const combined = [...structural, ...semantic];
  combined.sort((a, b) => b.magnitude - a.magnitude);
  return combined;
}

// ==================== Internals ====================

function meanStdDev(xs: number[]): { mean: number; stdDev: number } {
  if (xs.length === 0) return { mean: 0, stdDev: 0 };
  const sum = xs.reduce((s, x) => s + x, 0);
  const mean = sum / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function l2Norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

// Re-export for callers who want to introspect.
export type { Entity, Relation };
