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
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import { EventEmitter } from 'events';

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
