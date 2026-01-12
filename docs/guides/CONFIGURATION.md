# MemoryJS Configuration Reference

**Version**: 1.1.1
**Last Updated**: 2026-01-12

Complete reference for all configuration options, environment variables, and customization settings.

---

## Table of Contents

1. [Quick Start Configuration](#quick-start-configuration)
2. [Environment Variables](#environment-variables)
3. [Storage Configuration](#storage-configuration)
4. [Search Configuration](#search-configuration)
5. [Embedding Configuration](#embedding-configuration)
6. [Cache Configuration](#cache-configuration)
7. [Performance Limits](#performance-limits)
8. [File Paths](#file-paths)
9. [Validation Settings](#validation-settings)
10. [Logging Configuration](#logging-configuration)
11. [Worker Pool Configuration](#worker-pool-configuration)
12. [Compression Settings](#compression-settings)
13. [Configuration Examples](#configuration-examples)

---

## Quick Start Configuration

### Minimal Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Defaults: JSONL storage, no semantic search
const ctx = new ManagerContext('./memory.jsonl');
```

### Full Configuration

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Set environment before initialization
process.env.MEMORY_STORAGE_TYPE = 'sqlite';
process.env.EMBEDDING_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'sk-...';

const ctx = new ManagerContext('./memory.db');
```

---

## Environment Variables

### Storage Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite` | `jsonl` | Storage backend type |

### Embedding Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` | Embedding service provider |
| `OPENAI_API_KEY` | API key string | - | OpenAI API key (required for openai provider) |
| `OPENAI_EMBEDDING_MODEL` | Model name | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | Number | `1536` | Embedding vector dimensions |
| `EMBEDDING_BATCH_SIZE` | Number | `100` | Batch size for embedding requests |

### Example .env File

```bash
# Storage
MEMORY_STORAGE_TYPE=sqlite

# Embeddings
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
EMBEDDING_BATCH_SIZE=100

# Optional: Custom paths
MEMORY_BASE_DIR=/var/data/memory
```

---

## Storage Configuration

### JSONL Storage

Default human-readable storage format.

```typescript
// Automatic selection via file extension
const ctx = new ManagerContext('./data/memory.jsonl');

// Or explicit configuration
import { GraphStorage } from '@danielsimonjr/memoryjs';
const storage = new GraphStorage('./data/memory.jsonl');
```

**File Structure**:
```
./data/
├── memory.jsonl              # Main graph data
├── memory-saved-searches.jsonl   # Saved searches
├── memory-tag-aliases.jsonl  # Tag aliases
└── .backups/                 # Backup directory
    └── backup-2024-01-15T10-30-00.jsonl.br
```

**JSONL Configuration**:
| Setting | Value | Description |
|---------|-------|-------------|
| Atomic writes | Enabled | Uses temp file + rename |
| Cache | In-memory | Full graph cached |
| Deep copy | Enabled | Prevents mutation |

### SQLite Storage

High-performance storage with FTS5 search.

```typescript
// Automatic selection via file extension
const ctx = new ManagerContext('./data/memory.db');

// Or explicit configuration
import { SQLiteStorage } from '@danielsimonjr/memoryjs';
const storage = new SQLiteStorage('./data/memory.db');
```

**File Structure**:
```
./data/
├── memory.db                 # SQLite database
├── memory.db-wal            # Write-ahead log
├── memory.db-shm            # Shared memory
├── memory-saved-searches.jsonl   # Saved searches (still JSONL)
└── memory-tag-aliases.jsonl  # Tag aliases (still JSONL)
```

**SQLite Configuration**:
| Setting | Value | Description |
|---------|-------|-------------|
| Journal mode | WAL | Write-ahead logging |
| Synchronous | NORMAL | Balance of safety/speed |
| FTS5 | Enabled | Full-text search |
| BM25 | Default ranking | Relevance scoring |

### Storage Factory Configuration

```typescript
import { createStorage, createStorageFromPath } from '@danielsimonjr/memoryjs';

// Auto-detect from path
const storage1 = createStorageFromPath('./memory.jsonl');  // GraphStorage
const storage2 = createStorageFromPath('./memory.db');     // SQLiteStorage

// Explicit configuration
const storage3 = createStorage({
  type: 'sqlite',
  path: './memory.db'
});

const storage4 = createStorage({
  type: 'jsonl',
  path: './memory.jsonl'
});
```

---

## Search Configuration

### Search Limits

Defined in `src/utils/constants.ts`:

```typescript
export const SEARCH_LIMITS = {
  DEFAULT_LIMIT: 50,      // Default results per search
  MAX_LIMIT: 1000,        // Maximum results allowed
  MIN_QUERY_LENGTH: 1,    // Minimum query length
  MAX_QUERY_LENGTH: 500   // Maximum query length
};
```

### Query Limits

```typescript
export const QUERY_LIMITS = {
  MAX_BOOLEAN_DEPTH: 10,      // Max nesting in boolean queries
  MAX_BOOLEAN_TERMS: 50,      // Max terms in boolean query
  MAX_FUZZY_QUERY_LENGTH: 100 // Max fuzzy query length
};
```

### Semantic Search Limits

```typescript
export const SEMANTIC_SEARCH_LIMITS = {
  DEFAULT_LIMIT: 20,          // Default semantic results
  MAX_LIMIT: 100,             // Max semantic results
  MIN_SCORE: 0.0,             // Minimum similarity score
  DEFAULT_MIN_SCORE: 0.5      // Default minimum score
};
```

### Search Options

```typescript
interface SearchOptions {
  // Filtering
  tags?: string[];              // Filter by tags (any match)
  minImportance?: number;       // Minimum importance (0-10)
  maxImportance?: number;       // Maximum importance (0-10)
  entityType?: string;          // Filter by entity type
  createdAfter?: string;        // ISO date filter
  createdBefore?: string;       // ISO date filter
  modifiedAfter?: string;       // ISO date filter
  modifiedBefore?: string;      // ISO date filter

  // Pagination
  limit?: number;               // Max results (default: 50)
  offset?: number;              // Skip results
}
```

### Hybrid Search Configuration

```typescript
interface HybridSearchOptions {
  weights?: {
    semantic?: number;   // Vector similarity weight (default: 0.4)
    lexical?: number;    // TF-IDF weight (default: 0.4)
    symbolic?: number;   // Metadata weight (default: 0.2)
  };
  filters?: SymbolicFilters;
  limit?: number;
  minScore?: number;
}
```

### Fuzzy Search Configuration

```typescript
interface FuzzySearchOptions {
  threshold?: number;   // Similarity threshold 0-1 (default: 0.7)
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  limit?: number;
}

export const DEFAULT_FUZZY_THRESHOLD = 0.7;
```

### BM25 Configuration

```typescript
export const DEFAULT_BM25_CONFIG = {
  k1: 1.2,   // Term frequency saturation
  b: 0.75   // Document length normalization
};
```

---

## Embedding Configuration

### Provider Configuration

```typescript
import { createEmbeddingService } from '@danielsimonjr/memoryjs';

// OpenAI (production)
const openai = await createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',  // or 'text-embedding-3-large'
  dimensions: 1536
});

// Local (development/testing)
const local = await createEmbeddingService({
  provider: 'local',
  dimensions: 384  // Smaller for local
});

// Mock (testing)
const mock = await createEmbeddingService({
  provider: 'mock',
  dimensions: 1536
});
```

### Embedding Defaults

```typescript
export const EMBEDDING_DEFAULTS = {
  DIMENSIONS: 1536,
  BATCH_SIZE: 100,
  MODEL: 'text-embedding-3-small',
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000
};
```

### OpenAI API Configuration

```typescript
export const OPENAI_API_CONFIG = {
  BASE_URL: 'https://api.openai.com/v1',
  TIMEOUT_MS: 30000,
  MAX_TOKENS_PER_REQUEST: 8191
};
```

### Vector Store Configuration

```typescript
import { createVectorStore, InMemoryVectorStore, SQLiteVectorStore } from '@danielsimonjr/memoryjs';

// Auto-select based on storage type
const vectorStore = createVectorStore('memory', storage);

// Explicit in-memory store
const inMemory = new InMemoryVectorStore();

// Explicit SQLite store (requires SQLiteStorage)
const sqliteVector = new SQLiteVectorStore(sqliteStorage);
```

### Embedding Cache Configuration

```typescript
import { EmbeddingCache, DEFAULT_EMBEDDING_CACHE_OPTIONS } from '@danielsimonjr/memoryjs';

// Default options
const defaults = {
  maxSize: 10000,           // Max cached embeddings
  ttlMs: 24 * 60 * 60 * 1000  // 24 hour TTL
};

// Custom cache
const cache = new EmbeddingCache({
  maxSize: 50000,
  ttlMs: 7 * 24 * 60 * 60 * 1000  // 7 days
});
```

---

## Cache Configuration

### Graph Cache

The graph cache is managed internally by storage classes.

```typescript
// GraphStorage cache behavior
class GraphStorage {
  private cachedGraph: KnowledgeGraph | null = null;

  async loadGraph(): Promise<KnowledgeGraph> {
    if (this.cachedGraph) {
      return structuredClone(this.cachedGraph);  // Deep copy
    }
    // Load from disk and cache
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    // Write to disk
    this.cachedGraph = null;  // Invalidate cache
  }

  invalidateCache(): void {
    this.cachedGraph = null;
  }
}
```

### Search Cache

```typescript
import { SearchCache, searchCaches, clearAllSearchCaches } from '@danielsimonjr/memoryjs';

// Cache is per-storage instance
const cache = searchCaches.get(storage);

// Get cache statistics
const stats = cache?.getStats();
// { hits: 150, misses: 50, size: 100 }

// Clear all caches
clearAllSearchCaches();
```

### Compressed Cache

For memory-constrained environments:

```typescript
import { CompressedCache } from '@danielsimonjr/memoryjs';

const cache = new CompressedCache<Entity>({
  maxSize: 1000,           // Max entries
  compressionLevel: 6,     // Brotli level 1-11
  minSizeToCompress: 1024  // Min bytes to compress
});

cache.set('key', entity);
const retrieved = cache.get('key');

const stats = cache.getStats();
// { hits: 100, misses: 10, compressionRatio: 0.3 }
```

---

## Performance Limits

### Graph Limits

```typescript
export const GRAPH_LIMITS = {
  MAX_ENTITIES: 100000,        // Soft limit for entities
  MAX_RELATIONS: 500000,       // Soft limit for relations
  MAX_OBSERVATIONS_PER_ENTITY: 1000,
  MAX_TAGS_PER_ENTITY: 50,
  MAX_ENTITY_NAME_LENGTH: 500,
  MAX_OBSERVATION_LENGTH: 5000,
  MAX_BATCH_SIZE: 1000         // Max entities per batch
};
```

### Importance Range

```typescript
export const IMPORTANCE_RANGE = {
  MIN: 0,
  MAX: 10,
  DEFAULT: 5
};
```

### Streaming Configuration

```typescript
export const STREAMING_CONFIG = {
  DEFAULT_CHUNK_SIZE: 100,     // Entities per chunk
  MAX_CHUNK_SIZE: 1000,
  FLUSH_INTERVAL_MS: 1000      // Flush interval for streams
};
```

---

## File Paths

### Default Paths

```typescript
export const DEFAULT_BASE_DIR = './memory';

export const FILE_EXTENSIONS = {
  JSONL: '.jsonl',
  SQLITE: '.db',
  COMPRESSED: '.br'
};

export const FILE_SUFFIXES = {
  SAVED_SEARCHES: '-saved-searches',
  TAG_ALIASES: '-tag-aliases',
  BACKUP: '-backup'
};

export const DEFAULT_FILE_NAMES = {
  MEMORY: 'memory',
  SAVED_SEARCHES: 'memory-saved-searches.jsonl',
  TAG_ALIASES: 'memory-tag-aliases.jsonl'
};
```

### Path Utilities

```typescript
import { validateFilePath, ensureMemoryFilePath, defaultMemoryPath } from '@danielsimonjr/memoryjs';

// Get default path
const path = defaultMemoryPath;  // './memory/memory.jsonl'

// Ensure path exists
const fullPath = await ensureMemoryFilePath('./data');
// Creates directory if needed, returns './data/memory.jsonl'

// Validate path (security)
validateFilePath('./data/memory.jsonl', './data');  // OK
validateFilePath('../etc/passwd', './data');        // Throws SecurityError
```

---

## Validation Settings

### Entity Validation

```typescript
import { EntitySchema, CreateEntitySchema } from '@danielsimonjr/memoryjs';

// Entity schema rules
const entityRules = {
  name: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    trim: true
  },
  entityType: {
    type: 'string',
    minLength: 1,
    maxLength: 100,
    trim: true
  },
  observations: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 5000 },
    maxItems: 1000
  },
  tags: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 100 },
    maxItems: 50,
    transform: 'lowercase'
  },
  importance: {
    type: 'number',
    minimum: 0,
    maximum: 10,
    integer: true
  }
};
```

### Custom Validation

```typescript
import { validateWithSchema, validateSafe, formatZodErrors } from '@danielsimonjr/memoryjs';

// Strict validation (throws on error)
const entity = validateWithSchema(EntitySchema, input);

// Safe validation (returns result object)
const result = validateSafe(EntitySchema, input);
if (!result.success) {
  console.error(formatZodErrors(result.error));
}
```

---

## Logging Configuration

### Logger Configuration

```typescript
import { logger } from '@danielsimonjr/memoryjs';

// Logger is a simple console wrapper
// Levels: debug, info, warn, error

logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');
```

### Custom Logging

```typescript
// Replace the logger with your own
import { logger } from '@danielsimonjr/memoryjs';

// Override methods
const originalInfo = logger.info;
logger.info = (...args: unknown[]) => {
  // Custom handling
  myLoggingService.log('info', args);
  originalInfo.apply(logger, args);
};
```

### Log Prefixes

```typescript
export const LOG_PREFIXES = {
  ENTITY: '[Entity]',
  RELATION: '[Relation]',
  SEARCH: '[Search]',
  STORAGE: '[Storage]',
  IO: '[IO]',
  CACHE: '[Cache]'
};
```

---

## Worker Pool Configuration

### Worker Pool Settings

```typescript
import { getWorkerPoolManager, WorkerPoolManager } from '@danielsimonjr/memoryjs';

// Get shared pool instance
const pool = getWorkerPoolManager();

// Pool configuration
interface WorkerPoolConfig {
  minWorkers?: number;      // Minimum workers (default: 1)
  maxWorkers?: number;      // Maximum workers (default: CPU count)
  workerType?: 'auto' | 'thread' | 'process';  // Worker type
  idleTimeout?: number;     // Idle worker timeout (ms)
}

// Create custom pool
const customPool = new WorkerPoolManager({
  minWorkers: 2,
  maxWorkers: 8,
  workerType: 'thread',
  idleTimeout: 30000
});

// Get pool statistics
const stats = pool.getStats();
// {
//   totalWorkers: 4,
//   busyWorkers: 2,
//   idleWorkers: 2,
//   pendingTasks: 0,
//   completedTasks: 1000
// }
```

### Parallel Processing Configuration

```typescript
import { parallelMap, parallelFilter } from '@danielsimonjr/memoryjs';

// Parallel map with concurrency control
const results = await parallelMap(items, processItem, {
  concurrency: 4  // Max parallel operations
});

// Parallel filter
const filtered = await parallelFilter(items, asyncPredicate, {
  concurrency: 4
});
```

---

## Compression Settings

### Compression Configuration

```typescript
export const COMPRESSION_CONFIG = {
  ENABLED: true,
  ALGORITHM: 'brotli',
  QUALITY: 6,              // 1-11 (higher = better compression, slower)
  MIN_SIZE: 1024,          // Min bytes to compress
  EXTENSION: '.br'
};

export type CompressionQuality = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
```

### Compression Utilities

```typescript
import { compress, decompress, compressFile, decompressFile } from '@danielsimonjr/memoryjs';

// Compress data
const compressed = await compress(data, { quality: 6 });

// Decompress data
const original = await decompress(compressed);

// Compress file
await compressFile('./large-export.json', './large-export.json.br');

// Decompress file
await decompressFile('./large-export.json.br', './large-export.json');
```

### Backup Compression

```typescript
// Create compressed backup
const backup = await ctx.ioManager.createBackup({
  compress: true,          // Enable compression
  description: 'Pre-migration backup'
});

// List backups (shows compression status)
const backups = await ctx.ioManager.listBackups();
// [{ id: '...', compressed: true, size: 1234, ... }]
```

---

## Configuration Examples

### Development Configuration

```typescript
// .env.development
MEMORY_STORAGE_TYPE=jsonl
EMBEDDING_PROVIDER=mock

// app.ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./dev-memory.jsonl');
```

### Production Configuration

```typescript
// .env.production
MEMORY_STORAGE_TYPE=sqlite
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-prod-xxxx
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

// app.ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('/var/data/memory/production.db');
```

### High-Performance Configuration

```typescript
import { ManagerContext, getWorkerPoolManager } from '@danielsimonjr/memoryjs';

// Configure worker pool for heavy parallel processing
const pool = getWorkerPoolManager();
pool.configure({
  minWorkers: 4,
  maxWorkers: 16,
  workerType: 'thread'
});

// Use SQLite for better query performance
process.env.MEMORY_STORAGE_TYPE = 'sqlite';

const ctx = new ManagerContext('/fast-ssd/memory.db');
```

### Memory-Constrained Configuration

```typescript
import { ManagerContext, CompressedCache } from '@danielsimonjr/memoryjs';

// Use JSONL with aggressive cache limits
const ctx = new ManagerContext('./memory.jsonl');

// Use compressed cache for large datasets
const cache = new CompressedCache({
  maxSize: 500,
  compressionLevel: 9  // Maximum compression
});
```

### Testing Configuration

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Create temporary directory for tests
const testDir = mkdtempSync(join(tmpdir(), 'memoryjs-test-'));
const ctx = new ManagerContext(join(testDir, 'test.jsonl'));

// Cleanup after tests
afterAll(() => {
  rmSync(testDir, { recursive: true });
});
```

### Multi-Environment Configuration

```typescript
// config.ts
interface MemoryConfig {
  storagePath: string;
  storageType: 'jsonl' | 'sqlite';
  embeddingProvider: 'openai' | 'local' | 'none';
}

function getConfig(): MemoryConfig {
  const env = process.env.NODE_ENV || 'development';

  const configs: Record<string, MemoryConfig> = {
    development: {
      storagePath: './dev-memory.jsonl',
      storageType: 'jsonl',
      embeddingProvider: 'none'
    },
    staging: {
      storagePath: '/var/data/staging.db',
      storageType: 'sqlite',
      embeddingProvider: 'local'
    },
    production: {
      storagePath: '/var/data/production.db',
      storageType: 'sqlite',
      embeddingProvider: 'openai'
    }
  };

  return configs[env] || configs.development;
}

// Usage
const config = getConfig();
process.env.MEMORY_STORAGE_TYPE = config.storageType;
process.env.EMBEDDING_PROVIDER = config.embeddingProvider;

const ctx = new ManagerContext(config.storagePath);
```

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
