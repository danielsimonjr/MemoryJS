/**
 * Types for the Cue–Tag–Content associative memory graph and active memory
 * reconstruction, implementing the MRAgent design from
 * "Memory is Reconstructed, Not Retrieved: Graph Memory for LLM Agents"
 * (Ji, Li & Hooi, ICML 2026).
 *
 * The memory system is modelled as a heterogeneous graph `M = (C, V, R)`:
 *   - Cues `c ∈ C`   — fine-grained keywords (entities, attributes, descriptors)
 *   - Contents `v ∈ V` — memory items, organised into multi-granular layers
 *   - Relations `R ⊆ C × G × V` — typed `(cue, tag, content)` triples where the
 *     associative **tag** `g ∈ G` is the semantic bridge between cue and content.
 *
 * @module types/reconstruction
 * @experimental
 */

/**
 * Multi-granular memory layers (paper §3.2).
 *
 * - `episodic` — event-specific units grounded in a particular time/context.
 * - `semantic` — stable knowledge (attributes, preferences, facts) anchored to
 *   an entity-level cue via an aspect-level tag.
 * - `topic` — higher-level abstractions summarising recurring patterns across a
 *   coherent set of episodes.
 */
export type ContentLayer = 'episodic' | 'semantic' | 'topic';

/** A fine-grained retrieval cue (entity, attribute, or salient descriptor). */
export interface CueNode {
  /** Stable identifier (normalised cue text). */
  id: string;
  /** Human-readable cue surface form. */
  text: string;
}

/**
 * An associative tag — a short phrase summarising the relational pattern that
 * links a cue to memory content. Tags are the controllable intermediate that
 * lets the agent prune traversal branches before touching expensive content.
 */
export interface TagNode {
  /** Stable identifier (normalised tag text). */
  id: string;
  /** Human-readable tag surface form (≤ ~2 words). */
  text: string;
}

/** A memory content node — an episode, a semantic fact, or a topic abstraction. */
export interface ContentNode {
  /** Stable identifier (e.g. `e1`, `s2`, `t3`). */
  id: string;
  /** Which multi-granular layer this content belongs to. */
  layer: ContentLayer;
  /** The content text (episode description, fact, or topic summary). */
  text: string;
  /** ISO `YYYY-MM-DD` conversation timestamp (episodic layer). */
  timestamp?: string;
  /** Topic ids this episode belongs to (episodic → topic links). */
  topicIds?: string[];
  /** Entity-level anchor for semantic content (the person/subject the fact is about). */
  person?: string;
  /** Free-form provenance (e.g. originating dialogue id). */
  origin?: string;
  /**
   * Name of the persisted MemoryJS entity backing this content node, set when the
   * graph is bridged to the live store (episodic→`EpisodicMemoryManager` timeline,
   * semantic→entity/observation graph, topic→topic entity). Absent when running
   * the self-contained in-memory graph.
   */
  entityName?: string;
}

/** A `(cue, tag, content)` association — one edge of the relation set `R`. */
export interface CTCTriple {
  /** Cue id. */
  cue: string;
  /** Tag id. */
  tag: string;
  /** Content id. */
  content: string;
}

/** Serialisable snapshot of a {@link CueTagContentGraph}. */
export interface CTCGraphSnapshot {
  cues: CueNode[];
  tags: TagNode[];
  contents: ContentNode[];
  triples: CTCTriple[];
}

// ==================== Construction (distillation) ====================

/** A single processed/rewritten dialogue sentence produced by distillation. */
export interface DistilledSentence {
  /** Sentence id (e.g. `D1:1-1`). */
  id: string;
  /** Rewritten, self-contained text (pronouns resolved, time normalised). */
  text: string;
  /** Short associative tag (≤ ~2 words). */
  tag: string;
  /** Originating raw sentence id. */
  origin?: string;
  /** Topic ids this sentence belongs to. */
  topics?: string[];
  /** ISO `YYYY-MM-DD` timestamp. */
  time?: string;
}

/** A person-anchored semantic fact extracted during distillation. */
export interface PersonalFact {
  /** Fact id (e.g. `p1`). */
  id: string;
  /** Normalised fact text. */
  text: string;
  /** Aspect-level tag (e.g. `preference`, `occupation`). */
  tag: string;
  /** The person/entity the fact is about. */
  person: string;
  /** Originating raw sentence id. */
  origin?: string;
}

/** Result of running the LLM distillation pipeline over a dialogue. */
export interface DistillationResult {
  /** Conversation reference date (ISO `YYYY-MM-DD`). */
  conversationTime?: string;
  /** Rewritten episodic sentences. */
  sentences: DistilledSentence[];
  /** topic-id → topic description. */
  topics: Record<string, string>;
  /** Extracted person-anchored semantic facts. */
  personalFacts: PersonalFact[];
  /** sentence-id → extracted cue surface forms. */
  keywords: Record<string, string[]>;
}

/** Raw dialogue input accepted by the distiller. */
export interface DialogueTurn {
  /** Stable id for the turn (e.g. `D1:1`). */
  id: string;
  /** Speaker name, if known. */
  speaker?: string;
  /** Raw utterance text. */
  text: string;
  /** ISO timestamp for the turn, if known. */
  timestamp?: string;
}

// ==================== Active reconstruction ====================

/** A traversal action the agent may take over the memory graph (paper §4.1). */
export type TraversalActionType =
  | 'cue->tag' // Forward: activate associative tags from active cues
  | 'cuetag->content' // Forward: retrieve content conditioned on (cue, tag)
  | 'content->cuetag' // Reverse: surface new cues/tags from retrieved content
  | 'topic->episode'; // Top-down: descend from a topic to its episodes

/** One executed traversal action and the candidates it produced. */
export interface TraversalStep {
  /** 0-based reconstruction step index. */
  step: number;
  /** The action(s) the policy selected this step. */
  actions: TraversalActionType[];
  /** Content nodes routed into the reconstructed context this step. */
  routed: ContentNode[];
  /** Short rationale for the step (policy- or LLM-supplied). */
  rationale?: string;
}

/** Final output of an active reconstruction run (Algorithm 1). */
export interface ReconstructionResult {
  /** The query that was reconstructed against. */
  query: string;
  /** Final answer, when an answering policy is supplied. */
  answer?: string;
  /** Confidence in `[0, 1]`, when available. */
  confidence?: number;
  /** Accumulated evidence (the reconstructed context `H`). */
  evidence: ContentNode[];
  /** The step-by-step traversal trajectory. */
  trajectory: TraversalStep[];
  /** Whether the loop stopped on a satisfied stopping condition (vs. budget). */
  stoppedEarly: boolean;
}

/** Tunables for the reconstruction loop. */
export interface ReconstructionOptions {
  /** Max reasoning turns `T` (paper caps at 8). Default 8. */
  maxSteps?: number;
  /** Max content nodes routed per step (per-turn retrieval budget `K`). Default 10. */
  perStepBudget?: number;
  /** Stop once this many distinct evidence items are accumulated. Default 12. */
  evidenceTarget?: number;
}
