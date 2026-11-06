/**
 * AgentBookkeepingFacade
 *
 * Owns the agent record-keeping managers that `ManagerContext` used to hold
 * inline: heuristic guidelines, observation de-duplication, `do_not_remember`
 * exclusion rules, decision records, project context, spelling suggestions,
 * per-tool outcome statistics, the pre-storage memory validator, and semantic
 * forget.
 *
 * Every member is lazy and constructed at most once. Nothing is constructed by
 * the constructor. The memory validator is also reached through
 * {@link AgentBookkeepingFacade.memoryValidator} by the context's observation
 * manager thunk, which is why it is resolved lazily.
 *
 * @module core/context/AgentBookkeepingFacade
 * @internal
 */

import { FreshnessManager } from '../../features/FreshnessManager.js';
import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { ObservationManager } from '../ObservationManager.js';
import type { SemanticSearch } from '../../search/SemanticSearch.js';
import { ContradictionDetector } from '../../features/ContradictionDetector.js';
import { SemanticForget } from '../../features/SemanticForget.js';
import { MemoryValidator } from '../../agent/MemoryValidator.js';
import { HeuristicManager } from '../../agent/HeuristicManager.js';
import { ObservationDedupManager } from '../../agent/ObservationDedupManager.js';
import { ExclusionManager } from '../../agent/ExclusionManager.js';
import { DecisionManager } from '../../agent/DecisionManager.js';
import { ProjectContextManager } from '../../agent/ProjectContextManager.js';
import { ToolAffordanceManager } from '../../agent/ToolAffordanceManager.js';
import { ToolCallObserver } from '../../agent/ToolCallObserver.js';
import { SpellChecker } from '../../search/SpellChecker.js';

/** Constructor dependencies for {@link AgentBookkeepingFacade}. */
export interface AgentBookkeepingFacadeDeps {
  /** Storage the bookkeeping managers persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager (constructed on demand). */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's observation manager (constructed on demand). */
  getObservationManager: () => ObservationManager;
  /** Returns the owning context's semantic search, or `null` when no provider is configured. */
  getSemanticSearch: () => SemanticSearch | null;
}

/**
 * Lazy agent record-keeping managers. See the module doc for the resolution
 * rules.
 *
 * @internal
 */
export class AgentBookkeepingFacade {
  private readonly deps: AgentBookkeepingFacadeDeps;

  private _heuristicManager?: HeuristicManager;
  private _observationDedupManager?: ObservationDedupManager;
  private _exclusionManager?: ExclusionManager;
  private _decisionManager?: DecisionManager;
  private _projectContextManager?: ProjectContextManager;
  private _spellChecker?: SpellChecker;
  private _toolAffordanceManager?: ToolAffordanceManager;
  private _toolCallObserver?: ToolCallObserver;
  private _memoryValidator?: MemoryValidator;
  private _semanticForget?: SemanticForget;
  private _freshnessManager?: FreshnessManager;

  /**
   * @param deps Storage and lazy accessors for the sibling managers this
   *   facade wires into.
   */
  constructor(deps: AgentBookkeepingFacadeDeps) {
    this.deps = deps;
  }

  /**
   * FreshnessManager - TTL and confidence based freshness reporting over
   * `Entity.ttl` / `Entity.confidence`. Lazy; constructed on first access.
   */
  get freshnessManager(): FreshnessManager {
    if (!this._freshnessManager) {
      this._freshnessManager = new FreshnessManager(this.deps.storage);
    }
    return this._freshnessManager;
  }

  /**
   * HeuristicManager (Phase 3B.8a) — storage-backed registry of `condition → action`
   * heuristic guidelines. `@experimental` match algorithm. Lazy.
   */
  get heuristicManager(): HeuristicManager {
    if (!this._heuristicManager) {
      this._heuristicManager = new HeuristicManager(this.deps.storage, this.deps.getEntityManager());
    }
    return this._heuristicManager;
  }
  /**
   * ObservationDedupManager — read-only cross-entity duplicate-observation finder.
   * Complementary to `MemoryEngine` (turn-level) and `CompressionManager.findDuplicates`
   * (entity-level); surfaces observation strings that appear verbatim or
   * near-verbatim across distinct entities. Lazy.
   */
  get observationDedupManager(): ObservationDedupManager {
    if (!this._observationDedupManager) {
      this._observationDedupManager = new ObservationDedupManager(this.deps.storage);
    }
    return this._observationDedupManager;
  }
  /**
   * ExclusionManager (Phase 3) — user-supplied content-pattern exclusion rules
   * (`do_not_remember`). Hard-deletes existing matches on `add` and write-blocks
   * future matches at the memory engine's hot path. v1 ships `substring` matching
   * only. Lazy.
   */
  get exclusionManager(): ExclusionManager {
    if (!this._exclusionManager) {
      this._exclusionManager = new ExclusionManager(this.deps.storage, this.deps.getEntityManager());
    }
    return this._exclusionManager;
  }
  /**
   * DecisionManager (Phase 3 Decision Rationale) — runtime-queryable
   * architecture-decision-record memory. Lifecycle: proposed → accepted | rejected;
   * accepted → superseded. OCC-protected via `EntityManager.updateEntity({expectedVersion})`. Lazy.
   */
  get decisionManager(): DecisionManager {
    if (!this._decisionManager) {
      this._decisionManager = new DecisionManager(this.deps.storage, this.deps.getEntityManager());
    }
    return this._decisionManager;
  }
  /**
   * ProjectContextManager (Phase 3 Project Context) — structured project knowledge
   * (facts / conventions / commands / glossary), one record per `projectId`.
   * `forContext(projectId)` formats the record as prose for the wake-up L0 layer. Lazy.
   */
  get projectContextManager(): ProjectContextManager {
    if (!this._projectContextManager) {
      this._projectContextManager = new ProjectContextManager(
        this.deps.storage,
        this.deps.getEntityManager(),
      );
    }
    return this._projectContextManager;
  }
  /**
   * SpellChecker — spell-correction layer over the existing `NGramIndex`.
   * Vocabulary auto-builds from entity names and tag values. `suggest(query, opts?)`
   * returns ranked corrections filtered by score and Levenshtein distance. Lazy.
   */
  get spellChecker(): SpellChecker {
    if (!this._spellChecker) {
      this._spellChecker = new SpellChecker(this.deps.storage);
    }
    return this._spellChecker;
  }
  /**
   * ToolAffordanceManager (catalog Type 8, Phase Tool A) — per-tool rolling outcome
   * statistics for adaptive tool selection. The canonical producer is
   * {@link AgentCognitionFacade.toolCallObserver}; direct `recordOutcome` use is supported. Lazy.
   */
  get toolAffordanceManager(): ToolAffordanceManager {
    if (!this._toolAffordanceManager) {
      this._toolAffordanceManager = new ToolAffordanceManager(this.deps.storage, this.deps.getEntityManager());
    }
    return this._toolAffordanceManager;
  }
  /**
   * ToolCallObserver (Phase Tool B) — canonical producer pipeline for
   * `ToolAffordanceManager`. External systems call `observeStart(toolName)` before
   * running a tool and `observeComplete` / `observeError` / `observePartial` after.
   * Lazy; auto-wires `toolAffordanceManager`.
   */
  get toolCallObserver(): ToolCallObserver {
    if (!this._toolCallObserver) {
      this._toolCallObserver = new ToolCallObserver(this.toolAffordanceManager);
    }
    return this._toolCallObserver;
  }
  /**
   * MemoryValidator (ROADMAP §3B.1, Phase δ.1) — reflection-stage service that
   * prevents hallucinations and logical errors from contaminating memory through
   * self-critique before storage. Wraps `ContradictionDetector`. Lazy.
   *
   * When no semantic-search backend is configured, a no-op detector is
   * synthesised so the validator's other methods still work and the detection
   * method returns no contradictions.
   */
  get memoryValidator(): MemoryValidator {
    if (!this._memoryValidator) {
      const ss = this.deps.getSemanticSearch();
      const detector = ss
        ? new ContradictionDetector(ss, 0.85)
        : new ContradictionDetector(
            { calculateSimilarity: async () => 0 } as never,
            0.85,
          );
      this._memoryValidator = new MemoryValidator(detector);
    }
    return this._memoryValidator;
  }
  /**
   * SemanticForget - Feature 3 (v1.8.0): two-tier deletion with semantic fallback.
   * Exact match first; the semantic tier is used when a semantic search is configured.
   */
  get semanticForget(): SemanticForget {
    return (this._semanticForget ??= new SemanticForget(
      this.deps.storage,
      this.deps.getObservationManager(),
      this.deps.getEntityManager(),
      this.deps.getSemanticSearch() ?? undefined,
      undefined // auditLog not yet exposed by GovernanceManager
    ));
  }
}
