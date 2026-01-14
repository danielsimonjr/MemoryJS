/**
 * Episodic Memory Manager
 *
 * Manages episodic memories (conversations, events, experiences)
 * with temporal ordering and causal relationships.
 *
 * @module agent/EpisodicMemoryManager
 */

import type { IGraphStorage, Entity, Relation } from '../types/types.js';
import type { AgentEntity } from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';

/**
 * Relation types for episodic memory structure.
 */
export const EpisodicRelations = {
  /** Temporal sequence: A occurred before B */
  PRECEDES: 'precedes',
  /** Temporal sequence: A occurred after B */
  FOLLOWS: 'follows',
  /** Causal: A caused B to happen */
  CAUSES: 'causes',
  /** Causal: A was caused by B */
  CAUSED_BY: 'caused_by',
  /** Part of event sequence */
  PART_OF_SEQUENCE: 'part_of_sequence',
} as const;

/**
 * Configuration for EpisodicMemoryManager.
 */
export interface EpisodicMemoryConfig {
  /** Auto-create temporal relations (default: true) */
  autoLinkTemporal?: boolean;
  /** Max events per sequence (default: 1000) */
  maxSequenceLength?: number;
}

/**
 * Options for creating an episodic memory.
 */
export interface CreateEpisodeOptions {
  /** Session this episode belongs to */
  sessionId?: string;
  /** Previous event in sequence */
  previousEventId?: string;
  /** Task ID */
  taskId?: string;
  /** Entity type (default: 'episode') */
  entityType?: string;
  /** Importance (0-10) */
  importance?: number;
  /** Confidence (0-1) */
  confidence?: number;
  /** Agent ID */
  agentId?: string;
}

/**
 * Options for timeline queries.
 */
export interface TimelineOptions {
  /** Order: ascending (oldest first) or descending (newest first) */
  order?: 'asc' | 'desc';
  /** Start time filter (ISO 8601) */
  startTime?: string;
  /** End time filter (ISO 8601) */
  endTime?: string;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Manages episodic memories with temporal and causal structure.
 *
 * Episodic memories represent specific events, conversations, or experiences
 * that have a temporal context. This manager provides:
 * - Event creation with automatic temporal linking
 * - Event sequence management (precedes/follows relations)
 * - Timeline queries for chronological retrieval
 * - Causal relationship tracking (causes/caused_by)
 *
 * @example
 * ```typescript
 * const emm = new EpisodicMemoryManager(storage);
 *
 * // Create individual events
 * const event1 = await emm.createEpisode('User asked about hotels');
 * const event2 = await emm.createEpisode('Found 5 hotels', {
 *   previousEventId: event1.name,
 *   sessionId: 'session_123'
 * });
 *
 * // Create a sequence of events
 * const events = await emm.createEventSequence([
 *   'User logged in',
 *   'User searched for flights',
 *   'User booked a flight'
 * ], { sessionId: 'session_123' });
 *
 * // Query timeline
 * const timeline = await emm.getTimeline('session_123', { order: 'asc' });
 *
 * // Track causality
 * await emm.addCausalLink(event1.name, event2.name);
 * const chain = await emm.getCausalChain(event1.name, 'causes');
 * ```
 */
export class EpisodicMemoryManager {
  private readonly storage: IGraphStorage;
  private readonly config: Required<EpisodicMemoryConfig>;

  constructor(storage: IGraphStorage, config: EpisodicMemoryConfig = {}) {
    this.storage = storage;
    this.config = {
      autoLinkTemporal: config.autoLinkTemporal ?? true,
      maxSequenceLength: config.maxSequenceLength ?? 1000,
    };
  }

  // ==================== Event Creation ====================

  /**
   * Create an episodic memory.
   *
   * @param content - The event content/description
   * @param options - Creation options
   * @returns The created episodic memory entity
   */
  async createEpisode(
    content: string,
    options?: CreateEpisodeOptions
  ): Promise<AgentEntity> {
    const now = new Date().toISOString();
    const timestamp = Date.now();
    const name = `episode_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;

    const entity: AgentEntity = {
      name,
      entityType: options?.entityType ?? 'episode',
      observations: [content],
      createdAt: now,
      lastModified: now,
      importance: options?.importance ?? 5,
      memoryType: 'episodic',
      sessionId: options?.sessionId,
      taskId: options?.taskId,
      accessCount: 0,
      confidence: options?.confidence ?? 0.8,
      confirmationCount: 0,
      visibility: 'private',
      agentId: options?.agentId,
    };

    // Persist entity
    await this.storage.appendEntity(entity as Entity);

    // Link to previous event if specified and auto-link enabled
    if (options?.previousEventId && this.config.autoLinkTemporal) {
      await this.linkEvents(options.previousEventId, name);
    }

    return entity;
  }

  /**
   * Create multiple events as a sequence.
   *
   * @param contents - Event contents in order
   * @param options - Shared options for all events
   * @returns Created events in order
   */
  async createEventSequence(
    contents: string[],
    options?: Omit<CreateEpisodeOptions, 'previousEventId'>
  ): Promise<AgentEntity[]> {
    const events: AgentEntity[] = [];
    let previousId: string | undefined;

    for (const content of contents) {
      const event = await this.createEpisode(content, {
        ...options,
        previousEventId: previousId,
      });
      events.push(event);
      previousId = event.name;
    }

    return events;
  }

  // ==================== Temporal Linking ====================

  /**
   * Link two events in temporal sequence.
   * @internal
   */
  private async linkEvents(beforeId: string, afterId: string): Promise<void> {
    const now = new Date().toISOString();

    // Create precedes relation
    const precedesRelation: Relation = {
      from: beforeId,
      to: afterId,
      relationType: EpisodicRelations.PRECEDES,
      createdAt: now,
    };

    // Create follows relation (reverse)
    const followsRelation: Relation = {
      from: afterId,
      to: beforeId,
      relationType: EpisodicRelations.FOLLOWS,
      createdAt: now,
    };

    await this.storage.appendRelation(precedesRelation);
    await this.storage.appendRelation(followsRelation);
  }

  /**
   * Link multiple events into a sequence.
   *
   * @param entityNames - Events to link in order
   */
  async linkSequence(entityNames: string[]): Promise<void> {
    if (entityNames.length < 2) return;
    if (entityNames.length > this.config.maxSequenceLength) {
      throw new Error(
        `Sequence exceeds max length (${this.config.maxSequenceLength})`
      );
    }

    // Link each pair
    for (let i = 0; i < entityNames.length - 1; i++) {
      await this.linkEvents(entityNames[i], entityNames[i + 1]);
    }
  }

  // ==================== Timeline Queries ====================

  /**
   * Get episodic memories for a session as timeline.
   *
   * @param sessionId - Session to query
   * @param options - Timeline options
   * @returns Episodes in chronological order
   */
  async getTimeline(
    sessionId: string,
    options?: TimelineOptions
  ): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    let episodes: AgentEntity[] = [];

    // Find episodic memories for session
    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      if (agentEntity.memoryType !== 'episodic') continue;
      if (agentEntity.sessionId !== sessionId) continue;
      // Exclude session entities themselves
      if (agentEntity.entityType === 'session') continue;

      // Apply time filters
      if (options?.startTime && agentEntity.createdAt) {
        if (new Date(agentEntity.createdAt) < new Date(options.startTime)) {
          continue;
        }
      }
      if (options?.endTime && agentEntity.createdAt) {
        if (new Date(agentEntity.createdAt) > new Date(options.endTime)) {
          continue;
        }
      }

      episodes.push(agentEntity);
    }

    // Sort by createdAt
    const order = options?.order ?? 'asc';
    episodes.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return order === 'asc' ? timeA - timeB : timeB - timeA;
    });

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? episodes.length;
    return episodes.slice(offset, offset + limit);
  }

  /**
   * Iterate through timeline forward (oldest to newest).
   *
   * @param sessionId - Session to iterate
   */
  async *iterateForward(sessionId: string): AsyncGenerator<AgentEntity> {
    const timeline = await this.getTimeline(sessionId, { order: 'asc' });
    for (const episode of timeline) {
      yield episode;
    }
  }

  /**
   * Iterate through timeline backward (newest to oldest).
   *
   * @param sessionId - Session to iterate
   */
  async *iterateBackward(sessionId: string): AsyncGenerator<AgentEntity> {
    const timeline = await this.getTimeline(sessionId, { order: 'desc' });
    for (const episode of timeline) {
      yield episode;
    }
  }

  /**
   * Get the next event after the given event.
   *
   * @param entityName - Current event name
   * @returns Next event or undefined
   */
  async getNextEvent(entityName: string): Promise<AgentEntity | undefined> {
    const relations = this.storage.getRelationsFrom(entityName);

    for (const rel of relations) {
      if (rel.relationType === EpisodicRelations.PRECEDES) {
        const entity = this.storage.getEntityByName(rel.to);
        if (entity && isAgentEntity(entity)) {
          return entity as AgentEntity;
        }
      }
    }

    return undefined;
  }

  /**
   * Get the previous event before the given event.
   *
   * @param entityName - Current event name
   * @returns Previous event or undefined
   */
  async getPreviousEvent(entityName: string): Promise<AgentEntity | undefined> {
    const relations = this.storage.getRelationsFrom(entityName);

    for (const rel of relations) {
      if (rel.relationType === EpisodicRelations.FOLLOWS) {
        const entity = this.storage.getEntityByName(rel.to);
        if (entity && isAgentEntity(entity)) {
          return entity as AgentEntity;
        }
      }
    }

    return undefined;
  }

  // ==================== Causal Relationships ====================

  /**
   * Add causal relationship between events.
   *
   * @param causeEntity - Entity that caused the effect
   * @param effectEntity - Entity that was caused
   */
  async addCausalLink(
    causeEntity: string,
    effectEntity: string
  ): Promise<void> {
    // Verify both entities exist
    const cause = this.storage.getEntityByName(causeEntity);
    const effect = this.storage.getEntityByName(effectEntity);

    if (!cause) throw new Error(`Cause entity not found: ${causeEntity}`);
    if (!effect) throw new Error(`Effect entity not found: ${effectEntity}`);

    const now = new Date().toISOString();

    // Create causes relation
    const causesRelation: Relation = {
      from: causeEntity,
      to: effectEntity,
      relationType: EpisodicRelations.CAUSES,
      createdAt: now,
    };

    // Create caused_by relation (reverse)
    const causedByRelation: Relation = {
      from: effectEntity,
      to: causeEntity,
      relationType: EpisodicRelations.CAUSED_BY,
      createdAt: now,
    };

    await this.storage.appendRelation(causesRelation);
    await this.storage.appendRelation(causedByRelation);
  }

  /**
   * Get causal chain from an event.
   *
   * @param entityName - Starting event
   * @param direction - Follow causes or caused_by
   * @returns Chain of events
   */
  async getCausalChain(
    entityName: string,
    direction: 'causes' | 'caused_by'
  ): Promise<AgentEntity[]> {
    const visited = new Set<string>();
    const chain: AgentEntity[] = [];

    const relationType =
      direction === 'causes'
        ? EpisodicRelations.CAUSES
        : EpisodicRelations.CAUSED_BY;

    const traverse = async (name: string) => {
      if (visited.has(name)) return; // Prevent cycles
      visited.add(name);

      const entity = this.storage.getEntityByName(name);
      if (!entity || !isAgentEntity(entity)) return;

      chain.push(entity as AgentEntity);

      // Find next in chain
      const relations = this.storage.getRelationsFrom(name);
      for (const rel of relations) {
        if (rel.relationType === relationType) {
          await traverse(rel.to);
        }
      }
    };

    await traverse(entityName);
    return chain;
  }

  /**
   * Get direct causes of an event.
   *
   * @param entityName - Event to query
   * @returns Events that directly caused this event
   */
  async getDirectCauses(entityName: string): Promise<AgentEntity[]> {
    const relations = this.storage.getRelationsTo(entityName);
    const causes: AgentEntity[] = [];

    for (const rel of relations) {
      if (rel.relationType === EpisodicRelations.CAUSES) {
        const entity = this.storage.getEntityByName(rel.from);
        if (entity && isAgentEntity(entity)) {
          causes.push(entity as AgentEntity);
        }
      }
    }

    return causes;
  }

  /**
   * Get direct effects of an event.
   *
   * @param entityName - Event to query
   * @returns Events that were directly caused by this event
   */
  async getDirectEffects(entityName: string): Promise<AgentEntity[]> {
    const relations = this.storage.getRelationsFrom(entityName);
    const effects: AgentEntity[] = [];

    for (const rel of relations) {
      if (rel.relationType === EpisodicRelations.CAUSES) {
        const entity = this.storage.getEntityByName(rel.to);
        if (entity && isAgentEntity(entity)) {
          effects.push(entity as AgentEntity);
        }
      }
    }

    return effects;
  }

  // ==================== Utility Methods ====================

  /**
   * Get all episodic memories across all sessions.
   *
   * @param options - Filter and pagination options
   * @returns All episodic memories
   */
  async getAllEpisodes(options?: TimelineOptions): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    let episodes: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;

      if (agentEntity.memoryType !== 'episodic') continue;
      if (agentEntity.entityType === 'session') continue;

      // Apply time filters
      if (options?.startTime && agentEntity.createdAt) {
        if (new Date(agentEntity.createdAt) < new Date(options.startTime)) {
          continue;
        }
      }
      if (options?.endTime && agentEntity.createdAt) {
        if (new Date(agentEntity.createdAt) > new Date(options.endTime)) {
          continue;
        }
      }

      episodes.push(agentEntity);
    }

    // Sort by createdAt
    const order = options?.order ?? 'asc';
    episodes.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return order === 'asc' ? timeA - timeB : timeB - timeA;
    });

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? episodes.length;
    return episodes.slice(offset, offset + limit);
  }

  /**
   * Count episodic memories for a session.
   *
   * @param sessionId - Session to count
   * @returns Number of episodic memories
   */
  async getEpisodeCount(sessionId: string): Promise<number> {
    const timeline = await this.getTimeline(sessionId);
    return timeline.length;
  }
}
