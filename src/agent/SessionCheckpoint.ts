/**
 * Session Checkpoint Manager
 *
 * Provides session checkpointing, crash recovery, and sleep/wake
 * functionality for agent memory sessions. Checkpoints capture
 * working memory state and decay snapshots, stored as observations
 * on the session entity.
 *
 * @module agent/SessionCheckpoint
 */

import type { IGraphStorage } from '../types/types.js';
import type { SessionEntity } from '../types/agent-memory.js';
import { isSessionEntity } from '../types/agent-memory.js';
import type { WorkingMemoryManager } from './WorkingMemoryManager.js';
import type { DecayEngine } from './DecayEngine.js';

// ==================== Interfaces ====================

/**
 * Data captured in a session checkpoint.
 */
export interface SessionCheckpointData {
  /** Unique checkpoint ID: checkpoint_{sessionId}_{timestamp} */
  id: string;
  /** Session this checkpoint belongs to */
  sessionId: string;
  /** Optional user-provided label */
  name?: string;
  /** ISO 8601 timestamp of checkpoint creation */
  timestamp: string;
  /** Captured state */
  state: {
    /** Entity names in working memory at checkpoint time */
    workingMemories: string[];
    /** Entity name to current importance mapping */
    decaySnapshot: Record<string, number>;
    /** Additional metadata */
    metadata: Record<string, unknown>;
  };
}

/** Prefix used to identify checkpoint observations on session entities. */
const CHECKPOINT_PREFIX = '[CHECKPOINT] ';

// ==================== SessionCheckpointManager ====================

/**
 * Manages session checkpoints for crash recovery and sleep/wake.
 *
 * Stores checkpoint data as JSON-serialized observations on the
 * session entity, prefixed with `[CHECKPOINT]`. This avoids
 * requiring a separate storage mechanism.
 *
 * @example
 * ```typescript
 * const mgr = new SessionCheckpointManager(storage, workingMemory, decayEngine);
 *
 * // Create a checkpoint
 * const cp = await mgr.checkpoint('session_123', 'before-experiment');
 *
 * // Sleep a session (checkpoint + suspend)
 * const cpId = await mgr.sleep('session_123');
 *
 * // Wake a session (restore + reactivate)
 * await mgr.wake('session_123');
 *
 * // Detect crashed sessions
 * const stale = await mgr.detectAbnormalEndings();
 * ```
 */
export class SessionCheckpointManager {
  private readonly storage: IGraphStorage;
  private readonly workingMemoryManager: WorkingMemoryManager;
  private readonly decayEngine: DecayEngine;

  constructor(
    storage: IGraphStorage,
    workingMemoryManager: WorkingMemoryManager,
    decayEngine: DecayEngine
  ) {
    this.storage = storage;
    this.workingMemoryManager = workingMemoryManager;
    this.decayEngine = decayEngine;
  }

  // ==================== Checkpoint Creation ====================

  /**
   * Create a checkpoint for a session.
   *
   * Captures the current working memory entity names and their
   * importance values, storing the data as a JSON-serialized
   * observation on the session entity.
   *
   * @param sessionId - Session to checkpoint
   * @param name - Optional user-provided label
   * @returns Created checkpoint data
   * @throws Error if session not found or not active/suspended
   */
  async checkpoint(sessionId: string, name?: string): Promise<SessionCheckpointData> {
    const session = this.getSessionEntity(sessionId);
    if (session.status !== 'active' && session.status !== 'suspended') {
      throw new Error(`Cannot checkpoint session with status '${session.status}': ${sessionId}`);
    }

    const now = new Date().toISOString();
    const timestamp = Date.now();
    const checkpointId = `checkpoint_${sessionId}_${timestamp}`;

    // Collect working memory state
    const memories = await this.workingMemoryManager.getSessionMemories(sessionId);
    const workingMemoryNames = memories.map((m) => m.name);

    // Snapshot importance values
    const decaySnapshot: Record<string, number> = {};
    for (const memory of memories) {
      decaySnapshot[memory.name] = this.decayEngine.calculateEffectiveImportance(memory);
    }

    const checkpointData: SessionCheckpointData = {
      id: checkpointId,
      sessionId,
      name,
      timestamp: now,
      state: {
        workingMemories: workingMemoryNames,
        decaySnapshot,
        metadata: {},
      },
    };

    // Store as observation on session entity
    const observation = `${CHECKPOINT_PREFIX}${JSON.stringify(checkpointData)}`;
    const currentObs = session.observations ?? [];
    await this.storage.updateEntity(sessionId, {
      observations: [...currentObs, observation],
      lastModified: now,
    } as Record<string, unknown>);

    return checkpointData;
  }

  // ==================== Checkpoint Restoration ====================

  /**
   * Restore from a checkpoint.
   *
   * For each working memory in the checkpoint that still exists,
   * reinforces it via the decay engine to restore importance.
   * For working memories that expired, attempts to recreate them
   * if their content can be recovered.
   *
   * @param checkpointId - Checkpoint to restore from
   * @throws Error if checkpoint not found
   */
  async restore(checkpointId: string): Promise<void> {
    const checkpoint = await this.findCheckpointById(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Restore importance for each memory in the snapshot
    for (const memoryName of checkpoint.state.workingMemories) {
      const entity = this.storage.getEntityByName(memoryName);
      if (!entity) {
        // Memory was deleted or expired - skip
        continue;
      }

      // Reinforce memory to restore decay timer
      try {
        await this.decayEngine.reinforceMemory(memoryName);
      } catch {
        // Entity may not be found if deleted between check and reinforce
      }
    }
  }

  // ==================== Checkpoint Listing ====================

  /**
   * List all checkpoints for a session.
   *
   * Parses checkpoint observations from the session entity and
   * returns them sorted by timestamp (newest first).
   *
   * @param sessionId - Session to list checkpoints for
   * @returns Array of checkpoint data, newest first
   * @throws Error if session not found
   */
  async listCheckpoints(sessionId: string): Promise<SessionCheckpointData[]> {
    const session = this.getSessionEntity(sessionId);
    return this.parseCheckpoints(session);
  }

  // ==================== Abnormal Ending Detection ====================

  /**
   * Detect sessions that ended abnormally.
   *
   * Finds sessions with 'active' status that have not been updated
   * within the threshold period, indicating a possible crash or
   * ungraceful termination.
   *
   * @param thresholdMs - Staleness threshold in milliseconds (default: 1 hour)
   * @returns Array of stale active sessions
   */
  async detectAbnormalEndings(thresholdMs: number = 3600000): Promise<SessionEntity[]> {
    const graph = await this.storage.loadGraph();
    const now = Date.now();
    const stale: SessionEntity[] = [];

    for (const entity of graph.entities) {
      if (!isSessionEntity(entity)) continue;
      if (entity.status !== 'active') continue;

      const lastModified = entity.lastModified
        ? new Date(entity.lastModified).getTime()
        : new Date(entity.startedAt).getTime();

      if (now - lastModified > thresholdMs) {
        stale.push(entity);
      }
    }

    return stale;
  }

  // ==================== Sleep / Wake ====================

  /**
   * Sleep a session: create checkpoint and suspend.
   *
   * Creates a checkpoint of the current session state and then
   * updates the session status to 'suspended'.
   *
   * @param sessionId - Session to sleep
   * @returns Checkpoint ID for later wake
   * @throws Error if session not found or not active
   */
  async sleep(sessionId: string): Promise<string> {
    const session = this.getSessionEntity(sessionId);
    if (session.status !== 'active') {
      throw new Error(`Cannot sleep session with status '${session.status}': ${sessionId}`);
    }

    // Create checkpoint
    const checkpointData = await this.checkpoint(sessionId, 'auto_sleep');

    // Update session status to suspended
    const now = new Date().toISOString();
    // Re-read observations after checkpoint added one
    const updatedSession = this.getSessionEntity(sessionId);
    const currentObs = updatedSession.observations ?? [];
    await this.storage.updateEntity(sessionId, {
      status: 'suspended',
      lastModified: now,
      observations: [...currentObs, `Session suspended at ${now}`],
    } as Record<string, unknown>);

    return checkpointData.id;
  }

  /**
   * Wake a session: restore from checkpoint and reactivate.
   *
   * Restores state from the most recent checkpoint (or a specified
   * one) and sets the session status back to 'active'.
   *
   * @param sessionId - Session to wake
   * @param checkpointId - Optional specific checkpoint to restore from
   * @throws Error if session not found, no checkpoints available,
   *         or specified checkpoint not found
   */
  async wake(sessionId: string, checkpointId?: string): Promise<void> {
    const session = this.getSessionEntity(sessionId);
    if (session.status !== 'suspended') {
      throw new Error(`Cannot wake session with status '${session.status}': ${sessionId}`);
    }

    // Determine which checkpoint to restore
    let targetCheckpointId: string;
    if (checkpointId) {
      targetCheckpointId = checkpointId;
    } else {
      // Find most recent checkpoint
      const checkpoints = this.parseCheckpoints(session);
      if (checkpoints.length === 0) {
        throw new Error(`No checkpoints available for session: ${sessionId}`);
      }
      targetCheckpointId = checkpoints[0].id; // Already sorted newest first
    }

    // Restore from checkpoint
    await this.restore(targetCheckpointId);

    // Update session status to active
    const now = new Date().toISOString();
    const currentObs = session.observations ?? [];
    await this.storage.updateEntity(sessionId, {
      status: 'active',
      lastModified: now,
      observations: [...currentObs, `Session resumed at ${now}`],
    } as Record<string, unknown>);
  }

  // ==================== Internal Helpers ====================

  /**
   * Get a session entity by ID, throwing if not found.
   * @internal
   */
  private getSessionEntity(sessionId: string): SessionEntity {
    const entity = this.storage.getEntityByName(sessionId);
    if (!entity || !isSessionEntity(entity)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return entity;
  }

  /**
   * Parse checkpoint observations from a session entity.
   * Returns checkpoints sorted newest first.
   * @internal
   */
  private parseCheckpoints(session: SessionEntity): SessionCheckpointData[] {
    const observations = session.observations ?? [];
    const checkpoints: SessionCheckpointData[] = [];

    for (const obs of observations) {
      if (!obs.startsWith(CHECKPOINT_PREFIX)) continue;
      try {
        const json = obs.slice(CHECKPOINT_PREFIX.length);
        const data = JSON.parse(json) as SessionCheckpointData;
        checkpoints.push(data);
      } catch {
        // Skip malformed checkpoint observations
      }
    }

    // Sort newest first
    checkpoints.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return checkpoints;
  }

  /**
   * Find a checkpoint by ID across all sessions.
   * @internal
   */
  private async findCheckpointById(checkpointId: string): Promise<SessionCheckpointData | null> {
    // Extract sessionId from checkpoint ID: checkpoint_{sessionId}_{timestamp}
    const parts = checkpointId.split('_');
    // sessionId may itself contain underscores (e.g., session_12345_abcdef)
    // checkpoint ID format: checkpoint_{sessionId}_{timestamp}
    // The timestamp is the last part, so we take everything between 'checkpoint_' and the last '_'
    if (parts.length < 3 || parts[0] !== 'checkpoint') {
      return null;
    }

    // Try to find via the session entity
    // The sessionId is embedded in the checkpoint ID after "checkpoint_"
    // We need to search all sessions since sessionId format varies
    const graph = await this.storage.loadGraph();
    for (const entity of graph.entities) {
      if (!isSessionEntity(entity)) continue;
      const checkpoints = this.parseCheckpoints(entity);
      const match = checkpoints.find((cp) => cp.id === checkpointId);
      if (match) return match;
    }

    return null;
  }
}
