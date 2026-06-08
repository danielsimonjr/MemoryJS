/**
 * Observation Manager
 *
 * Handles observation CRUD operations for entities.
 * Extracted from EntityManager (Phase 4: Consolidate God Objects).
 *
 * @module core/ObservationManager
 */

import type { GraphStorage } from './GraphStorage.js';
import type { AutoLinker, AutoLinkOptions, AutoLinkResult } from '../features/AutoLinker.js';
import type { DeduplicationOptions } from '../types/types.js';
import { EntityNotFoundError, ValidationError } from '../utils/errors.js';
import type { ContradictionDetector } from '../features/ContradictionDetector.js';
import type { MemoryValidator, MemoryValidationIssue } from '../agent/MemoryValidator.js';
import type { EntityManager } from './EntityManager.js';
import { calculateTextSimilarity } from '../utils/textSimilarity.js';

/**
 * Default deduplication options used when dedup is enabled without explicit config.
 */
const DEFAULT_DEDUP_OPTIONS: DeduplicationOptions = {
  enabled: true,
  similarityThreshold: 0.85,
  mergeStrategy: 'keep_longest',
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

  constructor(private storage: GraphStorage) {}

  /**
   * Enable contradiction detection on addObservations.
   * When a new observation is detected as contradicting an existing one,
   * a new entity version is created instead of appending.
   */
  setContradictionDetector(
    detector: ContradictionDetector,
    entityManager: EntityManager
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
  setMemoryValidator(validatorOrProvider: MemoryValidator | (() => MemoryValidator)): void {
    if (typeof validatorOrProvider === 'function') {
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
  private resolveDedup(dedup?: DeduplicationOptions): DeduplicationOptions | undefined {
    if (dedup) {
      return dedup.enabled ? dedup : undefined;
    }
    if (process.env.MEMORY_OBSERVATION_DEDUP === 'true') {
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
    options?: { autoLink?: boolean; autoLinkOptions?: AutoLinkOptions }
  ): Promise<{ entityName: string; addedObservations: string[]; superseded?: boolean; autoLinkResults?: AutoLinkResult[] }[]> {
    const resolvedDedup = this.resolveDedup(dedup);

    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const results: { entityName: string; addedObservations: string[]; superseded?: boolean }[] = [];
    let hasChanges = false;

    for (const o of observations) {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new EntityNotFoundError(o.entityName);
      }

      // First pass: filter exact duplicates
      let nonExactDuplicates = o.contents.filter(content => !entity.observations.includes(content));

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
      if (this.memoryValidatorProvider && process.env.MEMORY_VALIDATE_ON_STORE === 'true') {
        const validator = this.memoryValidatorProvider();
        const passed: string[] = [];
        for (const content of nonExactDuplicates) {
          const result = await validator.validateConsistency(content, entity);
          // Only `duplicate-observation` is a blocking issue at this layer.
          const blockingDup = result.issues.some((i: MemoryValidationIssue) => i.kind === 'duplicate-observation');
          if (!blockingDup) {
            passed.push(content);
            // Surface advisory issues without blocking.
            if (!result.isValid) {
              const advisories = result.issues
                .filter((i: MemoryValidationIssue) => i.kind !== 'duplicate-observation')
                .map((i: MemoryValidationIssue) => i.kind);
              if (advisories.length > 0) {
                console.warn(
                  `[ObservationManager] Validator advisory for "${o.entityName}": ${advisories.join(', ')}. ` +
                  (this.contradictionDetector
                    ? 'Semantic-contradiction findings will be handled by the v1.8.0 supersede branch.'
                    : 'No contradiction-detector wired; advisory only.'),
                );
              }
            }
          } else {
            console.warn(
              `[ObservationManager] Skipping duplicate observation on entity "${o.entityName}". ` +
              `Suggestions: ${result.suggestions.join('; ')}`,
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
            nonExactDuplicates
          );
          if (contradictions.length > 0) {
            await this.contradictionDetector.supersede(
              entity,
              nonExactDuplicates,
              this.linkedEntityManager
            );
            results.push({ entityName: o.entityName, addedObservations: nonExactDuplicates, superseded: true });
            continue; // skip normal append for this entity
          }
        }

        if (resolvedDedup) {
          // Second pass: fuzzy dedup against existing observations
          const addedObservations = this.applyFuzzyDedup(
            nonExactDuplicates,
            entity.observations,
            resolvedDedup
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

          results.push({ entityName: o.entityName, addedObservations: nonExactDuplicates });
        }
      } else {
        results.push({ entityName: o.entityName, addedObservations: [] });
      }
    }

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
    }

    // Auto-link: detect entity mentions and create relations
    const shouldAutoLink =
      (options?.autoLink ?? (process.env.MEMORY_AUTO_LINK === 'true')) && this._autoLinker;

    if (shouldAutoLink && this._autoLinker) {
      const autoLinkResults: AutoLinkResult[] = [];
      for (const r of results) {
        if (r.addedObservations.length > 0) {
          const linkResult = await this._autoLinker.linkObservations(
            r.entityName,
            r.addedObservations,
            options?.autoLinkOptions
          );
          autoLinkResults.push(linkResult);
        }
      }
      return results.map((r) => {
        const linkResult = autoLinkResults.find(lr => lr.sourceEntity === r.entityName);
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
    options: DeduplicationOptions
  ): string[] {
    const added: string[] = [];

    for (const newObs of newObservations) {
      let isDuplicate = false;

      for (let i = 0; i < existingObservations.length; i++) {
        const similarity = calculateTextSimilarity(newObs, existingObservations[i]);

        if (similarity >= options.similarityThreshold) {
          isDuplicate = true;

          switch (options.mergeStrategy) {
            case 'keep_longest':
              if (newObs.length > existingObservations[i].length) {
                existingObservations[i] = newObs;
                added.push(newObs);
              }
              // else: keep existing, don't add new
              break;

            case 'keep_newest':
              existingObservations[i] = newObs;
              added.push(newObs);
              break;

            case 'keep_both':
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
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void> {
    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    let hasChanges = false;

    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));

        // Update lastModified timestamp if observations were deleted
        if (entity.observations.length < originalLength) {
          entity.lastModified = timestamp;
          hasChanges = true;
        }
      }
    });

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
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
      const entity = graph.entities.find(e => e.name === entityName);
      if (!entity) throw new EntityNotFoundError(entityName);
      if (!entity.observations.includes(content)) {
        throw new ValidationError(
          `Observation not found on entity '${entityName}'`,
          [`content: ${JSON.stringify(content).slice(0, 80)}`],
        );
      }
      const ts = ended ?? new Date().toISOString();
      if (!entity.observationMeta) entity.observationMeta = [];
      const existing = entity.observationMeta.find(m => m.content === content);
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
      throw new ValidationError(`asOf must be an ISO 8601 date string, got: '${asOf}'`, []);
    }
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === entityName);
    if (!entity) return [];
    const metaByContent = new Map(
      (entity.observationMeta ?? []).map(m => [m.content, m]),
    );
    return entity.observations.filter(obs => {
      const meta = metaByContent.get(obs);
      if (!meta) return true; // unbounded
      if (meta.validFrom && meta.validFrom > asOf) return false;
      if (meta.validUntil && meta.validUntil < asOf) return false;
      return true;
    });
  }
}
