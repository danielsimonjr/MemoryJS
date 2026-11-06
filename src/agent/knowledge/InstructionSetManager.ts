/**
 * Instruction-set manager (Recursa RS-4).
 *
 * Stores the solver / learner / shared instructions (system prompt,
 * guardrails, conventions) as editable, source-linked `instruction_set`
 * entities. Each heading-addressed section is versioned at the entity level
 * through OCC (`expectedVersion`).
 *
 * **Write path.** `add` uses `EntityManager.createEntities` and
 * `patchSection` uses `EntityManager.updateEntity(name, patch,
 * { expectedVersion })` (the HeuristicManager pattern), so governance hooks
 * and audit run. `EntityManager` holds `graphMutex` across its version check
 * and write. A patch without a caller version re-reads and retries on a
 * version conflict until it commits.
 *
 * @module agent/knowledge/InstructionSetManager
 * @experimental Part of the Recursa knowledge-repository work (spec RS-4).
 */

import type { Entity, IGraphStorage } from '../../types/types.js';
import type {
  InstructionSection,
  InstructionSetEntity,
  InstructionSetRecord,
  InstructionSetRole,
  SkillSource,
} from '../../types/skills.js';
import { isInstructionSetEntity, toIsoDateTime } from '../../types/agent-memory.js';
import type { TransitionEvent } from '../../core/TransitionLedger.js';
import { EntityManager } from '../../core/EntityManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { VersionConflictError } from '../../utils/errors.js';
import { readEnvNumber } from '../../utils/envConfig.js';
import { fitInOrder, shortId } from './knowledgeDigest.js';

/** Roles accepted by the instruction-set manager. */
const ROLES: readonly InstructionSetRole[] = ['solver', 'learner', 'shared'];

/** Outcome of {@link InstructionSetManager.patchSection}. */
export type InstructionPatchResult = 'updated' | 'not-found' | 'version-conflict';

/** Read-only view of a transition ledger (structural; `TransitionLedger` satisfies it). */
export interface InstructionHistorySource {
  /** Events recorded for one entity, oldest first. */
  getHistory(entityId: string, limit?: number): TransitionEvent[];
}

/** Options for {@link InstructionSetManager}. */
export interface InstructionSetManagerOptions {
  /** Optional ledger backing `history()`. Without one, `history()` returns `[]`. */
  ledger?: InstructionHistorySource | null;
  /** Write path (pass `ctx.entityManager` so governance hooks apply). Defaults to a plain `EntityManager` over the storage. */
  entityManager?: EntityManager;
}

/** One section flattened for rendering, tagged with its owning set. */
export interface InstructionItem {
  /** Owning instruction-set id. */
  setId: string;
  /** Section heading. */
  heading: string;
  /** Section text. */
  text: string;
}

/**
 * Sections applicable to `role`: sets with that exact role plus `shared`
 * sets. Sets are ordered by creation time then id; sections keep their order.
 *
 * @param sets - Instruction-set records to filter.
 * @param role - Requested role.
 * @returns Flattened section items.
 */
export function instructionItemsFor(
  sets: readonly InstructionSetRecord[],
  role: InstructionSetRole,
): InstructionItem[] {
  const applicable = sets
    .filter((set) => set.role === role || set.role === 'shared')
    .sort((a, b) => (a.createdAt === b.createdAt ? compareText(a.id, b.id) : compareText(a.createdAt, b.createdAt)));
  const items: InstructionItem[] = [];
  for (const set of applicable) {
    for (const section of set.sections) {
      items.push({ setId: set.id, heading: section.heading, text: section.text });
    }
  }
  return items;
}

/**
 * Markdown rendering of instruction items: one `### heading` block per item.
 *
 * @param items - Items to render, in order.
 * @returns Markdown text (empty string for no items).
 */
export function renderInstructionItems(items: readonly InstructionItem[]): string {
  return items.map((item) => `### ${item.heading}\n\n${item.text}`).join('\n\n');
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function assertRole(role: string): asserts role is InstructionSetRole {
  if (!ROLES.includes(role as InstructionSetRole)) {
    throw new RangeError(`InstructionSetManager: unknown role '${role}'`);
  }
}

/**
 * Storage-backed registry of instruction sets.
 *
 * @example
 * ```typescript
 * const sets = new InstructionSetManager(storage);
 * const id = await sets.add({ role: 'solver', sections: [] });
 * await sets.patchSection(id, 'Goal', 'Answer with citations.', [], { expectedVersion: 1 });
 * const prompt = sets.render('solver', { budgetTokens: 800 });
 * ```
 */
export class InstructionSetManager {
  private readonly storage: IGraphStorage;
  private readonly ledger: InstructionHistorySource | null;
  private readonly entityManager: EntityManager;

  /**
   * Create a manager over one storage backend.
   *
   * @param storage - Storage backend (JSONL or SQLite).
   * @param options - Optional transition ledger for `history()`.
   */
  constructor(storage: IGraphStorage, options: InstructionSetManagerOptions = {}) {
    this.storage = storage;
    this.ledger = options.ledger ?? null;
    this.entityManager = options.entityManager ?? new EntityManager(storage as GraphStorage);
  }

  /**
   * Create an instruction set. Returns its id (`instructions-<role>-<shortId>`
   * unless `id` is given). An existing set with the same explicit id is
   * returned unchanged.
   *
   * @param input - Role, optional initial sections and optional explicit id.
   * @returns The instruction-set id.
   * @throws RangeError for an unknown role.
   */
  async add(input: { role: InstructionSetRole; sections?: InstructionSection[]; id?: string }): Promise<string> {
    assertRole(input.role);
    const id = input.id ?? `instructions-${input.role}-${shortId()}`;
    await this.storage.ensureLoaded();
    if (isInstructionSetEntity(this.storage.getEntityByName(id))) return id;
    const now = toIsoDateTime(new Date());
    const record: InstructionSetRecord = {
      id,
      role: input.role,
      sections: (input.sections ?? []).map(cloneSection),
      createdAt: now,
      lastUpdatedAt: now,
    };
    await this.entityManager.createEntities([buildInstructionSetEntity(record, now) as unknown as Entity]);
    return id;
  }

  /**
   * Look up one instruction set by id (synchronous name-index read).
   *
   * @param id - Instruction-set id.
   * @returns The record, or `undefined` when absent.
   */
  get(id: string): InstructionSetRecord | undefined {
    const entity = this.storage.getEntityByName(id);
    return isInstructionSetEntity(entity) ? entity.instructionSetRecord : undefined;
  }

  /**
   * All instruction sets, optionally restricted to one role.
   *
   * @param role - When given, only sets with exactly this role.
   * @returns Records in storage order.
   */
  async list(role?: InstructionSetRole): Promise<InstructionSetRecord[]> {
    const graph = await this.storage.loadGraph();
    const records = graph.entities
      .filter(isInstructionSetEntity)
      .map((entity) => entity.instructionSetRecord);
    return role === undefined ? records : records.filter((record) => record.role === role);
  }

  /**
   * Replace the text of a section, or append it when the heading is new.
   * OCC: when `expectedVersion` is given and differs from the live entity
   * version, nothing is written and `'version-conflict'` is returned.
   *
   * @param id - Instruction-set id.
   * @param heading - Section heading (non-empty).
   * @param text - New section text.
   * @param sources - Sources supporting the text.
   * @param options - Optional `expectedVersion` for OCC.
   * @returns `'updated'`, `'not-found'` or `'version-conflict'`.
   * @throws TypeError when `heading` is blank.
   */
  async patchSection(
    id: string,
    heading: string,
    text: string,
    sources: SkillSource[],
    options: { expectedVersion?: number } = {},
  ): Promise<InstructionPatchResult> {
    if (heading.trim().length === 0) throw new TypeError('InstructionSetManager.patchSection: heading must be non-empty');
    for (;;) {
      await this.storage.ensureLoaded();
      const entity = this.storage.getEntityByName(id);
      if (!isInstructionSetEntity(entity)) return 'not-found';
      const liveVersion = entity.version ?? 1;
      if (options.expectedVersion !== undefined && options.expectedVersion !== liveVersion) {
        return 'version-conflict';
      }
      const now = toIsoDateTime(new Date());
      const record = entity.instructionSetRecord;
      const existing = record.sections.find((section) => section.heading === heading);
      const replacement: InstructionSection = {
        heading,
        text,
        sources: sources.map((source) => ({ ...source })),
        uncertainty: existing?.uncertainty ?? 0.5,
      };
      const sections = existing
        ? record.sections.map((section) => (section.heading === heading ? replacement : section))
        : [...record.sections, replacement];
      const updated: InstructionSetRecord = { ...record, sections, lastUpdatedAt: now };
      try {
        await this.entityManager.updateEntity(id, {
          instructionSetRecord: updated,
          lastModified: now,
        } as unknown as Partial<Entity>, { expectedVersion: liveVersion });
        return 'updated';
      } catch (err) {
        if (!(err instanceof VersionConflictError)) throw err;
        if (options.expectedVersion !== undefined) return 'version-conflict';
      }
    }
  }

  /**
   * Render the sections applicable to `role` as Markdown, trimmed in order to
   * `budgetTokens` (estimated with `estimateTokensFromText`).
   *
   * @param role - Role to render.
   * @param options - Token budget (default 4000) and tokens-per-word multiplier
   *   (default `MEMORY_CONTEXT_TOKEN_MULTIPLIER`, else 1.3).
   * @returns Markdown text that fits the budget.
   */
  async render(
    role: InstructionSetRole,
    options: { budgetTokens?: number; multiplier?: number } = {},
  ): Promise<string> {
    const budget = options.budgetTokens ?? 4000;
    const multiplier = options.multiplier ?? readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3);
    const items = instructionItemsFor(await this.list(), role);
    return renderInstructionItems(fitInOrder(items, renderInstructionItems, budget, multiplier));
  }

  /**
   * Transition history of one instruction set, oldest first. Empty when no
   * ledger is configured.
   *
   * @param id - Instruction-set id.
   * @param limit - Optional cap on returned events.
   * @returns Ledger events for the entity.
   */
  history(id: string, limit?: number): TransitionEvent[] {
    return this.ledger?.getHistory(id, limit) ?? [];
  }
}

function cloneSection(section: InstructionSection): InstructionSection {
  return {
    heading: section.heading,
    text: section.text,
    sources: section.sources.map((source) => ({ ...source })),
    uncertainty: section.uncertainty,
  };
}

/**
 * Build the persisted `instruction_set` entity for a record. Exported for
 * `KnowledgeRepository`, which creates sets during rollback.
 */
export function buildInstructionSetEntity(record: InstructionSetRecord, now: string): InstructionSetEntity {
  return {
    name: record.id,
    entityType: 'instruction_set',
    observations: [`[instruction_set] role: ${record.role}`],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'instruction_set',
    visibility: 'private',
    accessCount: 0,
    confidence: 1,
    confirmationCount: 0,
    version: 1,
    instructionSetRecord: record,
  } as unknown as InstructionSetEntity;
}

