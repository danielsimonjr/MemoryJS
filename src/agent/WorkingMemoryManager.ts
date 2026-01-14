/**
 * Working Memory Manager
 *
 * Manages short-term, session-scoped memories with TTL-based expiration.
 * Working memories are temporary and automatically cleaned up after expiry.
 *
 * @module agent/WorkingMemoryManager
 */

import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  AgentEntity,
  WorkingMemoryOptions,
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';

/**
 * Configuration for WorkingMemoryManager.
 */
export interface WorkingMemoryConfig {
  /** Default TTL in hours (default: 24) */
  defaultTTLHours?: number;
  /** Maximum memories per session (default: 100) */
  maxPerSession?: number;
  /** Auto-promote memories meeting threshold (default: false) */
  autoPromote?: boolean;
  /** Confidence threshold for auto-promotion (default: 0.8) */
  autoPromoteConfidenceThreshold?: number;
  /** Confirmation threshold for auto-promotion (default: 2) */
  autoPromoteConfirmationThreshold?: number;
}

/**
 * Filter options for session memory queries.
 */
export interface SessionMemoryFilter {
  /** Filter by entity type */
  entityType?: string;
  /** Filter by task ID */
  taskId?: string;
  /** Minimum importance */
  minImportance?: number;
  /** Maximum importance */
  maxImportance?: number;
  /** Include only non-expired */
  excludeExpired?: boolean;
}

/**
 * Options for marking memory for promotion.
 */
export interface PromotionMarkOptions {
  /** Target memory type after promotion */
  targetType?: 'episodic' | 'semantic';
  /** Priority for promotion (higher = promoted sooner) */
  priority?: number;
  /** Reason for marking */
  reason?: string;
}

/**
 * Criteria for identifying promotion candidates.
 */
export interface PromotionCriteria {
  /** Include explicitly marked memories (default: true) */
  includeMarked?: boolean;
  /** Minimum confidence for auto-promotion */
  minConfidence?: number;
  /** Minimum confirmations for auto-promotion */
  minConfirmations?: number;
  /** Minimum access count */
  minAccessCount?: number;
}

/**
 * Result of a promotion operation.
 */
export interface PromotionResult {
  /** Name of promoted entity */
  entityName: string;
  /** Previous memory type */
  fromType: 'working';
  /** New memory type */
  toType: 'episodic' | 'semantic';
  /** Timestamp of promotion */
  promotedAt: string;
}

/**
 * Result of a confirmation operation.
 */
export interface ConfirmationResult {
  /** Whether the confirmation was recorded */
  confirmed: boolean;
  /** Whether the memory was auto-promoted */
  promoted: boolean;
}

/**
 * Manages session-scoped working memories with TTL expiration.
 *
 * Working memories are short-term, temporary memories tied to a specific
 * session. They automatically expire after a configurable TTL period.
 * This is the primary interface for creating and managing temporary
 * memories during active conversations.
 *
 * Key features:
 * - Session-scoped memory isolation
 * - Configurable TTL (default 24 hours)
 * - Max memories per session limit
 * - Efficient session index for O(1) lookups
 * - Automatic expiration cleanup
 *
 * @example
 * ```typescript
 * const wmm = new WorkingMemoryManager(storage);
 *
 * // Create a working memory
 * const memory = await wmm.createWorkingMemory(
 *   'session_123',
 *   'User prefers budget hotels under $100/night'
 * );
 *
 * // Get all memories for session
 * const memories = await wmm.getSessionMemories('session_123');
 *
 * // Extend TTL for important memories
 * await wmm.extendTTL([memory.name], 48);
 *
 * // Clean up expired memories
 * const cleared = await wmm.clearExpired();
 * ```
 */
export class WorkingMemoryManager {
  private readonly storage: IGraphStorage;
  private readonly config: Required<WorkingMemoryConfig>;

  // Index: sessionId -> Set of entity names
  private sessionIndex: Map<string, Set<string>>;

  constructor(storage: IGraphStorage, config: WorkingMemoryConfig = {}) {
    this.storage = storage;
    this.config = {
      defaultTTLHours: config.defaultTTLHours ?? 24,
      maxPerSession: config.maxPerSession ?? 100,
      autoPromote: config.autoPromote ?? false,
      autoPromoteConfidenceThreshold: config.autoPromoteConfidenceThreshold ?? 0.8,
      autoPromoteConfirmationThreshold: config.autoPromoteConfirmationThreshold ?? 2,
    };
    this.sessionIndex = new Map();
  }

  // ==================== Memory Creation ====================

  /**
   * Generate a unique name for a working memory.
   * @internal
   */
  private generateMemoryName(sessionId: string, content: string): string {
    const timestamp = Date.now();
    const contentHash = this.hashContent(content).slice(0, 8);
    return `wm_${sessionId}_${timestamp}_${contentHash}`;
  }

  /**
   * Simple hash function for content uniqueness.
   * @internal
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Calculate expiration timestamp.
   * @internal
   */
  private calculateExpiration(ttlHours: number): string {
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + ttlHours * 60 * 60 * 1000);
    return expiresAt.toISOString();
  }

  /**
   * Create a new working memory for a session.
   *
   * Creates an AgentEntity with memoryType='working' that will automatically
   * expire after the TTL period. The memory is associated with the given
   * session and tracked in the session index for efficient retrieval.
   *
   * @param sessionId - Session identifier to associate memory with
   * @param content - The memory content (stored as first observation)
   * @param options - Optional configuration for this memory
   * @returns The created AgentEntity
   * @throws Error if session has reached max memory limit
   *
   * @example
   * ```typescript
   * const memory = await wmm.createWorkingMemory(
   *   'session_123',
   *   'User mentioned they have a budget of $500',
   *   {
   *     ttlHours: 48,
   *     importance: 7,
   *     taskId: 'trip_planning',
   *   }
   * );
   * ```
   */
  async createWorkingMemory(
    sessionId: string,
    content: string,
    options?: WorkingMemoryOptions
  ): Promise<AgentEntity> {
    // Check session limit
    const sessionMemories = this.sessionIndex.get(sessionId);
    if (sessionMemories && sessionMemories.size >= this.config.maxPerSession) {
      throw new Error(
        `Session ${sessionId} has reached maximum memory limit (${this.config.maxPerSession})`
      );
    }

    const now = new Date().toISOString();
    const ttlHours = options?.ttlHours ?? this.config.defaultTTLHours;
    const name = this.generateMemoryName(sessionId, content);

    const entity: AgentEntity = {
      // Base Entity fields
      name,
      entityType: options?.entityType ?? 'working_memory',
      observations: [content],
      createdAt: now,
      lastModified: now,
      importance: options?.importance ?? 5,

      // AgentEntity fields
      memoryType: 'working',
      sessionId,
      taskId: options?.taskId,
      expiresAt: this.calculateExpiration(ttlHours),
      isWorkingMemory: true,
      accessCount: 0,
      lastAccessedAt: now,
      confidence: options?.confidence ?? 0.5,
      confirmationCount: 0,
      visibility: options?.visibility ?? 'private',
      agentId: options?.agentId,
    };

    // Persist to storage
    await this.storage.appendEntity(entity as Entity);

    // Update session index
    if (!this.sessionIndex.has(sessionId)) {
      this.sessionIndex.set(sessionId, new Set());
    }
    this.sessionIndex.get(sessionId)!.add(name);

    return entity;
  }

  // ==================== Memory Retrieval ====================

  /**
   * Rebuild session index from storage for a specific session.
   * @internal
   */
  private async rebuildSessionIndex(sessionId: string): Promise<void> {
    const graph = await this.storage.loadGraph();
    const sessionMemories = new Set<string>();

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity;

      if (
        agentEntity.sessionId === sessionId &&
        agentEntity.memoryType === 'working'
      ) {
        sessionMemories.add(agentEntity.name);
      }
    }

    if (sessionMemories.size > 0) {
      this.sessionIndex.set(sessionId, sessionMemories);
    }
  }

  /**
   * Get all working memories for a session.
   *
   * Returns working memories associated with the given session,
   * optionally filtered by various criteria. Uses an in-memory
   * index for efficient lookups.
   *
   * @param sessionId - Session identifier
   * @param filter - Optional filtering criteria
   * @returns Array of AgentEntity matching the criteria
   *
   * @example
   * ```typescript
   * // Get all memories for session
   * const all = await wmm.getSessionMemories('session_123');
   *
   * // Get only task-specific memories
   * const taskMemories = await wmm.getSessionMemories('session_123', {
   *   taskId: 'trip_planning',
   *   excludeExpired: true,
   * });
   *
   * // Get high-importance memories
   * const important = await wmm.getSessionMemories('session_123', {
   *   minImportance: 7,
   * });
   * ```
   */
  async getSessionMemories(
    sessionId: string,
    filter?: SessionMemoryFilter
  ): Promise<AgentEntity[]> {
    let memoryNames = this.sessionIndex.get(sessionId);

    if (!memoryNames || memoryNames.size === 0) {
      // Try to rebuild index from storage
      await this.rebuildSessionIndex(sessionId);
      memoryNames = this.sessionIndex.get(sessionId);
      if (!memoryNames || memoryNames.size === 0) {
        return [];
      }
    }

    const now = Date.now();
    const memories: AgentEntity[] = [];

    for (const name of memoryNames) {
      const entity = this.storage.getEntityByName(name);
      if (!entity || !isAgentEntity(entity)) continue;

      const agentEntity = entity;

      // Apply filters
      if (filter?.entityType && agentEntity.entityType !== filter.entityType) {
        continue;
      }
      if (filter?.taskId && agentEntity.taskId !== filter.taskId) {
        continue;
      }
      if (
        filter?.minImportance !== undefined &&
        (agentEntity.importance ?? 0) < filter.minImportance
      ) {
        continue;
      }
      if (
        filter?.maxImportance !== undefined &&
        (agentEntity.importance ?? 10) > filter.maxImportance
      ) {
        continue;
      }
      if (filter?.excludeExpired && agentEntity.expiresAt) {
        const expiresAt = new Date(agentEntity.expiresAt).getTime();
        if (expiresAt < now) continue;
      }

      memories.push(agentEntity);
    }

    return memories;
  }

  // ==================== Expiration Management ====================

  /**
   * Clear all expired working memories.
   *
   * Scans all working memories and removes those where expiresAt < now.
   * Also removes any relations involving the expired entities.
   *
   * @returns Number of memories cleared
   *
   * @example
   * ```typescript
   * // Clear expired memories periodically
   * const cleared = await wmm.clearExpired();
   * console.log(`Cleared ${cleared} expired memories`);
   * ```
   */
  async clearExpired(): Promise<number> {
    const now = Date.now();
    const graph = await this.storage.loadGraph();
    const expiredNames: string[] = [];

    // Find expired working memories
    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity;

      if (agentEntity.memoryType !== 'working') continue;
      if (!agentEntity.expiresAt) continue;

      const expiresAt = new Date(agentEntity.expiresAt).getTime();
      if (expiresAt < now) {
        expiredNames.push(agentEntity.name);
      }
    }

    if (expiredNames.length === 0) {
      return 0;
    }

    // Remove expired entities
    const expiredSet = new Set(expiredNames);
    const updatedEntities = graph.entities.filter((e) => !expiredSet.has(e.name));

    // Remove relations involving expired entities
    const updatedRelations = graph.relations.filter(
      (r) => !expiredSet.has(r.from) && !expiredSet.has(r.to)
    );

    // Persist changes
    await this.storage.saveGraph({
      entities: updatedEntities,
      relations: updatedRelations,
    });

    // Update session index
    for (const [_sessionId, names] of this.sessionIndex) {
      for (const name of expiredNames) {
        names.delete(name);
      }
    }

    return expiredNames.length;
  }

  // ==================== TTL Management ====================

  /**
   * Extend TTL for specified working memories.
   *
   * Adds additional time to the expiration of the specified memories.
   * If a memory has already expired, its TTL is extended from the
   * current time.
   *
   * @param entityNames - Names of entities to extend
   * @param additionalHours - Hours to add to TTL
   * @throws Error if any entity doesn't exist or isn't working memory
   *
   * @example
   * ```typescript
   * // Extend important memories by 48 hours
   * await wmm.extendTTL(['wm_session_123_abc123'], 48);
   * ```
   */
  async extendTTL(entityNames: string[], additionalHours: number): Promise<void> {
    if (additionalHours <= 0) {
      throw new Error('additionalHours must be positive');
    }

    for (const name of entityNames) {
      const entity = this.storage.getEntityByName(name);
      if (!entity) {
        throw new Error(`Entity not found: ${name}`);
      }

      if (!isAgentEntity(entity)) {
        throw new Error(`Entity is not an AgentEntity: ${name}`);
      }

      const agentEntity = entity;
      if (agentEntity.memoryType !== 'working') {
        throw new Error(`Entity is not working memory: ${name}`);
      }

      // Calculate new expiration
      let currentExpires: Date;
      if (agentEntity.expiresAt) {
        currentExpires = new Date(agentEntity.expiresAt);
        // If already expired, start from now
        if (currentExpires.getTime() < Date.now()) {
          currentExpires = new Date();
        }
      } else {
        currentExpires = new Date();
      }

      const newExpires = new Date(
        currentExpires.getTime() + additionalHours * 60 * 60 * 1000
      );

      await this.storage.updateEntity(name, {
        expiresAt: newExpires.toISOString(),
        lastModified: new Date().toISOString(),
      } as Record<string, unknown>);
    }
  }

  // ==================== Promotion Support ====================

  /**
   * Mark a memory for promotion consideration.
   *
   * Sets the markedForPromotion flag to true, indicating this memory
   * should be considered for promotion to long-term storage.
   *
   * @param entityName - Name of the entity to mark
   * @param options - Optional promotion options
   * @throws Error if entity doesn't exist or isn't working memory
   *
   * @example
   * ```typescript
   * // Mark for promotion to semantic memory
   * await wmm.markForPromotion('wm_session_1_abc', {
   *   targetType: 'semantic',
   *   reason: 'User confirmed this preference multiple times'
   * });
   * ```
   */
  async markForPromotion(
    entityName: string,
    options?: PromotionMarkOptions
  ): Promise<void> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    if (!isAgentEntity(entity)) {
      throw new Error(`Entity is not an AgentEntity: ${entityName}`);
    }

    const agentEntity = entity;
    if (agentEntity.memoryType !== 'working') {
      throw new Error(`Entity is not working memory: ${entityName}`);
    }

    const updates: Record<string, unknown> = {
      markedForPromotion: true,
      lastModified: new Date().toISOString(),
    };

    // Store target type via tag convention
    if (options?.targetType) {
      const currentTags = agentEntity.tags ?? [];
      const targetTag = `promote_to_${options.targetType}`;
      if (!currentTags.includes(targetTag)) {
        updates.tags = [...currentTags, targetTag];
      }
    }

    await this.storage.updateEntity(entityName, updates);
  }

  /**
   * Get memories that are candidates for promotion.
   *
   * Returns working memories for the session that either:
   * - Are marked for promotion, or
   * - Meet auto-promotion thresholds (if autoPromote is enabled)
   *
   * Candidates are sorted by priority (higher = promoted sooner).
   *
   * @param sessionId - Session identifier
   * @param criteria - Optional criteria override
   * @returns Array of promotion candidate AgentEntities sorted by priority
   *
   * @example
   * ```typescript
   * // Get candidates using default thresholds
   * const candidates = await wmm.getPromotionCandidates('session_1');
   *
   * // Get candidates with custom criteria
   * const highConfidence = await wmm.getPromotionCandidates('session_1', {
   *   minConfidence: 0.9,
   *   minConfirmations: 3,
   * });
   * ```
   */
  async getPromotionCandidates(
    sessionId: string,
    criteria?: PromotionCriteria
  ): Promise<AgentEntity[]> {
    const effectiveCriteria = {
      includeMarked: criteria?.includeMarked ?? true,
      minConfidence:
        criteria?.minConfidence ?? this.config.autoPromoteConfidenceThreshold,
      minConfirmations:
        criteria?.minConfirmations ?? this.config.autoPromoteConfirmationThreshold,
      minAccessCount: criteria?.minAccessCount ?? 0,
    };

    const memories = await this.getSessionMemories(sessionId);
    const candidates: Array<{ entity: AgentEntity; priority: number }> = [];

    for (const memory of memories) {
      let isCandidate = false;
      let priority = 0;

      // Check if explicitly marked
      if (effectiveCriteria.includeMarked && memory.markedForPromotion) {
        isCandidate = true;
        priority += 100; // High priority for marked
      }

      // Check threshold criteria (only if autoPromote enabled or explicitly checking)
      const meetsConfidence = memory.confidence >= effectiveCriteria.minConfidence;
      const meetsConfirmations =
        memory.confirmationCount >= effectiveCriteria.minConfirmations;
      const meetsAccess = memory.accessCount >= effectiveCriteria.minAccessCount;

      if (meetsConfidence && meetsConfirmations && meetsAccess) {
        isCandidate = true;
        priority += memory.confidence * 50;
        priority += memory.confirmationCount * 10;
        priority += memory.accessCount * 1;
      }

      if (isCandidate) {
        candidates.push({ entity: memory, priority });
      }
    }

    // Sort by priority (descending)
    candidates.sort((a, b) => b.priority - a.priority);

    return candidates.map((c) => c.entity);
  }

  /**
   * Promote a working memory to long-term storage.
   *
   * Converts the memory from working to episodic or semantic type.
   * Clears TTL-related fields and sets promotion tracking metadata.
   *
   * @param entityName - Entity to promote
   * @param targetType - Target memory type (default: 'episodic')
   * @returns Promotion result with details
   * @throws Error if entity doesn't exist or isn't working memory
   *
   * @example
   * ```typescript
   * // Promote to episodic memory
   * const result = await wmm.promoteMemory('wm_session_1_abc');
   *
   * // Promote to semantic memory
   * const result = await wmm.promoteMemory('wm_session_1_xyz', 'semantic');
   * ```
   */
  async promoteMemory(
    entityName: string,
    targetType: 'episodic' | 'semantic' = 'episodic'
  ): Promise<PromotionResult> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    if (!isAgentEntity(entity)) {
      throw new Error(`Entity is not an AgentEntity: ${entityName}`);
    }

    const agentEntity = entity;
    if (agentEntity.memoryType !== 'working') {
      throw new Error(`Entity is not working memory: ${entityName}`);
    }

    const now = new Date().toISOString();

    // Build updates - clear working memory fields and set promotion tracking
    const updates: Record<string, unknown> = {
      // Change memory type
      memoryType: targetType,

      // Clear working memory fields
      expiresAt: undefined,
      isWorkingMemory: undefined,
      markedForPromotion: undefined,

      // Set promotion tracking
      promotedAt: now,
      promotedFrom: agentEntity.sessionId,

      // Update timestamp
      lastModified: now,
    };

    // Remove promotion target tags
    if (agentEntity.tags) {
      updates.tags = agentEntity.tags.filter((t) => !t.startsWith('promote_to_'));
    }

    // Persist changes
    await this.storage.updateEntity(entityName, updates);

    // Remove from session index
    const sessionId = agentEntity.sessionId;
    if (sessionId && this.sessionIndex.has(sessionId)) {
      this.sessionIndex.get(sessionId)!.delete(entityName);
    }

    return {
      entityName,
      fromType: 'working',
      toType: targetType,
      promotedAt: now,
    };
  }

  /**
   * Increment confirmation count for a working memory.
   *
   * May trigger auto-promotion if enabled and thresholds are met.
   * This is the primary way to strengthen memories during conversations.
   *
   * @param entityName - Entity to confirm
   * @param confidenceBoost - Optional confidence boost (0-1 range, added to current)
   * @returns Confirmation result indicating if promoted
   * @throws Error if entity doesn't exist or isn't working memory
   *
   * @example
   * ```typescript
   * // Confirm a memory
   * const result = await wmm.confirmMemory('wm_session_1_abc');
   * if (result.promoted) {
   *   console.log('Memory was auto-promoted!');
   * }
   *
   * // Confirm with confidence boost
   * const result = await wmm.confirmMemory('wm_session_1_xyz', 0.1);
   * ```
   */
  async confirmMemory(
    entityName: string,
    confidenceBoost?: number
  ): Promise<ConfirmationResult> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    if (!isAgentEntity(entity)) {
      throw new Error(`Entity is not an AgentEntity: ${entityName}`);
    }

    const agentEntity = entity;
    if (agentEntity.memoryType !== 'working') {
      throw new Error(`Entity is not working memory: ${entityName}`);
    }

    // Increment confirmation
    const newConfirmations = (agentEntity.confirmationCount ?? 0) + 1;
    let newConfidence = agentEntity.confidence ?? 0.5;
    if (confidenceBoost !== undefined && confidenceBoost > 0) {
      newConfidence = Math.min(1, newConfidence + confidenceBoost);
    }

    const updates: Record<string, unknown> = {
      confirmationCount: newConfirmations,
      confidence: newConfidence,
      lastModified: new Date().toISOString(),
    };

    await this.storage.updateEntity(entityName, updates);

    // Check auto-promotion
    let promoted = false;
    if (this.config.autoPromote) {
      const meetsConfidence =
        newConfidence >= this.config.autoPromoteConfidenceThreshold;
      const meetsConfirmations =
        newConfirmations >= this.config.autoPromoteConfirmationThreshold;

      if (meetsConfidence && meetsConfirmations) {
        await this.promoteMemory(entityName, 'semantic');
        promoted = true;
      }
    }

    return { confirmed: true, promoted };
  }

  // ==================== Configuration Access ====================

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<WorkingMemoryConfig>> {
    return { ...this.config };
  }

  /**
   * Get the current session index size.
   */
  getSessionCount(): number {
    return this.sessionIndex.size;
  }

  /**
   * Get memory count for a specific session.
   */
  getSessionMemoryCount(sessionId: string): number {
    return this.sessionIndex.get(sessionId)?.size ?? 0;
  }
}
