# Testing Guide

Comprehensive guide to testing in MemoryJS.

## Table of Contents

1. [Test Framework](#test-framework)
2. [Test Organization](#test-organization)
3. [Writing Unit Tests](#writing-unit-tests)
4. [Writing Integration Tests](#writing-integration-tests)
5. [Performance Tests](#performance-tests)
6. [Mocking Strategies](#mocking-strategies)
7. [Test Utilities](#test-utilities)
8. [Coverage Requirements](#coverage-requirements)
9. [CI/CD Integration](#cicd-integration)

---

## Test Framework

### Vitest

MemoryJS uses [Vitest](https://vitest.dev/) for testing.

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Run specific file
npx vitest run tests/unit/core/EntityManager.test.ts

# Run matching pattern
npx vitest run --grep "EntityManager"

# Run with verbose output
npx vitest run --reporter=verbose
```

### Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/index.ts',
        '**/types.ts',
        'dist/**',
        'tests/**'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    }
  }
});
```

---

## Test Organization

### Directory Structure

```
tests/
├── unit/                    # Isolated component tests
│   ├── core/               # Core module tests
│   │   ├── EntityManager.test.ts
│   │   ├── RelationManager.test.ts
│   │   ├── GraphStorage.test.ts
│   │   └── SQLiteStorage.test.ts
│   ├── search/             # Search module tests
│   │   ├── BasicSearch.test.ts
│   │   ├── RankedSearch.test.ts
│   │   └── BooleanSearch.test.ts
│   ├── features/           # Feature module tests
│   │   ├── IOManager.test.ts
│   │   └── CompressionManager.test.ts
│   └── utils/              # Utility tests
│       ├── schemas.test.ts
│       └── entityUtils.test.ts
├── integration/             # Cross-module tests
│   ├── workflows.test.ts
│   ├── hybrid-search.test.ts
│   └── streaming-export.test.ts
├── performance/             # Benchmarks
│   ├── benchmarks.test.ts
│   └── search-benchmarks.test.ts
├── edge-cases/             # Boundary conditions
│   └── edge-cases.test.ts
└── fixtures/               # Test data
    ├── sample-graph.ts
    └── mock-storage.ts
```

### File Naming

| Source File | Test File |
|-------------|-----------|
| `EntityManager.ts` | `EntityManager.test.ts` |
| `searchAlgorithms.ts` | `searchAlgorithms.test.ts` |
| `IOManager.ts` | `IOManager.test.ts` |

### Test Categories

| Category | Purpose | Location |
|----------|---------|----------|
| Unit | Test individual components in isolation | `tests/unit/` |
| Integration | Test multiple components together | `tests/integration/` |
| Performance | Benchmark and timing tests | `tests/performance/` |
| Edge Cases | Boundary conditions and unusual inputs | `tests/edge-cases/` |

---

## Writing Unit Tests

### Basic Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { MockStorage } from '../../fixtures/mock-storage.js';
import { ValidationError, EntityNotFoundError } from '../../../src/utils/errors.js';

describe('EntityManager', () => {
  let manager: EntityManager;
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
    manager = new EntityManager(storage);
  });

  afterEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  describe('createEntities', () => {
    it('should create a valid entity with all fields', async () => {
      const input = {
        name: 'Alice',
        entityType: 'person',
        observations: ['Software engineer', 'Works at Acme'],
        tags: ['team', 'engineering'],
        importance: 8
      };

      const [entity] = await manager.createEntities([input]);

      expect(entity.name).toBe('Alice');
      expect(entity.entityType).toBe('person');
      expect(entity.observations).toHaveLength(2);
      expect(entity.tags).toEqual(['team', 'engineering']);
      expect(entity.importance).toBe(8);
      expect(entity.createdAt).toBeDefined();
      expect(entity.lastModified).toBeDefined();
    });

    it('should normalize tags to lowercase', async () => {
      const [entity] = await manager.createEntities([
        { name: 'Test', entityType: 'test', observations: [], tags: ['TAG', 'TeSt'] }
      ]);

      expect(entity.tags).toEqual(['tag', 'test']);
    });

    it('should skip duplicate entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] }
      ]);

      const result = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['new'] }
      ]);

      expect(result).toHaveLength(0);
    });

    it('should reject empty entity name', async () => {
      await expect(
        manager.createEntities([
          { name: '', entityType: 'test', observations: [] }
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('should reject importance out of range', async () => {
      await expect(
        manager.createEntities([
          { name: 'Test', entityType: 'test', observations: [], importance: 15 }
        ])
      ).rejects.toThrow();
    });
  });

  describe('getEntityByName', () => {
    it('should return entity when exists', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Test'] }
      ]);

      const entity = await manager.getEntityByName('Alice');

      expect(entity).not.toBeNull();
      expect(entity?.name).toBe('Alice');
    });

    it('should return null when not found', async () => {
      const entity = await manager.getEntityByName('NonExistent');
      expect(entity).toBeNull();
    });
  });

  describe('deleteEntities', () => {
    it('should remove entity and related relations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] }
      ]);

      await manager.deleteEntities(['Alice']);

      expect(await manager.getEntityByName('Alice')).toBeNull();
      expect(await manager.getEntityByName('Bob')).not.toBeNull();
    });
  });
});
```

### Testing Async Operations

```typescript
describe('async operations', () => {
  it('should handle concurrent creates', async () => {
    const creates = Array.from({ length: 10 }, (_, i) =>
      manager.createEntities([
        { name: `Entity${i}`, entityType: 'test', observations: [] }
      ])
    );

    await Promise.all(creates);

    const all = await manager.getAllEntities();
    expect(all).toHaveLength(10);
  });

  it('should timeout on slow operation', async () => {
    vi.spyOn(storage, 'loadGraph').mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 60000))
    );

    await expect(
      manager.getAllEntities()
    ).rejects.toThrow(); // Will timeout based on test config
  }, { timeout: 1000 });
});
```

### Testing Error Conditions

```typescript
describe('error handling', () => {
  it('should throw EntityNotFoundError for missing entity', async () => {
    await expect(
      manager.addTags('NonExistent', ['tag'])
    ).rejects.toThrow(EntityNotFoundError);
  });

  it('should include entity name in error message', async () => {
    try {
      await manager.addTags('MissingEntity', ['tag']);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toContain('MissingEntity');
    }
  });

  it('should handle storage errors gracefully', async () => {
    vi.spyOn(storage, 'saveGraph').mockRejectedValue(new Error('Disk full'));

    await expect(
      manager.createEntities([{ name: 'Test', entityType: 'test', observations: [] }])
    ).rejects.toThrow('Disk full');
  });
});
```

---

## Writing Integration Tests

### Cross-Module Tests

```typescript
// tests/integration/workflows.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../src/core/ManagerContext.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('Entity Workflow Integration', () => {
  let ctx: ManagerContext;
  let tempDir: string;
  let storagePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memoryjs-test-'));
    storagePath = path.join(tempDir, 'test.jsonl');
    ctx = new ManagerContext({ storagePath });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should complete full entity lifecycle', async () => {
    // Create
    const [entity] = await ctx.entityManager.createEntities([
      { name: 'Project', entityType: 'project', observations: ['Initial'] }
    ]);
    expect(entity.name).toBe('Project');

    // Add observations
    await ctx.observationManager.addObservations([
      { entityName: 'Project', contents: ['Updated', 'More info'] }
    ]);

    // Verify
    const updated = await ctx.entityManager.getEntityByName('Project');
    expect(updated?.observations).toHaveLength(3);

    // Search
    const results = await ctx.searchManager.search('Project');
    expect(results.entities).toHaveLength(1);

    // Delete
    await ctx.entityManager.deleteEntities(['Project']);
    expect(await ctx.entityManager.getEntityByName('Project')).toBeNull();
  });

  it('should handle relations with entities', async () => {
    // Create entities
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: [] },
      { name: 'Bob', entityType: 'person', observations: [] },
      { name: 'Project', entityType: 'project', observations: [] }
    ]);

    // Create relations
    await ctx.relationManager.createRelations([
      { from: 'Alice', to: 'Project', relationType: 'works_on' },
      { from: 'Bob', to: 'Project', relationType: 'works_on' },
      { from: 'Alice', to: 'Bob', relationType: 'knows' }
    ]);

    // Verify relations
    const aliceRels = await ctx.relationManager.getRelationsForEntity('Alice');
    expect(aliceRels.outgoing).toHaveLength(2);

    // Delete entity - should cascade
    await ctx.entityManager.deleteEntities(['Alice']);

    const remaining = await ctx.relationManager.getAllRelations();
    expect(remaining).toHaveLength(1); // Only Bob -> Project
  });

  it('should support search then modify workflow', async () => {
    await ctx.entityManager.createEntities([
      { name: 'TypeScript', entityType: 'language', observations: ['Static typing'] },
      { name: 'JavaScript', entityType: 'language', observations: ['Dynamic'] }
    ]);

    // Search
    const results = await ctx.searchManager.searchRanked('typing');
    expect(results[0].entity.name).toBe('TypeScript');

    // Modify based on search
    await ctx.entityManager.addTags(results[0].entity.name, ['favorite']);

    // Verify
    const updated = await ctx.entityManager.getEntityByName('TypeScript');
    expect(updated?.tags).toContain('favorite');
  });
});
```

### Storage Backend Tests

```typescript
describe('Storage Backend Comparison', () => {
  const backends = ['jsonl', 'sqlite'] as const;

  backends.forEach(backend => {
    describe(`${backend} backend`, () => {
      let ctx: ManagerContext;
      let tempPath: string;

      beforeEach(async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memoryjs-'));
        tempPath = path.join(tempDir, backend === 'sqlite' ? 'test.db' : 'test.jsonl');
        ctx = new ManagerContext({
          storagePath: tempPath,
          storageType: backend
        });
      });

      it('should persist and retrieve entities', async () => {
        await ctx.entityManager.createEntities([
          { name: 'Test', entityType: 'test', observations: ['Persisted'] }
        ]);

        // Create new context to force reload
        const ctx2 = new ManagerContext({
          storagePath: tempPath,
          storageType: backend
        });

        const entity = await ctx2.entityManager.getEntityByName('Test');
        expect(entity).not.toBeNull();
        expect(entity?.observations).toContain('Persisted');
      });
    });
  });
});
```

---

## Performance Tests

### Benchmark Structure

```typescript
// tests/performance/benchmarks.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ManagerContext } from '../../src/core/ManagerContext.js';

describe('Performance Benchmarks', () => {
  let ctx: ManagerContext;

  beforeEach(async () => {
    ctx = new ManagerContext({ storagePath: ':memory:' });
  });

  describe('Entity Creation', () => {
    it('should create 100 entities under 200ms', async () => {
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['observation 1', 'observation 2']
      }));

      const start = performance.now();
      await ctx.entityManager.createEntities(entities);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(200);
    });

    it('should create 1000 entities under 1500ms', async () => {
      const entities = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['observation']
      }));

      const start = performance.now();
      await ctx.entityManager.createEntities(entities);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1500);
      console.log(`Created 1000 entities in ${duration.toFixed(2)}ms`);
    });
  });

  describe('Search Performance', () => {
    beforeEach(async () => {
      // Seed with test data
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 2 === 0 ? 'typeA' : 'typeB',
        observations: [`Description for entity ${i}`, 'common observation']
      }));
      await ctx.entityManager.createEntities(entities);
    });

    it('should complete basic search under 100ms', async () => {
      const start = performance.now();
      await ctx.searchManager.search('common');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should complete ranked search under 600ms', async () => {
      const start = performance.now();
      const results = await ctx.searchManager.searchRanked('entity description');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(600);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
```

### Memory Profiling

```typescript
describe('Memory Usage', () => {
  it('should not exceed memory threshold for large graph', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    const ctx = new ManagerContext({ storagePath: ':memory:' });

    // Create large dataset
    const entities = Array.from({ length: 5000 }, (_, i) => ({
      name: `Entity${i}`,
      entityType: 'test',
      observations: Array.from({ length: 10 }, (_, j) => `Observation ${j}`)
    }));

    await ctx.entityManager.createEntities(entities);

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

    console.log(`Memory increase: ${memoryIncrease.toFixed(2)} MB`);
    expect(memoryIncrease).toBeLessThan(500); // Less than 500MB
  });
});
```

---

## Mocking Strategies

### Storage Mock

```typescript
// tests/fixtures/mock-storage.ts
import type { IGraphStorage, KnowledgeGraph } from '../../src/types/types.js';

export class MockStorage implements IGraphStorage {
  private graph: KnowledgeGraph = { entities: [], relations: [] };

  async loadGraph(): Promise<KnowledgeGraph> {
    return JSON.parse(JSON.stringify(this.graph)); // Deep copy
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    this.graph = JSON.parse(JSON.stringify(graph));
  }

  clear(): void {
    this.graph = { entities: [], relations: [] };
  }

  // For testing - direct access
  getGraph(): KnowledgeGraph {
    return this.graph;
  }
}
```

### Vitest Mocks

```typescript
import { vi } from 'vitest';

describe('with mocks', () => {
  it('should mock storage methods', async () => {
    const storage = new MockStorage();
    const loadSpy = vi.spyOn(storage, 'loadGraph');
    const saveSpy = vi.spyOn(storage, 'saveGraph');

    const manager = new EntityManager(storage);
    await manager.createEntities([{ name: 'Test', entityType: 'test', observations: [] }]);

    expect(loadSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it('should mock external services', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
    });
    vi.stubGlobal('fetch', mockFetch);

    // Test code that uses fetch
    // ...

    vi.unstubAllGlobals();
  });
});
```

### Partial Mocks

```typescript
import { vi } from 'vitest';
import * as entityUtils from '../../src/utils/entityUtils.js';

describe('partial mocking', () => {
  it('should mock specific function', async () => {
    vi.spyOn(entityUtils, 'getCurrentTimestamp').mockReturnValue('2024-01-01T00:00:00Z');

    const manager = new EntityManager(new MockStorage());
    const [entity] = await manager.createEntities([
      { name: 'Test', entityType: 'test', observations: [] }
    ]);

    expect(entity.createdAt).toBe('2024-01-01T00:00:00Z');
  });
});
```

---

## Test Utilities

### Common Helpers

```typescript
// tests/fixtures/helpers.ts
import { ManagerContext } from '../../src/core/ManagerContext.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export async function createTempContext(): Promise<{
  ctx: ManagerContext;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memoryjs-test-'));
  const storagePath = path.join(tempDir, 'test.jsonl');
  const ctx = new ManagerContext({ storagePath });

  return {
    ctx,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

export function createSampleEntities(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Entity${i}`,
    entityType: i % 3 === 0 ? 'typeA' : i % 3 === 1 ? 'typeB' : 'typeC',
    observations: [`Observation for entity ${i}`],
    tags: i % 2 === 0 ? ['even'] : ['odd'],
    importance: i % 10
  }));
}

export function expectEntity(entity: unknown): asserts entity is Entity {
  expect(entity).toBeDefined();
  expect(entity).toHaveProperty('name');
  expect(entity).toHaveProperty('entityType');
  expect(entity).toHaveProperty('observations');
}
```

### Custom Matchers

```typescript
// tests/fixtures/matchers.ts
import { expect } from 'vitest';

expect.extend({
  toBeValidEntity(received) {
    const pass = received &&
      typeof received.name === 'string' &&
      typeof received.entityType === 'string' &&
      Array.isArray(received.observations);

    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid entity`
        : `expected ${received} to be a valid entity`
    };
  }
});

// Usage
expect(entity).toBeValidEntity();
```

---

## Coverage Requirements

### Thresholds

| Metric | Minimum |
|--------|---------|
| Lines | 80% |
| Functions | 80% |
| Branches | 75% |
| Statements | 80% |

### Running Coverage

```bash
npm run test:coverage
```

### Coverage Report

```
--------------------|---------|----------|---------|---------|
File                | % Stmts | % Branch | % Funcs | % Lines |
--------------------|---------|----------|---------|---------|
All files           |   85.23 |    78.45 |   82.11 |   85.23 |
 core/              |   88.12 |    81.22 |   85.00 |   88.12 |
  EntityManager.ts  |   92.00 |    85.00 |   90.00 |   92.00 |
  GraphStorage.ts   |   85.00 |    78.00 |   82.00 |   85.00 |
 search/            |   82.45 |    75.33 |   80.00 |   82.45 |
--------------------|---------|----------|---------|---------|
```

### Excluding Files

```typescript
// vitest.config.ts
coverage: {
  exclude: [
    '**/index.ts',      // Barrel exports
    '**/types.ts',      // Type definitions
    'dist/**',          // Build output
    'tests/**',         // Test files
    '**/*.test.ts'      // Test files
  ]
}
```

---

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x]

    steps:
      - uses: actions/checkout@v3

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Type check
        run: npm run typecheck

      - name: Run tests
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

### Pre-commit Hooks

```json
// package.json
{
  "scripts": {
    "precommit": "npm run typecheck && npm test"
  }
}
```

---

## Quick Reference

### Essential Commands

```bash
npm test                    # Run all tests
npm run test:coverage       # Run with coverage
npm run test:watch          # Watch mode
npx vitest run <file>       # Run specific file
npx vitest run --grep <pattern>  # Match pattern
```

### Test Template

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Component', () => {
  let instance: Component;

  beforeEach(() => {
    instance = new Component();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('method', () => {
    it('should do expected thing', async () => {
      const result = await instance.method();
      expect(result).toBe(expected);
    });

    it('should handle error case', async () => {
      await expect(instance.method()).rejects.toThrow(ExpectedError);
    });
  });
});
```
