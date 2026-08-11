/**
 * Role Assignment Store (η.6.1)
 *
 * In-process registry of `RoleAssignment` records. Optional JSONL sidecar
 * persistence — when configured, every `assign`/`revoke` writes a single
 * line; on construction, replays the file to rebuild the in-memory state.
 *
 * @module agent/rbac/RoleAssignmentStore
 */

import type { RoleAssignment, Role, ResourceType } from './RbacTypes.js';
import { promises as fs } from 'fs';

/** A single row in the JSONL persistence file. */
type StoreRecord =
  | { op: 'assign'; assignment: RoleAssignment; ts: string }
  | { op: 'revoke'; agentId: string; role: Role; resourceType?: ResourceType; ts: string };

const RESOURCE_TYPES = new Set<ResourceType>([
  'entity',
  'relation',
  'observation',
  'session',
  'artifact',
]);

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || isTimestamp(value);
}

function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && RESOURCE_TYPES.has(value as ResourceType);
}

function isRoleAssignment(value: unknown): value is RoleAssignment {
  if (typeof value !== 'object' || value === null) return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.agentId === 'string' && assignment.agentId.length > 0
    && typeof assignment.role === 'string' && assignment.role.length > 0
    && (assignment.resourceType === undefined || isResourceType(assignment.resourceType))
    && isOptionalString(assignment.scope)
    && isOptionalTimestamp(assignment.validFrom)
    && isOptionalTimestamp(assignment.validUntil)
    && isOptionalString(assignment.notes);
}

function isStoreRecord(value: unknown): value is StoreRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isTimestamp(record.ts)) return false;
  if (record.op === 'assign') return isRoleAssignment(record.assignment);
  if (record.op !== 'revoke') return false;
  return typeof record.agentId === 'string' && record.agentId.length > 0
    && typeof record.role === 'string' && record.role.length > 0
    && (record.resourceType === undefined || isResourceType(record.resourceType));
}

export interface RoleAssignmentStoreOptions {
  /** Path to a JSONL sidecar; absent ⇒ in-memory only. */
  persistencePath?: string;
}

export class RoleAssignmentStore {
  private readonly assignments = new Map<string, RoleAssignment[]>();
  private readonly persistencePath?: string;
  private corruptLines = 0;
  private hydrationIntegrityValid = true;

  constructor(options?: RoleAssignmentStoreOptions) {
    this.persistencePath = options?.persistencePath;
  }

  /**
   * Number of corrupt lines detected during the most recent
   * {@link hydrate} call (`0` before any hydrate, or when the file is clean).
   */
  get corruptLineCount(): number {
    return this.corruptLines;
  }

  /** Whether persisted assignments were fully and successfully replayed. */
  get integrityValid(): boolean {
    return this.hydrationIntegrityValid;
  }

  /**
   * Replay the JSONL persistence file (if configured) into the in-memory
   * map. Idempotent — safe to call multiple times. No-op when no path
   * is set or the file does not exist.
   *
   * Corrupt or malformed lines abort hydration, clear all replayed grants,
   * and leave {@link integrityValid} false so authorization fails closed.
   */
  async hydrate(): Promise<void> {
    if (!this.persistencePath) return;
    this.hydrationIntegrityValid = false;
    let content: string;
    try {
      content = await fs.readFile(this.persistencePath, 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.hydrationIntegrityValid = true;
        return;
      }
      throw e;
    }
    this.assignments.clear();
    this.corruptLines = 0;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        this.failHydration(index + 1);
      }
      if (!isStoreRecord(value)) this.failHydration(index + 1);
      if (value.op === 'assign') {
        this.applyAssign(value.assignment);
      } else {
        this.applyRevoke(value.agentId, value.role, value.resourceType);
      }
    }
    this.hydrationIntegrityValid = true;
  }

  /**
   * Add an assignment. Multiple grants per agent are allowed (e.g. one
   * agent may be a `reader` for entities and a `writer` for relations).
   * Persists if configured.
   */
  async assign(assignment: RoleAssignment): Promise<void> {
    this.applyAssign(assignment);
    await this.persist({ op: 'assign', assignment, ts: new Date().toISOString() });
  }

  /**
   * Remove a specific assignment. Matching is by `agentId + role +
   * resourceType` (the resourceType match is exact, including undefined).
   */
  async revoke(
    agentId: string,
    role: Role,
    resourceType?: ResourceType,
  ): Promise<void> {
    this.applyRevoke(agentId, role, resourceType);
    await this.persist({ op: 'revoke', agentId, role, resourceType, ts: new Date().toISOString() });
  }

  /** All assignments for the given agent (active and inactive). */
  list(agentId: string): RoleAssignment[] {
    return this.assignments.get(agentId)?.slice() ?? [];
  }

  /**
   * Active assignments for the given agent at the supplied time. Default
   * is current time. An assignment is active when `validFrom <= now <=
   * validUntil` (with absent bounds treated as unbounded).
   */
  listActive(agentId: string, now?: string): RoleAssignment[] {
    const ts = now ?? new Date().toISOString();
    return this.list(agentId).filter(a => {
      if (a.validFrom && a.validFrom > ts) return false;
      if (a.validUntil && a.validUntil < ts) return false;
      return true;
    });
  }

  // -------- Internal --------

  private failHydration(lineNumber: number): never {
    this.corruptLines++;
    this.assignments.clear();
    throw new Error(`RBAC persistence integrity check failed at line ${lineNumber}`);
  }

  private applyAssign(assignment: RoleAssignment): void {
    const list = this.assignments.get(assignment.agentId) ?? [];
    list.push(assignment);
    this.assignments.set(assignment.agentId, list);
  }

  private applyRevoke(
    agentId: string,
    role: Role,
    resourceType?: ResourceType,
  ): void {
    const list = this.assignments.get(agentId);
    if (!list) return;
    const filtered = list.filter(
      a => !(a.role === role && a.resourceType === resourceType),
    );
    if (filtered.length === 0) {
      this.assignments.delete(agentId);
    } else {
      this.assignments.set(agentId, filtered);
    }
  }

  private async persist(record: StoreRecord): Promise<void> {
    if (!this.persistencePath) return;
    const line = JSON.stringify(record) + '\n';
    // mode applies on initial file creation only (POSIX): the sidecar holds
    // grant data, so keep it owner-read/write (0600), not world-readable.
    await fs.appendFile(this.persistencePath, line, { encoding: 'utf-8', mode: 0o600 });
  }
}
