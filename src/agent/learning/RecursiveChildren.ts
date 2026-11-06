/**
 * Child factories of the recursive learner (Recursa RS-21): a leaf learner or a nested recursive
 * learner over a fresh {@link ChildKnowledgeOverlay}, bound to the child's trace id once it exists.
 *
 * @module agent/learning/RecursiveChildren
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { LearningBudget, TaskRecord } from '../../types/learning.js';
import type { LeafStartOptions } from './LeafLearner.js';
import { LeafLearner } from './LeafLearner.js';
import { ChildKnowledgeOverlay } from './ChildKnowledgeOverlay.js';
import type { RecursiveLearner, RecursiveLearnerOptions } from './RecursiveLearner.js';
import type { RecursiveState, SubsetRecord } from './RecursiveLearnerState.js';
import type { RevisionValidator } from './RevisionValidator.js';
import type { RevisionMerger } from './RevisionMerger.js';
import type { SplitFn } from './RecursiveLearner.js';

/** Shared settings a child factory needs. */
export interface ChildFactoryContext {
  /** Options of the parent learner (stores, leaf callbacks, reflector). */
  opts: RecursiveLearnerOptions;
  /** Split function passed down to nested learners. */
  split: SplitFn;
  /** Merger passed down to nested learners. */
  merger: Pick<RevisionMerger, 'merge'>;
  /** Validator passed down to nested learners. */
  validator: RevisionValidator;
}

/** Constructor of the nested recursive learner, injected to avoid an import cycle. */
export type RecursiveCtor = new (opts: RecursiveLearnerOptions) => RecursiveLearner;

/**
 * Leaf learner over an overlay.
 *
 * @param ctx - Factory context.
 * @param overlay - Child overlay.
 * @returns The learner.
 */
export function leafOver(ctx: ChildFactoryContext, overlay: ChildKnowledgeOverlay): LeafLearner {
  return new LeafLearner({
    repository: overlay.asRepository(),
    traces: ctx.opts.traces,
    diagnoser: ctx.opts.diagnoser,
    editor: ctx.opts.editor,
    includeTraceAddrs: ctx.opts.includeTraceAddrs ?? false,
  });
}

/**
 * Nested recursive learner over an overlay, sharing the parent's settings.
 *
 * @param ctx - Factory context.
 * @param overlay - Child overlay.
 * @param Ctor - Recursive learner class.
 * @returns The learner.
 */
export function recursiveOver(ctx: ChildFactoryContext, overlay: ChildKnowledgeOverlay, Ctor: RecursiveCtor): RecursiveLearner {
  return new Ctor({
    ...ctx.opts,
    repository: overlay.asRepository(),
    split: ctx.split,
    merger: ctx.merger,
    validator: ctx.validator,
  });
}

/**
 * Create one child for a subset: a leaf learner when the subset is small enough or the child would
 * sit at `maxDepth`, otherwise a nested recursive learner one level deeper.
 *
 * @param ctx - Factory context.
 * @param state - Parent run record.
 * @param byId - Tasks of the run by id.
 * @param subset - Subset to delegate.
 * @param Ctor - Recursive learner class (for nested children).
 * @param budget - Budget of the child (default: the parent's budget).
 * @returns The child's learner and its trace id.
 */
export async function createChildRun(
  ctx: ChildFactoryContext,
  state: RecursiveState,
  byId: Map<string, TaskRecord>,
  subset: SubsetRecord,
  Ctor: RecursiveCtor,
  budget: LearningBudget = state.options.budget,
): Promise<{ traceId: string; driver: LeafLearner | RecursiveLearner }> {
  const childDepth = state.depth + 1;
  const leaf = subset.forceLeaf === true || subset.taskIds.length <= state.options.leafThreshold || childDepth >= state.options.maxDepth;
  const overlay = await ChildKnowledgeOverlay.open(ctx.opts.repository, ctx.opts.storage, ctx.opts.entityManager);
  const start = {
    taskIds: [...subset.taskIds],
    tasks: subset.taskIds.map((id) => byId.get(id)!),
    budget,
    split: state.options.split,
    validationSampleSize: state.options.validationSampleSize,
    validationRepeats: state.options.validationRepeats,
    concurrency: state.options.concurrency,
    leafThreshold: state.options.leafThreshold,
    maxDepth: state.options.maxDepth,
    ...(state.sessionId !== undefined ? { sessionId: state.sessionId } : {}),
    parentTraceId: state.traceId,
    subsetLabel: subset.label,
  };
  if (leaf) {
    const learner = leafOver(ctx, overlay);
    const child = await learner.start(start as LeafStartOptions);
    overlay.bind(child.traceId);
    return { traceId: child.traceId, driver: learner };
  }
  const nested = recursiveOver(ctx, overlay, Ctor);
  const child = await nested.start({ ...start, depth: childDepth });
  overlay.bind(child.traceId);
  return { traceId: child.traceId, driver: nested };
}
