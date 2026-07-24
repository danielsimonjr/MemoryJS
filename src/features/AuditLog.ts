/**
 * Audit Log
 *
 * Provides persistent audit trail for knowledge graph operations.
 * Records who did what, when, and what changed — enabling traceability
 * and rollback for the Dynamic Memory Governance system.
 *
 * Persists to a JSONL sidecar file alongside the main storage file.
 *
 * ## Trust boundary (read this honestly)
 *
 * Entries are hash-chained (`seq` + `prevHash`) which makes the file
 * **tamper-EVIDENT**: modifying, removing, or reordering any line other than
 * the very last one breaks the chain and is detected by {@link AuditLog.verifyChain}.
 * It is **not tamper-PROOF**: a writer with access to the file can rewrite the
 * entire chain from genesis (or truncate the tail after the last intact entry)
 * and produce a self-consistent file. True immutability requires shipping
 * entries (or periodic chain-head anchors) to an external, append-only sink
 * outside the writer's control. The file is created with mode `0600`
 * (owner read/write) to narrow the local attack surface, but file permissions
 * are not a substitute for external anchoring.
 *
 * @module features/AuditLog
 */

import { promises as fs } from 'fs';
import { randomUUID, createHash } from 'crypto';

// ==================== Types ====================

/**
 * Operations that can be audited.
 */
export type AuditOperation = 'create' | 'update' | 'delete' | 'merge' | 'archive';

/**
 * Fixed constant used as `prevHash` for the first chained entry of a file
 * that has no preceding lines (genesis).
 */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

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
  /**
   * Monotonic sequence number within this log file (0-based line position).
   * Optional on read — entries written before hash chaining existed lack it
   * (legacy entries still load).
   */
  seq?: number;
  /**
   * SHA-256 hex digest of the previous line's exact serialized text
   * (the JSON string as written, without the trailing newline).
   * {@link AUDIT_GENESIS_HASH} for the first entry of a fresh file.
   * Optional on read for legacy entries.
   */
  prevHash?: string;
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
  /**
   * Case-insensitive free-text substring matched against each entry's
   * serialized JSON text (so it can match anything: entity names, agent
   * ids, and before/after payload contents).
   */
  text?: string;
  /**
   * Maximum number of entries to return. When more entries match, the
   * MOST RECENT `limit` matches are kept (chronological order within the
   * returned slice is preserved). Non-finite or non-positive values are
   * ignored (no cap).
   */
  limit?: number;
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

/**
 * Result of {@link AuditLog.verifyChain}.
 */
export interface ChainVerificationResult {
  /**
   * `true` when every chained entry verified (or there was nothing chained
   * to verify — see `legacyLines`/`totalChecked` to distinguish
   * "verified clean" from "fully legacy, nothing verifiable").
   */
  valid: boolean;
  /**
   * 0-based index (over non-empty lines) of the first entry that failed
   * verification (bad `prevHash`, non-contiguous `seq`, or a chained entry
   * whose `seq` does not match its line position). The tampered line itself
   * may be `brokenAt - 1` when the tamper preserved that line's own fields
   * but changed its serialized text (detected via the next line's `prevHash`).
   */
  brokenAt?: number;
  /** Number of chained entries actually verified. */
  totalChecked: number;
  /**
   * Number of leading legacy lines (entries without `seq`/`prevHash`,
   * written before hash chaining existed). A fully-legacy file yields
   * `{ valid: true, totalChecked: 0, legacyLines: N }` — "legacy" handling:
   * nothing is verifiable, but nothing is provably broken either.
   */
  legacyLines: number;
  /** Number of non-empty lines that failed to parse as JSON. */
  malformedLines: number;
  /** 0-based index (over non-empty lines) of the first malformed line. */
  firstMalformedIndex?: number;
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
 * file next to the main storage file, created with mode `0600`. Each entry
 * carries a monotonic `seq` and a `prevHash` SHA-256 chain over the previous
 * line's exact text — see the module JSDoc for the honest trust boundary
 * (tamper-evident within the file, not tamper-proof against a writer who
 * rewrites the whole chain).
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
 * // Verify the chain
 * const check = await auditLog.verifyChain();
 * if (!check.valid) alertOps(`audit chain broken at line ${check.brokenAt}`);
 * ```
 */
export class AuditLog {
  /**
   * In-memory chain head: seq + hash of the last line this process knows
   * about. Lazily initialized from the file on first append.
   */
  private chainState?: { lastSeq: number; lastLineHash: string };

  /** Serializes appends so concurrent calls cannot interleave chain state. */
  private appendQueue: Promise<unknown> = Promise.resolve();

  /**
   * Number of malformed (unparseable) lines skipped by the most recent
   * {@link loadAll}. `loadAll` keeps skipping them for backward
   * compatibility, but they are no longer silent — inspect this counter
   * (or run {@link verifyChain}, which reports them with an index).
   */
  private malformedLines = 0;

  constructor(private readonly filePath: string) {}

  /** See {@link malformedLines}. */
  get malformedLineCount(): number {
    return this.malformedLines;
  }

  // ==================== Core Operations ====================

  /**
   * Append a new entry to the audit log.
   *
   * Auto-generates a UUID `id` and ISO 8601 `timestamp`, plus the
   * tamper-evidence fields: a monotonic `seq` and a `prevHash` SHA-256 hex
   * digest of the previous line's exact serialized text
   * ({@link AUDIT_GENESIS_HASH} for the first line of a fresh file).
   * Appending to a pre-chaining (legacy) file anchors the new entry to the
   * hash of the last existing line, so legacy content is covered by the
   * chain from that point forward.
   *
   * The file is written with mode `0600` (applies at creation).
   *
   * @param entry - Entry data without id or timestamp
   * @returns The complete AuditEntry as persisted
   */
  async append(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'seq' | 'prevHash'>): Promise<AuditEntry> {
    const task = this.appendQueue.then(async () => {
      const state = await this.initChainState();
      const seq = state.lastSeq + 1;

      const fullEntry: AuditEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry,
        seq,
        prevHash: state.lastLineHash,
      };

      const lineText = JSON.stringify(fullEntry);
      await fs.appendFile(this.filePath, lineText + '\n', { encoding: 'utf-8', mode: 0o600 });

      state.lastSeq = seq;
      state.lastLineHash = sha256Hex(lineText);

      return fullEntry;
    });
    // Keep the queue alive even if this append rejects.
    this.appendQueue = task.catch(() => undefined);
    return task;
  }

  /**
   * Query audit entries by filter criteria.
   *
   * All filter fields are optional; providing multiple fields applies
   * them as AND conditions. `text` performs a case-insensitive substring
   * match over each entry's serialized JSON; `limit` caps the result to
   * the most recent N matches (chronological order preserved).
   *
   * @param filter - Filter criteria
   * @returns Matching audit entries in chronological order
   */
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    const entries = await this.loadAll();
    const needle = filter.text !== undefined ? filter.text.toLowerCase() : undefined;

    const matched = entries.filter(entry => {
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
      if (needle !== undefined && !JSON.stringify(entry).toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });

    if (filter.limit !== undefined && Number.isFinite(filter.limit) && filter.limit > 0) {
      return matched.slice(-Math.floor(filter.limit));
    }
    return matched;
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

  /**
   * Replay the file and verify `seq`/`prevHash` continuity.
   *
   * Verification model:
   * - Leading entries without `seq`/`prevHash` are **legacy** (written before
   *   chaining existed) — counted in `legacyLines`, not verifiable.
   * - From the first chained entry onward, each entry must have
   *   `prevHash === sha256(previous line's exact text)` (or
   *   {@link AUDIT_GENESIS_HASH} when it is the file's first line) and
   *   `seq === previous seq + 1`. The first chained entry's `seq` must also
   *   equal its 0-based line position, which detects deletion of earlier
   *   legacy lines (a removed line shifts positions without changing hashes).
   * - Malformed (unparseable) lines are REPORTED (`malformedLines` +
   *   `firstMalformedIndex`), never silently skipped here. A malformed line
   *   inside the chained region also breaks the chain at the next entry,
   *   since its rewritten text no longer matches the recorded `prevHash`.
   *
   * A fully-legacy file returns `{ valid: true, totalChecked: 0,
   * legacyLines: N }` — treat `totalChecked === 0 && legacyLines > 0` as
   * "legacy: nothing verifiable" rather than "verified clean".
   *
   * Limits (see module JSDoc): tampering confined to the **last** line, or a
   * full rewrite of the chain from genesis, is self-consistent and cannot be
   * detected from the file alone — external anchoring is required for that.
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    let data: string;
    try {
      data = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { valid: true, totalChecked: 0, legacyLines: 0, malformedLines: 0 };
      }
      throw error;
    }

    const lines = data.split('\n')
      .map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
      .filter(line => line.trim() !== '');

    let legacyLines = 0;
    let malformedLines = 0;
    let firstMalformedIndex: number | undefined;
    let totalChecked = 0;
    let brokenAt: number | undefined;
    let inChain = false;
    let prevSeq = 0;

    for (let i = 0; i < lines.length; i++) {
      let parsed: AuditEntry | undefined;
      try {
        parsed = JSON.parse(lines[i]) as AuditEntry;
      } catch {
        malformedLines++;
        if (firstMalformedIndex === undefined) firstMalformedIndex = i;
      }

      if (!inChain) {
        if (parsed !== undefined && (parsed.seq !== undefined || parsed.prevHash !== undefined)) {
          // First chained entry.
          inChain = true;
          const expectedPrevHash = i === 0 ? AUDIT_GENESIS_HASH : sha256Hex(lines[i - 1]);
          if (
            typeof parsed.seq !== 'number' ||
            parsed.seq !== i || // detects removed/inserted leading lines
            parsed.prevHash !== expectedPrevHash
          ) {
            brokenAt = i;
            break;
          }
          prevSeq = parsed.seq;
          totalChecked++;
        } else {
          // Legacy (pre-chaining) or malformed leading line.
          if (parsed !== undefined) legacyLines++;
        }
        continue;
      }

      // Inside the chained region: every subsequent line must chain.
      const expectedPrevHash = sha256Hex(lines[i - 1]);
      if (
        parsed === undefined ||
        typeof parsed.seq !== 'number' ||
        parsed.seq !== prevSeq + 1 ||
        parsed.prevHash !== expectedPrevHash
      ) {
        brokenAt = i;
        break;
      }
      prevSeq = parsed.seq;
      totalChecked++;
    }

    // A malformed line outside the chained region is still a verification
    // failure signal (the file was written only by this class, which always
    // emits valid JSON), but for legacy files we cannot prove tampering —
    // report it without failing legacy-only files that predate chaining.
    const valid = brokenAt === undefined && (malformedLines === 0 || totalChecked === 0);

    return {
      valid,
      ...(brokenAt !== undefined
        ? { brokenAt }
        : (malformedLines > 0 && totalChecked > 0 ? { brokenAt: firstMalformedIndex } : {})),
      totalChecked,
      legacyLines,
      malformedLines,
      ...(firstMalformedIndex !== undefined ? { firstMalformedIndex } : {}),
    };
  }

  // ==================== Internal ====================

  /**
   * Load all entries from the JSONL file.
   *
   * Returns an empty array if the file does not exist.
   *
   * Malformed lines are skipped for backward compatibility, but counted —
   * see {@link malformedLineCount} and {@link verifyChain}.
   *
   * @private
   */
  async loadAll(): Promise<AuditEntry[]> {
    let data: string;
    try {
      data = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.malformedLines = 0;
        return [];
      }
      throw error;
    }

    const lines = data.split('\n').filter(line => line.trim() !== '');
    const entries: AuditEntry[] = [];
    let malformed = 0;
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed JSONL lines rather than crashing all audit reads —
        // but surface the count via malformedLineCount / verifyChain().
        malformed++;
      }
    }
    this.malformedLines = malformed;
    return entries;
  }

  /**
   * Lazily initialize (and cache) the chain head from the file tail.
   *
   * - Fresh file (or ENOENT): `lastSeq = -1`, `lastLineHash = GENESIS`.
   * - Existing chained file: continues from the last entry's `seq`.
   * - Legacy file (lines without `seq`): treats the K existing lines as
   *   occupying seq `0..K-1`, so the next entry gets `seq = K` and anchors
   *   to the hash of the last existing line.
   *
   * @private
   */
  private async initChainState(): Promise<{ lastSeq: number; lastLineHash: string }> {
    if (this.chainState) return this.chainState;

    let data: string;
    try {
      data = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.chainState = { lastSeq: -1, lastLineHash: AUDIT_GENESIS_HASH };
        return this.chainState;
      }
      throw error;
    }

    const lines = data.split('\n')
      .map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
      .filter(line => line.trim() !== '');

    if (lines.length === 0) {
      this.chainState = { lastSeq: -1, lastLineHash: AUDIT_GENESIS_HASH };
      return this.chainState;
    }

    const lastLine = lines[lines.length - 1];
    let lastSeq = lines.length - 1; // legacy default: lines occupy 0..K-1
    try {
      const parsed = JSON.parse(lastLine) as AuditEntry;
      if (typeof parsed.seq === 'number' && Number.isInteger(parsed.seq)) {
        lastSeq = parsed.seq;
      }
    } catch {
      // Unparseable tail — fall back to positional numbering.
    }

    this.chainState = { lastSeq, lastLineHash: sha256Hex(lastLine) };
    return this.chainState;
  }
}

// ==================== Helpers ====================

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
