# Code Style Guide

Coding conventions and style guidelines for MemoryJS contributors.

## Table of Contents

1. [TypeScript Guidelines](#typescript-guidelines)
2. [Naming Conventions](#naming-conventions)
3. [File Organization](#file-organization)
4. [Import/Export Patterns](#importexport-patterns)
5. [Error Handling](#error-handling)
6. [Async Patterns](#async-patterns)
7. [Documentation](#documentation)
8. [Testing Style](#testing-style)

---

## TypeScript Guidelines

### Strict Mode

All code must pass TypeScript strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true
  }
}
```

### Type Annotations

#### Always Annotate

- Function parameters
- Function return types
- Class properties
- Interface definitions

```typescript
// Good
async function searchEntities(query: string, limit: number = 10): Promise<Entity[]> {
  // ...
}

// Avoid
async function searchEntities(query, limit = 10) {
  // ...
}
```

#### Infer When Obvious

- Local variables with immediate assignment
- Loop variables
- Arrow function parameters in callbacks

```typescript
// Good - inference is clear
const count = entities.length;
const names = entities.map(e => e.name);

// Avoid - redundant
const count: number = entities.length;
const names: string[] = entities.map((e: Entity): string => e.name);
```

### Avoid `any`

Use `unknown` for truly unknown types:

```typescript
// Good
function parseJson(data: string): unknown {
  return JSON.parse(data);
}

function isEntity(value: unknown): value is Entity {
  return typeof value === 'object' && value !== null && 'name' in value;
}

// Avoid
function parseJson(data: string): any {
  return JSON.parse(data);
}
```

### Prefer Interfaces Over Types

Use interfaces for object shapes, types for unions/primitives:

```typescript
// Good - interface for object shape
interface SearchOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
}

// Good - type for union
type ExportFormat = 'json' | 'csv' | 'graphml';

// Avoid - type for object shape
type SearchOptions = {
  limit?: number;
  offset?: number;
};
```

### Readonly Properties

Use `readonly` for properties that shouldn't change:

```typescript
interface Entity {
  readonly name: string;      // Immutable identifier
  readonly createdAt: string; // Immutable timestamp
  observations: string[];     // Mutable array
}

class EntityManager {
  private readonly storage: IGraphStorage;

  constructor(storage: IGraphStorage) {
    this.storage = storage;
  }
}
```

---

## Naming Conventions

### Overview

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `EntityManager` |
| Interfaces | PascalCase | `SearchOptions` |
| Type aliases | PascalCase | `ExportFormat` |
| Enums | PascalCase | `TaskPriority` |
| Enum values | PascalCase | `TaskPriority.High` |
| Functions | camelCase | `findEntityByName` |
| Methods | camelCase | `createEntities` |
| Variables | camelCase | `entityCount` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_LIMIT` |
| Parameters | camelCase | `entityName` |
| Private fields | underscore prefix | `_cache` |

### Classes

```typescript
// Class names are nouns
class EntityManager { }
class SearchCache { }
class GraphTraversal { }

// Not verbs or actions
// Avoid: class ManageEntities { }
```

### Interfaces

```typescript
// Interfaces describe shape
interface Entity { }
interface SearchOptions { }

// Use "I" prefix for storage/service interfaces
interface IGraphStorage { }
interface IVectorStore { }

// Result/Response suffixes for return types
interface SearchResult { }
interface ImportResult { }
```

### Functions and Methods

```typescript
// Start with verb
function findEntityByName() { }
function calculateScore() { }
async function loadGraph() { }

// Boolean getters start with is/has/can
function isValid(): boolean { }
function hasChildren(): boolean { }
function canMerge(): boolean { }

// Async methods - no need for "async" in name
async function search() { }  // Good
async function searchAsync() { }  // Avoid
```

### Constants

```typescript
// Configuration constants
const DEFAULT_LIMIT = 50;
const MAX_OBSERVATIONS = 1000;
const SIMILARITY_THRESHOLD = 0.8;

// Grouped in objects
const SEARCH_LIMITS = {
  DEFAULT: 50,
  MAX: 1000,
} as const;

const FILE_EXTENSIONS = {
  JSONL: '.jsonl',
  SQLITE: '.db',
} as const;
```

### Files

| Type | Convention | Example |
|------|------------|---------|
| Class file | PascalCase | `EntityManager.ts` |
| Test file | Source + `.test` | `EntityManager.test.ts` |
| Utility file | camelCase | `entityUtils.ts` |
| Constant file | camelCase | `constants.ts` |
| Type file | camelCase | `types.ts` |
| Barrel export | `index.ts` | `index.ts` |

---

## File Organization

### Module Structure

Each module follows this pattern:

```
src/module/
├── index.ts           # Barrel export
├── MainClass.ts       # Primary class
├── HelperClass.ts     # Supporting classes
└── utils.ts           # Module-specific utilities
```

### File Template

```typescript
/**
 * @fileoverview Brief description of file purpose
 * @module module-name
 */

// 1. External imports (alphabetical)
import { z } from 'zod';
import type { Pool } from 'workerpool';

// 2. Internal imports - types first
import type { Entity, SearchOptions } from '../types/index.js';
import { GraphStorage } from '../core/GraphStorage.js';
import { ValidationError } from '../utils/errors.js';
import { SEARCH_LIMITS } from '../utils/constants.js';

// 3. Type definitions (interfaces, types)
interface ManagerOptions {
  cache?: boolean;
  limit?: number;
}

// 4. Constants
const DEFAULT_OPTIONS: ManagerOptions = {
  cache: true,
  limit: 50,
};

// 5. Main export (class, function)
export class ExampleManager {
  private readonly storage: GraphStorage;
  private readonly options: ManagerOptions;

  constructor(storage: GraphStorage, options: ManagerOptions = {}) {
    this.storage = storage;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async doSomething(query: string): Promise<Entity[]> {
    // Implementation
  }
}

// 6. Helper functions (if small, otherwise separate file)
function helperFunction(): void {
  // ...
}
```

### Barrel Exports

Each module has an `index.ts` barrel export:

```typescript
// src/core/index.ts

// Classes
export { EntityManager } from './EntityManager.js';
export { RelationManager } from './RelationManager.js';
export { GraphStorage } from './GraphStorage.js';

// Types (re-export)
export type { ManagerOptions } from './types.js';

// Functions
export { createStorage } from './StorageFactory.js';
```

---

## Import/Export Patterns

### Import Order

1. External packages
2. Node.js built-ins
3. Internal types (type-only)
4. Internal modules

```typescript
// 1. External packages
import { z } from 'zod';
import Database from 'better-sqlite3';

// 2. Node.js built-ins
import { promises as fs } from 'fs';
import path from 'path';

// 3. Internal types
import type { Entity, Relation } from '../types/index.js';
import type { IGraphStorage } from '../types/types.js';

// 4. Internal modules
import { GraphStorage } from '../core/GraphStorage.js';
import { ValidationError } from '../utils/errors.js';
```

### Type-Only Imports

Use `import type` for types to ensure tree-shaking:

```typescript
// Good - type-only import
import type { Entity, Relation } from '../types/index.js';
import { GraphStorage } from '../core/GraphStorage.js';

// Avoid - mixing types and values
import { Entity, Relation, GraphStorage } from '../core/index.js';
```

### Export Patterns

```typescript
// Named exports (preferred)
export class EntityManager { }
export function createEntity() { }
export const DEFAULT_LIMIT = 50;

// Type exports
export type { SearchOptions, SearchResult };
export interface Entity { }

// Re-exports in barrel
export { EntityManager } from './EntityManager.js';
export type { EntityOptions } from './EntityManager.js';
```

### Avoid Default Exports

```typescript
// Good - named export
export class EntityManager { }

// Avoid - default export
export default class EntityManager { }
```

---

## Error Handling

### Use Custom Errors

```typescript
import {
  EntityNotFoundError,
  ValidationError,
  CycleDetectedError,
} from '../utils/errors.js';

// Throw specific errors
if (!entity) {
  throw new EntityNotFoundError(`Entity '${name}' not found`);
}

if (importance < 0 || importance > 10) {
  throw new InvalidImportanceError(`Importance must be 0-10, got ${importance}`);
}
```

### Error Message Guidelines

- Include relevant context (entity name, value, etc.)
- Be specific about what went wrong
- Suggest fix if possible

```typescript
// Good - informative
throw new ValidationError(
  `Entity name must be 1-500 characters, got ${name.length} characters`
);

// Avoid - vague
throw new Error('Invalid name');
```

### Try-Catch Patterns

```typescript
// Catch and re-throw with context
async function loadEntity(name: string): Promise<Entity> {
  try {
    return await this.storage.getEntity(name);
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      throw error; // Re-throw known errors
    }
    throw new Error(`Failed to load entity '${name}': ${error.message}`);
  }
}

// Don't swallow errors
async function save(): Promise<void> {
  try {
    await this.storage.save();
  } catch (error) {
    console.error('Save failed:', error); // Log
    throw error; // Re-throw
  }
}
```

---

## Async Patterns

### Prefer async/await

```typescript
// Good
async function searchEntities(query: string): Promise<Entity[]> {
  const graph = await this.storage.loadGraph();
  return graph.entities.filter(e => e.name.includes(query));
}

// Avoid - raw promises
function searchEntities(query: string): Promise<Entity[]> {
  return this.storage.loadGraph().then(graph => {
    return graph.entities.filter(e => e.name.includes(query));
  });
}
```

### Parallel Operations

```typescript
// Good - parallel when independent
async function loadBoth(): Promise<[Entity[], Relation[]]> {
  const [entities, relations] = await Promise.all([
    this.loadEntities(),
    this.loadRelations(),
  ]);
  return [entities, relations];
}

// Avoid - sequential when parallel possible
async function loadBoth(): Promise<[Entity[], Relation[]]> {
  const entities = await this.loadEntities();
  const relations = await this.loadRelations(); // Waits unnecessarily
  return [entities, relations];
}
```

### Error Handling in Parallel

```typescript
// Use Promise.allSettled for fault tolerance
async function loadMultiple(names: string[]): Promise<Entity[]> {
  const results = await Promise.allSettled(
    names.map(name => this.loadEntity(name))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<Entity> => r.status === 'fulfilled')
    .map(r => r.value);
}
```

---

## Documentation

### JSDoc Comments

Use JSDoc for public APIs:

```typescript
/**
 * Search for entities matching a query.
 *
 * @param query - The search query string
 * @param options - Search configuration options
 * @returns Matching entities with relevance scores
 * @throws {ValidationError} If query is empty
 *
 * @example
 * ```typescript
 * const results = await manager.search('TypeScript', { limit: 10 });
 * console.log(results.map(r => r.entity.name));
 * ```
 */
async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  // ...
}
```

### When to Document

- All public methods
- Complex algorithms
- Non-obvious behavior
- Configuration options

### When NOT to Document

- Self-explanatory code
- Private implementation details
- Obvious getters/setters

```typescript
// Good - self-documenting
function getEntityByName(name: string): Entity | null { }

// Unnecessary documentation
/**
 * Gets entity by name.
 * @param name - The name
 * @returns The entity
 */
function getEntityByName(name: string): Entity | null { }
```

---

## Testing Style

### Test Structure

```typescript
describe('EntityManager', () => {
  // Setup
  let manager: EntityManager;
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
    manager = new EntityManager(storage);
  });

  afterEach(() => {
    storage.clear();
  });

  // Group by method
  describe('createEntities', () => {
    it('should create a valid entity', async () => {
      const result = await manager.createEntities([
        { name: 'Test', entityType: 'test', observations: [] }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should reject empty name', async () => {
      await expect(
        manager.createEntities([{ name: '', entityType: 'test', observations: [] }])
      ).rejects.toThrow(ValidationError);
    });
  });
});
```

### Test Naming

```typescript
// Pattern: should [expected behavior] when [condition]
it('should return empty array when no entities match', async () => { });
it('should throw ValidationError when name is empty', async () => { });
it('should update lastModified when entity is modified', async () => { });
```

### Assertions

```typescript
// Use specific matchers
expect(result).toHaveLength(3);
expect(entity.name).toBe('Alice');
expect(scores).toContain(0.95);

// Avoid vague assertions
expect(result.length === 3).toBe(true); // Avoid
```

---

## Quick Reference

### Do

- Use strict TypeScript
- Write explicit return types
- Use custom error classes
- Prefer async/await
- Document public APIs
- Write descriptive test names

### Don't

- Use `any` type
- Swallow errors silently
- Mix type and value imports
- Use default exports
- Over-document obvious code
- Write vague error messages
