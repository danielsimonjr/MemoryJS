/**
 * World State Snapshot (3B.7)
 *
 * Lightweight, immutable value object representing the agent's view of
 * its world at a single instant. Stored as a JSON-friendly shape so it
 * can roundtrip through any of the memoryjs storage backends.
 *
 * @module agent/world/WorldStateSnapshot
 */

/** Snapshot of one entity's state — only the fields that drive change detection. */
export interface WorldStateEntity {
  name: string;
  entityType: string;
  /** Importance score [0, 10]. */
  importance?: number;
  /** Confidence [0, 1]. */
  confidence?: number;
  /** Number of observations attached to this entity at snapshot time. */
  observationCount: number;
  /** Tags at snapshot time. */
  tags: string[];
  /** Last-modified timestamp. */
  lastModified?: string;
}

/** Diff between two snapshots. */
export interface WorldStateChange {
  /** Entities present only in the *before* snapshot. */
  removed: WorldStateEntity[];
  /** Entities present only in the *after* snapshot. */
  added: WorldStateEntity[];
  /** Entities present in both with at least one differing field. */
  modified: Array<{
    name: string;
    before: WorldStateEntity;
    after: WorldStateEntity;
    fields: ReadonlyArray<keyof WorldStateEntity>;
  }>;
}

export class WorldStateSnapshot {
  /** ISO 8601 timestamp this snapshot was taken. */
  readonly takenAt: string;
  /** Map keyed by entity name. */
  readonly entitiesByName: ReadonlyMap<string, WorldStateEntity>;

  constructor(entities: ReadonlyArray<WorldStateEntity>, takenAt?: string) {
    this.takenAt = takenAt ?? new Date().toISOString();
    const m = new Map<string, WorldStateEntity>();
    for (const e of entities) m.set(e.name, e);
    this.entitiesByName = m;
  }

  /** Number of entities in the snapshot. */
  get size(): number {
    return this.entitiesByName.size;
  }

  /** All entities, in insertion order. */
  entities(): ReadonlyArray<WorldStateEntity> {
    return [...this.entitiesByName.values()];
  }

  /**
   * Pure: compute the diff to a `next` snapshot. Returns added /
   * removed / modified breakdown. An entity counts as "modified" when
   * any of `importance`, `confidence`, `observationCount`, `tags`, or
   * `lastModified` differs.
   */
  diffTo(next: WorldStateSnapshot): WorldStateChange {
    const removed: WorldStateEntity[] = [];
    const added: WorldStateEntity[] = [];
    const modified: WorldStateChange['modified'] = [];

    for (const [name, before] of this.entitiesByName) {
      const after = next.entitiesByName.get(name);
      if (!after) {
        removed.push(before);
        continue;
      }
      const fields = diffFields(before, after);
      if (fields.length > 0) {
        modified.push({ name, before, after, fields });
      }
    }
    for (const [name, after] of next.entitiesByName) {
      if (!this.entitiesByName.has(name)) added.push(after);
    }
    return { removed, added, modified };
  }

  /** JSON-serializable form. */
  toJSON(): { takenAt: string; entities: WorldStateEntity[] } {
    return { takenAt: this.takenAt, entities: [...this.entities()] };
  }

  /** Reconstruct from `toJSON()` output. */
  static fromJSON(json: { takenAt: string; entities: WorldStateEntity[] }): WorldStateSnapshot {
    return new WorldStateSnapshot(json.entities, json.takenAt);
  }
}

function diffFields(
  before: WorldStateEntity,
  after: WorldStateEntity,
): Array<keyof WorldStateEntity> {
  const out: Array<keyof WorldStateEntity> = [];
  if (before.entityType !== after.entityType) out.push('entityType');
  if (before.importance !== after.importance) out.push('importance');
  if (before.confidence !== after.confidence) out.push('confidence');
  if (before.observationCount !== after.observationCount) out.push('observationCount');
  if (!sameStringSet(before.tags, after.tags)) out.push('tags');
  if (before.lastModified !== after.lastModified) out.push('lastModified');
  return out;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}
