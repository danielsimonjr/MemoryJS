# η.4.4 — Temporal Versioning Expansion Plan

> **Status (2026-04-25):** Plan only. v1.9.0 shipped relation-level temporal validity (`validFrom`/`validUntil` + `invalidateRelation`/`queryAsOf`/`timeline` on `RelationManager`). This plan extends the same model to **entities** and **observations**, closing the "complete temporal graph" promise in ROADMAP § Phase 4.4.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 4.4 (Temporal Versioning).

## Goal

Same time-travel guarantees relations have, lifted to entities and individual observations:

- **Entity timeline** — every entity carries an optional `validFrom`/`validUntil` window. Querying "as of 2024-06-15" returns only entities valid at that instant.
- **Observation history** — each observation in `entity.observations[]` can carry a `validFrom`/`validUntil` (via parallel `observationMeta[]` array, since `observations` is `string[]`). Lets us model "Alice worked at Acme 2020–2023" without supersession overhead.
- **Bitemporal queries** — `(asOf: ISO date, recordedAt?: ISO date)` to distinguish "what we believed about 2024 *as of* the time we recorded it" vs. "what we believe about 2024 *now*."

## Out of scope

- Entity *supersession* via `supersededBy` chains (already shipped v1.8.0; orthogonal — supersession answers "which version is current?", temporal validity answers "was this true at time T?").
- Cross-storage migration. JSONL backend gets it for free; SQLite needs schema columns (handled by the existing idempotent migration in `SQLiteStorage.ensureSchema`).
- UI / visualization (defer to η.4.6 plan).

## Architecture

Wrap-and-extend per ADR-011, mirroring `RelationManager`'s temporal surface:

```
src/core/EntityManager.ts            — extend with: invalidateEntity(name, ended?),
                                       entityAsOf(name, asOf), entityTimeline(rootName).
src/core/ObservationManager.ts       — extend with: invalidateObservation(entity, content, ended?),
                                       observationsAsOf(entity, asOf).
src/types/types.ts                   — extend Entity: add optional `validFrom?` / `validUntil?` /
                                       `observationMeta?: Array<{content: string, validFrom?: string,
                                       validUntil?: string}>`.
```

### Data model

```ts
interface Entity {
  // ... existing fields
  /** ISO 8601 — entity is valid from this instant. Absent = always-valid since creation. */
  validFrom?: string;
  /** ISO 8601 — entity is valid until this instant. Absent = still valid. */
  validUntil?: string;
  /** Per-observation temporal metadata. Indexed parallel to `observations[]`. */
  observationMeta?: Array<{
    content: string;          // matches the `observations[]` entry by content
    validFrom?: string;
    validUntil?: string;
    recordedAt?: string;      // bitemporal axis — when this fact was recorded
  }>;
}
```

### API surface

```ts
class EntityManager {
  /** Mark an entity as no longer valid (sets validUntil). Idempotent. */
  invalidateEntity(name: string, ended?: string): Promise<void>;

  /** Return the entity at a given point in time, or null if invalid then. */
  entityAsOf(name: string, asOf: string): Promise<Entity | null>;

  /**
   * Return all temporal versions of an entity (by rootEntityName chain or
   * by name match if no chain). Sorted by validFrom asc.
   */
  entityTimeline(name: string): Promise<Entity[]>;
}

class ObservationManager {
  /** Mark a specific observation as no longer valid. */
  invalidateObservation(entityName: string, content: string, ended?: string): Promise<void>;

  /** Return observations valid at a given point in time. */
  observationsAsOf(entityName: string, asOf: string): Promise<string[]>;
}
```

## Runtime deps

**None.** Pure TS, reuses existing JSONL/SQLite serialization paths. The `observationMeta[]` field is opt-in — entities without it behave exactly as today.

## Tasks (when promoted)

1. **Plan-time:** spike — confirm `observationMeta[]` doesn't bloat hot reads. Worst-case: 10K entities × 50 observations × 100 byte meta = 50 MB JSONL. Acceptable; users with constraints can omit it.
2. Extend `Entity` type in `src/types/types.ts` with the three new optional fields.
3. Update `OPTIONAL_PERSISTED_ENTITY_FIELDS` constant in `GraphStorage` to include them.
4. Add SQLite migration: `ALTER TABLE entities ADD COLUMN validFrom TEXT, validUntil TEXT, observationMeta TEXT (JSON blob)`.
5. Implement `EntityManager.invalidateEntity / entityAsOf / entityTimeline`. Pattern: copy `RelationManager` versions of the same name, swap relation-keying for entity-keying.
6. Implement `ObservationManager.invalidateObservation / observationsAsOf`. Edits the parallel `observationMeta[]` array.
7. Wire bitemporal axis: `entityAsOf(name, asOf, opts?)` accepts `{ recordedAt: string }` to exclude observations recorded after that point.
8. **TDD:** 12 unit tests covering: invalidate idempotency, asOf within/outside window, timeline ordering, no-meta entities behave as v1.9.0, bitemporal axis isolation, SQLite roundtrip.
9. Update `CHANGELOG.md`, runbook, and ROADMAP § Phase 4.4 to mark expansion shipped.

## Effort estimate

~3 days. v1.9.0 RelationManager work is the template — most of the implementation is structural mirror with type changes. Heavy-lifting is in test coverage for the bitemporal axis (8 of 12 tests).

## Decision gate

None. No new deps, no breaking changes, no API surface that needs review.

## Risks

- **Bloat from `observationMeta[]`** if every observation grows a meta record. Mitigation: opt-in (absent = behaves as today).
- **`supersededBy` confusion** — users may conflate temporal validity with supersession. Mitigation: JSDoc table at top of `EntityManager` documenting the orthogonality (supersession = "which version is current"; temporal = "was this true at time T").
