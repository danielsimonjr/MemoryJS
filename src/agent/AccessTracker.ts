/**
 * Access Tracker
 *
 * Tracks memory access patterns to inform decay calculations
 * and retrieval ranking. Records access frequency, recency,
 * and context for each memory entity.
 *
 * @module agent/AccessTracker
 */

import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity, AccessContext, AccessPattern } from '../types/agent-memory.js';

// Re-export AccessContext for convenience
export type { AccessContext } from '../types/agent-memory.js';

// ==================== Interfaces ====================

/**
 * Internal record of access history for an entity.
 */
interface AccessRecord {
  /** Entity name */
  entityName: string;
  /** Total access count */
  totalAccesses: number;
  /** ISO 8601 timestamp of last access */
  lastAccessedAt: string;
  /** Recent access timestamps (circular buffer) */
  recentAccesses: string[];
  /** Access counts per session */
  accessesBySession: Record<string, number>;
}

/**
 * Statistics about an entity's access patterns.
 */
export interface AccessStats {
  /** Total number of accesses */
  totalAccesses: number;
  /** ISO 8601 timestamp of last access */
  lastAccessedAt: string;
  /** Classified access pattern */
  accessPattern: AccessPattern;
  /** Average interval between accesses in milliseconds */
  averageAccessInterval: number;
  /** Access counts by session */
  accessesBySession: Record<string, number>;
}

/**
 * Configuration options for AccessTracker.
 */
export interface AccessTrackerConfig {
  /** Maximum recent accesses to track per entity (default: 100) */
  historyBufferSize?: number;
  /** Half-life in hours for recency scoring (default: 24) */
  recencyHalfLifeHours?: number;
  /** Threshold for 'frequent' pattern (accesses per day, default: 10) */
  frequentThreshold?: number;
  /** Threshold for 'occasional' pattern (accesses per day, default: 1) */
  occasionalThreshold?: number;
}

// ==================== AccessTracker Class ====================

/**
 * Tracks memory access patterns for decay and retrieval ranking.
 *
 * The AccessTracker records every memory access and provides:
 * - Access statistics (frequency, recency, patterns)
 * - Recency scoring using exponential decay
 * - Retrieval of frequently/recently accessed entities
 *
 * @example
 * ```typescript
 * const tracker = new AccessTracker(storage);
 * await tracker.recordAccess('entity_name', { sessionId: 'session_1' });
 * const stats = await tracker.getAccessStats('entity_name');
 * console.log(stats.accessPattern); // 'frequent', 'occasional', or 'rare'
 * ```
 */
export class AccessTracker {
  private readonly storage: IGraphStorage;
  private readonly config: Required<AccessTrackerConfig>;
  private readonly accessRecords: Map<string, AccessRecord>;
  private dirty: boolean;

  constructor(storage: IGraphStorage, config: AccessTrackerConfig = {}) {
    this.storage = storage;
    this.config = {
      historyBufferSize: config.historyBufferSize ?? 100,
      recencyHalfLifeHours: config.recencyHalfLifeHours ?? 24,
      frequentThreshold: config.frequentThreshold ?? 10,
      occasionalThreshold: config.occasionalThreshold ?? 1,
    };
    this.accessRecords = new Map();
    this.dirty = false;
  }

  // ==================== Public Methods ====================

  /**
   * Record an access to an entity.
   *
   * Updates access counts, timestamps, and maintains the history buffer.
   * Optionally updates the entity's access fields in storage.
   *
   * @param entityName - Name of the accessed entity
   * @param context - Optional context about the access
   */
  async recordAccess(entityName: string, context?: AccessContext): Promise<void> {
    const now = new Date().toISOString();

    // Get or create access record
    let record = this.accessRecords.get(entityName);
    if (!record) {
      record = {
        entityName,
        totalAccesses: 0,
        lastAccessedAt: now,
        recentAccesses: [],
        accessesBySession: {},
      };
      this.accessRecords.set(entityName, record);
    }

    // Update access counts
    record.totalAccesses++;
    record.lastAccessedAt = now;

    // Add to recent accesses (circular buffer)
    record.recentAccesses.push(now);
    if (record.recentAccesses.length > this.config.historyBufferSize) {
      record.recentAccesses.shift();
    }

    // Track session-specific access
    if (context?.sessionId) {
      record.accessesBySession[context.sessionId] =
        (record.accessesBySession[context.sessionId] ?? 0) + 1;
    }

    // Mark as dirty for batch persistence
    this.dirty = true;

    // Update entity in storage if it exists
    await this.updateEntityAccessFields(entityName, record);
  }

  /**
   * Get access statistics for an entity.
   *
   * @param entityName - Entity to get stats for
   * @returns Access statistics including pattern classification
   */
  async getAccessStats(entityName: string): Promise<AccessStats> {
    const record = this.accessRecords.get(entityName);

    if (!record) {
      // Return default stats for untracked entity
      return {
        totalAccesses: 0,
        lastAccessedAt: '',
        accessPattern: 'rare',
        averageAccessInterval: Infinity,
        accessesBySession: {},
      };
    }

    return {
      totalAccesses: record.totalAccesses,
      lastAccessedAt: record.lastAccessedAt,
      accessPattern: this.classifyAccessPattern(record),
      averageAccessInterval: this.calculateAverageInterval(record),
      accessesBySession: { ...record.accessesBySession },
    };
  }

  /**
   * Calculate recency score based on time since last access.
   *
   * Uses exponential decay: e^(-ln(2) * hours_since_access / half_life)
   * - Score of 1.0 for just-accessed memories
   * - Score of 0.5 after one half-life
   * - Score approaches 0 for very old accesses
   *
   * @param entityName - Entity to calculate score for
   * @param halfLifeHours - Optional override for half-life (default: config value)
   * @returns Recency score between 0.0 and 1.0
   */
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number {
    const record = this.accessRecords.get(entityName);

    if (!record || !record.lastAccessedAt) {
      return 0; // No access history = minimum recency
    }

    const halfLife = halfLifeHours ?? this.config.recencyHalfLifeHours;
    const lastAccess = new Date(record.lastAccessedAt).getTime();
    const now = Date.now();
    const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);

    // Exponential decay formula
    const decayConstant = Math.LN2 / halfLife;
    const score = Math.exp(-decayConstant * hoursSinceAccess);

    return Math.max(0, Math.min(1, score)); // Clamp to [0, 1]
  }

  /**
   * Calculate recency score for a given timestamp.
   * Static utility for use without AccessTracker instance.
   *
   * @param lastAccessedAt - ISO 8601 timestamp of last access
   * @param halfLifeHours - Half-life for decay calculation
   * @returns Recency score between 0.0 and 1.0
   */
  static calculateRecencyScoreFromTimestamp(
    lastAccessedAt: string,
    halfLifeHours: number = 24
  ): number {
    if (!lastAccessedAt) return 0;

    const lastAccess = new Date(lastAccessedAt).getTime();
    const now = Date.now();
    const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);

    const decayConstant = Math.LN2 / halfLifeHours;
    const score = Math.exp(-decayConstant * hoursSinceAccess);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get most frequently accessed entities.
   *
   * @param limit - Maximum number of entities to return
   * @param timeWindowHours - Optional time window for frequency calculation
   * @returns Array of entities sorted by access frequency (descending)
   */
  async getFrequentlyAccessed(
    limit: number,
    timeWindowHours?: number
  ): Promise<AgentEntity[]> {
    const now = Date.now();
    const windowStart = timeWindowHours
      ? now - timeWindowHours * 60 * 60 * 1000
      : 0;

    // Calculate frequency scores
    const scored: Array<{ name: string; frequency: number }> = [];

    for (const [name, record] of this.accessRecords) {
      let frequency: number;

      if (timeWindowHours) {
        // Count accesses within time window
        frequency = record.recentAccesses.filter(
          (ts) => new Date(ts).getTime() >= windowStart
        ).length;
      } else {
        frequency = record.totalAccesses;
      }

      if (frequency > 0) {
        scored.push({ name, frequency });
      }
    }

    // Sort by frequency (descending) and take top N
    scored.sort((a, b) => b.frequency - a.frequency);
    const topNames = scored.slice(0, limit).map((s) => s.name);

    // Fetch entities from storage
    const entities: AgentEntity[] = [];
    for (const name of topNames) {
      const entity = this.storage.getEntityByName(name);
      if (entity) {
        entities.push(entity as AgentEntity);
      }
    }

    return entities;
  }

  /**
   * Get most recently accessed entities.
   *
   * @param limit - Maximum number of entities to return
   * @param withinHours - Optional filter for accesses within N hours
   * @returns Array of entities sorted by recency (most recent first)
   */
  async getRecentlyAccessed(
    limit: number,
    withinHours?: number
  ): Promise<AgentEntity[]> {
    const now = Date.now();
    const windowStart = withinHours ? now - withinHours * 60 * 60 * 1000 : 0;

    // Collect entities with their last access time
    const scored: Array<{ name: string; lastAccess: number }> = [];

    for (const [name, record] of this.accessRecords) {
      const lastAccess = new Date(record.lastAccessedAt).getTime();

      if (lastAccess >= windowStart) {
        scored.push({ name, lastAccess });
      }
    }

    // Sort by last access (most recent first) and take top N
    scored.sort((a, b) => b.lastAccess - a.lastAccess);
    const topNames = scored.slice(0, limit).map((s) => s.name);

    // Fetch entities from storage
    const entities: AgentEntity[] = [];
    for (const name of topNames) {
      const entity = this.storage.getEntityByName(name);
      if (entity) {
        entities.push(entity as AgentEntity);
      }
    }

    return entities;
  }

  /**
   * Persist all dirty access records to storage.
   * Call periodically or on shutdown.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return;

    // Persistence logic depends on storage backend
    // For now, entity updates happen in recordAccess
    this.dirty = false;
  }

  /**
   * Check if there are unsaved changes.
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get all tracked entity names.
   */
  getTrackedEntities(): string[] {
    return Array.from(this.accessRecords.keys());
  }

  /**
   * Clear access records for an entity.
   *
   * @param entityName - Entity to clear records for
   */
  clearAccessRecords(entityName: string): void {
    this.accessRecords.delete(entityName);
    this.dirty = true;
  }

  /**
   * Clear all access records.
   */
  clearAllAccessRecords(): void {
    this.accessRecords.clear();
    this.dirty = true;
  }

  // ==================== Private Helpers ====================

  /**
   * Update entity access fields in storage.
   */
  private async updateEntityAccessFields(
    entityName: string,
    record: AccessRecord
  ): Promise<void> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) return;

    await this.storage.updateEntity(entityName, {
      accessCount: record.totalAccesses,
      lastAccessedAt: record.lastAccessedAt,
      lastModified: new Date().toISOString(),
    } as Record<string, unknown>);
  }

  /**
   * Classify access pattern based on access frequency.
   */
  private classifyAccessPattern(record: AccessRecord): AccessPattern {
    if (record.recentAccesses.length < 2) {
      return 'rare';
    }

    // Calculate accesses per day over the history window
    const oldest = new Date(record.recentAccesses[0]).getTime();
    const newest = new Date(
      record.recentAccesses[record.recentAccesses.length - 1]
    ).getTime();
    const daysDiff = Math.max((newest - oldest) / (1000 * 60 * 60 * 24), 1);
    const accessesPerDay = record.recentAccesses.length / daysDiff;

    if (accessesPerDay >= this.config.frequentThreshold) {
      return 'frequent';
    } else if (accessesPerDay >= this.config.occasionalThreshold) {
      return 'occasional';
    } else {
      return 'rare';
    }
  }

  /**
   * Calculate average interval between accesses.
   */
  private calculateAverageInterval(record: AccessRecord): number {
    if (record.recentAccesses.length < 2) {
      return Infinity;
    }

    let totalInterval = 0;
    for (let i = 1; i < record.recentAccesses.length; i++) {
      const prev = new Date(record.recentAccesses[i - 1]).getTime();
      const curr = new Date(record.recentAccesses[i]).getTime();
      totalInterval += curr - prev;
    }

    return totalInterval / (record.recentAccesses.length - 1);
  }
}
