/**
 * Session Manager
 *
 * Manages conversation/task session lifecycle including creation,
 * updates, ending, and session linking for continuity tracking.
 *
 * @module agent/SessionManager
 */

import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  SessionEntity,
  SessionStatus,
} from '../types/agent-memory.js';
import { isSessionEntity } from '../types/agent-memory.js';
import { WorkingMemoryManager } from './WorkingMemoryManager.js';

/**
 * Configuration for SessionManager.
 */
export interface SessionConfig {
  /** Consolidate memories on session end (default: false) */
  consolidateOnEnd?: boolean;
  /** Delete working memories on end (default: false) */
  cleanupOnEnd?: boolean;
  /** Promote high-confidence memories on end (default: true) */
  promoteOnEnd?: boolean;
  /** Default agent ID for sessions */
  defaultAgentId?: string;
}

/**
 * Options for starting a new session.
 */
export interface StartSessionOptions {
  /** Description of session goal */
  goalDescription?: string;
  /** Type of task being performed */
  taskType?: string;
  /** Detected user intent */
  userIntent?: string;
  /** Continue from previous session */
  previousSessionId?: string;
  /** Agent ID for multi-agent */
  agentId?: string;
  /** Custom session ID (default: auto-generated) */
  sessionId?: string;
}

/**
 * Options for querying session history.
 */
export interface SessionHistoryOptions {
  /** Filter by status */
  status?: SessionStatus;
  /** Filter by task type */
  taskType?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Start date filter (ISO 8601) */
  startDate?: string;
  /** End date filter (ISO 8601) */
  endDate?: string;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of ending a session.
 */
export interface EndSessionResult {
  /** Updated session entity */
  session: SessionEntity;
  /** Number of memories cleaned up */
  memoriesCleaned: number;
  /** Number of memories promoted */
  memoriesPromoted: number;
}

/**
 * Manages session lifecycle for conversations and tasks.
 *
 * SessionManager is the primary interface for conversation/task session
 * management. It coordinates with WorkingMemoryManager for memory scoping
 * and provides lifecycle management including creation, ending, and linking.
 *
 * @example
 * ```typescript
 * const sm = new SessionManager(storage, workingMemory);
 *
 * // Start a new session
 * const session = await sm.startSession({
 *   goalDescription: 'Plan a trip to Tokyo',
 *   taskType: 'trip_planning',
 * });
 *
 * // Create memories during session
 * await workingMemory.createWorkingMemory(
 *   session.sessionId,
 *   'User prefers budget hotels'
 * );
 *
 * // End session with promotion
 * const result = await sm.endSession(session.sessionId, 'completed');
 * console.log(`Promoted ${result.memoriesPromoted} memories`);
 * ```
 */
export class SessionManager {
  private readonly storage: IGraphStorage;
  private readonly workingMemory: WorkingMemoryManager;
  private readonly config: Required<SessionConfig>;

  // Active sessions: sessionId -> SessionEntity
  private activeSessions: Map<string, SessionEntity>;

  constructor(
    storage: IGraphStorage,
    workingMemory: WorkingMemoryManager,
    config: SessionConfig = {}
  ) {
    this.storage = storage;
    this.workingMemory = workingMemory;
    this.config = {
      consolidateOnEnd: config.consolidateOnEnd ?? false,
      cleanupOnEnd: config.cleanupOnEnd ?? false,
      promoteOnEnd: config.promoteOnEnd ?? true,
      defaultAgentId: config.defaultAgentId ?? 'default',
    };
    this.activeSessions = new Map();
  }

  // ==================== Session ID Generation ====================

  /**
   * Generate a unique session ID.
   * @internal
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
  }

  // ==================== Session Creation ====================

  /**
   * Start a new session.
   *
   * Creates a SessionEntity with active status and stores it in both
   * storage and the active sessions map. Supports continuation from
   * a previous session via previousSessionId.
   *
   * @param options - Session configuration options
   * @returns Created SessionEntity
   * @throws Error if custom sessionId already exists
   *
   * @example
   * ```typescript
   * // Start a new session
   * const session = await sm.startSession({
   *   goalDescription: 'Help with coding task',
   *   taskType: 'coding',
   * });
   *
   * // Continue from a previous session
   * const continued = await sm.startSession({
   *   previousSessionId: 'session_123_abc',
   *   goalDescription: 'Continue trip planning',
   * });
   * ```
   */
  async startSession(options?: StartSessionOptions): Promise<SessionEntity> {
    const now = new Date().toISOString();
    const sessionId = options?.sessionId ?? this.generateSessionId();

    // Check if session already exists
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    // Also check storage for existing session
    const existing = this.storage.getEntityByName(sessionId);
    if (existing) {
      throw new Error(`Session already exists in storage: ${sessionId}`);
    }

    // Build observations array
    const observations: string[] = [];
    if (options?.goalDescription) {
      observations.push(`Session goal: ${options.goalDescription}`);
    }

    const session: SessionEntity = {
      // Base Entity fields
      name: sessionId,
      entityType: 'session',
      observations,
      createdAt: now,
      lastModified: now,
      importance: 5,

      // AgentEntity fields
      memoryType: 'episodic',
      sessionId: sessionId,
      accessCount: 0,
      lastAccessedAt: now,
      confidence: 1.0,
      confirmationCount: 0,
      visibility: 'private',
      agentId: options?.agentId ?? this.config.defaultAgentId,

      // SessionEntity fields
      startedAt: now,
      status: 'active',
      goalDescription: options?.goalDescription,
      taskType: options?.taskType,
      userIntent: options?.userIntent,
      memoryCount: 0,
      consolidatedCount: 0,
      previousSessionId: options?.previousSessionId,
      relatedSessionIds: options?.previousSessionId ? [options.previousSessionId] : [],
    };

    // If continuing from previous, link back
    if (options?.previousSessionId) {
      const prevSession = this.storage.getEntityByName(options.previousSessionId);
      if (prevSession && isSessionEntity(prevSession)) {
        const relatedIds = prevSession.relatedSessionIds ?? [];
        if (!relatedIds.includes(sessionId)) {
          await this.storage.updateEntity(options.previousSessionId, {
            relatedSessionIds: [...relatedIds, sessionId],
            lastModified: now,
          } as Record<string, unknown>);
        }
      }
    }

    // Persist to storage
    await this.storage.appendEntity(session as Entity);

    // Track as active
    this.activeSessions.set(sessionId, session);

    return session;
  }

  // ==================== Session Ending ====================

  /**
   * End a session.
   *
   * Updates the session with end timestamp and status, optionally
   * promotes high-confidence memories and cleans up working memories
   * based on configuration.
   *
   * @param sessionId - Session to end
   * @param status - Ending status ('completed' or 'abandoned')
   * @returns End session result with statistics
   * @throws Error if session not found or not active
   *
   * @example
   * ```typescript
   * // End a completed session
   * const result = await sm.endSession('session_123', 'completed');
   * console.log(`Promoted ${result.memoriesPromoted} memories`);
   * console.log(`Cleaned ${result.memoriesCleaned} memories`);
   *
   * // Abandon a session
   * await sm.endSession('session_456', 'abandoned');
   * ```
   */
  async endSession(
    sessionId: string,
    status: 'completed' | 'abandoned' = 'completed'
  ): Promise<EndSessionResult> {
    // Try to get from active sessions first, then storage
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      const stored = this.storage.getEntityByName(sessionId);
      if (stored && isSessionEntity(stored)) {
        session = stored;
      }
    }

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session is not active: ${sessionId}`);
    }

    const now = new Date().toISOString();
    let memoriesCleaned = 0;
    let memoriesPromoted = 0;

    // Get session memories for statistics
    const sessionMemories = await this.workingMemory.getSessionMemories(sessionId);
    const memoryCount = sessionMemories.length;

    // Promote candidates if configured
    if (this.config.promoteOnEnd) {
      const candidates = await this.workingMemory.getPromotionCandidates(sessionId);
      for (const candidate of candidates) {
        try {
          await this.workingMemory.promoteMemory(candidate.name, 'episodic');
          memoriesPromoted++;
        } catch {
          // Continue on promotion failure
        }
      }
    }

    // Cleanup working memories if configured
    if (this.config.cleanupOnEnd) {
      const remainingMemories = await this.workingMemory.getSessionMemories(sessionId);
      for (const memory of remainingMemories) {
        // Delete non-promoted working memories
        const graph = await this.storage.getGraphForMutation();
        graph.entities = graph.entities.filter((e) => e.name !== memory.name);
        graph.relations = graph.relations.filter(
          (r) => r.from !== memory.name && r.to !== memory.name
        );
        await this.storage.saveGraph(graph);
        memoriesCleaned++;
      }
    }

    // Update session
    const currentObs = session.observations ?? [];
    const updates: Record<string, unknown> = {
      endedAt: now,
      status,
      memoryCount,
      consolidatedCount: memoriesPromoted,
      lastModified: now,
      observations: [...currentObs, `Session ended: ${status} at ${now}`],
    };

    await this.storage.updateEntity(sessionId, updates);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Build updated session
    const updatedSession: SessionEntity = {
      ...session,
      endedAt: now,
      status,
      memoryCount,
      consolidatedCount: memoriesPromoted,
      lastModified: now,
      observations: [...currentObs, `Session ended: ${status} at ${now}`],
    };

    return {
      session: updatedSession,
      memoriesCleaned,
      memoriesPromoted,
    };
  }

  // ==================== Session Queries ====================

  /**
   * Get active session(s).
   *
   * @param sessionId - Optional specific session ID
   * @returns Active session or undefined
   *
   * @example
   * ```typescript
   * // Get specific active session
   * const session = await sm.getActiveSession('session_123');
   *
   * // Get first active session
   * const any = await sm.getActiveSession();
   * ```
   */
  async getActiveSession(sessionId?: string): Promise<SessionEntity | undefined> {
    if (sessionId) {
      return this.activeSessions.get(sessionId);
    }

    // Return first active session if no ID specified
    const [first] = this.activeSessions.values();
    return first;
  }

  /**
   * Get all active sessions.
   *
   * @returns Array of active SessionEntity objects
   */
  getActiveSessions(): SessionEntity[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get session history with filtering.
   *
   * Returns sessions from storage matching the provided filters,
   * sorted by most recent first with pagination support.
   *
   * @param options - Filter and pagination options
   * @returns Matching sessions
   *
   * @example
   * ```typescript
   * // Get all completed sessions
   * const completed = await sm.getSessionHistory({
   *   status: 'completed',
   * });
   *
   * // Get sessions from last week
   * const recent = await sm.getSessionHistory({
   *   startDate: '2026-01-06T00:00:00Z',
   *   limit: 20,
   * });
   *
   * // Get sessions by task type with pagination
   * const codingSessions = await sm.getSessionHistory({
   *   taskType: 'coding',
   *   limit: 10,
   *   offset: 20,
   * });
   * ```
   */
  async getSessionHistory(options?: SessionHistoryOptions): Promise<SessionEntity[]> {
    const graph = await this.storage.loadGraph();
    let sessions: SessionEntity[] = [];

    // Find all sessions
    for (const entity of graph.entities) {
      if (!isSessionEntity(entity)) continue;
      sessions.push(entity);
    }

    // Apply filters
    if (options?.status) {
      sessions = sessions.filter((s) => s.status === options.status);
    }
    if (options?.taskType) {
      sessions = sessions.filter((s) => s.taskType === options.taskType);
    }
    if (options?.agentId) {
      sessions = sessions.filter((s) => s.agentId === options.agentId);
    }
    if (options?.startDate) {
      const startTime = new Date(options.startDate).getTime();
      sessions = sessions.filter(
        (s) => new Date(s.startedAt).getTime() >= startTime
      );
    }
    if (options?.endDate) {
      const endTime = new Date(options.endDate).getTime();
      sessions = sessions.filter(
        (s) => new Date(s.startedAt).getTime() <= endTime
      );
    }

    // Sort by startedAt descending (most recent first)
    sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return sessions.slice(offset, offset + limit);
  }

  // ==================== Session Linking ====================

  /**
   * Link multiple sessions as related.
   *
   * Updates relatedSessionIds on all specified sessions to include
   * references to each other, enabling bidirectional traversal.
   *
   * @param sessionIds - Sessions to link (minimum 2)
   * @throws Error if less than 2 sessions or any not found
   *
   * @example
   * ```typescript
   * // Link three related sessions
   * await sm.linkSessions([
   *   'session_123',
   *   'session_456',
   *   'session_789',
   * ]);
   * ```
   */
  async linkSessions(sessionIds: string[]): Promise<void> {
    if (sessionIds.length < 2) {
      throw new Error('At least 2 sessions required for linking');
    }

    const now = new Date().toISOString();

    // Verify all sessions exist
    for (const id of sessionIds) {
      const session = this.storage.getEntityByName(id);
      if (!session || !isSessionEntity(session)) {
        throw new Error(`Session not found: ${id}`);
      }
    }

    // Update each session with all related IDs
    for (const id of sessionIds) {
      const session = this.storage.getEntityByName(id) as SessionEntity;
      const existingRelated = new Set(session.relatedSessionIds ?? []);

      // Add all other session IDs
      for (const otherId of sessionIds) {
        if (otherId !== id) {
          existingRelated.add(otherId);
        }
      }

      await this.storage.updateEntity(id, {
        relatedSessionIds: Array.from(existingRelated),
        lastModified: now,
      } as Record<string, unknown>);
    }
  }

  /**
   * Get chain of linked sessions starting from a session.
   *
   * Traverses previousSessionId and relatedSessionIds to build
   * a chain of connected sessions, sorted from oldest to newest.
   *
   * @param sessionId - Starting session
   * @returns Chain of sessions (oldest to newest)
   *
   * @example
   * ```typescript
   * // Get full conversation chain
   * const chain = await sm.getSessionChain('session_latest');
   * console.log(`Chain has ${chain.length} sessions`);
   * for (const s of chain) {
   *   console.log(`${s.sessionId}: ${s.goalDescription}`);
   * }
   * ```
   */
  async getSessionChain(sessionId: string): Promise<SessionEntity[]> {
    const visited = new Set<string>();
    const chain: SessionEntity[] = [];

    const traverse = async (id: string): Promise<void> => {
      if (visited.has(id)) return;
      visited.add(id);

      const session = this.storage.getEntityByName(id);
      if (!session || !isSessionEntity(session)) return;

      // Traverse to previous
      if (session.previousSessionId && !visited.has(session.previousSessionId)) {
        await traverse(session.previousSessionId);
      }

      // Add current
      chain.push(session);

      // Traverse to related that continue from this
      for (const relatedId of session.relatedSessionIds ?? []) {
        const related = this.storage.getEntityByName(relatedId);
        if (
          related &&
          isSessionEntity(related) &&
          related.previousSessionId === id
        ) {
          await traverse(relatedId);
        }
      }
    };

    await traverse(sessionId);

    // Sort by startedAt
    chain.sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    return chain;
  }

  // ==================== Configuration Access ====================

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<SessionConfig>> {
    return { ...this.config };
  }

  /**
   * Get the count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
