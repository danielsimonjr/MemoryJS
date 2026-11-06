/**
 * Recursa learning-loop, task and evaluation types (data only).
 *
 * Callback interfaces (`Solver`, `RubricJudge`, ...) are NOT here; they live in
 * `src/agent/learning/types.ts` and `src/agent/evaluation/` because they reference
 * managers or callbacks. This file imports only from other `src/types` modules.
 *
 * @module types/learning
 * @experimental Part of the Recursa self-improvement work (spec RS-14, RS-18, RS-22, RS-24).
 */

import type { AgentEntity, IsoDateTime } from './agent-memory.js';
import type { SkillId, SkillSource } from './skills.js';

/** Named strategy used to partition tasks into subsets. */
export type SplitStrategyName = 'byCategory' | 'byFailureMode' | 'bySkill' | 'byTool' | 'auto';

/** Resource limits for a learning run. */
export interface LearningBudget {
  /** Maximum number of learning rounds. */
  maxRounds: number;
  /** Optional token ceiling across all phases. */
  maxTokens?: number;
  /** Optional wall-clock ceiling in milliseconds. */
  maxWallClockMs?: number;
  /** Optional ceiling on child learners per round. */
  maxChildren?: number;
}

/** Output of one solver call. */
export interface SolveResult {
  /** The solver's answer text. */
  answer: string;
  /** Interaction-log addresses of the solver's trace (never inline output). */
  traceAddrs: string[];
  /** Optional token usage. */
  tokens?: { input: number; output: number };
}

/** Pass/fail outcome for one criterion of a task. */
export interface CriterionResult {
  /** Identifier of the criterion that was judged. */
  criterionId: string;
  /** Whether the criterion passed. */
  pass: boolean;
  /** Optional judge note. */
  note?: string;
}

/** Judged feedback for one task. */
export interface Feedback {
  /** Task the feedback applies to. */
  taskId: string;
  /** Per-criterion results. */
  criteria: CriterionResult[];
  /** True when every criterion passed. */
  allPass: boolean;
  /** Who produced the feedback. */
  source: 'judge' | 'human' | 'test';
}

/** Classification of why a task failed. */
export type DiagnosisKind = 'missing-knowledge' | 'wrong-behaviour' | 'noisy-feedback' | 'ambiguous';

/** Diagnosis of one failed task. */
export interface Diagnosis {
  /** Task that failed. */
  taskId: string;
  /** Classification of the failure. */
  kind: DiagnosisKind;
  /** Short explanation. */
  summary: string;
  /** Interaction-log addresses supporting the diagnosis. */
  evidenceAddrs: string[];
  /** Skills judged related to the failure. */
  relatedSkillIds: SkillId[];
  /** Failure-memory record created for this diagnosis, if any. */
  relatedFailureId?: string;
  /** Confidence in [0, 1]. */
  confidence: number;
}

/** Options accepted by a learning run. */
export interface LearnOptions {
  /** Tasks to learn from. */
  taskIds: string[];
  /** Resource limits. */
  budget: LearningBudget;
  /** Partitioning strategy for recursive learning. */
  split?: SplitStrategyName;
  /** Number of previously passing tasks sampled for validation. */
  validationSampleSize?: number;
  /** Repeats per validated task; a task passes only if it passes every repeat. */
  validationRepeats?: number;
  /** Maximum parallel solver calls. */
  concurrency?: number;
  /** Subset size at or below which a leaf learner is used. */
  leafThreshold?: number;
  /** Maximum recursion depth. */
  maxDepth?: number;
}

/** Reason a learning run stopped. */
export type LearnStopReason =
  | 'no-progress'
  | 'budget-rounds'
  | 'budget-tokens'
  | 'budget-time'
  | 'aborted'
  | 'all-pass';

/** Summary returned by a completed learning run. */
export interface LearnResult {
  /** Snapshot id of the final knowledge repository. */
  snapshotId: string;
  /** Root learning-trace entity name. */
  traceId: string;
  /** Metrics before learning. */
  before: EvalMetrics;
  /** Metrics after learning. */
  after: EvalMetrics;
  /** Why the run stopped. */
  stoppedBecause: LearnStopReason;
}

/** One rubric criterion of a task. */
export interface Criterion {
  /** Stable criterion identifier. */
  id: string;
  /** Human-readable criterion text. */
  text: string;
  /** How the criterion is checked. */
  kind: 'fact' | 'document' | 'set-exact' | 'set-precision' | 'number' | 'free';
  /** Expected value, where the kind needs one. */
  expected?: string | string[] | number;
  /** Numeric tolerance for `number` criteria. */
  tolerance?: number;
  /** Relative weight of the criterion. */
  weight?: number;
}

/** Persisted task: an input plus the rubric used to judge its answer. */
export interface TaskRecord {
  /** Stable task identifier (`task-<shortId>`). */
  id: string;
  /** Task input text. */
  input: string;
  /** Optional category used for stratification. */
  category?: string;
  /** Optional free-form tags. */
  tags?: string[];
  /** Optional tools the task exercises. */
  tools?: string[];
  /** Optional difficulty label. */
  difficulty?: string;
  /** Sources the task is grounded in. */
  sources?: SkillSource[];
  /** Rubric criteria. */
  rubric: Criterion[];
}

/** Entity wrapper for a {@link TaskRecord}. */
export interface TaskEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'task';
  /** The persisted task record. */
  taskRecord: TaskRecord;
}

/** Aggregate evaluation metrics over a set of tasks. */
export interface EvalMetrics {
  /** Number of tasks evaluated. */
  tasks: number;
  /** Fraction of tasks with every criterion passed. */
  allPass: number;
  /** Mean over tasks of the per-task criteria pass fraction. */
  meanCriteria: number;
  /** Per-category breakdown. */
  byCategory: Record<string, { tasks: number; allPass: number; meanCriteria: number }>;
}

/** Phase of the leaf learner state machine. */
export type LeafPhase = 'solve' | 'judge' | 'diagnose' | 'edit' | 'validate' | 'apply' | 'done';

/** Persisted state of a leaf learner, stored on its learning trace. */
export interface LeafState {
  /** Root learning-trace entity name. */
  traceId: string;
  /** Current round (0-based). */
  round: number;
  /** Current phase. */
  phase: LeafPhase;
  /** Task identifiers awaiting results. */
  pending: string[];
  /** Solver results keyed by task id. */
  results: Record<string, SolveResult>;
  /** Judged feedback keyed by task id. */
  feedback: Record<string, Feedback>;
  /** Revision produced in this round, if any. */
  revisionId?: string;
  /** Stop reason once the learner is done. */
  stop?: LearnStopReason;
}

/** One action recorded on a learning trace. */
export interface LearningTraceAction {
  /** Kind of action performed. */
  kind: 'solve' | 'diagnose' | 'edit' | 'validate' | 'split' | 'merge' | 'reflect';
  /** Start timestamp. */
  startedAt: IsoDateTime;
  /** End timestamp. */
  endedAt: IsoDateTime;
  /** Interaction-log addresses referenced by the action. */
  addrs: string[];
  /** Short outcome description. */
  outcome: string;
}

/** Persisted learning trace node. Solver output is referenced by address, never copied. */
export interface LearningTraceRecord {
  /** Stable identifier (`trace-<shortId>`). */
  id: string;
  /** Parent trace identifier, for child traces. */
  parentTraceId?: string;
  /** Kind of learner that produced the trace. */
  learnerKind: 'leaf' | 'recursive';
  /** Round number. */
  round: number;
  /** Label of the task subset this trace covers. */
  subsetLabel: string;
  /** Recorded actions. */
  actions: LearningTraceAction[];
  /** Revisions produced under this trace. */
  revisionIds: string[];
  /** Metrics attached to the trace. */
  metrics: EvalMetrics;
}

/** Entity wrapper for a {@link LearningTraceRecord}. */
export interface LearningTraceEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'learning_trace';
  /** The persisted trace record. */
  learningTraceRecord: LearningTraceRecord;
}
