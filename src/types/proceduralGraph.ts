/**
 * Leaf contracts for the Procedural Graph (PG) feature.
 *
 * Implementation logic (Zod, hashing, serialization, storage, providers)
 * must live outside `src/types`. This file may import only from sibling
 * `src/types` modules or zod-free external types.
 *
 * @module types/proceduralGraph
 * @experimental
 */

/** Paper-attested initial relation vocabulary. */
export type PGBuiltInRelation = 'LEADS_TO' | 'TRIGGERS' | 'PROVIDES_INPUT_FOR' | 'CONVERGES_TO';

/** Built-in relation labels: LEADS_TO, TRIGGERS, PROVIDES_INPUT_FOR, CONVERGES_TO. */
export const PG_BUILT_IN_RELATIONS: readonly PGBuiltInRelation[] = [
  'LEADS_TO',
  'TRIGGERS',
  'PROVIDES_INPUT_FOR',
  'CONVERGES_TO',
];

/** Node kinds: ACTION is paper-attested; SKILL/REASONING/STATE are MemoryJS labels. */
export type PGNodeType = 'ACTION' | 'SKILL' | 'REASONING' | 'STATE';

/**
 * A node in a procedural graph: one action, skill, reasoning step or state.
 */
export interface PGNode {
  id: string;
  type: PGNodeType;
  description: string;
  actionName?: string;
}

/**
 * A directed, labelled edge between two procedural graph nodes.
 *
 * `condition`, `guidance` and `pitfalls` hold optional free text. A null value means the edge has no such text.
 */
export interface PGEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  guidance: string | null;
  pitfalls: string | null;
}

/**
 * Action to take when a graph contains a cycle: keep it, repair it, or reject the graph.
 */
export type PGCyclePolicy = 'allow' | 'repair' | 'reject';

/**
 * An immutable revision of a procedural graph, with its nodes, edges and validation settings.
 */
export interface PGSnapshot {
  schemaVersion: 1;
  graphId: string;
  revisionId: string;
  parentRevisionId?: string;
  entryNodeId: string;
  relationVocabulary: readonly string[];
  cyclePolicy: PGCyclePolicy;
  toolCatalogHash: string;
  nodes: readonly PGNode[];
  edges: readonly PGEdge[];
}

/** Paper's four edit arrays (PG-06). */
export interface PGEditSet {
  add_nodes: PGNode[];
  delete_nodes: string[];
  add_edges: PGEdge[];
  delete_edges: Array<{ source: string; target: string }>;
}

/**
 * Refinement strategy: start from a static or an empty graph, and refine one time or incrementally.
 */
export type PGRefinementMode = 'static_onetime' | 'static_incremental' | 'scratch_onetime' | 'scratch_incremental';

/**
 * Construction strategy for a graph. `fixed_expert` uses an expert graph without refinement.
 */
export type PGConstructionMode =
  | 'fixed_expert'
  | 'static_incremental'
  | 'scratch_incremental'
  | 'static_onetime'
  | 'scratch_onetime';

/**
 * One validation finding, with its severity, code and the graph element it refers to.
 */
export interface PGDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string; relation?: string };
  editIndex?: number;
}

/**
 * Result of graph validation, with the diagnostics it produced.
 */
export interface PGValidationReport {
  ok: boolean;
  diagnostics: PGDiagnostic[];
}

/**
 * One step of an agent trajectory: the action, the matched node and the observation.
 */
export interface PGTraceStep {
  action: string;
  nodeId?: string;
  observation?: string;
  at?: string;
}

/**
 * The recorded steps and score of one task run against one graph revision.
 */
export interface PGTrajectory {
  taskId: string;
  revisionId: string;
  steps: PGTraceStep[];
  score: number;
  outcome?: 'success' | 'failure' | 'unknown';
}

/**
 * A task that evaluation runs against a graph revision.
 */
export interface PGTask {
  id: string;
  description: string;
  payload?: unknown;
}

/**
 * Scores of one graph revision across a task set.
 *
 * `incomplete` is true when one or more tasks did not produce a score.
 */
export interface PGEvaluationReport {
  fingerprint: string;
  graphDigest: string;
  taskCount: number;
  completed: number;
  meanScore: number;
  scores: Array<{ taskId: string; score: number | null; error?: string }>;
  incomplete: boolean;
  evaluatedAt: string;
}

/**
 * The current accepted revision of a graph, with its digest and validation score.
 *
 * `headVersion` changes on each head update.
 */
export interface PGHead {
  graphId: string;
  revisionId: string;
  headVersion: number;
  graphDigest: string;
  validationMean: number | null;
  evaluationFingerprint: string | null;
  validationReportRef: string | null;
  updatedAt: string;
}

/**
 * The outcome of one refinement round: the retained and candidate revisions and their scores.
 */
export interface PGRoundRecord {
  runId: string;
  round: number;
  retainedRevisionId: string;
  candidateRevisionId?: string;
  outcome: 'accepted' | 'rejected-validation' | 'rejected-structural' | 'evaluation-error' | 'conflict';
  baselineMean: number | null;
  candidateMean: number | null;
  diagnostics: PGDiagnostic[];
  repairs: Array<{ source: string; target: string; relation: string }>;
  startedAt: string;
  finishedAt: string;
}

/**
 * A record of a rejected edit proposal, with the reason and the diagnostics.
 */
export interface PGRejectionRecord {
  /**
   * Graph the rejection belongs to. Optional for records written before
   * this field existed; backings fall back to resolving it from
   * `retainedRevisionId` when absent.
   */
  graphId?: string;
  runId: string;
  round: number;
  proposalDigest: string;
  edits: PGEditSet;
  candidateDigest?: string;
  candidateRevisionId?: string;
  reason: 'structural' | 'validation' | 'parse';
  diagnostics: PGDiagnostic[];
  candidateMean?: number;
  retainedMean: number | null;
  retainedRevisionId: string;
  trajectoryRefs: string[];
  fingerprint: string;
  recordedAt: string;
}

/**
 * Guidance source: generated by a provider, taken from edge attributes, or turned off.
 */
export type PGGuidanceMode = 'generative' | 'attributes-only' | 'disabled';

/**
 * Result of locating the current step in the graph, with the neighbouring edges per hop.
 */
export interface PGLocalization {
  matched: boolean;
  nodeId?: string;
  hops: Array<{ hop: number; edges: PGEdge[] }>;
  usedFullGraph: boolean;
  reason?: 'entry' | 'exact-id' | 'action-binding' | 'ambiguous' | 'not-found';
}

/**
 * Result of a guidance request.
 *
 * The `status` field gives the variant: guidance text, disabled, context budget exceeded, or provider error.
 */
export type PGGuidanceResult =
  | {
      status: 'ok';
      mode: 'generative' | 'attributes-only';
      guidance: string;
      localization: PGLocalization;
      usage?: { input: number; output: number; approximate: boolean };
      degraded?: { from: 'generative'; error: string };
    }
  | { status: 'disabled' }
  | { status: 'context-budget-exceeded'; localization: PGLocalization; serializedBytes: number; budgetBytes: number }
  | { status: 'provider-error'; error: string; localization: PGLocalization };
