/**
 * Agent Memory Manager - Unified Facade
 *
 * High-level API for AI agent memory management, wrapping all agent memory
 * components into a cohesive interface.
 *
 * @module agent/AgentMemoryManager
 */

import { EventEmitter } from 'events';
import type { IGraphStorage } from '../types/types.js';
import type {
  AgentEntity,
  AgentMetadata,
  MemoryVisibility,
  ConflictStrategy,
  ConflictInfo,
  SessionEntity,
  ForgetResult,
  ConsolidationResult,
  ContextRetrievalOptions,
  ContextPackage,
} from '../types/agent-memory.js';
import { AccessTracker, type AccessContext } from './AccessTracker.js';
import { DecayEngine, type ForgetOptions } from './DecayEngine.js';
import { DecayScheduler, type DecayCycleResult } from './DecayScheduler.js';
import { WorkingMemoryManager, type PromotionResult, type ConfirmationResult } from './WorkingMemoryManager.js';
import { SessionManager, type StartSessionOptions, type EndSessionResult } from './SessionManager.js';
import { EpisodicMemoryManager, type CreateEpisodeOptions, type TimelineOptions } from './EpisodicMemoryManager.js';
import { ConsolidationPipeline } from './ConsolidationPipeline.js';
import { SummarizationService, type ISummarizationProvider } from './SummarizationService.js';
import { PatternDetector } from './PatternDetector.js';
import { RuleEvaluator } from './RuleEvaluator.js';
import { SalienceEngine } from './SalienceEngine.js';
import { ContextWindowManager } from './ContextWindowManager.js';
import { MemoryFormatter } from './MemoryFormatter.js';
import { MultiAgentMemoryManager } from './MultiAgentMemoryManager.js';
import { ConflictResolver, type ResolutionResult } from './ConflictResolver.js';
import {
  type AgentMemoryConfig,
  loadConfigFromEnv,
  mergeConfig,
  validateConfig,
} from './AgentMemoryConfig.js';

/**
 * Options for creating working memory.
 */
export interface CreateMemoryOptions {
  /** Session ID to associate memory with */
  sessionId: string;
  /** Content/observation for the memory */
  content: string;
  /** Initial importance (0-10) */
  importance?: number;
  /** Task ID context */
  taskId?: string;
  /** Time-to-live in hours */
  ttlHours?: number;
  /** Agent ID (for multi-agent mode) */
  agentId?: string;
  /** Visibility level (for multi-agent mode) */
  visibility?: MemoryVisibility;
}

/**
 * Options for retrieving context.
 */
export interface RetrieveContextOptions {
  /** Current session ID */
  sessionId?: string;
  /** Current task ID */
  taskId?: string;
  /** Keywords for relevance scoring */
  keywords?: string[];
  /** Maximum tokens in context */
  maxTokens?: number;
  /** Include working memory (default: true) */
  includeWorkingMemory?: boolean;
  /** Include episodic memories (default: true) */
  includeEpisodicRecent?: boolean;
  /** Include semantic memories (default: true) */
  includeSemanticRelevant?: boolean;
  /** Specific memory names to always include */
  mustInclude?: string[];
}

/**
 * Agent Memory Manager - Unified API for agent memory operations.
 *
 * Provides a high-level interface for:
 * - Session lifecycle management
 * - Working memory creation and management
 * - Memory consolidation and promotion
 * - Context retrieval for LLM consumption
 * - Multi-agent memory coordination
 *
 * @example
 * ```typescript
 * const manager = new AgentMemoryManager(storage);
 *
 * // Start a session
 * const session = await manager.startSession({ agentId: 'assistant' });
 *
 * // Add working memory
 * const memory = await manager.addWorkingMemory({
 *   sessionId: session.name,
 *   content: 'User prefers dark mode',
 * });
 *
 * // Retrieve context for LLM
 * const context = await manager.retrieveForContext({
 *   sessionId: session.name,
 *   keywords: ['user preferences'],
 *   maxTokens: 2000,
 * });
 *
 * // End session
 * await manager.endSession(session.name);
 * ```
 */
export class AgentMemoryManager extends EventEmitter {
  private readonly storage: IGraphStorage;
  private readonly config: AgentMemoryConfig;

  // Core components (lazy initialized)
  private _accessTracker?: AccessTracker;
  private _decayEngine?: DecayEngine;
  private _decayScheduler?: DecayScheduler;
  private _workingMemory?: WorkingMemoryManager;
  private _sessionManager?: SessionManager;
  private _episodicMemory?: EpisodicMemoryManager;
  private _consolidationPipeline?: ConsolidationPipeline;
  private _summarizationService?: SummarizationService;
  private _patternDetector?: PatternDetector;
  private _ruleEvaluator?: RuleEvaluator;
  private _salienceEngine?: SalienceEngine;
  private _contextWindowManager?: ContextWindowManager;
  private _memoryFormatter?: MemoryFormatter;
  private _multiAgentManager?: MultiAgentMemoryManager;
  private _conflictResolver?: ConflictResolver;

  constructor(storage: IGraphStorage, config: AgentMemoryConfig = {}) {
    super();
    this.storage = storage;

    // Load and merge configuration
    const envConfig = loadConfigFromEnv();
    this.config = mergeConfig(config, envConfig);

    // Validate configuration
    validateConfig(this.config);

    // Initialize auto-decay if enabled
    if (this.config.enableAutoDecay && this.config.decayScheduler) {
      this.decayScheduler.start();
    }
  }

  // ==================== Component Accessors ====================

  /** Access tracker for memory usage patterns */
  get accessTracker(): AccessTracker {
    return (this._accessTracker ??= new AccessTracker(this.storage));
  }

  /** Decay engine for memory importance decay */
  get decayEngine(): DecayEngine {
    return (this._decayEngine ??= new DecayEngine(
      this.storage,
      this.accessTracker,
      this.config.decay
    ));
  }

  /** Decay scheduler for automatic decay operations */
  get decayScheduler(): DecayScheduler {
    if (!this._decayScheduler) {
      this._decayScheduler = new DecayScheduler(
        this.decayEngine,
        this.config.decayScheduler ?? { decayIntervalMs: 3600000 }
      );
    }
    return this._decayScheduler;
  }

  /** Working memory manager for short-term memory */
  get workingMemory(): WorkingMemoryManager {
    return (this._workingMemory ??= new WorkingMemoryManager(
      this.storage,
      this.config.workingMemory
    ));
  }

  /** Episodic memory manager for experience tracking */
  get episodicMemory(): EpisodicMemoryManager {
    return (this._episodicMemory ??= new EpisodicMemoryManager(
      this.storage,
      this.config.episodic
    ));
  }

  /** Session manager for session lifecycle */
  get sessionManager(): SessionManager {
    return (this._sessionManager ??= new SessionManager(
      this.storage,
      this.workingMemory,
      this.config.session,
      this.episodicMemory
    ));
  }

  /** Consolidation pipeline for memory promotion */
  get consolidationPipeline(): ConsolidationPipeline {
    return (this._consolidationPipeline ??= new ConsolidationPipeline(
      this.storage,
      this.workingMemory,
      this.decayEngine,
      this.config.consolidation
    ));
  }

  /** Summarization service for memory grouping */
  get summarizationService(): SummarizationService {
    return (this._summarizationService ??= new SummarizationService(this.config.summarization));
  }

  /** Pattern detector for observation patterns */
  get patternDetector(): PatternDetector {
    return (this._patternDetector ??= new PatternDetector());
  }

  /** Rule evaluator for promotion rules */
  get ruleEvaluator(): RuleEvaluator {
    return (this._ruleEvaluator ??= new RuleEvaluator());
  }

  /** Salience engine for relevance scoring */
  get salienceEngine(): SalienceEngine {
    return (this._salienceEngine ??= new SalienceEngine(
      this.storage,
      this.accessTracker,
      this.decayEngine,
      this.config.salience
    ));
  }

  /** Context window manager for token-budgeted retrieval */
  get contextWindowManager(): ContextWindowManager {
    return (this._contextWindowManager ??= new ContextWindowManager(
      this.storage,
      this.salienceEngine,
      this.config.contextWindow
    ));
  }

  /** Memory formatter for LLM consumption */
  get memoryFormatter(): MemoryFormatter {
    return (this._memoryFormatter ??= new MemoryFormatter(this.config.formatter));
  }

  /** Multi-agent memory manager */
  get multiAgentManager(): MultiAgentMemoryManager {
    return (this._multiAgentManager ??= new MultiAgentMemoryManager(
      this.storage,
      this.config.multiAgent
    ));
  }

  /** Conflict resolver for memory conflicts */
  get conflictResolver(): ConflictResolver {
    return (this._conflictResolver ??= new ConflictResolver(this.config.conflictResolver));
  }

  // ==================== Session Lifecycle ====================

  /**
   * Start a new agent session.
   *
   * @param options - Session options
   * @returns Created session entity
   */
  async startSession(options: StartSessionOptions = {}): Promise<SessionEntity> {
    const session = await this.sessionManager.startSession(options);
    this.emit('session:started', { sessionId: session.name });
    return session;
  }

  /**
   * End an agent session.
   *
   * @param sessionId - Session to end
   * @param status - Session end status ('completed' or 'abandoned')
   * @returns End session result
   */
  async endSession(
    sessionId: string,
    status: 'completed' | 'abandoned' = 'completed'
  ): Promise<EndSessionResult> {
    const result = await this.sessionManager.endSession(sessionId, status);
    this.emit('session:ended', { sessionId, result });
    return result;
  }

  /**
   * Get the current active session or undefined.
   */
  async getActiveSession(): Promise<SessionEntity | undefined> {
    return this.sessionManager.getActiveSession();
  }

  // ==================== Working Memory Operations ====================

  /**
   * Add a new working memory entry.
   *
   * @param options - Memory creation options
   * @returns Created memory entity
   */
  async addWorkingMemory(options: CreateMemoryOptions): Promise<AgentEntity> {
    const memory = await this.workingMemory.createWorkingMemory(
      options.sessionId,
      options.content,
      {
        importance: options.importance,
        taskId: options.taskId,
        ttlHours: options.ttlHours,
      }
    );

    // Apply agent/visibility if multi-agent enabled
    if (this.config.enableMultiAgent && options.agentId) {
      const graph = await this.storage.getGraphForMutation();
      const entity = graph.entities.find((e) => e.name === memory.name) as AgentEntity | undefined;
      if (entity) {
        entity.agentId = options.agentId;
        entity.visibility = options.visibility ?? 'private';
        await this.storage.saveGraph(graph);
      }
    }

    this.emit('memory:created', { memoryId: memory.name, sessionId: options.sessionId });
    return memory;
  }

  /**
   * Get working memories for a session.
   *
   * @param sessionId - Session to query
   * @param filter - Optional filter criteria
   */
  async getSessionMemories(
    sessionId: string,
    filter?: { entityType?: string; taskId?: string; minImportance?: number }
  ): Promise<AgentEntity[]> {
    return this.workingMemory.getSessionMemories(sessionId, filter);
  }

  /**
   * Clear expired working memories.
   *
   * @returns Number of memories cleared
   */
  async clearExpiredMemories(): Promise<number> {
    const count = await this.workingMemory.clearExpired();
    if (count > 0) {
      this.emit('memory:expired', { count });
    }
    return count;
  }

  /**
   * Confirm a memory to strengthen it.
   *
   * @param memoryName - Memory to confirm
   * @param confidenceBoost - Optional confidence increase
   */
  async confirmMemory(memoryName: string, confidenceBoost?: number): Promise<ConfirmationResult> {
    return this.workingMemory.confirmMemory(memoryName, confidenceBoost);
  }

  /**
   * Promote a working memory to long-term storage.
   *
   * @param memoryName - Memory to promote
   * @param targetType - Target memory type (episodic or semantic)
   */
  async promoteMemory(
    memoryName: string,
    targetType: 'episodic' | 'semantic' = 'episodic'
  ): Promise<PromotionResult> {
    return this.workingMemory.promoteMemory(memoryName, targetType);
  }

  // ==================== Episodic Memory Operations ====================

  /**
   * Create an episodic memory (experience/event).
   *
   * @param content - Episode content/description
   * @param options - Episode creation options
   */
  async createEpisode(content: string, options?: CreateEpisodeOptions): Promise<AgentEntity> {
    return this.episodicMemory.createEpisode(content, options);
  }

  /**
   * Get timeline of episodes for a session.
   *
   * @param sessionId - Session to get timeline for
   * @param options - Timeline query options
   */
  async getTimeline(sessionId: string, options?: TimelineOptions): Promise<AgentEntity[]> {
    return this.episodicMemory.getTimeline(sessionId, options);
  }

  // ==================== Memory Consolidation ====================

  /**
   * Run consolidation for a session.
   *
   * @param sessionId - Session to consolidate
   * @returns Consolidation result
   */
  async consolidateSession(sessionId: string): Promise<ConsolidationResult> {
    const result = await this.consolidationPipeline.consolidateSession(sessionId);
    this.emit('consolidation:complete', { sessionId, result });
    return result;
  }

  // ==================== Context Retrieval ====================

  /**
   * Retrieve memories formatted for LLM context.
   *
   * @param options - Retrieval options
   * @returns Context package with formatted memories
   */
  async retrieveForContext(options: RetrieveContextOptions = {}): Promise<ContextPackage> {
    const retrievalOptions: ContextRetrievalOptions = {
      maxTokens: options.maxTokens ?? 4000,
      context: {
        currentSession: options.sessionId,
        currentTask: options.taskId,
        queryText: options.keywords?.join(' '),
      },
      includeWorkingMemory: options.includeWorkingMemory,
      includeEpisodicRecent: options.includeEpisodicRecent,
      includeSemanticRelevant: options.includeSemanticRelevant,
      mustInclude: options.mustInclude,
    };

    return this.contextWindowManager.retrieveForContext(retrievalOptions);
  }

  /**
   * Format memories for LLM prompt.
   *
   * @param memories - Memories to format
   * @param options - Format options
   */
  formatForPrompt(
    memories: AgentEntity[],
    options?: { maxTokens?: number; header?: string; separator?: string }
  ): string {
    return this.memoryFormatter.formatForPrompt(memories, options ?? {});
  }

  /**
   * Record memory access for tracking.
   *
   * @param memoryName - Memory accessed
   * @param context - Access context
   */
  recordAccess(memoryName: string, context: AccessContext): void {
    this.accessTracker.recordAccess(memoryName, context);
  }

  // ==================== Decay Operations ====================

  /**
   * Get memories that have decayed below threshold.
   *
   * @param threshold - Effective importance threshold
   */
  async getDecayedMemories(threshold: number = 0.1): Promise<AgentEntity[]> {
    return this.decayEngine.getDecayedMemories(threshold) as Promise<AgentEntity[]>;
  }

  /**
   * Forget weak memories (delete or archive).
   *
   * @param options - Forget options
   */
  async forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult> {
    const result = await this.decayEngine.forgetWeakMemories(options);
    if (result.memoriesForgotten > 0) {
      this.emit('memory:forgotten', result);
    }
    return result;
  }

  /**
   * Reinforce a memory against decay.
   *
   * @param memoryName - Memory to reinforce
   * @param options - Reinforcement options
   */
  async reinforceMemory(
    memoryName: string,
    options?: { confirmationBoost?: number; confidenceBoost?: number }
  ): Promise<void> {
    await this.decayEngine.reinforceMemory(memoryName, options);
  }

  /**
   * Manually run a decay cycle.
   */
  async runDecayCycle(): Promise<DecayCycleResult> {
    return this.decayScheduler.runNow();
  }

  // ==================== Multi-Agent Operations ====================

  /**
   * Register an agent for multi-agent memory management.
   *
   * @param agentId - Unique agent identifier
   * @param metadata - Agent metadata
   */
  registerAgent(agentId: string, metadata: Omit<AgentMetadata, 'createdAt' | 'lastActiveAt'>): void {
    this.multiAgentManager.registerAgent(agentId, metadata);
    this.emit('agent:registered', { agentId });
  }

  /**
   * Get memories visible to specific agents.
   *
   * @param agentIds - Agents to check visibility for
   */
  async getSharedMemories(agentIds: string[]): Promise<AgentEntity[]> {
    return this.multiAgentManager.getSharedMemories(agentIds);
  }

  /**
   * Search memories across agents with trust weighting.
   *
   * @param requestingAgentId - Agent making the request
   * @param query - Search query
   * @param options - Search options
   */
  async searchCrossAgent(
    requestingAgentId: string,
    query: string,
    options?: { agentIds?: string[]; useTrustWeighting?: boolean; trustWeight?: number; entityType?: string }
  ): Promise<Array<{ memory: AgentEntity; relevanceScore: number; trustScore: number; combinedScore: number }>> {
    return this.multiAgentManager.searchCrossAgent(requestingAgentId, query, options);
  }

  /**
   * Copy a shared memory to another agent.
   *
   * @param sourceMemoryName - Memory to copy
   * @param targetAgentId - Target agent
   */
  async copyMemory(sourceMemoryName: string, targetAgentId: string): Promise<AgentEntity | null> {
    return this.multiAgentManager.copyMemory(sourceMemoryName, targetAgentId);
  }

  /**
   * Detect conflicts between agent memories.
   *
   * @param memories - Memories to check
   */
  async detectConflicts(memories: AgentEntity[]): Promise<ConflictInfo[]> {
    return this.multiAgentManager.detectConflicts(memories);
  }

  /**
   * Resolve a memory conflict using specified strategy.
   *
   * @param conflict - Conflict to resolve
   * @param strategy - Resolution strategy
   */
  async resolveConflict(
    conflict: ConflictInfo,
    strategy?: ConflictStrategy
  ): Promise<ResolutionResult> {
    const graph = await this.storage.loadGraph();
    const memories = graph.entities.filter((e): e is AgentEntity =>
      [conflict.primaryMemory, ...conflict.conflictingMemories].includes(e.name)
    );
    // Get agents map - use getAgent for each unique agentId in memories
    const agentIds = new Set(memories.map((m) => m.agentId).filter((id): id is string => !!id));
    const agents = new Map<string, AgentMetadata>();
    for (const id of agentIds) {
      const agent = this.multiAgentManager.getAgent(id);
      if (agent) {
        agents.set(id, agent);
      }
    }
    return this.conflictResolver.resolveConflict(conflict, memories, agents, strategy);
  }

  /**
   * Merge memories from multiple agents.
   *
   * @param memoryNames - Memories to merge
   * @param targetAgentId - Target agent for merged memory
   * @param options - Merge options
   */
  async mergeCrossAgent(
    memoryNames: string[],
    targetAgentId: string,
    options?: { resolveConflicts?: boolean; conflictStrategy?: ConflictStrategy }
  ): Promise<AgentEntity | null> {
    return this.multiAgentManager.mergeCrossAgent(memoryNames, targetAgentId, options);
  }

  // ==================== Configuration ====================

  /**
   * Set summarization provider for consolidation.
   *
   * @param provider - Provider implementation
   */
  setSummarizationProvider(provider: ISummarizationProvider): void {
    this.summarizationService.registerProvider(provider);
  }

  /**
   * Get the current configuration.
   */
  getConfig(): AgentMemoryConfig {
    return { ...this.config };
  }

  // ==================== Lifecycle ====================

  /**
   * Stop all background operations (decay scheduler).
   */
  stop(): void {
    if (this._decayScheduler) {
      this._decayScheduler.stop();
    }
    this.emit('manager:stopped');
  }
}
