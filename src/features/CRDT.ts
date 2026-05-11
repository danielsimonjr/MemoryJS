/**
 * CRDT Collaboration Primitives
 *
 * Phase 5 step 53 (§13.5) — scaffolding for collaborative editing
 * across multiple replicas of a knowledge graph. Replicas can mutate
 * locally and reconcile state by exchanging `CRDTGraphState` snapshots;
 * `merge()` is commutative, associative, and idempotent, so peers
 * converge on the same final state regardless of message order.
 *
 * **No external deps.** Pure TS scaffolding — wire-format negotiation,
 * network transport, and the optional `automerge` integration are out
 * of scope for this step and live in companion packages.
 *
 * **Primitives provided:**
 *
 * - `LWWRegister<T>` — Last-Write-Wins register with `{value, ts, replicaId}`
 *   tie-breaking (timestamp first, replicaId lexicographically second).
 * - `ORSet<T>` — Observed-Remove set: adds carry unique tags so a
 *   concurrent remove can target a specific add without erasing
 *   another replica's concurrent add of the same element.
 * - `VectorClock` — `{replicaId -> counter}` map with `tick()`,
 *   `merge()`, and `compare()` (returns `-1 | 0 | 1 | 'concurrent'`).
 * - `CRDTGraph` — composes the above into entity-level state plus a
 *   `merge(other)` that yields a deterministic post-merge graph.
 *
 * @module features/CRDT
 * @experimental Wire format may change in non-breaking ways (additive
 *   fields). All `merge` operations remain commutative/associative
 *   across versions.
 */

import type { Entity, Relation } from '../types/types.js';

// ==================== Vector Clock ====================

/** Replica id (any string; canonical: uuid + per-process counter). */
export type ReplicaId = string;

export interface VectorClockState {
  [replicaId: string]: number;
}

/**
 * Vector clock over replica ids. `compare()` returns:
 * - `-1` if `this` happened-before `other`
 * - `1` if `this` happened-after `other`
 * - `0` if equal
 * - `'concurrent'` if neither dominates (i.e. concurrent updates).
 */
export class VectorClock {
  constructor(public state: VectorClockState = {}) {}

  tick(replicaId: ReplicaId): void {
    this.state[replicaId] = (this.state[replicaId] ?? 0) + 1;
  }

  merge(other: VectorClock): void {
    for (const [k, v] of Object.entries(other.state)) {
      this.state[k] = Math.max(this.state[k] ?? 0, v);
    }
  }

  compare(other: VectorClock): -1 | 0 | 1 | 'concurrent' {
    let leLess = false;
    let geGreater = false;
    const keys = new Set([...Object.keys(this.state), ...Object.keys(other.state)]);
    for (const k of keys) {
      const a = this.state[k] ?? 0;
      const b = other.state[k] ?? 0;
      if (a < b) leLess = true;
      if (a > b) geGreater = true;
    }
    if (leLess && geGreater) return 'concurrent';
    if (leLess) return -1;
    if (geGreater) return 1;
    return 0;
  }

  clone(): VectorClock {
    return new VectorClock({ ...this.state });
  }
}

// ==================== LWW Register ====================

export interface LWWRegisterState<T> {
  value: T;
  /** Wall-clock ms timestamp at write time. */
  ts: number;
  /** Replica that performed the write; used to break ts ties. */
  replicaId: ReplicaId;
}

/**
 * Last-Write-Wins register. Ties on `ts` are broken by replicaId
 * lexicographic order — deterministic across replicas without
 * needing a coordinator.
 */
export class LWWRegister<T> {
  constructor(public state: LWWRegisterState<T>) {}

  set(value: T, replicaId: ReplicaId, ts: number = Date.now()): void {
    // Don't accept stale writes — same idempotence guarantee as a
    // CRDT merge: replaying messages is a no-op.
    if (this.shouldReplace({ value, ts, replicaId })) {
      this.state = { value, ts, replicaId };
    }
  }

  merge(other: LWWRegisterState<T>): void {
    if (this.shouldReplace(other)) {
      this.state = { ...other };
    }
  }

  private shouldReplace(other: LWWRegisterState<T>): boolean {
    if (other.ts > this.state.ts) return true;
    if (other.ts < this.state.ts) return false;
    return other.replicaId > this.state.replicaId;
  }
}

// ==================== OR-Set ====================

export interface ORSetState<T> {
  /** `value -> Set<addTag>`; each add has a unique tag so concurrent removes can't undo it. */
  adds: Record<string, string[]>;
  /** `addTag -> value` — tracks tombstones so concurrent adds aren't shadowed. */
  removes: Record<string, string>;
  /** Phantom: keeps the `T` parameter referenced so callers preserve element typing on `ORSet<T>`. */
  readonly _elementType?: T;
}

/**
 * Observed-Remove Set. Every `add` mints a unique tag; `remove` only
 * tombstones the specific tags it has observed. This means an
 * `add()` on replica A and a `remove()` on replica B applied
 * concurrently still leaves the element in the set after merge,
 * matching the intuition that the remover hadn't seen the add yet.
 *
 * `serialize` accepts arbitrary `T` and uses `JSON.stringify` for
 * equality — keep `T` to primitives or shallowly-serializable
 * objects for predictable behavior.
 */
export class ORSet<T> {
  public state: ORSetState<T>;

  constructor(state?: ORSetState<T>) {
    this.state = state ?? { adds: {}, removes: {} };
  }

  add(value: T, tag?: string): void {
    const key = serialize(value);
    const t = tag ?? randomTag();
    if (!this.state.adds[key]) this.state.adds[key] = [];
    this.state.adds[key].push(t);
  }

  has(value: T): boolean {
    const key = serialize(value);
    const tags = this.state.adds[key];
    if (!tags || tags.length === 0) return false;
    // Element is present if at least one add-tag is not in removes.
    return tags.some((t) => !(t in this.state.removes));
  }

  remove(value: T): void {
    const key = serialize(value);
    const tags = this.state.adds[key];
    if (!tags) return;
    for (const tag of tags) {
      this.state.removes[tag] = key;
    }
  }

  values(): T[] {
    const out: T[] = [];
    for (const [key, tags] of Object.entries(this.state.adds)) {
      if (tags.some((t) => !(t in this.state.removes))) {
        out.push(deserialize<T>(key));
      }
    }
    return out;
  }

  merge(other: ORSetState<T>): void {
    for (const [key, tags] of Object.entries(other.adds)) {
      const merged = new Set(this.state.adds[key] ?? []);
      for (const t of tags) merged.add(t);
      this.state.adds[key] = [...merged];
    }
    for (const [tag, key] of Object.entries(other.removes)) {
      this.state.removes[tag] = key;
    }
  }
}

// ==================== CRDT Graph ====================

export interface CRDTEntityState {
  /** Stable id — typically the entity name. */
  id: string;
  /** Last-Write-Wins on entityType. */
  entityType: LWWRegisterState<string>;
  /** OR-Set of observations (strings). */
  observations: ORSetState<string>;
  /** OR-Set of tags. */
  tags: ORSetState<string>;
  /** Last-Write-Wins on importance (nullable to support missing). */
  importance: LWWRegisterState<number | null>;
  /** Tombstone marker — when set, the entity is considered deleted. */
  tombstone: LWWRegisterState<boolean>;
}

export interface CRDTRelationState {
  from: string;
  to: string;
  relationType: string;
  tombstone: LWWRegisterState<boolean>;
}

export interface CRDTGraphState {
  entities: Record<string, CRDTEntityState>;
  relations: Record<string, CRDTRelationState>;
  clock: VectorClockState;
}

/**
 * Composed CRDT over a knowledge graph. Entities are addressed by
 * name; relations by `from|to|relationType`. Deletes are tombstones
 * (so they survive concurrent re-adds).
 *
 * **Merge invariants:** commutative + associative + idempotent. Two
 * replicas that exchange `state()` snapshots and call `merge()` end
 * up with byte-identical state regardless of order.
 *
 * @example
 * ```typescript
 * const a = new CRDTGraph('replica-a');
 * const b = new CRDTGraph('replica-b');
 * a.upsertEntity({ name: 'alice', entityType: 'person', observations: ['coffee'] });
 * b.upsertEntity({ name: 'alice', entityType: 'person', observations: ['tea'] });
 * a.merge(b.state());
 * b.merge(a.state());
 * // Both: observations = ['coffee', 'tea']
 * ```
 */
export class CRDTGraph {
  public state: CRDTGraphState;
  private clock: VectorClock;
  /**
   * Hybrid Logical Clock — guarantees strict monotonicity for local
   * writes even when many happen inside the same wall-clock ms, and
   * advances past any timestamp seen via `merge()`. Without this,
   * fast back-to-back ops on the same replica could share a `ts` and
   * tie-break only on replicaId — which loses last-write-wins
   * semantics for the second op.
   */
  private hlc = 0;

  constructor(public readonly replicaId: ReplicaId, state?: CRDTGraphState) {
    this.state = state ?? { entities: {}, relations: {}, clock: {} };
    this.clock = new VectorClock(this.state.clock);
    // Reload the HLC from incoming state so a re-hydrated replica
    // doesn't issue stale timestamps.
    if (state) this.hlc = highestTs(state);
  }

  /** Advance the hybrid clock past wall-clock + any prior local tick. */
  private nextTs(): number {
    this.hlc = Math.max(Date.now(), this.hlc + 1);
    return this.hlc;
  }

  upsertEntity(entity: Entity): void {
    this.clock.tick(this.replicaId);
    const ts = this.nextTs();
    const existing = this.state.entities[entity.name];
    if (!existing) {
      this.state.entities[entity.name] = {
        id: entity.name,
        entityType: { value: entity.entityType, ts, replicaId: this.replicaId },
        observations: { adds: {}, removes: {} },
        tags: { adds: {}, removes: {} },
        importance: { value: entity.importance ?? null, ts, replicaId: this.replicaId },
        tombstone: { value: false, ts, replicaId: this.replicaId },
      };
      const obs = new ORSet<string>(this.state.entities[entity.name]!.observations);
      for (const o of entity.observations) obs.add(o);
      const tags = new ORSet<string>(this.state.entities[entity.name]!.tags);
      for (const t of entity.tags ?? []) tags.add(t);
      this.state.clock = this.clock.state;
      return;
    }
    const typeReg = new LWWRegister(existing.entityType);
    typeReg.set(entity.entityType, this.replicaId, ts);
    existing.entityType = typeReg.state;

    const obs = new ORSet<string>(existing.observations);
    for (const o of entity.observations) {
      if (!obs.has(o)) obs.add(o);
    }
    existing.observations = obs.state;

    const tags = new ORSet<string>(existing.tags);
    for (const t of entity.tags ?? []) {
      if (!tags.has(t)) tags.add(t);
    }
    existing.tags = tags.state;

    if (entity.importance !== undefined) {
      const imp = new LWWRegister(existing.importance);
      imp.set(entity.importance, this.replicaId, ts);
      existing.importance = imp.state;
    }
    // Resurrect any tombstoned entity — last-write-wins on the
    // tombstone register handles concurrent delete + add correctly.
    const tomb = new LWWRegister(existing.tombstone);
    tomb.set(false, this.replicaId, ts);
    existing.tombstone = tomb.state;
    this.state.clock = this.clock.state;
  }

  deleteEntity(name: string): void {
    this.clock.tick(this.replicaId);
    const ts = this.nextTs();
    const existing = this.state.entities[name];
    if (!existing) {
      // Insert a tombstone-only entity so peer replicas with concurrent
      // upserts still see the delete signal.
      this.state.entities[name] = {
        id: name,
        entityType: { value: '', ts, replicaId: this.replicaId },
        observations: { adds: {}, removes: {} },
        tags: { adds: {}, removes: {} },
        importance: { value: null, ts, replicaId: this.replicaId },
        tombstone: { value: true, ts, replicaId: this.replicaId },
      };
    } else {
      const tomb = new LWWRegister(existing.tombstone);
      tomb.set(true, this.replicaId, ts);
      existing.tombstone = tomb.state;
    }
    this.state.clock = this.clock.state;
  }

  addRelation(relation: Relation): void {
    this.clock.tick(this.replicaId);
    const ts = this.nextTs();
    const key = relationKey(relation.from, relation.to, relation.relationType);
    const existing = this.state.relations[key];
    if (!existing) {
      this.state.relations[key] = {
        from: relation.from,
        to: relation.to,
        relationType: relation.relationType,
        tombstone: { value: false, ts, replicaId: this.replicaId },
      };
    } else {
      const tomb = new LWWRegister(existing.tombstone);
      tomb.set(false, this.replicaId, ts);
      existing.tombstone = tomb.state;
    }
    this.state.clock = this.clock.state;
  }

  deleteRelation(from: string, to: string, relationType: string): void {
    this.clock.tick(this.replicaId);
    const ts = this.nextTs();
    const key = relationKey(from, to, relationType);
    const existing = this.state.relations[key];
    if (!existing) {
      this.state.relations[key] = {
        from,
        to,
        relationType,
        tombstone: { value: true, ts, replicaId: this.replicaId },
      };
    } else {
      const tomb = new LWWRegister(existing.tombstone);
      tomb.set(true, this.replicaId, ts);
      existing.tombstone = tomb.state;
    }
    this.state.clock = this.clock.state;
  }

  /** Project the CRDT state to a plain knowledge graph (live entities and relations only). */
  toGraph(): { entities: Entity[]; relations: Relation[] } {
    const entities: Entity[] = [];
    for (const e of Object.values(this.state.entities)) {
      if (e.tombstone.value) continue;
      const obs = new ORSet<string>(e.observations).values();
      const tags = new ORSet<string>(e.tags).values();
      entities.push({
        name: e.id,
        entityType: e.entityType.value,
        observations: obs,
        ...(tags.length > 0 ? { tags } : {}),
        ...(e.importance.value !== null ? { importance: e.importance.value } : {}),
      });
    }
    const relations: Relation[] = [];
    for (const r of Object.values(this.state.relations)) {
      if (r.tombstone.value) continue;
      relations.push({ from: r.from, to: r.to, relationType: r.relationType });
    }
    return { entities, relations };
  }

  /** Merge another replica's state into this one. Commutative + associative + idempotent. */
  merge(other: CRDTGraphState): void {
    // Advance the local HLC past any incoming timestamp so future
    // local writes outrank everything we just absorbed.
    this.hlc = Math.max(this.hlc, highestTs(other));

    // Entities.
    for (const [id, otherE] of Object.entries(other.entities)) {
      const localE = this.state.entities[id];
      if (!localE) {
        this.state.entities[id] = deepCloneEntity(otherE);
        continue;
      }
      const typeReg = new LWWRegister(localE.entityType);
      typeReg.merge(otherE.entityType);
      localE.entityType = typeReg.state;

      const obs = new ORSet<string>(localE.observations);
      obs.merge(otherE.observations);
      localE.observations = obs.state;

      const tags = new ORSet<string>(localE.tags);
      tags.merge(otherE.tags);
      localE.tags = tags.state;

      const imp = new LWWRegister<number | null>(localE.importance);
      imp.merge(otherE.importance);
      localE.importance = imp.state;

      const tomb = new LWWRegister<boolean>(localE.tombstone);
      tomb.merge(otherE.tombstone);
      localE.tombstone = tomb.state;
    }

    // Relations.
    for (const [key, otherR] of Object.entries(other.relations)) {
      const localR = this.state.relations[key];
      if (!localR) {
        this.state.relations[key] = { ...otherR, tombstone: { ...otherR.tombstone } };
        continue;
      }
      const tomb = new LWWRegister<boolean>(localR.tombstone);
      tomb.merge(otherR.tombstone);
      localR.tombstone = tomb.state;
    }

    // Vector clock.
    this.clock.merge(new VectorClock(other.clock));
    this.state.clock = this.clock.state;
  }
}

// ==================== Helpers ====================

function relationKey(from: string, to: string, relationType: string): string {
  return `${from}|${to}|${relationType}`;
}

function serialize<T>(value: T): string {
  return typeof value === 'string' ? `s:${value}` : `j:${JSON.stringify(value)}`;
}

function deserialize<T>(key: string): T {
  if (key.startsWith('s:')) return key.slice(2) as unknown as T;
  return JSON.parse(key.slice(2)) as T;
}

function randomTag(): string {
  // 12 hex chars — collision-resistant for the corpus sizes a single
  // CRDT replica will produce. Replace with a real UUID v7 in
  // production deployments.
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function highestTs(state: CRDTGraphState): number {
  let max = 0;
  for (const e of Object.values(state.entities)) {
    if (e.entityType.ts > max) max = e.entityType.ts;
    if (e.importance.ts > max) max = e.importance.ts;
    if (e.tombstone.ts > max) max = e.tombstone.ts;
  }
  for (const r of Object.values(state.relations)) {
    if (r.tombstone.ts > max) max = r.tombstone.ts;
  }
  return max;
}

function deepCloneEntity(e: CRDTEntityState): CRDTEntityState {
  return {
    id: e.id,
    entityType: { ...e.entityType },
    observations: {
      adds: { ...e.observations.adds },
      removes: { ...e.observations.removes },
    },
    tags: {
      adds: { ...e.tags.adds },
      removes: { ...e.tags.removes },
    },
    importance: { ...e.importance },
    tombstone: { ...e.tombstone },
  };
}
