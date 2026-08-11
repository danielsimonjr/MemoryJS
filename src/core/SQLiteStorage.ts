/**
 * SQLite Storage
 *
 * Handles storage operations for the knowledge graph using better-sqlite3 (native SQLite).
 * Implements IGraphStorage interface for storage abstraction.
 *
 * Benefits over sql.js (WASM):
 * - 3-10x faster than WASM-based SQLite
 * - Native FTS5 full-text search support
 * - ACID transactions with proper durability
 * - Concurrent read access support
 * - No memory overhead from WASM runtime
 * - Direct disk I/O (no manual export/import)
 *
 * Features:
 * - Built-in indexes for O(1) lookups
 * - Referential integrity with ON DELETE CASCADE
 * - FTS5 full-text search on entity names and observations
 *
 * @module core/SQLiteStorage
 */

import { createRequire } from 'node:module';
import { chmodSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

/**
 * Lazy loader for the `better-sqlite3` native addon.
 *
 * The addon is loaded on first `SQLiteStorage` instantiation rather than at
 * module evaluation, so importing this module (transitively, via the core
 * barrel / root package entry) does NOT load the native binding. JSONL-only
 * consumers therefore never pay the addon load — and never hit its
 * ABI-mismatch failure mode (`NODE_MODULE_VERSION`). `createRequire` resolves
 * in both the ESM and CJS builds (tsup shims `import.meta.url` for CJS).
 */
type DatabaseCtor = typeof Database;
let cachedDatabaseCtor: DatabaseCtor | undefined;
function loadDatabaseCtor(): DatabaseCtor {
  if (cachedDatabaseCtor === undefined) {
    const require = createRequire(import.meta.url);
    cachedDatabaseCtor = require('better-sqlite3') as DatabaseCtor;
  }
  return cachedDatabaseCtor;
}
import { Mutex } from 'async-mutex';
import type { KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData } from '../types/index.js';
import {
  clearAllSearchCaches,
  bumpEntityGeneration,
  bumpRelationGeneration,
} from '../utils/searchCache.js';
import { NameIndex, RelationIndex, TypeIndex } from '../utils/indexes.js';
import { sanitizeObject, validateFilePath, AsyncMutex } from '../utils/index.js';
import { EntityNotFoundError, DuplicateEntityError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { PartialIndexAdvisor, type FilterObservation } from '../search/PartialIndexAdvisor.js';
import { GraphEventEmitter } from './GraphEventEmitter.js';

/**
 * Composite key uniquely identifying a relation. NUL separator cannot
 * appear inside validated entity names (mirrors `GraphStorage`).
 */
function relationKeyOf(r: Pick<Relation, 'from' | 'to' | 'relationType'>): string {
  return `${r.from}\u0000${r.to}\u0000${r.relationType}`;
}

/**
 * SQLiteStorage manages persistence of the knowledge graph using native SQLite.
 *
 * Uses better-sqlite3 for native SQLite bindings with full FTS5 support,
 * referential integrity, and proper ACID transactions.
 *
 * @example
 * ```typescript
 * const storage = new SQLiteStorage('/path/to/memory.db');
 * await storage.ensureLoaded();
 * const graph = await storage.loadGraph();
 * ```
 */
export class SQLiteStorage implements IGraphStorage {
  /**
   * Mutex for thread-safe access to storage operations.
   * Prevents concurrent writes from corrupting the cache.
   * Note: SQLite itself handles file-level locking, but we need
   * to protect our in-memory cache and index operations.
   */
  private mutex = new Mutex();

  /**
   * Application-level mutex for managers to serialize validate+mutate+save.
   * Mirrors `GraphStorage.graphMutex` — `EntityManager` / `RelationManager` /
   * `ObservationManager` acquire it around their read-modify-write cycles,
   * so it must exist on every backend those managers can be handed.
   * (Previously missing here, which made manager-level batch mutations
   * crash on the SQLite backend.)
   */
  readonly graphMutex = new AsyncMutex();

  /**
   * SQLite database instance for writes and write-transaction reads.
   */
  private db: DatabaseType | null = null;

  /**
   * Read-only connection pool. WAL mode (set in `initialize()`) lets these
   * read concurrently with the writer at the SQLite level. Round-robin
   * checkout via `pickReadConnection()` keeps the rotation cheap.
   *
   * Sized by `MEMORY_SQLITE_READ_POOL_SIZE` (default 4). Set to 0 or 1 to
   * route reads through the writer connection.
   */
  private readPool: DatabaseType[] = [];

  /**
   * Round-robin cursor over `readPool`. Wraps modulo pool size.
   */
  private readPoolCursor: number = 0;

  /**
   * Partial-index advisor. Self-disables when `MEMORY_SQLITE_AUTO_INDEX`
   * is unset. Callers feed it via `recordFilter(observation)`; the
   * advisor's recommendations are flushed every
   * `partialIndexApplyEvery` recordings.
   */
  private readonly partialIndexAdvisor: PartialIndexAdvisor = new PartialIndexAdvisor();

  /**
   * How many `recordFilter` calls between automatic `apply()`s. Tuned
   * so the DDL doesn't fire on every query but reacts within a few
   * hundred filters.
   */
  private readonly partialIndexApplyEvery: number = 100;

  /** Counter against `partialIndexApplyEvery`. */
  private partialIndexRecordings: number = 0;

  /**
   * Whether the database has been initialized.
   */
  private initialized: boolean = false;

  /**
   * In-memory cache for fast read operations.
   * Synchronized with SQLite on writes.
   */
  private cache: KnowledgeGraph | null = null;

  /**
   * Public read-only view of the in-memory cache. Side-effect-free —
   * does NOT force a load. Returns null when the cache has not been
   * populated yet. Mirrors `GraphStorage.cachedGraph` so observability
   * code (`ctx.diagnostics`) works uniformly across both backends.
   */
  get cachedGraph(): KnowledgeGraph | null {
    return this.cache;
  }

  /**
   * O(1) entity lookup by name.
   */
  private nameIndex: NameIndex = new NameIndex();

  /**
   * O(1) entity lookup by type.
   */
  private typeIndex: TypeIndex = new TypeIndex();

  /**
   * Pre-computed lowercase data for search optimization.
   */
  private lowercaseCache: Map<string, LowercaseData> = new Map();

  /**
   * Pending changes counter for batching disk writes.
   * Note: better-sqlite3 writes to disk immediately, but we track for API compatibility.
   */
  private pendingChanges: number = 0;

  /**
   * Warm-cache outgoing/incoming adjacency index. Kept in lockstep with
   * `cache.relations`, matching GraphStorage's RelationIndex path, so
   * relation reads never scan the full relation array.
   */
  private relationIndex: RelationIndex = new RelationIndex();

  /**
   * Event emitter for graph change notifications. Mirrors
   * `GraphStorage.eventEmitter` so event-driven derived views
   * (`TFIDFEventSync`, `GraphRankPrior`, embedding caches, the columnar
   * observation shadow store, `TransitionLedger`) work identically on the
   * SQLite backend.
   */
  private eventEmitter: GraphEventEmitter = new GraphEventEmitter();

  /**
   * O(1) relation lookup by composite key (`from to relationType`),
   * mapping to the live relation object in `cache.relations`. Replaces
   * the previous per-append `findIndex` scan (S3: O(1) cache
   * maintenance) and powers targeted relation deletes.
   */
  private relationKeyMap: Map<string, Relation> = new Map();

  /**
   * Per-connection prepared-statement caches (S3: hoisted `prepare()`).
   * better-sqlite3 does not auto-cache statements, so hot paths were
   * paying a re-compile per call. Keyed weakly by connection so pooled
   * readers get their own statements and everything is dropped
   * automatically when a connection handle is discarded (e.g.
   * `clearCache()` recreating the database).
   */
  private stmtCaches: WeakMap<DatabaseType, Map<string, Statement>> = new WeakMap();

  /**
   * Get (or lazily prepare) a cached statement for a connection.
   */
  private prepareCached(conn: DatabaseType, sql: string): Statement {
    let cache = this.stmtCaches.get(conn);
    if (!cache) {
      cache = new Map();
      this.stmtCaches.set(conn, cache);
    }
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = conn.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Validated database file path (after path traversal checks).
   */
  private readonly validatedDbFilePath: string;

  /**
   * Create a new SQLiteStorage instance.
   *
   * @param dbFilePath - Absolute path to the SQLite database file
   * @throws {FileOperationError} If path traversal is detected
   */
  constructor(dbFilePath: string) {
    // Security: Validate path to prevent path traversal attacks.
    // confineToBase=false: dbFilePath comes from ManagerContext, which
    // already validated it. Tests pass tmpdir() paths; the ".." segment
    // defense-in-depth check still runs.
    this.validatedDbFilePath = validateFilePath(dbFilePath, undefined, false);
  }

  /**
   * Get the event emitter for subscribing to graph changes.
   *
   * Emission parity with `GraphStorage` (one-for-one at the equivalent
   * mutation points):
   * - `graph:loaded` — after `loadCache()` populates the in-memory cache
   * - `graph:saved` — after `saveGraph()` commits a full-graph write
   * - `entity:created` — `appendEntity()`
   * - `relation:created` — `appendRelation()`
   * - `entity:updated` — `updateEntity()` (with `previousValues`)
   * - rename events (`entity:renamed` → `entity:deleted` → `entity:created`)
   *   are emitted by `EntityManager.renameEntity` (manager level, same as
   *   the JSONL path) — `renameEntity()` here intentionally emits nothing
   *   so each event fires exactly once.
   *
   * @returns GraphEventEmitter instance
   *
   * @example
   * ```typescript
   * const storage = new SQLiteStorage('/data/memory.db');
   *
   * storage.events.on('entity:created', (event) => {
   *   console.log(`Entity ${event.entity.name} created`);
   * });
   * ```
   */
  get events(): GraphEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Resolve the `synchronous` pragma mode from `MEMORY_SQLITE_SYNCHRONOUS`.
   *
   * **Durability tradeoff (S3):** the default is `NORMAL` — the canonical
   * pairing with WAL mode. In WAL, `NORMAL` only fsyncs at checkpoint
   * time instead of on every commit (~2–10× commit throughput). The
   * database can never be corrupted by this setting (WAL commits are
   * still crash-consistent); the exposure is that the most recent
   * commit(s) since the last checkpoint may be lost on **power loss /
   * OS crash** (not on application crash). Operators who need every
   * commit fsynced can set `MEMORY_SQLITE_SYNCHRONOUS=FULL`; `OFF`
   * trades all durability for speed (testing / ephemeral data only).
   * Invalid values fall back to `NORMAL`.
   */
  private static resolveSynchronousMode(): 'FULL' | 'NORMAL' | 'OFF' {
    const raw = (process.env.MEMORY_SQLITE_SYNCHRONOUS ?? 'NORMAL').trim().toUpperCase();
    return raw === 'FULL' || raw === 'OFF' ? raw : 'NORMAL';
  }

  /**
   * Initialize the database connection and schema.
   */
  private initialize(): void {
    if (this.initialized) return;

    // Open database (creates file if it doesn't exist). The native addon is
    // loaded lazily here — see loadDatabaseCtor.
    const Database = loadDatabaseCtor();
    this.db = new Database(this.validatedDbFilePath);
    try {
      const currentMode = statSync(this.validatedDbFilePath).mode & 0o777;
      const restrictedMode = currentMode & 0o600;
      if (currentMode !== restrictedMode) {
        chmodSync(this.validatedDbFilePath, restrictedMode);
      }
    } catch (error) {
      // Permission hardening is best-effort on filesystems/platforms that do
      // not implement POSIX chmod semantics; database initialization proceeds.
      logger.warn(
        `[SQLiteStorage] Could not restrict database permissions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Enable foreign keys and WAL mode for better performance
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');

    // S3 write-side tuning:
    // - synchronous: see resolveSynchronousMode() for the durability
    //   tradeoff (default NORMAL, override via MEMORY_SQLITE_SYNCHRONOUS)
    // - busy_timeout: wait up to 5s on a locked database instead of
    //   failing immediately with SQLITE_BUSY
    // - cache_size: 64 MB page cache (negative value = KiB)
    // - temp_store: keep temp tables/indices in memory
    this.db.pragma(`synchronous = ${SQLiteStorage.resolveSynchronousMode()}`);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('temp_store = MEMORY');

    // Spin up the read pool while the writer connection is still live so
    // file creation and pragmas have already happened.
    this.initReadPool();

    // Create tables and indexes
    this.createTables();

    // Load cache from database
    this.loadCache();

    this.initialized = true;
  }

  /**
   * Create database tables, indexes, and FTS5 virtual table.
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Entities table with referential integrity for parentId.
    // contentHash and agentMetadata are added by migrateEntitiesTable for
    // backwards compatibility with v1.10 and earlier DBs; new DBs created
    // here also get them via that same migration call below.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        id TEXT,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT,
        importance INTEGER,
        parentId TEXT REFERENCES entities(name) ON DELETE SET NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        projectId TEXT,
        version INTEGER DEFAULT 1,
        parentEntityName TEXT,
        rootEntityName TEXT,
        isLatest INTEGER DEFAULT 1,
        supersededBy TEXT,
        contentHash TEXT,
        agentMetadata TEXT
      )
    `);

    // Relations table with referential integrity (CASCADE delete)
    // Phase 1 Sprint 5: Added weight, confidence, properties, metadata columns
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        fromEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        toEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        relationType TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        weight REAL,
        confidence REAL,
        properties TEXT,
        metadata TEXT,
        PRIMARY KEY (fromEntity, toEntity, relationType)
      )
    `);

    // Schema migration for existing DBs (Phase 1 Sprint 5)
    this.migrateRelationsTable();

    // Schema migration for existing DBs (v1.8.0)
    this.migrateEntitiesTable();

    // Indexes for fast lookups
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(entityType)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_parent ON entities(parentId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_projectId ON entities(projectId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_isLatest ON entities(isLatest)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_from ON relations(fromEntity)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_to ON relations(toEntity)`);

    // Phase 4 Sprint 1: Additional indexes for range queries (O(n) -> O(log n))
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_importance ON entities(importance)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_lastmodified ON entities(lastModified)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_createdat ON entities(createdAt)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_type ON relations(relationType)`);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_session_created_at
      ON entities(
        CASE
          WHEN json_valid(agentMetadata)
          THEN json_extract(agentMetadata, '$.sessionId')
        END,
        createdAt
      )
    `);

    // Phase 1 Sprint 5: Indexes for relation metadata queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_weight ON relations(weight)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_confidence ON relations(confidence)`);

    // Composite index for common query patterns (type + importance filtering)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_type_importance ON entities(entityType, importance)`);

    // FTS5 virtual table for full-text search
    // content='' makes it an external content table (we manage content ourselves)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        entityType,
        observations,
        tags,
        content='entities',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS5 index in sync with entities table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END
    `);
  }

  /**
   * Phase 1 Sprint 5: Migrate relations table to add metadata columns.
   * Checks if columns exist and adds them if not for backward compatibility.
   */
  private migrateRelationsTable(): void {
    if (!this.db) return;

    // Get current column names
    const columns = this.db.pragma('table_info(relations)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(c => c.name));

    // Add missing columns for metadata support
    if (!columnNames.has('weight')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN weight REAL');
    }
    if (!columnNames.has('confidence')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN confidence REAL');
    }
    if (!columnNames.has('properties')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN properties TEXT');
    }
    if (!columnNames.has('metadata')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN metadata TEXT');
    }
  }

  /**
   * v1.8.0: Migrate entities table to add version chain and projectId columns.
   * Checks if columns exist and adds them if not for backward compatibility.
   */
  private migrateEntitiesTable(): void {
    if (!this.db) return;

    // Get current column names
    const columns = this.db.pragma('table_info(entities)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(c => c.name));

    // Add missing columns for v1.8.0 fields
    if (!columnNames.has('projectId')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN projectId TEXT');
    }
    if (!columnNames.has('version')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN version INTEGER DEFAULT 1');
    }
    if (!columnNames.has('parentEntityName')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN parentEntityName TEXT');
    }
    if (!columnNames.has('rootEntityName')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN rootEntityName TEXT');
    }
    if (!columnNames.has('isLatest')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN isLatest INTEGER DEFAULT 1');
    }
    if (!columnNames.has('supersededBy')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN supersededBy TEXT');
    }
    if (!columnNames.has('contentHash')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN contentHash TEXT');
    }
    if (!columnNames.has('agentMetadata')) {
      // Single JSON-blob column for AgentEntity / SessionEntity /
      // ArtifactEntity extension fields. Subsumes the field-list drift
      // problem: future schema additions just extend the JSON shape.
      this.db.exec('ALTER TABLE entities ADD COLUMN agentMetadata TEXT');
    }
    if (!columnNames.has('id')) {
      // Stable opaque entity identifier (survives renames). New DBs get
      // the column via CREATE TABLE; this ALTER covers pre-existing DBs.
      this.db.exec('ALTER TABLE entities ADD COLUMN id TEXT');
    }

    // Backfill: assign a stable id to any row that lacks one (pre-id DBs,
    // or rows written by code paths that bypass EntityManager). Idempotent
    // — the WHERE clause makes re-runs a no-op. Done in JS (not
    // randomblob SQL) so ids are proper RFC 4122 UUIDs, matching
    // EntityManager.createEntities.
    const missing = this.db.prepare('SELECT name FROM entities WHERE id IS NULL').all() as Array<{ name: string }>;
    if (missing.length > 0) {
      const backfill = this.db.prepare('UPDATE entities SET id = ? WHERE name = ?');
      const tx = this.db.transaction(() => {
        for (const row of missing) {
          backfill.run(randomUUID(), row.name);
        }
      });
      tx();
    }

    // Create indexes (idempotent)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_projectId ON entities(projectId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_isLatest ON entities(isLatest)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_content_hash ON entities(contentHash)`);
  }

  /**
   * Fields that round-trip through the `agentMetadata` JSON blob column.
   * Native columns (importance, projectId, version, contentHash, etc.) are
   * stored separately for SQL-side queryability. Everything else lives in
   * the blob to avoid schema-migration drift as the type system evolves.
   * Mirrors `OPTIONAL_PERSISTED_ENTITY_FIELDS` in GraphStorage.ts minus
   * the fields that already have native columns.
   */
  private static readonly EXTENSION_FIELDS: ReadonlyArray<string> = [
    // Core Entity (not in native columns)
    'ttl', 'confidence',
    // η.4.4 temporal versioning expansion
    'validFrom', 'validUntil', 'observationMeta',
    // Entity state machine
    'lifecycleStatus',
    // AgentEntity (types/agent-memory.ts)
    'memoryType', 'sessionId', 'conversationId', 'taskId',
    'expiresAt', 'isWorkingMemory', 'promotedAt', 'promotedFrom', 'markedForPromotion',
    'accessCount', 'lastAccessedAt', 'accessPattern',
    'confirmationCount', 'decayRate',
    'agentId', 'visibility', 'source',
    // SessionEntity (types/agent-memory.ts)
    'startedAt', 'endedAt', 'status',
    'goalDescription', 'taskType', 'userIntent',
    'memoryCount', 'consolidatedCount',
    'previousSessionId', 'relatedSessionIds',
    'outcome', 'failureCauses',
    // ArtifactEntity (types/artifact.ts)
    'artifactType', 'toolName', 'shortId',
  ];

  /** Build the JSON blob payload for the `agentMetadata` column. */
  private serializeExtensionFields(entity: Entity): string | null {
    const src = entity as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of SQLiteStorage.EXTENSION_FIELDS) {
      const v = src[field];
      if (v !== undefined) out[field] = v;
    }
    return Object.keys(out).length === 0 ? null : JSON.stringify(out);
  }

  /** Inverse of `serializeExtensionFields`. Tolerant of malformed JSON. */
  private parseExtensionFields(blob: string | null): Record<string, unknown> {
    if (!blob) return {};
    try {
      const parsed: unknown = JSON.parse(blob);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Load all data from SQLite into memory cache.
   */
  private loadCache(): void {
    if (!this.db) throw new Error('Database not initialized');

    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Load entities
    const entityRows = this.db.prepare(`SELECT * FROM entities`).all() as EntityRow[];
    for (const row of entityRows) {
      const entity = this.rowToEntity(row);
      entities.push(entity);
      this.updateLowercaseCache(entity);
    }

    // Load relations
    const relationRows = this.db.prepare(`SELECT * FROM relations`).all() as RelationRow[];
    for (const row of relationRows) {
      relations.push(this.rowToRelation(row));
    }

    this.cache = { entities, relations };

    // Build indexes for O(1) lookups
    this.nameIndex.build(entities);
    this.typeIndex.build(entities);
    this.rebuildRelationIndexes(relations);

    // Emit graph:loaded (parity with GraphStorage.loadFromDisk)
    this.eventEmitter.emitGraphLoaded(entities.length, relations.length);
  }

  /**
   * Rebuild the adjacency and composite-key indexes from a relation array.
   */
  private rebuildRelationIndexes(relations: Relation[]): void {
    this.relationIndex.build(relations);
    this.relationKeyMap.clear();
    for (const relation of relations) {
      this.relationKeyMap.set(relationKeyOf(relation), relation);
    }
  }

  /**
   * Convert a database row to an Entity object.
   */
  private rowToEntity(row: EntityRow): Entity {
    let observations: string[];
    let tags: string[] | undefined;
    try {
      observations = JSON.parse(row.observations);
    } catch {
      logger.warn(`SQLiteStorage: malformed JSON in observations for entity "${row.name}"`);
      observations = [];
    }
    try {
      tags = row.tags ? JSON.parse(row.tags) : undefined;
    } catch {
      logger.warn(`SQLiteStorage: malformed JSON in tags for entity "${row.name}"`);
      tags = undefined;
    }
    const entity: Entity = {
      name: row.name,
      entityType: row.entityType,
      observations,
      tags,
      importance: row.importance ?? undefined,
      parentId: row.parentId ?? undefined,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    };

    // Stable entity id (survives renames)
    if (row.id != null) entity.id = row.id;

    // v1.8.0: version chain and projectId fields
    if (row.projectId != null) entity.projectId = row.projectId;
    if (row.version != null) entity.version = row.version;
    if (row.parentEntityName != null) entity.parentEntityName = row.parentEntityName;
    if (row.rootEntityName != null) entity.rootEntityName = row.rootEntityName;
    if (row.isLatest != null) entity.isLatest = row.isLatest === 1;
    if (row.supersededBy != null) entity.supersededBy = row.supersededBy;

    // v1.11.0: contentHash + AgentEntity / SessionEntity / ArtifactEntity
    // extension fields. contentHash has its own indexed column; everything
    // else round-trips through the agentMetadata JSON blob.
    if (row.contentHash != null) entity.contentHash = row.contentHash;
    const ext = this.parseExtensionFields(row.agentMetadata ?? null);
    Object.assign(entity, ext);

    return entity;
  }

  /**
   * Convert a database row to a Relation object.
   * Phase 1 Sprint 5: Includes metadata fields.
   */
  private rowToRelation(row: RelationRow): Relation {
    const relation: Relation = {
      from: row.fromEntity,
      to: row.toEntity,
      relationType: row.relationType,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    };

    // Only include optional metadata fields if present
    if (row.weight !== null) relation.weight = row.weight;
    if (row.confidence !== null) relation.confidence = row.confidence;
    if (row.properties !== null) {
      try { relation.properties = JSON.parse(row.properties); } catch {
        logger.warn(`SQLiteStorage: malformed JSON in properties for relation "${row.fromEntity}->${row.toEntity}"`);
      }
    }
    if (row.metadata !== null) {
      try { relation.metadata = JSON.parse(row.metadata); } catch {
        logger.warn(`SQLiteStorage: malformed JSON in metadata for relation "${row.fromEntity}->${row.toEntity}"`);
      }
    }

    return relation;
  }

  /**
   * Update lowercase cache for an entity.
   */
  private updateLowercaseCache(entity: Entity): void {
    this.lowercaseCache.set(entity.name, {
      name: entity.name.toLowerCase(),
      entityType: entity.entityType.toLowerCase(),
      observations: entity.observations.map(o => o.toLowerCase()),
      tags: entity.tags?.map(t => t.toLowerCase()) || [],
    });
  }

  // ==================== IGraphStorage Implementation ====================

  /**
   * Load the knowledge graph (read-only access).
   *
   * @returns Promise resolving to read-only knowledge graph reference
   */
  async loadGraph(): Promise<ReadonlyKnowledgeGraph> {
    await this.ensureLoaded();
    return this.cache!;
  }

  /**
   * Get a mutable copy of the graph for write operations.
   *
   * @returns Promise resolving to mutable knowledge graph copy
   */
  async getGraphForMutation(): Promise<KnowledgeGraph> {
    await this.ensureLoaded();
    return {
      entities: this.cache!.entities.map(e => ({
        ...e,
        observations: [...e.observations],
        tags: e.tags ? [...e.tags] : undefined,
      })),
      relations: this.cache!.relations.map(r => ({ ...r })),
    };
  }

  /**
   * Ensure the storage is loaded/initialized.
   *
   * @returns Promise resolving when ready
   */
  async ensureLoaded(): Promise<void> {
    if (!this.initialized) {
      this.initialize();
    }
  }

  /**
   * Save the entire knowledge graph to storage.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * @param graph - The knowledge graph to save
   * @returns Promise resolving when save is complete
   */
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      // Disable foreign keys for bulk replace operation
      // This allows inserting entities with parentId references that may not exist
      // and relations with dangling references (which matches the original JSONL behavior)
      this.db.pragma('foreign_keys = OFF');

      try {
        // Use transaction for atomicity
        const transaction = this.db.transaction(() => {
          // Clear existing data
          this.db!.exec('DELETE FROM relations');
          this.db!.exec('DELETE FROM entities');

          // Insert all entities
          const entityStmt = this.db!.prepare(`
            INSERT INTO entities (name, id, entityType, observations, tags, importance, parentId, createdAt, lastModified, projectId, version, parentEntityName, rootEntityName, isLatest, supersededBy, contentHash, agentMetadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const entity of graph.entities) {
            entityStmt.run(
              entity.name,
              entity.id ?? null,
              entity.entityType,
              JSON.stringify(entity.observations),
              entity.tags ? JSON.stringify(entity.tags) : null,
              entity.importance ?? null,
              entity.parentId ?? null,
              entity.createdAt || new Date().toISOString(),
              entity.lastModified || new Date().toISOString(),
              entity.projectId ?? null,
              entity.version ?? 1,
              entity.parentEntityName ?? null,
              entity.rootEntityName ?? null,
              entity.isLatest === false ? 0 : 1,
              entity.supersededBy ?? null,
              entity.contentHash ?? null,
              this.serializeExtensionFields(entity),
            );
          }

          // Insert all relations (Phase 1 Sprint 5: with metadata)
          const relationStmt = this.db!.prepare(`
            INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified, weight, confidence, properties, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const relation of graph.relations) {
            relationStmt.run(
              relation.from,
              relation.to,
              relation.relationType,
              relation.createdAt || new Date().toISOString(),
              relation.lastModified || new Date().toISOString(),
              relation.weight ?? null,
              relation.confidence ?? null,
              relation.properties ? JSON.stringify(relation.properties) : null,
              relation.metadata ? JSON.stringify(relation.metadata) : null,
            );
          }
        });

        transaction();
      } finally {
        // PRAGMA foreign_keys is connection-scoped, so always restore it even
        // when statement preparation or the transaction fails.
        this.db.pragma('foreign_keys = ON');
      }

      // Update cache
      this.cache = graph;
      this.lowercaseCache.clear();
      for (const entity of graph.entities) {
        this.updateLowercaseCache(entity);
      }

      // Rebuild indexes
      this.nameIndex.build(graph.entities);
      this.typeIndex.build(graph.entities);
      this.rebuildRelationIndexes(graph.relations);

      this.pendingChanges = 0;

      // Clear search caches (full clear is retained for true full-graph
      // writes; delta ops use generation bumps)
      clearAllSearchCaches();
      bumpEntityGeneration();
      bumpRelationGeneration();

      // Emit graph:saved (parity with GraphStorage.saveGraphInternal)
      this.eventEmitter.emitGraphSaved(graph.entities.length, graph.relations.length);
    });
  }

  /**
   * SQL for the entity upsert used by `appendEntity`/`appendEntities`.
   * Prepared once per connection via `prepareCached` (S3).
   */
  private static readonly UPSERT_ENTITY_SQL = `
        INSERT OR REPLACE INTO entities (name, id, entityType, observations, tags, importance, parentId, createdAt, lastModified, projectId, version, parentEntityName, rootEntityName, isLatest, supersededBy, contentHash, agentMetadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

  /**
   * Run the entity INSERT OR REPLACE row write (no cache side effects).
   */
  private runEntityUpsert(entity: Entity): void {
    this.prepareCached(this.db!, SQLiteStorage.UPSERT_ENTITY_SQL).run(
      entity.name,
      entity.id ?? null,
      entity.entityType,
      JSON.stringify(entity.observations),
      entity.tags ? JSON.stringify(entity.tags) : null,
      entity.importance ?? null,
      entity.parentId ?? null,
      entity.createdAt || new Date().toISOString(),
      entity.lastModified || new Date().toISOString(),
      entity.projectId ?? null,
      entity.version ?? 1,
      entity.parentEntityName ?? null,
      entity.rootEntityName ?? null,
      entity.isLatest === false ? 0 : 1,
      entity.supersededBy ?? null,
      entity.contentHash ?? null,
      this.serializeExtensionFields(entity),
    );
  }

  /**
   * Upsert an entity into the in-memory cache + indexes in O(1) (S3 —
   * replaces the previous `findIndex` array scan). On a duplicate name
   * the live cache object is mutated **in place** (stale fields removed,
   * new fields assigned) so `cache.entities` and `NameIndex` stay
   * consistent without any scan; the type index is updated when the
   * entityType changed.
   */
  private upsertEntityInCache(entity: Entity): Entity {
    const existing = this.nameIndex.get(entity.name);
    if (existing !== undefined && existing !== entity) {
      const oldType = existing.entityType;
      const target = existing as unknown as Record<string, unknown>;
      const source = entity as unknown as Record<string, unknown>;
      for (const key of Object.keys(target)) {
        if (!(key in source)) delete target[key];
      }
      Object.assign(target, source);
      if (oldType !== existing.entityType) {
        this.typeIndex.updateType(existing.name, oldType, existing.entityType);
      }
      this.updateLowercaseCache(existing);
      return existing;
    }
    if (existing === undefined) {
      this.cache!.entities.push(entity);
    }
    this.nameIndex.add(entity);
    this.typeIndex.add(entity);
    this.updateLowercaseCache(entity);
    return entity;
  }

  /**
   * Append a single entity to storage.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * @param entity - The entity to append
   * @returns Promise resolving when append is complete
   */
  async appendEntity(entity: Entity): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      // Use INSERT OR REPLACE to handle updates (cached statement — S3)
      this.runEntityUpsert(entity);

      // Update cache + indexes in O(1)
      this.upsertEntityInCache(entity);
      bumpEntityGeneration();

      this.pendingChanges++;

      // Emit entity:created (parity with GraphStorage.appendEntity)
      this.eventEmitter.emitEntityCreated(entity);
    });
  }

  /**
   * Append multiple entities in a single transaction (S2 delta
   * persistence). One transaction, one cached prepared statement —
   * O(changed) instead of the previous manager-level DELETE-all +
   * reinsert-all `saveGraph`. Emits `entity:created` exactly once per
   * entity; no `graph:saved` (reserved for true full-graph writes).
   *
   * @param entities - Entities to append (no-op when empty)
   */
  async appendEntities(entities: Entity[]): Promise<void> {
    if (entities.length === 0) return;
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      const tx = this.db.transaction(() => {
        for (const entity of entities) {
          this.runEntityUpsert(entity);
        }
      });
      tx();

      for (const entity of entities) {
        this.upsertEntityInCache(entity);
      }
      bumpEntityGeneration();

      this.pendingChanges += entities.length;

      for (const entity of entities) {
        this.eventEmitter.emitEntityCreated(entity);
      }
    });
  }

  /**
   * Append a single relation to storage.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * @param relation - The relation to append
   * @returns Promise resolving when append is complete
   */
  async appendRelation(relation: Relation): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      // Use INSERT OR REPLACE to handle updates (cached statement — S3)
      this.runRelationUpsert(relation);

      // Update cache in O(1) via the relation key map
      this.upsertRelationInCache(relation);
      bumpRelationGeneration();

      this.pendingChanges++;

      // Emit relation:created (parity with GraphStorage.appendRelation)
      this.eventEmitter.emitRelationCreated(relation);
    });
  }

  /**
   * SQL for the relation upsert used by `appendRelation`/`appendRelations`.
   */
  private static readonly UPSERT_RELATION_SQL = `
        INSERT OR REPLACE INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified, weight, confidence, properties, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

  /**
   * Run the relation INSERT OR REPLACE row write (no cache side effects).
   */
  private runRelationUpsert(relation: Relation): void {
    this.prepareCached(this.db!, SQLiteStorage.UPSERT_RELATION_SQL).run(
      relation.from,
      relation.to,
      relation.relationType,
      relation.createdAt || new Date().toISOString(),
      relation.lastModified || new Date().toISOString(),
      relation.weight ?? null,
      relation.confidence ?? null,
      relation.properties ? JSON.stringify(relation.properties) : null,
      relation.metadata ? JSON.stringify(relation.metadata) : null,
    );
  }

  /**
   * Upsert a relation into the in-memory cache in O(1) via the composite
   * key map (S3 — replaces the previous `findIndex` scan). Duplicate keys
   * mutate the live object in place, mirroring INSERT OR REPLACE.
   */
  private upsertRelationInCache(relation: Relation): Relation {
    const key = relationKeyOf(relation);
    const existing = this.relationKeyMap.get(key);
    if (existing !== undefined && existing !== relation) {
      const target = existing as unknown as Record<string, unknown>;
      const source = relation as unknown as Record<string, unknown>;
      for (const k of Object.keys(target)) {
        if (!(k in source)) delete target[k];
      }
      Object.assign(target, source);
      return existing;
    }
    if (existing === undefined) {
      this.cache!.relations.push(relation);
      this.relationIndex.add(relation);
      this.relationKeyMap.set(key, relation);
    }
    return relation;
  }

  /**
   * Append multiple relations in a single transaction (S2 delta
   * persistence). Emits `relation:created` exactly once per relation; no
   * `graph:saved`.
   *
   * @param relations - Relations to append (no-op when empty)
   */
  async appendRelations(relations: Relation[]): Promise<void> {
    if (relations.length === 0) return;
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      const tx = this.db.transaction(() => {
        for (const relation of relations) {
          this.runRelationUpsert(relation);
        }
      });
      tx();

      for (const relation of relations) {
        this.upsertRelationInCache(relation);
      }
      bumpRelationGeneration();

      this.pendingChanges += relations.length;

      for (const relation of relations) {
        this.eventEmitter.emitRelationCreated(relation);
      }
    });
  }

  /**
   * Update an entity in storage.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * @param entityName - Name of the entity to update
   * @param updates - Partial entity updates to apply
   * @returns Promise resolving to true if found and updated
   */
  async updateEntity(entityName: string, updates: Partial<Entity>): Promise<boolean> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      // Find entity in cache using index (O(1))
      const entity = this.nameIndex.get(entityName);
      if (!entity) {
        return false;
      }

      // Track old type for index update
      const oldType = entity.entityType;

      // Capture previous values for the entity:updated event BEFORE the
      // in-place mutation (parity with GraphStorage.updateEntity).
      const previousValues: Partial<Entity> = {};
      for (const key of Object.keys(updates) as Array<keyof Entity>) {
        if (key in entity) {
          // TS can't prove the per-key value-type alignment when `key` is a
          // union — runtime correctness holds because `key` is narrowed to a
          // single Entity field per iteration.
          (previousValues as Record<string, unknown>)[key] = entity[key];
        }
      }

      // Apply updates to cached entity (sanitized to prevent prototype pollution)
      Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
      entity.lastModified = new Date().toISOString();

      // Update in database (cached statement — S3)
      this.runEntityUpdateRow(entity, entityName);

      // Update indexes
      this.nameIndex.add(entity); // Update reference
      if (updates.entityType && updates.entityType !== oldType) {
        this.typeIndex.updateType(entityName, oldType, updates.entityType);
      }
      this.updateLowercaseCache(entity);
      bumpEntityGeneration();

      this.pendingChanges++;

      // Emit entity:updated (parity with GraphStorage.updateEntity)
      this.eventEmitter.emitEntityUpdated(entityName, updates, previousValues);

      return true;
    });
  }

  /**
   * SQL for the entity UPDATE used by `updateEntity`/`updateEntities`.
   */
  private static readonly UPDATE_ENTITY_SQL = `
        UPDATE entities SET
          id = ?,
          entityType = ?,
          observations = ?,
          tags = ?,
          importance = ?,
          parentId = ?,
          lastModified = ?,
          projectId = ?,
          version = ?,
          parentEntityName = ?,
          rootEntityName = ?,
          isLatest = ?,
          supersededBy = ?,
          contentHash = ?,
          agentMetadata = ?
        WHERE name = ?
      `;

  /**
   * Run the entity UPDATE row write from the (already merged) entity
   * state (no cache side effects).
   */
  private runEntityUpdateRow(entity: Entity, entityName: string): void {
    this.prepareCached(this.db!, SQLiteStorage.UPDATE_ENTITY_SQL).run(
      entity.id ?? null,
      entity.entityType,
      JSON.stringify(entity.observations),
      entity.tags ? JSON.stringify(entity.tags) : null,
      entity.importance ?? null,
      entity.parentId ?? null,
      entity.lastModified,
      entity.projectId ?? null,
      entity.version ?? 1,
      entity.parentEntityName ?? null,
      entity.rootEntityName ?? null,
      entity.isLatest === false ? 0 : 1,
      entity.supersededBy ?? null,
      entity.contentHash ?? null,
      this.serializeExtensionFields(entity),
      entityName,
    );
  }

  /**
   * Update multiple entities in a single transaction (S2 delta
   * persistence).
   *
   * Validates that every named entity exists **before** applying anything
   * (all-or-nothing, matching the atomicity of the previous
   * full-graph-save path). Emits `entity:updated` exactly once per entity
   * (with `previousValues`); no `graph:saved`.
   *
   * Timestamp semantics: an explicit `updates.lastModified` wins;
   * otherwise `options.timestamp`; otherwise the current time.
   *
   * @param batch - Per-entity partial updates
   * @param options - Optional shared timestamp for the batch
   * @returns The live updated entity objects (same order as `batch`)
   * @throws {EntityNotFoundError} If any named entity does not exist
   *   (checked before any mutation)
   */
  async updateEntities(
    batch: Array<{ name: string; updates: Partial<Entity> }>,
    options?: { timestamp?: string },
  ): Promise<Entity[]> {
    if (batch.length === 0) return [];
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      for (const { name } of batch) {
        if (!this.nameIndex.has(name)) {
          throw new EntityNotFoundError(name);
        }
      }

      const defaultTimestamp = options?.timestamp ?? new Date().toISOString();

      const prepared: Array<{
        entity: Entity;
        sanitized: Record<string, unknown>;
        updates: Partial<Entity>;
        previousValues: Partial<Entity>;
        lastModified: string;
        oldType: string;
      }> = [];

      for (const { name, updates } of batch) {
        const entity = this.nameIndex.get(name)!;
        const sanitized = sanitizeObject(updates as Record<string, unknown>);
        const lastModified =
          typeof sanitized.lastModified === 'string'
            ? sanitized.lastModified
            : defaultTimestamp;

        const previousValues: Partial<Entity> = {};
        for (const key of Object.keys(updates)) {
          if (key in entity) {
            (previousValues as Record<string, unknown>)[key] =
              (entity as unknown as Record<string, unknown>)[key];
          }
        }

        prepared.push({ entity, sanitized, updates, previousValues, lastModified, oldType: entity.entityType });
      }

      // Apply to cache, then write all rows in one transaction. On
      // transaction failure better-sqlite3 rolls the rows back; the cache
      // is restored from previousValues via the merged state being
      // recomputed on next load — in practice the transaction only fails
      // on I/O errors, matching the pre-change saveGraph failure mode.
      const tx = this.db.transaction(() => {
        for (const p of prepared) {
          Object.assign(p.entity, p.sanitized);
          p.entity.lastModified = p.lastModified;
          this.runEntityUpdateRow(p.entity, p.entity.name);
        }
      });
      tx();

      for (const p of prepared) {
        this.nameIndex.add(p.entity);
        if (p.updates.entityType && p.updates.entityType !== p.oldType) {
          this.typeIndex.updateType(p.entity.name, p.oldType, p.updates.entityType);
        }
        this.updateLowercaseCache(p.entity);
      }
      bumpEntityGeneration();

      this.pendingChanges += prepared.length;

      for (const p of prepared) {
        this.eventEmitter.emitEntityUpdated(p.entity.name, p.updates, p.previousValues);
      }

      return prepared.map(p => p.entity);
    });
  }

  /**
   * Delete entities with targeted row operations (S2 delta persistence).
   *
   * Runs one transaction that deletes the named entity rows, every
   * relation touching them, and their embedding rows (when the embeddings
   * table exists). Foreign keys are toggled OFF around the transaction to
   * preserve the historical cascade semantics of the previous
   * `saveGraph`-based delete path: children of a deleted parent keep
   * their (dangling) `parentId`, exactly as the JSONL backend does —
   * with FK ON, SQLite's `ON DELETE SET NULL` would silently null them
   * out, a behavior change. Relations are therefore deleted explicitly
   * rather than via the FK cascade. The FTS5 `entities_ad` trigger still
   * fires per deleted row, keeping the full-text index clean.
   *
   * Emits `entity:deleted` once per deleted entity and `relation:deleted`
   * once per cascaded relation; no `graph:saved`. Unknown names are
   * silently ignored; a call that deletes nothing performs no writes and
   * emits nothing.
   *
   * @param names - Entity names to delete
   * @returns The deleted entities and cascaded relations
   */
  async deleteEntities(
    names: string[],
  ): Promise<{ deletedEntities: Entity[]; deletedRelations: Relation[] }> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      const nameSet = new Set(names);
      const deletedEntities = this.cache!.entities.filter(e => nameSet.has(e.name));
      const deletedRelations = this.cache!.relations.filter(
        r => nameSet.has(r.from) || nameSet.has(r.to),
      );

      if (deletedEntities.length === 0 && deletedRelations.length === 0) {
        return { deletedEntities, deletedRelations };
      }

      const hasEmbeddings = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='embeddings'`)
        .get() !== undefined;

      // FK toggle must happen outside the transaction (PRAGMA is a no-op
      // inside one) — same pattern as saveGraph/renameEntity.
      this.db.pragma('foreign_keys = OFF');
      try {
        const deleteRelationsStmt = this.prepareCached(
          this.db,
          'DELETE FROM relations WHERE fromEntity = ? OR toEntity = ?',
        );
        const deleteEntityStmt = this.prepareCached(
          this.db,
          'DELETE FROM entities WHERE name = ?',
        );
        const tx = this.db.transaction(() => {
          for (const name of nameSet) {
            deleteRelationsStmt.run(name, name);
            deleteEntityStmt.run(name);
            if (hasEmbeddings) {
              // FK cascade is disabled while foreign_keys = OFF, so clean
              // embeddings explicitly.
              this.prepareCached(
                this.db!,
                'DELETE FROM embeddings WHERE entityName = ?',
              ).run(name);
            }
          }
        });
        tx();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }

      // Apply to cache + indexes incrementally (O(deleted))
      this.cache!.entities = this.cache!.entities.filter(e => !nameSet.has(e.name));
      this.cache!.relations = this.cache!.relations.filter(
        r => !nameSet.has(r.from) && !nameSet.has(r.to),
      );
      for (const e of deletedEntities) {
        this.nameIndex.remove(e.name);
        this.typeIndex.remove(e.name, e.entityType);
        this.lowercaseCache.delete(e.name);
      }
      for (const r of deletedRelations) {
        this.relationIndex.remove(r);
        this.relationKeyMap.delete(relationKeyOf(r));
      }

      if (deletedEntities.length > 0) bumpEntityGeneration();
      if (deletedRelations.length > 0) bumpRelationGeneration();

      this.pendingChanges++;

      for (const e of deletedEntities) {
        this.eventEmitter.emitEntityDeleted(e.name, e);
      }
      for (const r of deletedRelations) {
        this.eventEmitter.emitRelationDeleted(r.from, r.to, r.relationType);
      }

      return { deletedEntities, deletedRelations };
    });
  }

  /**
   * Delete relations by composite key with targeted row operations (S2
   * delta persistence).
   *
   * `options.touchEntities` bumps `lastModified` on the named entities in
   * the same transaction (preserving `RelationManager`'s historical
   * "affected entities get a timestamp bump" semantics); unknown names
   * are ignored.
   *
   * Emits `relation:deleted` once per actually-deleted relation and
   * `entity:updated` (changes = `{ lastModified }`) once per touched
   * entity; no `graph:saved`. A call that deletes nothing and touches
   * nothing performs no writes and emits nothing.
   *
   * @param keys - Relation keys (`from`/`to`/`relationType`) to delete
   * @param options - Optional entity-timestamp bump + shared timestamp
   * @returns The actually-deleted relations
   */
  async deleteRelations(
    keys: Array<Pick<Relation, 'from' | 'to' | 'relationType'>>,
    options?: { touchEntities?: string[]; timestamp?: string },
  ): Promise<Relation[]> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      const keySet = new Set(keys.map(relationKeyOf));
      const deletedRelations = this.cache!.relations.filter(r =>
        keySet.has(relationKeyOf(r)),
      );

      const timestamp = options?.timestamp ?? new Date().toISOString();
      const touchedEntities: Entity[] = [];
      const seenTouched = new Set<string>();
      for (const name of options?.touchEntities ?? []) {
        if (seenTouched.has(name)) continue;
        seenTouched.add(name);
        const entity = this.nameIndex.get(name);
        if (entity) touchedEntities.push(entity);
      }

      if (deletedRelations.length === 0 && touchedEntities.length === 0) {
        return deletedRelations;
      }

      const deleteStmt = this.prepareCached(
        this.db,
        'DELETE FROM relations WHERE fromEntity = ? AND toEntity = ? AND relationType = ?',
      );
      const touchStmt = this.prepareCached(
        this.db,
        'UPDATE entities SET lastModified = ? WHERE name = ?',
      );
      const tx = this.db.transaction(() => {
        for (const r of deletedRelations) {
          deleteStmt.run(r.from, r.to, r.relationType);
        }
        for (const entity of touchedEntities) {
          touchStmt.run(timestamp, entity.name);
        }
      });
      tx();

      const previousTimestamps = touchedEntities.map(e => e.lastModified);

      // Apply to cache + indexes incrementally
      if (deletedRelations.length > 0) {
        this.cache!.relations = this.cache!.relations.filter(
          r => !keySet.has(relationKeyOf(r)),
        );
        for (const r of deletedRelations) {
          this.relationIndex.remove(r);
          this.relationKeyMap.delete(relationKeyOf(r));
        }
      }
      for (const entity of touchedEntities) {
        entity.lastModified = timestamp;
      }

      if (deletedRelations.length > 0) bumpRelationGeneration();
      if (touchedEntities.length > 0) bumpEntityGeneration();

      this.pendingChanges++;

      for (const r of deletedRelations) {
        this.eventEmitter.emitRelationDeleted(r.from, r.to, r.relationType);
      }
      touchedEntities.forEach((entity, i) => {
        this.eventEmitter.emitEntityUpdated(
          entity.name,
          { lastModified: timestamp },
          { lastModified: previousTimestamps[i] },
        );
      });

      return deletedRelations;
    });
  }

  /**
   * Atomically rename an entity, rewriting every stored reference to the
   * old name inside a single SQLite transaction:
   * - `entities.name` (+ `lastModified` bump on the renamed row)
   * - `relations.fromEntity` / `relations.toEntity`
   * - other entities' `parentId`
   * - version-chain columns (`parentEntityName`, `rootEntityName`,
   *   `supersededBy` — all native columns, not JSON fields)
   * - `embeddings.entityName` (when the embeddings table exists)
   *
   * FTS5 stays in sync automatically: the `entities_au` AFTER UPDATE
   * trigger re-indexes each touched row (delete old values / insert new).
   *
   * Foreign keys are toggled OFF around the transaction (same pattern as
   * `saveGraph`): `relations.fromEntity/toEntity` and `entities.parentId`
   * reference `entities(name)` with no ON UPDATE action, so renaming the
   * parent key first would otherwise fail the FK check mid-flight.
   *
   * Referencing rows keep their own timestamps (a rename is a pure
   * reference rewrite; their content did not change).
   *
   * Does NOT emit entity events itself — `EntityManager.renameEntity`
   * emits `entity:renamed` + `entity:deleted` + `entity:created` after
   * the storage write succeeds (same division of responsibility as the
   * JSONL path). Emitting here as well would double-fire those events.
   * Unlike `GraphStorage.renameEntity` (which routes through
   * `saveGraphInternal` and therefore also emits `graph:saved` as an
   * implementation artifact of the full-file rewrite), this targeted SQL
   * transaction emits no `graph:saved` — no full-graph write happens.
   *
   * @param oldName - Current entity name (must exist)
   * @param newName - New entity name (must not exist)
   * @returns The renamed entity
   * @throws {EntityNotFoundError} If `oldName` does not exist
   * @throws {DuplicateEntityError} If `newName` already exists
   */
  async renameEntity(oldName: string, newName: string): Promise<Entity> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) throw new Error('Database not initialized');

      const entity = this.nameIndex.get(oldName);
      if (!entity) {
        throw new EntityNotFoundError(oldName);
      }
      if (this.nameIndex.has(newName)) {
        throw new DuplicateEntityError(newName);
      }

      const timestamp = new Date().toISOString();

      const hasEmbeddings = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='embeddings'`)
        .get() !== undefined;

      // FK toggle must happen outside the transaction (PRAGMA foreign_keys
      // is a no-op inside one).
      this.db.pragma('foreign_keys = OFF');
      try {
        const tx = this.db.transaction(() => {
          this.db!.prepare('UPDATE entities SET name = ?, lastModified = ? WHERE name = ?')
            .run(newName, timestamp, oldName);
          this.db!.prepare('UPDATE relations SET fromEntity = ? WHERE fromEntity = ?')
            .run(newName, oldName);
          this.db!.prepare('UPDATE relations SET toEntity = ? WHERE toEntity = ?')
            .run(newName, oldName);
          this.db!.prepare('UPDATE entities SET parentId = ? WHERE parentId = ?')
            .run(newName, oldName);
          this.db!.prepare('UPDATE entities SET parentEntityName = ? WHERE parentEntityName = ?')
            .run(newName, oldName);
          this.db!.prepare('UPDATE entities SET rootEntityName = ? WHERE rootEntityName = ?')
            .run(newName, oldName);
          this.db!.prepare('UPDATE entities SET supersededBy = ? WHERE supersededBy = ?')
            .run(newName, oldName);
          if (hasEmbeddings) {
            this.db!.prepare('UPDATE embeddings SET entityName = ? WHERE entityName = ?')
              .run(newName, oldName);
          }
        });
        tx();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }

      // Update the in-memory cache to mirror the committed transaction.
      entity.name = newName;
      entity.lastModified = timestamp;
      for (const e of this.cache!.entities) {
        if (e.parentId === oldName) e.parentId = newName;
        if (e.parentEntityName === oldName) e.parentEntityName = newName;
        if (e.rootEntityName === oldName) e.rootEntityName = newName;
        if (e.supersededBy === oldName) e.supersededBy = newName;
      }
      for (const r of this.cache!.relations) {
        if (r.from === oldName) r.from = newName;
        if (r.to === oldName) r.to = newName;
      }

      // Rebuild name/type indexes (key changed) and refresh caches.
      this.nameIndex.build(this.cache!.entities);
      this.typeIndex.build(this.cache!.entities);
      this.rebuildRelationIndexes(this.cache!.relations);
      this.lowercaseCache.delete(oldName);
      this.updateLowercaseCache(entity);
      clearAllSearchCaches();
      bumpEntityGeneration();
      bumpRelationGeneration();

      this.pendingChanges++;

      return entity;
    });
  }

  /**
   * Compact the storage (runs VACUUM to reclaim space).
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent operations.
   *
   * @returns Promise resolving when compaction is complete
   */
  async compact(): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.db) return;

      // Run SQLite VACUUM to reclaim space and defragment
      this.db.exec('VACUUM');

      // Rebuild FTS index for optimal search performance
      this.db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);

      this.pendingChanges = 0;
    });
  }

  /**
   * Clear any in-memory cache.
   */
  clearCache(): void {
    this.cache = null;
    this.nameIndex.clear();
    this.typeIndex.clear();
    this.lowercaseCache.clear();
    this.relationIndex.clear();
    this.relationKeyMap.clear();
    this.initialized = false;
    // Close the read pool first so its connections can't outlive the
    // writer connection (reproducible test re-init was leaking handles).
    this.closeReadPool();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ==================== Index Operations ====================

  /**
   * Get an entity by name in O(1) time.
   *
   * OPTIMIZED: Uses NameIndex for constant-time lookup.
   *
   * @param name - Entity name to look up
   * @returns Entity if found, undefined otherwise
   */
  getEntityByName(name: string): Entity | undefined {
    return this.nameIndex.get(name);
  }

  /**
   * Check if an entity exists by name in O(1) time.
   *
   * @param name - Entity name to check
   * @returns True if entity exists
   */
  hasEntity(name: string): boolean {
    return this.nameIndex.has(name);
  }

  /**
   * Get all entities of a given type in O(1) time.
   *
   * OPTIMIZED: Uses TypeIndex for constant-time lookup of entity names,
   * then uses NameIndex for O(1) entity retrieval.
   *
   * @param entityType - Entity type to filter by (case-insensitive)
   * @returns Array of entities with the given type
   */
  getEntitiesByType(entityType: string): Entity[] {
    const names = this.typeIndex.getNames(entityType);
    const entities: Entity[] = [];
    for (const name of names) {
      const entity = this.nameIndex.get(name);
      if (entity) {
        entities.push(entity);
      }
    }
    return entities;
  }

  /**
   * Get all unique entity types in the graph.
   *
   * @returns Array of unique entity types (lowercase)
   */
  getEntityTypes(): string[] {
    return this.typeIndex.getTypes();
  }

  /**
   * Get pre-computed lowercase data for an entity.
   *
   * @param entityName - Entity name to get lowercase data for
   * @returns LowercaseData if entity exists, undefined otherwise
   */
  getLowercased(entityName: string): LowercaseData | undefined {
    return this.lowercaseCache.get(entityName);
  }

  /**
   * Use the native contentHash index for exact MemoryEngine dedup.
   */
  getEntitiesByContentHash(contentHash: string): Entity[] {
    if (!this.db || !this.initialized) return [];
    const reader = this.pickReadConnection();
    const rows = this.prepareCached(
      reader,
      'SELECT * FROM entities WHERE contentHash = ?',
    ).all(contentHash) as EntityRow[];
    return rows.map(row => this.rowToEntity(row));
  }

  /**
   * Query only the rows belonging to one agent-memory session. The
   * expression matches idx_entities_session_created_at.
   */
  getSessionEntities(
    sessionId: string,
    options: {
      limit?: number;
      role?: 'user' | 'assistant' | 'system';
      order?: 'asc' | 'desc';
    } = {},
  ): Entity[] {
    if (!this.db || !this.initialized) return [];
    if (options.limit === 0) return [];

    const clauses = [`
      CASE
        WHEN json_valid(agentMetadata)
        THEN json_extract(agentMetadata, '$.sessionId')
      END = ?
    `];
    const params: Array<string | number> = [sessionId];
    if (options.role) {
      clauses.push(`
        CASE
          WHEN json_valid(observations)
          THEN json_extract(observations, '$[0]')
        END LIKE ?
      `);
      params.push(`[role=${options.role}] %`);
    }

    const order = options.order === 'desc' ? 'DESC' : 'ASC';
    let sql = `
      SELECT * FROM entities
      WHERE ${clauses.join(' AND ')}
      ORDER BY createdAt ${order}, rowid ${order}
    `;
    if (
      options.limit !== undefined
      && Number.isSafeInteger(options.limit)
      && options.limit > 0
    ) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const reader = this.pickReadConnection();
    const rows = this.prepareCached(reader, sql).all(...params) as EntityRow[];
    return rows.map(row => this.rowToEntity(row));
  }

  /**
   * Count session turns without materializing or sorting them.
   */
  countSessionEntities(sessionId: string): number {
    if (!this.db || !this.initialized) return 0;
    const reader = this.pickReadConnection();
    const row = this.prepareCached(reader, `
      SELECT COUNT(*) AS count
      FROM entities
      WHERE CASE
        WHEN json_valid(agentMetadata)
        THEN json_extract(agentMetadata, '$.sessionId')
      END = ?
    `).get(sessionId) as { count: number };
    return row.count;
  }

  // ==================== FTS5 Full-Text Search ====================

  /**
   * Perform full-text search using FTS5.
   *
   * @param query - Search query (supports FTS5 query syntax)
   * @returns Array of matching entity names with relevance scores
   */
  fullTextSearch(
    query: string,
    options: { limit?: number } = {},
  ): Array<{ name: string; score: number }> {
    if (!this.db || !this.initialized) return [];

    try {
      // Sanitize FTS5 special characters to prevent query injection and resource exhaustion
      const sanitized = query
        .replace(/["{}()^~:]/g, ' ')  // Remove FTS5 operators and column filter syntax
        .replace(/\bNEAR\b/gi, '')     // Remove NEAR operator
        .replace(/\bAND\b/gi, '')      // Remove AND operator
        .replace(/\bOR\b/gi, '')       // Remove OR operator
        .replace(/\bNOT\b/gi, '')      // Remove NOT operator
        .replace(/\*/g, '')            // Remove wildcard prefix operator
        .replace(/\s+/g, ' ')         // Collapse whitespace
        .trim();

      if (!sanitized) return [];
      // FTS5's whitespace default is AND, while MemoryJS lexical search
      // historically returns documents matching any query term. An explicit
      // OR preserves that candidate-retrieval behavior.
      const ftsQuery = sanitized
        .split(' ')
        .filter(Boolean)
        .map(term => `"${term.replace(/"/g, '""')}"`)
        .join(' OR ');
      if (!ftsQuery) return [];
      const requestedLimit = options.limit ?? 100;
      const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : 100;

      // Use FTS5 MATCH for full-text search with BM25 ranking. Reads check
      // out a pooled connection so they can run concurrently with writes
      // at the SQLite level (WAL mode).
      const reader = this.pickReadConnection();
      const stmt = this.prepareCached(reader, `
        SELECT name, bm25(entities_fts, 10, 5, 3, 1) as score
        FROM entities_fts
        WHERE entities_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `);

      const results = stmt.all(ftsQuery, limit) as Array<{ name: string; score: number }>;
      return results;
    } catch {
      // If FTS query fails (invalid syntax), fall back to empty results
      return [];
    }
  }

  /**
   * Perform a simple text search (LIKE-based, case-insensitive).
   *
   * @param searchTerm - Term to search for
   * @returns Array of matching entity names
   */
  simpleSearch(searchTerm: string): string[] {
    if (!this.db || !this.initialized) return [];

    // Escape LIKE wildcards to prevent matching manipulation
    const escaped = searchTerm.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    const reader = this.pickReadConnection();
    const stmt = this.prepareCached(reader, `
      SELECT name FROM entities
      WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR entityType LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR observations LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR tags LIKE ? ESCAPE '\\' COLLATE NOCASE
    `);

    const results = stmt.all(pattern, pattern, pattern, pattern) as Array<{ name: string }>;
    return results.map(r => r.name);
  }

  // ==================== Utility Operations ====================

  /**
   * Get the storage path/location.
   *
   * @returns The storage path
   */
  getFilePath(): string {
    return this.validatedDbFilePath;
  }

  /**
   * Get the current pending changes count.
   *
   * @returns Number of pending changes since last reset
   */
  getPendingAppends(): number {
    return this.pendingChanges;
  }

  /**
   * Force persistence to disk (no-op for better-sqlite3 as it writes immediately).
   *
   * @returns Promise resolving when persistence is complete
   */
  async flush(): Promise<void> {
    // better-sqlite3 writes to disk immediately, but we run a checkpoint for WAL mode
    if (this.db) {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    }
    this.pendingChanges = 0;
  }

  /**
   * Close the database connection (and any pooled read connections).
   */
  close(): void {
    // Drop advisor-managed indexes before tearing down so the file
    // doesn't accumulate orphan idx_advisor_* indexes across runs.
    if (this.partialIndexAdvisor.enabled && this.db) {
      try {
        this.partialIndexAdvisor.dropAll(this.db);
      } catch {
        // Best-effort — never block close on advisor cleanup.
      }
    }
    this.closeReadPool();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  /**
   * Initialise the read connection pool. Size comes from
   * `MEMORY_SQLITE_READ_POOL_SIZE` (default 4). A size of 0 or 1 means
   * "route reads through the writer connection" — the pool stays empty
   * and `pickReadConnection()` returns `this.db`.
   */
  private initReadPool(): void {
    const raw = process.env.MEMORY_SQLITE_READ_POOL_SIZE;
    const parsed = raw === undefined ? 4 : parseInt(raw, 10);
    const size = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;
    if (size <= 1) return; // Single-writer fallback; reads go through this.db.

    const Database = loadDatabaseCtor();
    for (let i = 0; i < size; i++) {
      const conn = new Database(this.validatedDbFilePath, { readonly: true });
      // Foreign keys are still meaningful on a read-only handle (for
      // referential integrity in compound queries). The journal_mode
      // pragma is intentionally NOT set here — it's a write-time setting
      // that the writer connection already established for the file.
      conn.pragma('foreign_keys = ON');
      this.readPool.push(conn);
    }
  }

  /**
   * Close every pooled read connection.
   */
  private closeReadPool(): void {
    for (const conn of this.readPool) {
      try {
        conn.close();
      } catch {
        // Best-effort close; ignore.
      }
    }
    this.readPool.length = 0;
    this.readPoolCursor = 0;
  }

  /**
   * Record a search-filter observation for the partial-index advisor.
   * No-op when `MEMORY_SQLITE_AUTO_INDEX` is unset (the advisor
   * self-disables). After every `partialIndexApplyEvery` recordings,
   * advisor recommendations are applied to the writer connection so
   * partial indexes track the live workload.
   *
   * Callers (typically `SearchManager`) invoke this with the filter
   * shape they're about to execute. Pre-existing in-memory filtering
   * is unaffected — partial indexes only accelerate lookups, never
   * change semantics.
   */
  recordFilter(observation: FilterObservation): void {
    if (!this.partialIndexAdvisor.enabled) return;
    this.partialIndexAdvisor.record(observation);
    this.partialIndexRecordings++;
    if (this.partialIndexRecordings % this.partialIndexApplyEvery === 0 && this.db) {
      // Defer the DDL via setImmediate so the calling search returns
      // before any CREATE INDEX runs. The advisor's apply() is
      // idempotent so a second call before the first finishes is safe.
      const dbRef = this.db;
      setImmediate(() => {
        try {
          this.partialIndexAdvisor.apply(dbRef);
        } catch (err) {
          logger.error('[SQLiteStorage] partial-index apply failed:', err);
        }
      });
    }
  }

  /**
   * Read-only snapshot of the advisor's current state — useful for
   * `ctx.diagnostics()` and tests.
   */
  partialIndexAdvisorSnapshot(): ReturnType<PartialIndexAdvisor['snapshot']> {
    return this.partialIndexAdvisor.snapshot();
  }

  /**
   * Pick a read connection. Round-robin across the pool; falls back to the
   * writer when the pool is empty (size 0 or 1, or pool not yet
   * initialised). Throws when the storage has not been initialised at all
   * — callers no longer need to pre-check `this.db` themselves.
   */
  private pickReadConnection(): DatabaseType {
    if (!this.initialized || !this.db) {
      throw new Error('SQLiteStorage not initialized — call ensureLoaded() first');
    }
    if (this.readPool.length === 0) {
      return this.db;
    }
    const conn = this.readPool[this.readPoolCursor]!;
    this.readPoolCursor = (this.readPoolCursor + 1) % this.readPool.length;
    return conn;
  }

  // ==================== Relation Index Operations ====================

  /**
   * Get all relations where the entity is the source (outgoing relations).
   *
   * OPTIMIZED: Uses SQLite index on fromEntity for O(log n) lookup.
   *
   * @param entityName - Entity name to look up outgoing relations for
   * @returns Array of relations where entity is the source
   */
  getRelationsFrom(entityName: string): Relation[] {
    if (this.cache) {
      return this.relationIndex.getRelationsFrom(entityName);
    }

    // Fall back to database query (Phase 1 Sprint 5: SELECT * for metadata)
    if (!this.db || !this.initialized) return [];
    const stmt = this.prepareCached(this.db, 'SELECT * FROM relations WHERE fromEntity = ?');
    const rows = stmt.all(entityName) as RelationRow[];
    return rows.map(row => this.rowToRelation(row));
  }

  /**
   * Get all relations where the entity is the target (incoming relations).
   *
   * OPTIMIZED: Uses SQLite index on toEntity for O(log n) lookup.
   *
   * @param entityName - Entity name to look up incoming relations for
   * @returns Array of relations where entity is the target
   */
  getRelationsTo(entityName: string): Relation[] {
    if (this.cache) {
      return this.relationIndex.getRelationsTo(entityName);
    }

    // Fall back to database query (Phase 1 Sprint 5: SELECT * for metadata)
    if (!this.db || !this.initialized) return [];
    const stmt = this.prepareCached(this.db, 'SELECT * FROM relations WHERE toEntity = ?');
    const rows = stmt.all(entityName) as RelationRow[];
    return rows.map(row => this.rowToRelation(row));
  }

  /**
   * Get all relations involving the entity (both incoming and outgoing).
   *
   * OPTIMIZED: Phase 4 Sprint 1 - Uses bidirectional cache for O(1) repeated lookups.
   *
   * @param entityName - Entity name to look up all relations for
   * @returns Array of all relations involving the entity
   */
  getRelationsFor(entityName: string): Relation[] {
    if (this.cache) {
      return this.relationIndex.getRelationsFor(entityName);
    }

    if (!this.db || !this.initialized) return [];
    const stmt = this.prepareCached(
      this.db,
      'SELECT * FROM relations WHERE fromEntity = ? OR toEntity = ?',
    );
    const rows = stmt.all(entityName, entityName) as RelationRow[];
    return rows.map(row => this.rowToRelation(row));
  }

  /**
   * Check if an entity has any relations.
   *
   * @param entityName - Entity name to check
   * @returns True if entity has any relations
   */
  hasRelations(entityName: string): boolean {
    if (this.cache) {
      return this.relationIndex.hasRelations(entityName);
    }

    // Fall back to database query
    if (!this.db || !this.initialized) return false;
    const stmt = this.prepareCached(
      this.db,
      'SELECT 1 FROM relations WHERE fromEntity = ? OR toEntity = ? LIMIT 1'
    );
    const row = stmt.get(entityName, entityName);
    return row !== undefined;
  }

  // ==================== Embedding Storage (Phase 4 Sprint 11) ====================

  /**
   * Phase 4 Sprint 11: Ensure embeddings table exists.
   *
   * Creates the embeddings table if it doesn't exist.
   * Separate table from entities to avoid schema migration complexity.
   */
  private ensureEmbeddingsTable(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        entityName TEXT PRIMARY KEY REFERENCES entities(name) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        embeddingModel TEXT NOT NULL,
        embeddingUpdatedAt TEXT NOT NULL,
        dimensions INTEGER NOT NULL
      )
    `);

    // Index for quick lookup by model
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_model ON embeddings(embeddingModel)`);
  }

  /**
   * Phase 4 Sprint 11: Store an embedding for an entity.
   *
   * @param entityName - Name of the entity
   * @param vector - Embedding vector
   * @param model - Model name used for the embedding
   */
  storeEmbedding(entityName: string, vector: number[], model: string): void {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    this.ensureEmbeddingsTable();

    // Convert to Float32Array for efficient storage
    const buffer = Buffer.from(new Float32Array(vector).buffer);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (entityName, embedding, embeddingModel, embeddingUpdatedAt, dimensions)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(entityName, buffer, model, new Date().toISOString(), vector.length);
  }

  /**
   * Phase 4 Sprint 11: Get an embedding for an entity.
   *
   * @param entityName - Name of the entity
   * @returns Embedding vector if found, null otherwise
   */
  getEmbedding(entityName: string): number[] | null {
    if (!this.db || !this.initialized) return null;

    try {
      this.ensureEmbeddingsTable();

      const stmt = this.db.prepare(`SELECT embedding FROM embeddings WHERE entityName = ?`);
      const row = stmt.get(entityName) as { embedding: Buffer } | undefined;

      if (!row) return null;

      // Convert from Buffer to number array
      const float32Array = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
      return Array.from(float32Array);
    } catch {
      return null;
    }
  }

  /**
   * Phase 4 Sprint 11: Load all embeddings from storage.
   *
   * @returns Array of [entityName, vector] pairs
   */
  async loadAllEmbeddings(): Promise<[string, number[]][]> {
    if (!this.db || !this.initialized) return [];

    try {
      this.ensureEmbeddingsTable();

      const stmt = this.db.prepare(`SELECT entityName, embedding FROM embeddings`);
      const rows = stmt.all() as Array<{ entityName: string; embedding: Buffer }>;

      return rows.map(row => {
        const float32Array = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
        return [row.entityName, Array.from(float32Array)] as [string, number[]];
      });
    } catch {
      return [];
    }
  }

  /**
   * Phase 4 Sprint 11: Remove an embedding for an entity.
   *
   * @param entityName - Name of the entity
   */
  removeEmbedding(entityName: string): void {
    if (!this.db || !this.initialized) return;

    try {
      this.ensureEmbeddingsTable();
      const stmt = this.db.prepare(`DELETE FROM embeddings WHERE entityName = ?`);
      stmt.run(entityName);
    } catch {
      // Ignore errors if table doesn't exist
    }
  }

  /**
   * Phase 4 Sprint 11: Clear all embeddings from storage.
   */
  clearAllEmbeddings(): void {
    if (!this.db || !this.initialized) return;

    try {
      this.ensureEmbeddingsTable();
      this.db.exec(`DELETE FROM embeddings`);
    } catch {
      // Ignore errors if table doesn't exist
    }
  }

  /**
   * Phase 4 Sprint 11: Check if an entity has an embedding.
   *
   * @param entityName - Name of the entity
   * @returns True if embedding exists
   */
  hasEmbedding(entityName: string): boolean {
    if (!this.db || !this.initialized) return false;

    try {
      this.ensureEmbeddingsTable();
      const stmt = this.db.prepare(`SELECT 1 FROM embeddings WHERE entityName = ? LIMIT 1`);
      const row = stmt.get(entityName);
      return row !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Phase 4 Sprint 11: Get embedding statistics.
   *
   * @returns Stats about stored embeddings
   */
  getEmbeddingStats(): { count: number; models: string[] } {
    if (!this.db || !this.initialized) {
      return { count: 0, models: [] };
    }

    try {
      this.ensureEmbeddingsTable();

      const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM embeddings`).get() as { count: number };
      const modelRows = this.db.prepare(`SELECT DISTINCT embeddingModel FROM embeddings`).all() as Array<{ embeddingModel: string }>;

      return {
        count: countRow.count,
        models: modelRows.map(r => r.embeddingModel),
      };
    } catch {
      return { count: 0, models: [] };
    }
  }
}

// ==================== Type Definitions for Database Rows ====================

interface EntityRow {
  name: string;
  /** Stable opaque entity identifier (survives renames). */
  id: string | null;
  entityType: string;
  observations: string;
  tags: string | null;
  importance: number | null;
  parentId: string | null;
  createdAt: string;
  lastModified: string;
  // v1.8.0: version chain and projectId fields
  projectId: string | null;
  version: number | null;
  parentEntityName: string | null;
  rootEntityName: string | null;
  isLatest: number | null;
  supersededBy: string | null;
  // v1.11.0: contentHash + AgentEntity-extension JSON blob
  contentHash: string | null;
  agentMetadata: string | null;
}

interface RelationRow {
  fromEntity: string;
  toEntity: string;
  relationType: string;
  createdAt: string;
  lastModified: string;
  // Phase 1 Sprint 5: Metadata columns
  weight: number | null;
  confidence: number | null;
  properties: string | null;
  metadata: string | null;
}
