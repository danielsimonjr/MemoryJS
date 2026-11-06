/**
 * Bootstrapper (Recursa RS-13): one pass from raw corpus to a learned knowledge snapshot.
 *
 * Stages: map (`CorpusMapper`) -> boundaries (`BoundaryRecorder`) -> exploration notes
 * (`ExplorationNotes`) -> practice tasks (`PracticeTaskGenerator`) -> optional single
 * `LeafLearner.learn` pass over those tasks -> `KnowledgeRepository.snapshot('bootstrap')`.
 *
 * The default learner is wired the way `LearningFacade.learningLoop` wires it (trace store,
 * diagnoser, editor, round-context adapters). A `learner` can be injected for tests.
 *
 * @module agent/bootstrap/Bootstrapper
 * @experimental Spec RS-13. The return shape may gain fields.
 */

import type { IGraphStorage } from '../../types/types.js';
import type { NavigationNodeRecord, SkillId } from '../../types/skills.js';
import type { LearnResult, LearningBudget, TaskRecord } from '../../types/learning.js';
import { isNavigationNodeEntity } from '../../types/agent-memory.js';
import { EntityManager } from '../../core/EntityManager.js';
import { RelationManager } from '../../core/RelationManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import type { SummarizationService } from '../SummarizationService.js';
import type { KeywordExtractor } from '../../features/KeywordExtractor.js';
import type { PGCompletionProvider } from '../procedural/graph/CompletionProvider.js';
import { DeterministicJudge, type RubricJudge } from '../evaluation/DeterministicJudge.js';
import type { RubricIssue } from '../evaluation/RubricAudit.js';
import { LeafLearner, type LeafStartOptions } from '../learning/LeafLearner.js';
import { LearningTrace } from '../learning/LearningTrace.js';
import { Diagnoser } from '../learning/Diagnoser.js';
import { KnowledgeEditor } from '../learning/KnowledgeEditor.js';
import { createLeafLearnerDeps } from '../learning/LeafLearnerDeps.js';
import type { LearningDeps, LearningSolver } from '../learning/types.js';
import { CorpusMapper, type CorpusMapOptions, type CorpusSource, type NavigationMap, navigationLeafName } from './CorpusMapper.js';
import { BoundaryRecorder } from './BoundaryRecorder.js';
import { ExplorationNotes } from './ExplorationNotes.js';
import { PracticeTaskGenerator } from './PracticeTaskGenerator.js';
import { throwIfAbortedSignal } from './bootstrapShared.js';

/** Anything with the `learn` method of {@link LeafLearner}. */
export interface BootstrapLearner {
  /** Run one learning pass. */
  learn(opts: LeafStartOptions, deps: LearningDeps): Promise<LearnResult>;
}

/** Dependencies of {@link Bootstrapper}. */
export interface BootstrapperDeps {
  /** Storage that holds the corpus entities and the knowledge repository. */
  storage: IGraphStorage;
  /** Write path (pass `ctx.entityManager` for governance). */
  entityManager?: EntityManager;
  /** Relation path. */
  relationManager?: RelationManager;
  /** Skill registry (notes are written here; the default learner edits it). */
  skills: SkillManager;
  /** Knowledge repository that takes the `bootstrap` snapshot. */
  repository: KnowledgeRepository;
  /** Summariser for the map (default heuristic). */
  summarizer?: SummarizationService;
  /** Keyword extractor for the map. */
  keywords?: KeywordExtractor;
  /** Optional LLM used by every stage that accepts one. */
  llmProvider?: PGCompletionProvider;
  /** Learner to use instead of the default `LeafLearner` (tests). */
  learner?: BootstrapLearner;
}

/** Input of {@link Bootstrapper.run}. */
export interface BootstrapRunInput {
  /** Corpus documents. */
  sources: CorpusSource[];
  /** Solver for the learning pass; without one, no learning runs. */
  solver?: LearningSolver;
  /** Judge for the learning pass (default: `DeterministicJudge`). */
  judge?: RubricJudge;
  /** Resource limits of the learning pass. */
  budget: LearningBudget;
  /** Corpus label that keys the notes skill (default `corpus`). */
  corpusLabel?: string;
  /** Options of the map (shard size, concurrency, partitioner). */
  map?: CorpusMapOptions;
  /** Maximum practice tasks (default 12). */
  taskCount?: number;
  /** Guidance for the LLM task generator. */
  guidance?: string;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

/** Result of {@link Bootstrapper.run}. */
export interface BootstrapResult {
  /** Id of the `bootstrap` knowledge snapshot. */
  snapshotId: string;
  /** Navigation map of the corpus. */
  navigationMap: NavigationMap;
  /** Practice task ids. */
  taskIds: string[];
  /** Learning result, when a solver was given and tasks exist. */
  learn?: LearnResult;
  /** Id of the exploration-notes skill. */
  notesSkillId: SkillId;
  /** Rubric audit findings on the practice tasks. */
  audit: RubricIssue[];
}

/**
 * Runs the bootstrap pipeline over a corpus.
 *
 * @example
 * ```ts
 * const boot = new Bootstrapper({ storage, skills, repository });
 * const out = await boot.run({ sources, solver, budget: { maxRounds: 3 }, corpusLabel: 'invoices' });
 * ```
 */
export class Bootstrapper {
  private readonly deps: BootstrapperDeps;
  private readonly entityManager: EntityManager;
  private readonly relationManager: RelationManager;

  /**
   * Create the bootstrapper.
   *
   * @param deps - Storage, skills, repository and optional helpers.
   */
  constructor(deps: BootstrapperDeps) {
    this.deps = deps;
    this.entityManager = deps.entityManager ?? new EntityManager(deps.storage as GraphStorage);
    this.relationManager = deps.relationManager ?? new RelationManager(deps.storage as GraphStorage);
  }

  /**
   * Map the corpus, record boundaries, write notes, generate practice tasks, run one learning
   * pass (when a solver is given) and snapshot the knowledge repository as `bootstrap`.
   *
   * @param input - Sources, solver, judge, budget and options.
   * @returns Snapshot id, map, task ids, learning result, notes skill id and audit findings.
   * @throws AbortError when the signal aborts.
   */
  async run(input: BootstrapRunInput): Promise<BootstrapResult> {
    const signal = input.signal;
    throwIfAbortedSignal(signal);
    const label = input.corpusLabel ?? 'corpus';
    const storage = this.deps.storage;

    const mapper = new CorpusMapper({
      storage,
      entityManager: this.entityManager,
      relationManager: this.relationManager,
      ...(this.deps.summarizer ? { summarizer: this.deps.summarizer } : {}),
      ...(this.deps.keywords ? { keywords: this.deps.keywords } : {}),
    });
    const navigationMap = await mapper.map(input.sources, { ...input.map, ...(signal ? { signal } : {}) });

    const boundaries = new BoundaryRecorder({ storage, entityManager: this.entityManager });
    const coverage = await boundaries.recordFromMetadata(input.sources);
    const nodes = this.leafRecords(input.sources);

    const notes = new ExplorationNotes({ skills: this.deps.skills, storage });
    const notesSkillId = await notes.write({
      corpusLabel: label,
      navigationMap,
      coverage,
      nodes,
      ...(this.deps.llmProvider ? { llmProvider: this.deps.llmProvider } : {}),
      ...(signal ? { signal } : {}),
    });

    const generator = new PracticeTaskGenerator({ storage, entityManager: this.entityManager });
    const generated = await generator.generate({
      nodes,
      sources: input.sources,
      ...(input.taskCount !== undefined ? { count: input.taskCount } : {}),
      ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
      ...(this.deps.llmProvider ? { llmProvider: this.deps.llmProvider } : {}),
      ...(signal ? { signal } : {}),
    });
    const taskIds = generated.tasks.map((t) => t.id);

    let learn: LearnResult | undefined;
    if (input.solver && generated.tasks.length > 0) {
      learn = await this.learnerFor().learn(
        { taskIds, tasks: generated.tasks as TaskRecord[], budget: input.budget },
        {
          solver: input.solver,
          judge: input.judge ?? new DeterministicJudge(),
          ...(this.deps.llmProvider ? { llmProvider: this.deps.llmProvider } : {}),
          ...(signal ? { signal } : {}),
        },
      );
    }

    const snapshot = await this.deps.repository.snapshot('bootstrap');
    return {
      snapshotId: snapshot.id,
      navigationMap,
      taskIds,
      ...(learn ? { learn } : {}),
      notesSkillId,
      audit: generated.audit,
    };
  }

  /** Stored leaf records of the given sources (refs without a stored leaf are skipped). */
  private leafRecords(sources: CorpusSource[]): NavigationNodeRecord[] {
    const seen = new Set<string>();
    const out: NavigationNodeRecord[] = [];
    for (const s of sources) {
      const name = navigationLeafName(s.ref);
      if (seen.has(name)) continue;
      seen.add(name);
      const entity = this.deps.storage.getEntityByName(name);
      if (entity && isNavigationNodeEntity(entity)) out.push(entity.navigationNodeRecord);
    }
    return out;
  }

  /** Injected learner, or a `LeafLearner` wired the way `LearningFacade.learningLoop` wires it. */
  private learnerFor(): BootstrapLearner {
    if (this.deps.learner) return this.deps.learner;
    const { storage, skills, repository, llmProvider } = this.deps;
    const traces = new LearningTrace(storage, { entityManager: this.entityManager, relationManager: this.relationManager });
    const diagnoser = new Diagnoser({ ...(llmProvider ? { llmProvider } : {}) });
    const editor = new KnowledgeEditor({ skills, ...(llmProvider ? { llmProvider } : {}) });
    const outside = (field: string) => (): never => {
      throw new Error(`Bootstrapper: ${field} is supplied by the learner's round context`);
    };
    const adapters = createLeafLearnerDeps({
      diagnoser,
      editor,
      round: outside('round'),
      tasks: outside('tasks'),
      results: outside('results'),
      feedback: outside('feedback'),
      baseSnapshotId: outside('baseSnapshotId'),
    });
    return new LeafLearner({
      repository,
      traces,
      diagnoser: adapters.diagnoser,
      editor: adapters.editor,
      includeTraceAddrs: false,
    });
  }
}
