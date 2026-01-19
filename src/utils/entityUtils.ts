/**
 * Entity Utilities
 *
 * Consolidated module for entity-related utilities including:
 * - Entity lookup and manipulation functions
 * - Tag normalization and matching
 * - Date parsing and validation
 * - Entity filtering by various criteria
 * - Path utilities and validation
 *
 * @module utils/entityUtils
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Entity, KnowledgeGraph } from '../types/index.js';
import { EntityNotFoundError, FileOperationError } from './errors.js';

// ==================== Hash Functions ====================

/**
 * FNV-1a hash function for fast string hashing.
 *
 * This is a non-cryptographic hash function that provides good distribution
 * for bucketing and deduplication purposes. It's optimized for speed
 * and produces a 32-bit unsigned integer.
 *
 * FNV-1a has the following properties:
 * - Fast computation (single pass through string)
 * - Good distribution for hash table use
 * - Deterministic output for same input
 *
 * @param text - The string to hash
 * @returns A 32-bit unsigned integer hash value
 *
 * @example
 * ```typescript
 * const hash = fnv1aHash('hello');
 * console.log(hash); // 1335831723
 *
 * // Use for bucketing similar entities
 * const bucket = fnv1aHash(entity.name.toLowerCase()) % numBuckets;
 * ```
 */
export function fnv1aHash(text: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

// ==================== Entity Lookup Functions ====================

/**
 * Finds an entity by name in the graph.
 * Overloaded to provide type-safe returns based on throwIfNotFound parameter.
 *
 * @param graph - The knowledge graph to search
 * @param name - The entity name to find
 * @param throwIfNotFound - Whether to throw if entity doesn't exist (default: true)
 * @returns The entity if found, null if not found and throwIfNotFound is false
 * @throws EntityNotFoundError if entity not found and throwIfNotFound is true
 */
export function findEntityByName(
  graph: KnowledgeGraph,
  name: string,
  throwIfNotFound: true
): Entity;
export function findEntityByName(
  graph: KnowledgeGraph,
  name: string,
  throwIfNotFound: false
): Entity | null;
export function findEntityByName(
  graph: KnowledgeGraph,
  name: string,
  throwIfNotFound?: boolean
): Entity | null;
export function findEntityByName(
  graph: KnowledgeGraph,
  name: string,
  throwIfNotFound: boolean = true
): Entity | null {
  const entity = graph.entities.find(e => e.name === name);
  if (!entity && throwIfNotFound) {
    throw new EntityNotFoundError(name);
  }
  return entity ?? null;
}

/**
 * Finds multiple entities by name.
 *
 * @param graph - The knowledge graph to search
 * @param names - Array of entity names to find
 * @param throwIfAnyNotFound - Whether to throw if any entity doesn't exist (default: true)
 * @returns Array of found entities (may be shorter than names if throwIfAnyNotFound is false)
 * @throws EntityNotFoundError if any entity not found and throwIfAnyNotFound is true
 */
export function findEntitiesByNames(
  graph: KnowledgeGraph,
  names: string[],
  throwIfAnyNotFound: boolean = true
): Entity[] {
  const entities: Entity[] = [];

  for (const name of names) {
    const entity = findEntityByName(graph, name, false);
    if (entity) {
      entities.push(entity);
    } else if (throwIfAnyNotFound) {
      throw new EntityNotFoundError(name);
    }
  }

  return entities;
}

/**
 * Checks if an entity exists in the graph.
 *
 * @param graph - The knowledge graph to search
 * @param name - The entity name to check
 * @returns true if entity exists, false otherwise
 */
export function entityExists(graph: KnowledgeGraph, name: string): boolean {
  return graph.entities.some(e => e.name === name);
}

/**
 * Gets the index of an entity in the graph's entities array.
 *
 * @param graph - The knowledge graph to search
 * @param name - The entity name to find
 * @returns The index if found, -1 otherwise
 */
export function getEntityIndex(graph: KnowledgeGraph, name: string): number {
  return graph.entities.findIndex(e => e.name === name);
}

/**
 * Removes an entity from the graph by name.
 * Mutates the graph's entities array in place.
 *
 * @param graph - The knowledge graph to modify
 * @param name - The entity name to remove
 * @returns true if entity was removed, false if not found
 */
export function removeEntityByName(graph: KnowledgeGraph, name: string): boolean {
  const index = getEntityIndex(graph, name);
  if (index === -1) return false;
  graph.entities.splice(index, 1);
  return true;
}

/**
 * Gets all entity names as a Set for fast lookup.
 *
 * @param graph - The knowledge graph
 * @returns Set of all entity names
 */
export function getEntityNameSet(graph: KnowledgeGraph): Set<string> {
  return new Set(graph.entities.map(e => e.name));
}

/**
 * Groups entities by their type.
 *
 * @param entities - Array of entities to group
 * @returns Map of entity type to array of entities
 */
export function groupEntitiesByType(entities: Entity[]): Map<string, Entity[]> {
  const groups = new Map<string, Entity[]>();

  for (const entity of entities) {
    const type = entity.entityType;
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(entity);
  }

  return groups;
}

/**
 * Updates the lastModified timestamp on an entity.
 * Mutates the entity in place.
 *
 * @param entity - The entity to update
 * @returns The updated entity (same reference)
 */
export function touchEntity(entity: Entity): Entity {
  entity.lastModified = new Date().toISOString();
  return entity;
}

// ==================== Tag Normalization and Matching ====================

/**
 * Normalizes a single tag to lowercase and trimmed.
 *
 * @param tag - Tag to normalize
 * @returns Normalized tag
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Normalizes an array of tags to lowercase.
 * Handles undefined/null input gracefully.
 *
 * @param tags - Array of tags to normalize, or undefined
 * @returns Normalized tags array, or empty array if input is undefined/null
 */
export function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags || tags.length === 0) return [];
  return tags.map(tag => tag.toLowerCase());
}

/**
 * Checks if an entity's tags include any of the specified search tags.
 * Both inputs are normalized before comparison.
 *
 * @param entityTags - Tags on the entity (may be undefined)
 * @param searchTags - Tags to search for (may be undefined)
 * @returns true if any search tag matches any entity tag, false if no match or either is empty
 */
export function hasMatchingTag(
  entityTags: string[] | undefined,
  searchTags: string[] | undefined
): boolean {
  if (!entityTags || entityTags.length === 0) return false;
  if (!searchTags || searchTags.length === 0) return false;

  const normalizedEntity = normalizeTags(entityTags);
  const normalizedSearch = normalizeTags(searchTags);

  return normalizedSearch.some(tag => normalizedEntity.includes(tag));
}

/**
 * Checks if entity tags include ALL of the specified required tags.
 *
 * @param entityTags - Tags on the entity (may be undefined)
 * @param requiredTags - All tags that must be present
 * @returns true if all required tags are present
 */
export function hasAllTags(
  entityTags: string[] | undefined,
  requiredTags: string[]
): boolean {
  if (!entityTags || entityTags.length === 0) return false;
  if (requiredTags.length === 0) return true;

  const normalizedEntity = normalizeTags(entityTags);
  return normalizeTags(requiredTags).every(tag => normalizedEntity.includes(tag));
}

/**
 * Filters entities by tag match.
 * Returns all entities if searchTags is empty or undefined.
 *
 * @param entities - Array of entities with optional tags property
 * @param searchTags - Tags to filter by
 * @returns Filtered entities that have at least one matching tag
 */
export function filterByTags<T extends { tags?: string[] }>(
  entities: T[],
  searchTags: string[] | undefined
): T[] {
  if (!searchTags || searchTags.length === 0) {
    return entities;
  }

  const normalizedSearch = normalizeTags(searchTags);

  return entities.filter(entity => {
    if (!entity.tags || entity.tags.length === 0) return false;
    const normalizedEntity = normalizeTags(entity.tags);
    return normalizedSearch.some(tag => normalizedEntity.includes(tag));
  });
}

/**
 * Adds new tags to an existing tag array, avoiding duplicates.
 * All tags are normalized to lowercase.
 *
 * @param existingTags - Current tags (may be undefined)
 * @param newTags - Tags to add
 * @returns Combined tags array with no duplicates
 */
export function addUniqueTags(
  existingTags: string[] | undefined,
  newTags: string[]
): string[] {
  const existing = normalizeTags(existingTags);
  const toAdd = normalizeTags(newTags);

  const uniqueNew = toAdd.filter(tag => !existing.includes(tag));
  return [...existing, ...uniqueNew];
}

/**
 * Removes specified tags from an existing tag array.
 * Comparison is case-insensitive.
 *
 * @param existingTags - Current tags (may be undefined)
 * @param tagsToRemove - Tags to remove
 * @returns Tags array with specified tags removed
 */
export function removeTags(
  existingTags: string[] | undefined,
  tagsToRemove: string[]
): string[] {
  if (!existingTags || existingTags.length === 0) return [];

  const toRemoveNormalized = normalizeTags(tagsToRemove);
  return existingTags.filter(tag => !toRemoveNormalized.includes(tag.toLowerCase()));
}

// ==================== Date Utilities ====================

/**
 * Check if a date falls within a specified range.
 *
 * @param date - ISO 8601 date string to check (may be undefined)
 * @param start - Optional start date (inclusive)
 * @param end - Optional end date (inclusive)
 * @returns True if date is within range or no filters are set
 *
 * @example
 * ```typescript
 * isWithinDateRange('2024-06-15T00:00:00Z', '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'); // true
 * isWithinDateRange('2024-06-15T00:00:00Z', '2024-07-01T00:00:00Z'); // false
 * isWithinDateRange(undefined); // true (no filters)
 * isWithinDateRange(undefined, '2024-01-01T00:00:00Z'); // false (has filter but no date)
 * ```
 */
export function isWithinDateRange(
  date: string | undefined,
  start?: string,
  end?: string
): boolean {
  // If no filters set, always pass
  if (!start && !end) {
    return true;
  }

  // If date is undefined but we have filters, fail
  if (!date) {
    return false;
  }

  const dateObj = new Date(date);

  if (isNaN(dateObj.getTime())) {
    return false;
  }

  if (start) {
    const startObj = new Date(start);
    if (isNaN(startObj.getTime())) {
      return false;
    }
    if (dateObj < startObj) {
      return false;
    }
  }

  if (end) {
    const endObj = new Date(end);
    if (isNaN(endObj.getTime())) {
      return false;
    }
    if (dateObj > endObj) {
      return false;
    }
  }

  return true;
}

/**
 * Parse and validate date range strings.
 *
 * @param startDate - Optional ISO 8601 start date
 * @param endDate - Optional ISO 8601 end date
 * @returns Parsed Date objects or null
 */
export function parseDateRange(
  startDate?: string,
  endDate?: string
): { start: Date | null; end: Date | null } {
  let start: Date | null = null;
  let end: Date | null = null;

  if (startDate) {
    start = new Date(startDate);
    if (isNaN(start.getTime())) {
      start = null;
    }
  }

  if (endDate) {
    end = new Date(endDate);
    if (isNaN(end.getTime())) {
      end = null;
    }
  }

  return { start, end };
}

/**
 * Validate if a string is a valid ISO 8601 date.
 *
 * @param date - Date string to validate
 * @returns True if valid ISO 8601 date
 */
export function isValidISODate(date: string): boolean {
  const dateObj = new Date(date);
  return !isNaN(dateObj.getTime()) && dateObj.toISOString() === date;
}

/**
 * Get current timestamp in ISO 8601 format.
 *
 * @returns Current timestamp string
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// ==================== Filter Utilities ====================

/**
 * Checks if an entity's importance is within the specified range.
 * Entities without importance are treated as not matching if any filter is set.
 *
 * @param importance - The entity's importance value (may be undefined)
 * @param minImportance - Minimum importance filter (inclusive)
 * @param maxImportance - Maximum importance filter (inclusive)
 * @returns true if importance is within range or no filters are set
 *
 * @example
 * ```typescript
 * // Check if entity passes importance filter
 * if (isWithinImportanceRange(entity.importance, 5, 10)) {
 *   // Entity has importance between 5 and 10
 * }
 * ```
 */
export function isWithinImportanceRange(
  importance: number | undefined,
  minImportance?: number,
  maxImportance?: number
): boolean {
  // If no filters set, always pass
  if (minImportance === undefined && maxImportance === undefined) {
    return true;
  }

  // Check minimum importance
  if (minImportance !== undefined) {
    if (importance === undefined || importance < minImportance) {
      return false;
    }
  }

  // Check maximum importance
  if (maxImportance !== undefined) {
    if (importance === undefined || importance > maxImportance) {
      return false;
    }
  }

  return true;
}

/**
 * Filters entities by importance range.
 * Returns all entities if no importance filters are specified.
 *
 * @param entities - Array of entities to filter
 * @param minImportance - Minimum importance filter (inclusive)
 * @param maxImportance - Maximum importance filter (inclusive)
 * @returns Filtered entities within the importance range
 */
export function filterByImportance(
  entities: Entity[],
  minImportance?: number,
  maxImportance?: number
): Entity[] {
  if (minImportance === undefined && maxImportance === undefined) {
    return entities;
  }
  return entities.filter(e =>
    isWithinImportanceRange(e.importance, minImportance, maxImportance)
  );
}

/**
 * Filters entities by creation date range.
 *
 * @param entities - Array of entities to filter
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @returns Filtered entities created within the date range
 */
export function filterByCreatedDate(
  entities: Entity[],
  startDate?: string,
  endDate?: string
): Entity[] {
  if (!startDate && !endDate) {
    return entities;
  }
  return entities.filter(e =>
    isWithinDateRange(e.createdAt, startDate, endDate)
  );
}

/**
 * Filters entities by last modified date range.
 *
 * @param entities - Array of entities to filter
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @returns Filtered entities modified within the date range
 */
export function filterByModifiedDate(
  entities: Entity[],
  startDate?: string,
  endDate?: string
): Entity[] {
  if (!startDate && !endDate) {
    return entities;
  }
  return entities.filter(e =>
    isWithinDateRange(e.lastModified, startDate, endDate)
  );
}

/**
 * Filters entities by entity type.
 *
 * @param entities - Array of entities to filter
 * @param entityType - Entity type to filter by (case-sensitive)
 * @returns Filtered entities of the specified type
 */
export function filterByEntityType(
  entities: Entity[],
  entityType?: string
): Entity[] {
  if (!entityType) {
    return entities;
  }
  return entities.filter(e => e.entityType === entityType);
}

/**
 * Common search filters that can be applied to entities.
 */
export interface CommonSearchFilters {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityType?: string;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

/**
 * Checks if an entity passes all the specified filters.
 * Short-circuits on first failing filter for performance.
 *
 * Note: Tag filtering should be handled separately using hasMatchingTag
 * as it requires special normalization logic.
 *
 * @param entity - Entity to check
 * @param filters - Filters to apply
 * @returns true if entity passes all filters
 */
export function entityPassesFilters(
  entity: Entity,
  filters: Omit<CommonSearchFilters, 'tags'>
): boolean {
  // Importance filter
  if (!isWithinImportanceRange(entity.importance, filters.minImportance, filters.maxImportance)) {
    return false;
  }

  // Entity type filter
  if (filters.entityType && entity.entityType !== filters.entityType) {
    return false;
  }

  // Created date filter
  if (!isWithinDateRange(entity.createdAt, filters.createdAfter, filters.createdBefore)) {
    return false;
  }

  // Modified date filter
  if (!isWithinDateRange(entity.lastModified, filters.modifiedAfter, filters.modifiedBefore)) {
    return false;
  }

  return true;
}

// ==================== Security Utilities ====================

/**
 * Dangerous keys that should never be allowed in object assignment.
 * These can be used for prototype pollution attacks.
 */
const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Sanitizes an object by removing potentially dangerous keys.
 * This prevents prototype pollution attacks when using Object.assign() or spread operators.
 *
 * @param obj - The object to sanitize
 * @returns A new object with dangerous keys removed
 *
 * @example
 * ```typescript
 * // Safe usage with Object.assign
 * const updates = sanitizeObject(userInput);
 * Object.assign(entity, updates);
 *
 * // Protects against prototype pollution
 * const malicious = { __proto__: { admin: true } };
 * const safe = sanitizeObject(malicious); // { }
 * ```
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const result: Partial<T> = {};

  for (const key of Object.keys(obj)) {
    // Skip dangerous keys
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

    // Recursively sanitize nested objects
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key as keyof T] = sanitizeObject(value as Record<string, unknown>) as T[keyof T];
    } else {
      result[key as keyof T] = value as T[keyof T];
    }
  }

  return result;
}

/**
 * CSV formula injection dangerous characters.
 * These can cause spreadsheet applications to execute formulas.
 */
const CSV_FORMULA_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Escapes a CSV field to prevent formula injection attacks.
 * Prepends a single quote to values that start with dangerous characters.
 *
 * @param field - The field value to escape
 * @returns Escaped field value safe for CSV export
 *
 * @example
 * ```typescript
 * escapeCsvFormula('=SUM(A1:A10)'); // "'=SUM(A1:A10)"
 * escapeCsvFormula('normal text'); // 'normal text'
 * ```
 */
export function escapeCsvFormula(field: string | undefined | null): string {
  if (field === undefined || field === null) return '';
  const str = String(field);

  // Prefix with single quote if starts with dangerous character
  if (str.length > 0 && CSV_FORMULA_CHARS.has(str[0])) {
    return "'" + str;
  }
  return str;
}

// ==================== Path Utilities ====================

/**
 * Validate and normalize a file path to prevent path traversal attacks.
 *
 * This function:
 * - Normalizes the path to canonical form
 * - Converts relative paths to absolute paths
 * - Detects and prevents path traversal attempts (..)
 *
 * @param filePath - The file path to validate
 * @param baseDir - Optional base directory for relative paths (defaults to process.cwd())
 * @returns Validated absolute file path
 * @throws {FileOperationError} If path traversal is detected or path is invalid
 *
 * @example
 * ```typescript
 * // Valid paths
 * validateFilePath('/var/data/memory.jsonl'); // Returns absolute path
 * validateFilePath('data/memory.jsonl'); // Returns absolute path from cwd
 *
 * // Invalid paths (throws FileOperationError)
 * validateFilePath('../../../etc/passwd'); // Path traversal detected
 * validateFilePath('/var/data/../../../etc/passwd'); // Path traversal detected
 * ```
 */
export function validateFilePath(filePath: string, baseDir: string = process.cwd()): string {
  // Normalize path to remove redundant separators and resolve . and ..
  const normalized = path.normalize(filePath);

  // Convert to absolute path
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.join(baseDir, normalized);

  // After normalization, check if path still contains .. which would indicate
  // traversal beyond the base directory
  const finalNormalized = path.normalize(absolute);

  // Split path into segments and check for suspicious patterns
  const segments = finalNormalized.split(path.sep);
  if (segments.includes('..')) {
    throw new FileOperationError(
      `Path traversal detected in file path: ${filePath}`,
      filePath
    );
  }

  return finalNormalized;
}

/**
 * Default memory file path (in current working directory).
 * Uses process.cwd() to ensure the path is relative to the consuming project,
 * not the library's installed location.
 */
export const defaultMemoryPath = path.join(process.cwd(), 'memory.jsonl');

/**
 * Ensure memory file path with backward compatibility migration.
 *
 * Handles:
 * 1. Custom MEMORY_FILE_PATH environment variable (with path traversal protection)
 * 2. Backward compatibility: migrates memory.json to memory.jsonl
 * 3. Absolute vs relative path resolution
 *
 * @returns Resolved and validated memory file path
 * @throws {FileOperationError} If path traversal is detected in MEMORY_FILE_PATH
 *
 * @example
 * ```typescript
 * // Use environment variable
 * process.env.MEMORY_FILE_PATH = '/data/memory.jsonl';
 * const path = await ensureMemoryFilePath(); // '/data/memory.jsonl'
 *
 * // Use default path
 * delete process.env.MEMORY_FILE_PATH;
 * const path = await ensureMemoryFilePath(); // './memory.jsonl'
 *
 * // Invalid path (throws error)
 * process.env.MEMORY_FILE_PATH = '../../../etc/passwd';
 * await ensureMemoryFilePath(); // Throws FileOperationError
 * ```
 */
export async function ensureMemoryFilePath(): Promise<string> {
  if (process.env.MEMORY_FILE_PATH) {
    // Custom path provided, validate and resolve to absolute
    // Use process.cwd() as baseDir so paths are relative to consuming project
    const validatedPath = validateFilePath(process.env.MEMORY_FILE_PATH, process.cwd());
    return validatedPath;
  }

  // No custom path set, check for backward compatibility migration
  // Use process.cwd() so paths are relative to consuming project, not library location
  const oldMemoryPath = path.join(process.cwd(), 'memory.json');
  const newMemoryPath = defaultMemoryPath;

  try {
    // Check if old file exists
    await fs.access(oldMemoryPath);

    try {
      // Check if new file exists
      await fs.access(newMemoryPath);
      // Both files exist, use new one (no migration needed)
      return newMemoryPath;
    } catch {
      // Old file exists, new file doesn't - migrate
      console.log('[INFO] Found legacy memory.json file, migrating to memory.jsonl for JSONL format compatibility');
      await fs.rename(oldMemoryPath, newMemoryPath);
      console.log('[INFO] Successfully migrated memory.json to memory.jsonl');
      return newMemoryPath;
    }
  } catch {
    // Old file doesn't exist, use new path
    return newMemoryPath;
  }
}
