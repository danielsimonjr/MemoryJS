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

export interface RoleAssignmentStoreOptions {
  /** Path to a JSONL sidecar; absent ⇒ in-memory only. */
  persistencePath?: string;
}

export class RoleAssignmentStore {
  private readonly assignments = new Map<string, RoleAssignment[]>();
  private readonly persistencePath?: string;

  constructor(options?: RoleAssignmentStoreOptions) {
    this.persistencePath = options?.persistencePath;
  }

  /**
   * Replay the JSONL persistence file (if configured) into the in-memory
   * map. Idempotent — safe to call multiple times. No-op when no path
   * is set or the file does not exist.
   */
  async hydrate(): Promise<void> {
    if (!this.persistencePath) return;
    let content: string;
    try {
      content = await fs.readFile(this.persistencePath, 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    this.assignments.clear();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as StoreRecord;
        if (rec.op === 'assign') {
          this.applyAssign(rec.assignment);
        } else {
          this.applyRevoke(rec.agentId, rec.role, rec.resourceType);
        }
      } catch {
        // Tolerate corrupt lines — log via console.warn would leak.
      }
    }
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
    await fs.appendFile(this.persistencePath, line, 'utf-8');
  }
}
