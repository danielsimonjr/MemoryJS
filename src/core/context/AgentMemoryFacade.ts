/**
 * AgentMemoryFacade
 *
 * Owns the agent-memory lifecycle and retrieval managers that `ManagerContext`
 * used to hold inline: the `AgentMemoryManager` facade and everything derived
 * from it (memory engine, memory backend, consolidation and dream schedulers),
 * the decay, salience, and access-tracking stack, the context window and
 * formatter, the observer pipeline, artifacts, and the reflection-stage
 * trajectory and experience helpers.
 *
 * Every member is lazy and constructed at most once. Env flags are read on the
 * first access of each member, matching the pre-extraction behaviour. Calling
 * {@link AgentMemoryFacade.agentMemory} with a config re-instantiates the
 * facade and invalidates the derived caches that captured its old pipeline.
 *
 * @module core/context/AgentMemoryFacade
 * @internal
 */

import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { GraphTraversal } from '../GraphTraversal.js';
import type { RefIndex } from '../RefIndex.js';
import type { SearchManager } from '../../search/SearchManager.js';
import type { SemanticSearch } from '../../search/SemanticSearch.js';
import type { HybridSearchManager } from '../../search/HybridSearchManager.js';
import type { CompressionManager } from '../../features/CompressionManager.js';
import type { ExclusionManager } from '../../agent/ExclusionManager.js';
import { AccessTracker } from '../../agent/AccessTracker.js';
import { DecayEngine } from '../../agent/DecayEngine.js';
import { DecayScheduler } from '../../agent/DecayScheduler.js';
import { ConsolidationScheduler } from '../../agent/ConsolidationScheduler.js';
import { DreamEngine, type DreamEngineConfig } from '../../agent/DreamEngine.js';
import { SalienceEngine } from '../../agent/SalienceEngine.js';
import { ContextWindowManager } from '../../agent/ContextWindowManager.js';
import { MemoryFormatter } from '../../agent/MemoryFormatter.js';
import { AgentMemoryManager } from '../../agent/AgentMemoryManager.js';
import type { AgentMemoryConfig } from '../../agent/AgentMemoryConfig.js';
import { ArtifactManager } from '../../agent/ArtifactManager.js';
import { ObserverPipeline } from '../../agent/ObserverPipeline.js';
import type { ObserverPipelineOptions } from '../../agent/ObserverPipeline.js';
import { MemoryEngine } from '../../agent/MemoryEngine.js';
import { ImportanceScorer } from '../../agent/ImportanceScorer.js';
import type { IMemoryBackend } from '../../agent/MemoryBackend.js';
import { InMemoryBackend } from '../../agent/InMemoryBackend.js';
import { SQLiteBackend } from '../../agent/SQLiteBackend.js';
import { TrajectoryCompressor } from '../../agent/TrajectoryCompressor.js';
import { ExperienceExtractor } from '../../agent/ExperienceExtractor.js';
import { PatternDetector } from '../../agent/PatternDetector.js';
import { readEnvNumber, readEnvLooseFlag, readEnvNumberOrUndefined } from '../../utils/envConfig.js';
import { PROBABILITY } from './envBounds.js';

/** Constructor dependencies for {@link AgentMemoryFacade}. */
export interface AgentMemoryFacadeDeps {
  /** Storage the agent-memory managers persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager (constructed on demand). */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's search manager (constructed on demand). */
  getSearchManager: () => SearchManager;
  /** Returns the owning context's graph traversal (constructed on demand). */
  getGraphTraversal: () => GraphTraversal;
  /** Returns the owning context's semantic search, or `null` when no provider is configured. */
  getSemanticSearch: () => SemanticSearch | null;
  /** Returns the owning context's hybrid search manager (constructed on demand). */
  getHybridSearchManager: () => HybridSearchManager;
  /** Returns the owning context's compression manager (constructed on demand). */
  getCompressionManager: () => CompressionManager;
  /** Returns the cognition facade's exclusion manager (constructed on demand). */
  getExclusionManager: () => ExclusionManager;
  /** Returns the owning context's reference index (constructed on demand). */
  getRefIndex: () => RefIndex;
}

/**
 * Lazy agent-memory lifecycle and retrieval managers. See the module doc for
 * the resolution rules.
 *
 * @internal
 */
export class AgentMemoryFacade {
  private readonly deps: AgentMemoryFacadeDeps;

  private _agentMemory?: AgentMemoryManager;
  private _memoryEngine?: MemoryEngine;
  private _memoryBackend?: IMemoryBackend;
  private _consolidationScheduler?: ConsolidationScheduler;
  private _dreamEngine?: DreamEngine;
  private _accessTracker?: AccessTracker;
  private _decayEngine?: DecayEngine;
  private _decayScheduler?: DecayScheduler;
  private _salienceEngine?: SalienceEngine;
  private _contextWindowManager?: ContextWindowManager;
  private _memoryFormatter?: MemoryFormatter;
  private _observerPipeline?: ObserverPipeline;
  private _artifactManager?: ArtifactManager;
  private _trajectoryCompressor?: TrajectoryCompressor;
  private _experienceExtractor?: ExperienceExtractor;
  private _patternDetector?: PatternDetector;

  /**
   * @param deps Storage and lazy accessors for the sibling managers this
   *   facade wires into.
   */
  constructor(deps: AgentMemoryFacadeDeps) {
    this.deps = deps;
  }

  /**
   * AgentMemoryManager — unified facade for all agent memory operations.
   *
   * Passing a `config` re-instantiates the manager and invalidates every derived
   * cache that captured references into the old one: the memory engine, the
   * memory backend, the consolidation scheduler, and the dream engine.
   *
   * @param config - Optional configuration override (default: loaded from env vars).
   */
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager {
    if (!this._agentMemory || config) {
      this._agentMemory = new AgentMemoryManager(this.deps.storage, config);
      // Invalidate every derived cache that captured references into the
      // old AgentMemoryManager. The full set:
      //   - MemoryEngine (wires episodicMemory/workingMemory at ctor)
      //   - MemoryBackend (wraps MemoryEngine)
      //   - ConsolidationScheduler (captures agentMemory().consolidationPipeline)
      //   - DreamEngine (also captures consolidationPipeline)
      this._memoryEngine = undefined;
      this._memoryBackend = undefined;
      this._consolidationScheduler = undefined;
      this._dreamEngine = undefined;
    }
    return this._agentMemory;
  }

  /**
   * MemoryEngine — turn-aware conversation memory facade composing over
   * EpisodicMemoryManager + WorkingMemoryManager + ImportanceScorer.
   * Lazy: instantiated on first access. Reads `MEMORY_ENGINE_*` env vars
   * for dedup thresholds, scan window, and scorer weights.
   */
  get memoryEngine(): MemoryEngine {
    if (!this._memoryEngine) {
      const agent = this.agentMemory();
      const importanceScorer = new ImportanceScorer({
        lengthWeight: readEnvNumber('MEMORY_ENGINE_LENGTH_WEIGHT', 0.3, PROBABILITY),
        keywordWeight: readEnvNumber('MEMORY_ENGINE_KEYWORD_WEIGHT', 0.4, PROBABILITY),
        overlapWeight: readEnvNumber('MEMORY_ENGINE_OVERLAP_WEIGHT', 0.3, PROBABILITY),
      });
      const semanticSearch = this.deps.getSemanticSearch() ?? null;
      // Use the public accessor so a future rename of the private field
      // would surface as a typecheck error rather than a silent null.
      const embeddingService = semanticSearch?.getEmbeddingService() ?? null;

      this._memoryEngine = new MemoryEngine(
        this.deps.storage,
        this.deps.getEntityManager(),
        agent.episodicMemory,
        agent.workingMemory,
        importanceScorer,
        semanticSearch,
        embeddingService,
        {
          jaccardThreshold: readEnvNumber('MEMORY_ENGINE_JACCARD_THRESHOLD', 0.72, PROBABILITY),
          prefixOverlapThreshold: readEnvNumber('MEMORY_ENGINE_PREFIX_OVERLAP', 0.5, PROBABILITY),
          dedupScanWindow: Math.trunc(
            readEnvNumber('MEMORY_ENGINE_DEDUP_SCAN_WINDOW', 200, { integer: true, min: 1 }),
          ),
          maxTurnsPerSession: Math.trunc(
            readEnvNumber('MEMORY_ENGINE_MAX_TURNS_PER_SESSION', 1000, { integer: true, min: 1 }),
          ),
          semanticDedupEnabled: readEnvLooseFlag('MEMORY_ENGINE_SEMANTIC_DEDUP', false),
          semanticThreshold: readEnvNumber('MEMORY_ENGINE_SEMANTIC_THRESHOLD', 0.92, PROBABILITY),
          recentTurnsForImportance: Math.trunc(
            readEnvNumber('MEMORY_ENGINE_RECENT_TURNS', 10, { integer: true, min: 1 }),
          ),
          // Phase 3 do_not_remember: auto-wire so addTurn consults
          // active exclusion rules. Direct-construct MemoryEngine
          // (bypassing this getter) to opt out.
          exclusionManager: this.deps.getExclusionManager(),
        },
      );
    }
    return this._memoryEngine;
  }

  /**
   * IMemoryBackend (PRD MEM-04) — agent-memory-flavoured backend.
   *
   * Selection by the `MEMORY_BACKEND` env var:
   *   - `sqlite` (default when storage is SQLite OR var unset on JSONL)
   *   - `in-memory` (ephemeral; no persistence)
   *   - future: `postgres`, `vector` (Phase γ)
   *
   * Both adapters wrap the memory engine and the decay engine so they inherit
   * the four-tier dedup chain and PRD effective-importance scoring respectively.
   * Lazy-initialised and cached.
   */
  get memoryBackend(): IMemoryBackend {
    if (!this._memoryBackend) {
      const choice = (process.env.MEMORY_BACKEND ?? 'sqlite').toLowerCase();
      switch (choice) {
        case 'in-memory':
        case 'inmemory':
        case 'memory':
          this._memoryBackend = new InMemoryBackend(this.decayEngine);
          break;
        case 'sqlite':
        default:
          // SQLiteBackend wraps MemoryEngine which works against either
          // JSONL or SQLite storage transparently — naming reflects PRD
          // intent (durable backend) more than the disk format.
          this._memoryBackend = new SQLiteBackend(this.memoryEngine, this.decayEngine, {
            renameEntity: (oldName, newName) => this.deps.getEntityManager().renameEntity(oldName, newName),
          });
          break;
      }
    }
    return this._memoryBackend;
  }

  /**
   * TrajectoryCompressor (ROADMAP §3B.2, Phase δ.2) — reflection-stage
   * service that distils verbose interaction histories into compact,
   * reusable representations. Wraps `compressForContext`. Lazy.
   */
  get trajectoryCompressor(): TrajectoryCompressor {
    if (!this._trajectoryCompressor) {
      this._trajectoryCompressor = new TrajectoryCompressor(this.contextWindowManager);
    }
    return this._trajectoryCompressor;
  }

  /**
   * ExperienceExtractor (ROADMAP §3B.3, Phase δ.3) — experience-stage
   * service that abstracts universal patterns from trajectory clusters
   * for zero-shot transfer. Wraps `PatternDetector`. Lazy.
   */
  get experienceExtractor(): ExperienceExtractor {
    if (!this._experienceExtractor) {
      this._experienceExtractor = new ExperienceExtractor(this.patternDetector);
    }
    return this._experienceExtractor;
  }

  /**
   * Lazy `PatternDetector` instance — backs `experienceExtractor` but is also
   * exposed directly for callers that want pattern detection without the full
   * Experience-stage wrapper.
   */
  get patternDetector(): PatternDetector {
    if (!this._patternDetector) {
      this._patternDetector = new PatternDetector();
    }
    return this._patternDetector;
  }

  /**
   * AccessTracker - access pattern tracking.
   * Automatically wired to EntityManager, SearchManager, and GraphTraversal.
   */
  get accessTracker(): AccessTracker {
    if (!this._accessTracker) {
      this._accessTracker = new AccessTracker(this.deps.storage);
      this.deps.getEntityManager().setAccessTracker(this._accessTracker);
      this.deps.getSearchManager().setAccessTracker(this._accessTracker);
      this.deps.getGraphTraversal().setAccessTracker(this._accessTracker);
    }
    return this._accessTracker;
  }

  /**
   * DecayEngine - memory importance decay calculations.
   */
  get decayEngine(): DecayEngine {
    if (!this._decayEngine) {
      this._decayEngine = new DecayEngine(this.deps.storage, this.accessTracker, {
        halfLifeHours: readEnvNumber('MEMORY_DECAY_HALF_LIFE_HOURS', 168, { min: 0 }),
        minImportance: readEnvNumber('MEMORY_DECAY_MIN_IMPORTANCE', 0.1, { min: 0 }),
        importanceModulation: readEnvLooseFlag('MEMORY_DECAY_IMPORTANCE_MOD', true),
        accessModulation: readEnvLooseFlag('MEMORY_DECAY_ACCESS_MOD', true),
        connectivityProtection: readEnvNumber('MEMORY_DECAY_CONNECTIVITY_PROTECTION', 0, PROBABILITY),
        // PRD MEM-01 (v1.12.0). decayRate is auto-derived from halfLifeHours
        // when env-var unset (NaN check avoids overriding the auto-derive).
        decayRate: readEnvNumberOrUndefined('MEMORY_PRD_DECAY_RATE'),
        freshnessCoefficient: readEnvNumber('MEMORY_PRD_FRESHNESS_COEFFICIENT', 0.01, { min: 0 }),
        relevanceWeight: readEnvNumber('MEMORY_PRD_RELEVANCE_WEIGHT', 0.35, PROBABILITY),
        minImportanceThreshold: readEnvNumber('MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD', 0.1, { min: 0 }),
      });
    }
    return this._decayEngine;
  }

  /**
   * DecayScheduler - scheduled decay and forget operations.
   * Returns `undefined` if auto-decay is not enabled (`MEMORY_AUTO_DECAY`).
   * The off state is not cached, so the env flag is re-read on each access.
   */
  get decayScheduler(): DecayScheduler | undefined {
    if (this._decayScheduler) return this._decayScheduler;

    if (readEnvLooseFlag('MEMORY_AUTO_DECAY', false)) {
      this._decayScheduler = new DecayScheduler(this.decayEngine, {
        decayIntervalMs: readEnvNumber('MEMORY_DECAY_INTERVAL_MS', 3600000, { integer: true, min: 1 }),
        autoForget: readEnvLooseFlag('MEMORY_AUTO_FORGET', false),
        forgetOptions: {
          effectiveImportanceThreshold: readEnvNumber('MEMORY_FORGET_THRESHOLD', 0.05, { min: 0 }),
        },
      });
    }

    return this._decayScheduler;
  }

  /**
   * ConsolidationScheduler - scheduled memory consolidation.
   *
   * Returns `undefined` when `MEMORY_AUTO_CONSOLIDATION` is not `'true'`. The
   * off state is not cached.
   *
   * Configurable via environment variables:
   * - MEMORY_AUTO_CONSOLIDATION (default: false) - enable to create the scheduler
   * - MEMORY_CONSOLIDATION_INTERVAL_MS (default: 3600000 = 1 hour)
   * - MEMORY_CONSOLIDATION_MERGE_DUPLICATES (default: false)
   * - MEMORY_CONSOLIDATION_DUPLICATE_THRESHOLD (default: 0.9)
   */
  get consolidationScheduler(): ConsolidationScheduler | undefined {
    if (this._consolidationScheduler) return this._consolidationScheduler;

    if (readEnvLooseFlag('MEMORY_AUTO_CONSOLIDATION', false)) {
      this._consolidationScheduler = new ConsolidationScheduler(
        this.agentMemory().consolidationPipeline,
        this.deps.getCompressionManager(),
        {
          consolidationIntervalMs: readEnvNumber(
            'MEMORY_CONSOLIDATION_INTERVAL_MS',
            3600000, { integer: true, min: 1 }
          ),
          autoMergeDuplicates: readEnvLooseFlag(
            'MEMORY_CONSOLIDATION_MERGE_DUPLICATES',
            false
          ),
          duplicateThreshold: readEnvNumber(
            'MEMORY_CONSOLIDATION_DUPLICATE_THRESHOLD',
            0.9
          ),
        }
      );
    }

    return this._consolidationScheduler;
  }

  /**
   * DreamEngine — background memory maintenance.
   *
   * Returns a DreamEngine instance. The timer is NOT auto-started. Call
   * `.start()` to activate periodic cycles, or use the `agentMemory()` helper
   * methods `startDreaming()` / `stopDreaming()`. A call with a non-empty
   * `config` always rebuilds the engine.
   *
   * Configurable via environment variables:
   * - MEMORY_DREAM_INTERVAL_MS (default: 14400000 = 4 hours)
   *
   * @param config - Optional overrides merged over the env-derived interval.
   */
  dreamEngine(config: DreamEngineConfig = {}): DreamEngine {
    if (!this._dreamEngine || Object.keys(config).length > 0) {
      this._dreamEngine = new DreamEngine(
        this.deps.storage,
        this.agentMemory().consolidationPipeline,
        {
          intervalMs: readEnvNumber('MEMORY_DREAM_INTERVAL_MS', 4 * 60 * 60 * 1000, { integer: true, min: 1 }),
          ...config,
        }
      );
    }
    return this._dreamEngine;
  }

  /**
   * SalienceEngine - Phase 4 agent memory: context-aware relevance scoring.
   *
   * Configurable via environment variables:
   * - MEMORY_SALIENCE_IMPORTANCE_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_RECENCY_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_FREQUENCY_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_CONTEXT_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_NOVELTY_WEIGHT (default: 0.1)
   * - MEMORY_SALIENCE_CONNECTIVITY_WEIGHT (default: 0 = disabled)
   */
  get salienceEngine(): SalienceEngine {
    if (!this._salienceEngine) {
      this._salienceEngine = new SalienceEngine(
        this.deps.storage,
        this.accessTracker,
        this.decayEngine,
        {
          importanceWeight: readEnvNumber('MEMORY_SALIENCE_IMPORTANCE_WEIGHT', 0.25, PROBABILITY),
          recencyWeight: readEnvNumber('MEMORY_SALIENCE_RECENCY_WEIGHT', 0.25, PROBABILITY),
          frequencyWeight: readEnvNumber('MEMORY_SALIENCE_FREQUENCY_WEIGHT', 0.2, PROBABILITY),
          contextWeight: readEnvNumber('MEMORY_SALIENCE_CONTEXT_WEIGHT', 0.2, PROBABILITY),
          noveltyWeight: readEnvNumber('MEMORY_SALIENCE_NOVELTY_WEIGHT', 0.1, PROBABILITY),
          connectivityWeight: readEnvNumber('MEMORY_SALIENCE_CONNECTIVITY_WEIGHT', 0, PROBABILITY),
        }
      );
    }
    return this._salienceEngine;
  }

  /**
   * ContextWindowManager - token-budgeted memory retrieval.
   *
   * When `MEMORY_CONTEXT_HYBRID_RANKING` is `'true'` (default off), the manager
   * ranks candidates through the hybrid search manager once at construction.
   * The hybrid manager is not built while the switch is off.
   *
   * This getter covers only this context's instance. `AgentMemoryManager`
   * builds its own ContextWindowManager and does not use this switch.
   */
  get contextWindowManager(): ContextWindowManager {
    if (!this._contextWindowManager) {
      const manager = new ContextWindowManager(
        this.deps.storage,
        this.salienceEngine,
        {
          defaultMaxTokens: readEnvNumber('MEMORY_CONTEXT_MAX_TOKENS', 4000),
          tokenMultiplier: readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3),
          reserveBuffer: readEnvNumber('MEMORY_CONTEXT_RESERVE_BUFFER', 100),
          diversityThreshold: readEnvNumber('MEMORY_CONTEXT_DIVERSITY_THRESHOLD', 0.8),
          enforceDiversity: readEnvLooseFlag('MEMORY_CONTEXT_ENFORCE_DIVERSITY', true),
        }
      );
      if (readEnvLooseFlag('MEMORY_CONTEXT_HYBRID_RANKING', false)) {
        manager.setHybridSearch(this.deps.getHybridSearchManager());
      }
      this._contextWindowManager = manager;
    }
    return this._contextWindowManager;
  }

  /**
   * MemoryFormatter - format memories for LLM consumption.
   */
  get memoryFormatter(): MemoryFormatter {
    if (!this._memoryFormatter) {
      this._memoryFormatter = new MemoryFormatter({
        includeTimestamps: readEnvLooseFlag('MEMORY_FORMAT_TIMESTAMPS', true),
        includeMemoryType: readEnvLooseFlag('MEMORY_FORMAT_MEMORY_TYPE', true),
      });
    }
    return this._memoryFormatter;
  }

  /**
   * ObserverPipeline - event-driven observation scoring and categorisation.
   * Returns `undefined` if not enabled (`MEMORY_OBSERVER_PIPELINE`). The off
   * state is not cached.
   */
  get observerPipeline(): ObserverPipeline | undefined {
    if (this._observerPipeline) return this._observerPipeline;

    if (readEnvLooseFlag('MEMORY_OBSERVER_PIPELINE', false)) {
      const options: ObserverPipelineOptions = {
        minImportanceThreshold: readEnvNumber('MEMORY_OBSERVER_MIN_THRESHOLD', 0.3),
        autoTag: readEnvLooseFlag('MEMORY_OBSERVER_AUTO_TAG', true),
        autoRoute: readEnvLooseFlag('MEMORY_OBSERVER_AUTO_ROUTE', false),
      };
      this._observerPipeline = new ObserverPipeline(
        this.deps.getEntityManager(),
        options
      );
    }

    return this._observerPipeline;
  }

  /**
   * ArtifactManager — v1.7.0: stable artifact entities with auto-generated
   * names and ref registration.
   */
  get artifactManager(): ArtifactManager {
    if (!this._artifactManager) {
      this._artifactManager = new ArtifactManager(this.deps.storage, this.deps.getEntityManager(), this.deps.getRefIndex());
    }
    return this._artifactManager;
  }
}
