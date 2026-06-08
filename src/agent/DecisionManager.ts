/**
 * DecisionManager — Phase 3 Decision Rationale (Type 1).
 *
 * Runtime-queryable architecture-decision-record (ADR-equivalent).
 * Lets an agent answer "have we already decided X?" without scanning
 * markdown files. Storage-backed; mutations route through
 * `EntityManager.updateEntity` with `expectedVersion` OCC, matching the
 * #55 / 3B.8 / Excl patterns.
 *
 * Lifecycle: proposed → accepted | rejected; accepted → superseded.
 * All other transitions surface as `'illegal-transition'` on the
 * discriminated result types.
 *
 * @module agent/DecisionManager
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  DecisionEntity,
  DecisionId,
  DecisionLifecycle,
  DecisionRecord,
  DecisionStatus,
} from '../types/agent-memory.js';
import { isDecisionMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { VersionConflictError, EntityNotFoundError } from '../utils/errors.js';

/** Input shape for `propose()`. */
export interface DecisionInput {
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string[];
  relatedFiles?: string[];
  supersedes?: DecisionId;
  sourceSessionId?: string;
  sourceProjectId?: string;
}

/** Per-record entity-level metadata (importance / owning agent). */
export interface DecisionEntityOptions {
  importance?: number;
  agentId?: string;
}

/**
 * Discriminated return from `accept()`. Mirrors `MarkResolvedResult`
 * shape across agent-memory managers.
 */
export type AcceptDecisionResult =
  | 'accepted'
  | 'already-accepted'
  | 'not-found'
  | 'illegal-transition'
  | 'conflict'
  | 'vanished-mid-update';

/** Discriminated return from `reject()`. */
export type RejectDecisionResult =
  | 'rejected'
  | 'already-rejected'
  | 'not-found'
  | 'illegal-transition'
  | 'conflict'
  | 'vanished-mid-update';

/**
 * Discriminated return from `supersede()`.
 * - `'illegal-transition'`: target is not in `accepted` state.
 * - `'not-found'`: either target or replacement is missing.
 */
export type SupersedeDecisionResult =
  | 'superseded'
  | 'not-found'
  | 'illegal-transition'
  | 'conflict'
  | 'vanished-mid-update';

/** Options for `list()`. */
export interface ListDecisionsOptions {
  status?: DecisionStatus;
  sourceSessionId?: string;
  sourceProjectId?: string;
  limit?: number;
}

export class DecisionManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;

  constructor(storage: IGraphStorage, entityManager: EntityManager) {
    this.storage = storage;
    this.entityManager = entityManager;
  }

  /**
   * Register a new proposed decision. Validates non-empty `context`
   * and `decision`. Default `importance` is 8 (decisions are
   * high-importance by nature; one step above `FailureRecord`'s 7).
   */
  async propose(
    input: DecisionInput,
    options: DecisionEntityOptions = {},
  ): Promise<DecisionRecord> {
    validateNonEmpty(input.context, 'context');
    validateNonEmpty(input.decision, 'decision');

    const id = `decision-${randomUUID()}` as DecisionId;
    const now = toIsoDateTime(new Date());
    const lifecycle: DecisionLifecycle = { status: 'proposed' };
    const record: DecisionRecord = {
      id,
      timestamp: now,
      status: 'proposed',
      lifecycle,
      context: input.context,
      decision: input.decision,
      alternatives: [...input.alternatives],
      consequences: [...input.consequences],
      relatedFiles: input.relatedFiles ? [...input.relatedFiles] : undefined,
      supersedes: input.supersedes,
      sourceSessionId: input.sourceSessionId,
      sourceProjectId: input.sourceProjectId,
    };

    const entity: DecisionEntity = {
      name: id,
      entityType: 'decision',
      observations: [`[decision:proposed] ${input.context} → ${input.decision}`],
      createdAt: now,
      lastModified: now,
      importance: options.importance ?? 8,
      memoryType: 'decision',
      agentId: options.agentId,
      sessionId: input.sourceSessionId,
      visibility: 'private',
      accessCount: 0,
      confidence: 0.7, // proposals are confident-but-not-final
      confirmationCount: 0,
      decisionRecord: record,
    };
    try {
      await this.storage.appendEntity(entity as unknown as Entity);
    } catch (err) {
      throw new Error(
        `DecisionManager.propose: failed to persist '${id}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return record;
  }

  /** Sync lookup by id. */
  get(id: DecisionId | string): DecisionRecord | undefined {
    const entity = this.storage.getEntityByName(id);
    return isDecisionMemory(entity) ? entity.decisionRecord : undefined;
  }

  /** All decisions, optionally filtered. */
  async list(options: ListDecisionsOptions = {}): Promise<DecisionRecord[]> {
    const all = await this.loadAllDecisions();
    let filtered = all;
    if (options.status !== undefined) {
      filtered = filtered.filter((r) => r.status === options.status);
    }
    if (options.sourceSessionId !== undefined) {
      filtered = filtered.filter((r) => r.sourceSessionId === options.sourceSessionId);
    }
    if (options.sourceProjectId !== undefined) {
      filtered = filtered.filter((r) => r.sourceProjectId === options.sourceProjectId);
    }
    if (options.limit !== undefined) filtered = filtered.slice(0, options.limit);
    return filtered;
  }

  /**
   * Substring search across `context`, `decision`, and `consequences`.
   * Conservative for v1 — semantic / embedding search comes later if
   * usage data motivates it.
   */
  async findByContext(query: string): Promise<DecisionRecord[]> {
    const needle = query.toLowerCase();
    const all = await this.loadAllDecisions();
    return all.filter((r) => {
      if (r.context.toLowerCase().includes(needle)) return true;
      if (r.decision.toLowerCase().includes(needle)) return true;
      for (const c of r.consequences) {
        if (c.toLowerCase().includes(needle)) return true;
      }
      return false;
    });
  }

  /**
   * Walk the `supersedes` link backward from the supplied id to the
   * original proposal. Returns the chain ordered oldest-first; the
   * supplied id is the last element. Single-element chain when the
   * decision has no predecessor.
   */
  async getChain(id: DecisionId | string): Promise<DecisionRecord[]> {
    const chain: DecisionRecord[] = [];
    let cursor: DecisionId | string | undefined = id;
    const seen = new Set<string>(); // cycle protection
    while (cursor !== undefined) {
      if (seen.has(cursor)) break; // defensive — a corrupted on-disk chain
      seen.add(cursor);
      const rec = this.get(cursor);
      if (!rec) break;
      chain.unshift(rec); // oldest-first order
      cursor = rec.supersedes;
    }
    return chain;
  }

  // ==================== Lifecycle ====================

  async accept(id: DecisionId | string): Promise<AcceptDecisionResult> {
    const entity = this.storage.getEntityByName(id);
    if (!isDecisionMemory(entity)) return 'not-found';
    const cur = entity.decisionRecord;
    if (cur.status === 'accepted') return 'already-accepted';
    if (cur.status !== 'proposed') return 'illegal-transition';
    const now = toIsoDateTime(new Date());
    const lifecycle: DecisionLifecycle = { status: 'accepted', acceptedAt: now };
    return this.applyUpdate(id, entity.version, lifecycle, 'accepted') as Promise<AcceptDecisionResult>;
  }

  async reject(id: DecisionId | string, reason: string): Promise<RejectDecisionResult> {
    validateNonEmpty(reason, 'reason');
    const entity = this.storage.getEntityByName(id);
    if (!isDecisionMemory(entity)) return 'not-found';
    const cur = entity.decisionRecord;
    if (cur.status === 'rejected') return 'already-rejected';
    if (cur.status !== 'proposed') return 'illegal-transition';
    const now = toIsoDateTime(new Date());
    const lifecycle: DecisionLifecycle = {
      status: 'rejected',
      rejectedAt: now,
      rejectedReason: reason,
    };
    return this.applyUpdate(id, entity.version, lifecycle, 'rejected') as Promise<RejectDecisionResult>;
  }

  async supersede(
    id: DecisionId | string,
    by: DecisionId,
  ): Promise<SupersedeDecisionResult> {
    const entity = this.storage.getEntityByName(id);
    if (!isDecisionMemory(entity)) return 'not-found';
    const replacement = this.storage.getEntityByName(by);
    if (!isDecisionMemory(replacement)) return 'not-found';
    const cur = entity.decisionRecord;
    if (cur.status !== 'accepted') return 'illegal-transition';
    const now = toIsoDateTime(new Date());
    const lifecycle: DecisionLifecycle = {
      status: 'superseded',
      supersededAt: now,
      supersededBy: by,
    };
    return this.applyUpdate(id, entity.version, lifecycle, 'superseded') as Promise<SupersedeDecisionResult>;
  }

  // ==================== ADR markdown dual-write (Phase Dec B) ====================

  /**
   * Render a stored decision as ADR-format markdown. Pure function;
   * synchronous via the storage name-index.
   *
   * @throws Error when the decision is not found.
   */
  exportAsAdrMarkdown(id: DecisionId | string): string {
    const rec = this.get(id);
    if (!rec) {
      throw new Error(`DecisionManager.exportAsAdrMarkdown: decision '${id}' not found`);
    }
    const title = firstLine(rec.decision);
    const lines: string[] = [];
    lines.push(`# ${rec.id}: ${title}`);
    lines.push('');
    lines.push(`Date: ${rec.timestamp}`);
    lines.push('');
    lines.push('## Status');
    lines.push('');
    lines.push(formatStatus(rec.status));
    if (rec.supersedes) {
      lines.push('');
      lines.push(`Supersedes: ${rec.supersedes}`);
    }
    lines.push('');
    lines.push('## Context');
    lines.push('');
    lines.push(rec.context);
    lines.push('');
    lines.push('## Decision');
    lines.push('');
    lines.push(rec.decision);
    if (rec.consequences.length > 0) {
      lines.push('');
      lines.push('## Consequences');
      lines.push('');
      for (const c of rec.consequences) lines.push(`- ${c}`);
    }
    if (rec.alternatives.length > 0) {
      lines.push('');
      lines.push('## Alternatives');
      lines.push('');
      for (const a of rec.alternatives) lines.push(`- ${a}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Parse a hand-written or previously-exported ADR into a
   * `DecisionInput` shape. Returns `null` when the required `## Context`
   * and `## Decision` sections are missing or empty — callers should
   * branch on null rather than catch.
   *
   * Static so callers can parse without instantiating a manager.
   * Status / supersedes-link in the markdown are informational only;
   * imports flow through `propose()` and start as `'proposed'`.
   */
  static parseAdrMarkdown(text: string): DecisionInput | null {
    const sections = new Map<string, string[]>();
    let current: string | null = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine;
      const m = /^##\s+(.+?)\s*$/.exec(line);
      if (m) {
        current = m[1]!.toLowerCase();
        if (!sections.has(current)) sections.set(current, []);
        continue;
      }
      if (current !== null) {
        sections.get(current)!.push(line);
      }
    }

    const contextLines = trimBlock(sections.get('context'));
    const decisionLines = trimBlock(sections.get('decision'));
    if (contextLines.length === 0 || decisionLines.length === 0) return null;

    return {
      context: contextLines.join('\n').trim(),
      decision: decisionLines.join('\n').trim(),
      alternatives: parseBulletList(sections.get('alternatives')),
      consequences: parseBulletList(sections.get('consequences')),
    };
  }

  // ==================== Internal ====================

  private async applyUpdate(
    id: DecisionId | string,
    version: number | undefined,
    lifecycle: DecisionLifecycle,
    successLabel: 'accepted' | 'rejected' | 'superseded',
  ): Promise<AcceptDecisionResult | RejectDecisionResult | SupersedeDecisionResult> {
    const entity = this.storage.getEntityByName(id);
    if (!isDecisionMemory(entity)) return 'not-found';
    const updatedRecord: DecisionRecord = {
      ...entity.decisionRecord,
      status: lifecycle.status,
      lifecycle,
    };
    try {
      await this.entityManager.updateEntity(
        id,
        {
          decisionRecord: updatedRecord,
          lastModified: toIsoDateTime(new Date()),
        } as unknown as Partial<Entity>,
        { expectedVersion: version ?? 1 },
      );
      return successLabel;
    } catch (err) {
      if (err instanceof VersionConflictError) return 'conflict';
      if (err instanceof EntityNotFoundError) return 'vanished-mid-update';
      throw err;
    }
  }

  private async loadAllDecisions(): Promise<DecisionRecord[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isDecisionMemory).map((e) => e.decisionRecord);
  }
}

// ==================== Helpers ====================

function validateNonEmpty(value: unknown, fieldName: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `DecisionManager: ${fieldName} must be a non-empty string; received ${JSON.stringify(value)}`,
    );
  }
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return (idx === -1 ? s : s.slice(0, idx)).trim();
}

function formatStatus(s: DecisionStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function trimBlock(lines: string[] | undefined): string[] {
  if (!lines) return [];
  // Drop leading/trailing blanks; preserve internal structure.
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end);
}

function parseBulletList(lines: string[] | undefined): string[] {
  if (!lines) return [];
  const items: string[] = [];
  for (const raw of lines) {
    const m = /^\s*[-*+]\s+(.+?)\s*$/.exec(raw);
    if (m) items.push(m[1]!);
  }
  return items;
}
