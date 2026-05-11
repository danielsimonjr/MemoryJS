/**
 * Node2Vec — biased-random-walk graph embeddings
 *
 * Phase 5 step 50 (§13.2) — minimal from-scratch implementation of
 * node2vec [Grover & Leskovec 2016]: generate biased random walks
 * over the knowledge-graph adjacency, then train a Skip-Gram model
 * with negative sampling on the walks to produce a dense embedding
 * per entity.
 *
 * **No external deps.** Pure TS, deterministic when a `seed` is
 * provided. Not GPU-accelerated and not tuned for graphs > ~10k
 * nodes — for production-scale embeddings, use a real ML library
 * (Phase 5 step 51's plan covers swapping in a hosted embedding
 * service).
 *
 * The implementation is two parts:
 *
 * 1. `BiasedRandomWalk` — the core node2vec contribution. Walks are
 *    parameterised by `(p, q)`:
 *    - `1/p` is the bias toward returning to the previous node
 *    - `1/q` is the bias toward exploring further from the previous node
 *    - `p = q = 1` reduces to DeepWalk (uniform random walks)
 *
 * 2. `SkipGramTrainer` — a tiny Skip-Gram with negative sampling
 *    (SGNS) impl. Each walk is treated as a "sentence", each node as a
 *    "word"; for each center node we pull the context vectors closer
 *    and push `negativeSamples` random non-context vectors away.
 *
 * @module search/Node2Vec
 * @experimental API shape (`Node2VecOptions`, `Node2VecResult`) may
 *   evolve as we add things like edge-weighted walks or asymmetric
 *   p/q per edge type.
 */

import type { Entity, KnowledgeGraph, Relation } from '../types/types.js';

// ==================== Types ====================

/** Adjacency map: nodeName → set of neighbor nodeNames. Directed. */
export type AdjacencyMap = Map<string, string[]>;

export interface Node2VecOptions {
  /** Length of each random walk (steps). Default: 20. */
  walkLength?: number;
  /** Number of walks to start from each node. Default: 10. */
  numWalks?: number;
  /** Return parameter — bias toward `t` (previous node). Lower = more "return". Default: 1. */
  p?: number;
  /** In-out parameter — bias toward farther nodes. Lower = more "outward". Default: 1. */
  q?: number;
  /** Embedding dimension. Default: 64. */
  dimensions?: number;
  /** Skip-Gram context window. Default: 5. */
  window?: number;
  /** Number of negative samples per positive pair. Default: 5. */
  negativeSamples?: number;
  /** Training epochs. Default: 5. */
  epochs?: number;
  /** Initial learning rate (decays linearly to 0). Default: 0.025. */
  learningRate?: number;
  /** Optional deterministic seed for the PRNG. */
  seed?: number;
  /** Treat relations as undirected (add reverse edge). Default: true. */
  undirected?: boolean;
}

export interface Node2VecResult {
  /** node-name → embedding vector (length = `dimensions`). */
  embeddings: Map<string, Float32Array>;
  /** The full corpus of random walks generated. Useful for inspection. */
  walks: string[][];
  /** Dimensions of each embedding (echoed for downstream callers). */
  dimensions: number;
  /** Vocabulary in stable insertion order (matches embedding indices). */
  vocabulary: string[];
}

const DEFAULTS: Required<Omit<Node2VecOptions, 'seed'>> & { seed?: number } = {
  walkLength: 20,
  numWalks: 10,
  p: 1,
  q: 1,
  dimensions: 64,
  window: 5,
  negativeSamples: 5,
  epochs: 5,
  learningRate: 0.025,
  undirected: true,
};

// ==================== Public entry ====================

/**
 * Compute node2vec embeddings for every node reachable from a graph
 * edge. Isolated nodes (no incident relations) are excluded — they
 * would produce zero-information embeddings.
 *
 * @example
 * ```typescript
 * const result = await computeNode2Vec(graph, { dimensions: 32, seed: 42 });
 * const aliceVec = result.embeddings.get('alice');
 * ```
 */
export function computeNode2Vec(graph: KnowledgeGraph, options: Node2VecOptions = {}): Node2VecResult {
  const opts = { ...DEFAULTS, ...options };
  const rng = makeRng(opts.seed);

  const adj = buildAdjacency(graph.entities, graph.relations, opts.undirected);
  const walker = new BiasedRandomWalk(adj, opts.p, opts.q, rng);
  const walks = walker.generateAll(opts.walkLength, opts.numWalks);

  const trainer = new SkipGramTrainer(walks, {
    dimensions: opts.dimensions,
    window: opts.window,
    negativeSamples: opts.negativeSamples,
    epochs: opts.epochs,
    learningRate: opts.learningRate,
    rng,
  });
  const { embeddings, vocabulary } = trainer.train();

  return {
    embeddings,
    walks,
    dimensions: opts.dimensions,
    vocabulary,
  };
}

// ==================== Adjacency ====================

/**
 * Build a directed adjacency list from `entities` + `relations`.
 * `undirected: true` also adds the reverse edge for every relation —
 * this matches how most graph-embedding papers treat knowledge
 * graphs where edge direction encodes semantics but not reachability.
 */
export function buildAdjacency(
  entities: Entity[],
  relations: Relation[],
  undirected = true,
): AdjacencyMap {
  const adj: AdjacencyMap = new Map();
  for (const e of entities) adj.set(e.name, []);
  for (const r of relations) {
    if (!adj.has(r.from)) adj.set(r.from, []);
    if (!adj.has(r.to)) adj.set(r.to, []);
    adj.get(r.from)!.push(r.to);
    if (undirected) adj.get(r.to)!.push(r.from);
  }
  return adj;
}

// ==================== Biased Random Walk ====================

/**
 * Node2vec's biased second-order random walk. Given a step from `t`
 * to `v`, the transition probability to `x` is:
 *   - 1/p if x == t (return to source)
 *   - 1   if x is a neighbor of t (BFS-like)
 *   - 1/q otherwise (DFS-like)
 *
 * `p = q = 1` reduces to a uniform random walk (DeepWalk).
 */
export class BiasedRandomWalk {
  private readonly neighborSets: Map<string, Set<string>>;

  constructor(
    private readonly adj: AdjacencyMap,
    private readonly p: number,
    private readonly q: number,
    private readonly rng: () => number,
  ) {
    // Precompute neighbor Sets for O(1) "is x a neighbor of t" check.
    this.neighborSets = new Map();
    for (const [node, neighbors] of adj) {
      this.neighborSets.set(node, new Set(neighbors));
    }
  }

  /** Generate `numWalks` walks of length `walkLength` starting from every node. */
  generateAll(walkLength: number, numWalks: number): string[][] {
    const walks: string[][] = [];
    const starts = [...this.adj.keys()];
    for (let i = 0; i < numWalks; i++) {
      // Shuffle the start order each epoch — helps the SGD trainer
      // see a different ordering of context pairs.
      const order = shuffle(starts, this.rng);
      for (const start of order) {
        walks.push(this.walk(start, walkLength));
      }
    }
    return walks;
  }

  /** Generate a single biased random walk from `start` of length `walkLength`. */
  walk(start: string, walkLength: number): string[] {
    const out: string[] = [start];
    if (walkLength <= 1) return out;

    // First step is uniform — node2vec is second-order, so the first
    // hop has no "previous neighbor" to bias against.
    const firstNeighbors = this.adj.get(start) ?? [];
    if (firstNeighbors.length === 0) return out;
    out.push(pick(firstNeighbors, this.rng));

    for (let step = 2; step < walkLength; step++) {
      const cur = out[out.length - 1]!;
      const prev = out[out.length - 2]!;
      const neighbors = this.adj.get(cur) ?? [];
      if (neighbors.length === 0) break;
      const next = this.sampleBiased(prev, neighbors);
      out.push(next);
    }
    return out;
  }

  private sampleBiased(prev: string, neighbors: string[]): string {
    const weights: number[] = [];
    const prevNeighbors = this.neighborSets.get(prev) ?? new Set<string>();
    let total = 0;
    for (const x of neighbors) {
      let w: number;
      if (x === prev) w = 1 / this.p;
      else if (prevNeighbors.has(x)) w = 1;
      else w = 1 / this.q;
      weights.push(w);
      total += w;
    }
    let r = this.rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return neighbors[i]!;
    }
    return neighbors[neighbors.length - 1]!;
  }
}

// ==================== Skip-Gram with Negative Sampling ====================

interface TrainerOptions {
  dimensions: number;
  window: number;
  negativeSamples: number;
  epochs: number;
  learningRate: number;
  rng: () => number;
}

/**
 * Minimal Skip-Gram trainer with negative sampling. Each "sentence" is
 * a random walk, each "word" is a node. For each center node, the
 * trainer pulls the context-window vectors closer in cosine space and
 * pushes `negativeSamples` random non-context vectors away. The output
 * vectors are L2-normalized after training so downstream code can use
 * raw dot products as cosine similarity.
 */
export class SkipGramTrainer {
  private readonly vocab: string[];
  private readonly word2idx: Map<string, number>;
  /** Negative-sampling distribution (unigram^0.75 reservoir). */
  private readonly negDist: number[];

  constructor(
    private readonly walks: string[][],
    private readonly opts: TrainerOptions,
  ) {
    // Build vocab in first-seen order so callers get a stable mapping.
    this.vocab = [];
    this.word2idx = new Map();
    const counts = new Map<string, number>();
    for (const walk of walks) {
      for (const node of walk) {
        if (!this.word2idx.has(node)) {
          this.word2idx.set(node, this.vocab.length);
          this.vocab.push(node);
        }
        counts.set(node, (counts.get(node) ?? 0) + 1);
      }
    }

    // Build negative-sampling distribution. The standard word2vec
    // unigram^0.75 smoothing dampens the dominance of high-frequency
    // tokens — same effect here, helps embeddings of high-degree
    // nodes share less "mass" with their many neighbors.
    this.negDist = this.vocab.map((w) => Math.pow(counts.get(w) ?? 1, 0.75));
  }

  train(): { embeddings: Map<string, Float32Array>; vocabulary: string[] } {
    const { dimensions, window, negativeSamples, epochs, learningRate, rng } = this.opts;
    const V = this.vocab.length;
    if (V === 0) return { embeddings: new Map(), vocabulary: [] };

    // Two matrices: input (center) and output (context). Common SGNS
    // setup. We return the input embeddings.
    const inEmb = randomMatrix(V, dimensions, rng);
    const outEmb = randomMatrix(V, dimensions, rng);

    const totalSteps = epochs * this.walks.length;
    let step = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (const walk of this.walks) {
        // Linear LR decay to 1e-4 of starting rate.
        const lr = Math.max(learningRate * (1 - step / Math.max(1, totalSteps)), learningRate * 1e-4);
        step++;

        for (let i = 0; i < walk.length; i++) {
          const centerIdx = this.word2idx.get(walk[i]!)!;
          const wStart = Math.max(0, i - window);
          const wEnd = Math.min(walk.length, i + window + 1);
          for (let j = wStart; j < wEnd; j++) {
            if (j === i) continue;
            const ctxIdx = this.word2idx.get(walk[j]!)!;
            this.updatePair(inEmb, outEmb, centerIdx, ctxIdx, 1, lr);

            for (let k = 0; k < negativeSamples; k++) {
              const negIdx = this.sampleNegative(rng);
              if (negIdx === ctxIdx) continue;
              this.updatePair(inEmb, outEmb, centerIdx, negIdx, 0, lr);
            }
          }
        }
      }
    }

    const embeddings = new Map<string, Float32Array>();
    for (let i = 0; i < V; i++) {
      const row = inEmb[i]!;
      l2NormalizeInPlace(row);
      embeddings.set(this.vocab[i]!, row);
    }
    return { embeddings, vocabulary: this.vocab };
  }

  private updatePair(
    inEmb: Float32Array[],
    outEmb: Float32Array[],
    centerIdx: number,
    contextIdx: number,
    label: 0 | 1,
    lr: number,
  ): void {
    const inVec = inEmb[centerIdx]!;
    const outVec = outEmb[contextIdx]!;
    const dot = dotProduct(inVec, outVec);
    const sigma = sigmoid(dot);
    const err = label - sigma; // gradient direction
    const dim = inVec.length;
    // Update both vectors in lockstep. Keeping the original `inVec`
    // values around lets us compute the symmetric update on `outVec`
    // without it being affected by the in-progress center update.
    for (let d = 0; d < dim; d++) {
      const i = inVec[d]!;
      const o = outVec[d]!;
      inVec[d] = i + lr * err * o;
      outVec[d] = o + lr * err * i;
    }
  }

  private sampleNegative(rng: () => number): number {
    let total = 0;
    for (const w of this.negDist) total += w;
    let r = rng() * total;
    for (let i = 0; i < this.negDist.length; i++) {
      r -= this.negDist[i]!;
      if (r <= 0) return i;
    }
    return this.negDist.length - 1;
  }
}

// ==================== Vector utilities ====================

/**
 * Cosine similarity between two L2-normalized vectors. After
 * `computeNode2Vec`, embeddings are already normalized — so this is
 * just a dot product. Kept as a named function so callers don't have
 * to remember the normalization invariant.
 */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  return dotProduct(a, b);
}

/** Top-K most similar entities to `target` in the embedding space. */
export function topKSimilar(
  target: Float32Array,
  embeddings: Map<string, Float32Array>,
  k: number,
  excludeNames: Set<string> = new Set(),
): Array<{ name: string; score: number }> {
  const heap: Array<{ name: string; score: number }> = [];
  for (const [name, vec] of embeddings) {
    if (excludeNames.has(name)) continue;
    heap.push({ name, score: similarity(target, vec) });
  }
  heap.sort((a, b) => b.score - a.score);
  return heap.slice(0, k);
}

// ==================== Internals ====================

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

function l2NormalizeInPlace(v: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
}

function randomMatrix(rows: number, cols: number, rng: () => number): Float32Array[] {
  const m: Float32Array[] = new Array(rows);
  // Xavier-ish init in `[-0.5/d, 0.5/d]`. Word2vec uses this range
  // because it gives the center-vector dot products a manageable
  // initial scale (so sigmoid doesn't saturate on step 1).
  const scale = 0.5 / cols;
  for (let i = 0; i < rows; i++) {
    const row = new Float32Array(cols);
    for (let j = 0; j < cols; j++) row[j] = (rng() - 0.5) * 2 * scale;
    m[i] = row;
  }
  return m;
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/**
 * Deterministic PRNG (mulberry32) when seeded; falls back to
 * `Math.random` otherwise. Seeding matters for reproducible tests.
 */
function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0;
  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
