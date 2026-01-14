/**
 * Multi-Agent Memory Manager
 *
 * Manages memory for multiple AI agents with ownership tracking,
 * visibility controls, and cross-agent collaboration.
 *
 * @module agent/MultiAgentMemoryManager
 */

import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  AgentEntity,
  AgentMetadata,
  AgentType,
  MemoryVisibility,
  ConflictStrategy,
  ConflictInfo,
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import { EventEmitter } from 'events';
import { ConflictResolver, type ResolutionResult } from './ConflictResolver.js';

/**
 * Configuration for MultiAgentMemoryManager.
 */
export interface MultiAgentConfig {
  /** Default agent ID for single-agent scenarios */
  defaultAgentId?: string;
  /** Default visibility for new memories */
  defaultVisibility?: MemoryVisibility;
  /** Allow cross-agent memory access (default: true) */
  allowCrossAgent?: boolean;
  /** Require agent registration before use (default: false) */
  requireRegistration?: boolean;
}

/**
 * Manages memory for multiple AI agents.
 *
 * Provides agent registration, memory ownership tracking, and visibility
 * controls for multi-agent collaboration scenarios.
 *
 * @example
 * ```typescript
 * const manager = new MultiAgentMemoryManager(storage);
 * await manager.registerAgent('agent_1', { name: 'Assistant', type: 'llm' });
 * const memory = await manager.createAgentMemory('agent_1', {
 *   name: 'user_preference',
 *   observations: ['Likes Italian food'],
 * });
 * ```
 */
export class MultiAgentMemoryManager extends EventEmitter {
  private readonly storage: IGraphStorage;
  private readonly config: Required<MultiAgentConfig>;
  private readonly agents: Map<string, AgentMetadata> = new Map();

  constructor(storage: IGraphStorage, config: MultiAgentConfig = {}) {
    super();
    this.storage = storage;
    this.config = {
      defaultAgentId: config.defaultAgentId ?? 'default',
      defaultVisibility: config.defaultVisibility ?? 'private',
      allowCrossAgent: config.allowCrossAgent ?? true,
      requireRegistration: config.requireRegistration ?? false,
    };

    // Register default agent
    this.agents.set(this.config.defaultAgentId, {
      name: 'Default Agent',
      type: 'default',
      trustLevel: 1.0,
      capabilities: ['read', 'write'],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
  }

  // ==================== Agent Registration ====================

  /**
   * Register a new agent.
   *
   * @param agentId - Unique agent identifier
   * @param metadata - Agent metadata
   * @returns Complete agent metadata
   * @throws Error if agent ID already exists
   */
  async registerAgent(
    agentId: string,
    metadata: Partial<AgentMetadata>
  ): Promise<AgentMetadata> {
    // Validate unique ID
    if (this.agents.has(agentId)) {
      throw new Error(`Agent already registered: ${agentId}`);
    }

    const now = new Date().toISOString();

    // Build complete metadata with defaults
    const completeMetadata: AgentMetadata = {
      name: metadata.name ?? agentId,
      type: metadata.type ?? 'llm',
      trustLevel: metadata.trustLevel ?? 0.5,
      capabilities: metadata.capabilities ?? ['read', 'write'],
      createdAt: now,
      lastActiveAt: now,
      metadata: metadata.metadata,
    };

    // Store in memory
    this.agents.set(agentId, completeMetadata);

    // Create agent entity for persistence
    const agentEntity: Entity = {
      name: `agent:${agentId}`,
      entityType: 'agent',
      observations: [
        `Name: ${completeMetadata.name}`,
        `Type: ${completeMetadata.type}`,
        `Trust Level: ${completeMetadata.trustLevel}`,
        `Capabilities: ${completeMetadata.capabilities.join(', ')}`,
      ],
    };

    await this.storage.appendEntity(agentEntity);

    // Emit registration event
    this.emit('agent:registered', agentId, completeMetadata);

    return completeMetadata;
  }

  /**
   * Unregister an agent.
   *
   * @param agentId - Agent to unregister
   * @returns True if unregistered, false if not found
   */
  async unregisterAgent(agentId: string): Promise<boolean> {
    if (!this.agents.has(agentId)) {
      return false;
    }

    // Don't allow unregistering default agent
    if (agentId === this.config.defaultAgentId) {
      throw new Error('Cannot unregister default agent');
    }

    this.agents.delete(agentId);

    // Remove agent entity from storage
    const agentEntityName = `agent:${agentId}`;
    const graph = await this.storage.getGraphForMutation();
    const index = graph.entities.findIndex((e) => e.name === agentEntityName);
    if (index !== -1) {
      graph.entities.splice(index, 1);
      await this.storage.saveGraph(graph);
    }

    // Emit unregistration event
    this.emit('agent:unregistered', agentId);

    return true;
  }

  // ==================== Agent Queries ====================

  /**
   * Get agent metadata by ID.
   *
   * @param agentId - Agent identifier
   * @returns Agent metadata or undefined
   */
  getAgent(agentId: string): AgentMetadata | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Check if an agent is registered.
   *
   * @param agentId - Agent identifier
   * @returns True if registered
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * List all registered agents.
   *
   * @param filter - Optional filter criteria
   * @returns Array of agent metadata with IDs
   */
  listAgents(filter?: {
    type?: AgentType;
    minTrustLevel?: number;
    capability?: string;
  }): Array<{ id: string; metadata: AgentMetadata }> {
    let entries = Array.from(this.agents.entries());

    if (filter?.type) {
      entries = entries.filter(([, a]) => a.type === filter.type);
    }
    if (filter?.minTrustLevel !== undefined) {
      entries = entries.filter(([, a]) => a.trustLevel >= filter.minTrustLevel!);
    }
    if (filter?.capability) {
      entries = entries.filter(([, a]) => a.capabilities.includes(filter.capability!));
    }

    // Sort by trust level (highest first)
    return entries
      .sort((a, b) => b[1].trustLevel - a[1].trustLevel)
      .map(([id, metadata]) => ({ id, metadata }));
  }

  /**
   * Get number of registered agents.
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  // ==================== Memory Operations ====================

  /**
   * Create a memory owned by an agent.
   *
   * @param agentId - Owning agent's ID
   * @param entity - Partial entity data
   * @returns Created AgentEntity
   */
  async createAgentMemory(
    agentId: string,
    entity: Partial<AgentEntity>
  ): Promise<AgentEntity> {
    // Validate agent exists if required
    if (this.config.requireRegistration && !this.agents.has(agentId)) {
      throw new Error(`Agent not registered: ${agentId}`);
    }

    // Use default agent if not registered and not requiring registration
    const effectiveAgentId = this.agents.has(agentId)
      ? agentId
      : this.config.defaultAgentId;

    const now = new Date().toISOString();
    const name = entity.name ?? `memory_${effectiveAgentId}_${Date.now()}`;

    const agentEntity: AgentEntity = {
      // Base entity fields
      name,
      entityType: entity.entityType ?? 'memory',
      observations: entity.observations ?? [],
      createdAt: now,
      lastModified: now,
      importance: entity.importance ?? 5,

      // Agent memory fields
      agentId: effectiveAgentId,
      visibility: entity.visibility ?? this.config.defaultVisibility,
      memoryType: entity.memoryType ?? 'working',
      accessCount: 0,
      lastAccessedAt: now,
      confidence: entity.confidence ?? 0.5,
      confirmationCount: entity.confirmationCount ?? 0,
    };

    await this.storage.appendEntity(agentEntity as Entity);

    // Update agent's last active
    this.updateLastActive(effectiveAgentId);

    // Emit creation event
    this.emit('memory:created', agentEntity);

    return agentEntity;
  }

  /**
   * Get all memories owned by an agent.
   *
   * @param agentId - Agent identifier
   * @returns Agent's memories
   */
  async getAgentMemories(agentId: string): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    const memories: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      if (agentEntity.agentId === agentId) {
        memories.push(agentEntity);
      }
    }

    return memories;
  }

  /**
   * Get memories visible to an agent.
   *
   * Includes:
   * - Agent's own memories (any visibility)
   * - Other agents' 'shared' memories
   * - All agents' 'public' memories
   *
   * @param agentId - Requesting agent's ID
   * @returns Visible memories
   */
  async getVisibleMemories(agentId: string): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    const memories: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      // Own memories are always visible
      if (agentEntity.agentId === agentId) {
        memories.push(agentEntity);
        continue;
      }

      // Check visibility for cross-agent access
      if (this.config.allowCrossAgent) {
        if (agentEntity.visibility === 'public') {
          memories.push(agentEntity);
        } else if (agentEntity.visibility === 'shared') {
          memories.push(agentEntity);
        }
      }
    }

    return memories;
  }

  /**
   * Transfer memory ownership to another agent.
   *
   * @param memoryName - Memory to transfer
   * @param fromAgentId - Current owner
   * @param toAgentId - New owner
   * @returns Updated memory or null if not found/unauthorized
   */
  async transferMemory(
    memoryName: string,
    fromAgentId: string,
    toAgentId: string
  ): Promise<AgentEntity | null> {
    const entity = this.storage.getEntityByName(memoryName);
    if (!entity || !isAgentEntity(entity)) {
      return null;
    }

    const memory = entity as AgentEntity;

    // Verify ownership
    if (memory.agentId !== fromAgentId) {
      return null;
    }

    // Update ownership
    memory.agentId = toAgentId;
    memory.lastModified = new Date().toISOString();
    await this.storage.updateEntity(memoryName, {
      lastModified: memory.lastModified,
    } as Partial<Entity>);
    // Update in-memory via saveGraph for agent-specific fields
    const graph = await this.storage.getGraphForMutation();
    const entityIndex = graph.entities.findIndex((e) => e.name === memoryName);
    if (entityIndex !== -1) {
      (graph.entities[entityIndex] as AgentEntity).agentId = toAgentId;
      await this.storage.saveGraph(graph);
    }

    // Emit transfer event
    this.emit('memory:transferred', memoryName, fromAgentId, toAgentId);

    return memory;
  }

  /**
   * Share memory with other agents by changing visibility.
   *
   * @param memoryName - Memory to share
   * @param agentId - Owner agent
   * @param visibility - New visibility level
   * @returns Updated memory or null if not found/unauthorized
   */
  async setMemoryVisibility(
    memoryName: string,
    agentId: string,
    visibility: MemoryVisibility
  ): Promise<AgentEntity | null> {
    const entity = this.storage.getEntityByName(memoryName);
    if (!entity || !isAgentEntity(entity)) {
      return null;
    }

    const memory = entity as AgentEntity;

    // Verify ownership
    if (memory.agentId !== agentId) {
      return null;
    }

    // Update visibility
    memory.visibility = visibility;
    memory.lastModified = new Date().toISOString();
    // Update in storage via saveGraph for agent-specific fields
    const graph = await this.storage.getGraphForMutation();
    const entityIndex = graph.entities.findIndex((e) => e.name === memoryName);
    if (entityIndex !== -1) {
      (graph.entities[entityIndex] as AgentEntity).visibility = visibility;
      (graph.entities[entityIndex] as AgentEntity).lastModified = memory.lastModified;
      await this.storage.saveGraph(graph);
    }

    // Emit visibility change event
    this.emit('memory:visibility_changed', memoryName, visibility);

    return memory;
  }

  /**
   * Share a memory with all registered agents.
   *
   * Convenience method that sets visibility to 'shared'.
   *
   * @param memoryName - Memory to share
   * @param agentId - Owner agent
   * @returns Updated memory or null if not found/unauthorized
   */
  async shareMemory(
    memoryName: string,
    agentId: string
  ): Promise<AgentEntity | null> {
    return this.setMemoryVisibility(memoryName, agentId, 'shared');
  }

  /**
   * Make a memory public to all agents (including unregistered).
   *
   * Convenience method that sets visibility to 'public'.
   *
   * @param memoryName - Memory to make public
   * @param agentId - Owner agent
   * @returns Updated memory or null if not found/unauthorized
   */
  async makePublic(
    memoryName: string,
    agentId: string
  ): Promise<AgentEntity | null> {
    return this.setMemoryVisibility(memoryName, agentId, 'public');
  }

  /**
   * Make a memory private to owner only.
   *
   * Convenience method that sets visibility to 'private'.
   *
   * @param memoryName - Memory to make private
   * @param agentId - Owner agent
   * @returns Updated memory or null if not found/unauthorized
   */
  async makePrivate(
    memoryName: string,
    agentId: string
  ): Promise<AgentEntity | null> {
    return this.setMemoryVisibility(memoryName, agentId, 'private');
  }

  /**
   * Filter entities by visibility for a specific agent.
   *
   * Returns only entities that the agent is allowed to see:
   * - Own memories (any visibility)
   * - 'shared' memories from other agents (if allowCrossAgent)
   * - 'public' memories from other agents (if allowCrossAgent)
   *
   * @param entities - Entities to filter
   * @param agentId - Requesting agent's ID
   * @returns Filtered entities
   */
  filterByVisibility(entities: Entity[], agentId: string): AgentEntity[] {
    const visible: AgentEntity[] = [];

    for (const entity of entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      // Own memories are always visible
      if (agentEntity.agentId === agentId) {
        visible.push(agentEntity);
        continue;
      }

      // Cross-agent visibility check
      if (this.config.allowCrossAgent) {
        if (
          agentEntity.visibility === 'public' ||
          agentEntity.visibility === 'shared'
        ) {
          visible.push(agentEntity);
        }
      }
    }

    return visible;
  }

  /**
   * Check if a specific memory is visible to an agent.
   *
   * @param memoryName - Memory name to check
   * @param agentId - Agent requesting access
   * @returns True if visible, false otherwise
   */
  isMemoryVisible(memoryName: string, agentId: string): boolean {
    const entity = this.storage.getEntityByName(memoryName);
    if (!entity || !isAgentEntity(entity)) {
      return false;
    }

    const memory = entity as AgentEntity;

    // Own memories are always visible
    if (memory.agentId === agentId) {
      return true;
    }

    // Cross-agent visibility
    if (this.config.allowCrossAgent) {
      return memory.visibility === 'public' || memory.visibility === 'shared';
    }

    return false;
  }

  /**
   * Get memories by type with visibility filtering.
   *
   * @param agentId - Requesting agent's ID
   * @param entityType - Entity type to filter by
   * @returns Visible memories of specified type
   */
  async getVisibleMemoriesByType(
    agentId: string,
    entityType: string
  ): Promise<AgentEntity[]> {
    const allVisible = await this.getVisibleMemories(agentId);
    return allVisible.filter((m) => m.entityType === entityType);
  }

  /**
   * Search memories with automatic visibility filtering.
   *
   * Wraps basic search functionality and filters results based on
   * the requesting agent's visibility permissions.
   *
   * @param agentId - Requesting agent's ID
   * @param query - Search query (entity name or observation content)
   * @returns Visible memories matching the query
   */
  async searchVisibleMemories(
    agentId: string,
    query: string
  ): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    const queryLower = query.toLowerCase();
    const matches: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      // Check visibility first
      const isVisible =
        agentEntity.agentId === agentId ||
        (this.config.allowCrossAgent &&
          (agentEntity.visibility === 'public' ||
            agentEntity.visibility === 'shared'));

      if (!isVisible) continue;

      // Check if entity matches query
      const nameMatch = agentEntity.name.toLowerCase().includes(queryLower);
      const obsMatch = agentEntity.observations?.some((o) =>
        o.toLowerCase().includes(queryLower)
      );

      if (nameMatch || obsMatch) {
        matches.push(agentEntity);
      }
    }

    return matches;
  }

  // ==================== Cross-Agent Operations ====================

  /**
   * Get memories shared between two or more agents.
   *
   * @param agentIds - Array of agent IDs to find shared memories between
   * @param options - Filter options
   * @returns Memories accessible to all specified agents
   */
  async getSharedMemories(
    agentIds: string[],
    options?: {
      entityType?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<AgentEntity[]> {
    if (agentIds.length < 2) {
      return [];
    }

    const graph = await this.storage.loadGraph();
    const shared: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      // Check if all agents can see this memory
      const visibleToAll = agentIds.every((agentId) => {
        // Own memories are visible
        if (agentEntity.agentId === agentId) return true;
        // Shared/public memories are visible if cross-agent allowed
        if (this.config.allowCrossAgent) {
          return (
            agentEntity.visibility === 'public' ||
            agentEntity.visibility === 'shared'
          );
        }
        return false;
      });

      if (!visibleToAll) continue;

      // Apply optional filters
      if (options?.entityType && agentEntity.entityType !== options.entityType) {
        continue;
      }
      if (options?.startDate && agentEntity.createdAt && agentEntity.createdAt < options.startDate) {
        continue;
      }
      if (options?.endDate && agentEntity.createdAt && agentEntity.createdAt > options.endDate) {
        continue;
      }

      shared.push(agentEntity);
    }

    return shared;
  }

  /**
   * Search across multiple agents' visible memories with optional trust weighting.
   *
   * @param requestingAgentId - Agent performing the search
   * @param query - Search query
   * @param options - Search options
   * @returns Ranked search results
   */
  async searchCrossAgent(
    requestingAgentId: string,
    query: string,
    options?: {
      agentIds?: string[];
      useTrustWeighting?: boolean;
      trustWeight?: number;
      entityType?: string;
    }
  ): Promise<Array<{
    memory: AgentEntity;
    relevanceScore: number;
    trustScore: number;
    combinedScore: number;
  }>> {
    const useTrustWeighting = options?.useTrustWeighting ?? false;
    const trustWeight = options?.trustWeight ?? 0.3;
    const queryLower = query.toLowerCase();

    // Get all visible memories
    const visibleMemories = await this.getVisibleMemories(requestingAgentId);

    // Filter by agent IDs if specified
    let filteredMemories = visibleMemories;
    if (options?.agentIds && options.agentIds.length > 0) {
      filteredMemories = visibleMemories.filter(
        (m) => m.agentId && options.agentIds!.includes(m.agentId)
      );
    }

    // Filter by entity type if specified
    if (options?.entityType) {
      filteredMemories = filteredMemories.filter(
        (m) => m.entityType === options.entityType
      );
    }

    // Search and score results
    const results: Array<{
      memory: AgentEntity;
      relevanceScore: number;
      trustScore: number;
      combinedScore: number;
    }> = [];

    for (const memory of filteredMemories) {
      // Calculate relevance score (simple TF-style scoring)
      const nameMatch = memory.name.toLowerCase().includes(queryLower);
      const obsMatches =
        memory.observations?.filter((o) => o.toLowerCase().includes(queryLower))
          .length ?? 0;

      const relevanceScore = nameMatch ? 0.5 : 0;
      const obsScore = Math.min(obsMatches * 0.1, 0.5);
      const totalRelevance = relevanceScore + obsScore;

      if (totalRelevance === 0) continue;

      // Get trust score from owning agent
      const ownerAgent = memory.agentId ? this.agents.get(memory.agentId) : undefined;
      const trustScore = ownerAgent?.trustLevel ?? 0.5;

      // Calculate combined score
      let combinedScore = totalRelevance;
      if (useTrustWeighting) {
        combinedScore =
          totalRelevance * (1 - trustWeight) + trustScore * trustWeight;
      }

      results.push({
        memory,
        relevanceScore: totalRelevance,
        trustScore,
        combinedScore,
      });
    }

    // Sort by combined score (descending)
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    // Emit search event
    this.emit('memory:cross_agent_search', requestingAgentId, query, results.length);

    return results;
  }

  /**
   * Copy a shared memory to an agent's private store.
   *
   * Creates a new entity owned by the requesting agent with source tracking.
   *
   * @param memoryName - Memory to copy
   * @param requestingAgentId - Agent making the copy
   * @param options - Copy options
   * @returns New copied memory or null if not accessible
   */
  async copyMemory(
    memoryName: string,
    requestingAgentId: string,
    options?: {
      newName?: string;
      annotation?: string;
      visibility?: MemoryVisibility;
    }
  ): Promise<AgentEntity | null> {
    // Check if memory is visible to requesting agent
    if (!this.isMemoryVisible(memoryName, requestingAgentId)) {
      return null;
    }

    const entity = this.storage.getEntityByName(memoryName);
    if (!entity || !isAgentEntity(entity)) {
      return null;
    }

    const sourceMemory = entity as AgentEntity;

    // Create a copy with new ownership
    const now = new Date().toISOString();
    const newName =
      options?.newName ??
      `copy_${memoryName}_${requestingAgentId}_${Date.now()}`;

    const copiedMemory: AgentEntity = {
      // Base entity fields
      name: newName,
      entityType: sourceMemory.entityType,
      observations: [...(sourceMemory.observations ?? [])],
      createdAt: now,
      lastModified: now,
      importance: sourceMemory.importance ?? 5,

      // Agent memory fields
      agentId: requestingAgentId,
      visibility: options?.visibility ?? 'private',
      memoryType: sourceMemory.memoryType ?? 'working',
      accessCount: 0,
      lastAccessedAt: now,
      confidence: sourceMemory.confidence ?? 0.5,
      confirmationCount: 0,

      // Source tracking
      source: {
        agentId: sourceMemory.agentId ?? requestingAgentId,
        timestamp: now,
        method: 'consolidated',
        reliability: sourceMemory.source?.reliability ?? 0.8,
        originalEntityId: memoryName,
      },
    };

    // Add annotation if provided
    if (options?.annotation) {
      copiedMemory.observations = [
        ...(copiedMemory.observations ?? []),
        `[Annotation] ${options.annotation}`,
      ];
    }

    await this.storage.appendEntity(copiedMemory as Entity);

    // Update requesting agent's last active
    this.updateLastActive(requestingAgentId);

    // Emit copy event
    this.emit(
      'memory:copied',
      memoryName,
      sourceMemory.agentId,
      requestingAgentId,
      newName
    );

    return copiedMemory;
  }

  /**
   * Record that an agent accessed another agent's memory.
   *
   * Used for audit trail when cross-agent access occurs.
   *
   * @param memoryName - Memory that was accessed
   * @param requestingAgentId - Agent that accessed the memory
   * @param accessType - Type of access (view, search, copy)
   */
  recordCrossAgentAccess(
    memoryName: string,
    requestingAgentId: string,
    accessType: 'view' | 'search' | 'copy'
  ): void {
    const entity = this.storage.getEntityByName(memoryName);
    if (!entity || !isAgentEntity(entity)) return;

    const memory = entity as AgentEntity;

    // Only record if accessing another agent's memory
    if (memory.agentId === requestingAgentId) return;

    this.emit('memory:cross_agent_access', {
      memoryName,
      ownerAgentId: memory.agentId,
      requestingAgentId,
      accessType,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get collaboration statistics between agents.
   *
   * @param agentId - Agent to get stats for
   * @returns Collaboration statistics
   */
  async getCollaborationStats(agentId: string): Promise<{
    sharedMemoryCount: number;
    publicMemoryCount: number;
    accessibleFromOthers: number;
  }> {
    const ownMemories = await this.getAgentMemories(agentId);

    const sharedCount = ownMemories.filter((m) => m.visibility === 'shared')
      .length;
    const publicCount = ownMemories.filter((m) => m.visibility === 'public')
      .length;

    const visibleMemories = await this.getVisibleMemories(agentId);
    const fromOthers = visibleMemories.filter((m) => m.agentId !== agentId)
      .length;

    return {
      sharedMemoryCount: sharedCount,
      publicMemoryCount: publicCount,
      accessibleFromOthers: fromOthers,
    };
  }

  // ==================== Conflict Resolution ====================

  private _conflictResolver?: ConflictResolver;

  /**
   * Get or create the conflict resolver instance.
   */
  private getConflictResolver(): ConflictResolver {
    if (!this._conflictResolver) {
      this._conflictResolver = new ConflictResolver();

      // Forward conflict events
      this._conflictResolver.on('memory:conflict', (conflict: ConflictInfo) => {
        this.emit('memory:conflict', conflict);
      });

      this._conflictResolver.on(
        'memory:conflict_resolved',
        (data: { conflict: ConflictInfo; strategy: ConflictStrategy; resolvedMemory: string }) => {
          this.emit('memory:conflict_resolved', data);
        }
      );
    }
    return this._conflictResolver;
  }

  /**
   * Detect conflicts among a set of memories.
   *
   * @param memories - Memories to check for conflicts (defaults to all visible to default agent)
   * @returns Array of detected conflicts
   */
  async detectConflicts(memories?: AgentEntity[]): Promise<ConflictInfo[]> {
    const resolver = this.getConflictResolver();

    if (!memories) {
      memories = await this.getVisibleMemories(this.config.defaultAgentId);
    }

    return resolver.detectConflicts(memories);
  }

  /**
   * Resolve a conflict using the specified strategy.
   *
   * @param conflict - Conflict information
   * @param strategy - Resolution strategy (uses suggested if not specified)
   * @returns Resolution result
   */
  async resolveConflict(
    conflict: ConflictInfo,
    strategy?: ConflictStrategy
  ): Promise<ResolutionResult> {
    const resolver = this.getConflictResolver();

    // Get all memories involved in the conflict
    const allNames = [conflict.primaryMemory, ...conflict.conflictingMemories];
    const memories: AgentEntity[] = [];

    for (const name of allNames) {
      const entity = this.storage.getEntityByName(name);
      if (entity && isAgentEntity(entity)) {
        memories.push(entity as AgentEntity);
      }
    }

    return resolver.resolveConflict(conflict, memories, this.agents, strategy);
  }

  /**
   * Merge memories from multiple agents with trust weighting.
   *
   * Creates a new merged memory preserving provenance from all sources.
   *
   * @param memoryNames - Names of memories to merge
   * @param targetAgentId - Agent that will own the merged memory
   * @param options - Merge options
   * @returns Merged memory
   */
  async mergeCrossAgent(
    memoryNames: string[],
    targetAgentId: string,
    options?: {
      newName?: string;
      resolveConflicts?: boolean;
      conflictStrategy?: ConflictStrategy;
    }
  ): Promise<AgentEntity | null> {
    if (memoryNames.length < 2) {
      return null;
    }

    // Gather memories
    const memories: AgentEntity[] = [];
    for (const name of memoryNames) {
      const entity = this.storage.getEntityByName(name);
      if (entity && isAgentEntity(entity)) {
        memories.push(entity as AgentEntity);
      }
    }

    if (memories.length < 2) {
      return null;
    }

    // Check for conflicts if requested
    if (options?.resolveConflicts) {
      const resolver = this.getConflictResolver();
      const conflicts = resolver.detectConflicts(memories);

      if (conflicts.length > 0) {
        // Resolve the first conflict (which may include all memories)
        const resolution = resolver.resolveConflict(
          conflicts[0],
          memories,
          this.agents,
          options.conflictStrategy
        );

        // Use the resolved memory as the merge result
        const now = new Date().toISOString();
        const newName =
          options.newName ??
          `merged_${targetAgentId}_${Date.now()}`;

        const mergedMemory: AgentEntity = {
          ...resolution.resolvedMemory,
          name: newName,
          agentId: targetAgentId,
          visibility: 'private',
          lastModified: now,
          source: {
            agentId: targetAgentId,
            timestamp: now,
            method: 'consolidated',
            reliability: resolution.resolvedMemory.confidence ?? 0.7,
            originalEntityId: resolution.sourceMemories.join(','),
          },
        };

        await this.storage.appendEntity(mergedMemory as Entity);

        // Emit merge event
        this.emit('memory:merged', {
          newMemory: newName,
          sourceMemories: memoryNames,
          targetAgent: targetAgentId,
          hadConflicts: true,
        });

        return mergedMemory;
      }
    }

    // No conflicts or not resolving - simple merge
    const now = new Date().toISOString();
    const newName = options?.newName ?? `merged_${targetAgentId}_${Date.now()}`;

    // Combine observations
    const allObservations = new Set<string>();
    for (const m of memories) {
      if (m.observations) {
        for (const o of m.observations) {
          allObservations.add(o);
        }
      }
    }

    // Calculate weighted confidence based on agent trust
    let totalWeightedConfidence = 0;
    let totalWeight = 0;
    for (const m of memories) {
      const agentMeta = m.agentId ? this.agents.get(m.agentId) : undefined;
      const trust = agentMeta?.trustLevel ?? 0.5;
      const conf = m.confidence ?? 0.5;
      totalWeightedConfidence += conf * trust;
      totalWeight += trust;
    }
    const avgConfidence = totalWeight > 0 ? totalWeightedConfidence / totalWeight : 0.5;

    // Sum confirmations
    const totalConfirmations = memories.reduce(
      (sum, m) => sum + (m.confirmationCount ?? 0),
      0
    );

    // Use first memory as base for entity type
    const baseMemory = memories[0];

    const mergedMemory: AgentEntity = {
      name: newName,
      entityType: baseMemory.entityType ?? 'memory',
      observations: Array.from(allObservations),
      createdAt: now,
      lastModified: now,
      importance: Math.max(...memories.map((m) => m.importance ?? 5)),
      agentId: targetAgentId,
      visibility: 'private',
      memoryType: baseMemory.memoryType ?? 'semantic',
      accessCount: 0,
      lastAccessedAt: now,
      confidence: avgConfidence,
      confirmationCount: totalConfirmations,
      source: {
        agentId: targetAgentId,
        timestamp: now,
        method: 'consolidated',
        reliability: avgConfidence,
        originalEntityId: memoryNames.join(','),
      },
    };

    await this.storage.appendEntity(mergedMemory as Entity);

    // Update target agent's last active
    this.updateLastActive(targetAgentId);

    // Emit merge event
    this.emit('memory:merged', {
      newMemory: newName,
      sourceMemories: memoryNames,
      targetAgent: targetAgentId,
      hadConflicts: false,
    });

    return mergedMemory;
  }

  /**
   * Get the conflict resolver instance for advanced operations.
   */
  getConflictResolverInstance(): ConflictResolver {
    return this.getConflictResolver();
  }

  // ==================== Helper Methods ====================

  /**
   * Update agent's last active timestamp.
   * @internal
   */
  private updateLastActive(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActiveAt = new Date().toISOString();
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<MultiAgentConfig>> {
    return { ...this.config };
  }
}
