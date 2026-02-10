/**
 * Manager Context
 *
 * Central context holding all manager instances.
 * Core managers are eagerly initialized; agent memory managers
 * use lazy initialization due to conditional creation and dependency chains.
 *
 * @module core/ManagerContext
 */

import path from 'path';
import { GraphStorage } from './GraphStorage.js';
import { SQLiteStorage } from './SQLiteStorage.js';
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
import { AgentMemoryManager } from '../agent/AgentMemoryManager.js';
import type { AgentMemoryConfig } from '../agent/AgentMemoryConfig.js';
import { getEmbeddingConfig } from '../utils/constants.js';
import { validateFilePath } from '../utils/index.js';

/**
 * Central context holding all manager instances.
 * Core managers are eagerly initialized in the constructor.
 * Agent memory managers use lazy initialization due to dependency chains and conditional creation.
 */
export class ManagerContext {
  // Type as GraphStorage for manager compatibility; actual instance may be SQLiteStorage
  // which implements the same interface via duck typing
  readonly storage: GraphStorage;

  // ==================== EAGERLY INITIALIZED CORE MANAGERS ====================

  readonly entityManager: EntityManager;
  readonly relationManager: RelationManager;
  readonly observationManager: ObservationManager;
  readonly hierarchyManager: HierarchyManager;
  readonly graphTraversal: GraphTraversal;
  readonly searchManager: SearchManager;
  readonly rankedSearch: RankedSearch;
  readonly ioManager: IOManager;
  readonly tagManager: TagManager;
  readonly analyticsManager: AnalyticsManager;
  readonly compressionManager: CompressionManager;
  readonly archiveManager: ArchiveManager;

  // ==================== LAZY-INITIALIZED AGENT MEMORY MANAGERS ====================
  // These have conditional creation, env var config, or cross-manager dependency chains.

  private _semanticSearch?: SemanticSearch | null;
  private _accessTracker?: AccessTracker;
  private _decayEngine?: DecayEngine;
  private _decayScheduler?: DecayScheduler;
  private _salienceEngine?: SalienceEngine;
  private _contextWindowManager?: ContextWindowManager;
  private _memoryFormatter?: MemoryFormatter;
  private _agentMemory?: AgentMemoryManager;

  constructor(memoryFilePath: string) {
    // Security: Validate path to prevent path traversal attacks
    const validatedPath = validateFilePath(memoryFilePath);

    // Derive paths for saved searches and tag aliases
    const dir = path.dirname(validatedPath);
    const basename = path.basename(validatedPath, path.extname(validatedPath));
    const savedSearchesFilePath = path.join(dir, `${basename}-saved-searches.jsonl`);
    const tagAliasesFilePath = path.join(dir, `${basename}-tag-aliases.jsonl`);

    // Create storage based on MEMORY_STORAGE_TYPE env var (default: jsonl)
    const storageType = process.env.MEMORY_STORAGE_TYPE || 'jsonl';
    if (storageType === 'sqlite') {
      this.storage = new SQLiteStorage(validatedPath) as unknown as GraphStorage;
    } else if (storageType === 'jsonl') {
      this.storage = new GraphStorage(validatedPath);
    } else {
      throw new Error(`Unknown storage type: ${storageType}. Supported types: jsonl, sqlite`);
    }

    // Initialize core managers eagerly — all are lightweight
    this.entityManager = new EntityManager(this.storage);
    this.relationManager = new RelationManager(this.storage);
    this.observationManager = new ObservationManager(this.storage);
    this.hierarchyManager = new HierarchyManager(this.storage);
    this.graphTraversal = new GraphTraversal(this.storage);
    this.searchManager = new SearchManager(this.storage, savedSearchesFilePath);
    this.rankedSearch = new RankedSearch(this.storage);
    this.ioManager = new IOManager(this.storage);
    this.tagManager = new TagManager(tagAliasesFilePath);
    this.analyticsManager = new AnalyticsManager(this.storage);
    this.compressionManager = new CompressionManager(this.storage);
    this.archiveManager = new ArchiveManager(this.storage);
  }

  // ==================== LAZY ACCESSORS (agent memory + semantic) ====================

  /**
   * SemanticSearch - Semantic similarity search.
   * Returns null if no embedding provider is configured.
   */
  get semanticSearch(): SemanticSearch | null {
    if (this._semanticSearch === undefined) {
      const config = getEmbeddingConfig();
      const embeddingService = createEmbeddingService(config);

      if (embeddingService) {
        const vectorStore = createVectorStore('jsonl');
        this._semanticSearch = new SemanticSearch(embeddingService, vectorStore);
      } else {
        this._semanticSearch = null;
      }
    }
    return this._semanticSearch;
  }

  /**
   * AccessTracker - Access pattern tracking.
   * Automatically wired to EntityManager, SearchManager, and GraphTraversal.
   */
  get accessTracker(): AccessTracker {
    if (!this._accessTracker) {
      this._accessTracker = new AccessTracker(this.storage);
      this.entityManager.setAccessTracker(this._accessTracker);
      this.searchManager.setAccessTracker(this._accessTracker);
      this.graphTraversal.setAccessTracker(this._accessTracker);
    }
    return this._accessTracker;
  }

  /**
   * DecayEngine - Memory importance decay calculations.
   */
  get decayEngine(): DecayEngine {
    if (!this._decayEngine) {
      this._decayEngine = new DecayEngine(this.storage, this.accessTracker, {
        halfLifeHours: getEnvNumber('MEMORY_DECAY_HALF_LIFE_HOURS', 168),
        minImportance: getEnvNumber('MEMORY_DECAY_MIN_IMPORTANCE', 0.1),
        importanceModulation: getEnvBool('MEMORY_DECAY_IMPORTANCE_MOD', true),
        accessModulation: getEnvBool('MEMORY_DECAY_ACCESS_MOD', true),
      });
    }
    return this._decayEngine;
  }

  /**
   * DecayScheduler - Scheduled decay and forget operations.
   * Returns undefined if auto-decay is not enabled (MEMORY_AUTO_DECAY).
   */
  get decayScheduler(): DecayScheduler | undefined {
    if (this._decayScheduler) return this._decayScheduler;

    if (getEnvBool('MEMORY_AUTO_DECAY', false)) {
      this._decayScheduler = new DecayScheduler(this.decayEngine, {
        decayIntervalMs: getEnvNumber('MEMORY_DECAY_INTERVAL_MS', 3600000),
        autoForget: getEnvBool('MEMORY_AUTO_FORGET', false),
        forgetOptions: {
          effectiveImportanceThreshold: getEnvNumber('MEMORY_FORGET_THRESHOLD', 0.05),
        },
      });
    }

    return this._decayScheduler;
  }

  /**
   * SalienceEngine - Context-aware relevance scoring.
   */
  get salienceEngine(): SalienceEngine {
    if (!this._salienceEngine) {
      this._salienceEngine = new SalienceEngine(
        this.storage,
        this.accessTracker,
        this.decayEngine,
        {
          importanceWeight: getEnvNumber('MEMORY_SALIENCE_IMPORTANCE_WEIGHT', 0.25),
          recencyWeight: getEnvNumber('MEMORY_SALIENCE_RECENCY_WEIGHT', 0.25),
          frequencyWeight: getEnvNumber('MEMORY_SALIENCE_FREQUENCY_WEIGHT', 0.2),
          contextWeight: getEnvNumber('MEMORY_SALIENCE_CONTEXT_WEIGHT', 0.2),
          noveltyWeight: getEnvNumber('MEMORY_SALIENCE_NOVELTY_WEIGHT', 0.1),
        }
      );
    }
    return this._salienceEngine;
  }

  /**
   * ContextWindowManager - Token-budgeted memory retrieval.
   */
  get contextWindowManager(): ContextWindowManager {
    if (!this._contextWindowManager) {
      this._contextWindowManager = new ContextWindowManager(
        this.storage,
        this.salienceEngine,
        {
          defaultMaxTokens: getEnvNumber('MEMORY_CONTEXT_MAX_TOKENS', 4000),
          tokenMultiplier: getEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3),
          reserveBuffer: getEnvNumber('MEMORY_CONTEXT_RESERVE_BUFFER', 100),
          diversityThreshold: getEnvNumber('MEMORY_CONTEXT_DIVERSITY_THRESHOLD', 0.8),
          enforceDiversity: getEnvBool('MEMORY_CONTEXT_ENFORCE_DIVERSITY', true),
        }
      );
    }
    return this._contextWindowManager;
  }

  /**
   * MemoryFormatter - Format memories for LLM consumption.
   */
  get memoryFormatter(): MemoryFormatter {
    if (!this._memoryFormatter) {
      this._memoryFormatter = new MemoryFormatter({
        includeTimestamps: getEnvBool('MEMORY_FORMAT_TIMESTAMPS', true),
        includeMemoryType: getEnvBool('MEMORY_FORMAT_MEMORY_TYPE', true),
      });
    }
    return this._memoryFormatter;
  }

  /**
   * AgentMemoryManager - Unified facade for all agent memory operations.
   *
   * @param config - Optional configuration override (default: loaded from env vars)
   */
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager {
    if (!this._agentMemory || config) {
      this._agentMemory = new AgentMemoryManager(this.storage, config);
    }
    return this._agentMemory;
  }
}

// ==================== Module-level helpers ====================

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}
