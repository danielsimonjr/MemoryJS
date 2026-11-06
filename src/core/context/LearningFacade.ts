/**
 * LearningFacade
 *
 * Owns the Recursa learning-loop factory behind `ManagerContext.learningLoop(deps)` (spec RS-21,
 * section 3.7). A loop exposes the leaf learner (`next`, `submit`) and the recursive learner
 * (`plan`, `submitChild`, `merge`, `reflect`), plus `learn`, `start`, `status` and `childDriver`.
 *
 * Routing for `learn` and `start` (spec §3.7 S5): a run uses the {@link RecursiveLearner} when
 * `opts.tasks.length` is above the leaf threshold, or when `opts.split` is set and there is more
 * than one task; otherwise the {@link LeafLearner} runs it. The threshold is `opts.leafThreshold`,
 * else `MEMORY_LEARNING_LEAF_THRESHOLD` (strict integer >= 0), else 20; it is also passed to the
 * recursive run as its child leaf threshold. Recursive runs are driven with the step operations;
 * `next` and `submit` address leaf runs and throw for a recursive trace.
 *
 * The factory is lazy. Calling the constructor resolves nothing; `learningLoop` builds the trace
 * store, diagnoser, editor and both learners on each call, and only then touches the owning
 * context's managers. Each call returns a fresh, independent loop. Durable state (dedup ids,
 * `stateRev`) lives on the trace, so several loops over the same runs are safe.
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
import { LearningAccountant } from '../../agent/learning/LearningAccountant.js';
import { LearningTrace } from '../../agent/learning/LearningTrace.js';
import { Diagnoser } from '../../agent/learning/Diagnoser.js';
import { KnowledgeEditor } from '../../agent/learning/KnowledgeEditor.js';
import { LeafLearner, type LeafStartOptions } from '../../agent/learning/LeafLearner.js';
import { createLeafLearnerDeps } from '../../agent/learning/LeafLearnerDeps.js';
import { LearningReflector } from '../../agent/learning/LearningReflector.js';
import { RecursiveLearner, type MergeDeps, type MergeOutcome, type RecursiveStartOptions, type ReflectDecision } from '../../agent/learning/RecursiveLearner.js';
import type { RecursiveState, SubsetRecord } from '../../agent/learning/RecursiveLearnerState.js';
import { readEnvStrictInt } from '../../utils/envConfig.js';
import { RevisionMerger } from '../../agent/learning/RevisionMerger.js';
import type { LearningDeps, StepRequest } from '../../agent/learning/types.js';
import type { CriterionResult, LearnResult, LeafState, SolveResult, TaskRecord } from '../../types/learning.js';

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
 * Handle returned by {@link LearningFacade.learningLoop}. `learn`, `start` and `status` route
 * between the leaf and recursive learners; `next` and `submit` address leaf runs; `plan`,
 * `submitChild`, `merge`, `reflect` and `childDriver` address recursive runs.
 */
export interface LearningLoop {
  /** Run to completion in-process: recursive when the task count or `split` asks for it, else leaf. */
  learn(opts: RecursiveStartOptions): Promise<LearnResult>;
  /** Create a resumable run (leaf or recursive, chosen as in `learn`). */
  start(opts: RecursiveStartOptions): Promise<LeafState | RecursiveState>;
  /** Advance a leaf run until external work is needed or it is done; `opts.signal` aborts it. */
  next(traceId: string, opts?: { signal?: AbortSignal }): Promise<StepRequest>;
  /** Store solve results (`'solve'`) or judge results (`'judge'`) for a leaf run. */
  submit(traceId: string, kind: 'solve' | 'judge', payload: Record<string, SolveResult | CriterionResult[] | null>): Promise<LeafState>;
  /** Current persisted state of a run (leaf or recursive), with its learning report (spec RS-23). */
  status(traceId: string): Promise<(LeafState | RecursiveState) & { report: LearningReport }>;
  /** Split the round's tasks and create one child run per subset (recursive run, `plan` phase). */
  plan(traceId: string): Promise<{ subsets: SubsetRecord[]; childTraceIds: string[] }>;
  /** Record a child as complete (its outcome is read from the child trace). */
  submitChild(traceId: string, childTraceId: string, failure?: string): Promise<RecursiveState>;
  /** Merge the children's revisions, validate on a sample and apply with OCC. */
  merge(traceId: string, deps?: MergeDeps): Promise<MergeOutcome>;
  /** Write the round's reflection and decide whether the run continues. */
  reflect(traceId: string): Promise<ReflectDecision>;
  /** Driver of one child run (leaf or recursive), for hosting it in a subagent runner. */
  childDriver(childTraceId: string): Promise<LeafLearner | RecursiveLearner>;
}

/** Default leaf threshold of the learning loop when neither the option nor the env var is set. */
export const DEFAULT_LOOP_LEAF_THRESHOLD = 20;

/**
 * Leaf threshold of a run: `opts.leafThreshold`, else `MEMORY_LEARNING_LEAF_THRESHOLD`, else 20.
 *
 * @param opts - Start options.
 * @returns The threshold.
 */
export function leafThresholdOf(opts: { leafThreshold?: number }): number {
  return opts.leafThreshold ?? readEnvStrictInt('MEMORY_LEARNING_LEAF_THRESHOLD', { min: 0 }) ?? DEFAULT_LOOP_LEAF_THRESHOLD;
}

/**
 * Whether a run should use the recursive learner (spec RS-21, §3.7 S5): more tasks than the leaf
 * threshold, or an explicit `split` with more than one task.
 *
 * @param opts - Start options with the task records.
 * @returns `true` for the recursive learner.
 */
export function usesRecursiveLearner(opts: { tasks: TaskRecord[]; split?: unknown; leafThreshold?: number }): boolean {
  return opts.tasks.length > leafThresholdOf(opts) || (opts.split !== undefined && opts.tasks.length > 1);
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
   * Build a learning loop over this context's knowledge, skills, failures and reflections. Each call
   * builds new, independent learners; nothing is constructed before the first call.
   *
   * @param deps - Solver, judge, optional LLM, signal and subagent runner, plus publish directory and session.
   * @returns The learning loop handle.
   */
  learningLoop(deps: LearningLoopDeps): LearningLoop {
    const storage = this.deps.storage;
    const repository = this.deps.getKnowledgeRepository();
    const skills = this.deps.getSkillManager();
    const entityManager = this.deps.getEntityManager();
    const traces = new LearningTrace(storage, { entityManager, relationManager: this.deps.getRelationManager() });
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
    const includeTraceAddrs = deps.includeTraceAddrs ?? deps.interactionLog !== undefined;
    const learner = new LeafLearner({
      repository,
      traces,
      diagnoser: adapters.diagnoser,
      editor: adapters.editor,
      publisher,
      ...(deps.publishDir !== undefined ? { publishDir: deps.publishDir } : {}),
      includeTraceAddrs,
    });
    const recursive = new RecursiveLearner({
      repository,
      traces,
      storage,
      entityManager,
      diagnoser: adapters.diagnoser,
      editor: adapters.editor,
      reflector: new LearningReflector(this.deps.getReflectionManager(), traces, deps.llmProvider ? { llmProvider: deps.llmProvider } : {}),
      merger: new RevisionMerger(deps.llmProvider ? { llmProvider: deps.llmProvider } : {}),
      includeTraceAddrs,
      publisher,
      ...(deps.publishDir !== undefined ? { publishDir: deps.publishDir } : {}),
    });
    const withThreshold = (opts: RecursiveStartOptions): RecursiveStartOptions => ({ ...opts, leafThreshold: leafThresholdOf(opts) });
    const leafOnly = async (op: 'next' | 'submit', traceId: string): Promise<void> => {
      if ((await traces.get(traceId))?.learnerKind === 'recursive') {
        throw new Error(`learningLoop.${op}: ${traceId} is a recursive run; drive it with plan / submitChild / merge / reflect`);
      }
    };
    return {
      learn: (opts) => (usesRecursiveLearner(opts) ? recursive.learn(withThreshold(opts), deps) : learner.learn(opts as LeafStartOptions, deps)),
      start: (opts) => (usesRecursiveLearner(opts) ? recursive.start(withThreshold(opts)) : learner.start(opts as LeafStartOptions)),
      next: async (traceId, nextOpts) => {
        await leafOnly('next', traceId);
        return learner.next(traceId, nextOpts ?? {});
      },
      submit: async (traceId, kind, payload) => {
        await leafOnly('submit', traceId);
        return kind === 'solve'
          ? learner.submit(traceId, 'solve', payload as Record<string, SolveResult | null>)
          : learner.submit(traceId, 'judge', payload as Record<string, CriterionResult[] | null>);
      },
      status: async (traceId) => {
        const record = await traces.get(traceId);
        if (record?.learnerKind === 'recursive') {
          const state = await recursive.state(traceId);
          return { ...state, report: LearningAccountant.fromState(state.accounting).report() };
        }
        return { ...(await learner.state(traceId)), report: await learner.report(traceId) };
      },
      plan: (traceId) => recursive.plan(traceId),
      submitChild: (traceId, childTraceId, failure) => recursive.submitChild(traceId, childTraceId, failure),
      merge: (traceId, mergeDeps) => recursive.merge(traceId, { solver: deps.solver, judge: deps.judge, signal: deps.signal, ...(mergeDeps ?? {}) }),
      reflect: (traceId) => recursive.reflect(traceId),
      childDriver: (childTraceId) => recursive.childDriver(childTraceId),
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
