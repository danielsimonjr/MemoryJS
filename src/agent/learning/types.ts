/**
 * Callback interfaces and step contracts for the Recursa learning loop (spec RS-14, RS-18).
 *
 * Data types (`LearningBudget`, `SolveResult`, `Feedback`, `LearnResult`, `LeafState`, ...)
 * live in `src/types/learning.ts` and are re-exported here for convenience. This module
 * imports from `src/types` and from the agent layer, never the reverse.
 *
 * @module agent/learning/types
 * @experimental Part of the Recursa self-improvement work (spec RS-14, RS-18).
 */

import type { LearnResult, SolveResult, TaskRecord } from '../../types/learning.js';
import type { RubricJudge } from '../evaluation/DeterministicJudge.js';
import type { PGCompletionProvider } from '../procedural/graph/CompletionProvider.js';
import type { SubagentRunner } from '../harness/ConcurrencyLimiter.js';
import type { LoadedKnowledge } from '../knowledge/KnowledgeRepository.js';

export type { LeafPhase, LeafState } from '../../types/learning.js';

/** Knowledge loaded for one solver call: the repository's `LoadedKnowledge` (one definition). */
export type { LoadedKnowledge } from '../knowledge/KnowledgeRepository.js';

/**
 * Answers one solver call per task; the solver never sees the rubric. Named `LearningSolver`
 * because the evaluation module's `Solver` is a plain function type.
 */
export interface LearningSolver {
  /**
   * Solve one task with the given knowledge.
   *
   * @param task - Task to solve
   * @param knowledge - Knowledge loaded for this call
   * @param signal - Optional abort signal
   * @returns The answer and the interaction-log addresses of its trace
   */
  solve(task: TaskRecord, knowledge: LoadedKnowledge, signal?: AbortSignal): Promise<SolveResult>;
}

/** Dependencies injected into a learner. */
export interface LearningDeps {
  /** Solver used for every solve step. */
  solver: LearningSolver;
  /** Judge used to produce feedback; without one, feedback must come from elsewhere. */
  judge?: RubricJudge;
  /** Optional LLM used for diagnosis and editing (deterministic fallbacks when absent). */
  llmProvider?: PGCompletionProvider;
  /** Optional runner for child learners. */
  subagentRunner?: SubagentRunner;
  /** Optional abort signal for the whole run. */
  signal?: AbortSignal;
}

/** Answer produced by the solver, handed to the judge in a `judge` step. */
export interface JudgeAnswer {
  /** Task that was solved. */
  task: TaskRecord;
  /** Solver answer text. */
  answer: string;
  /**
   * `true` when `answer` is the capped copy (a reopened run no longer holds the full text).
   * The judge should treat such an answer as possibly incomplete.
   */
  truncated?: boolean;
}

/**
 * One unit of external work requested from a harness by a resumable learner (spec RS-18).
 * `done` carries the final result; `solve` and `judge` ask the caller to do work and `submit` it.
 */
export type StepRequest =
  | { kind: 'solve'; tasks: Array<{ task: TaskRecord; knowledge: LoadedKnowledge }> }
  | { kind: 'judge'; answers: JudgeAnswer[] }
  | { kind: 'done'; result: LearnResult };
