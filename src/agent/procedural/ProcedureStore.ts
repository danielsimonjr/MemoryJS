/**
 * Procedure Store (3B.4)
 *
 * Persists `Procedure` records as memoryjs entities (`entityType:
 * 'procedure'`). Steps + metadata live in `observations` as a single
 * JSON-encoded line; the rest of the entity carries triggers/successRate
 * via observations and tags. This shape lets procedures roundtrip
 * through both the JSONL and SQLite backends without schema changes.
 *
 * @module agent/procedural/ProcedureStore
 */

import type { EntityManager } from '../../core/EntityManager.js';
import type { Procedure, ProcedureStep } from '../../types/procedure.js';

/** Sentinel prefix for the JSON observation line. */
const STEPS_PREFIX = '[procedure-steps]:';
const META_PREFIX = '[procedure-meta]:';

export const PROCEDURE_ENTITY_TYPE = 'procedure';

export class ProcedureStore {
  constructor(private readonly entityManager: EntityManager) {}

  /**
   * Persist a new procedure. The entity name = `procedure.id`. Steps and
   * metadata are encoded as JSON observations alongside any caller-supplied
   * description observation. Idempotent on duplicate id (relies on
   * `EntityManager.createEntities` semantics).
   */
  async save(procedure: Procedure): Promise<void> {
    const observations = encodeObservations(procedure);
    await this.entityManager.createEntities([
      {
        name: procedure.id,
        entityType: PROCEDURE_ENTITY_TYPE,
        observations,
        tags: ['procedure', ...(procedure.triggers ?? [])],
      },
    ]);
  }

  /**
   * Load a procedure by id, or null if not found. Tolerant of partial
   * encodings — steps default to `[]`, meta to zeroed fields.
   */
  async load(id: string): Promise<Procedure | null> {
    const entity = await this.entityManager.getEntity(id);
    if (!entity || entity.entityType !== PROCEDURE_ENTITY_TYPE) return null;
    return decodeProcedure(id, entity.observations);
  }

  /**
   * Replace an existing procedure's steps + metadata. Throws if the
   * entity doesn't exist or isn't a procedure.
   */
  async update(procedure: Procedure): Promise<void> {
    await this.entityManager.updateEntity(procedure.id, {
      observations: encodeObservations(procedure),
      tags: ['procedure', ...(procedure.triggers ?? [])],
    });
  }
}

/**
 * Build the observation list for a procedure. Skips the description
 * observation when empty to satisfy the storage layer's non-empty-string
 * contract.
 */
function encodeObservations(procedure: Procedure): string[] {
  const observations: string[] = [];
  if (procedure.description && procedure.description.trim() !== '') {
    observations.push(procedure.description);
  }
  observations.push(`${STEPS_PREFIX}${JSON.stringify(procedure.steps)}`);
  observations.push(
    `${META_PREFIX}${JSON.stringify({
      triggers: procedure.triggers ?? [],
      successRate: procedure.successRate ?? 0,
      executionCount: procedure.executionCount ?? 0,
    })}`,
  );
  return observations;
}

/**
 * Pure decoder: extracts `Procedure` shape from the observation list.
 * Exported for tests and for callers wanting to introspect raw entities.
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
