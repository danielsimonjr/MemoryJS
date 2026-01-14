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
   * @throws Error if entity doesn't exist or isn't working memory
   */
  async markForPromotion(entityName: string): Promise<void> {
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

    await this.storage.updateEntity(entityName, {
      markedForPromotion: true,
      lastModified: new Date().toISOString(),
    } as Record<string, unknown>);
  }

  /**
   * Get memories that are candidates for promotion.
   *
   * Returns working memories for the session that either:
   * - Are marked for promotion, or
   * - Meet auto-promotion thresholds (if autoPromote is enabled)
   *
   * @param sessionId - Session identifier
   * @returns Array of promotion candidate AgentEntities
   */
  async getPromotionCandidates(sessionId: string): Promise<AgentEntity[]> {
    const memories = await this.getSessionMemories(sessionId);
    const candidates: AgentEntity[] = [];

    for (const memory of memories) {
      // Explicitly marked
      if (memory.markedForPromotion) {
        candidates.push(memory);
        continue;
      }

      // Auto-promotion threshold check
      if (this.config.autoPromote) {
        const meetsConfidence =
          memory.confidence >= this.config.autoPromoteConfidenceThreshold;
        const meetsConfirmations =
          memory.confirmationCount >= this.config.autoPromoteConfirmationThreshold;

        if (meetsConfidence && meetsConfirmations) {
          candidates.push(memory);
        }
      }
    }

    return candidates;
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
