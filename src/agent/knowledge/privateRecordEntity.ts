/**
 * The private-memory entity shell shared by every knowledge/learning record builder.
 *
 * Learning traces, heuristics, reflections, skills and instruction sets are all persisted with the
 * same envelope: `importance: 5`, `visibility: 'private'`, `accessCount: 0`,
 * `confirmationCount: 0`, `version: 1`, `createdAt`/`lastModified` set to the caller's raw `now`,
 * plus one record property. Only `confidence` and `contentHash` differ between them, so those are
 * parameters here.
 *
 * `now` is used verbatim. The nested records (heuristic, reflection, skill) brand their own
 * timestamps with `toIsoDateTime`; the entity envelope keeps the string the caller passed.
 *
 * @module agent/knowledge/privateRecordEntity
 * @internal
 */

import type { Entity } from '../../types/types.js';

/** Fields of the shared private-memory entity envelope. */
export interface PrivateRecordEntityFields {
  /** Entity name (the record id). */
  name: string;
  /** Entity type discriminator. */
  entityType: string;
  /** Entity observations. */
  observations: string[];
  /** Raw ISO timestamp used for `createdAt` and `lastModified`. */
  now: string;
  /** Memory-type discriminator (equals `entityType` for these records). */
  memoryType: string;
  /** Confidence in `[0, 1]`: 1 for traces, skills and instruction sets; 0.5 for heuristics and reflections. */
  confidence: number;
  /** Optional content hash (skills only). */
  contentHash?: string;
  /** Record property name on the entity, e.g. `'skillRecord'`. */
  recordKey: string;
  /** The record itself. */
  record: unknown;
}

/**
 * Build one private-memory entity in the shared shell.
 *
 * @param fields - Per-record values for the envelope.
 * @returns The entity; callers narrow it to their own entity type.
 */
export function privateRecordEntity(fields: PrivateRecordEntityFields): Entity {
  return {
    name: fields.name,
    entityType: fields.entityType,
    observations: fields.observations,
    ...(fields.contentHash === undefined ? {} : { contentHash: fields.contentHash }),
    createdAt: fields.now,
    lastModified: fields.now,
    importance: 5,
    memoryType: fields.memoryType,
    visibility: 'private',
    accessCount: 0,
    confidence: fields.confidence,
    confirmationCount: 0,
    version: 1,
    [fields.recordKey]: fields.record,
  } as Entity;
}
