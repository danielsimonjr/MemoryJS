/**
 * Recursa public surface for the learning loop: learning-loop callbacks, the diagnoser, the knowledge
 * editor, the revision validator, the leaf learner, its trace store and accountant (Phase 4, spec
 * RS-14..RS-18, RS-22, RS-23), and the recursive learner with its split strategies, revision merger,
 * reflector and in-process child handler (Phase 5, spec RS-19..RS-21).
 *
 * Internal plumbing (`LeafRound`, `LeafValidation`, `LeafApply`, `LeafLearnerContext`, `LeafLearnerStore`,
 * `llmJson`, `RecursiveDrive`, `RecursiveMerge`, `RecursiveChildren`, `RecursiveLearnerState`,
 * `ChildKnowledgeOverlay`) is not re-exported. `Solver` and `LoadedKnowledge` are exported under learning-prefixed
 * names because `src/agent/index.ts` already exports the evaluation `Solver` and the knowledge
 * `LoadedKnowledge`.
 *
 * @module agent/learning
 * @experimental Recursa Phases 4 and 5 (spec RS-14..RS-23).
 */

export { Diagnoser } from './Diagnoser.js';
export type { DiagnoserDeps, DiagnoseItem, DiagnoseOptions, FailureDedupStore } from './Diagnoser.js';
export { KnowledgeEditor } from './KnowledgeEditor.js';
export type { KnowledgeEditorDeps, KnowledgeEditContext } from './KnowledgeEditor.js';
export { RevisionValidator, planValidation, decideValidation } from './RevisionValidator.js';
export type {
  ValidateOptions,
  ValidationPlan,
  ValidationPlanOptions,
  ValidationPlanResult,
  ValidationVerdictResult,
} from './RevisionValidator.js';
export { LeafLearner } from './LeafLearner.js';
export type {
  DiagnoserLike,
  KnowledgeEditorLike,
  LeafCallContext,
  LeafLearnerOptions,
  LeafStartOptions,
} from './LeafLearner.js';
export { createLeafLearnerDeps } from './LeafLearnerDeps.js';
export type { LeafDepsParts, LeafLearnerDeps } from './LeafLearnerDeps.js';
export { LearningTrace } from './LearningTrace.js';
export type { LearningTraceDeps, LearningTraceOptions, TraceTree } from './LearningTrace.js';
export { LearningAccountant } from './LearningAccountant.js';
export type { AccountantState, LearningAccountantOptions, LearningReport, TokenTotals } from './LearningAccountant.js';
export type { LearningSolver, LoadedKnowledge as LearningLoadedKnowledge, LearningDeps, JudgeAnswer, StepRequest } from './types.js';

export { split, isPartition } from './SplitStrategies.js';
export type { TaskSubset, SplitContext } from './SplitStrategies.js';
export { RevisionMerger } from './RevisionMerger.js';
export type { ChildOutcome, RevisionMergeResult, RevisionMergerDeps } from './RevisionMerger.js';
export { RecursiveLearner } from './RecursiveLearner.js';
export type {
  MergeDeps,
  MergeOutcome,
  RecursiveLearnerOptions,
  RecursiveStartOptions,
  ReflectDecision,
  SplitFn,
} from './RecursiveLearner.js';
export type { RecursivePhase, RecursiveState, SubsetRecord } from './RecursiveLearnerState.js';
export { LearningReflector, MAX_KEY_INSIGHTS } from './LearningReflector.js';
export type { LearningReflectorOptions, ReflectChild, ReflectInput, ReflectResult } from './LearningReflector.js';
export { createInProcessLearnHandler, DEFAULT_CHILD_CONCURRENCY } from './InProcessLearnHandler.js';
export type { ChildDriverSource, LearnTaskInput } from './InProcessLearnHandler.js';
