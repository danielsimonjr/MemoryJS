/**
 * LearningFacade
 *
 * Owns the Recursa learning-loop factory behind `ManagerContext.learningLoop(deps)`. Phase 4 ships
 * the leaf learner only: `learn`, the resumable `start` / `next` / `submit` / `status`. The recursive
 * operations (`plan`, `submitChild`, `merge`, `reflect`) are Phase 5 and throw a clear error.
 *
 * The factory is lazy. Calling the constructor resolves nothing; `learningLoop` builds the trace
 * store, diagnoser, editor and leaf learner on each call, and only then touches the owning
 * context's managers.
 *
 * Each `learningLoop()` call returns a fresh, independent loop with its own `LeafLearner` and
 * `Diagnoser`. That is safe for runs driven through different loops (or resumed by a new loop):
 * all run state, including the failure-record dedup ids, is persisted on the run's trace
 * (`recordedFailures`, keyed by trace, task and round), so no loop relies on another loop's memory.
 *
 * @module core/context/LearningFacade
 * @internal
 */

import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { RelationManager } from '../RelationManager.js';
import type { KnowledgeRepository } from '../../agent/knowledge/KnowledgeRepository.js';
import type { SkillManager } from '../../agent/skills/SkillManager.js';
import type { SkillPublisher } from '../../agent/skills/SkillPublisher.js';
import type { FailureManager } from '../../agent/FailureManager.js';
import type { AgentReflectionManager } from '../../agent/AgentReflectionManager.js';
import type { InteractionLog } from '../../agent/harness/InteractionLog.js';
import type { LearningReport } from '../../agent/learning/LearningAccountant.js';
import { LearningTrace } from '../../agent/learning/LearningTrace.js';
import { Diagnoser } from '../../agent/learning/Diagnoser.js';
import { KnowledgeEditor } from '../../agent/learning/KnowledgeEditor.js';
import { LeafLearner, type LeafStartOptions } from '../../agent/learning/LeafLearner.js';
import { createLeafLearnerDeps } from '../../agent/learning/LeafLearnerDeps.js';
import type { LearningDeps, StepRequest } from '../../agent/learning/types.js';
import type { CriterionResult, LearnResult, LeafState, SolveResult } from '../../types/learning.js';

/** Constructor dependencies for {@link LearningFacade}. Each getter is called only by {@link LearningFacade.learningLoop}. */
export interface LearningFacadeDeps {
  /** Storage the trace records persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager. */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's relation manager. */
  getRelationManager: () => RelationManager;
  /** Returns the owning context's knowledge repository `K`. */
  getKnowledgeRepository: () => KnowledgeRepository;
  /** Returns the owning context's skill manager. */
  getSkillManager: () => SkillManager;
  /** Returns the owning context's skill publisher. */
  getSkillPublisher: () => SkillPublisher;
  /** Returns the owning context's failure manager. */
  getFailureManager: () => FailureManager;
  /** Returns the owning context's agent reflection manager. */
  getReflectionManager: () => AgentReflectionManager;
}

/** Deps of {@link LearningFacade.learningLoop}: the learning deps plus run-level settings. */
export type LearningLoopDeps = LearningDeps & {
  /** Directory SKILL.md files are published to after every accepted revision. */
  publishDir?: string;
  /** Instruction set the solver reads; `instruction.patch` targets it when set. */
  solverInstructionSetId?: string;
  /** Session the runs belong to (provenance and reflection lookup). */
  sessionId?: string;
  /** Interaction log the solver writes to; the diagnoser reads trace excerpts from it. */
  interactionLog?: InteractionLog;
  /**
   * Keep solver trace addresses on trace actions. Defaults to `true` when `interactionLog` is
   * given (addresses then resolve), else `false`.
   */
  includeTraceAddrs?: boolean;
};

/**
 * Handle returned by {@link LearningFacade.learningLoop}. Leaf-only in Phase 4: the step API and
 * `learn` work; the recursive operations throw.
 */
export interface LearningLoop {
  /** Run the leaf learner in-process until done. */
  learn(opts: LeafStartOptions): Promise<LearnResult>;
  /** Create a resumable run. */
  start(opts: LeafStartOptions): Promise<LeafState>;
  /** Advance a run until external work is needed or it is done. */
  next(traceId: string): Promise<StepRequest>;
  /** Store solve results (`'solve'`) or judge results (`'judge'`) for a run. */
  submit(traceId: string, kind: 'solve' | 'judge', payload: Record<string, SolveResult | CriterionResult[] | null>): Promise<LeafState>;
  /** Current persisted state of a run, with its learning report (spec RS-23). */
  status(traceId: string): Promise<LeafState & { report: LearningReport }>;
  /** Phase 5 (recursive learner). Throws. */
  plan: (...args: unknown[]) => never;
  /** Phase 5 (recursive learner). Throws. */
  submitChild: (...args: unknown[]) => never;
  /** Phase 5 (recursive learner). Throws. */
  merge: (...args: unknown[]) => never;
  /** Phase 5 (recursive learner). Throws. */
  reflect: (...args: unknown[]) => never;
}

/**
 * Build the error thrown by a Phase 5 operation.
 *
 * @param name - Operation name.
 * @returns The error.
 */
function phase5(name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`learningLoop.${name} is available in Phase 5 (recursive learner); Phase 4 supports learn/start/next/submit/status`);
  };
}

/**
 * Factory for the learning loop. Holds only its dependency getters.
 *
 * @internal
 */
export class LearningFacade {
  /**
   * Create the instance.
   *
   * @param deps - Getters for the owning context's managers. Nothing is resolved here.
   */
  constructor(private readonly deps: LearningFacadeDeps) {}

  /**
   * Build a leaf learner over this context's knowledge, skills, failures and reflections. Each call
   * builds a new, independent loop (own learner and diagnoser); nothing is constructed before the
   * first call. Durable dedup on the trace makes several loops over the same runs safe.
   *
   * @param deps - Solver, judge, optional LLM and signal, plus publish directory and session.
   * @returns The learning loop handle.
   */
  learningLoop(deps: LearningLoopDeps): LearningLoop {
    const storage = this.deps.storage;
    const repository = this.deps.getKnowledgeRepository();
    const skills = this.deps.getSkillManager();
    const traces = new LearningTrace(storage, {
      entityManager: this.deps.getEntityManager(),
      relationManager: this.deps.getRelationManager(),
    });
    const diagnoser = new Diagnoser({
      failureManager: this.deps.getFailureManager(),
      reflections: this.deps.getReflectionManager(),
      ...(deps.interactionLog ? { interactionLog: deps.interactionLog } : {}),
      ...(deps.llmProvider ? { llmProvider: deps.llmProvider } : {}),
    });
    const editor = new KnowledgeEditor({ skills, ...(deps.llmProvider ? { llmProvider: deps.llmProvider } : {}) });
    const adapters = createLeafLearnerDeps({
      diagnoser,
      editor,
      round: () => noContext('round'),
      tasks: () => noContext('tasks'),
      results: () => noContext('results'),
      feedback: () => noContext('feedback'),
      baseSnapshotId: () => noContext('baseSnapshotId'),
      ...(deps.solverInstructionSetId !== undefined ? { solverInstructionSetId: deps.solverInstructionSetId } : {}),
      ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
    });
    const publisher = this.deps.getSkillPublisher();
    const learner = new LeafLearner({
      repository,
      traces,
      diagnoser: adapters.diagnoser,
      editor: adapters.editor,
      publisher,
      ...(deps.publishDir !== undefined ? { publishDir: deps.publishDir } : {}),
      includeTraceAddrs: deps.includeTraceAddrs ?? deps.interactionLog !== undefined,
    });
    return {
      learn: (opts) => learner.learn(opts, deps),
      start: (opts) => learner.start(opts),
      next: (traceId) => learner.next(traceId),
      submit: (traceId, kind, payload) =>
        kind === 'solve'
          ? learner.submit(traceId, 'solve', payload as Record<string, SolveResult | null>)
          : learner.submit(traceId, 'judge', payload as Record<string, CriterionResult[] | null>),
      status: async (traceId) => ({ ...(await learner.state(traceId)), report: await learner.report(traceId) }),
      plan: phase5('plan'),
      submitChild: phase5('submitChild'),
      merge: phase5('merge'),
      reflect: phase5('reflect'),
    };
  }
}

/**
 * Throw for a round-context getter. The learner always passes its context, so this is reached only
 * if an adapter is called directly without one.
 *
 * @param field - Missing field.
 * @returns Never.
 * @throws Error always.
 */
function noContext(field: string): never {
  throw new Error(`learningLoop: ${field} is supplied by the learner's round context; call through the learner`);
}
