/**
 * Transition Ledger
 *
 * Phase 2B: Append-only audit trail for state changes in the knowledge graph.
 * Records all entity, relation, and observation mutations with full context
 * including previous values, change reasons, and agent attribution.
 *
 * @module core/TransitionLedger
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';
import type { GraphEventEmitter } from './GraphEventEmitter.js';
import type {
  Entity,
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  RelationCreatedEvent,
  RelationDeletedEvent,
  ObservationAddedEvent,
  ObservationDeletedEvent,
} from '../types/index.js';

// ==================== Interfaces ====================

/**
 * Represents a single state transition event in the ledger.
 */
export interface TransitionEvent {
  /** Unique event ID (e.g., txn_{timestamp}_{random}) */
  id: string;
  /** Entity name affected */
  entityId: string;
  /** Which agent made the change */
  agentId?: string;
  /** What changed (e.g., 'importance', 'observations', 'status') */
  field: string;
  /** Previous value */
  from: unknown;
  /** New value */
  to: unknown;
  /** Why the change was made */
  reason?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional cost tracking */
  tokenCost?: number;
}

/**
 * Filter criteria for querying transition events.
 */
export interface TransitionFilter {
  /** Filter by entity name */
  entityId?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Filter by field name */
  field?: string;
  /** Filter events after this ISO 8601 timestamp */
  fromTime?: string;
  /** Filter events before this ISO 8601 timestamp */
  toTime?: string;
  /** Maximum number of results */
  limit?: number;
}

// ==================== TransitionLedger ====================

/**
 * Append-only audit trail for knowledge graph state changes.
 *
 * Stores transition events in JSONL format for durability and
 * maintains an in-memory copy for fast querying. Supports
 * filtering, regression detection, and compaction.
 *
 * @example
 * ```typescript
 * const ledger = new TransitionLedger('./memory.jsonl');
 * await ledger.load();
 *
 * // Append a transition
 * await ledger.append({
 *   entityId: 'Alice',
 *   field: 'importance',
 *   from: 5,
 *   to: 8,
 *   reason: 'Promoted to team lead',
 * });
 *
 * // Query history
 * const history = ledger.getHistory('Alice');
 * ```
 */
export class TransitionLedger {
  private events: TransitionEvent[] = [];
  private readonly filePath: string;

  /**
   * Create a new TransitionLedger.
   *
   * @param storagePath - Path to the main storage file. The ledger file path
   *   is derived by replacing the extension (e.g., memory.jsonl -> memory.ledger.jsonl).
   */
  constructor(storagePath: string) {
    const dir = path.dirname(storagePath);
    const ext = path.extname(storagePath);
    const basename = path.basename(storagePath, ext);
    this.filePath = path.join(dir, `${basename}.ledger.jsonl`);
  }

  // ==================== Core Operations ====================

  /**
   * Append a transition event to the ledger.
   *
   * Generates a unique ID and timestamp, stores the event in memory,
   * and appends it to the JSONL file.
   *
   * @param event - Event data without id and timestamp (auto-generated)
   * @returns The complete transition event with generated id and timestamp
   */
  async append(event: Omit<TransitionEvent, 'id' | 'timestamp'>): Promise<TransitionEvent> {
    const fullEvent: TransitionEvent = {
      ...event,
      id: `txn_${Date.now()}_${randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);

    try {
      await fs.appendFile(this.filePath, JSON.stringify(fullEvent) + '\n', 'utf-8');
    } catch (error: unknown) {
      // If directory doesn't exist, create it and retry
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, JSON.stringify(fullEvent) + '\n', 'utf-8');
      } else {
        throw error;
      }
    }

    return fullEvent;
  }

  /**
   * Query transition events with filters.
   *
   * All filter fields are optional and combined with AND logic.
   * Results are sorted by timestamp descending (newest first).
   *
   * @param filter - Filter criteria
   * @returns Matching transition events
   */
  query(filter: TransitionFilter): TransitionEvent[] {
    let results = this.events;

    if (filter.entityId) {
      results = results.filter(e => e.entityId === filter.entityId);
    }
    if (filter.agentId) {
      results = results.filter(e => e.agentId === filter.agentId);
    }
    if (filter.field) {
      results = results.filter(e => e.field === filter.field);
    }
    if (filter.fromTime) {
      results = results.filter(e => e.timestamp >= filter.fromTime!);
    }
    if (filter.toTime) {
      results = results.filter(e => e.timestamp <= filter.toTime!);
    }

    // Sort by timestamp descending
    results = [...results].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get the transition history for a specific entity.
   *
   * @param entityId - Entity name to get history for
   * @param limit - Maximum number of events to return
   * @returns Transition events for the entity, newest first
   */
  getHistory(entityId: string, limit?: number): TransitionEvent[] {
    return this.query({ entityId, limit });
  }

  /**
   * Detect regression patterns for an entity.
   *
   * A regression occurs when a field's value reverts to a previous state
   * (e.g., importance: 5 -> 8 -> 5, or status: active -> archived -> active).
   *
   * @param entityId - Entity name to check for regressions
   * @returns Transition events that represent regression (revert-back) transitions
   */
  detectRegressions(entityId: string): TransitionEvent[] {
    const history = this.events.filter(e => e.entityId === entityId);
    const regressions: TransitionEvent[] = [];

    // Group events by field
    const byField = new Map<string, TransitionEvent[]>();
    for (const event of history) {
      const fieldEvents = byField.get(event.field);
      if (fieldEvents) {
        fieldEvents.push(event);
      } else {
        byField.set(event.field, [event]);
      }
    }

    // For each field, check if the 'to' value matches any earlier 'from' value
    for (const fieldEvents of byField.values()) {
      // Sort chronologically
      const sorted = [...fieldEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        // Check if the current 'to' value matches any previous 'from' value
        for (let j = 0; j < i; j++) {
          if (this.valuesEqual(current.to, sorted[j].from)) {
            regressions.push(current);
            break;
          }
        }
      }
    }

    return regressions;
  }

  /**
   * Compact the ledger by removing entries older than a given date.
   *
   * Rewrites the JSONL file with only the remaining entries.
   *
   * @param olderThan - Remove entries with timestamps before this date
   * @returns Number of compacted (removed) entries
   */
  async compact(olderThan: Date): Promise<number> {
    const threshold = olderThan.toISOString();
    const before = this.events.length;
    this.events = this.events.filter(e => e.timestamp >= threshold);
    const removed = before - this.events.length;

    if (removed > 0) {
      const content = this.events.map(e => JSON.stringify(e)).join('\n');
      await fs.writeFile(this.filePath, content ? content + '\n' : '', 'utf-8');
    }

    return removed;
  }

  /**
   * Load transition events from the JSONL file.
   *
   * Handles missing files gracefully by starting with an empty ledger.
   * Invalid JSON lines are silently skipped to handle partial writes.
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.events = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.events.push(JSON.parse(trimmed) as TransitionEvent);
        } catch {
          // Skip malformed lines (partial writes, corruption)
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet — start empty
        this.events = [];
      } else {
        throw error;
      }
    }
  }

  /**
   * Get the number of events in the ledger.
   */
  get size(): number {
    return this.events.length;
  }

  // ==================== Event Emitter Integration ====================

  /**
   * Attach the ledger to a GraphEventEmitter to automatically record
   * all entity, relation, and observation state changes.
   *
   * @param emitter - The GraphEventEmitter to subscribe to
   * @param onError - Optional error handler for failed appends (default: no-op)
   * @returns Unsubscribe function to detach all listeners
   */
  attachToEmitter(emitter: GraphEventEmitter, onError?: (error: unknown) => void): () => void {
    const unsubscribers: (() => void)[] = [];
    const handleAppend = (event: Omit<TransitionEvent, 'id' | 'timestamp'>) => {
      this.append(event).catch((err) => {
        if (onError) onError(err);
      });
    };

    // Entity created
    unsubscribers.push(
      emitter.on('entity:created', (event: EntityCreatedEvent) => {
        handleAppend({
          entityId: event.entity.name,
          field: 'entity',
          from: null,
          to: this.mapEntityState(event.entity),
        });
      })
    );

    // Entity updated
    unsubscribers.push(
      emitter.on('entity:updated', (event: EntityUpdatedEvent) => {
        const changes = event.changes;
        const previous = event.previousValues ?? {};

        for (const field of Object.keys(changes) as (keyof typeof changes)[]) {
          if (field === 'lastModified') continue; // Skip timestamp noise
          handleAppend({
            entityId: event.entityName,
            field: String(field),
            from: previous[field] ?? null,
            to: changes[field],
          });
        }
      })
    );

    // Entity deleted
    unsubscribers.push(
      emitter.on('entity:deleted', (event: EntityDeletedEvent) => {
        handleAppend({
          entityId: event.entityName,
          field: 'entity',
          from: event.entity ? this.mapEntityState(event.entity) : null,
          to: null,
        });
      })
    );

    // Relation created
    unsubscribers.push(
      emitter.on('relation:created', (event: RelationCreatedEvent) => {
        handleAppend({
          entityId: event.relation.from,
          field: 'relation',
          from: null,
          to: {
            to: event.relation.to,
            relationType: event.relation.relationType,
          },
        });
      })
    );

    // Relation deleted
    unsubscribers.push(
      emitter.on('relation:deleted', (event: RelationDeletedEvent) => {
        handleAppend({
          entityId: event.from,
          field: 'relation',
          from: {
            to: event.to,
            relationType: event.relationType,
          },
          to: null,
        });
      })
    );

    // Observation added
    unsubscribers.push(
      emitter.on('observation:added', (event: ObservationAddedEvent) => {
        handleAppend({
          entityId: event.entityName,
          field: 'observations',
          from: null,
          to: event.observations,
        });
      })
    );

    // Observation deleted
    unsubscribers.push(
      emitter.on('observation:deleted', (event: ObservationDeletedEvent) => {
        handleAppend({
          entityId: event.entityName,
          field: 'observations',
          from: event.observations,
          to: null,
        });
      })
    );

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }

  // ==================== Private Helpers ====================

  /**
   * Map entity state to a consistent audit format.
   * Extracts only the core data fields to avoid metadata noise.
   */
  private mapEntityState(entity: Entity) {
    return {
      entityType: entity.entityType,
      observations: entity.observations,
      tags: entity.tags,
      importance: entity.importance,
    };
  }

  /**
   * Deep equality check for transition values.
   * Handles primitives, arrays, and plain objects.
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    return JSON.stringify(a) === JSON.stringify(b);
  }
}
