/**
 * Failure-Driven Memory Distillation
 *
 * Analyzes failure sessions by tracing causal chains (CAUSES/CAUSED_BY relations)
 * and distills actionable lessons into procedural memory entities.
 *
 * @module agent/FailureDistillation
 */

import { randomUUID } from 'crypto';
import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  AgentEntity,
  DistilledLesson,
} from '../types/agent-memory.js';
import { isAgentEntity, isSessionEntity } from '../types/agent-memory.js';
import { EpisodicRelations } from './EpisodicMemoryManager.js';

/**
 * Configuration for FailureDistillation.
 */
export interface FailureDistillationConfig {
  /** Minimum confidence required for a lesson to be persisted (default: 0.6) */
  minLessonConfidence?: number;
  /** Maximum depth to follow causal chains (default: 5) */
  maxCauseChainLength?: number;
  /** Entity type for generated lesson entities (default: 'lesson') */
  lessonEntityType?: string;
}

/**
 * Result of a distillation operation.
 */
export interface FailureDistillationResult {
  /** Session ID that was analyzed */
  sessionId: string;
  /** Distilled lessons produced */
  lessons: DistilledLesson[];
  /** Names of created procedural memory entities */
  createdEntities: string[];
  /** Number of episodic memory entities analyzed */
  episodesAnalyzed: number;
}

/**
 * Distills lessons from failure sessions by tracing causal chains in episodic memory.
 *
 * The distillation process:
 * 1. Loads the session and verifies it has a 'failure' outcome.
 * 2. Retrieves all episodic memories (episodes) for the session.
 * 3. For each episode, traces backward through CAUSED_BY relations to build a cause chain.
 * 4. Generates a lesson with confidence = 0.5 + 0.1 * chainLength (capped at 0.9).
 * 5. Persists lessons above `minLessonConfidence` as procedural memory entities.
 *
 * @example
 * ```typescript
 * const fd = new FailureDistillation(storage);
 * const result = await fd.distillFromSession('session_123');
 * console.log(`Created ${result.createdEntities.length} lesson entities`);
 * ```
 */
export class FailureDistillation {
  private readonly storage: IGraphStorage;
  private readonly config: Required<FailureDistillationConfig>;

  constructor(storage: IGraphStorage, config: FailureDistillationConfig = {}) {
    this.storage = storage;
    this.config = {
      minLessonConfidence: config.minLessonConfidence ?? 0.6,
      maxCauseChainLength: config.maxCauseChainLength ?? 5,
      lessonEntityType: config.lessonEntityType ?? 'lesson',
    };
  }

  // ==================== Main Distillation ====================

  /**
   * Distill lessons from a session.
   *
   * Returns zero lessons if the session does not exist, is not a session entity,
   * or its outcome is not 'failure'. This is intentional: non-failure sessions
   * should not produce lessons.
   *
   * @param sessionId - ID of the session to analyze
   * @returns Distillation result with lessons and created entity names
   */
  async distillFromSession(sessionId: string): Promise<FailureDistillationResult> {
    const emptyResult: FailureDistillationResult = {
      sessionId,
      lessons: [],
      createdEntities: [],
      episodesAnalyzed: 0,
    };

    // Load and validate the session
    const sessionEntity = this.storage.getEntityByName(sessionId);
    if (!sessionEntity || !isSessionEntity(sessionEntity)) {
      return emptyResult;
    }

    // Only process failure sessions
    if (sessionEntity.outcome !== 'failure') {
      return emptyResult;
    }

    // Get all episodic memories for this session
    const graph = await this.storage.loadGraph();
    const episodes: AgentEntity[] = [];

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;
      const agentEntity = entity as AgentEntity;
      if (agentEntity.memoryType !== 'episodic') continue;
      if (agentEntity.entityType === 'session') continue;
      if (agentEntity.sessionId !== sessionId) continue;
      episodes.push(agentEntity);
    }

    if (episodes.length === 0) {
      return { ...emptyResult, episodesAnalyzed: 0 };
    }

    // Analyze each episode for causal chains
    const lessons: DistilledLesson[] = [];
    const createdEntities: string[] = [];

    for (const episode of episodes) {
      const causeChain = await this.traceCauseChain(episode.name);

      // confidence = 0.5 + 0.1 * chainLength, capped at 0.9
      const chainLength = causeChain.length;
      const confidence = Math.min(0.5 + 0.1 * chainLength, 0.9);

      if (confidence < this.config.minLessonConfidence) {
        continue;
      }

      const failureDescription = this.buildFailureDescription(episode, causeChain);
      const lesson = this.buildLesson(episode, causeChain);

      const distilledLesson: DistilledLesson = {
        failureDescription,
        causeChain: causeChain.map((e) => e.name),
        lesson,
        confidence,
        sourceSessionId: sessionId,
        sourceEpisodes: [episode.name, ...causeChain.map((e) => e.name)],
      };

      lessons.push(distilledLesson);

      // Persist as a procedural memory entity
      const entityName = await this.createLessonEntity(distilledLesson, sessionId);
      createdEntities.push(entityName);
    }

    return {
      sessionId,
      lessons,
      createdEntities,
      episodesAnalyzed: episodes.length,
    };
  }

  // ==================== Causal Chain Tracing ====================

  /**
   * Trace the CAUSED_BY chain backward from an episode.
   *
   * Follows CAUSED_BY relations (i.e., "what caused this episode?") up to
   * `maxCauseChainLength` steps, avoiding cycles.
   *
   * @param startEntityName - The episode to start tracing from
   * @returns Ordered chain of cause entities (without the start entity itself)
   * @internal
   */
  private async traceCauseChain(startEntityName: string): Promise<AgentEntity[]> {
    const visited = new Set<string>();
    const chain: AgentEntity[] = [];
    visited.add(startEntityName);

    let currentName = startEntityName;

    for (let depth = 0; depth < this.config.maxCauseChainLength; depth++) {
      // Find CAUSED_BY relations from the current entity
      const relations = this.storage.getRelationsFrom(currentName);
      let foundNext = false;

      for (const rel of relations) {
        if (rel.relationType !== EpisodicRelations.CAUSED_BY) continue;
        if (visited.has(rel.to)) continue;

        const causeEntity = this.storage.getEntityByName(rel.to);
        if (!causeEntity || !isAgentEntity(causeEntity)) continue;

        visited.add(rel.to);
        chain.push(causeEntity as AgentEntity);
        currentName = rel.to;
        foundNext = true;
        break; // Follow only the first unvisited cause
      }

      if (!foundNext) break;
    }

    return chain;
  }

  // ==================== Lesson Generation ====================

  /**
   * Build a human-readable failure description from an episode and its cause chain.
   * @internal
   */
  private buildFailureDescription(
    episode: AgentEntity,
    causeChain: AgentEntity[]
  ): string {
    const content = episode.observations[0] ?? episode.name;
    if (causeChain.length === 0) {
      return `Failure: ${content}`;
    }
    const rootCause = causeChain[causeChain.length - 1];
    const rootContent = rootCause.observations[0] ?? rootCause.name;
    return `Failure: ${content} (root cause: ${rootContent})`;
  }

  /**
   * Build an actionable lesson from an episode and its cause chain.
   * @internal
   */
  private buildLesson(episode: AgentEntity, causeChain: AgentEntity[]): string {
    const content = episode.observations[0] ?? episode.name;
    if (causeChain.length === 0) {
      return `Avoid: ${content}`;
    }
    const rootCause = causeChain[causeChain.length - 1];
    const rootContent = rootCause.observations[0] ?? rootCause.name;
    return `To prevent "${content}", address root cause: "${rootContent}"`;
  }

  // ==================== Entity Creation ====================

  /**
   * Persist a distilled lesson as a procedural memory entity.
   *
   * @param lesson - The lesson to persist
   * @param sessionId - Source session ID
   * @returns The name of the created entity
   * @internal
   */
  private async createLessonEntity(
    lesson: DistilledLesson,
    sessionId: string
  ): Promise<string> {
    const now = new Date().toISOString();

    // Use crypto.randomUUID() for collision-resistant unique names, with a
    // retry loop to handle the (extremely rare) case of a pre-existing entity.
    const MAX_ATTEMPTS = 10;
    let name: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = `lesson_${randomUUID()}`;
      if (!this.storage.getEntityByName(candidate)) {
        name = candidate;
        break;
      }
    }
    if (!name) {
      throw new Error('FailureDistillation: could not generate unique lesson entity name');
    }

    const observations = [
      lesson.failureDescription,
      lesson.lesson,
      `Confidence: ${lesson.confidence.toFixed(2)}`,
      `Cause chain length: ${lesson.causeChain.length}`,
      `Source session: ${sessionId}`,
    ];

    const entity: AgentEntity = {
      name,
      entityType: this.config.lessonEntityType,
      observations,
      createdAt: now,
      lastModified: now,
      importance: Math.round(lesson.confidence * 10),
      memoryType: 'procedural',
      sessionId,
      accessCount: 0,
      confidence: lesson.confidence,
      confirmationCount: 0,
      visibility: 'private',
    };

    await this.storage.appendEntity(entity as Entity);

    return name;
  }
}
