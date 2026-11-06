/**
 * AgentCognitionFacade
 *
 * Owns the agent reasoning and procedural managers that `ManagerContext` used
 * to hold inline: procedures and the procedural-graph factory, events,
 * prospective memory, failures, plans, reflections, causal reasoning, world
 * model, active retrieval, and reconstructive memory. Bookkeeping managers
 * (heuristics, exclusions, validation, tool statistics) live in
 * {@link AgentBookkeepingFacade}.
 *
 * Every member is lazy and constructed at most once. Env flags are read on the
 * first access of each member, matching the pre-extraction behaviour. Nothing
 * is constructed by the constructor.
 *
 * @module core/context/AgentCognitionFacade
 * @internal
 */

import { logger } from '../../utils/logger.js';
import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { RelationManager } from '../RelationManager.js';
import type { GraphTraversal } from '../GraphTraversal.js';
import type { RankedSearch } from '../../search/RankedSearch.js';
import type { SemanticSearch } from '../../search/SemanticSearch.js';
import { sidecarPath } from '../../utils/sidecarPath.js';
import type { MemoryValidator } from '../../agent/MemoryValidator.js';
import { ProcedureManager } from '../../agent/procedural/ProcedureManager.js';
import {
  ProceduralGraphManager,
  createProceduralGraphBacking,
  type IProceduralGraphBacking,
  type PGPolicy,
  type PGCompletionProvider,
} from '../../agent/procedural/graph/index.js';
import { EventManager } from '../../agent/events/EventManager.js';
import {
  ProspectiveMemoryManager,
  type PredicateEvaluator,
  type ProcedureInvoker,
} from '../../agent/ProspectiveMemoryManager.js';
import { FailureManager } from '../../agent/FailureManager.js';
import { PlanManager } from '../../agent/PlanManager.js';
import { AgentReflectionManager } from '../../agent/AgentReflectionManager.js';
import { CausalReasoner } from '../../agent/causal/CausalReasoner.js';
import { WorldModelManager } from '../../agent/world/WorldModelManager.js';
import { ActiveRetrievalController } from '../../agent/retrieval/ActiveRetrievalController.js';
import {
  ReconstructiveMemory,
  type ReconstructiveMemoryConfig,
  type ReconstructiveBacking,
} from '../../agent/reconstruction/index.js';
import { readEnvNumber } from '../../utils/envConfig.js';

/** Constructor dependencies for {@link AgentCognitionFacade}. */
export interface AgentCognitionFacadeDeps {
  /** Storage the cognition managers persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager (constructed on demand). */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's relation manager (constructed on demand). */
  getRelationManager: () => RelationManager;
  /** Returns the owning context's graph traversal (constructed on demand). */
  getGraphTraversal: () => GraphTraversal;
  /** Returns the owning context's ranked search (constructed on demand). */
  getRankedSearch: () => RankedSearch;
  /** Returns the owning context's semantic search, or `null` when no provider is configured. */
  getSemanticSearch: () => SemanticSearch | null;
  /** Returns the bookkeeping facade's memory validator (constructed on demand). */
  getMemoryValidator: () => MemoryValidator;
  /** Code-supplied evaluator for conditional prospective-memory triggers. */
  prospectivePredicateEvaluator?: PredicateEvaluator;
}

/** Shape of the `createProceduralGraph` config accepted by {@link AgentCognitionFacade.createProceduralGraph}. */
export interface ProceduralGraphConfig {
  /** Backing spec (constructed and owned) or an injected backing instance (not owned). */
  backing: { type: 'jsonl' | 'sqlite' | 'memory'; path?: string } | IProceduralGraphBacking;
  /** Optional procedural-graph policy. */
  policy?: PGPolicy;
  /** Optional guidance completion provider. */
  guidanceProvider?: PGCompletionProvider;
  /** Optional paper-compatibility flag. */
  paperCompatible?: boolean;
}

/**
 * Lazy agent reasoning and bookkeeping managers. See the module doc for the
 * resolution rules.
 *
 * @internal
 */
export class AgentCognitionFacade {
  private readonly deps: AgentCognitionFacadeDeps;

  private _procedureManager?: ProcedureManager;
  private _proceduralGraphManagers: ProceduralGraphManager[] = [];
  private _eventManager?: EventManager;
  private _prospectiveMemory?: ProspectiveMemoryManager;
  private _failureManager?: FailureManager;
  private _plan?: PlanManager;
  private _reflectionManager?: AgentReflectionManager;
  private _causalReasoner?: CausalReasoner;
  private _worldModelManager?: WorldModelManager;
  private _activeRetrieval?: ActiveRetrievalController;
  private _reconstructiveMemory?: ReconstructiveMemory;

  /**
   * @param deps Storage, lazy accessors for the sibling managers, and the
   *   optional prospective-memory predicate evaluator.
   */
  constructor(deps: AgentCognitionFacadeDeps) {
    this.deps = deps;
  }

  /**
   * ProcedureManager (3B.4) — first-class executable procedures. Lazy.
   * Composes `EntityManager` (persists procedures as `entityType: 'procedure'`).
   */
  get procedureManager(): ProcedureManager {
    if (!this._procedureManager) {
      this._procedureManager = new ProcedureManager(this.deps.getEntityManager(), this.deps.getRelationManager());
    }
    return this._procedureManager;
  }

  /**
   * Factory for a {@link ProceduralGraphManager}. A config `backing` object is
   * constructed here (`ownsBacking: true`) and disposed by {@link AgentCognitionFacade.close}.
   * An injected backing instance is not owned.
   *
   * @param config - Backing, policy, guidance provider, and paper-compatibility flag.
   * @returns The new procedural-graph manager.
   */
  async createProceduralGraph(config: ProceduralGraphConfig): Promise<ProceduralGraphManager> {
    let backing: IProceduralGraphBacking;
    let ownsBacking: boolean;
    if (isProceduralGraphBacking(config.backing)) {
      backing = config.backing;
      ownsBacking = false;
    } else {
      const spec = config.backing;
      backing = await createProceduralGraphBacking({
        type: spec.type,
        path: spec.path ?? this.defaultProceduralGraphPath(spec.type),
      });
      ownsBacking = true;
    }
    const manager = new ProceduralGraphManager({
      backing,
      ownsBacking,
      policy: config.policy,
      guidanceProvider: config.guidanceProvider,
      paperCompatible: config.paperCompatible,
    });
    if (ownsBacking) {
      this._proceduralGraphManagers.push(manager);
    }
    return manager;
  }

  /** Default backing path for a procedural graph of the given type, or `undefined` for memory. */
  private defaultProceduralGraphPath(type: 'jsonl' | 'sqlite' | 'memory'): string | undefined {
    if (type === 'memory') {
      return undefined;
    }
    return sidecarPath(
      this.deps.storage.getFilePath(),
      '-procedural-graph',
      type === 'sqlite' ? '.db' : '.jsonl',
    );
  }

  /**
   * Dispose every procedural-graph manager this facade created with an owned
   * backing. Disposal is asynchronous and detached: a failing dispose is logged
   * and never surfaces as an unhandled rejection. Idempotent.
   */
  close(): void {
    for (const manager of this._proceduralGraphManagers) {
      manager.dispose().catch((error: unknown) => {
        logger.warn('ProceduralGraphManager.dispose() failed during ManagerContext.close()', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    this._proceduralGraphManagers = [];
  }

  /**
   * EventManager (R1) — n-ary event reification: actions become first-class
   * `entityType: 'event'` hub entities with role-typed relations (`actor_of` /
   * `targeted` / `occurred_in` / `participant_in`) and optional `flow:<key>`
   * grouping tags. Lazy. Missing endpoints auto-create as `'concept'` stubs by default.
   */
  get eventManager(): EventManager {
    if (!this._eventManager) {
      this._eventManager = new EventManager(this.deps.getEntityManager(), this.deps.getRelationManager());
    }
    return this._eventManager;
  }

  /**
   * ProspectiveMemoryManager — intention-to-act / future-tense memory. Lazy.
   * Wires `procedureInvoker` to delegate to the procedure manager's `invoke()`
   * per D1 of `docs/roadmap/MEMORY_TYPES_EXPANSION.md` §6.
   */
  get prospectiveMemory(): ProspectiveMemoryManager {
    if (!this._prospectiveMemory) {
      const procedureInvoker: ProcedureInvoker = async (procedureId) => {
        const result = await this.procedureManager.invoke(procedureId);
        if (!result.found) {
          throw new Error(`ProcedureInvoker: procedure '${procedureId}' not found`);
        }
      };
      this._prospectiveMemory = new ProspectiveMemoryManager(this.deps.storage, {
        defaultExpiryHours: readEnvNumber('MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS', 168, { min: 0 }),
        maxPendingPerSession: readEnvNumber('MEMORY_PROSPECTIVE_MAX_PENDING_PER_SESSION', 100, { integer: true, min: 1 }),
        procedureInvoker,
        predicateEvaluator: this.deps.prospectivePredicateEvaluator,
      });
    }
    return this._prospectiveMemory;
  }

  /**
   * FailureManager (Phase 2 Sprint 4) — structured failure memory with
   * `record()` / `lookupForTask()` / `markResolved()` / `getAll()`. Catalog
   * Type 9. The pre-task `lookupForTask` is the headline retrieval mode.
   */
  get failureManager(): FailureManager {
    if (!this._failureManager) {
      this._failureManager = new FailureManager(this.deps.storage, this.deps.getEntityManager(), {
        defaultLookupLimit: readEnvNumber('MEMORY_FAILURE_LOOKUP_LIMIT', 5, { integer: true, min: 1 }),
        findPlanNodeOwners: (nodeId) => this.plan.findNodeOwners(nodeId),
      });
    }
    return this._failureManager;
  }

  /**
   * PlanManager (Phase 2 Sprint 5) — plan / goal-stack memory. Catalog Type 6:
   * a forward-looking goal tree with sub-tasks and acceptance criteria. Distinct
   * from prospective memory (single intention-to-act) by mutability and
   * decomposition.
   */
  get plan(): PlanManager {
    if (!this._plan) {
      this._plan = new PlanManager(this.deps.storage);
    }
    return this._plan;
  }

  /**
   * AgentReflectionManager (Phase 2 Sprint 8) — reflection-memory write path and
   * read API. Catalog Type 10: derived memories produced by `ReflectionStage`
   * over a candidate set. **Additive** — reflections do NOT supersede their
   * evidence entities. `ReflectionStage` is not auto-registered on the default
   * pipeline; construct it explicitly and invoke `runOnSessionEnd(sessionId)`
   * from session-end handlers, or register it on a `ConsolidationPipeline`.
   */
  get reflectionManager(): AgentReflectionManager {
    if (!this._reflectionManager) {
      this._reflectionManager = new AgentReflectionManager(this.deps.storage, this.deps.getEntityManager());
    }
    return this._reflectionManager;
  }

  /**
   * CausalReasoner (3B.6) — symbolic forward / backward / counterfactual
   * inference over the causal subgraph. Wraps `GraphTraversal`. Lazy.
   */
  get causalReasoner(): CausalReasoner {
    if (!this._causalReasoner) {
      this._causalReasoner = new CausalReasoner(this.deps.getGraphTraversal());
    }
    return this._causalReasoner;
  }

  /**
   * WorldModelManager (3B.7) — orchestrator that composes `causalReasoner`,
   * `memoryValidator`, and `entityManager` into a single facade for
   * `getCurrentState` / `validateFact` / `predictOutcome` / `detectStateChange`.
   * Lazy. Methods that need an unconfigured dependency return null or empty.
   */
  get worldModelManager(): WorldModelManager {
    if (!this._worldModelManager) {
      this._worldModelManager = new WorldModelManager(
        this.deps.getEntityManager(),
        this.causalReasoner,
        this.deps.getMemoryValidator(),
      );
    }
    return this._worldModelManager;
  }

  /**
   * ActiveRetrievalController (3B.5) — adaptive query-rewriting loop over
   * `RankedSearch`. Lazy. Pure symbolic expansion (no LLM); for LLM-driven
   * decomposition use the context's `llmQueryPlanner`.
   */
  get activeRetrieval(): ActiveRetrievalController {
    if (!this._activeRetrieval) {
      this._activeRetrieval = new ActiveRetrievalController(this.deps.getRankedSearch());
    }
    return this._activeRetrieval;
  }

  /**
   * ReconstructiveMemory — MRAgent-style associative memory ("Memory is
   * Reconstructed, Not Retrieved"). Builds a Cue–Tag–Content graph from dialogue
   * (`ingest`) and answers queries via active, multi-step memory reconstruction
   * (`reconstruct`). Lazy; works zero-config with heuristic distillation and
   * reconstruction, or pass an `LLMProvider` for the paper's LLM-driven distillation
   * and answer synthesis.
   *
   * @param config Optional LLM provider / restored graph snapshot. Passing a
   *   config re-instantiates the facade (invalidates the cached instance).
   */
  reconstructiveMemory(config?: ReconstructiveMemoryConfig): ReconstructiveMemory {
    if (config) {
      // Default the live-store backing to this context's managers unless the
      // caller opts out by passing their own (or `backing: undefined` explicitly).
      const backing = 'backing' in config ? config.backing : this.buildReconstructiveBacking();
      this._reconstructiveMemory = new ReconstructiveMemory({ ...config, backing });
    } else if (!this._reconstructiveMemory) {
      this._reconstructiveMemory = new ReconstructiveMemory({
        backing: this.buildReconstructiveBacking(),
      });
    }
    return this._reconstructiveMemory;
  }

  /**
   * Build a {@link ReconstructiveBacking} that bridges the Cue–Tag–Content
   * layers to this context's live modules: episodic episodes onto the
   * `EpisodicMemoryManager` timeline, semantic facts into the entity graph and
   * `SemanticSearch`, and topic links as relations.
   */
  private buildReconstructiveBacking(): ReconstructiveBacking {
    const semantic = this.deps.getSemanticSearch();
    const storage = this.deps.storage;
    return {
      // Agent entities (memoryType/sessionId/…) bypass the plain-Entity schema by
      // appending directly to storage — the same path EpisodicMemoryManager uses.
      // Names already present are skipped so repeated ingests don't duplicate
      // anchor (person/topic) entities.
      createEntities: async entities => {
        const graph = await storage.loadGraph();
        const existing = new Set(graph.entities.map(e => e.name));
        for (const entity of entities) {
          if (existing.has(entity.name)) continue;
          existing.add(entity.name);
          await storage.appendEntity(entity);
        }
      },
      createRelations: relations => this.deps.getRelationManager().createRelations(relations),
      similarity: semantic
        ? (a, b) => semantic.calculateSimilarity(a, b)
        : undefined,
      indexEntity: semantic ? entity => semantic.indexEntity(entity) : undefined,
    };
  }

  /**
   * Side-effect-free read of the prospective-memory manager. Never constructs.
   * @returns The cached `ProspectiveMemoryManager`, or `undefined`.
   */
  peekProspectiveMemory(): ProspectiveMemoryManager | undefined {
    return this._prospectiveMemory;
  }
}

/** Type guard: an injected procedural-graph backing instance (has `createGraph`). */
function isProceduralGraphBacking(
  value: { type: 'jsonl' | 'sqlite' | 'memory'; path?: string } | IProceduralGraphBacking,
): value is IProceduralGraphBacking {
  return typeof (value as IProceduralGraphBacking).createGraph === 'function';
}
