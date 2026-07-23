/**
 * Reconstructive memory facade — the public entry point for the MRAgent-style
 * Cue–Tag–Content associative memory and active reconstruction.
 *
 * Wraps the construction pipeline ({@link MemoryDistiller}), the associative
 * graph ({@link CueTagContentGraph}), the traversal {@link MemoryToolkit}, and
 * the active {@link MemoryReconstructor} behind one cohesive API:
 *
 * ```typescript
 * const rm = new ReconstructiveMemory();
 * await rm.ingest([
 *   { id: 'D1:1', speaker: 'Nate', text: "I won a video game tournament in July." },
 *   { id: 'D1:2', speaker: 'Caroline', text: "I started a new painting class that month." },
 * ]);
 * const result = await rm.reconstruct("What did Caroline do in July?");
 * console.log(result.answer, result.evidence);
 * ```
 *
 * **Contract (graph-core):** the in-memory {@link CueTagContentGraph} is a
 * specialized associative *index*, not a second system-of-record. Durability
 * and graph queryability come from persisting through
 * {@link MemoryGraphBridge} into the Entity/Relation graph — which is the
 * default when constructed via `ctx.reconstructiveMemory()` (the context
 * wires its own `entityManager`/`relationManager`/`semanticSearch` as the
 * backing). Passing `backing: undefined` opts out and makes the instance
 * ephemeral; treat that as a testing/short-lived-process mode.
 *
 * @module agent/reconstruction/ReconstructiveMemory
 * @experimental
 */

import type { LLMProvider } from '../../search/LLMQueryPlanner.js';
import type {
  CTCGraphSnapshot,
  DialogueTurn,
  DistillationResult,
  ReconstructionOptions,
  ReconstructionResult,
} from '../../types/reconstruction.js';
import { CueTagContentGraph } from './CueTagContentGraph.js';
import { MemoryDistiller } from './MemoryDistiller.js';
import { MemoryReconstructor } from './MemoryReconstructor.js';
import { MemoryToolkit } from './MemoryToolkit.js';
import {
  MemoryGraphBridge,
  type BridgePersistResult,
  type ReconstructiveBacking,
} from './MemoryGraphBridge.js';

/** Configuration for {@link ReconstructiveMemory}. */
export interface ReconstructiveMemoryConfig {
  /** Optional LLM provider for distillation + answer synthesis. */
  llmProvider?: LLMProvider;
  /** Pre-existing graph snapshot to restore from. */
  snapshot?: CTCGraphSnapshot;
  /**
   * Optional live-store backing. When supplied, ingested memory is persisted
   * into MemoryJS's episodic / semantic / topic modules (durable + searchable),
   * and semantic similarity is reused for reconstruction routing. When absent,
   * the facade runs the self-contained in-memory graph.
   */
  backing?: ReconstructiveBacking;
}

export class ReconstructiveMemory {
  private graph: CueTagContentGraph;
  private readonly distiller: MemoryDistiller;
  private readonly llm?: LLMProvider;
  private readonly bridge?: MemoryGraphBridge;
  private lastPersist?: BridgePersistResult;

  constructor(config: ReconstructiveMemoryConfig = {}) {
    this.llm = config.llmProvider;
    this.graph = config.snapshot
      ? CueTagContentGraph.fromSnapshot(config.snapshot)
      : new CueTagContentGraph();
    this.distiller = new MemoryDistiller(this.llm);
    this.bridge = config.backing ? new MemoryGraphBridge(config.backing) : undefined;
    this.backing = config.backing;
  }

  private readonly backing?: ReconstructiveBacking;

  /**
   * Construction phase: distil raw dialogue into Cue–Tag–Content structure and
   * merge it into the in-memory graph. When a live-store backing is configured,
   * the episodic / semantic / topic layers are also persisted into the
   * corresponding MemoryJS modules. Multiple `ingest` calls accumulate.
   */
  async ingest(turns: DialogueTurn[]): Promise<DistillationResult> {
    const result = await this.distiller.distill(turns);
    this.distiller.buildGraph(result, this.graph);
    if (this.bridge) {
      this.lastPersist = await this.bridge.persist(result, this.graph);
    }
    return result;
  }

  /** Summary of what the most recent `ingest` persisted to the live store. */
  get lastPersistResult(): BridgePersistResult | undefined {
    return this.lastPersist;
  }

  /**
   * Reconstruction phase: answer a query via active, multi-step traversal of the
   * memory graph (Algorithm 1).
   */
  async reconstruct(
    query: string,
    options?: ReconstructionOptions,
  ): Promise<ReconstructionResult> {
    const reconstructor = new MemoryReconstructor(this.graph, this.llm, this.backing?.similarity);
    return reconstructor.reconstruct(query, options);
  }

  /** Direct access to the traversal toolkit for manual graph exploration. */
  get toolkit(): MemoryToolkit {
    return new MemoryToolkit(this.graph);
  }

  /** The underlying associative graph (read/inspect cues, tags, contents). */
  get memoryGraph(): CueTagContentGraph {
    return this.graph;
  }

  /** Graph size statistics. */
  stats(): ReturnType<CueTagContentGraph['stats']> {
    return this.graph.stats();
  }

  /** Serialise the current graph (e.g. to persist alongside the knowledge base). */
  toSnapshot(): CTCGraphSnapshot {
    return this.graph.toSnapshot();
  }

  /** Replace the current graph with a restored snapshot. */
  loadSnapshot(snapshot: CTCGraphSnapshot): void {
    this.graph = CueTagContentGraph.fromSnapshot(snapshot);
  }
}
