/**
 * Freshness Manager
 *
 * Provides temporal governance and freshness auditing for entities.
 * Calculates freshness scores, identifies stale/expired entities,
 * and generates freshness reports.
 *
 * @module features/FreshnessManager
 */

import type { Entity, IGraphStorage } from '../types/types.js';

// ==================== Report Types ====================

/**
 * A freshness report categorising all entities in storage.
 */
export interface FreshnessReport {
  /** Entities with freshness score >= threshold */
  fresh: Entity[];
  /** Entities with freshness score < threshold but not expired */
  stale: Entity[];
  /** Entities that have passed their TTL expiry */
  expired: Entity[];
  /** Average freshness score across all entities (0-1) */
  averageFreshness: number;
}

// ==================== FreshnessManager ====================

/**
 * Configuration for FreshnessManager.
 */
export interface FreshnessManagerConfig {
  /**
   * Default half-life in hours used when no TTL is set (default: 168 = 1 week).
   * After this many hours an entity's freshness score falls to ~0.5.
   */
  defaultHalfLifeHours?: number;
  /**
   * Freshness threshold below which an entity is considered stale (default: 0.3).
   */
  defaultStaleThreshold?: number;
  /**
   * Weight given to the TTL component of the freshness formula (default: 0.6).
   * The remaining weight is given to the confidence component.
   */
  ttlWeight?: number;
}

/**
 * Manages temporal governance and freshness auditing for knowledge-graph entities.
 *
 * Freshness formula (when TTL is set):
 *   timeRatio   = max(0, 1 - ageMs / ttl)          // linear 1→0 over TTL lifetime
 *   ttlScore    = timeRatio
 *   confScore   = confidence ?? 1.0
 *   freshness   = ttlScore * ttlWeight + confScore * (1 - ttlWeight)
 *
 * When no TTL is set, an exponential half-life decay is used instead of ttlScore:
 *   decayScore  = e^(-ln2 * ageHours / halfLifeHours)
 *   freshness   = decayScore * ttlWeight + confScore * (1 - ttlWeight)
 *
 * @example
 * ```typescript
 * const fm = new FreshnessManager(storage);
 * const score = fm.calculateFreshness(entity);
 * const stale = await fm.getStaleEntities(storage);
 * const report = await fm.generateReport(storage);
 * ```
 */
export class FreshnessManager {
  private readonly config: Required<FreshnessManagerConfig>;

  constructor(_storage: IGraphStorage, config: FreshnessManagerConfig = {}) {
    this.config = {
      defaultHalfLifeHours: config.defaultHalfLifeHours ?? 168,
      defaultStaleThreshold: config.defaultStaleThreshold ?? 0.3,
      ttlWeight: config.ttlWeight ?? 0.6,
    };
  }

  // ==================== Core Calculations ====================

  /**
   * Calculate the freshness score for a single entity.
   *
   * Returns a value between 0 (completely stale) and 1 (perfectly fresh).
   * A newly created entity with no confidence override scores ~1.0.
   *
   * @param entity - The entity to evaluate
   * @returns Freshness score in [0, 1]
   */
  calculateFreshness(entity: Entity): number {
    const now = Date.now();
    const createdAt = entity.createdAt ? new Date(entity.createdAt).getTime() : now;
    const ageMs = Math.max(0, now - createdAt);
    const ageHours = ageMs / (1000 * 60 * 60);

    let timeScore: number;

    if (entity.ttl !== undefined && entity.ttl > 0) {
      // Linear decay from 1 → 0 over the TTL window
      const timeRatio = Math.max(0, 1 - ageMs / entity.ttl);
      timeScore = timeRatio;
    } else {
      // Exponential half-life decay when no TTL is set
      const halfLifeHours = this.config.defaultHalfLifeHours;
      const decayConstant = Math.LN2 / halfLifeHours;
      timeScore = Math.exp(-decayConstant * ageHours);
    }

    // Confidence component (defaults to 1.0 if not set)
    const confidence = entity.confidence ?? 1.0;
    const confidenceScore = Math.max(0, Math.min(1, confidence));

    // Weighted combination
    const freshness =
      timeScore * this.config.ttlWeight +
      confidenceScore * (1 - this.config.ttlWeight);

    return Math.max(0, Math.min(1, freshness));
  }

  /**
   * Compute the expiry timestamp for an entity.
   *
   * @param entity - The entity to compute expiry for
   * @returns ISO 8601 expiry string, or undefined if no TTL is set
   */
  computeExpiresAt(entity: Entity): string | undefined {
    if (entity.ttl === undefined || entity.ttl <= 0) return undefined;
    const createdAt = entity.createdAt
      ? new Date(entity.createdAt).getTime()
      : Date.now();
    return new Date(createdAt + entity.ttl).toISOString();
  }

  /**
   * Annotate an entity with computed freshness fields (freshnessScore, expiresAt).
   * Does not mutate the original; returns a new object.
   *
   * @param entity - Entity to annotate
   * @returns New entity object with freshness fields populated
   */
  annotateEntity(entity: Entity): Entity {
    return {
      ...entity,
      freshnessScore: this.calculateFreshness(entity),
      expiresAt: this.computeExpiresAt(entity),
    };
  }

  // ==================== Storage-Level Queries ====================

  /**
   * Return all entities whose freshness score is below the given threshold.
   *
   * @param storage - Graph storage to query
   * @param threshold - Freshness threshold (default: config.defaultStaleThreshold)
   * @returns Array of stale entities (annotated with freshnessScore)
   */
  async getStaleEntities(
    storage: IGraphStorage,
    threshold?: number
  ): Promise<Entity[]> {
    const cutoff = threshold ?? this.config.defaultStaleThreshold;
    const graph = await storage.loadGraph();
    const stale: Entity[] = [];

    for (const entity of graph.entities) {
      if (this.isExpired(entity)) continue; // expired are handled separately
      const score = this.calculateFreshness(entity);
      if (score < cutoff) {
        stale.push({ ...entity, freshnessScore: score, expiresAt: this.computeExpiresAt(entity) });
      }
    }

    return stale;
  }

  /**
   * Return all entities that have passed their TTL expiry.
   *
   * Entities without a TTL are never considered expired via this method.
   *
   * @param storage - Graph storage to query
   * @returns Array of expired entities
   */
  async getExpiredEntities(storage: IGraphStorage): Promise<Entity[]> {
    const graph = await storage.loadGraph();
    const expired: Entity[] = [];

    for (const entity of graph.entities) {
      if (this.isExpired(entity)) {
        expired.push({
          ...entity,
          freshnessScore: 0,
          expiresAt: this.computeExpiresAt(entity),
        });
      }
    }

    return expired;
  }

  /**
   * Reset freshness for an entity by updating its creation timestamp to now.
   *
   * This effectively makes the entity "brand new" for freshness purposes.
   * Also resets confidence to 1.0 if it was below 1.0.
   *
   * @param entityName - Name of the entity to refresh
   * @param storage - Graph storage containing the entity
   * @returns Updated entity
   * @throws Error if entity not found
   */
  async refreshEntity(entityName: string, storage: IGraphStorage): Promise<Entity> {
    const entity = storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    const now = new Date().toISOString();
    const updates: Partial<Entity> = {
      createdAt: now,
      lastModified: now,
      confidence: 1.0,
    };

    await storage.updateEntity(entityName, updates as Record<string, unknown>);

    // Return the annotated refreshed entity
    const refreshed: Entity = { ...entity, ...updates };
    return this.annotateEntity(refreshed);
  }

  /**
   * Generate a freshness report across all entities.
   *
   * @param storage - Graph storage to analyse
   * @param threshold - Freshness threshold for fresh/stale categorisation
   * @returns FreshnessReport with fresh, stale, expired arrays and averageFreshness
   */
  async generateReport(
    storage: IGraphStorage,
    threshold?: number
  ): Promise<FreshnessReport> {
    const cutoff = threshold ?? this.config.defaultStaleThreshold;
    const graph = await storage.loadGraph();

    const fresh: Entity[] = [];
    const stale: Entity[] = [];
    const expired: Entity[] = [];

    let totalFreshness = 0;
    let count = 0;

    for (const entity of graph.entities) {
      const annotated = this.annotateEntity(entity);
      const score = annotated.freshnessScore ?? 0;

      count++;
      totalFreshness += score;

      if (this.isExpired(entity)) {
        expired.push({ ...annotated, freshnessScore: 0 });
      } else if (score >= cutoff) {
        fresh.push(annotated);
      } else {
        stale.push(annotated);
      }
    }

    return {
      fresh,
      stale,
      expired,
      averageFreshness: count > 0 ? totalFreshness / count : 0,
    };
  }

  // ==================== Helpers ====================

  /**
   * Check whether an entity has passed its TTL expiry.
   *
   * @param entity - Entity to check
   * @returns True if entity has a TTL and has expired
   */
  isExpired(entity: Entity): boolean {
    if (entity.ttl === undefined || entity.ttl <= 0) return false;
    const createdAt = entity.createdAt
      ? new Date(entity.createdAt).getTime()
      : Date.now();
    return Date.now() > createdAt + entity.ttl;
  }

  /**
   * Get current configuration (read-only).
   */
  getConfig(): Readonly<Required<FreshnessManagerConfig>> {
    return { ...this.config };
  }
}
