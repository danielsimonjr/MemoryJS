/**
 * Artifact Type Definitions
 *
 * Types for artifact-level granularity — wrapping tool outputs, code snippets,
 * API responses, and other discrete agent artifacts as stable, named entities.
 *
 * @module types/artifact
 */

import type { Entity } from './types.js';

// ==================== Artifact Core Types ====================

/**
 * Discriminated union of supported artifact categories.
 *
 * - tool_output:    Output produced by an agent tool invocation
 * - code_snippet:   A fragment of code extracted or generated
 * - api_response:   Raw or parsed HTTP/API response body
 * - search_result:  Results from a search operation
 * - file_content:   Content read from a file
 * - user_input:     Direct input supplied by the user
 */
export type ArtifactType =
  | 'tool_output'
  | 'code_snippet'
  | 'api_response'
  | 'search_result'
  | 'file_content'
  | 'user_input';

/**
 * Options for creating a new artifact.
 *
 * @example
 * ```typescript
 * const artifact = await manager.createArtifact({
 *   content: '{"status": 200, "data": [...]}',
 *   toolName: 'fetch',
 *   artifactType: 'api_response',
 *   description: 'GitHub API response for issues',
 *   sessionId: 'session_abc123',
 * });
 * // artifact.name === 'fetch-2026-03-24-a3f2'
 * ```
 */
export interface CreateArtifactOptions {
  /** The artifact content stored as an entity observation */
  content: string;
  /** Name of the tool or source that produced this artifact */
  toolName: string;
  /** Category of artifact for structured filtering */
  artifactType: ArtifactType;
  /** Optional human-readable description registered in RefIndex */
  description?: string;
  /** Session context for grouping related artifacts */
  sessionId?: string;
  /** Task context for grouping related artifacts */
  taskId?: string;
}

/**
 * An entity that represents a discrete agent artifact.
 *
 * Extends the base Entity with artifact-specific metadata:
 * - `artifactType`: The category of this artifact
 * - `toolName`: The originating tool or source
 * - `shortId`: The 4-character random suffix used in the entity name
 *
 * The `name` field follows the convention: `${toolName}-${YYYY-MM-DD}-${shortId}`
 *
 * @example
 * ```typescript
 * const artifact: ArtifactEntity = {
 *   name: 'bash-2026-03-24-a3f2',
 *   entityType: 'artifact',
 *   observations: ['exit code: 0\nstdout: Hello World\n'],
 *   artifactType: 'tool_output',
 *   toolName: 'bash',
 *   shortId: 'a3f2',
 *   createdAt: '2026-03-24T10:00:00.000Z',
 * };
 * ```
 */
export interface ArtifactEntity extends Entity {
  /** Fixed entity type for all artifacts */
  entityType: 'artifact';
  /** Category of this artifact */
  artifactType: ArtifactType;
  /** Originating tool or source name */
  toolName: string;
  /** 4-character hex suffix used to make the name unique */
  shortId: string;
  /** Session ID if provided at creation */
  sessionId?: string;
  /** Task ID if provided at creation */
  taskId?: string;
}

/**
 * Filter options for listing artifacts.
 *
 * @example
 * ```typescript
 * const results = await manager.listArtifacts({
 *   toolName: 'bash',
 *   artifactType: 'tool_output',
 *   since: new Date('2026-03-24'),
 * });
 * ```
 */
export interface ArtifactFilter {
  /** Filter by originating tool name */
  toolName?: string;
  /** Filter by artifact category */
  artifactType?: ArtifactType;
  /** Only return artifacts created at or after this date */
  since?: Date;
}

// ==================== Type Guards ====================

/**
 * Type guard to check if an entity is an ArtifactEntity.
 *
 * @param entity - Value to check
 * @returns True if entity has all required ArtifactEntity fields
 *
 * @example
 * ```typescript
 * if (isArtifactEntity(entity)) {
 *   console.log(entity.toolName); // TypeScript knows this exists
 * }
 * ```
 */
export function isArtifactEntity(entity: unknown): entity is ArtifactEntity {
  if (!entity || typeof entity !== 'object') return false;
  const e = entity as Record<string, unknown>;
  return (
    e.entityType === 'artifact' &&
    typeof e.toolName === 'string' &&
    typeof e.shortId === 'string' &&
    typeof e.artifactType === 'string' &&
    [
      'tool_output',
      'code_snippet',
      'api_response',
      'search_result',
      'file_content',
      'user_input',
    ].includes(e.artifactType as string)
  );
}
