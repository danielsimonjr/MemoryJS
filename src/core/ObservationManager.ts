/**
 * Observation Manager
 *
 * Handles observation CRUD operations for entities.
 * Extracted from EntityManager (Phase 4: Consolidate God Objects).
 *
 * @module core/ObservationManager
 */

import type { GraphStorage } from "./GraphStorage.js";
import { logger } from "../utils/logger.js";
import type {
  AutoLinker,
  AutoLinkOptions,
  AutoLinkResult,
} from "../features/AutoLinker.js";
import type { DeduplicationOptions, Entity } from "../types/types.js";
import { EntityNotFoundError, ValidationError } from "../utils/errors.js";
import type { ContradictionDetector } from "../features/ContradictionDetector.js";
import type {
  MemoryValidator,
  MemoryValidationIssue,
} from "../agent/MemoryValidator.js";
import type { EntityManager } from "./EntityManager.js";
import { calculateTextSimilarity } from "../utils/textSimilarity.js";
import type {
  IColumnStore,
  ObservationColumn,
} from "./columns/IColumnStore.js";
import type {
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  GraphSavedEvent,
} from "../types/types.js";

/**
 * Default deduplication options used when dedup is enabled without explicit config.
 */
const DEFAULT_DEDUP_OPTIONS: DeduplicationOptions = {
  enabled: true,
  similarityThreshold: 0.85,
  mergeStrategy: "keep_longest",
};

/**
 * Manages observation operations for entities in the knowledge graph.
 */
export class ObservationManager {
  private contradictionDetector?: ContradictionDetector;
  private linkedEntityManager?: EntityManager;
  private _autoLinker?: AutoLinker;
  /** Lazy provider for the validator — invoking it constructs / fetches
   * the MemoryValidator. Stored as a thunk so unconditional wiring at
   * `ManagerContext` construction time costs nothing until the validator
   * is actually needed (i.e., MEMORY_VALIDATE_ON_STORE flips on AND an
   * observation gets added). */
  private memoryValidatorProvider?: () => MemoryValidator;
  /**
   * Shadow column store (Phase 8). When set (via
   * `MEMORY_OBSERVATIONS_COLUMNAR=true` env wired through
   * `ManagerContext`), every write to `entity.observations` is also
   * mirrored to this store. Reads via `getObservationsFor(name)`
   * consult the column store first, falling back to inline. The
   * inline `entity.observations` field remains the source of truth —
   * the column store is a read-side cache to avoid the full entity
   * deserialization when callers only need observations.
   */
  private columnStore: IColumnStore<ObservationColumn> | null = null;

  constructor(private storage: GraphStorage) {}

  /** Unsubscribe handle from `setColumnStore` event subscription. Null when no store attached. */
  private columnStoreUnsubscribe: (() => void) | null = null;

  /**
   * Attach an `IColumnStore` for shadow-mirroring observation writes.
   * Pass `null` to detach. Called by `ManagerContext` when
   * `MEMORY_OBSERVATIONS_COLUMNAR=true`.
   *
   * **Event subscription (Phase 8 review #2+#3):** when a store is
   * attached, this method also subscribes to the storage's
   * `entity:created` / `entity:updated` / `entity:deleted` events.
   * That catches observation writes that bypass `addObservations` /
   * `deleteObservations` (e.g. `EntityManager.createEntities` with
   * non-empty observations, `updateEntity` with `observations` in the
   * patch, the v1.8.0 supersede branch, bulk imports). Without this
   * fan-out, the column store would silently lag those paths and
   * `getObservationsFor` would return stale data.
   */
  setColumnStore(store: IColumnStore<ObservationColumn> | null): void {
    // Tear down any prior subscription before swapping.
    if (this.columnStoreUnsubscribe !== null) {
      this.columnStoreUnsubscribe();
      this.columnStoreUnsubscribe = null;
    }
    this.columnStore = store;
    if (store === null) return;

    const emitter = this.storage.events;
    const unsubs: Array<() => void> = [
      emitter.on("entity:created", (event: EntityCreatedEvent) => {
        // Async-but-not-awaited: the EventEmitter listener signature
        // is sync. Errors inside shadowWriteColumn already log + swallow.
        void this.shadowWriteColumn(
          event.entity.name,
          event.entity.observations,
        );
      }),
      emitter.on("entity:updated", (event: EntityUpdatedEvent) => {
        // Only react when the change touches observations.
        if (event.changes.observations === undefined) return;
        // The post-update entity has the merged state; the storage
        // layer just persisted it. Pull fresh via getEntityByName.
        const entity = this.storage.getEntityByName(event.entityName);
        if (entity) {
          void this.shadowWriteColumn(entity.name, entity.observations);
        }
      }),
      emitter.on("entity:deleted", (event: EntityDeletedEvent) => {
        // Drop the column entry so getObservationsFor stops returning
        // ghost observations for the deleted entity (review #2).
        if (this.columnStore !== null) {
          void this.columnStore.delete(event.entityName).catch((err) => {
            logger.warn(
              `[ObservationManager] Column-store shadow delete failed for "${event.entityName}": ${(err as Error).message}.`,
            );
          });
        }
      }),
      // Bulk-save paths (`createEntities`, `IOManager.importJSON`,
      // bulk loaders) call `storage.saveGraph` which emits
      // `graph:saved` exactly once for the whole batch — they do NOT
      // emit per-entity `entity:created`. Without this handler the
      // column store would silently miss every entity created via
      // those paths. Resync from the post-save storage state: walk
      // every entity, put each one's observations. O(N) per save,
      // but bulk saves are infrequent (interactive paths use
      // `appendEntity` which emits per-entity events).
      emitter.on("graph:saved", (_event: GraphSavedEvent) => {
        void this.resyncFromStorage();
      }),
    ];
    this.columnStoreUnsubscribe = () => {
      for (const u of unsubs) u();
    };
  }

  /**
   * Whether a column store is currently attached. Used by tests +
   * diagnostic reporting.
   */
  hasColumnStore(): boolean {
    return this.columnStore !== null;
  }

  /**
   * Read the observations for `name`, preferring the column store
   * when one is attached. Falls back to the inline `entity.observations`
   * field if the column store has no entry (pre-migration data) or no
   * store is attached. Returns `[]` for an unknown entity rather than
   * throwing — matches the "missing observations are empty" intuition
   * used elsewhere in the codebase.
   *
   * Phase 8 task 66.
   */
  async getObservationsFor(name: string): Promise<string[]> {
    if (this.columnStore !== null) {
      const col = await this.columnStore.get(name);
      if (col !== undefined) return [...col];
    }
    const entity = this.storage.getEntityByName(name);
    return entity ? [...entity.observations] : [];
  }

  /**
   * Walk every entity in storage and put each one's observations to
   * the column store. Used as the fallback for bulk-save paths
   * (`graph:saved`) that don't emit per-entity `entity:created`.
   *
   * Best-effort like every other shadow write — failures log but
   * don't propagate. Stale column entries from earlier deletes get
   * cleaned up by the `entity:deleted` event handler, so this method
   * only needs to mirror present-in-storage state, not perform a
   * diff.
   *
   * Phase 8 review fix (#3 — bulk-save fan-out).
   */
  private async resyncFromStorage(): Promise<void> {
    if (this.columnStore === null) return;
    try {
      const graph = await this.storage.loadGraph();
      for (const entity of graph.entities) {
        await this.shadowWriteColumn(entity.name, entity.observations);
      }
    } catch (err) {
      logger.warn(
        `[ObservationManager] Column-store resync from storage failed: ${(err as Error).message}.`,
      );
    }
  }

  /**
   * Shadow-write the column store from the entity's current inline
   * state. Best-effort — a column-store failure logs a warning but
   * does NOT fail the calling write (the inline state is already on
   * disk via `saveGraph`, so the source of truth is intact). The
   * column store is a read-side cache; a stale shadow is recoverable
   * via the next successful write or via the migration tool.
   *
   * Phase 8 task 67.
   */
  private async shadowWriteColumn(
    name: string,
    observations: string[],
  ): Promise<void> {
    if (this.columnStore === null) return;
    try {
      await this.columnStore.put(name, [...observations]);
    } catch (err) {
      logger.warn(
        `[ObservationManager] Column-store shadow write failed for "${name}": ${(err as Error).message}. Inline observations are authoritative.`,
      );
    }
  }

  // Full-entity-deletion cleanup is handled by the `entity:deleted`
  // event subscription set up in `setColumnStore`. No separate
  // `shadowDeleteColumn` method needed.

  /**
   * Enable contradiction detection on addObservations.
   * When a new observation is detected as contradicting an existing one,
   * a new entity version is created instead of appending.
   */
  setContradictionDetector(
    detector: ContradictionDetector,
    entityManager: EntityManager,
  ): void {
    this.contradictionDetector = detector;
    this.linkedEntityManager = entityManager;
  }

  /**
   * Set the AutoLinker for optional automatic mention detection.
   */
  setAutoLinker(autoLinker: AutoLinker): void {
    this._autoLinker = autoLinker;
  }

  /**
   * Wire a `MemoryValidator` provider for the optional pre-storage
   * validation hook (Phase δ.1, T31). The argument is a thunk so the
   * validator can be lazy-constructed only when actually needed —
   * `ManagerContext` wires this unconditionally at construction time so
   * runtime toggling of `MEMORY_VALIDATE_ON_STORE` works in both
   * directions, but the validator object itself isn't built until the
   * first observation is added with the flag on.
   *
   * Behaviour when flag is on:
   * - `duplicate-observation` → blocking; observation skipped with a
   *   `console.warn`.
   * - `semantic-contradiction` → ADVISORY; if a `ContradictionDetector`
   *   is also wired (the v1.8.0 supersede branch), that branch handles
   *   the case downstream and creates a proper version chain. Filtering
   *   it here would silently disable supersede semantics.
   * - `low-confidence` → ADVISORY only.
   *
   * Default off — preserves backwards-compat for existing callers.
   *
   * Overload: accepts either a validator instance (eager) or a thunk
   * (lazy). Pass the instance for tests where a stub is convenient;
   * pass the thunk for production wiring through `ManagerContext`.
   */
  setMemoryValidator(
    validatorOrProvider: MemoryValidator | (() => MemoryValidator),
  ): void {
    if (typeof validatorOrProvider === "function") {
      this.memoryValidatorProvider = validatorOrProvider;
    } else {
      this.memoryValidatorProvider = () => validatorOrProvider;
    }
  }

  /**
   * Resolve deduplication options from explicit parameter and environment variable.
   *
   * Priority: explicit parameter > env var > disabled (default).
   * If the env var `MEMORY_OBSERVATION_DEDUP` is set to `'true'` and no explicit
   * options are provided, dedup is enabled with default settings.
   *
   * @param dedup - Explicit deduplication options (if any)
   * @returns Resolved options, or undefined if dedup is disabled
   * @internal
   */
  private resolveDedup(
    dedup?: DeduplicationOptions,
  ): DeduplicationOptions | undefined {
    if (dedup) {
      return dedup.enabled ? dedup : undefined;
    }
    if (process.env.MEMORY_OBSERVATION_DEDUP === "true") {
      return DEFAULT_DEDUP_OPTIONS;
    }
    return undefined;
  }

  /**
   * Add observations to multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Adds new observations to specified entities
   * - Filters out exact duplicate observations (already present)
   * - Optionally performs fuzzy deduplication against existing observations
   * - Updates lastModified timestamp only if new observations were added
   * - ATOMIC: All updates are saved in a single operation
   *
   * @param observations - Array of entity names and observations to add
   * @param dedup - Optional deduplication options for fuzzy matching
   * @returns Promise resolving to array of results showing which observations were added
   * @throws {EntityNotFoundError} If any entity is not found
   *
   * @example
   * ```typescript
   * const manager = new ObservationManager(storage);
   *
   * // Add observations to multiple entities
   * const results = await manager.addObservations([
   *   { entityName: 'Alice', contents: ['Completed project X', 'Started project Y'] },
   *   { entityName: 'Bob', contents: ['Joined team meeting'] }
   * ]);
   *
   * // Check what was added (duplicates are filtered out)
   * results.forEach(r => {
   *   console.log(`${r.entityName}: added ${r.addedObservations.length} new observations`);
   * });
   *
   * // With fuzzy deduplication
   * const dedupResults = await manager.addObservations(
   *   [{ entityName: 'Alice', contents: ['Completed project X successfully'] }],
   *   { enabled: true, similarityThreshold: 0.85, mergeStrategy: 'keep_longest' }
   * );
   * ```
   */
  async addObservations(
    observations: { entityName: string; contents: string[] }[],
    dedup?: DeduplicationOptions,
    options?: { autoLink?: boolean; autoLinkOptions?: AutoLinkOptions },
  ): Promise<
    {
      entityName: string;
      addedObservations: string[];
      superseded?: boolean;
      autoLinkResults?: AutoLinkResult[];
    }[]
  > {
    // Two-phase orchestration:
    //
    // Phase 1 (locked) — snapshot, dedup, contradiction-detect.
    // Regular (non-superseding) appends apply + save atomically
    // under the graph mutex (fixes Phase 8 review #9: concurrent
    // addObservations would otherwise race the snapshot vs save).
    // Supersede candidates are collected but NOT executed here —
    // supersede calls entityManager.createEntities/updateEntity
    // which re-acquire the same mutex, and `async-mutex` doesn't
    // support reentrance. Executing under the lock would deadlock.
    //
    // Phase 2 (unlocked) — run supersede for each candidate.
    // Each supersede call atomicaly creates the new-version entity
    // + marks the old one isLatest=false via entityManager's own
    // mutex acquisitions.
    const supersedeCandidates: {
      entityName: string;
      entity: Entity;
      contents: string[];
    }[] = [];

    const release = await this.storage.graphMutex.acquire();
    let regularResults: {
      entityName: string;
      addedObservations: string[];
      superseded?: boolean;
      autoLinkResults?: AutoLinkResult[];
    }[];
    try {
      regularResults = await this.addObservationsLocked(
        observations,
        dedup,
        options,
        supersedeCandidates,
      );
    } finally {
      release();
    }

    for (const candidate of supersedeCandidates) {
      // contradictionDetector + linkedEntityManager are non-null
      // because the locked path only pushes a candidate when both
      // are wired (see addObservationsLocked).
      await this.contradictionDetector!.supersede(
        candidate.entity,
        candidate.contents,
        this.linkedEntityManager!,
      );
      regularResults.push({
        entityName: candidate.entityName,
        addedObservations: candidate.contents,
        superseded: true,
      });
    }

    return regularResults;
  }

  private async addObservationsLocked(
    observations: { entityName: string; contents: string[] }[],
    dedup?: DeduplicationOptions,
    options?: { autoLink?: boolean; autoLinkOptions?: AutoLinkOptions },
    supersedeCandidates?: {
      entityName: string;
      entity: Entity;
      contents: string[];
    }[],
  ): Promise<
    {
      entityName: string;
      addedObservations: string[];
      superseded?: boolean;
      autoLinkResults?: AutoLinkResult[];
    }[]
  > {
    const resolvedDedup = this.resolveDedup(dedup);

    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const results: {
      entityName: string;
      addedObservations: string[];
      superseded?: boolean;
    }[] = [];
    let hasChanges = false;

    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }

    for (const o of observations) {
      const entity = entityMap.get(o.entityName);
      if (!entity) {
        throw new EntityNotFoundError(o.entityName);
      }

      // First pass: filter exact duplicates
      let nonExactDuplicates = o.contents.filter(
        (content) => !entity.observations.includes(content),
      );

      // Pre-storage validation hook (v1.14.0, Phase δ.1, T31).
      // Opt-in via `MEMORY_VALIDATE_ON_STORE=true` env var. When enabled
      // AND a MemoryValidator is wired, each candidate observation is
      // checked via `validateConsistency` before persistence.
      //
      // Critical contract (closed under T17-style review of T31): the
      // validator's `semantic-contradiction` flag is INTENTIONALLY NOT
      // a blocker here when a `ContradictionDetector` is also wired —
      // the v1.8.0 supersede branch below owns that case and creates a
      // proper version chain. Filtering at the validator would silently
      // disable supersede semantics. We only block on
      // `duplicate-observation` (the validator's unique contribution)
      // and `low-confidence` is informational, never blocking.
      //
      // When NO contradiction-detector is wired, validator semantic-
      // contradiction findings are still informational only — the
      // contract is "validator hooks downstream consumers, doesn't
      // mutate persistence by itself."
      if (
        this.memoryValidatorProvider &&
        process.env.MEMORY_VALIDATE_ON_STORE === "true"
      ) {
        const validator = this.memoryValidatorProvider();
        const passed: string[] = [];
        for (const content of nonExactDuplicates) {
          const result = await validator.validateConsistency(content, entity);
          // Only `duplicate-observation` is a blocking issue at this layer.
          const blockingDup = result.issues.some(
            (i: MemoryValidationIssue) => i.kind === "duplicate-observation",
          );
          if (!blockingDup) {
            passed.push(content);
            // Surface advisory issues without blocking.
            if (!result.isValid) {
              const advisories = result.issues
                .filter(
                  (i: MemoryValidationIssue) =>
                    i.kind !== "duplicate-observation",
                )
                .map((i: MemoryValidationIssue) => i.kind);
              if (advisories.length > 0) {
                logger.warn(
                  `[ObservationManager] Validator advisory for "${o.entityName}": ${advisories.join(", ")}. ` +
                    (this.contradictionDetector
                      ? "Semantic-contradiction findings will be handled by the v1.8.0 supersede branch."
                      : "No contradiction-detector wired; advisory only."),
                );
              }
            }
          } else {
            logger.warn(
              `[ObservationManager] Skipping duplicate observation on entity "${o.entityName}". ` +
                `Suggestions: ${result.suggestions.join("; ")}`,
            );
          }
        }
        nonExactDuplicates = passed;
      }

      if (nonExactDuplicates.length > 0) {
        // Contradiction detection hook (v1.8.0)
        if (this.contradictionDetector && this.linkedEntityManager) {
          const contradictions = await this.contradictionDetector.detect(
            entity,
            nonExactDuplicates,
          );
          if (contradictions.length > 0) {
            // Defer supersede to the unlocked post-pass — see
            // addObservations's two-phase rationale. Without this
            // deferral the supersede call's entityManager methods
            // re-acquire graphMutex and deadlock.
            if (supersedeCandidates) {
              supersedeCandidates.push({
                entityName: o.entityName,
                entity,
                contents: nonExactDuplicates,
              });
            } else {
              // Defensive path: legacy callers invoking
              // addObservationsLocked directly (no two-phase
              // orchestration) get the original supersede semantics.
              // No external callers do this; kept for safety.
              await this.contradictionDetector.supersede(
                entity,
                nonExactDuplicates,
                this.linkedEntityManager,
              );
              results.push({
                entityName: o.entityName,
                addedObservations: nonExactDuplicates,
                superseded: true,
              });
            }
            continue; // skip normal append for this entity
          }
        }

        if (resolvedDedup) {
          // Second pass: fuzzy dedup against existing observations
          const addedObservations = this.applyFuzzyDedup(
            nonExactDuplicates,
            entity.observations,
            resolvedDedup,
          );

          if (addedObservations.length > 0) {
            hasChanges = true;
            entity.lastModified = timestamp;
          }

          results.push({ entityName: o.entityName, addedObservations });
        } else {
          // No dedup - add observations directly
          entity.observations.push(...nonExactDuplicates);
          entity.lastModified = timestamp;
          hasChanges = true;

          results.push({
            entityName: o.entityName,
            addedObservations: nonExactDuplicates,
          });
        }
      } else {
        results.push({ entityName: o.entityName, addedObservations: [] });
      }
    }

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
      // Phase 8 task 67: shadow-write the column store with the post-
      // save inline state. Best-effort — failures log but don't reject
      // the caller's add (inline state is already durable).
      if (this.columnStore !== null) {
        for (const r of results) {
          if (r.addedObservations.length > 0) {
            const entity = entityMap.get(r.entityName);
            if (entity)
              await this.shadowWriteColumn(entity.name, entity.observations);
          }
        }
      }
    }

    // Auto-link: detect entity mentions and create relations
    const shouldAutoLink =
      (options?.autoLink ?? process.env.MEMORY_AUTO_LINK === "true") &&
      this._autoLinker;

    if (shouldAutoLink && this._autoLinker) {
      const autoLinkResults: AutoLinkResult[] = [];
      for (const r of results) {
        if (r.addedObservations.length > 0) {
          const linkResult = await this._autoLinker.linkObservations(
            r.entityName,
            r.addedObservations,
            options?.autoLinkOptions,
          );
          autoLinkResults.push(linkResult);
        }
      }
      return results.map((r) => {
        const linkResult = autoLinkResults.find(
          (lr) => lr.sourceEntity === r.entityName,
        );
        return linkResult ? { ...r, autoLinkResults: [linkResult] } : r;
      });
    }

    return results;
  }

  /**
   * Apply fuzzy deduplication to new observations against existing ones.
   *
   * For each new observation, checks similarity against all existing observations.
   * If a near-duplicate is found (similarity >= threshold), applies the merge strategy.
   *
   * Mutates `existingObservations` in place (may replace or append).
   *
   * @param newObservations - New observations to check
   * @param existingObservations - Existing entity observations (mutated in place)
   * @param options - Deduplication options
   * @returns Array of observations that were actually added/kept
   * @internal
   */
  private applyFuzzyDedup(
    newObservations: string[],
    existingObservations: string[],
    options: DeduplicationOptions,
  ): string[] {
    const added: string[] = [];

    for (const newObs of newObservations) {
      let isDuplicate = false;

      for (let i = 0; i < existingObservations.length; i++) {
        const similarity = calculateTextSimilarity(
          newObs,
          existingObservations[i],
        );

        if (similarity >= options.similarityThreshold) {
          isDuplicate = true;

          switch (options.mergeStrategy) {
            case "keep_longest":
              if (newObs.length > existingObservations[i].length) {
                existingObservations[i] = newObs;
                added.push(newObs);
              }
              // else: keep existing, don't add new
              break;

            case "keep_newest":
              existingObservations[i] = newObs;
              added.push(newObs);
              break;

            case "keep_both":
              // Effectively skip dedup for this pair
              existingObservations.push(newObs);
              added.push(newObs);
              break;
          }

          break; // Only match against the first similar existing observation
        }
      }

      if (!isDuplicate) {
        existingObservations.push(newObs);
        added.push(newObs);
      }
    }

    return added;
  }

  /**
   * Delete observations from multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Removes specified observations from entities
   * - Updates lastModified timestamp only if observations were deleted
   * - Silently ignores entities that don't exist (no error thrown)
   * - ATOMIC: All deletions are saved in a single operation
   *
   * @param deletions - Array of entity names and observations to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * const manager = new ObservationManager(storage);
   *
   * // Delete observations from multiple entities
   * await manager.deleteObservations([
   *   { entityName: 'Alice', observations: ['Old observation 1', 'Old observation 2'] },
   *   { entityName: 'Bob', observations: ['Outdated info'] }
   * ]);
   *
   * // Safe to delete from non-existent entities (no error)
   * await manager.deleteObservations([
   *   { entityName: 'NonExistent', observations: ['Some text'] }
   * ]); // No error thrown
   * ```
   */
  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[],
  ): Promise<void> {
    // Same locking rationale as addObservations — Phase 8 review #9.
    const release = await this.storage.graphMutex.acquire();
    try {
      return await this.deleteObservationsLocked(deletions);
    } finally {
      release();
    }
  }

  private async deleteObservationsLocked(
    deletions: { entityName: string; observations: string[] }[],
  ): Promise<void> {
    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    let hasChanges = false;
    const touchedNames: string[] = [];

    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }

    deletions.forEach((d) => {
      const entity = entityMap.get(d.entityName);
      if (entity) {
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(
          (o) => !d.observations.includes(o),
        );

        // Update lastModified timestamp if observations were deleted
        if (entity.observations.length < originalLength) {
          entity.lastModified = timestamp;
          hasChanges = true;
          touchedNames.push(entity.name);
        }
      }
    });

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
      // Phase 8 task 67: shadow-update the column store for each
      // touched entity. Empty-after-delete entries still get put()'d
      // (not delete()'d) so callers see `[]` rather than fall through
      // to the inline value — important because inline ALSO went to
      // `[]`, so the column store needs to reflect that.
      if (this.columnStore !== null) {
        for (const name of touchedNames) {
          const entity = entityMap.get(name);
          if (entity)
            await this.shadowWriteColumn(entity.name, entity.observations);
        }
      }
    }
  }

  // ==================== η.4.4: Temporal Validity ====================
  //
  // Per-observation temporal validity via the parallel `observationMeta[]`
  // array on Entity. Mirrors the entity-level `validFrom`/`validUntil` shape
  // but indexed by observation content (not array position) so re-ordering
  // observations doesn't disturb validity windows.

  /**
   * Mark a specific observation as no longer valid by setting its
   * `validUntil`. Creates the parallel `observationMeta[]` entry if absent
   * (preserves backwards-compat for entities that don't use the bitemporal
   * axis). Idempotent: a second call updates the existing `validUntil`.
   *
   * @throws {EntityNotFoundError} If no entity exists with the given name
   * @throws {ValidationError} If the observation isn't found on the entity
   */
  async invalidateObservation(
    entityName: string,
    content: string,
    ended?: string,
  ): Promise<void> {
    const release = await this.storage.graphMutex.acquire();
    try {
      const graph = await this.storage.getGraphForMutation();
      const entity = graph.entities.find((e) => e.name === entityName);
      if (!entity) throw new EntityNotFoundError(entityName);
      if (!entity.observations.includes(content)) {
        throw new ValidationError(
          `Observation not found on entity '${entityName}'`,
          [`content: ${JSON.stringify(content).slice(0, 80)}`],
        );
      }
      const ts = ended ?? new Date().toISOString();
      if (!entity.observationMeta) entity.observationMeta = [];
      const existing = entity.observationMeta.find(
        (m) => m.content === content,
      );
      if (existing) {
        existing.validUntil = ts;
      } else {
        entity.observationMeta.push({ content, validUntil: ts });
      }
      entity.lastModified = new Date().toISOString();
      await this.storage.saveGraph(graph);
    } finally {
      release();
    }
  }

  /**
   * Return observations valid at a given point in time. An observation
   * with no meta entry is treated as unbounded (always valid). With a meta
   * entry, validity rules mirror `EntityManager.entityAsOf`:
   * - `validFrom` undefined OR `validFrom` <= asOf
   * - `validUntil` undefined OR `validUntil` >= asOf
   *
   * @throws {ValidationError} If `asOf` is not an ISO 8601 date string
   */
  async observationsAsOf(entityName: string, asOf: string): Promise<string[]> {
    if (!/^\d{4}-\d{2}-\d{2}/.test(asOf)) {
      throw new ValidationError(
        `asOf must be an ISO 8601 date string, got: '${asOf}'`,
        [],
      );
    }
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find((e) => e.name === entityName);
    if (!entity) return [];
    const metaByContent = new Map(
      (entity.observationMeta ?? []).map((m) => [m.content, m]),
    );
    return entity.observations.filter((obs) => {
      const meta = metaByContent.get(obs);
      if (!meta) return true; // unbounded
      if (meta.validFrom && meta.validFrom > asOf) return false;
      if (meta.validUntil && meta.validUntil < asOf) return false;
      return true;
    });
  }
}
