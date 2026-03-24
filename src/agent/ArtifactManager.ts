/**
 * Artifact Manager
 *
 * Creates and retrieves discrete agent artifacts — tool outputs, code snippets,
 * API responses, etc. — as stable, named entities with human-readable refs.
 *
 * Each artifact gets:
 *   - A stable entity name following the convention:
 *       `${toolName}-${YYYY-MM-DD}-${shortId}` (e.g. "bash-2026-03-24-a3f2")
 *   - An identical ref registered in the RefIndex so it can be resolved
 *     across turns without knowing the full entity name.
 *   - Content stored as an entity observation.
 *
 * @module agent/ArtifactManager
 */

import type { IGraphStorage, Entity } from '../types/types.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { RefIndex } from '../core/RefIndex.js';
import type {
  ArtifactType,
  CreateArtifactOptions,
  ArtifactEntity,
  ArtifactFilter,
} from '../types/artifact.js';
import { isArtifactEntity } from '../types/artifact.js';

// Re-export types for consumers that import from this module
export type { ArtifactType, CreateArtifactOptions, ArtifactEntity, ArtifactFilter };

// ============================================================
// Internal helpers
// ============================================================

/**
 * Generate a 4-character lowercase hex short ID.
 * Collisions are resolved by the caller by retrying with a new shortId.
 */
function generateShortId(): string {
  return Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
}

/**
 * Format a Date as YYYY-MM-DD using UTC values to avoid timezone drift.
 */
function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build the stable entity name from the naming convention.
 *
 * Sanitises `toolName` to keep only alphanumeric chars and hyphens so the
 * resulting name is safe for use as a JSONL key and a URL segment.
 */
function buildEntityName(toolName: string, date: Date, shortId: string): string {
  const sanitized = toolName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `${sanitized}-${formatDateUTC(date)}-${shortId}`;
}

// ============================================================
// ArtifactManager
// ============================================================

/**
 * Manages artifact entities with stable RefIndex-backed naming.
 *
 * Accepts an `IGraphStorage` for direct entity persistence (bypassing the Zod-
 * validated `EntityManager.createEntities()` which only accepts base Entity
 * fields) and an `EntityManager` for its `registerRef` / `resolveRef` methods.
 *
 * @example
 * ```typescript
 * const manager = new ArtifactManager(storage, ctx.entityManager, ctx.refIndex);
 *
 * const artifact = await manager.createArtifact({
 *   content: 'echo hello',
 *   toolName: 'bash',
 *   artifactType: 'tool_output',
 *   description: 'Shell command executed in step 3',
 * });
 *
 * // Later, retrieve by stable ref
 * const same = await manager.getArtifact(artifact.name);
 * ```
 */
export class ArtifactManager {
  constructor(
    private readonly storage: IGraphStorage,
    private readonly entityManager: EntityManager,
    // refIndex is wired into entityManager via setRefIndex; kept here for
    // external callers that may want direct RefIndex access in the future.
    readonly refIndex: RefIndex
  ) {}

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Create an artifact entity and register a stable ref in one atomic call.
   *
   * The entity name is generated as `${toolName}-${YYYY-MM-DD}-${shortId}`.
   * An identical ref string is registered in the RefIndex.
   * On the rare chance of a shortId collision, a new ID is generated (up to 10
   * attempts) before throwing.
   *
   * @param options - Artifact creation options
   * @returns The created ArtifactEntity
   * @throws {Error} If a unique name cannot be found after 10 attempts
   */
  async createArtifact(options: CreateArtifactOptions): Promise<ArtifactEntity> {
    const { content, toolName, artifactType, description, sessionId, taskId } = options;
    const now = new Date();

    // Attempt to find a unique name (extremely rare to need > 1 attempt)
    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const shortId = generateShortId();
      const entityName = buildEntityName(toolName, now, shortId);

      // Check for name collision in storage
      if (this.storage.getEntityByName(entityName)) {
        continue; // Try a fresh shortId
      }

      // Build the ArtifactEntity — extends Entity with artifact-specific fields.
      // We use storage.appendEntity() directly (like WorkingMemoryManager) to
      // bypass the strict Zod EntitySchema that rejects unknown fields.
      const artifactEntity: ArtifactEntity = {
        name: entityName,
        entityType: 'artifact',
        observations: [content],
        artifactType,
        toolName,
        shortId,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(taskId !== undefined ? { taskId } : {}),
        createdAt: now.toISOString(),
        lastModified: now.toISOString(),
        tags: ['artifact', artifactType, toolName.toLowerCase()],
      };

      // Persist entity first, bypassing Zod schema validation
      await this.storage.appendEntity(artifactEntity as Entity);

      // Register stable ref (may throw RefConflictError on collision — treat as
      // name collision and retry with a new shortId)
      try {
        await this.entityManager.registerRef(
          entityName,
          entityName,
          description ?? `Artifact: ${artifactType} from ${toolName}`
        );
      } catch {
        // Ref already exists — remove the entity we just appended and retry
        const graph = await this.storage.getGraphForMutation();
        graph.entities = graph.entities.filter((e) => e.name !== entityName);
        await this.storage.saveGraph(graph);
        continue;
      }

      return artifactEntity;
    }

    throw new Error(
      `ArtifactManager: could not generate a unique name for toolName="${toolName}" after ${MAX_ATTEMPTS} attempts`
    );
  }

  /**
   * Retrieve an artifact by its stable ref (entity name).
   *
   * @param ref - The stable ref / entity name (e.g. "bash-2026-03-24-a3f2")
   * @returns The ArtifactEntity, or null if not found
   */
  async getArtifact(ref: string): Promise<ArtifactEntity | null> {
    const entity = await this.entityManager.resolveRef(ref);
    if (!entity) return null;
    if (!isArtifactEntity(entity)) return null;
    return entity;
  }

  /**
   * List all artifacts, with optional filtering.
   *
   * Filtering is applied in-memory after loading all entities from storage.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching ArtifactEntity objects
   */
  async listArtifacts(filter?: ArtifactFilter): Promise<ArtifactEntity[]> {
    const graph = await this.storage.loadGraph();
    const artifacts: ArtifactEntity[] = [];

    for (const entity of graph.entities) {
      if (!isArtifactEntity(entity)) continue;

      // Apply toolName filter
      if (filter?.toolName !== undefined && entity.toolName !== filter.toolName) {
        continue;
      }

      // Apply artifactType filter
      if (filter?.artifactType !== undefined && entity.artifactType !== filter.artifactType) {
        continue;
      }

      // Apply since filter (compare against createdAt)
      if (filter?.since !== undefined) {
        if (entity.createdAt === undefined) {
          // No createdAt — cannot determine if it meets the since requirement
          continue;
        }
        const createdAt = new Date(entity.createdAt);
        if (createdAt < filter.since) {
          continue;
        }
      }

      artifacts.push(entity);
    }

    return artifacts;
  }
}
