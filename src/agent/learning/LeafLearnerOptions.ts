/**
 * Option, callback and payload contracts of the leaf learner (Recursa RS-18): the diagnoser and
 * editor callback interfaces, constructor and start options, and their validation.
 *
 * @module agent/learning/LeafLearnerOptions
 * @experimental Spec RS-18. The step API may gain fields.
 */

import type {
  Diagnosis,
  Feedback,
  LearnOptions,
  LearningBudget,
  SolveResult,
  TaskRecord,
} from '../../types/learning.js';
import type { InstructionSetRole, KnowledgeRevisionRecord } from '../../types/skills.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import type { LearningTrace } from './LearningTrace.js';
import type { LeafRunOptions } from './LeafLearnerStore.js';
import type { FailureDedupStore } from './Diagnoser.js';
import type { LoadedKnowledge } from './types.js';

/** Default number of previously passing tasks sampled for validation. */
const DEFAULT_SAMPLE_SIZE = 5;
/** Default parallel solver and judge calls. */
const DEFAULT_CONCURRENCY = 4;

/**
 * Round context passed as the last argument of a diagnoser or editor call. The learner always
 * supplies it; a stub may ignore it. Built by `LeafRound.callContextOf`.
 */
export interface LeafCallContext {
  /** Root trace id of the run (part of the failure-record dedup key). */
  traceId: string;
  /** Durable failure-record dedup store backed by the persisted run (diagnose calls only). */
  dedup?: FailureDedupStore;
  /** Learning round (0-based). */
  round: number;
  /** Snapshot the round started from (the OCC base of the revision). */
  baseSnapshotId: string;
  /** Run tasks keyed by id. */
  tasks: Record<string, TaskRecord>;
  /** Solver results keyed by task id (answer text when this process still holds it). */
  results: Record<string, SolveResult>;
  /** Judged feedback keyed by task id. */
  feedback: Record<string, Feedback>;
}

/**
 * Diagnoser (RS-15 or a stub). Receives failed tasks with their feedback and any solver answer,
 * and returns diagnoses.
 */
export interface DiagnoserLike {
  /**
   * Diagnose failed tasks.
   *
   * @param failed - Failed tasks with their feedback and solver answer (when one exists).
   * @param knowledge - Knowledge the round's solver calls were rendered from.
   * @param signal - Optional abort signal.
   * @param call - Round context (round number, session-scoped results). Optional for stubs.
   * @returns Diagnoses.
   */
  diagnose(
    failed: Array<{ task: TaskRecord; feedback: Feedback; answer?: SolveResult }>,
    knowledge: LoadedKnowledge,
    signal?: AbortSignal,
    call?: LeafCallContext,
  ): Promise<Diagnosis[]>;
}

/** Knowledge editor (RS-16 or a stub). Turns diagnoses into one revision and never writes to `K`. */
export interface KnowledgeEditorLike {
  /**
   * Draft a revision from diagnoses.
   *
   * @param diagnoses - Diagnoses of the round.
   * @param knowledge - Knowledge the round's solver calls were rendered from.
   * @param signal - Optional abort signal.
   * @param call - Round context. Optional for stubs.
   * @returns The revision (zero ops means no change).
   */
  edit(
    diagnoses: Diagnosis[],
    knowledge: LoadedKnowledge,
    signal?: AbortSignal,
    call?: LeafCallContext,
  ): Promise<KnowledgeRevisionRecord>;
}

/** Dependencies and settings of a {@link LeafLearner}. */
export interface LeafLearnerOptions {
  /** Repository `K` the learner reads, snapshots and revises. */
  repository: KnowledgeRepository;
  /** Trace store; the learner state lives in its entities. */
  traces: LearningTrace;
  /** Diagnoser. */
  diagnoser: DiagnoserLike;
  /** Editor. */
  editor: KnowledgeEditorLike;
  /** Skill publisher, called after every accepted revision when `publishDir` is set. */
  publisher?: { publish(dir: string, options?: { snapshotId?: string }): Promise<unknown> };
  /** Directory the publisher writes to. */
  publishDir?: string;
  /** Role whose instructions the solver sees (default `solver`). */
  role?: InstructionSetRole;
  /**
   * Keep solver trace addresses on trace actions. Set only when an InteractionLog is configured;
   * otherwise actions carry no addresses.
   */
  includeTraceAddrs?: boolean;
}

/** Input of {@link LeafLearner.start} and {@link LeafLearner.learn}. */
export type LeafStartOptions = LearnOptions & {
  tasks: TaskRecord[];
  sessionId?: string;
  /** Parent trace (recursive learner child); written as a `child_of` link. */
  parentTraceId?: string;
  /** Label of the subset this run learns (default `all`). */
  subsetLabel?: string;
};

/**
 * Validate and normalize start options.
 *
 * @param opts - Start options.
 * @returns Run options and the ordered task ids.
 * @throws RangeError for an invalid budget (non-integer rounds; NaN, infinite, zero or negative
 *   tokens or wall-clock), empty or duplicate task ids, or non-integer knobs.
 */
export function resolveOptions(opts: LeafStartOptions): { options: LeafRunOptions; taskIds: string[] } {
  const budget: LearningBudget = opts.budget;
  if (!Number.isInteger(budget.maxRounds) || budget.maxRounds < 1) {
    throw new RangeError('LeafLearner: budget.maxRounds must be an integer >= 1');
  }
  for (const key of ['maxTokens', 'maxWallClockMs'] as const) {
    const value = budget[key];
    if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      throw new RangeError(`LeafLearner: budget.${key} must be a positive finite number`);
    }
  }
  if (opts.taskIds.length === 0) throw new RangeError('LeafLearner: taskIds must not be empty');
  if (new Set(opts.taskIds).size !== opts.taskIds.length) throw new RangeError('LeafLearner: taskIds must be unique');
  const sample = opts.validationSampleSize ?? DEFAULT_SAMPLE_SIZE;
  const repeats = opts.validationRepeats ?? 1;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(sample) || sample < 0) throw new RangeError('LeafLearner: validationSampleSize must be an integer >= 0');
  if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError('LeafLearner: validationRepeats must be an integer >= 1');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('LeafLearner: concurrency must be an integer >= 1');
  return {
    options: { budget, validationSampleSize: sample, validationRepeats: repeats, concurrency },
    taskIds: [...opts.taskIds],
  };
}

/**
 * Check one submitted payload before it touches the run.
 *
 * @param kind - Which request is answered.
 * @param payload - Results keyed by task id.
 * @throws TypeError for an empty payload or a malformed entry.
 */
export function assertPayload(kind: 'solve' | 'judge', payload: Record<string, unknown>): void {
  if (payload === null || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    throw new TypeError(`LeafLearner: ${kind} payload must map at least one pending task id to a result`);
  }
  for (const [id, value] of Object.entries(payload)) {
    if (value === null) continue;
    if (kind === 'judge') {
      if (!Array.isArray(value)) throw new TypeError(`LeafLearner: judge result for ${id} must be an array or null`);
      continue;
    }
    const r = value as Partial<SolveResult>;
    const tokensOk =
      r.tokens === undefined ||
      (typeof r.tokens === 'object' && r.tokens !== null && typeof r.tokens.input === 'number' && typeof r.tokens.output === 'number');
    if (typeof r !== 'object' || typeof r.answer !== 'string' || !Array.isArray(r.traceAddrs) || !r.traceAddrs.every((a) => typeof a === 'string') || !tokensOk) {
      throw new TypeError(`LeafLearner: solve result for ${id} must be { answer: string, traceAddrs: string[], tokens?: { input: number, output: number } } or null`);
    }
  }
}

