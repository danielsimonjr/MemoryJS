# Debugging Guide

Techniques and tools for debugging MemoryJS issues.

## Table of Contents

1. [Common Issues](#common-issues)
2. [Debugging Tools](#debugging-tools)
3. [Storage Debugging](#storage-debugging)
4. [Search Debugging](#search-debugging)
5. [Performance Debugging](#performance-debugging)
6. [Test Debugging](#test-debugging)
7. [Production Debugging](#production-debugging)

---

## Common Issues

### Entity Not Found

**Symptom**: `EntityNotFoundError` when entity should exist

**Diagnosis**:
```typescript
// Check if entity exists
const entity = await ctx.entityManager.getEntityByName('MyEntity');
console.log('Entity:', entity);

// List all entities
const all = await ctx.entityManager.getAllEntities();
console.log('All entities:', all.map(e => e.name));

// Check for case sensitivity
const lowercase = all.find(e => e.name.toLowerCase() === 'myentity');
console.log('Case-insensitive match:', lowercase);
```

**Common causes**:
- Case sensitivity (names are case-sensitive)
- Leading/trailing whitespace
- Entity was deleted
- Different storage file

---

### Search Returns No Results

**Symptom**: Search returns empty even with matching data

**Diagnosis**:
```typescript
// Check entities exist
const all = await ctx.entityManager.getAllEntities();
console.log(`Total entities: ${all.length}`);

// Manual match test
const query = 'myquery';
const matches = all.filter(e =>
  e.name.toLowerCase().includes(query.toLowerCase()) ||
  e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
);
console.log('Manual matches:', matches);

// Check filters
const results = await ctx.searchManager.search(query, {
  tags: ['sometag'],
  minImportance: 5
});
console.log('With filters:', results);

// Without filters
const unfiltered = await ctx.searchManager.search(query);
console.log('Without filters:', unfiltered);
```

**Common causes**:
- Filters too restrictive
- Query not in any searchable field
- TF-IDF index out of sync
- Empty observations

---

### SQLite Errors

**Symptom**: `SQLITE_*` errors

**Common errors**:

| Error | Cause | Solution |
|-------|-------|----------|
| `SQLITE_BUSY` | Concurrent access | Use single connection |
| `SQLITE_LOCKED` | Table locked | Wait and retry |
| `SQLITE_CORRUPT` | Database corruption | Restore from backup |
| `SQLITE_READONLY` | Permission issue | Check file permissions |

**Diagnosis**:
```bash
# Check file permissions
ls -la ./memory.db

# Check if file is locked
lsof ./memory.db

# Verify database integrity
sqlite3 ./memory.db "PRAGMA integrity_check;"
```

---

### Memory Issues

**Symptom**: `JavaScript heap out of memory`

**Diagnosis**:
```typescript
// Check memory usage
const used = process.memoryUsage();
console.log('Memory usage:', {
  heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
  heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
  external: `${Math.round(used.external / 1024 / 1024)} MB`,
});

// Check graph size
const stats = await ctx.analyticsManager.getGraphStats();
console.log('Graph stats:', stats);
```

**Solutions**:
```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 script.js

# Or via environment
NODE_OPTIONS=--max-old-space-size=4096 npm start
```

---

## Debugging Tools

### VS Code Debugger

**Launch configuration**:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Current File",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx", "${file}"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Test",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}"],
      "console": "integratedTerminal"
    }
  ]
}
```

**Using breakpoints**:
1. Click line number to set breakpoint
2. F5 to start debugging
3. Use debug console to inspect variables

### Node.js Inspector

```bash
# Start with inspector
node --inspect ./dist/index.js

# Break on first line
node --inspect-brk ./dist/index.js

# Connect with Chrome DevTools
# Open chrome://inspect in Chrome
```

### Console Logging

```typescript
// Structured logging
console.log(JSON.stringify(entity, null, 2));

// With context
console.log('[EntityManager]', {
  operation: 'create',
  input: entities,
  result: created
});

// Timing
console.time('search');
const results = await ctx.searchManager.search(query);
console.timeEnd('search'); // search: 45.123ms
```

---

## Storage Debugging

### JSONL Storage

**View storage file**:
```bash
# Pretty print JSONL
cat memory.jsonl | jq '.'

# Count entities
cat memory.jsonl | jq '.entities | length'

# Find specific entity
cat memory.jsonl | jq '.entities[] | select(.name == "Alice")'

# List all entity names
cat memory.jsonl | jq '.entities[].name'
```

**Validate JSON**:
```bash
# Check for valid JSON
cat memory.jsonl | jq empty && echo "Valid" || echo "Invalid"
```

**Fix corrupted file**:
```typescript
import { promises as fs } from 'fs';

async function repairStorage(path: string) {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const graph = JSON.parse(content);

    // Validate structure
    if (!graph.entities) graph.entities = [];
    if (!graph.relations) graph.relations = [];

    // Remove duplicates
    const seen = new Set();
    graph.entities = graph.entities.filter(e => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });

    // Write repaired
    await fs.writeFile(path, JSON.stringify(graph));
    console.log('Repaired:', path);
  } catch (error) {
    console.error('Repair failed:', error);
  }
}
```

### SQLite Storage

**Query database directly**:
```bash
sqlite3 ./memory.db

# List tables
.tables

# View schema
.schema entities
.schema relations

# Query entities
SELECT name, entity_type FROM entities LIMIT 10;

# Full-text search
SELECT * FROM entities_fts WHERE entities_fts MATCH 'alice';

# Check FTS index
SELECT * FROM entities_fts_content LIMIT 5;
```

**Common SQLite queries**:
```sql
-- Count entities by type
SELECT entity_type, COUNT(*) FROM entities GROUP BY entity_type;

-- Find orphaned relations
SELECT * FROM relations r
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE name = r.from_entity)
   OR NOT EXISTS (SELECT 1 FROM entities WHERE name = r.to_entity);

-- Entity with most relations
SELECT e.name, COUNT(r.id) as rel_count
FROM entities e
LEFT JOIN relations r ON e.name = r.from_entity OR e.name = r.to_entity
GROUP BY e.name
ORDER BY rel_count DESC
LIMIT 10;

-- Rebuild FTS index
INSERT INTO entities_fts(entities_fts) VALUES('rebuild');
```

---

## Search Debugging

### TF-IDF Issues

**Check index state**:
```typescript
// Get index stats (if exposed)
const indexManager = ctx.searchManager['tfidfManager'];
console.log('Index size:', indexManager.getDocumentCount());

// Force rebuild
await indexManager.rebuildIndex();
```

**Debug scoring**:
```typescript
// Get detailed results
const results = await ctx.searchManager.searchRanked(query);
for (const result of results) {
  console.log({
    name: result.entity.name,
    score: result.score,
    matchedFields: result.matchedFields
  });
}
```

### Boolean Query Issues

**Validate query syntax**:
```typescript
// Test parsing
try {
  const results = await ctx.searchManager.booleanSearch('(A AND B) OR C');
  console.log('Valid query, results:', results.entities.length);
} catch (error) {
  console.error('Parse error:', error.message);
}

// Common syntax issues:
// - Missing parentheses: A AND B OR C (ambiguous)
// - Case sensitivity: and vs AND
// - Missing quotes for phrases: "multi word" not multi word
```

### Fuzzy Search Issues

**Check similarity calculation**:
```typescript
import { levenshteinDistance } from './src/utils/searchAlgorithms.js';

const query = 'typescirpt'; // Typo
const target = 'typescript';

const distance = levenshteinDistance(query, target);
const similarity = 1 - (distance / Math.max(query.length, target.length));

console.log({
  query,
  target,
  distance,
  similarity,
  wouldMatch: similarity >= 0.7
});
```

---

## Performance Debugging

### Profiling

**CPU profiling**:
```bash
# Generate CPU profile
node --cpu-prof ./dist/benchmark.js

# Analyze with Chrome DevTools
# Load .cpuprofile file in Performance tab
```

**Memory profiling**:
```bash
# Generate heap snapshot
node --heap-prof ./dist/benchmark.js

# Or programmatically
const v8 = require('v8');
const fs = require('fs');

const snapshot = v8.writeHeapSnapshot();
console.log('Heap snapshot written to:', snapshot);
```

### Timing Operations

```typescript
// Simple timing
console.time('operation');
await doOperation();
console.timeEnd('operation');

// Detailed timing
const start = performance.now();
const result = await doOperation();
const duration = performance.now() - start;

console.log(`Operation completed in ${duration.toFixed(2)}ms`);

// With breakdown
const timings = {
  load: 0,
  process: 0,
  save: 0
};

let t = performance.now();
const graph = await storage.loadGraph();
timings.load = performance.now() - t;

t = performance.now();
const processed = processGraph(graph);
timings.process = performance.now() - t;

t = performance.now();
await storage.saveGraph(processed);
timings.save = performance.now() - t;

console.log('Timings:', timings);
```

### Identifying Bottlenecks

```typescript
// Wrap operations with timing
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`${name}: ${(performance.now() - start).toFixed(2)}ms`);
  }
}

// Usage
const entities = await timed('loadEntities', () => ctx.entityManager.getAllEntities());
const results = await timed('search', () => ctx.searchManager.search('query'));
```

---

## Test Debugging

### Running Single Tests

```bash
# Run specific test file
npx vitest run tests/unit/core/EntityManager.test.ts

# Run specific test by name
npx vitest run -t "should create entity"

# Run with filter
npx vitest run --grep "EntityManager"

# Verbose output
npx vitest run --reporter=verbose
```

### Debugging Test Failures

```bash
# Show full error output
npx vitest run --no-truncate

# Run in sequence (not parallel)
npx vitest run --no-threads

# With debugging output
DEBUG=* npx vitest run tests/failing.test.ts
```

### Isolating Flaky Tests

```typescript
describe('flaky test investigation', () => {
  // Run multiple times
  for (let i = 0; i < 10; i++) {
    it(`should work consistently (run ${i + 1})`, async () => {
      // Test code
    });
  }

  // With retry
  it('should eventually work', async () => {
    // Vitest supports retries in config
  }, { retry: 3 });
});
```

### Test State Issues

```typescript
describe('with proper isolation', () => {
  let ctx: ManagerContext;
  let tempDir: string;

  beforeEach(async () => {
    // Fresh state for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
    ctx = new ManagerContext({
      storagePath: path.join(tempDir, 'test.jsonl')
    });
  });

  afterEach(async () => {
    // Clean up completely
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('test 1', async () => { /* ... */ });
  it('test 2', async () => { /* ... */ }); // Isolated from test 1
});
```

---

## Production Debugging

### Error Tracking

```typescript
// Wrap operations with error context
async function withErrorContext<T>(
  context: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error in ${context}:`, {
      message: error.message,
      stack: error.stack,
      context
    });
    throw error;
  }
}

// Usage
await withErrorContext('entity creation', async () => {
  return ctx.entityManager.createEntities(entities);
});
```

### Health Checks

```typescript
async function healthCheck(ctx: ManagerContext): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: Record<string, unknown>;
}> {
  const details: Record<string, unknown> = {};

  try {
    // Storage check
    const start = performance.now();
    const stats = await ctx.analyticsManager.getGraphStats();
    details.storageMs = performance.now() - start;
    details.entityCount = stats.entityCount;

    // Validation check
    const validation = await ctx.analyticsManager.validateGraph();
    details.valid = validation.valid;
    details.errors = validation.errors?.length || 0;

    // Memory check
    const mem = process.memoryUsage();
    details.heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);

    return {
      status: validation.valid ? 'healthy' : 'degraded',
      details
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      details: { error: error.message }
    };
  }
}
```

### Logging Best Practices

```typescript
// Structured logging
const log = (level: string, message: string, data?: object) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data
  }));
};

// Usage
log('info', 'Entity created', { name: entity.name, type: entity.entityType });
log('error', 'Operation failed', { error: err.message, stack: err.stack });
log('debug', 'Search completed', { query, resultCount: results.length, durationMs: 45 });
```

---

## Quick Reference

### Common Debug Commands

```bash
# Tests
npx vitest run --no-threads                    # Sequential
npx vitest run -t "test name"                  # Specific test
DEBUG=* npm test                               # With debug output

# Storage
cat memory.jsonl | jq '.'                      # View JSONL
sqlite3 memory.db ".schema"                    # SQLite schema

# Profiling
node --inspect-brk ./dist/script.js            # Debug
node --cpu-prof ./dist/script.js               # CPU profile
node --heap-prof ./dist/script.js              # Memory profile

# Memory
node --max-old-space-size=4096 script.js       # Increase heap
```

### Debug Checklist

1. **Reproduce**: Can you reproduce consistently?
2. **Isolate**: What's the minimal reproduction?
3. **Understand**: What should happen vs. what happens?
4. **Hypothesis**: What might cause this?
5. **Test**: Verify or disprove hypothesis
6. **Fix**: Apply and verify fix
7. **Prevent**: Add test to prevent regression
