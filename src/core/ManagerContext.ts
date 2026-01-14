/**
 * Manager Context
 *
 * Central context holding all manager instances with lazy initialization.
 * Provides direct manager access for toolHandlers.
 * Phase 4: Removed convenience methods - use managers directly.
 *
 * @module core/ManagerContext
 */

import path from 'path';
import { GraphStorage } from './GraphStorage.js';
import { createStorageFromPath } from './StorageFactory.js';
import { EntityManager } from './EntityManager.js';
import { RelationManager } from './RelationManager.js';
import { ObservationManager } from './ObservationManager.js';
import { HierarchyManager } from './HierarchyManager.js';
import { GraphTraversal } from './GraphTraversal.js';
import { SearchManager } from '../search/SearchManager.js';
import { RankedSearch } from '../search/RankedSearch.js';
import { SemanticSearch, createEmbeddingService, createVectorStore } from '../search/index.js';
import { IOManager } from '../features/IOManager.js';
import { TagManager } from '../features/TagManager.js';
import { AnalyticsManager } from '../features/AnalyticsManager.js';
import { CompressionManager } from '../features/CompressionManager.js';
import { ArchiveManager } from '../features/ArchiveManager.js';
import { AccessTracker } from '../agent/AccessTracker.js';
import { DecayEngine } from '../agent/DecayEngine.js';
import { DecayScheduler } from '../agent/DecayScheduler.js';
import { SalienceEngine } from '../agent/SalienceEngine.js';
import { ContextWindowManager } from '../agent/ContextWindowManager.js';
import { MemoryFormatter } from '../agent/MemoryFormatter.js';
import { getEmbeddingConfig } from '../utils/constants.js';
import { validateFilePath } from '../utils/index.js';

/**
 * Context holding all manager instances with lazy initialization.
 * Provides direct manager access for toolHandlers.
 */
export class ManagerContext {
  // Type as GraphStorage for manager compatibility; actual instance may be SQLiteStorage
  // which implements the same interface via duck typing
  readonly storage: GraphStorage;
  private readonly savedSearchesFilePath: string;
  private readonly tagAliasesFilePath: string;

  // Lazy-initialized managers
  private _entityManager?: EntityManager;
  private _relationManager?: RelationManager;
  private _observationManager?: ObservationManager;
  private _hierarchyManager?: HierarchyManager;
  private _graphTraversal?: GraphTraversal;
  private _searchManager?: SearchManager;
  private _semanticSearch?: SemanticSearch | null;
  private _rankedSearch?: RankedSearch;
  private _ioManager?: IOManager;
  private _tagManager?: TagManager;
  private _analyticsManager?: AnalyticsManager;
  private _compressionManager?: CompressionManager;
  private _archiveManager?: ArchiveManager;
  private _accessTracker?: AccessTracker;
  private _decayEngine?: DecayEngine;
  private _decayScheduler?: DecayScheduler;
  private _salienceEngine?: SalienceEngine;
  private _contextWindowManager?: ContextWindowManager;
  private _memoryFormatter?: MemoryFormatter;

  constructor(memoryFilePath: string) {
    // Security: Validate path to prevent path traversal attacks
    const validatedPath = validateFilePath(memoryFilePath);

    // Derive paths for saved searches and tag aliases
    const dir = path.dirname(validatedPath);
    const basename = path.basename(validatedPath, path.extname(validatedPath));
    this.savedSearchesFilePath = path.join(dir, `${basename}-saved-searches.jsonl`);
    this.tagAliasesFilePath = path.join(dir, `${basename}-tag-aliases.jsonl`);
    // Use StorageFactory to respect MEMORY_STORAGE_TYPE environment variable
    // Type assertion: SQLiteStorage implements same interface as GraphStorage
    this.storage = createStorageFromPath(validatedPath) as GraphStorage;
  }

  // ==================== MANAGER ACCESSORS ====================
  // Use these for direct manager access in toolHandlers

  /** EntityManager - Entity CRUD and tag operations */
  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }

  /** RelationManager - Relation CRUD */
  get relationManager(): RelationManager {
    return (this._relationManager ??= new RelationManager(this.storage));
  }

  /** ObservationManager - Observation CRUD */
  get observationManager(): ObservationManager {
    return (this._observationManager ??= new ObservationManager(this.storage));
  }

  /** HierarchyManager - Entity hierarchy operations */
  get hierarchyManager(): HierarchyManager {
    return (this._hierarchyManager ??= new HierarchyManager(this.storage));
  }

  /** GraphTraversal - Phase 4 Sprint 6-8: Graph traversal algorithms */
  get graphTraversal(): GraphTraversal {
    return (this._graphTraversal ??= new GraphTraversal(this.storage));
  }

  /** SearchManager - All search operations */
  get searchManager(): SearchManager {
    return (this._searchManager ??= new SearchManager(this.storage, this.savedSearchesFilePath));
  }

  /**
   * SemanticSearch - Phase 4 Sprint 12: Semantic similarity search.
   * Returns null if no embedding provider is configured.
   */
  get semanticSearch(): SemanticSearch | null {
    if (this._semanticSearch === undefined) {
      const config = getEmbeddingConfig();
      const embeddingService = createEmbeddingService(config);

      if (embeddingService) {
        const vectorStore = createVectorStore('jsonl'); // Use in-memory for now
        this._semanticSearch = new SemanticSearch(embeddingService, vectorStore);
      } else {
        this._semanticSearch = null;
      }
    }
    return this._semanticSearch;
  }

  /** RankedSearch - Phase 11: TF-IDF/BM25 ranked search for hybrid search */
  get rankedSearch(): RankedSearch {
    return (this._rankedSearch ??= new RankedSearch(this.storage));
  }

  /** IOManager - Import, export, and backup operations */
  get ioManager(): IOManager {
    return (this._ioManager ??= new IOManager(this.storage));
  }

  /** TagManager - Tag alias management */
  get tagManager(): TagManager {
    return (this._tagManager ??= new TagManager(this.tagAliasesFilePath));
  }

  /** AnalyticsManager - Graph statistics and validation */
  get analyticsManager(): AnalyticsManager {
    return (this._analyticsManager ??= new AnalyticsManager(this.storage));
  }

  /** CompressionManager - Duplicate detection and entity merging */
  get compressionManager(): CompressionManager {
    return (this._compressionManager ??= new CompressionManager(this.storage));
  }

  /** ArchiveManager - Entity archival operations */
  get archiveManager(): ArchiveManager {
    return (this._archiveManager ??= new ArchiveManager(this.storage));
  }

  /**
   * AccessTracker - Phase 1 Agent Memory: Access pattern tracking.
   * Automatically wired to EntityManager, SearchManager, and GraphTraversal.
   */
  get accessTracker(): AccessTracker {
    if (!this._accessTracker) {
      this._accessTracker = new AccessTracker(this.storage);
      this.wireAccessTracker();
    }
    return this._accessTracker;
  }

  /**
   * Wire AccessTracker to managers that support access tracking.
   * @internal
   */
  private wireAccessTracker(): void {
    if (this._accessTracker) {
      // Wire to EntityManager
      this.entityManager.setAccessTracker(this._accessTracker);
      // Wire to SearchManager
      this.searchManager.setAccessTracker(this._accessTracker);
      // Wire to GraphTraversal
      this.graphTraversal.setAccessTracker(this._accessTracker);
    }
  }

  /**
   * DecayEngine - Phase 1 Agent Memory: Memory importance decay calculations.
   *
   * Configurable via environment variables:
   * - MEMORY_DECAY_HALF_LIFE_HOURS (default: 168 = 1 week)
   * - MEMORY_DECAY_MIN_IMPORTANCE (default: 0.1)
   * - MEMORY_DECAY_IMPORTANCE_MOD (default: true)
   * - MEMORY_DECAY_ACCESS_MOD (default: true)
   */
  get decayEngine(): DecayEngine {
    if (!this._decayEngine) {
      this._decayEngine = new DecayEngine(this.storage, this.accessTracker, {
        halfLifeHours: this.getEnvNumber('MEMORY_DECAY_HALF_LIFE_HOURS', 168),
        minImportance: this.getEnvNumber('MEMORY_DECAY_MIN_IMPORTANCE', 0.1),
        importanceModulation: this.getEnvBool('MEMORY_DECAY_IMPORTANCE_MOD', true),
        accessModulation: this.getEnvBool('MEMORY_DECAY_ACCESS_MOD', true),
      });
    }
    return this._decayEngine;
  }

  /**
   * DecayScheduler - Phase 1 Agent Memory: Scheduled decay and forget operations.
   *
   * Returns undefined if auto-decay is not enabled.
   *
   * Configurable via environment variables:
   * - MEMORY_AUTO_DECAY (default: false) - Enable to create scheduler
   * - MEMORY_DECAY_INTERVAL_MS (default: 3600000 = 1 hour)
   * - MEMORY_AUTO_FORGET (default: false)
   * - MEMORY_FORGET_THRESHOLD (default: 0.05)
   */
  get decayScheduler(): DecayScheduler | undefined {
    if (this._decayScheduler) return this._decayScheduler;

    if (this.getEnvBool('MEMORY_AUTO_DECAY', false)) {
      this._decayScheduler = new DecayScheduler(this.decayEngine, {
        decayIntervalMs: this.getEnvNumber('MEMORY_DECAY_INTERVAL_MS', 3600000),
        autoForget: this.getEnvBool('MEMORY_AUTO_FORGET', false),
        forgetOptions: {
          effectiveImportanceThreshold: this.getEnvNumber(
            'MEMORY_FORGET_THRESHOLD',
            0.05
          ),
        },
      });
    }

    return this._decayScheduler;
  }

  /**
   * SalienceEngine - Phase 4 Agent Memory: Context-aware relevance scoring.
   *
   * Configurable via environment variables:
   * - MEMORY_SALIENCE_IMPORTANCE_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_RECENCY_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_FREQUENCY_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_CONTEXT_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_NOVELTY_WEIGHT (default: 0.1)
   */
  get salienceEngine(): SalienceEngine {
    if (!this._salienceEngine) {
      this._salienceEngine = new SalienceEngine(
        this.storage,
        this.accessTracker,
        this.decayEngine,
        {
          importanceWeight: this.getEnvNumber('MEMORY_SALIENCE_IMPORTANCE_WEIGHT', 0.25),
          recencyWeight: this.getEnvNumber('MEMORY_SALIENCE_RECENCY_WEIGHT', 0.25),
          frequencyWeight: this.getEnvNumber('MEMORY_SALIENCE_FREQUENCY_WEIGHT', 0.2),
          contextWeight: this.getEnvNumber('MEMORY_SALIENCE_CONTEXT_WEIGHT', 0.2),
          noveltyWeight: this.getEnvNumber('MEMORY_SALIENCE_NOVELTY_WEIGHT', 0.1),
        }
      );
    }
    return this._salienceEngine;
  }

  /**
   * ContextWindowManager - Phase 4 Agent Memory: Token-budgeted memory retrieval.
   *
   * Configurable via environment variables:
   * - MEMORY_CONTEXT_MAX_TOKENS (default: 4000)
   * - MEMORY_CONTEXT_TOKEN_MULTIPLIER (default: 1.3)
   * - MEMORY_CONTEXT_RESERVE_BUFFER (default: 100)
   * - MEMORY_CONTEXT_DIVERSITY_THRESHOLD (default: 0.8)
   */
  get contextWindowManager(): ContextWindowManager {
    if (!this._contextWindowManager) {
      this._contextWindowManager = new ContextWindowManager(
        this.storage,
        this.salienceEngine,
        {
          defaultMaxTokens: this.getEnvNumber('MEMORY_CONTEXT_MAX_TOKENS', 4000),
          tokenMultiplier: this.getEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3),
          reserveBuffer: this.getEnvNumber('MEMORY_CONTEXT_RESERVE_BUFFER', 100),
          diversityThreshold: this.getEnvNumber('MEMORY_CONTEXT_DIVERSITY_THRESHOLD', 0.8),
          enforceDiversity: this.getEnvBool('MEMORY_CONTEXT_ENFORCE_DIVERSITY', true),
        }
      );
    }
    return this._contextWindowManager;
  }

  /**
   * MemoryFormatter - Phase 4 Agent Memory: Format memories for LLM consumption.
   */
  get memoryFormatter(): MemoryFormatter {
    if (!this._memoryFormatter) {
      this._memoryFormatter = new MemoryFormatter({
        includeTimestamps: this.getEnvBool('MEMORY_FORMAT_TIMESTAMPS', true),
        includeMemoryType: this.getEnvBool('MEMORY_FORMAT_MEMORY_TYPE', true),
      });
    }
    return this._memoryFormatter;
  }

  // ==================== Environment Variable Helpers ====================

  /**
   * Get a number from environment variable with default.
   * @internal
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get a boolean from environment variable with default.
   * @internal
   */
  private getEnvBool(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  }
}
