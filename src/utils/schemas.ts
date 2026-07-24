/**
 * Validation Schemas and Helpers
 *
 * Consolidated module for Zod schemas and validation utilities.
 * Provides runtime type safety and data validation.
 *
 * @module utils/schemas
 */

import { z, type ZodSchema, type ZodError } from 'zod';
import { IMPORTANCE_RANGE } from './constants.js';
import { ValidationError } from './errors.js';

// ==================== Constants ====================

/**
 * Importance range constants (imported from centralized constants).
 */
const MIN_IMPORTANCE = IMPORTANCE_RANGE.MIN;
const MAX_IMPORTANCE = IMPORTANCE_RANGE.MAX;

// ==================== Base Schema Components ====================

/**
 * ISO 8601 date string validation.
 * Accepts standard ISO format: YYYY-MM-DDTHH:mm:ss.sssZ
 */
const isoDateSchema = z.string().datetime({ message: 'Must be a valid ISO 8601 date string' });

/**
 * Entity name validation.
 * Must be a non-empty string with reasonable length constraints.
 */
const entityNameSchema = z.string()
  .min(1, 'Entity name cannot be empty')
  .max(500, 'Entity name cannot exceed 500 characters')
  .trim();

/**
 * Entity type validation.
 * Must be a non-empty string (e.g., "person", "project", "concept").
 */
const entityTypeSchema = z.string()
  .min(1, 'Entity type cannot be empty')
  .max(100, 'Entity type cannot exceed 100 characters')
  .trim();

/**
 * Observation validation.
 * Each observation must be a non-empty string.
 */
const observationSchema = z.string()
  .min(1, 'Observation cannot be empty')
  .max(5000, 'Observation cannot exceed 5000 characters');

/**
 * Tag validation.
 * Tags are normalized to lowercase and must be non-empty.
 */
const tagSchema = z.string()
  .min(1, 'Tag cannot be empty')
  .max(100, 'Tag cannot exceed 100 characters')
  .trim()
  .toLowerCase();

/**
 * Importance validation.
 * Must be a number between MIN_IMPORTANCE and MAX_IMPORTANCE (0-10).
 */
const importanceSchema = z.number()
  .int('Importance must be an integer')
  .min(MIN_IMPORTANCE, `Importance must be at least ${MIN_IMPORTANCE}`)
  .max(MAX_IMPORTANCE, `Importance must be at most ${MAX_IMPORTANCE}`);

/**
 * Relation type validation.
 * Should be in snake_case format (e.g., "works_at", "manages").
 */
const relationTypeSchema = z.string()
  .min(1, 'Relation type cannot be empty')
  .max(100, 'Relation type cannot exceed 100 characters')
  .trim();

// ==================== Entity Schemas ====================

/**
 * Complete Entity schema with all fields.
 * Used for validating full entity objects including timestamps.
 */
export const EntitySchema = z.object({
  /** Stable opaque identifier (assigned at creation, survives renames). */
  id: z.string().min(1).optional(),
  name: entityNameSchema,
  entityType: entityTypeSchema,
  observations: z.array(observationSchema),
  createdAt: isoDateSchema.optional(),
  lastModified: isoDateSchema.optional(),
  tags: z.array(tagSchema).optional(),
  importance: importanceSchema.optional(),
  parentId: entityNameSchema.optional(),
  contentHash: z.string().length(64).optional(),
}).strict();

/**
 * Entity creation input schema.
 * Used for validating user input when creating new entities.
 * Timestamps are optional and will be auto-generated if not provided.
 */
export const CreateEntitySchema = z.object({
  /** Stable opaque identifier. Auto-generated (UUID) when absent; caller-supplied ids are preserved. */
  id: z.string().min(1).optional(),
  name: entityNameSchema,
  entityType: entityTypeSchema,
  observations: z.array(observationSchema),
  tags: z.array(tagSchema).optional(),
  importance: importanceSchema.optional(),
  parentId: entityNameSchema.optional(),
  projectId: z.string().optional(),
  createdAt: isoDateSchema.optional(),
  lastModified: isoDateSchema.optional(),
  // v1.6.0: Freshness
  ttl: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  // v1.8.0: Memory versioning fields
  version: z.number().int().positive().optional(),
  parentEntityName: z.string().optional(),
  rootEntityName: z.string().optional(),
  isLatest: z.boolean().optional(),
  supersededBy: z.string().optional(),
  // v1.11.0: Memory Engine dedup
  contentHash: z.string().length(64).optional(),
  // η.4.4: Bitemporal validity
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  observationMeta: z.array(z.object({
    content: z.string(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    recordedAt: z.string().optional(),
  })).optional(),
  lifecycleStatus: z.enum(['draft', 'published', 'archived']).optional(),
}).strict();

/**
 * Entity update input schema.
 * All fields are optional for partial updates.
 * Name cannot be updated (it's the unique identifier) — a `name` key in
 * the patch is silently dropped, as is the stable opaque `id`.
 *
 * ## Sec7 — mass-assignment hardening (allow-list contract)
 *
 * This schema is `.strip()`: unknown keys are DROPPED, not passed through
 * (the pre-Sec7 `.passthrough()` admitted arbitrary keys such as `isAdmin`
 * straight into storage). Every field that legitimately flows through
 * `EntityManager.updateEntity` / `batchUpdate` must therefore be listed
 * explicitly below.
 *
 * **Maintenance contract:** when adding a new persisted Entity /
 * AgentEntity / SessionEntity / ArtifactEntity / subclass-record field,
 * add it BOTH to `OPTIONAL_PERSISTED_ENTITY_FIELDS` in
 * `src/core/GraphStorage.ts` (persistence allow-list) AND here (update
 * allow-list) — otherwise updates carrying the new field are silently
 * stripped before they reach storage. The two lists intentionally mirror
 * each other; this one additionally admits `createdAt` / `lastModified`
 * (always-serialized timestamps that subclass managers set explicitly).
 *
 * Loose types (`z.unknown()`, plain `z.string()`) are deliberate for
 * subclass-owned fields: their shapes are validated by the owning
 * managers; this schema only gates WHICH keys may pass.
 */
export const UpdateEntitySchema = z.object({
  entityType: entityTypeSchema.optional(),
  observations: z.array(observationSchema).optional(),
  tags: z.array(tagSchema).optional(),
  importance: importanceSchema.optional(),
  parentId: entityNameSchema.optional(),
  // Timestamps (subclass managers pass lastModified explicitly; loose
  // z.string() rather than .datetime() to avoid failing formats that the
  // pre-Sec7 passthrough admitted unvalidated)
  createdAt: z.string().optional(),
  lastModified: z.string().optional(),
  // v1.6.0: Freshness / temporal governance
  ttl: z.number().optional(),
  confidence: z.number().optional(),
  freshnessScore: z.number().optional(),
  expiresAt: z.string().optional(),
  // v1.8.0: Project scoping
  projectId: z.string().optional(),
  // v1.8.0: Memory versioning fields
  isLatest: z.boolean().optional(),
  supersededBy: z.string().optional(),
  rootEntityName: entityNameSchema.optional(),
  parentEntityName: entityNameSchema.optional(),
  version: z.number().int().min(1).optional(),
  // v1.11.0: Memory Engine dedup
  contentHash: z.string().length(64).optional(),
  // η.4.4: Temporal Versioning expansion
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  observationMeta: z.array(z.object({
    content: z.string(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    recordedAt: z.string().optional(),
  })).optional(),
  lifecycleStatus: z.enum(['draft', 'published', 'archived']).optional(),
  // AgentEntity extension (src/types/agent-memory.ts)
  memoryType: z.string().optional(),
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  taskId: z.string().optional(),
  isWorkingMemory: z.boolean().optional(),
  promotedAt: z.string().optional(),
  promotedFrom: z.string().optional(),
  markedForPromotion: z.boolean().optional(),
  accessCount: z.number().optional(),
  lastAccessedAt: z.string().optional(),
  accessPattern: z.string().optional(),
  confirmationCount: z.number().optional(),
  decayRate: z.number().optional(),
  agentId: z.string().optional(),
  visibility: z.string().optional(),
  source: z.unknown().optional(),
  // η.5.5.b: visibility hierarchy expansion
  allowedRoles: z.array(z.string()).optional(),
  visibleFrom: z.string().optional(),
  visibleUntil: z.string().optional(),
  // SessionEntity extension (src/types/agent-memory.ts)
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  status: z.string().optional(),
  goalDescription: z.string().optional(),
  taskType: z.string().optional(),
  userIntent: z.string().optional(),
  memoryCount: z.number().optional(),
  consolidatedCount: z.number().optional(),
  previousSessionId: z.string().optional(),
  relatedSessionIds: z.array(z.string()).optional(),
  outcome: z.unknown().optional(),
  failureCauses: z.array(z.string()).optional(),
  // ArtifactEntity extension (src/types/artifact.ts)
  artifactType: z.string().optional(),
  toolName: z.string().optional(),
  shortId: z.string().optional(),
  // v2.1.x subclass-manager record fields (shapes owned by the managers)
  heuristicRecord: z.unknown().optional(),
  decisionRecord: z.unknown().optional(),
  exclusionRule: z.unknown().optional(),
  projectContextRecord: z.unknown().optional(),
  toolAffordanceRecord: z.unknown().optional(),
  prospectiveRecord: z.unknown().optional(),
  failureRecord: z.unknown().optional(),
  planRecord: z.unknown().optional(),
  reflectionRecord: z.unknown().optional(),
}).strip();

// ==================== Relation Schemas ====================

/**
 * Complete Relation schema with all fields.
 * Used for validating full relation objects including timestamps.
 */
export const RelationSchema = z.object({
  from: entityNameSchema,
  to: entityNameSchema,
  relationType: relationTypeSchema,
  createdAt: isoDateSchema.optional(),
  lastModified: isoDateSchema.optional(),
}).strict();

/**
 * Relation creation input schema.
 * Used for validating user input when creating new relations.
 * Timestamps are optional and will be auto-generated if not provided.
 */
export const CreateRelationSchema = z.object({
  from: entityNameSchema,
  to: entityNameSchema,
  relationType: relationTypeSchema,
  createdAt: isoDateSchema.optional(),
  lastModified: isoDateSchema.optional(),
  weight: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  properties: z.object({
    bidirectional: z.boolean().optional(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    provenance: z.string().optional(),
  }).optional(),
}).strict();

// ==================== Search Schemas ====================

/**
 * Search query validation.
 * Validates text search queries with reasonable length constraints.
 */
export const SearchQuerySchema = z.string()
  .min(1, 'Search query cannot be empty')
  .max(1000, 'Search query cannot exceed 1000 characters')
  .trim();

/**
 * Date range validation for search filters.
 */
export const DateRangeSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
}).strict().refine(
  (data) => new Date(data.start) <= new Date(data.end),
  { message: 'Start date must be before or equal to end date' }
);

// ==================== Tag Schemas ====================

/**
 * Tag alias validation for TagManager.
 */
export const TagAliasSchema = z.object({
  canonical: tagSchema,
  aliases: z.array(tagSchema).min(1, 'Must have at least one alias'),
}).strict();

// ==================== Export Schemas ====================

/**
 * Export format validation.
 */
export const ExportFormatSchema = z.enum(['json', 'graphml', 'csv']);

// ==================== Batch Operation Schemas ====================

/**
 * Batch entity creation validation.
 * Validates array of entities with maximum constraints.
 * Empty arrays are allowed (no-op).
 */
export const BatchCreateEntitiesSchema = z.array(CreateEntitySchema)
  .max(1000, 'Cannot create more than 1000 entities in a single batch');

/**
 * Batch relation creation validation.
 * Validates array of relations with maximum constraints.
 * Empty arrays are allowed (no-op).
 */
export const BatchCreateRelationsSchema = z.array(CreateRelationSchema)
  .max(1000, 'Cannot create more than 1000 relations in a single batch');

/**
 * Entity name array validation for batch deletion.
 */
export const EntityNamesSchema = z.array(entityNameSchema)
  .min(1, 'Must specify at least one entity name')
  .max(1000, 'Cannot delete more than 1000 entities in a single batch');

/**
 * Relation array validation for batch deletion.
 */
export const DeleteRelationsSchema = z.array(CreateRelationSchema)
  .min(1, 'Must specify at least one relation')
  .max(1000, 'Cannot delete more than 1000 relations in a single batch');

// ==================== Observation Schemas ====================

/**
 * Single observation input for add operations.
 * Empty contents array is allowed (no-op).
 */
export const AddObservationInputSchema = z.object({
  entityName: entityNameSchema,
  contents: z.array(observationSchema),
}).strict();

/**
 * Batch observation addition validation.
 * Empty array is allowed (no-op).
 */
export const AddObservationsInputSchema = z.array(AddObservationInputSchema)
  .max(1000, 'Cannot add observations to more than 1000 entities in a single batch');

/**
 * Single observation deletion input.
 * Empty observations array is allowed (no-op).
 * Non-existent entities are silently skipped by the manager.
 */
export const DeleteObservationInputSchema = z.object({
  entityName: entityNameSchema,
  observations: z.array(observationSchema),
}).strict();

/**
 * Batch observation deletion validation.
 * Empty array is allowed (no-op).
 */
export const DeleteObservationsInputSchema = z.array(DeleteObservationInputSchema)
  .max(1000, 'Cannot delete observations from more than 1000 entities in a single batch');

// ==================== Archive Schema ====================

/**
 * Archive criteria validation.
 * All fields are optional - the manager handles the case when no criteria provided.
 */
export const ArchiveCriteriaSchema = z.object({
  olderThan: isoDateSchema.optional(),
  importanceLessThan: z.number().min(0).max(10).optional(),
  tags: z.array(tagSchema).optional(),
}).strict();

// ==================== Saved Search Schemas ====================

/**
 * Saved search creation input validation.
 */
export const SavedSearchInputSchema = z.object({
  name: z.string().min(1, 'Search name cannot be empty').max(200, 'Search name cannot exceed 200 characters').trim(),
  description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional(),
  query: SearchQuerySchema,
  tags: z.array(tagSchema).optional(),
  minImportance: importanceSchema.optional(),
  maxImportance: importanceSchema.optional(),
  entityType: entityTypeSchema.optional(),
}).strict();

/**
 * Saved search update validation.
 * All fields are optional for partial updates.
 */
export const SavedSearchUpdateSchema = z.object({
  description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional(),
  query: SearchQuerySchema.optional(),
  tags: z.array(tagSchema).optional(),
  minImportance: importanceSchema.optional(),
  maxImportance: importanceSchema.optional(),
  entityType: entityTypeSchema.optional(),
}).strict();

// ==================== Import/Export Schemas ====================

/**
 * Import format validation.
 */
export const ImportFormatSchema = z.enum(['json', 'csv', 'graphml']);

/**
 * Export format validation (includes all output formats).
 *
 * Includes the η.5.4 W3C Linked Data formats:
 * - `turtle`: RDF 1.1 Turtle
 * - `rdf-xml`: RDF 1.1 XML serialization (uses Statement reification for non-NCName predicates)
 * - `json-ld`: JSON-LD 1.1 with @context mapping to RDFS + DCTerms
 */
export const ExtendedExportFormatSchema = z.enum([
  'json', 'csv', 'graphml', 'gexf', 'dot', 'markdown', 'mermaid',
  'turtle', 'rdf-xml', 'json-ld',
]);

/**
 * Merge strategy validation for imports.
 */
export const MergeStrategySchema = z.enum(['replace', 'skip', 'merge', 'fail']);

/**
 * Export filter validation.
 */
export const ExportFilterSchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  entityType: entityTypeSchema.optional(),
  tags: z.array(tagSchema).optional(),
}).strict();

// ==================== Search Parameter Schemas ====================

/**
 * Tags array validation (optional, for search filters).
 */
export const OptionalTagsSchema = z.array(tagSchema).optional();

/**
 * Optional entity names array validation.
 */
export const OptionalEntityNamesSchema = z.array(entityNameSchema).optional();

// ==================== Schema Type Exports ====================

export type EntityInput = z.infer<typeof EntitySchema>;
export type CreateEntityInput = z.infer<typeof CreateEntitySchema>;
export type UpdateEntityInput = z.infer<typeof UpdateEntitySchema>;
export type RelationInput = z.infer<typeof RelationSchema>;
export type CreateRelationInput = z.infer<typeof CreateRelationSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
export type TagAliasInput = z.infer<typeof TagAliasSchema>;
export type AddObservationInput = z.infer<typeof AddObservationInputSchema>;
export type DeleteObservationInput = z.infer<typeof DeleteObservationInputSchema>;
export type ArchiveCriteriaInput = z.infer<typeof ArchiveCriteriaSchema>;
export type SavedSearchInput = z.infer<typeof SavedSearchInputSchema>;
export type SavedSearchUpdateInput = z.infer<typeof SavedSearchUpdateSchema>;
export type ImportFormatInput = z.infer<typeof ImportFormatSchema>;
export type ExtendedExportFormatInput = z.infer<typeof ExtendedExportFormatSchema>;
export type MergeStrategyInput = z.infer<typeof MergeStrategySchema>;
export type ExportFilterInput = z.infer<typeof ExportFilterSchema>;

// ==================== Validation Result Type ====================

/**
 * Validation result with status and error messages.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ==================== Zod Validation Helpers ====================

/**
 * Formats Zod errors into human-readable strings.
 *
 * @param error - Zod error object
 * @returns Array of formatted error messages
 */
export function formatZodErrors(error: ZodError): string[] {
  return error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/**
 * Validates data against a Zod schema and returns the typed result.
 * Throws ValidationError with formatted error messages on failure.
 *
 * @param data - The data to validate
 * @param schema - The Zod schema to validate against
 * @param errorMessage - Custom error message prefix (default: 'Validation failed')
 * @returns The validated and typed data
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const entities = validateWithSchema(
 *   input,
 *   BatchCreateEntitiesSchema,
 *   'Invalid entity data'
 * );
 * ```
 */
export function validateWithSchema<T>(
  data: unknown,
  schema: ZodSchema<T>,
  errorMessage: string = 'Validation failed'
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = formatZodErrors(result.error);
    throw new ValidationError(errorMessage, errors);
  }
  return result.data;
}

/**
 * Validates data and returns a result object instead of throwing.
 * Useful when you want to handle validation errors gracefully.
 *
 * @param data - The data to validate
 * @param schema - The Zod schema to validate against
 * @returns Result object with success status and either data or errors
 *
 * @example
 * ```typescript
 * const result = validateSafe(input, EntitySchema);
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateSafe<T>(
  data: unknown,
  schema: ZodSchema<T>
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatZodErrors(result.error) };
}

/**
 * Validates an array of items against a schema.
 * Returns detailed information about which items failed validation.
 *
 * @param items - Array of items to validate
 * @param schema - Zod schema for individual items
 * @param errorMessage - Custom error message prefix
 * @returns Array of validated items
 * @throws ValidationError if any item fails validation
 */
export function validateArrayWithSchema<T>(
  items: unknown[],
  schema: ZodSchema<T>,
  errorMessage: string = 'Array validation failed'
): T[] {
  const errors: string[] = [];
  const validated: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = schema.safeParse(items[i]);
    if (result.success) {
      validated.push(result.data);
    } else {
      const itemErrors = formatZodErrors(result.error);
      errors.push(...itemErrors.map(e => `[${i}] ${e}`));
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errorMessage, errors);
  }

  return validated;
}

// ==================== Manual Validation Functions ====================
// Thin wrappers around Zod schemas for backward compatibility.

/** Non-empty string that rejects whitespace-only (no length limits). */
const nonEmptyString = z.string().refine(s => s.trim().length > 0, { message: 'Must be a non-empty string' });

/** Lenient entity schema for validation (allows unknown keys, no length limits). */
const entityValidationSchema = z.object({
  name: nonEmptyString,
  entityType: nonEmptyString,
  observations: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(MIN_IMPORTANCE).max(MAX_IMPORTANCE).optional(),
}).passthrough();

/** Lenient relation schema for validation (allows unknown keys). */
const relationValidationSchema = z.object({
  from: nonEmptyString,
  to: nonEmptyString,
  relationType: nonEmptyString,
}).passthrough();

/** Validate an entity object. */
export function validateEntity(entity: unknown): ValidationResult {
  const result = entityValidationSchema.safeParse(entity);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: formatZodErrors(result.error) };
}

/** Validate a relation object. */
export function validateRelation(relation: unknown): ValidationResult {
  const result = relationValidationSchema.safeParse(relation);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: formatZodErrors(result.error) };
}

/** Validate importance level (must be 0-10). */
export function validateImportance(importance: number): boolean {
  return typeof importance === 'number'
    && !isNaN(importance)
    && importance >= IMPORTANCE_RANGE.MIN
    && importance <= IMPORTANCE_RANGE.MAX;
}

/** Validate an array of tags. */
export function validateTags(tags: unknown): ValidationResult {
  const schema = z.array(z.string().refine(s => s.trim().length > 0, { message: 'Tag must be a non-empty string' }));
  const result = schema.safeParse(tags);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: formatZodErrors(result.error) };
}

/** Validate a non-empty string with detailed error reporting. */
export function validateNonEmpty(value: unknown, fieldName: string, contextName: string = 'Validation'): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const received =
      typeof value === 'string'
        ? `string of length ${value.length} (${JSON.stringify(value.slice(0, 40))})`
        : `${typeof value} (${value === null ? 'null' : String(value).slice(0, 40)})`;
    throw new Error(`${contextName}: '${fieldName}' must be a non-empty string; received ${received}`);
  }
}

/** Validate a non-empty array with detailed error reporting. */
export function validateNonEmptyArray(value: unknown, fieldName: string, contextName: string = 'Validation'): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${contextName}: '${fieldName}' must be a non-empty array`);
  }
}
