/**
 * Recursa Phase 4 public surface: learning-loop callbacks, the diagnoser, the knowledge editor,
 * the revision validator, the leaf learner, its trace store and accountant (spec RS-14..RS-18,
 * RS-22, RS-23).
 *
 * Internal plumbing (`LeafRound`, `LeafValidation`, `LeafApply`, `LeafLearnerContext`, `LeafLearnerStore`,
 * `llmJson`) is not re-exported. `Solver` and `LoadedKnowledge` are exported under learning-prefixed
 * names because `src/agent/index.ts` already exports the evaluation `Solver` and the knowledge
 * `LoadedKnowledge`.
 *
 * @module agent/learning
 * @experimental Recursa Phase 4 (spec RS-14..RS-18, RS-22, RS-23).
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
