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

/** Configuration for {@link ReconstructiveMemory}. */
export interface ReconstructiveMemoryConfig {
  /** Optional LLM provider for distillation + answer synthesis. */
  llmProvider?: LLMProvider;
  /** Pre-existing graph snapshot to restore from. */
  snapshot?: CTCGraphSnapshot;
}

export class ReconstructiveMemory {
  private graph: CueTagContentGraph;
  private readonly distiller: MemoryDistiller;
  private readonly llm?: LLMProvider;

  constructor(config: ReconstructiveMemoryConfig = {}) {
    this.llm = config.llmProvider;
    this.graph = config.snapshot
      ? CueTagContentGraph.fromSnapshot(config.snapshot)
      : new CueTagContentGraph();
    this.distiller = new MemoryDistiller(this.llm);
  }

  /**
   * Construction phase: distil raw dialogue into Cue–Tag–Content structure and
   * merge it into the in-memory graph. Returns the distillation result for
   * inspection. Multiple `ingest` calls accumulate into the same graph.
   */
  async ingest(turns: DialogueTurn[]): Promise<DistillationResult> {
    const result = await this.distiller.distill(turns);
    this.distiller.buildGraph(result, this.graph);
    return result;
  }

  /**
   * Reconstruction phase: answer a query via active, multi-step traversal of the
   * memory graph (Algorithm 1).
   */
  async reconstruct(
    query: string,
    options?: ReconstructionOptions,
  ): Promise<ReconstructionResult> {
    const reconstructor = new MemoryReconstructor(this.graph, this.llm);
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
