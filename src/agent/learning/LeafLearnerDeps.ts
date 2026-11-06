/**
 * Adapters from the real {@link Diagnoser} (RS-15) and {@link KnowledgeEditor} (RS-16) to the leaf
 * learner's `DiagnoserLike` / `KnowledgeEditorLike` callback interfaces (RS-18).
 *
 * The learner passes its round context ({@link LeafCallContext}) on every call, so the adapters
 * use that. The getters in {@link LeafDepsParts} are the fallback for a caller that invokes an
 * adapter without a context.
 *
 * @module agent/learning/LeafLearnerDeps
 * @experimental Spec RS-15, RS-16, RS-18. Adapter shape may change with the step API.
 */

import type { Diagnosis, Feedback, SolveResult, TaskRecord } from '../../types/learning.js';
import type { Diagnoser, DiagnoseItem } from './Diagnoser.js';
import type { KnowledgeEditContext, KnowledgeEditor } from './KnowledgeEditor.js';
import type { DiagnoserLike, KnowledgeEditorLike, LeafCallContext } from './LeafLearner.js';
import type { LoadedKnowledge } from './types.js';
import type { KnowledgeRevisionRecord } from '../../types/skills.js';

/** Parts needed to build the leaf learner's diagnoser and editor adapters. */
export interface LeafDepsParts {
  /** Real diagnoser (RS-15). */
  diagnoser: Diagnoser;
  /** Real knowledge editor (RS-16). */
  editor: KnowledgeEditor;
  /** Current round number; used only when a call carries no context. */
  round: () => number;
  /** Run tasks keyed by id; used only when a call carries no context. */
  tasks: () => Record<string, TaskRecord>;
  /** Solver results keyed by id; used only when a call carries no context. */
  results: () => Record<string, SolveResult>;
  /** Judged feedback keyed by id; used only when a call carries no context. */
  feedback: () => Record<string, Feedback>;
  /** Round-start snapshot id; used only when a call carries no context. */
  baseSnapshotId: () => string;
  /** Instruction set the solver reads; `instruction.patch` targets it when set. */
  solverInstructionSetId?: string;
  /** Session the failures belong to (provenance and reflection lookup). */
  sessionId?: string;
}

/** The two callback adapters a {@link LeafLearner} is constructed with. */
export interface LeafLearnerDeps {
  /** Diagnoser adapter over {@link Diagnoser.diagnose}. */
  diagnoser: DiagnoserLike;
  /** Editor adapter over {@link KnowledgeEditor.edit}. */
  editor: KnowledgeEditorLike;
}

/** Empty result used for a failed task that has no solver answer. */
const NO_ANSWER: SolveResult = { answer: '', traceAddrs: [] };

/**
 * Build the leaf learner's diagnoser and editor adapters over the real RS-15 / RS-16 classes.
 *
 * @param parts - Real diagnoser and editor, round-context getters, and optional solver instruction set and session.
 * @returns Adapters with the `*Like` signatures the leaf learner calls.
 */
export function createLeafLearnerDeps(parts: LeafDepsParts): LeafLearnerDeps {
  const contextOf = (call?: LeafCallContext): LeafCallContext =>
    call ?? {
      traceId: '',
      round: parts.round(),
      baseSnapshotId: parts.baseSnapshotId(),
      tasks: parts.tasks(),
      results: parts.results(),
      feedback: parts.feedback(),
    };

  const diagnoser: DiagnoserLike = {
    diagnose: async (
      failed: Array<{ task: TaskRecord; feedback: Feedback; answer?: SolveResult }>,
      knowledge: LoadedKnowledge,
      signal?: AbortSignal,
      call?: LeafCallContext,
    ): Promise<Diagnosis[]> => {
      const c = contextOf(call);
      const items: DiagnoseItem[] = failed.map(({ task, feedback, answer }) => ({
        task,
        feedback,
        result: answer ?? c.results[task.id] ?? NO_ANSWER,
      }));
      return parts.diagnoser.diagnose(c.round, items, knowledge, {
        ...(parts.sessionId !== undefined ? { sessionId: parts.sessionId } : {}),
        ...(signal ? { signal } : {}),
        traceId: c.traceId,
        ...(c.dedup ? { dedup: c.dedup } : {}),
      });
    },
  };

  const editor: KnowledgeEditorLike = {
    edit: async (
      diagnoses: Diagnosis[],
      knowledge: LoadedKnowledge,
      signal?: AbortSignal,
      call?: LeafCallContext,
    ): Promise<KnowledgeRevisionRecord> => {
      const c = contextOf(call);
      const ctx: KnowledgeEditContext = {
        tasks: c.tasks,
        results: c.results,
        knowledge,
        round: c.round,
        baseSnapshotId: c.baseSnapshotId,
        ...(parts.solverInstructionSetId !== undefined ? { solverInstructionSetId: parts.solverInstructionSetId } : {}),
      };
      return parts.editor.edit(diagnoses, ctx, signal);
    },
  };

  return { diagnoser, editor };
}
