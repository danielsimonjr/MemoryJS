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

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { Mutex } from 'async-mutex';
import type { KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData } from '../types/index.js';
import { clearAllSearchCaches } from '../utils/searchCache.js';
import { NameIndex, TypeIndex } from '../utils/indexes.js';
import { sanitizeObject, validateFilePath } from '../utils/index.js';

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
   * SQLite database instance.
   */
  private db: DatabaseType | null = null;

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
   * Phase 4 Sprint 1: Bidirectional relation cache for O(1) repeated lookups.
   * Maps entity name -> all relations involving that entity (both incoming and outgoing).
   */
  private bidirectionalRelationCache: Map<string, Relation[]> = new Map();

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
    // Security: Validate path to prevent path traversal attacks
    this.validatedDbFilePath = validateFilePath(dbFilePath);
  }

  /**
   * Initialize the database connection and schema.
   */
  private initialize(): void {
    if (this.initialized) return;

    // Open database (creates file if it doesn't exist)
    this.db = new Database(this.validatedDbFilePath);

    // Enable foreign keys and WAL mode for better performance
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');

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

    // Entities table with referential integrity for parentId
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT,
        importance INTEGER,
        parentId TEXT REFERENCES entities(name) ON DELETE SET NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL
      )
    `);

    // Relations table with referential integrity (CASCADE delete)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        fromEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        toEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        relationType TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        PRIMARY KEY (fromEntity, toEntity, relationType)
      )
    `);

    // Indexes for fast lookups
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(entityType)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_parent ON entities(parentId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_from ON relations(fromEntity)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_to ON relations(toEntity)`);

    // Phase 4 Sprint 1: Additional indexes for range queries (O(n) -> O(log n))
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_importance ON entities(importance)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_lastmodified ON entities(lastModified)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_createdat ON entities(createdAt)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relation_type ON relations(relationType)`);

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
  }

  /**
   * Convert a database row to an Entity object.
   */
  private rowToEntity(row: EntityRow): Entity {
    return {
      name: row.name,
      entityType: row.entityType,
      observations: JSON.parse(row.observations),
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      importance: row.importance ?? undefined,
      parentId: row.parentId ?? undefined,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    };
  }

  /**
   * Convert a database row to a Relation object.
   */
  private rowToRelation(row: RelationRow): Relation {
    return {
      from: row.fromEntity,
      to: row.toEntity,
      relationType: row.relationType,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    };
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
   * Phase 4 Sprint 1: Invalidate bidirectional relation cache for an entity.
   *
   * @param entityName - Entity name to invalidate cache for
   */
  private invalidateBidirectionalCache(entityName: string): void {
    this.bidirectionalRelationCache.delete(entityName);
  }

  /**
   * Phase 4 Sprint 1: Clear the entire bidirectional relation cache.
   */
  private clearBidirectionalCache(): void {
    this.bidirectionalRelationCache.clear();
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

      // Use transaction for atomicity
      const transaction = this.db.transaction(() => {
        // Clear existing data
        this.db!.exec('DELETE FROM relations');
        this.db!.exec('DELETE FROM entities');

        // Insert all entities
        const entityStmt = this.db!.prepare(`
          INSERT INTO entities (name, entityType, observations, tags, importance, parentId, createdAt, lastModified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const entity of graph.entities) {
          entityStmt.run(
            entity.name,
            entity.entityType,
            JSON.stringify(entity.observations),
            entity.tags ? JSON.stringify(entity.tags) : null,
            entity.importance ?? null,
            entity.parentId ?? null,
            entity.createdAt || new Date().toISOString(),
            entity.lastModified || new Date().toISOString(),
          );
        }

        // Insert all relations
        const relationStmt = this.db!.prepare(`
          INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const relation of graph.relations) {
          relationStmt.run(
            relation.from,
            relation.to,
            relation.relationType,
            relation.createdAt || new Date().toISOString(),
            relation.lastModified || new Date().toISOString(),
          );
        }
      });

      transaction();

      // Re-enable foreign keys for future operations
      this.db.pragma('foreign_keys = ON');

      // Update cache
      this.cache = graph;
      this.lowercaseCache.clear();
      for (const entity of graph.entities) {
        this.updateLowercaseCache(entity);
      }

      // Rebuild indexes
      this.nameIndex.build(graph.entities);
      this.typeIndex.build(graph.entities);

      this.pendingChanges = 0;

      // Clear search caches
      clearAllSearchCaches();

      // Phase 4 Sprint 1: Clear bidirectional relation cache on full save
      this.clearBidirectionalCache();
    });
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

      // Use INSERT OR REPLACE to handle updates
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO entities (name, entityType, observations, tags, importance, parentId, createdAt, lastModified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        entity.name,
        entity.entityType,
        JSON.stringify(entity.observations),
        entity.tags ? JSON.stringify(entity.tags) : null,
        entity.importance ?? null,
        entity.parentId ?? null,
        entity.createdAt || new Date().toISOString(),
        entity.lastModified || new Date().toISOString(),
      );

      // Update cache
      const existingIndex = this.cache!.entities.findIndex(e => e.name === entity.name);
      if (existingIndex >= 0) {
        this.cache!.entities[existingIndex] = entity;
      } else {
        this.cache!.entities.push(entity);
      }

      // Update indexes
      this.nameIndex.add(entity);
      this.typeIndex.add(entity);
      this.updateLowercaseCache(entity);
      clearAllSearchCaches();

      this.pendingChanges++;
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

      // Use INSERT OR REPLACE to handle updates
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        relation.from,
        relation.to,
        relation.relationType,
        relation.createdAt || new Date().toISOString(),
        relation.lastModified || new Date().toISOString(),
      );

      // Update cache
      const existingIndex = this.cache!.relations.findIndex(
        r => r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType
      );
      if (existingIndex >= 0) {
        this.cache!.relations[existingIndex] = relation;
      } else {
        this.cache!.relations.push(relation);
      }

      clearAllSearchCaches();

      // Phase 4 Sprint 1: Invalidate bidirectional cache for both entities
      this.invalidateBidirectionalCache(relation.from);
      this.invalidateBidirectionalCache(relation.to);

      this.pendingChanges++;
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

      // Apply updates to cached entity (sanitized to prevent prototype pollution)
      Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
      entity.lastModified = new Date().toISOString();

      // Update in database
      const stmt = this.db.prepare(`
        UPDATE entities SET
          entityType = ?,
          observations = ?,
          tags = ?,
          importance = ?,
          parentId = ?,
          lastModified = ?
        WHERE name = ?
      `);

      stmt.run(
        entity.entityType,
        JSON.stringify(entity.observations),
        entity.tags ? JSON.stringify(entity.tags) : null,
        entity.importance ?? null,
        entity.parentId ?? null,
        entity.lastModified,
        entityName,
      );

      // Update indexes
      this.nameIndex.add(entity); // Update reference
      if (updates.entityType && updates.entityType !== oldType) {
        this.typeIndex.updateType(entityName, oldType, updates.entityType);
      }
      this.updateLowercaseCache(entity);
      clearAllSearchCaches();

      this.pendingChanges++;

      return true;
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
    // Phase 4 Sprint 1: Clear bidirectional relation cache
    this.bidirectionalRelationCache.clear();
    this.initialized = false;
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

  // ==================== FTS5 Full-Text Search ====================

  /**
   * Perform full-text search using FTS5.
   *
   * @param query - Search query (supports FTS5 query syntax)
   * @returns Array of matching entity names with relevance scores
   */
  fullTextSearch(query: string): Array<{ name: string; score: number }> {
    if (!this.db || !this.initialized) return [];

    try {
      // Use FTS5 MATCH for full-text search with BM25 ranking
      const stmt = this.db.prepare(`
        SELECT name, bm25(entities_fts, 10, 5, 3, 1) as score
        FROM entities_fts
        WHERE entities_fts MATCH ?
        ORDER BY score
        LIMIT 100
      `);

      const results = stmt.all(query) as Array<{ name: string; score: number }>;
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

    const pattern = `%${searchTerm}%`;
    const stmt = this.db.prepare(`
      SELECT name FROM entities
      WHERE name LIKE ? COLLATE NOCASE
         OR entityType LIKE ? COLLATE NOCASE
         OR observations LIKE ? COLLATE NOCASE
         OR tags LIKE ? COLLATE NOCASE
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
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
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
    // Check cache first
    if (this.cache) {
      return this.cache.relations.filter(r => r.from === entityName);
    }

    // Fall back to database query
    if (!this.db || !this.initialized) return [];
    const stmt = this.db.prepare(
      'SELECT fromEntity, toEntity, relationType, createdAt, lastModified FROM relations WHERE fromEntity = ?'
    );
    const rows = stmt.all(entityName) as RelationRow[];
    return rows.map(row => ({
      from: row.fromEntity,
      to: row.toEntity,
      relationType: row.relationType,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    }));
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
    // Check cache first
    if (this.cache) {
      return this.cache.relations.filter(r => r.to === entityName);
    }

    // Fall back to database query
    if (!this.db || !this.initialized) return [];
    const stmt = this.db.prepare(
      'SELECT fromEntity, toEntity, relationType, createdAt, lastModified FROM relations WHERE toEntity = ?'
    );
    const rows = stmt.all(entityName) as RelationRow[];
    return rows.map(row => ({
      from: row.fromEntity,
      to: row.toEntity,
      relationType: row.relationType,
      createdAt: row.createdAt,
      lastModified: row.lastModified,
    }));
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
    // Phase 4 Sprint 1: Check bidirectional cache first for O(1) repeated lookups
    const cached = this.bidirectionalRelationCache.get(entityName);
    if (cached !== undefined) {
      return cached;
    }

    // Check main cache and compute result
    let relations: Relation[];
    if (this.cache) {
      relations = this.cache.relations.filter(r => r.from === entityName || r.to === entityName);
    } else if (this.db && this.initialized) {
      // Fall back to database query
      const stmt = this.db.prepare(
        'SELECT fromEntity, toEntity, relationType, createdAt, lastModified FROM relations WHERE fromEntity = ? OR toEntity = ?'
      );
      const rows = stmt.all(entityName, entityName) as RelationRow[];
      relations = rows.map(row => ({
        from: row.fromEntity,
        to: row.toEntity,
        relationType: row.relationType,
        createdAt: row.createdAt,
        lastModified: row.lastModified,
      }));
    } else {
      return [];
    }

    // Cache the result for O(1) subsequent lookups
    this.bidirectionalRelationCache.set(entityName, relations);
    return relations;
  }

  /**
   * Check if an entity has any relations.
   *
   * @param entityName - Entity name to check
   * @returns True if entity has any relations
   */
  hasRelations(entityName: string): boolean {
    // Check cache first
    if (this.cache) {
      return this.cache.relations.some(r => r.from === entityName || r.to === entityName);
    }

    // Fall back to database query
    if (!this.db || !this.initialized) return false;
    const stmt = this.db.prepare(
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
  entityType: string;
  observations: string;
  tags: string | null;
  importance: number | null;
  parentId: string | null;
  createdAt: string;
  lastModified: string;
}

interface RelationRow {
  fromEntity: string;
  toEntity: string;
  relationType: string;
  createdAt: string;
  lastModified: string;
}
