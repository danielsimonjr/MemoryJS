/**
 * Compression Manager
 *
 * Handles duplicate detection, entity merging, and graph compression.
 * Extracted from SearchManager (Phase 4: Consolidate God Objects).
 *
 * @module features/CompressionManager
 */

import type { Entity, Relation, GraphCompressionResult, KnowledgeGraph, LongRunningOperationOptions, PreparedEntity } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import {
  levenshteinDistance,
  checkCancellation,
  createProgressReporter,
  createProgress,
  fnv1aHash,
} from '../utils/index.js';
import { EntityNotFoundError, InsufficientEntitiesError } from '../utils/errors.js';
import { SIMILARITY_WEIGHTS, DEFAULT_DUPLICATE_THRESHOLD } from '../utils/constants.js';

/**
 * Manages compression operations for the knowledge graph.
 */
export class CompressionManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Prepare an entity for efficient similarity comparisons.
   * Pre-computes all normalized data to avoid repeated computation.
   *
   * Phase 12 Sprint 1: Added nameHash for fast bucketing.
   *
   * @param entity - The entity to prepare
   * @returns PreparedEntity with pre-computed data including hash
   */
  private prepareEntity(entity: Entity): PreparedEntity {
    const nameLower = entity.name.toLowerCase();
    return {
      entity,
      nameLower,
      typeLower: entity.entityType.toLowerCase(),
      observationSet: new Set(entity.observations.map(o => o.toLowerCase())),
      tagSet: new Set((entity.tags ?? []).map(t => t.toLowerCase())),
      nameHash: fnv1aHash(nameLower),
    };
  }

  /**
   * Prepare multiple entities for efficient similarity comparisons.
   * Use this before batch comparison operations.
   *
   * @param entities - Entities to prepare
   * @returns Map of entity name to PreparedEntity
   */
  private prepareEntities(entities: readonly Entity[]): Map<string, PreparedEntity> {
    const prepared = new Map<string, PreparedEntity>();
    for (const entity of entities) {
      prepared.set(entity.name, this.prepareEntity(entity));
    }
    return prepared;
  }

  /**
   * Calculate similarity between two entities using multiple heuristics.
   *
   * Uses configurable weights defined in SIMILARITY_WEIGHTS constant.
   * See SIMILARITY_WEIGHTS for the breakdown of scoring factors.
   *
   * NOTE: For batch comparisons, use prepareEntities() + calculatePreparedSimilarity() for better performance.
   *
   * @param e1 - First entity
   * @param e2 - Second entity
   * @returns Similarity score from 0 (completely different) to 1 (identical)
   */
  calculateEntitySimilarity(e1: Entity, e2: Entity): number {
    let score = 0;
    let factors = 0;

    // Name similarity (Levenshtein-based)
    const nameDistance = levenshteinDistance(e1.name.toLowerCase(), e2.name.toLowerCase());
    const maxNameLength = Math.max(e1.name.length, e2.name.length);
    const nameSimilarity = 1 - nameDistance / maxNameLength;
    score += nameSimilarity * SIMILARITY_WEIGHTS.NAME;
    factors += SIMILARITY_WEIGHTS.NAME;

    // Type similarity (exact match)
    if (e1.entityType.toLowerCase() === e2.entityType.toLowerCase()) {
      score += SIMILARITY_WEIGHTS.TYPE;
    }
    factors += SIMILARITY_WEIGHTS.TYPE;

    // Observation overlap (Jaccard similarity)
    const obs1Set = new Set(e1.observations.map(o => o.toLowerCase()));
    const obs2Set = new Set(e2.observations.map(o => o.toLowerCase()));
    const intersection = new Set([...obs1Set].filter(x => obs2Set.has(x)));
    const union = new Set([...obs1Set, ...obs2Set]);
    const observationSimilarity = union.size > 0 ? intersection.size / union.size : 0;
    score += observationSimilarity * SIMILARITY_WEIGHTS.OBSERVATIONS;
    factors += SIMILARITY_WEIGHTS.OBSERVATIONS;

    // Tag overlap (Jaccard similarity) - match prepared version's logic
    if ((e1.tags?.length ?? 0) > 0 || (e2.tags?.length ?? 0) > 0) {
      const tags1Set = new Set((e1.tags ?? []).map(t => t.toLowerCase()));
      const tags2Set = new Set((e2.tags ?? []).map(t => t.toLowerCase()));
      const tagIntersection = new Set([...tags1Set].filter(x => tags2Set.has(x)));
      const tagUnion = new Set([...tags1Set, ...tags2Set]);
      const tagSimilarity = tagUnion.size > 0 ? tagIntersection.size / tagUnion.size : 0;
      score += tagSimilarity * SIMILARITY_WEIGHTS.TAGS;
      factors += SIMILARITY_WEIGHTS.TAGS;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Efficiently calculate intersection size of two Sets without creating a new Set.
   * Iterates over the smaller set for O(min(m,n)) complexity.
   */
  private setIntersectionSize(a: Set<string>, b: Set<string>): number {
    // Always iterate over smaller set
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    let count = 0;
    for (const item of smaller) {
      if (larger.has(item)) count++;
    }
    return count;
  }

  /**
   * Calculate similarity between two prepared entities.
   * OPTIMIZED: Uses pre-computed Sets to avoid O(n) set creation per comparison.
   *
   * @param p1 - First prepared entity
   * @param p2 - Second prepared entity
   * @returns Similarity score from 0 (completely different) to 1 (identical)
   */
  private calculatePreparedSimilarity(p1: PreparedEntity, p2: PreparedEntity): number {
    let score = 0;
    let factors = 0;

    // Name similarity (Levenshtein-based) - use pre-computed lowercase
    const nameDistance = levenshteinDistance(p1.nameLower, p2.nameLower);
    const maxNameLength = Math.max(p1.nameLower.length, p2.nameLower.length);
    const nameSimilarity = 1 - nameDistance / maxNameLength;
    score += nameSimilarity * SIMILARITY_WEIGHTS.NAME;
    factors += SIMILARITY_WEIGHTS.NAME;

    // Type similarity (exact match) - use pre-computed lowercase
    if (p1.typeLower === p2.typeLower) {
      score += SIMILARITY_WEIGHTS.TYPE;
    }
    factors += SIMILARITY_WEIGHTS.TYPE;

    // Observation overlap (Jaccard similarity) - use pre-computed Sets
    const obsIntersectionSize = this.setIntersectionSize(p1.observationSet, p2.observationSet);
    const obsUnionSize = p1.observationSet.size + p2.observationSet.size - obsIntersectionSize;
    const observationSimilarity = obsUnionSize > 0 ? obsIntersectionSize / obsUnionSize : 0;
    score += observationSimilarity * SIMILARITY_WEIGHTS.OBSERVATIONS;
    factors += SIMILARITY_WEIGHTS.OBSERVATIONS;

    // Tag overlap (Jaccard similarity) - use pre-computed Sets
    if (p1.tagSet.size > 0 || p2.tagSet.size > 0) {
      const tagIntersectionSize = this.setIntersectionSize(p1.tagSet, p2.tagSet);
      const tagUnionSize = p1.tagSet.size + p2.tagSet.size - tagIntersectionSize;
      const tagSimilarity = tagUnionSize > 0 ? tagIntersectionSize / tagUnionSize : 0;
      score += tagSimilarity * SIMILARITY_WEIGHTS.TAGS;
      factors += SIMILARITY_WEIGHTS.TAGS;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Find duplicate entities in the graph based on similarity threshold.
   *
   * OPTIMIZED: Uses bucketing strategies to reduce O(n²) comparisons:
   * 1. Buckets entities by entityType (only compare same types)
   * 2. Within each type, buckets by name prefix (first 2 chars normalized)
   * 3. Only compares entities within same or adjacent buckets
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * Complexity: O(n·k) where k is average bucket size (typically << n)
   *
   * @param threshold - Similarity threshold (0.0 to 1.0), default DEFAULT_DUPLICATE_THRESHOLD
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Array of duplicate groups (each group has similar entities)
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   */
  async findDuplicates(
    threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
    options?: LongRunningOperationOptions
  ): Promise<string[][]> {
    // Check for early cancellation
    checkCancellation(options?.signal, 'findDuplicates');

    const graph = await this.storage.loadGraph();
    const duplicateGroups: string[][] = [];
    const processed = new Set<string>();

    // Setup progress reporter
    const reportProgress = createProgressReporter(options?.onProgress);
    const totalEntities = graph.entities.length;
    let processedCount = 0;
    reportProgress?.(createProgress(0, totalEntities, 'findDuplicates'));

    // OPTIMIZATION: Pre-prepare all entities once before comparisons
    const preparedEntities = this.prepareEntities(graph.entities);

    // Step 1: Bucket entities by type (reduces comparisons drastically)
    const typeMap = new Map<string, Entity[]>();
    for (const entity of graph.entities) {
      const normalizedType = entity.entityType.toLowerCase();
      if (!typeMap.has(normalizedType)) {
        typeMap.set(normalizedType, []);
      }
      typeMap.get(normalizedType)!.push(entity);
    }

    // Step 2: For each type bucket, sub-bucket by name prefix
    for (const entities of typeMap.values()) {
      // Check for cancellation between type buckets
      checkCancellation(options?.signal, 'findDuplicates');

      // Skip single-entity types (no duplicates possible)
      if (entities.length < 2) {
        processedCount += entities.length;
        reportProgress?.(createProgress(processedCount, totalEntities, 'findDuplicates'));
        continue;
      }

      // Create name prefix buckets (first 2 chars, normalized)
      const prefixMap = new Map<string, Entity[]>();
      for (const entity of entities) {
        const prefix = entity.name.toLowerCase().slice(0, 2);
        if (!prefixMap.has(prefix)) {
          prefixMap.set(prefix, []);
        }
        prefixMap.get(prefix)!.push(entity);
      }

      // Step 3: Compare only within buckets (or adjacent buckets for fuzzy matching)
      const prefixKeys = Array.from(prefixMap.keys()).sort();

      for (let bucketIdx = 0; bucketIdx < prefixKeys.length; bucketIdx++) {
        // Check for cancellation between prefix buckets
        checkCancellation(options?.signal, 'findDuplicates');

        const currentPrefix = prefixKeys[bucketIdx];
        const currentBucket = prefixMap.get(currentPrefix)!;

        // Collect entities to compare: current bucket + adjacent buckets
        const candidateEntities: Entity[] = [...currentBucket];

        // Add next bucket if exists (handles fuzzy prefix matching)
        if (bucketIdx + 1 < prefixKeys.length) {
          candidateEntities.push(...prefixMap.get(prefixKeys[bucketIdx + 1])!);
        }

        // Compare entities within candidate pool
        for (let i = 0; i < currentBucket.length; i++) {
          const entity1 = currentBucket[i];
          if (processed.has(entity1.name)) continue;

          // OPTIMIZATION: Use prepared entity for comparison
          const prepared1 = preparedEntities.get(entity1.name)!;
          const group: string[] = [entity1.name];

          for (let j = 0; j < candidateEntities.length; j++) {
            const entity2 = candidateEntities[j];
            if (entity1.name === entity2.name || processed.has(entity2.name)) continue;

            // OPTIMIZATION: Use prepared entity and optimized similarity
            const prepared2 = preparedEntities.get(entity2.name)!;
            const similarity = this.calculatePreparedSimilarity(prepared1, prepared2);
            if (similarity >= threshold) {
              group.push(entity2.name);
              processed.add(entity2.name);
            }
          }

          if (group.length > 1) {
            duplicateGroups.push(group);
            processed.add(entity1.name);
          }

          processedCount++;
          reportProgress?.(createProgress(processedCount, totalEntities, 'findDuplicates'));
        }
      }
    }

    // Report completion
    reportProgress?.(createProgress(totalEntities, totalEntities, 'findDuplicates'));

    return duplicateGroups;
  }

  /**
   * Merge a group of entities into a single entity.
   *
   * Merging strategy:
   * - First entity is kept (or renamed to targetName)
   * - Observations: Union of all observations
   * - Tags: Union of all tags
   * - Importance: Maximum importance value
   * - createdAt: Earliest date
   * - lastModified: Current timestamp
   * - Relations: Redirected to kept entity, duplicates removed
   *
   * @param entityNames - Names of entities to merge (first one is kept)
   * @param targetName - Optional new name for merged entity (default: first entity name)
   * @param options - Optional configuration
   * @param options.graph - Pre-loaded graph to use (avoids reload)
   * @param options.skipSave - If true, don't save (caller will save)
   * @returns The merged entity
   * @throws {InsufficientEntitiesError} If less than 2 entities provided
   * @throws {EntityNotFoundError} If any entity not found
   */
  async mergeEntities(
    entityNames: string[],
    targetName?: string,
    options: {
      graph?: KnowledgeGraph;
      skipSave?: boolean;
    } = {}
  ): Promise<Entity> {
    if (entityNames.length < 2) {
      throw new InsufficientEntitiesError('merging', 2, entityNames.length);
    }

    // Use provided graph or load fresh
    const graph = options.graph ?? await this.storage.getGraphForMutation();
    const entitiesToMerge = entityNames.map(name => {
      const entity = graph.entities.find(e => e.name === name);
      if (!entity) {
        throw new EntityNotFoundError(name);
      }
      return entity;
    });

    const keepEntity = entitiesToMerge[0];
    const mergeEntities = entitiesToMerge.slice(1);

    // Merge observations (unique)
    const allObservations = new Set<string>();
    for (const entity of entitiesToMerge) {
      entity.observations.forEach(obs => allObservations.add(obs));
    }
    keepEntity.observations = Array.from(allObservations);

    // Merge tags (unique)
    const allTags = new Set<string>();
    for (const entity of entitiesToMerge) {
      if (entity.tags) {
        entity.tags.forEach(tag => allTags.add(tag));
      }
    }
    if (allTags.size > 0) {
      keepEntity.tags = Array.from(allTags);
    }

    // Use highest importance
    const importances = entitiesToMerge
      .map(e => e.importance)
      .filter(imp => imp !== undefined) as number[];
    if (importances.length > 0) {
      keepEntity.importance = Math.max(...importances);
    }

    // Use earliest createdAt
    const createdDates = entitiesToMerge
      .map(e => e.createdAt)
      .filter(date => date !== undefined) as string[];
    if (createdDates.length > 0) {
      keepEntity.createdAt = createdDates.sort()[0];
    }

    // Update lastModified
    keepEntity.lastModified = new Date().toISOString();

    // Rename if requested
    if (targetName && targetName !== keepEntity.name) {
      // Update all relations pointing to old name
      graph.relations.forEach(rel => {
        if (rel.from === keepEntity.name) rel.from = targetName;
        if (rel.to === keepEntity.name) rel.to = targetName;
      });
      keepEntity.name = targetName;
    }

    // Update relations from merged entities to point to kept entity
    for (const mergeEntity of mergeEntities) {
      graph.relations.forEach(rel => {
        if (rel.from === mergeEntity.name) rel.from = keepEntity.name;
        if (rel.to === mergeEntity.name) rel.to = keepEntity.name;
      });
    }

    // Remove duplicate relations
    const uniqueRelations = new Map<string, Relation>();
    for (const relation of graph.relations) {
      const key = `${relation.from}|${relation.to}|${relation.relationType}`;
      if (!uniqueRelations.has(key)) {
        uniqueRelations.set(key, relation);
      }
    }
    graph.relations = Array.from(uniqueRelations.values());

    // Remove merged entities
    const mergeNames = new Set(mergeEntities.map(e => e.name));
    graph.entities = graph.entities.filter(e => !mergeNames.has(e.name));

    // Save unless caller said to skip
    if (!options.skipSave) {
      await this.storage.saveGraph(graph);
    }
    return keepEntity;
  }

  /**
   * Compress the knowledge graph by finding and merging duplicates.
   * OPTIMIZED: Loads graph once, performs all merges, saves once.
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * @param threshold - Similarity threshold for duplicate detection (0.0 to 1.0), default DEFAULT_DUPLICATE_THRESHOLD
   * @param dryRun - If true, only report what would be compressed without applying changes
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Compression result with statistics
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   */
  async compressGraph(
    threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
    dryRun: boolean = false,
    options?: LongRunningOperationOptions
  ): Promise<GraphCompressionResult> {
    // Check for early cancellation
    checkCancellation(options?.signal, 'compressGraph');

    // Setup progress reporter (we'll use phases: 50% finding duplicates, 50% merging)
    const reportProgress = createProgressReporter(options?.onProgress);
    reportProgress?.(createProgress(0, 100, 'compressGraph'));

    // Phase 1: Find duplicates (0-50% progress)
    const duplicateGroups = await this.findDuplicates(threshold, {
      signal: options?.signal,
      onProgress: (p) => {
        // Map findDuplicates progress (0-100%) to compressGraph progress (0-50%)
        const compressProgress = Math.round(p.percentage * 0.5);
        reportProgress?.(createProgress(compressProgress, 100, 'finding duplicates'));
      },
    });

    // Check for cancellation after finding duplicates
    checkCancellation(options?.signal, 'compressGraph');
    reportProgress?.(createProgress(50, 100, 'compressGraph'));

    // OPTIMIZATION: Load graph once for all operations
    const graph = await this.storage.getGraphForMutation();
    const initialSize = JSON.stringify(graph).length;
    const result: GraphCompressionResult = {
      duplicatesFound: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
      entitiesMerged: 0,
      observationsCompressed: 0,
      relationsConsolidated: 0,
      spaceFreed: 0,
      mergedEntities: [],
    };

    if (dryRun) {
      // Just report what would happen
      for (const group of duplicateGroups) {
        result.mergedEntities.push({
          kept: group[0],
          merged: group.slice(1),
        });
        result.entitiesMerged += group.length - 1;
      }
      reportProgress?.(createProgress(100, 100, 'compressGraph'));
      return result;
    }

    // Phase 2: Merge duplicates (50-100% progress)
    const totalGroups = duplicateGroups.length;
    let mergedGroups = 0;

    // OPTIMIZATION: Build entity lookup map for O(1) access during merges
    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }

    // Merge all duplicates using the same graph instance
    for (const group of duplicateGroups) {
      // Check for cancellation between merges
      checkCancellation(options?.signal, 'compressGraph');

      try {
        // Count observations before merge using O(1) lookup
        let totalObservationsBefore = 0;
        for (const name of group) {
          const entity = entityMap.get(name);
          if (entity) {
            totalObservationsBefore += entity.observations.length;
          }
        }

        // OPTIMIZATION: Pass graph and skip individual saves
        const mergedEntity = await this.mergeEntities(group, undefined, {
          graph,
          skipSave: true,
        });

        const observationsAfter = mergedEntity.observations.length;
        result.observationsCompressed += totalObservationsBefore - observationsAfter;

        result.mergedEntities.push({
          kept: group[0],
          merged: group.slice(1),
        });
        result.entitiesMerged += group.length - 1;
      } catch (error) {
        // Skip groups that fail to merge
        console.error(`Failed to merge group ${group}:`, error);
      }

      mergedGroups++;
      // Map merge progress (0-100%) to compressGraph progress (50-100%)
      const mergeProgress = totalGroups > 0 ? Math.round(50 + (mergedGroups / totalGroups) * 50) : 100;
      reportProgress?.(createProgress(mergeProgress, 100, 'merging entities'));
    }

    // Check for cancellation before final save
    checkCancellation(options?.signal, 'compressGraph');

    // OPTIMIZATION: Save once after all merges complete
    await this.storage.saveGraph(graph);

    const finalSize = JSON.stringify(graph).length;
    result.spaceFreed = initialSize - finalSize;
    result.relationsConsolidated = result.entitiesMerged;

    // Report completion
    reportProgress?.(createProgress(100, 100, 'compressGraph'));

    return result;
  }
}
