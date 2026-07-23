/**
 * Session Checkpoint Manager
 *
 * Provides session checkpointing, crash recovery, and sleep/wake
 * functionality for agent memory sessions. Checkpoints are persisted as
 * real graph structure instead of JSON blobs, so checkpoint content is
 * queryable and traversable:
 *
 * - Each checkpoint is its own `entityType: 'session-checkpoint'` entity
 *   (name = checkpoint id `checkpoint_{sessionId}_{timestamp}`), with
 *   `parentId` set to the session entity for hierarchy integration.
 * - Scalar fields are human-readable observation lines:
 *   `[session-id]: <id>`, `[label]: <name>` (when present), and
 *   `[created-at]: <ISO timestamp>`.
 * - The working-memory snapshot is one line per memory:
 *   `[working-memory]: <JSON-name>` for membership (order-preserving) and
 *   `[decay]: <JSON-name>=<importance>` for the importance snapshot —
 *   names are JSON-encoded so arbitrary strings (equals signs, newlines,
 *   unicode) roundtrip.
 * - Arbitrary metadata roundtrips via `[meta]: <JSON-key>=<JSON-value>`
 *   lines (key and value JSON-encoded separately).
 * - Relations wire it together: session —`has_checkpoint`→ checkpoint,
 *   and checkpoint —`snapshots`→ each working-memory entity that still
 *   exists at write time. Observation lines remain the source of truth
 *   for the snapshot content (so a checkpoint survives working-memory
 *   deletion, whose cascade drops the `snapshots` relation).
 *
 * Ordering: `listCheckpoints` sorts by the `[created-at]` scalar (newest
 * first, ties broken by the numeric id suffix) — the module only ever
 * needs "latest checkpoint", so no `precedes` chain is maintained.
 *
 * Legacy `[CHECKPOINT] {json}` observations on session entities remain
 * decodable via `decodeLegacyCheckpoint` and are auto-migrated to the
 * decomposed shape on read; use `migrateLegacySessionCheckpoints` for
 * bulk migration.
 *
 * @module agent/SessionCheckpoint
 */

import type { Entity, IGraphStorage, Relation } from '../types/types.js';
import type { SessionEntity } from '../types/agent-memory.js';
import { isSessionEntity } from '../types/agent-memory.js';
import { EntityNotFoundError } from '../utils/errors.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { RelationManager } from '../core/RelationManager.js';
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

// ==================== Constants ====================

/** Legacy sentinel prefix for JSON-blob checkpoint observations. */
const LEGACY_CHECKPOINT_PREFIX = '[CHECKPOINT] ';

/** Entity type for decomposed checkpoint entities. */
export const SESSION_CHECKPOINT_ENTITY_TYPE = 'session-checkpoint';

/** Relation type: session —has_checkpoint→ checkpoint entity. */
export const HAS_CHECKPOINT_RELATION = 'has_checkpoint';

/** Relation type: checkpoint —snapshots→ working-memory entity. */
export const SNAPSHOTS_RELATION = 'snapshots';

/** Scalar observation prefixes on checkpoint entities. */
const SESSION_ID_PREFIX = '[session-id]: ';
const LABEL_PREFIX = '[label]: ';
const CREATED_AT_PREFIX = '[created-at]: ';

/** List observation prefixes on checkpoint entities. */
const WORKING_MEMORY_PREFIX = '[working-memory]: ';
const DECAY_PREFIX = '[decay]: ';
const META_PREFIX = '[meta]: ';

// ==================== SessionCheckpointManager ====================

/**
 * Manages session checkpoints for crash recovery and sleep/wake.
 *
 * Persists each checkpoint as a dedicated `session-checkpoint` entity
 * linked to its session via a `has_checkpoint` relation (see the module
 * doc for the full decomposed schema). Legacy JSON-blob checkpoints
 * stored as `[CHECKPOINT]` observations on session entities are
 * auto-migrated on read.
 *
 * @example
 * ```typescript
 * const mgr = new SessionCheckpointManager(
 *   storage, workingMemory, decayEngine, entityManager, relationManager
 * );
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
  private readonly entityManager: EntityManager;
  private readonly relationManager: RelationManager;

  constructor(
    storage: IGraphStorage,
    workingMemoryManager: WorkingMemoryManager,
    decayEngine: DecayEngine,
    entityManager: EntityManager,
    relationManager: RelationManager
  ) {
    this.storage = storage;
    this.workingMemoryManager = workingMemoryManager;
    this.decayEngine = decayEngine;
    this.entityManager = entityManager;
    this.relationManager = relationManager;
  }

  // ==================== Checkpoint Creation ====================

  /**
   * Create a checkpoint for a session.
   *
   * Captures the current working memory entity names and their
   * importance values, persisting them as a dedicated
   * `session-checkpoint` entity plus linking relations.
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

    // Entity names must be unique — bump the millisecond timestamp while
    // the derived name is taken (rapid successive checkpoints can land in
    // the same millisecond).
    let timestamp = Date.now();
    while (this.storage.getEntityByName(`checkpoint_${sessionId}_${timestamp}`)) {
      timestamp++;
    }
    const checkpointId = `checkpoint_${sessionId}_${timestamp}`;
    const now = new Date(timestamp).toISOString();

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

    // Persist as a decomposed checkpoint entity + relations
    await persistDecomposedCheckpoints(
      this.entityManager,
      this.relationManager,
      [checkpointData]
    );

    // Keep the session's liveness signal fresh (detectAbnormalEndings
    // keys off lastModified).
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- session existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
    await this.storage.updateEntity(sessionId, {
      lastModified: new Date().toISOString(),
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
   * Collects `session-checkpoint` entities linked to the session via
   * `has_checkpoint` relations and returns them sorted by creation time
   * (newest first). Legacy `[CHECKPOINT]` blob observations found on the
   * session entity are auto-migrated to the decomposed shape first.
   *
   * @param sessionId - Session to list checkpoints for
   * @returns Array of checkpoint data, newest first
   * @throws Error if session not found
   */
  async listCheckpoints(sessionId: string): Promise<SessionCheckpointData[]> {
    const session = this.getSessionEntity(sessionId);
    await this.migrateSessionLegacyCheckpoints(session);
    return this.collectCheckpoints(sessionId);
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
    // Re-read observations in case checkpointing mutated the session
    const updatedSession = this.getSessionEntity(sessionId);
    const currentObs = updatedSession.observations ?? [];
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- session existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
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
      // Find most recent checkpoint (auto-migrates legacy blobs)
      const checkpoints = await this.listCheckpoints(sessionId);
      if (checkpoints.length === 0) {
        throw new Error(`No checkpoints available for session: ${sessionId}`);
      }
      targetCheckpointId = checkpoints[0].id; // Already sorted newest first
    }

    // Restore from checkpoint
    await this.restore(targetCheckpointId);

    // Update session status to active. Re-read observations in case
    // legacy-checkpoint migration rewrote them above.
    const now = new Date().toISOString();
    const currentSession = this.getSessionEntity(sessionId);
    const currentObs = currentSession.observations ?? [];
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- session existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
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
   * Collect decomposed checkpoint entities for a session via its
   * `has_checkpoint` relations. Returns checkpoints sorted newest first.
   * @internal
   */
  private async collectCheckpoints(sessionId: string): Promise<SessionCheckpointData[]> {
    const relations = await this.relationManager.getRelations(sessionId);
    const checkpoints: SessionCheckpointData[] = [];
    for (const rel of relations) {
      if (rel.from !== sessionId || rel.relationType !== HAS_CHECKPOINT_RELATION) continue;
      const entity = this.storage.getEntityByName(rel.to);
      if (!entity || entity.entityType !== SESSION_CHECKPOINT_ENTITY_TYPE) continue;
      checkpoints.push(decodeCheckpointEntity(entity));
    }
    checkpoints.sort(compareNewestFirst);
    return checkpoints;
  }

  /**
   * Auto-migrate any legacy `[CHECKPOINT]` blob observations on the given
   * session entity to the decomposed shape, stripping the migrated blobs
   * from the session's observations. Malformed blobs are left in place
   * (they were already skipped by the legacy parser). Returns the
   * migrated checkpoints (empty when nothing was migrated).
   * @internal
   */
  private async migrateSessionLegacyCheckpoints(
    session: SessionEntity
  ): Promise<SessionCheckpointData[]> {
    return migrateSessionEntityCheckpoints(
      this.entityManager,
      this.relationManager,
      session
    );
  }

  /**
   * Find a checkpoint by ID. Checkpoint IDs double as entity names, so
   * the decomposed lookup is O(1); when the entity is missing, sessions
   * still carrying legacy blobs are migrated and re-checked.
   * @internal
   */
  private async findCheckpointById(checkpointId: string): Promise<SessionCheckpointData | null> {
    const entity = this.storage.getEntityByName(checkpointId);
    if (entity && entity.entityType === SESSION_CHECKPOINT_ENTITY_TYPE) {
      return decodeCheckpointEntity(entity);
    }

    // Legacy fallback: migrate sessions that still store checkpoint
    // blobs, then look for the requested id among what was migrated.
    const graph = await this.storage.loadGraph();
    const legacySessions = graph.entities.filter(
      (e): e is SessionEntity => isSessionEntity(e) && hasLegacyCheckpointObservations(e.observations ?? [])
    );
    for (const session of legacySessions) {
      const migrated = await this.migrateSessionLegacyCheckpoints(session);
      const match = migrated.find((cp) => cp.id === checkpointId);
      if (match) return match;
    }

    return null;
  }
}

// ==================== Bulk Migration ====================

/**
 * Scan every session entity and migrate any legacy `[CHECKPOINT] {json}`
 * blob observations to the decomposed graph shape (checkpoint entities +
 * `has_checkpoint` / `snapshots` relations), mirroring
 * `migrateLegacyProcedures`.
 *
 * @returns Number of checkpoints migrated.
 */
export async function migrateLegacySessionCheckpoints(
  entityManager: EntityManager,
  relationManager: RelationManager
): Promise<number> {
  const sessions = await entityManager.listEntities({ entityType: 'session' });
  const legacySessions = sessions.filter(
    (e): e is SessionEntity => isSessionEntity(e) && hasLegacyCheckpointObservations(e.observations ?? [])
  );

  let migrated = 0;
  for (const session of legacySessions) {
    const checkpoints = await migrateSessionEntityCheckpoints(
      entityManager,
      relationManager,
      session
    );
    migrated += checkpoints.length;
  }
  return migrated;
}

/**
 * Decode + persist the legacy blobs on one session entity, then strip
 * the migrated blob observations from the session.
 * @internal
 */
async function migrateSessionEntityCheckpoints(
  entityManager: EntityManager,
  relationManager: RelationManager,
  session: SessionEntity
): Promise<SessionCheckpointData[]> {
  const observations = session.observations ?? [];
  if (!hasLegacyCheckpointObservations(observations)) return [];

  const migrated: SessionCheckpointData[] = [];
  const remaining: string[] = [];
  for (const obs of observations) {
    const decoded = decodeLegacyCheckpoint(obs);
    if (decoded) {
      migrated.push(decoded);
    } else {
      remaining.push(obs);
    }
  }
  if (migrated.length === 0) return [];

  await persistDecomposedCheckpoints(entityManager, relationManager, migrated);

  try {
    // EntityManager.updateEntity bumps lastModified itself.
    await entityManager.updateEntity(session.name, { observations: remaining });
  } catch (err) {
    // Session vanished between enumeration and update (concurrent delete).
    // Preserve the tolerant semantics of the previous storage-level write:
    // the checkpoints were already persisted, there is nothing to strip.
    if (!(err instanceof EntityNotFoundError)) throw err;
  }

  return migrated;
}

// ==================== Encoding / Decoding ====================

/** True when the observation list still carries legacy checkpoint blobs. */
function hasLegacyCheckpointObservations(observations: string[]): boolean {
  return observations.some((obs) => obs.startsWith(LEGACY_CHECKPOINT_PREFIX));
}

/**
 * Persist checkpoints in the decomposed shape: one `session-checkpoint`
 * entity per checkpoint (parented to its session) plus a
 * `has_checkpoint` relation from the session and `snapshots` relations
 * to working-memory entities that currently exist. Relations to missing
 * endpoints are skipped (RelationManager rejects dangling relations);
 * the observation lines keep the full snapshot regardless.
 */
async function persistDecomposedCheckpoints(
  entityManager: EntityManager,
  relationManager: RelationManager,
  checkpoints: SessionCheckpointData[]
): Promise<void> {
  if (checkpoints.length === 0) return;

  await entityManager.createEntities(
    checkpoints.map((cp) => ({
      name: cp.id,
      entityType: SESSION_CHECKPOINT_ENTITY_TYPE,
      observations: encodeCheckpointObservations(cp),
      parentId: cp.sessionId,
    }))
  );

  const existing = new Set((await entityManager.listEntities()).map((e) => e.name));

  const relations: Relation[] = [];
  for (const cp of checkpoints) {
    if (existing.has(cp.sessionId)) {
      relations.push({ from: cp.sessionId, to: cp.id, relationType: HAS_CHECKPOINT_RELATION });
    }
    for (const memoryName of cp.state.workingMemories) {
      if (existing.has(memoryName)) {
        relations.push({ from: cp.id, to: memoryName, relationType: SNAPSHOTS_RELATION });
      }
    }
  }
  if (relations.length > 0) {
    await relationManager.createRelations(relations);
  }
}

/** Observation lines for a checkpoint entity (see module doc). */
function encodeCheckpointObservations(cp: SessionCheckpointData): string[] {
  const observations: string[] = [`${SESSION_ID_PREFIX}${cp.sessionId}`];
  if (cp.name !== undefined) {
    observations.push(`${LABEL_PREFIX}${cp.name}`);
  }
  observations.push(`${CREATED_AT_PREFIX}${cp.timestamp}`);
  for (const memoryName of cp.state.workingMemories) {
    observations.push(`${WORKING_MEMORY_PREFIX}${JSON.stringify(memoryName)}`);
  }
  for (const [key, value] of Object.entries(cp.state.decaySnapshot)) {
    observations.push(`${DECAY_PREFIX}${JSON.stringify(key)}=${JSON.stringify(value)}`);
  }
  for (const [key, value] of Object.entries(cp.state.metadata)) {
    const json = JSON.stringify(value);
    if (json !== undefined) {
      observations.push(`${META_PREFIX}${JSON.stringify(key)}=${json}`);
    }
  }
  return observations;
}

/** Inverse of `encodeCheckpointObservations`. Tolerant of unknown lines. */
function decodeCheckpointEntity(entity: Entity): SessionCheckpointData {
  const data: SessionCheckpointData = {
    id: entity.name,
    sessionId: entity.parentId ?? '',
    timestamp: '',
    state: { workingMemories: [], decaySnapshot: {}, metadata: {} },
  };

  for (const obs of entity.observations ?? []) {
    if (obs.startsWith(SESSION_ID_PREFIX)) {
      data.sessionId = obs.slice(SESSION_ID_PREFIX.length);
    } else if (obs.startsWith(LABEL_PREFIX)) {
      data.name = obs.slice(LABEL_PREFIX.length);
    } else if (obs.startsWith(CREATED_AT_PREFIX)) {
      data.timestamp = obs.slice(CREATED_AT_PREFIX.length);
    } else if (obs.startsWith(WORKING_MEMORY_PREFIX)) {
      try {
        const name: unknown = JSON.parse(obs.slice(WORKING_MEMORY_PREFIX.length));
        if (typeof name === 'string') data.state.workingMemories.push(name);
      } catch {
        // Skip malformed lines
      }
    } else if (obs.startsWith(DECAY_PREFIX)) {
      const kv = decodeKeyValueLine(obs.slice(DECAY_PREFIX.length));
      if (kv && typeof kv[1] === 'number') data.state.decaySnapshot[kv[0]] = kv[1];
    } else if (obs.startsWith(META_PREFIX)) {
      const kv = decodeKeyValueLine(obs.slice(META_PREFIX.length));
      if (kv) data.state.metadata[kv[0]] = kv[1];
    }
  }

  return data;
}

/**
 * Split `<JSON-string>=<JSON-value>` at the `=` separating the key from
 * the value (never inside the key — `"` inside a JSON string is escaped,
 * so a simple escape-aware scan finds the key's closing quote). Returns
 * null on malformed input.
 */
function decodeKeyValueLine(body: string): [string, unknown] | null {
  if (!body.startsWith('"')) return null;
  let i = 1;
  while (i < body.length && body[i] !== '"') {
    i += body[i] === '\\' ? 2 : 1;
  }
  if (i >= body.length || body[i + 1] !== '=') return null;
  try {
    const key: unknown = JSON.parse(body.slice(0, i + 1));
    const value: unknown = JSON.parse(body.slice(i + 2));
    if (typeof key !== 'string') return null;
    return [key, value];
  } catch {
    return null;
  }
}

/** Newest-first ordering: `[created-at]` desc, numeric id suffix desc. */
function compareNewestFirst(a: SessionCheckpointData, b: SessionCheckpointData): number {
  const delta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  if (delta !== 0 && Number.isFinite(delta)) return delta;
  return checkpointSequence(b.id) - checkpointSequence(a.id);
}

/** Numeric millisecond suffix of a checkpoint id (0 when unparsable). */
function checkpointSequence(id: string): number {
  const n = Number(id.slice(id.lastIndexOf('_') + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pure decoder for a single legacy `[CHECKPOINT] {json}` observation
 * line. Returns null when the line is not a well-formed legacy blob.
 *
 * @deprecated Legacy decoder — kept for reading pre-decomposition
 * observations. `SessionCheckpointManager` auto-migrates such blobs on
 * read; new code should go through `SessionCheckpointManager`.
 */
export function decodeLegacyCheckpoint(observation: string): SessionCheckpointData | null {
  if (!observation.startsWith(LEGACY_CHECKPOINT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(observation.slice(LEGACY_CHECKPOINT_PREFIX.length)) as
      | Partial<SessionCheckpointData>
      | null;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.sessionId !== 'string') {
      return null;
    }
    const state = parsed.state ?? { workingMemories: [], decaySnapshot: {}, metadata: {} };
    const data: SessionCheckpointData = {
      id: parsed.id,
      sessionId: parsed.sessionId,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : '',
      state: {
        workingMemories: Array.isArray(state.workingMemories) ? state.workingMemories : [],
        decaySnapshot: state.decaySnapshot ?? {},
        metadata: state.metadata ?? {},
      },
    };
    if (typeof parsed.name === 'string') data.name = parsed.name;
    return data;
  } catch {
    return null;
  }
}
