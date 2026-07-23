/**
 * Procedure Store (3B.4)
 *
 * Persists `Procedure` records as real graph structure instead of JSON
 * blobs, so procedure content is queryable and traversable:
 *
 * - The procedure itself is an `entityType: 'procedure'` entity (name =
 *   `procedure.id`). Its observations carry the description plus
 *   human-readable scalar lines (`[success-rate]: 0.85`,
 *   `[execution-count]: 12`). Tags = `['procedure', ...triggers]`.
 * - Every step is its own `entityType: 'procedure-step'` entity named
 *   `${procedureId}::step-${order}` (fallbacks: `${parentStepName}::fallback`,
 *   recursively). Step observations encode one field per line:
 *   `[order]: <n>`, `[action]: <action>`, `[timeout]: <ms>`, and one
 *   `[param]: <JSON-key>=<JSON-value>` line per parameter — key and value
 *   are JSON-encoded separately so arbitrary strings (equals signs,
 *   newlines, unicode) roundtrip.
 * - Relations wire it together: procedure —`has_step`→ each top-level
 *   step, step —`precedes`→ the next step in sequence, and step
 *   —`has_fallback`→ its fallback step. Step entities set `parentId` to
 *   the procedure id for hierarchy integration.
 *
 * Legacy JSON-blob procedures (`[procedure-steps]:` / `[procedure-meta]:`
 * observations) remain decodable via `decodeProcedure` and are
 * auto-migrated to the decomposed shape on `load()`; use
 * `migrateLegacyProcedures` for bulk migration.
 *
 * @module agent/procedural/ProcedureStore
 */

import type { Entity, Relation } from '../../types/index.js';
import type { EntityManager } from '../../core/EntityManager.js';
import type { RelationManager } from '../../core/RelationManager.js';
import type { Procedure, ProcedureStep } from '../../types/procedure.js';

/** Legacy sentinel prefixes for the JSON-blob observation lines. */
const STEPS_PREFIX = '[procedure-steps]:';
const META_PREFIX = '[procedure-meta]:';

/** Scalar observation prefixes on the procedure entity. */
const SUCCESS_RATE_PREFIX = '[success-rate]: ';
const EXECUTION_COUNT_PREFIX = '[execution-count]: ';

/** Field observation prefixes on step entities. */
const ORDER_PREFIX = '[order]: ';
const ACTION_PREFIX = '[action]: ';
const TIMEOUT_PREFIX = '[timeout]: ';
const PARAM_PREFIX = '[param]: ';

export const PROCEDURE_ENTITY_TYPE = 'procedure';
export const PROCEDURE_STEP_ENTITY_TYPE = 'procedure-step';

/** Relation types linking procedures and steps. */
export const HAS_STEP_RELATION = 'has_step';
export const PRECEDES_RELATION = 'precedes';
export const HAS_FALLBACK_RELATION = 'has_fallback';

/** Entity name for a top-level step of a procedure. */
export function stepEntityName(procedureId: string, order: number): string {
  return `${procedureId}::step-${order}`;
}

/** Entity name for the fallback of a step entity. */
export function fallbackEntityName(parentStepName: string): string {
  return `${parentStepName}::fallback`;
}

export class ProcedureStore {
  constructor(
    private readonly entityManager: EntityManager,
    private readonly relationManager: RelationManager,
  ) {}

  /**
   * Persist a new procedure. The entity name = `procedure.id`; each step
   * (and recursive fallback) becomes its own `procedure-step` entity
   * linked via `has_step` / `precedes` / `has_fallback` relations.
   * Idempotent on duplicate id (relies on `EntityManager.createEntities`
   * skip-duplicate semantics). Step `order` values are assumed unique
   * within a procedure (they name the step entities).
   */
  async save(procedure: Procedure): Promise<void> {
    await this.entityManager.createEntities([
      {
        name: procedure.id,
        entityType: PROCEDURE_ENTITY_TYPE,
        observations: encodeProcedureObservations(procedure),
        tags: ['procedure', ...(procedure.triggers ?? [])],
      },
    ]);
    await this.createStepGraph(procedure);
  }

  /**
   * Load a procedure by id, or undefined if not found. Tolerant of
   * partial encodings — steps default to `[]`, scalars to zero.
   *
   * **Side effect (auto-migration):** when the entity still uses the
   * legacy JSON-blob encoding (`[procedure-steps]:` observation), it is
   * decoded with the legacy decoder and then rewritten in place to the
   * decomposed graph shape (step entities + relations) before returning.
   */
  async load(id: string): Promise<Procedure | undefined> {
    const entity = await this.entityManager.getEntity(id);
    if (!entity || entity.entityType !== PROCEDURE_ENTITY_TYPE) return undefined;

    if (hasLegacyEncoding(entity.observations)) {
      const legacy = decodeProcedure(id, entity.observations);
      await this.update(legacy); // auto-migrate to the decomposed shape
      return legacy;
    }

    let successRate = 0;
    let executionCount = 0;
    const descriptionLines: string[] = [];
    for (const obs of entity.observations) {
      if (obs.startsWith(SUCCESS_RATE_PREFIX)) {
        const n = Number(obs.slice(SUCCESS_RATE_PREFIX.length));
        if (Number.isFinite(n)) successRate = n;
      } else if (obs.startsWith(EXECUTION_COUNT_PREFIX)) {
        const n = Number(obs.slice(EXECUTION_COUNT_PREFIX.length));
        if (Number.isFinite(n)) executionCount = n;
      } else {
        descriptionLines.push(obs);
      }
    }

    return {
      id,
      name: id,
      description: descriptionLines.join('\n'),
      steps: await this.loadSteps(id),
      triggers: (entity.tags ?? []).filter(t => t !== 'procedure'),
      successRate,
      executionCount,
    };
  }

  /**
   * Replace an existing procedure's steps + metadata. Deletes the
   * procedure's current step entities (cascading their relations — see
   * `EntityManager.deleteEntities`) and recreates the step graph from
   * `procedure.steps`. Throws if the entity doesn't exist.
   */
  async update(procedure: Procedure): Promise<void> {
    // updateEntity throws EntityNotFoundError when missing — keeps the
    // "throws if the entity doesn't exist" contract before any deletion.
    await this.entityManager.updateEntity(procedure.id, {
      observations: encodeProcedureObservations(procedure),
      tags: ['procedure', ...(procedure.triggers ?? [])],
    });

    const staleSteps = await this.collectStepEntityNames(procedure.id);
    if (staleSteps.length > 0) {
      // deleteEntities also drops every relation touching the deleted
      // step entities (has_step / precedes / has_fallback) — no dangling
      // relations survive.
      await this.entityManager.deleteEntities(staleSteps);
    }

    await this.createStepGraph(procedure);
  }

  // -------- internals --------

  /** Create step entities + linking relations for `procedure.steps`. */
  private async createStepGraph(procedure: Procedure): Promise<void> {
    const { entities, relations } = buildStepGraph(procedure);
    if (entities.length > 0) {
      await this.entityManager.createEntities(entities);
    }
    if (relations.length > 0) {
      await this.relationManager.createRelations(relations);
    }
  }

  /**
   * All step entity names reachable from the procedure via `has_step`
   * then recursive `has_fallback` edges.
   */
  private async collectStepEntityNames(procedureId: string): Promise<string[]> {
    const procRelations = await this.relationManager.getRelations(procedureId);
    const queue = procRelations
      .filter(r => r.from === procedureId && r.relationType === HAS_STEP_RELATION)
      .map(r => r.to);
    const seen = new Set<string>();
    while (queue.length > 0) {
      const name = queue.pop() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const stepRelations = await this.relationManager.getRelations(name);
      for (const r of stepRelations) {
        if (r.from === name && r.relationType === HAS_FALLBACK_RELATION && !seen.has(r.to)) {
          queue.push(r.to);
        }
      }
    }
    return [...seen];
  }

  /**
   * Load top-level steps via `has_step`, ordered by the `precedes` chain
   * (preserving the original array order); falls back to a numeric sort
   * on `[order]` when the chain is incomplete.
   */
  private async loadSteps(procedureId: string): Promise<ProcedureStep[]> {
    const procRelations = await this.relationManager.getRelations(procedureId);
    const topNames = procRelations
      .filter(r => r.from === procedureId && r.relationType === HAS_STEP_RELATION)
      .map(r => r.to);
    if (topNames.length === 0) return [];

    const topSet = new Set(topNames);
    const successor = new Map<string, string>();
    const byName = new Map<string, ProcedureStep>();

    for (const name of topNames) {
      const step = await this.loadStepTree(name, topSet, successor);
      if (step) byName.set(name, step);
    }

    const hasIncoming = new Set(successor.values());
    const head = topNames.find(n => byName.has(n) && !hasIncoming.has(n));
    const chain: ProcedureStep[] = [];
    const visited = new Set<string>();
    let cursor = head;
    while (cursor !== undefined && byName.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      chain.push(byName.get(cursor) as ProcedureStep);
      cursor = successor.get(cursor);
    }
    if (chain.length === byName.size) return chain;

    return [...byName.values()].sort((a, b) => a.order - b.order);
  }

  /**
   * Load one step entity plus its recursive fallback chain. Records the
   * step's `precedes` successor (among `topSet`) into `successor` when
   * provided. Returns null when the entity is missing or not a step.
   */
  private async loadStepTree(
    name: string,
    topSet?: Set<string>,
    successor?: Map<string, string>,
  ): Promise<ProcedureStep | null> {
    const entity = await this.entityManager.getEntity(name);
    if (!entity || entity.entityType !== PROCEDURE_STEP_ENTITY_TYPE) return null;
    const step = decodeStepObservations(entity.observations);
    const relations = await this.relationManager.getRelations(name);
    for (const rel of relations) {
      if (rel.from !== name) continue;
      if (rel.relationType === PRECEDES_RELATION && topSet?.has(rel.to)) {
        successor?.set(name, rel.to);
      } else if (rel.relationType === HAS_FALLBACK_RELATION) {
        const fallback = await this.loadStepTree(rel.to);
        if (fallback) step.fallback = fallback;
      }
    }
    return step;
  }
}

/**
 * Scan every `entityType: 'procedure'` entity and migrate any that still
 * use the legacy JSON-blob encoding to the decomposed graph shape.
 *
 * @returns Number of procedures migrated.
 */
export async function migrateLegacyProcedures(
  entityManager: EntityManager,
  relationManager: RelationManager,
): Promise<number> {
  const procedures = await entityManager.listEntities({
    entityType: PROCEDURE_ENTITY_TYPE,
  });
  const legacyIds = procedures
    .filter(e => hasLegacyEncoding(e.observations))
    .map(e => e.name);

  const store = new ProcedureStore(entityManager, relationManager);
  for (const id of legacyIds) {
    await store.load(id); // load() auto-migrates legacy entities
  }
  return legacyIds.length;
}

// -------- encoding / decoding --------

/** True when the observation list still uses the legacy JSON-blob shape. */
function hasLegacyEncoding(observations: string[]): boolean {
  return observations.some(
    obs => obs.startsWith(STEPS_PREFIX) || obs.startsWith(META_PREFIX),
  );
}

/**
 * Observation list for the procedure entity: description (when
 * non-empty, to satisfy the storage layer's non-empty-string contract)
 * plus human-readable scalar lines.
 */
function encodeProcedureObservations(procedure: Procedure): string[] {
  const observations: string[] = [];
  if (procedure.description && procedure.description.trim() !== '') {
    observations.push(procedure.description);
  }
  observations.push(`${SUCCESS_RATE_PREFIX}${procedure.successRate ?? 0}`);
  observations.push(`${EXECUTION_COUNT_PREFIX}${procedure.executionCount ?? 0}`);
  return observations;
}

/** One observation line per step field; params JSON-encode key and value. */
function encodeStepObservations(step: ProcedureStep): string[] {
  const observations = [
    `${ORDER_PREFIX}${step.order}`,
    `${ACTION_PREFIX}${step.action}`,
  ];
  if (step.timeout !== undefined) {
    observations.push(`${TIMEOUT_PREFIX}${step.timeout}`);
  }
  for (const [key, value] of Object.entries(step.parameters ?? {})) {
    observations.push(`${PARAM_PREFIX}${JSON.stringify(key)}=${JSON.stringify(value)}`);
  }
  return observations;
}

/** Inverse of `encodeStepObservations`. Tolerant of unknown lines. */
function decodeStepObservations(observations: string[]): ProcedureStep {
  const step: ProcedureStep = { order: 0, action: '', parameters: {} };
  for (const obs of observations) {
    if (obs.startsWith(ORDER_PREFIX)) {
      const n = Number(obs.slice(ORDER_PREFIX.length));
      if (Number.isFinite(n)) step.order = n;
    } else if (obs.startsWith(ACTION_PREFIX)) {
      step.action = obs.slice(ACTION_PREFIX.length);
    } else if (obs.startsWith(TIMEOUT_PREFIX)) {
      const n = Number(obs.slice(TIMEOUT_PREFIX.length));
      if (Number.isFinite(n)) step.timeout = n;
    } else if (obs.startsWith(PARAM_PREFIX)) {
      const kv = decodeParamLine(obs.slice(PARAM_PREFIX.length));
      if (kv) step.parameters[kv[0]] = kv[1];
    }
  }
  return step;
}

/**
 * Split `<JSON-string>=<JSON-string>` at the `=` separating the two JSON
 * strings (never inside them — `"` inside a JSON string is escaped, so a
 * simple escape-aware scan finds the key's closing quote). Returns null
 * on malformed input.
 */
function decodeParamLine(body: string): [string, string] | null {
  if (!body.startsWith('"')) return null;
  let i = 1;
  while (i < body.length && body[i] !== '"') {
    i += body[i] === '\\' ? 2 : 1;
  }
  if (i >= body.length || body[i + 1] !== '=') return null;
  try {
    const key: unknown = JSON.parse(body.slice(0, i + 1));
    const value: unknown = JSON.parse(body.slice(i + 2));
    if (typeof key !== 'string' || typeof value !== 'string') return null;
    return [key, value];
  } catch {
    return null;
  }
}

/** Step entities + relations for a procedure's full step forest. */
function buildStepGraph(procedure: Procedure): {
  entities: Entity[];
  relations: Relation[];
} {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const topNames: string[] = [];

  for (const step of procedure.steps) {
    const name = stepEntityName(procedure.id, step.order);
    topNames.push(name);
    relations.push({ from: procedure.id, to: name, relationType: HAS_STEP_RELATION });
    addStepTree(name, step, procedure.id, entities, relations);
  }
  for (let i = 0; i + 1 < topNames.length; i++) {
    relations.push({
      from: topNames[i],
      to: topNames[i + 1],
      relationType: PRECEDES_RELATION,
    });
  }
  return { entities, relations };
}

/** Append the entity for `step` (and its fallback chain, recursively). */
function addStepTree(
  name: string,
  step: ProcedureStep,
  procedureId: string,
  entities: Entity[],
  relations: Relation[],
): void {
  entities.push({
    name,
    entityType: PROCEDURE_STEP_ENTITY_TYPE,
    observations: encodeStepObservations(step),
    parentId: procedureId,
  });
  if (step.fallback) {
    const fbName = fallbackEntityName(name);
    relations.push({ from: name, to: fbName, relationType: HAS_FALLBACK_RELATION });
    addStepTree(fbName, step.fallback, procedureId, entities, relations);
  }
}

/**
 * Pure decoder for the legacy JSON-blob observation shape
 * (`[procedure-steps]:` / `[procedure-meta]:` lines).
 *
 * @deprecated Legacy decoder — kept for reading pre-decomposition
 * entities. `ProcedureStore.load()` auto-migrates such entities; new
 * code should go through `ProcedureStore`.
 */
export function decodeProcedure(
  id: string,
  observations: string[],
): Procedure {
  let steps: ProcedureStep[] = [];
  let triggers: string[] = [];
  let successRate = 0;
  let executionCount = 0;
  const descriptionLines: string[] = [];

  for (const obs of observations) {
    if (obs.startsWith(STEPS_PREFIX)) {
      try {
        const parsed = JSON.parse(obs.slice(STEPS_PREFIX.length));
        if (Array.isArray(parsed)) steps = parsed as ProcedureStep[];
      } catch { /* tolerate */ }
    } else if (obs.startsWith(META_PREFIX)) {
      try {
        const parsed = JSON.parse(obs.slice(META_PREFIX.length)) as {
          triggers?: string[];
          successRate?: number;
          executionCount?: number;
        };
        triggers = parsed.triggers ?? [];
        successRate = parsed.successRate ?? 0;
        executionCount = parsed.executionCount ?? 0;
      } catch { /* tolerate */ }
    } else {
      descriptionLines.push(obs);
    }
  }

  return {
    id,
    name: id,
    description: descriptionLines.join('\n'),
    steps,
    triggers,
    successRate,
    executionCount,
  };
}
