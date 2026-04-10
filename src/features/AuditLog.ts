/**
 * Audit Log
 *
 * Provides persistent audit trail for knowledge graph operations.
 * Records who did what, when, and what changed — enabling traceability
 * and rollback for the Dynamic Memory Governance system.
 *
 * Persists to a JSONL sidecar file alongside the main storage file.
 *
 * @module features/AuditLog
 */

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';

// ==================== Types ====================

/**
 * Operations that can be audited.
 */
export type AuditOperation = 'create' | 'update' | 'delete' | 'merge' | 'archive';

/**
 * A single audit log entry capturing before/after state of an operation.
 */
export interface AuditEntry {
  /** Unique identifier for this audit entry */
  id: string;
  /** ISO 8601 timestamp when the operation occurred */
  timestamp: string;
  /** Type of operation performed */
  operation: AuditOperation;
  /** Name of the entity this operation affected */
  entityName: string;
  /** Optional agent/user identifier who performed the operation */
  agentId?: string;
  /** State of the entity before the operation (undefined for creates) */
  before?: object;
  /** State of the entity after the operation (undefined for deletes) */
  after?: object;
  /** Whether the operation was ultimately committed or rolled back */
  status: 'committed' | 'rolled_back';
}

/**
 * Filter options for querying audit entries.
 */
export interface AuditFilter {
  /** Filter by operation type */
  operation?: AuditOperation;
  /** Filter by entity name */
  entityName?: string;
  /** Filter by agent/user identifier */
  agentId?: string;
  /** Filter to entries at or after this ISO 8601 timestamp */
  fromTime?: string;
  /** Filter to entries at or before this ISO 8601 timestamp */
  toTime?: string;
}

/**
 * Summary statistics for the audit log.
 */
export interface AuditStats {
  /** Total number of entries in the log */
  totalEntries: number;
  /** Count of entries broken down by operation type */
  byOperation: Record<AuditOperation, number>;
  /** Timestamp of the oldest entry, or null if log is empty */
  oldestEntry: string | null;
  /** Timestamp of the newest entry, or null if log is empty */
  newestEntry: string | null;
}

// ==================== AuditLog ====================

/**
 * Manages the persistent audit log for knowledge graph operations.
 *
 * The audit log records every create, update, delete, merge, and archive
 * operation, capturing before/after state so that operations can be
 * reversed if needed.
 *
 * Entries are stored as JSONL (one JSON object per line) in a sidecar
 * file next to the main storage file.
 *
 * @example
 * ```typescript
 * const auditLog = new AuditLog('/data/memory-audit.jsonl');
 *
 * // Record a create
 * const entry = await auditLog.append({
 *   operation: 'create',
 *   entityName: 'Alice',
 *   agentId: 'agent-1',
 *   after: { name: 'Alice', entityType: 'person', observations: [] },
 *   status: 'committed',
 * });
 *
 * // Query history for an entity
 * const history = await auditLog.getHistory('Alice');
 * ```
 */
export class AuditLog {
  constructor(private readonly filePath: string) {}

  // ==================== Core Operations ====================

  /**
   * Append a new entry to the audit log.
   *
   * Auto-generates a UUID `id` and ISO 8601 `timestamp`.
   *
   * @param entry - Entry data without id or timestamp
   * @returns The complete AuditEntry as persisted
   */
  async append(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const fullEntry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const line = JSON.stringify(fullEntry) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');

    return fullEntry;
  }

  /**
   * Query audit entries by filter criteria.
   *
   * All filter fields are optional; providing multiple fields applies
   * them as AND conditions.
   *
   * @param filter - Filter criteria
   * @returns Matching audit entries in chronological order
   */
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    const entries = await this.loadAll();

    return entries.filter(entry => {
      if (filter.operation !== undefined && entry.operation !== filter.operation) {
        return false;
      }
      if (filter.entityName !== undefined && entry.entityName !== filter.entityName) {
        return false;
      }
      if (filter.agentId !== undefined && entry.agentId !== filter.agentId) {
        return false;
      }
      if (filter.fromTime !== undefined && entry.timestamp < filter.fromTime) {
        return false;
      }
      if (filter.toTime !== undefined && entry.timestamp > filter.toTime) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get the full audit history for a specific entity.
   *
   * Returns all entries for the entity, ordered chronologically
   * (oldest first).
   *
   * @param entityName - Name of the entity to retrieve history for
   * @returns All audit entries for the entity
   */
  async getHistory(entityName: string): Promise<AuditEntry[]> {
    return this.query({ entityName });
  }

  /**
   * Get summary statistics for the audit log.
   *
   * @returns Statistics including total entries, counts by operation,
   *          and timestamps of oldest/newest entries
   */
  async stats(): Promise<AuditStats> {
    const entries = await this.loadAll();

    const byOperation: Record<AuditOperation, number> = {
      create: 0,
      update: 0,
      delete: 0,
      merge: 0,
      archive: 0,
    };

    for (const entry of entries) {
      byOperation[entry.operation]++;
    }

    return {
      totalEntries: entries.length,
      byOperation,
      oldestEntry: entries.length > 0 ? entries[0].timestamp : null,
      newestEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
    };
  }

  // ==================== Internal ====================

  /**
   * Load all entries from the JSONL file.
   *
   * Returns an empty array if the file does not exist.
   *
   * @private
   */
  async loadAll(): Promise<AuditEntry[]> {
    let data: string;
    try {
      data = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const lines = data.split('\n').filter(line => line.trim() !== '');
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed JSONL lines rather than crashing all audit reads
      }
    }
    return entries;
  }
}

// ==================== Helpers ====================

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
