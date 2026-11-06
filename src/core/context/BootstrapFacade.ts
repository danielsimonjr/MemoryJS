/**
 * BootstrapFacade
 *
 * Owns the Recursa bootstrapper factory behind `ManagerContext.bootstrapper(deps)` (spec section 3.7,
 * Phase 5 batch 5C). The bootstrapper maps a corpus, records boundary coverage, writes exploration
 * notes as a skill, generates practice tasks, and optionally learns from them.
 *
 * Learning goes through `learningLoop`: each bootstrap learn call builds a fresh loop, so the
 * bootstrap run gets the context's failure and reflection managers and the recursive learner when
 * the task count asks for it.
 *
 * The factory is lazy. Calling `bootstrapper` builds the bootstrapper; no manager is touched before.
 *
 * @module core/context/BootstrapFacade
 * @internal
 */

import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { RelationManager } from '../RelationManager.js';
import type { KnowledgeRepository } from '../../agent/knowledge/KnowledgeRepository.js';
import type { SkillManager } from '../../agent/skills/SkillManager.js';
import { SummarizationService } from '../../agent/SummarizationService.js';
import type { PGCompletionProvider } from '../../agent/procedural/graph/CompletionProvider.js';
import type { LearnResult } from '../../types/learning.js';
import { Bootstrapper, type BootstrapLearner } from '../../agent/bootstrap/Bootstrapper.js';
import type { LeafStartOptions } from '../../agent/learning/LeafLearner.js';
import type { LearningDeps } from '../../agent/learning/types.js';
import { KeywordExtractor } from '../../features/KeywordExtractor.js';
import type { LearningLoop, LearningLoopDeps } from './LearningFacade.js';

/** Constructor dependencies for {@link BootstrapFacade}. Getters are called only by {@link BootstrapFacade.bootstrapper}. */
export interface BootstrapFacadeDeps {
  /** Storage the managers persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager. */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's relation manager. */
  getRelationManager: () => RelationManager;
  /** Returns the owning context's skill manager. */
  getSkillManager: () => SkillManager;
  /** Returns the owning context's knowledge repository. */
  getKnowledgeRepository: () => KnowledgeRepository;
  /** Builds a learning loop over the owning context (`ManagerContext.learningLoop`). */
  learningLoop: (deps: LearningLoopDeps) => LearningLoop;
}

/** Options of `ctx.bootstrapper(deps)`. Every field is optional. */
export interface BootstrapperOptions {
  /** Summarizer for corpus maps. Default: `new SummarizationService()` (heuristic). */
  summarizer?: SummarizationService;
  /** Keyword extractor. Default: `new KeywordExtractor()`. */
  keywords?: KeywordExtractor;
  /** Optional LLM for notes, tasks and the diagnoser and editor of bootstrap learning. */
  llmProvider?: PGCompletionProvider;
  /**
   * Settings for the learning loop that bootstrap learning uses (publish directory, solver
   * instruction set, session, interaction log). Solver and judge arrive per `run` call.
   */
  learning?: Pick<LearningLoopDeps, 'publishDir' | 'solverInstructionSetId' | 'sessionId' | 'interactionLog' | 'includeTraceAddrs'>;
  /** Replaces the learning-loop adapter (for example a stub in tests). Learning still needs a solver per `run`. */
  learner?: BootstrapLearner;
}

/**
 * Factory for {@link Bootstrapper}. Holds only its dependency getters.
 *
 * @internal
 */
export class BootstrapFacade {
  /**
   * Create the instance.
   *
   * @param deps - Getters for the owning context's managers. Nothing is resolved here.
   */
  constructor(private readonly deps: BootstrapFacadeDeps) {}

  /**
   * Build a bootstrapper over the owning context. Each call returns a new instance.
   *
   * @param options - Summarizer, keywords, LLM and learning settings (all optional).
   * @returns The bootstrapper.
   */
  bootstrapper(options: BootstrapperOptions = {}): Bootstrapper {
    const learning = options.learning ?? {};
    const llm = options.llmProvider;
    const learner: BootstrapLearner = options.learner ?? {
      learn: (opts: LeafStartOptions, learnDeps: LearningDeps): Promise<LearnResult> =>
        this.deps.learningLoop({ ...learning, ...(llm ? { llmProvider: llm } : {}), ...learnDeps }).learn(opts),
    };
    return new Bootstrapper({
      storage: this.deps.storage,
      entityManager: this.deps.getEntityManager(),
      relationManager: this.deps.getRelationManager(),
      skills: this.deps.getSkillManager(),
      repository: this.deps.getKnowledgeRepository(),
      summarizer: options.summarizer ?? new SummarizationService(),
      keywords: options.keywords ?? new KeywordExtractor(),
      ...(llm ? { llmProvider: llm } : {}),
      learner,
    });
  }
}
