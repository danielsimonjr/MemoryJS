/**
 * Semantic Forget
 *
 * Two-tier deletion: exact match first, then semantic search fallback.
 * Feature 3 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/SemanticForget
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { AuditLog } from './AuditLog.js';
import type { Entity } from '../types/types.js';

export interface SemanticForgetResult {
  method: 'exact' | 'semantic' | 'not_found';
  deletedObservations: { entityName: string; observation: string }[];
  deletedEntities: string[];
  similarity?: number;
}

export interface SemanticForgetOptions {
  threshold?: number;
  projectId?: string;
  dryRun?: boolean;
  agentId?: string;
}

export class SemanticForget {
  constructor(
    private storage: GraphStorage,
    private observationManager: ObservationManager,
    private entityManager: EntityManager,
    private semanticSearch?: SemanticSearch,
    private auditLog?: AuditLog
  ) {}

  async forgetByContent(
    content: string,
    options: SemanticForgetOptions = {}
  ): Promise<SemanticForgetResult> {
    const projectId = options.projectId;
    const dryRun = options.dryRun ?? false;

    const graph = await this.storage.loadGraph();
    const candidates = graph.entities.filter(e =>
      (projectId === undefined || e.projectId === projectId) &&
      e.observations.includes(content)
    );

    if (candidates.length > 0) {
      return this.executeDelete(candidates, content, 'exact', dryRun, options);
    }

    if (this.semanticSearch) {
      return this.semanticFallback(content, options);
    }

    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }

  private async executeDelete(
    entities: Entity[],
    content: string,
    method: 'exact' | 'semantic',
    dryRun: boolean,
    options: SemanticForgetOptions,
    similarity?: number
  ): Promise<SemanticForgetResult> {
    const deletedObservations: { entityName: string; observation: string }[] = [];
    const deletedEntities: string[] = [];

    for (const entity of entities) {
      deletedObservations.push({ entityName: entity.name, observation: content });

      if (dryRun) continue;

      const before = { ...entity, observations: [...entity.observations] };

      await this.observationManager.deleteObservations([
        { entityName: entity.name, observations: [content] },
      ]);

      const reloaded = await this.entityManager.getEntity(entity.name);
      if (reloaded && reloaded.observations.length === 0) {
        await this.entityManager.deleteEntities([entity.name]);
        deletedEntities.push(entity.name);
      }

      if (this.auditLog) {
        await this.auditLog.append({
          operation: 'delete',
          entityName: entity.name,
          agentId: options.agentId,
          before,
          after: undefined,
          status: 'committed',
        });
      }
    }

    return {
      method,
      deletedObservations,
      deletedEntities,
      ...(similarity !== undefined && { similarity }),
    };
  }

  private async semanticFallback(
    _content: string,
    _options: SemanticForgetOptions
  ): Promise<SemanticForgetResult> {
    // Implemented in Task 3.2
    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }
}
