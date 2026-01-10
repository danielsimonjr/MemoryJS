/**
 * Analytics Manager
 *
 * Handles graph statistics and validation operations.
 * Extracted from SearchManager (Phase 4: Consolidate God Objects).
 *
 * @module features/AnalyticsManager
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { GraphStats, ValidationReport, ValidationIssue, ValidationWarning } from '../types/index.js';

/**
 * Manages analytics operations for the knowledge graph.
 */
export class AnalyticsManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Validate the knowledge graph structure and data integrity.
   *
   * Checks for:
   * - Orphaned relations (pointing to non-existent entities)
   * - Duplicate entity names
   * - Invalid entity data (missing name/type, invalid observations)
   * - Isolated entities (no relations)
   * - Empty observations
   * - Missing metadata (createdAt, lastModified)
   *
   * @returns Validation report with errors, warnings, and summary
   */
  async validateGraph(): Promise<ValidationReport> {
    const graph = await this.storage.loadGraph();
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];

    // Create a set of all entity names for fast lookup
    const entityNames = new Set(graph.entities.map(e => e.name));

    // Check for orphaned relations (relations pointing to non-existent entities)
    for (const relation of graph.relations) {
      if (!entityNames.has(relation.from)) {
        issues.push({
          type: 'orphaned_relation',
          message: `Relation has non-existent source entity: "${relation.from}"`,
          details: { relation, missingEntity: relation.from },
        });
      }
      if (!entityNames.has(relation.to)) {
        issues.push({
          type: 'orphaned_relation',
          message: `Relation has non-existent target entity: "${relation.to}"`,
          details: { relation, missingEntity: relation.to },
        });
      }
    }

    // Check for duplicate entity names
    const entityNameCounts = new Map<string, number>();
    for (const entity of graph.entities) {
      const count = entityNameCounts.get(entity.name) || 0;
      entityNameCounts.set(entity.name, count + 1);
    }
    for (const [name, count] of entityNameCounts.entries()) {
      if (count > 1) {
        issues.push({
          type: 'duplicate_entity',
          message: `Duplicate entity name found: "${name}" (${count} instances)`,
          details: { entityName: name, count },
        });
      }
    }

    // Check for entities with invalid data
    for (const entity of graph.entities) {
      if (!entity.name || entity.name.trim() === '') {
        issues.push({
          type: 'invalid_data',
          message: 'Entity has empty or missing name',
          details: { entity },
        });
      }
      if (!entity.entityType || entity.entityType.trim() === '') {
        issues.push({
          type: 'invalid_data',
          message: `Entity "${entity.name}" has empty or missing entityType`,
          details: { entity },
        });
      }
      if (!Array.isArray(entity.observations)) {
        issues.push({
          type: 'invalid_data',
          message: `Entity "${entity.name}" has invalid observations (not an array)`,
          details: { entity },
        });
      }
    }

    // Warnings: Check for isolated entities (no relations)
    const entitiesInRelations = new Set<string>();
    for (const relation of graph.relations) {
      entitiesInRelations.add(relation.from);
      entitiesInRelations.add(relation.to);
    }
    for (const entity of graph.entities) {
      if (!entitiesInRelations.has(entity.name) && graph.relations.length > 0) {
        warnings.push({
          type: 'isolated_entity',
          message: `Entity "${entity.name}" has no relations to other entities`,
          details: { entityName: entity.name },
        });
      }
    }

    // Warnings: Check for entities with empty observations
    for (const entity of graph.entities) {
      if (entity.observations.length === 0) {
        warnings.push({
          type: 'empty_observations',
          message: `Entity "${entity.name}" has no observations`,
          details: { entityName: entity.name },
        });
      }
    }

    // Warnings: Check for missing metadata (createdAt, lastModified)
    for (const entity of graph.entities) {
      if (!entity.createdAt) {
        warnings.push({
          type: 'missing_metadata',
          message: `Entity "${entity.name}" is missing createdAt timestamp`,
          details: { entityName: entity.name, field: 'createdAt' },
        });
      }
      if (!entity.lastModified) {
        warnings.push({
          type: 'missing_metadata',
          message: `Entity "${entity.name}" is missing lastModified timestamp`,
          details: { entityName: entity.name, field: 'lastModified' },
        });
      }
    }

    // Count specific issues
    const orphanedRelationsCount = issues.filter(e => e.type === 'orphaned_relation').length;
    const entitiesWithoutRelationsCount = warnings.filter(
      w => w.type === 'isolated_entity'
    ).length;

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      summary: {
        totalErrors: issues.length,
        totalWarnings: warnings.length,
        orphanedRelationsCount,
        entitiesWithoutRelationsCount,
      },
    };
  }

  /**
   * Get comprehensive statistics about the knowledge graph.
   *
   * Provides metrics including:
   * - Total counts of entities and relations
   * - Entity and relation type distributions
   * - Oldest and newest entities/relations
   * - Date ranges for entities and relations
   *
   * @returns Graph statistics object
   */
  async getGraphStats(): Promise<GraphStats> {
    const graph = await this.storage.loadGraph();

    // Calculate entity type counts
    const entityTypesCounts: Record<string, number> = {};
    graph.entities.forEach(e => {
      entityTypesCounts[e.entityType] = (entityTypesCounts[e.entityType] || 0) + 1;
    });

    // Calculate relation type counts
    const relationTypesCounts: Record<string, number> = {};
    graph.relations.forEach(r => {
      relationTypesCounts[r.relationType] = (relationTypesCounts[r.relationType] || 0) + 1;
    });

    // Find oldest and newest entities
    let oldestEntity: { name: string; date: string } | undefined;
    let newestEntity: { name: string; date: string } | undefined;
    let earliestEntityDate: Date | null = null;
    let latestEntityDate: Date | null = null;

    graph.entities.forEach(e => {
      const date = new Date(e.createdAt || '');
      if (!earliestEntityDate || date < earliestEntityDate) {
        earliestEntityDate = date;
        oldestEntity = { name: e.name, date: e.createdAt || '' };
      }
      if (!latestEntityDate || date > latestEntityDate) {
        latestEntityDate = date;
        newestEntity = { name: e.name, date: e.createdAt || '' };
      }
    });

    // Find oldest and newest relations
    let oldestRelation: { from: string; to: string; relationType: string; date: string } | undefined;
    let newestRelation: { from: string; to: string; relationType: string; date: string } | undefined;
    let earliestRelationDate: Date | null = null;
    let latestRelationDate: Date | null = null;

    graph.relations.forEach(r => {
      const date = new Date(r.createdAt || '');
      if (!earliestRelationDate || date < earliestRelationDate) {
        earliestRelationDate = date;
        oldestRelation = { from: r.from, to: r.to, relationType: r.relationType, date: r.createdAt || '' };
      }
      if (!latestRelationDate || date > latestRelationDate) {
        latestRelationDate = date;
        newestRelation = { from: r.from, to: r.to, relationType: r.relationType, date: r.createdAt || '' };
      }
    });

    return {
      totalEntities: graph.entities.length,
      totalRelations: graph.relations.length,
      entityTypesCounts,
      relationTypesCounts,
      oldestEntity,
      newestEntity,
      oldestRelation,
      newestRelation,
      entityDateRange: earliestEntityDate && latestEntityDate ? {
        earliest: (earliestEntityDate as Date).toISOString(),
        latest: (latestEntityDate as Date).toISOString()
      } : undefined,
      relationDateRange: earliestRelationDate && latestRelationDate ? {
        earliest: (earliestRelationDate as Date).toISOString(),
        latest: (latestRelationDate as Date).toISOString()
      } : undefined,
    };
  }
}
