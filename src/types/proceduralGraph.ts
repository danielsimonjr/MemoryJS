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

export interface PGNode {
  id: string;
  type: PGNodeType;
  description: string;
  actionName?: string;
}

export interface PGEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  guidance: string | null;
  pitfalls: string | null;
}

export type PGCyclePolicy = 'allow' | 'repair' | 'reject';

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

export type PGRefinementMode = 'static_onetime' | 'static_incremental' | 'scratch_onetime' | 'scratch_incremental';

export type PGConstructionMode =
  | 'fixed_expert'
  | 'static_incremental'
  | 'scratch_incremental'
  | 'static_onetime'
  | 'scratch_onetime';

export interface PGDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string; relation?: string };
  editIndex?: number;
}

export interface PGValidationReport {
  ok: boolean;
  diagnostics: PGDiagnostic[];
}

export interface PGTraceStep {
  action: string;
  nodeId?: string;
  observation?: string;
  at?: string;
}

export interface PGTrajectory {
  taskId: string;
  revisionId: string;
  steps: PGTraceStep[];
  score: number;
  outcome?: 'success' | 'failure' | 'unknown';
}

export interface PGTask {
  id: string;
  description: string;
  payload?: unknown;
}

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

export type PGGuidanceMode = 'generative' | 'attributes-only' | 'disabled';

export interface PGLocalization {
  matched: boolean;
  nodeId?: string;
  hops: Array<{ hop: number; edges: PGEdge[] }>;
  usedFullGraph: boolean;
  reason?: 'entry' | 'exact-id' | 'action-binding' | 'ambiguous' | 'not-found';
}

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
