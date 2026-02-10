/**
 * Agent Memory Manager - Unified Facade
 *
 * High-level API for AI agent memory management, wrapping all agent memory
 * components into a cohesive interface. Component managers are accessible
 * directly via public getters for advanced use cases.
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

export interface CreateMemoryOptions {
  sessionId: string;
  content: string;
  importance?: number;
  taskId?: string;
  ttlHours?: number;
  agentId?: string;
  visibility?: MemoryVisibility;
}

export interface RetrieveContextOptions {
  sessionId?: string;
  taskId?: string;
  keywords?: string[];
  maxTokens?: number;
  includeWorkingMemory?: boolean;
  includeEpisodicRecent?: boolean;
  includeSemanticRelevant?: boolean;
  mustInclude?: string[];
}

/**
 * Unified API for agent memory operations.
 * Component managers are accessible directly via public getters.
 */
export class AgentMemoryManager extends EventEmitter {
  private readonly storage: IGraphStorage;
  private readonly config: AgentMemoryConfig;

  // Lazy-initialized components
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
    const envConfig = loadConfigFromEnv();
    this.config = mergeConfig(config, envConfig);
    validateConfig(this.config);

    if (this.config.enableAutoDecay && this.config.decayScheduler) {
      this.decayScheduler.start();
    }
  }

  // ==================== Component Accessors ====================

  get accessTracker(): AccessTracker {
    return (this._accessTracker ??= new AccessTracker(this.storage));
  }

  get decayEngine(): DecayEngine {
    return (this._decayEngine ??= new DecayEngine(this.storage, this.accessTracker, this.config.decay));
  }

  get decayScheduler(): DecayScheduler {
    return (this._decayScheduler ??= new DecayScheduler(
      this.decayEngine,
      this.config.decayScheduler ?? { decayIntervalMs: 3600000 }
    ));
  }

  get workingMemory(): WorkingMemoryManager {
    return (this._workingMemory ??= new WorkingMemoryManager(this.storage, this.config.workingMemory));
  }

  get episodicMemory(): EpisodicMemoryManager {
    return (this._episodicMemory ??= new EpisodicMemoryManager(this.storage, this.config.episodic));
  }

  get sessionManager(): SessionManager {
    return (this._sessionManager ??= new SessionManager(
      this.storage, this.workingMemory, this.config.session, this.episodicMemory
    ));
  }

  get consolidationPipeline(): ConsolidationPipeline {
    return (this._consolidationPipeline ??= new ConsolidationPipeline(
      this.storage, this.workingMemory, this.decayEngine, this.config.consolidation
    ));
  }

  get summarizationService(): SummarizationService {
    return (this._summarizationService ??= new SummarizationService(this.config.summarization));
  }

  get patternDetector(): PatternDetector {
    return (this._patternDetector ??= new PatternDetector());
  }

  get ruleEvaluator(): RuleEvaluator {
    return (this._ruleEvaluator ??= new RuleEvaluator());
  }

  get salienceEngine(): SalienceEngine {
    return (this._salienceEngine ??= new SalienceEngine(
      this.storage, this.accessTracker, this.decayEngine, this.config.salience
    ));
  }

  get contextWindowManager(): ContextWindowManager {
    return (this._contextWindowManager ??= new ContextWindowManager(
      this.storage, this.salienceEngine, this.config.contextWindow
    ));
  }

  get memoryFormatter(): MemoryFormatter {
    return (this._memoryFormatter ??= new MemoryFormatter(this.config.formatter));
  }

  get multiAgentManager(): MultiAgentMemoryManager {
    return (this._multiAgentManager ??= new MultiAgentMemoryManager(this.storage, this.config.multiAgent));
  }

  get conflictResolver(): ConflictResolver {
    return (this._conflictResolver ??= new ConflictResolver(this.config.conflictResolver));
  }

  // ==================== Session Lifecycle ====================

  async startSession(options: StartSessionOptions = {}): Promise<SessionEntity> {
    const session = await this.sessionManager.startSession(options);
    this.emit('session:started', { sessionId: session.name });
    return session;
  }

  async endSession(sessionId: string, status: 'completed' | 'abandoned' = 'completed'): Promise<EndSessionResult> {
    const result = await this.sessionManager.endSession(sessionId, status);
    this.emit('session:ended', { sessionId, result });
    return result;
  }

  async getActiveSession(): Promise<SessionEntity | undefined> {
    return this.sessionManager.getActiveSession();
  }

  // ==================== Working Memory ====================

  async addWorkingMemory(options: CreateMemoryOptions): Promise<AgentEntity> {
    const memory = await this.workingMemory.createWorkingMemory(
      options.sessionId, options.content,
      { importance: options.importance, taskId: options.taskId, ttlHours: options.ttlHours }
    );

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

  async getSessionMemories(
    sessionId: string,
    filter?: { entityType?: string; taskId?: string; minImportance?: number }
  ): Promise<AgentEntity[]> {
    return this.workingMemory.getSessionMemories(sessionId, filter);
  }

  async clearExpiredMemories(): Promise<number> {
    const count = await this.workingMemory.clearExpired();
    if (count > 0) this.emit('memory:expired', { count });
    return count;
  }

  async confirmMemory(memoryName: string, confidenceBoost?: number): Promise<ConfirmationResult> {
    return this.workingMemory.confirmMemory(memoryName, confidenceBoost);
  }

  async promoteMemory(memoryName: string, targetType: 'episodic' | 'semantic' = 'episodic'): Promise<PromotionResult> {
    return this.workingMemory.promoteMemory(memoryName, targetType);
  }

  // ==================== Episodic Memory ====================

  async createEpisode(content: string, options?: CreateEpisodeOptions): Promise<AgentEntity> {
    return this.episodicMemory.createEpisode(content, options);
  }

  async getTimeline(sessionId: string, options?: TimelineOptions): Promise<AgentEntity[]> {
    return this.episodicMemory.getTimeline(sessionId, options);
  }

  // ==================== Consolidation ====================

  async consolidateSession(sessionId: string): Promise<ConsolidationResult> {
    const result = await this.consolidationPipeline.consolidateSession(sessionId);
    this.emit('consolidation:complete', { sessionId, result });
    return result;
  }

  // ==================== Context Retrieval ====================

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

  formatForPrompt(
    memories: AgentEntity[],
    options?: { maxTokens?: number; header?: string; separator?: string }
  ): string {
    return this.memoryFormatter.formatForPrompt(memories, options ?? {});
  }

  recordAccess(memoryName: string, context: AccessContext): void {
    this.accessTracker.recordAccess(memoryName, context);
  }

  // ==================== Decay ====================

  async getDecayedMemories(threshold: number = 0.1): Promise<AgentEntity[]> {
    return this.decayEngine.getDecayedMemories(threshold) as Promise<AgentEntity[]>;
  }

  async forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult> {
    const result = await this.decayEngine.forgetWeakMemories(options);
    if (result.memoriesForgotten > 0) this.emit('memory:forgotten', result);
    return result;
  }

  async reinforceMemory(
    memoryName: string,
    options?: { confirmationBoost?: number; confidenceBoost?: number }
  ): Promise<void> {
    await this.decayEngine.reinforceMemory(memoryName, options);
  }

  async runDecayCycle(): Promise<DecayCycleResult> {
    return this.decayScheduler.runNow();
  }

  // ==================== Multi-Agent ====================

  registerAgent(agentId: string, metadata: Omit<AgentMetadata, 'createdAt' | 'lastActiveAt'>): void {
    this.multiAgentManager.registerAgent(agentId, metadata);
    this.emit('agent:registered', { agentId });
  }

  async getSharedMemories(agentIds: string[]): Promise<AgentEntity[]> {
    return this.multiAgentManager.getSharedMemories(agentIds);
  }

  async searchCrossAgent(
    requestingAgentId: string,
    query: string,
    options?: { agentIds?: string[]; useTrustWeighting?: boolean; trustWeight?: number; entityType?: string }
  ): Promise<Array<{ memory: AgentEntity; relevanceScore: number; trustScore: number; combinedScore: number }>> {
    return this.multiAgentManager.searchCrossAgent(requestingAgentId, query, options);
  }

  async copyMemory(sourceMemoryName: string, targetAgentId: string): Promise<AgentEntity | null> {
    return this.multiAgentManager.copyMemory(sourceMemoryName, targetAgentId);
  }

  async detectConflicts(memories: AgentEntity[]): Promise<ConflictInfo[]> {
    return this.multiAgentManager.detectConflicts(memories);
  }

  async resolveConflict(conflict: ConflictInfo, strategy?: ConflictStrategy): Promise<ResolutionResult> {
    const graph = await this.storage.loadGraph();
    const memories = graph.entities.filter((e): e is AgentEntity =>
      [conflict.primaryMemory, ...conflict.conflictingMemories].includes(e.name)
    );
    const agentIds = new Set(memories.map((m) => m.agentId).filter((id): id is string => !!id));
    const agents = new Map<string, AgentMetadata>();
    for (const id of agentIds) {
      const agent = this.multiAgentManager.getAgent(id);
      if (agent) agents.set(id, agent);
    }
    return this.conflictResolver.resolveConflict(conflict, memories, agents, strategy);
  }

  async mergeCrossAgent(
    memoryNames: string[],
    targetAgentId: string,
    options?: { resolveConflicts?: boolean; conflictStrategy?: ConflictStrategy }
  ): Promise<AgentEntity | null> {
    return this.multiAgentManager.mergeCrossAgent(memoryNames, targetAgentId, options);
  }

  // ==================== Configuration & Lifecycle ====================

  setSummarizationProvider(provider: ISummarizationProvider): void {
    this.summarizationService.registerProvider(provider);
  }

  getConfig(): AgentMemoryConfig {
    return { ...this.config };
  }

  stop(): void {
    if (this._decayScheduler) this._decayScheduler.stop();
    this.emit('manager:stopped');
  }
}
