/**
 * ProjectContextManager — Phase 3 Project Context (Type 2).
 *
 * Structured project-knowledge companion to unstructured CLAUDE.md
 * content. One `ProjectContextRecord` per `projectId` (uniqueness
 * enforced at the manager level); the entity's `name` is
 * `project-context-${projectId}`.
 *
 * Merge semantics: arrays append + dedup; scalars overwrite. Mutations
 * route through `EntityManager.updateEntity({expectedVersion})` for
 * OCC, matching the v2.0.x #55 pattern. `forContext()` formats the
 * record as a prose summary fit for the Phase PC B
 * `ContextWindowManager.wakeUp` L0 layer.
 *
 * @module agent/ProjectContextManager
 */

import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  ProjectContextCommand,
  ProjectContextEntity,
  ProjectContextGlossaryTerm,
  ProjectContextRecord,
} from '../types/agent-memory.js';
import { isProjectContextMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { validateNonEmpty } from '../utils/index.js';

const ENTITY_NAME_PREFIX = 'project-context-';

function projectContextEntityName(projectId: string): string {
  return `${ENTITY_NAME_PREFIX}${projectId}`;
}

/** Input shape for `upsert`. */
export interface ProjectContextUpsertInput {
  facts?: string[];
  conventions?: string[];
  commands?: ProjectContextCommand[];
  glossary?: ProjectContextGlossaryTerm[];
}

export interface ProjectContextManagerConfig {
  /** Default character budget for `forContext`. Default 1500. */
  defaultBudgetChars?: number;
}

export interface ForContextOptions {
  /** Character cap for the rendered prose. Default uses manager config. */
  budgetChars?: number;
}

export class ProjectContextManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly defaultBudgetChars: number;

  constructor(
    storage: IGraphStorage,
    entityManager: EntityManager,
    config: ProjectContextManagerConfig = {},
  ) {
    this.storage = storage;
    this.entityManager = entityManager;
    this.defaultBudgetChars = config.defaultBudgetChars ?? 1500;
  }

  /**
   * Create or merge a `ProjectContextRecord`. Array fields append + dedup;
   * scalar `lastUpdated` overwrites. OCC-protected on updates.
   */
  async upsert(
    projectId: string,
    input: ProjectContextUpsertInput,
  ): Promise<ProjectContextRecord> {
    validateNonEmpty(projectId, 'projectId', 'ProjectContextManager');
    const name = projectContextEntityName(projectId);
    const now = toIsoDateTime(new Date());
    const existing = this.storage.getEntityByName(name);

    if (!existing || !isProjectContextMemory(existing)) {
      const record: ProjectContextRecord = {
        id: projectId,
        timestamp: now,
        projectId,
        facts: dedupStrings(input.facts ?? []),
        conventions: dedupStrings(input.conventions ?? []),
        commands: dedupCommands(input.commands ?? []),
        glossary: dedupGlossary(input.glossary ?? []),
        lastUpdated: now,
      };
      const entity: ProjectContextEntity = {
        name,
        entityType: 'project_context',
        observations: [`[project_context] ${projectId}`],
        createdAt: now,
        lastModified: now,
        importance: 6,
        memoryType: 'project_context',
        projectId,
        visibility: 'private',
        accessCount: 0,
        confidence: 0.9,
        confirmationCount: 0,
        projectContextRecord: record,
      };
      await this.storage.appendEntity(entity as unknown as Entity);
      return record;
    }

    // Merge against existing
    const cur = existing.projectContextRecord;
    const merged: ProjectContextRecord = {
      ...cur,
      facts: dedupStrings([...cur.facts, ...(input.facts ?? [])]),
      conventions: dedupStrings([...cur.conventions, ...(input.conventions ?? [])]),
      commands: dedupCommands([...cur.commands, ...(input.commands ?? [])]),
      glossary: dedupGlossary([...cur.glossary, ...(input.glossary ?? [])]),
      lastUpdated: now,
    };
    try {
      await this.entityManager.updateEntity(
        name,
        {
          projectContextRecord: merged,
          lastModified: now,
        } as unknown as Partial<Entity>,
        { expectedVersion: existing.version ?? 1 },
      );
    } catch (err) {
      // Surface conflict / vanish via thrown error — the manager's
      // discriminated-result pattern is reserved for state-machine
      // transitions; upsert is a pure merge.
      throw new Error(
        `ProjectContextManager.upsert: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return merged;
  }

  /** Sync lookup. */
  get(projectId: string): ProjectContextRecord | undefined {
    const entity = this.storage.getEntityByName(projectContextEntityName(projectId));
    return isProjectContextMemory(entity) ? entity.projectContextRecord : undefined;
  }

  // ==================== Typed appenders ====================

  async appendFact(projectId: string, fact: string): Promise<ProjectContextRecord> {
    return this.upsert(projectId, { facts: [fact] });
  }

  async appendConvention(projectId: string, convention: string): Promise<ProjectContextRecord> {
    return this.upsert(projectId, { conventions: [convention] });
  }

  async appendCommand(
    projectId: string,
    command: ProjectContextCommand,
  ): Promise<ProjectContextRecord> {
    return this.upsert(projectId, { commands: [command] });
  }

  async appendGlossaryTerm(
    projectId: string,
    entry: ProjectContextGlossaryTerm,
  ): Promise<ProjectContextRecord> {
    return this.upsert(projectId, { glossary: [entry] });
  }

  // ==================== Removers ====================

  async removeFact(projectId: string, fact: string): Promise<boolean> {
    return this.removeFromArray(projectId, 'facts', (f) => f === fact);
  }

  async removeConvention(projectId: string, convention: string): Promise<boolean> {
    return this.removeFromArray(projectId, 'conventions', (c) => c === convention);
  }

  async removeCommand(projectId: string, commandName: string): Promise<boolean> {
    return this.removeFromArray(projectId, 'commands', (c) => c.name === commandName);
  }

  async removeGlossaryTerm(projectId: string, term: string): Promise<boolean> {
    return this.removeFromArray(projectId, 'glossary', (g) => g.term === term);
  }

  /** Wipe the four arrays but keep the entity. */
  async clear(projectId: string): Promise<boolean> {
    const name = projectContextEntityName(projectId);
    const entity = this.storage.getEntityByName(name);
    if (!isProjectContextMemory(entity)) return false;
    const now = toIsoDateTime(new Date());
    const cleared: ProjectContextRecord = {
      ...entity.projectContextRecord,
      facts: [],
      conventions: [],
      commands: [],
      glossary: [],
      lastUpdated: now,
    };
    await this.entityManager.updateEntity(
      name,
      {
        projectContextRecord: cleared,
        lastModified: now,
      } as unknown as Partial<Entity>,
      { expectedVersion: entity.version ?? 1 },
    );
    return true;
  }

  // ==================== Formatting ====================

  /**
   * Render the project context as a prose summary suitable for the
   * Phase PC B wakeUp L0 layer. Empty string when there is no record
   * for `projectId`. Honors `budgetChars` (defaults to manager config),
   * truncating with an ellipsis when the rendered prose exceeds it.
   */
  async forContext(projectId: string, options: ForContextOptions = {}): Promise<string> {
    const rec = this.get(projectId);
    if (!rec) return '';
    const budget = options.budgetChars ?? this.defaultBudgetChars;
    const sections: string[] = [];
    if (rec.facts.length > 0) {
      sections.push(`Facts:\n${rec.facts.map((f) => `- ${f}`).join('\n')}`);
    }
    if (rec.conventions.length > 0) {
      sections.push(`Conventions:\n${rec.conventions.map((c) => `- ${c}`).join('\n')}`);
    }
    if (rec.commands.length > 0) {
      sections.push(
        `Commands:\n${rec.commands
          .map((c) => `- ${c.name}: ${c.command} — ${c.purpose}`)
          .join('\n')}`,
      );
    }
    if (rec.glossary.length > 0) {
      sections.push(
        `Glossary:\n${rec.glossary.map((g) => `- ${g.term}: ${g.definition}`).join('\n')}`,
      );
    }
    const full = sections.join('\n\n');
    if (full.length <= budget) return full;
    return `${full.slice(0, budget - 1)}…`;
  }

  // ==================== Internal ====================

  private async removeFromArray<
    K extends 'facts' | 'conventions' | 'commands' | 'glossary',
  >(
    projectId: string,
    field: K,
    predicate: (item: ProjectContextRecord[K][number]) => boolean,
  ): Promise<boolean> {
    const name = projectContextEntityName(projectId);
    const entity = this.storage.getEntityByName(name);
    if (!isProjectContextMemory(entity)) return false;
    const cur = entity.projectContextRecord;
    const items = cur[field] as ProjectContextRecord[K][number][];
    const filtered = items.filter((item) => !predicate(item));
    if (filtered.length === items.length) return false; // nothing matched
    const now = toIsoDateTime(new Date());
    const updated: ProjectContextRecord = {
      ...cur,
      [field]: filtered,
      lastUpdated: now,
    };
    await this.entityManager.updateEntity(
      name,
      {
        projectContextRecord: updated,
        lastModified: now,
      } as unknown as Partial<Entity>,
      { expectedVersion: entity.version ?? 1 },
    );
    return true;
  }
}

// ==================== Helpers ====================

function dedupStrings(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function dedupCommands(arr: ProjectContextCommand[]): ProjectContextCommand[] {
  const byName = new Map<string, ProjectContextCommand>();
  for (const c of arr) byName.set(c.name, c);
  return Array.from(byName.values());
}

function dedupGlossary(arr: ProjectContextGlossaryTerm[]): ProjectContextGlossaryTerm[] {
  const byTerm = new Map<string, ProjectContextGlossaryTerm>();
  for (const g of arr) byTerm.set(g.term, g);
  return Array.from(byTerm.values());
}
