/**
 * Procedural Graph public surface (implementation plan Section 4).
 *
 * @module agent/procedural/graph
 * @experimental
 */

export { PG_BUILT_IN_RELATIONS } from '../../../types/proceduralGraph.js';
export type {
  PGBuiltInRelation,
  PGNodeType,
  PGNode,
  PGEdge,
  PGCyclePolicy,
  PGSnapshot,
  PGEditSet,
  PGRefinementMode,
  PGConstructionMode,
  PGDiagnostic,
  PGValidationReport,
  PGTraceStep,
  PGTrajectory,
  PGTask,
  PGEvaluationReport,
  PGHead,
  PGRoundRecord,
  PGRejectionRecord,
  PGGuidanceMode,
  PGLocalization,
  PGGuidanceResult,
} from '../../../types/proceduralGraph.js';

export {
  PG_LIMITS,
  PGNodeSchema,
  PGEdgeSchema,
  PGSnapshotSchema,
  PGEditSetSchema,
  parseSnapshot,
  parseEditSet,
} from './ProceduralGraphSchemas.js';

export {
  canonicalJson,
  sha256Hex,
  graphDigest,
  toolCatalogHash,
  storageKey,
  evaluationFingerprint,
} from './canonical.js';

export { ProceduralGraph } from './ProceduralGraph.js';

export {
  validateSnapshot,
  applyCyclePolicy,
  prepareCandidate,
} from './ProceduralGraphValidator.js';
export type { PGValidatorOptions } from './ProceduralGraphValidator.js';

export {
  serializeLocalContext,
  serializeFullGraph,
  serializeGraphJson,
} from './ProceduralGraphSerializer.js';
export type { PGSerializerStyle } from './ProceduralGraphSerializer.js';

export type {
  IProceduralGraphBacking,
  PGCommitInput,
  PGCommitResult,
} from './backing/index.js';
export {
  createProceduralGraphBacking,
  InMemoryProceduralGraphBacking,
  JsonlProceduralGraphBacking,
  SqliteProceduralGraphBacking,
} from './backing/index.js';

export { adaptLLMProvider, completeWithBudget } from './CompletionProvider.js';
export type { PGCompletionProvider } from './CompletionProvider.js';

export { tokenTail, concatTrajectories } from './tokenTail.js';
export type { PGTokenizer } from './tokenTail.js';

export {
  GUIDANCE_PROMPT_TEMPLATE,
  REFINER_PROMPT_TEMPLATE,
  FULL_GRAPH_CONTEXT_DESC,
  FULL_GRAPH_SOURCE,
  LOCAL_GRAPH_CONTEXT_DESC,
  LOCAL_GRAPH_SOURCE,
  renderTemplate,
} from './prompts.js';

export { ProceduralGraphSession } from './ProceduralGraphSession.js';
export type { PGSessionOptions } from './ProceduralGraphSession.js';

export { generateGuidance } from './ProceduralGuidance.js';

export {
  buildRefinerPrompt,
  serializeRejections,
  proposeEdits,
} from './ProceduralGraphRefiner.js';
export type { PGRefinerInput } from './ProceduralGraphRefiner.js';

export { ProceduralGraphEvolution } from './ProceduralGraphEvolution.js';
export type {
  PGEvolutionDependencies,
  PGEvolutionOptions,
  PGEvolutionResult,
} from './ProceduralGraphEvolution.js';

export { ProceduralGraphManager } from './ProceduralGraphManager.js';
export type {
  ProceduralGraphManagerConfig,
  PGPolicy,
} from './ProceduralGraphManager.js';

export { procedureToGraphInput } from './ProcedureGraphAdapter.js';
