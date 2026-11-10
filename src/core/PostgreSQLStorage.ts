/**
 * PostgreSQL-backed graph storage.
 *
 * Implements `IGraphStorage` against a PostgreSQL database. The schema mirrors
 * the JSONL on-disk shape: `entities` and `relations` tables with first-class
 * columns for the well-known `Entity` fields and a JSONB `extra` column for
 * v2.1.0 subclass-manager records (`heuristicRecord`, `decisionRecord`,
 * `projectContextRecord`, `toolAffordanceRecord`, `exclusionRule`,
 * `prospectiveRecord`, `failureRecord`, `planRecord`, `reflectionRecord`).
 *
 * Connection model: the constructor takes a connection-string `path` (a
 * full Postgres URL like `postgres://user:pass@host:5432/db`). The first
 * read or write call lazily creates a `pg.Pool` and runs `init()` to ensure
 * the schema exists. `pg` is an **optional peer dependency** — users only
 * install it if they want the PostgreSQL backend. A clear error message is
 * surfaced if `MEMORY_STORAGE_TYPE=postgres` is requested without the
 * package installed.
 *
 * Cache strategy: same as SQLiteStorage — the in-memory `KnowledgeGraph`
 * cache is hydrated by `loadGraph()` and the synchronous `IGraphStorage`
 * methods (`getEntityByName`, `getRelationsFor`, etc.) read from it.
 * Mutations flow through `appendEntity` / `updateEntity` and refresh the
 * cache write-through. Out-of-process writers are NOT supported in v1 —
 * `clearCache()` plus a fresh `loadGraph()` is the manual recovery path.
 *
 * Search uses PostgreSQL tsvector indexes and ts_rank scoring.
 *
 * @module core/PostgreSQLStorage
 */

import { borrowGraphView, deepCopyPlain } from '../utils/graphCopy.js';
import { computeLowercase } from '../utils/indexes.js';
import { logger } from '../utils/logger.js';
import type {
  Entity,
  Relation,
  IGraphStorage,
  KnowledgeGraph,
  ReadonlyKnowledgeGraph,
  LowercaseData,
} from '../types/index.js';

/**
 * Minimal `pg` shape used here. Declared inline so the file doesn't import
 * `@types/pg` (which would fail at typecheck time when `pg` isn't installed).
 * Dynamic import handles the runtime side.
 */
interface PgQueryResult<R = unknown> {
  rows: R[];
  rowCount: number | null;
}
interface PgQueryable {
  query<R = unknown>(text: string, params?: unknown[]): Promise<PgQueryResult<R>>;
}
interface PgPoolClient extends PgQueryable {
  release(): void;
}
interface PgPool extends PgQueryable {
  end(): Promise<void>;
  /** Checks out one connection; needed for a multi-statement transaction. */
  connect?(): Promise<PgPoolClient>;
}
interface PgPoolConstructor {
  new (config: { connectionString: string }): PgPool;
}

/**
 * Columns we map first-class. Anything else from the v2.1.0 subclass-manager
 * record fields lands in the JSONB `extra` column.
 */
const ENTITY_COLUMNS = [
  'name', 'entity_type', 'observations', 'parent_id', 'tags', 'importance',
  'created_at', 'last_modified', 'ttl', 'confidence', 'project_id', 'version',
  'parent_entity_name', 'root_entity_name', 'is_latest', 'superseded_by',
  'content_hash', 'valid_from', 'valid_until', 'observation_meta',
  'lifecycle_status', 'extra',
] as const;

// Conservative cap below PostgreSQL's 65,535 bind-parameter limit. Bounded
// batches also avoid constructing unbounded SQL strings during large imports.
const MAX_INSERT_PARAMETERS = 60_000;
const MAX_INSERT_ROWS = 1_000;

const RELATION_COLUMNS = ['from_name', 'to_name', 'relation_type', 'metadata', 'created_at',
  'last_modified', 'weight', 'confidence', 'properties', 'extra'] as const;

const FIRST_CLASS_RELATION_KEYS = new Set(['from', 'to', 'relationType', 'metadata', 'createdAt',
  'lastModified', 'weight', 'confidence', 'properties']);
const UNSAFE_EXTENSION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const FIRST_CLASS_ENTITY_KEYS = new Set<string>([
  'name', 'entityType', 'observations', 'parentId', 'tags', 'importance',
  'createdAt', 'lastModified', 'ttl', 'confidence', 'projectId', 'version',
  'parentEntityName', 'rootEntityName', 'isLatest', 'supersededBy',
  'contentHash', 'validFrom', 'validUntil', 'observationMeta',
  'lifecycleStatus',
]);

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS entities (
  name TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  observations TEXT[] NOT NULL DEFAULT '{}',
  parent_id TEXT,
  tags TEXT[],
  importance NUMERIC(4, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW(),
  ttl INTEGER,
  confidence NUMERIC(4, 3),
  project_id TEXT,
  version INTEGER,
  parent_entity_name TEXT,
  root_entity_name TEXT,
  is_latest BOOLEAN,
  superseded_by TEXT,
  content_hash TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  observation_meta JSONB,
  lifecycle_status TEXT,
  extra JSONB
);

CREATE INDEX IF NOT EXISTS idx_entities_entity_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_project_id ON entities(project_id);
CREATE INDEX IF NOT EXISTS idx_entities_content_hash ON entities(content_hash);
CREATE INDEX IF NOT EXISTS idx_entities_tags_gin ON entities USING GIN(tags);

-- v2.8.0 — generated tsvector column for full-text search.
-- name is weighted A (highest), observations B, tags C. PostgreSQL 12+
-- supports GENERATED ALWAYS AS ... STORED; the DO block makes the column
-- add idempotent on older + newer servers without requiring CREATE OR
-- REPLACE semantics on ALTER.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entities' AND column_name = 'fts_vector'
  ) THEN
    ALTER TABLE entities ADD COLUMN fts_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', name), 'A') ||
        setweight(to_tsvector('english', coalesce(array_to_string(observations, ' '), '')), 'B') ||
        setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entities_fts_gin ON entities USING GIN(fts_vector);

CREATE TABLE IF NOT EXISTS relations (
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  PRIMARY KEY (from_name, to_name, relation_type)
);

ALTER TABLE relations ADD COLUMN IF NOT EXISTS last_modified TIMESTAMPTZ;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS properties JSONB;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS extra JSONB;

CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_name);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
`;

/**
 * PostgreSQL-backed `IGraphStorage`. Schema is created on first use.
 *
 * @example
 * ```typescript
 * const storage = new PostgreSQLStorage('postgres://user:pass@host:5432/db');
 * await storage.ensureLoaded();
 * await storage.appendEntity({ name: 'X', entityType: 'note', observations: [] });
 * ```
 */
export class PostgreSQLStorage implements IGraphStorage {
  private readonly connectionString: string;
  private pool: PgPool | null = null;
  private cache: KnowledgeGraph | null = null;
  private nameIndex = new Map<string, Entity>();
  private entityPositions = new Map<string, number>();
  private typeIndex = new Map<string, Set<string>>();
  private lowercaseCache = new Map<string, LowercaseData>();
  private relationKeys = new Set<string>();
  private outgoingRelations = new Map<string, Relation[]>();
  private incomingRelations = new Map<string, Relation[]>();
  private pendingAppends = 0;
  private schemaInitPromise: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  // ==================== Connection management ====================

  /**
   * Get or lazily-construct the `pg.Pool`. Throws a friendly error if
   * the `pg` package isn't installed.
   */
  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    let pgModule: { Pool: PgPoolConstructor };
    try {
      // Dynamic import keeps the dep optional. Bundler-friendly when the
      // user opts into the postgres backend; silent for everyone else.
      // The cast is necessary because `pg` isn't declared in this package's
      // dependencies — users install it themselves when they pick the
      // postgres backend.
      // @ts-expect-error -- `pg` is an optional peer dependency
      pgModule = (await import('pg')) as { Pool: PgPoolConstructor };
    } catch {
      throw new Error(
        "The 'pg' package is required for the PostgreSQL backend but is not installed. " +
        "Run: npm install pg @types/pg",
      );
    }
    this.pool = new pgModule.Pool({ connectionString: this.connectionString });
    return this.pool;
  }

  /**
   * Run schema DDL idempotently. Called from `ensureLoaded`.
   */
  private async initSchema(): Promise<void> {
    if (this.schemaInitPromise) return this.schemaInitPromise;
    this.schemaInitPromise = (async () => {
      const pool = await this.getPool();
      await pool.query(SCHEMA_DDL);
    })();
    return this.schemaInitPromise;
  }

  // ==================== Row ⇄ Entity / Relation mapping ====================

  private entityToRow(entity: Entity): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(entity)) {
      if (!FIRST_CLASS_ENTITY_KEYS.has(key) && !UNSAFE_EXTENSION_KEYS.has(key)) {
        extra[key] = (entity as unknown as Record<string, unknown>)[key];
      }
    }
    return {
      name: entity.name,
      entity_type: entity.entityType,
      observations: entity.observations,
      parent_id: entity.parentId ?? null,
      tags: entity.tags ?? null,
      importance: entity.importance ?? null,
      created_at: entity.createdAt ?? null,
      last_modified: entity.lastModified ?? null,
      ttl: entity.ttl ?? null,
      confidence: entity.confidence ?? null,
      project_id: entity.projectId ?? null,
      version: entity.version ?? null,
      parent_entity_name: entity.parentEntityName ?? null,
      root_entity_name: entity.rootEntityName ?? null,
      is_latest: entity.isLatest ?? null,
      superseded_by: entity.supersededBy ?? null,
      content_hash: entity.contentHash ?? null,
      valid_from: entity.validFrom ?? null,
      valid_until: entity.validUntil ?? null,
      observation_meta: entity.observationMeta ?? null,
      lifecycle_status: entity.lifecycleStatus ?? null,
      extra: Object.keys(extra).length > 0 ? extra : null,
    };
  }

  private rowToEntity(row: Record<string, unknown>): Entity {
    const entity: Entity = {
      name: columnText(row.name),
      entityType: columnText(row.entity_type),
      observations: Array.isArray(row.observations) ? row.observations as string[] : [],
    };
    if (row.parent_id != null) entity.parentId = columnText(row.parent_id);
    if (Array.isArray(row.tags)) entity.tags = row.tags as string[];
    if (row.importance != null) entity.importance = Number(row.importance);
    if (row.created_at != null) entity.createdAt = columnIso(row.created_at);
    if (row.last_modified != null) entity.lastModified = columnIso(row.last_modified);
    if (row.ttl != null) entity.ttl = Number(row.ttl);
    if (row.confidence != null) entity.confidence = Number(row.confidence);
    if (row.project_id != null) entity.projectId = columnText(row.project_id);
    if (row.version != null) entity.version = Number(row.version);
    if (row.parent_entity_name != null) entity.parentEntityName = columnText(row.parent_entity_name);
    if (row.root_entity_name != null) entity.rootEntityName = columnText(row.root_entity_name);
    if (row.is_latest != null) entity.isLatest = Boolean(row.is_latest);
    if (row.superseded_by != null) entity.supersededBy = columnText(row.superseded_by);
    if (row.content_hash != null) entity.contentHash = columnText(row.content_hash);
    if (row.valid_from != null) entity.validFrom = columnIso(row.valid_from);
    if (row.valid_until != null) entity.validUntil = columnIso(row.valid_until);
    if (row.observation_meta != null) {
      entity.observationMeta = row.observation_meta as Entity['observationMeta'];
    }
    if (row.lifecycle_status != null) {
      entity.lifecycleStatus = columnText(row.lifecycle_status) as Entity['lifecycleStatus'];
    }
    mergeExtensionFields(entity, row.extra, FIRST_CLASS_ENTITY_KEYS);
    return entity;
  }

  private rowToRelation(row: Record<string, unknown>): Relation {
    const relation: Relation = {
      from: String(row.from_name),
      to: String(row.to_name),
      relationType: String(row.relation_type),
    };
    if (row.metadata != null) relation.metadata = row.metadata as Relation['metadata'];
    if (row.properties != null) relation.properties = row.properties as Relation['properties'];
    if (row.weight != null) relation.weight = Number(row.weight);
    if (row.confidence != null) relation.confidence = Number(row.confidence);
    if (row.created_at != null) relation.createdAt = columnIso(row.created_at);
    if (row.last_modified != null) relation.lastModified = columnIso(row.last_modified);
    mergeExtensionFields(relation, row.extra, FIRST_CLASS_RELATION_KEYS);
    return relation;
  }

  // ==================== Cache management ====================

  private rebuildIndexes(graph: KnowledgeGraph): void {
    this.nameIndex.clear();
    this.entityPositions.clear();
    this.typeIndex.clear();
    this.lowercaseCache.clear();
    this.relationKeys.clear();
    this.outgoingRelations.clear();
    this.incomingRelations.clear();
    graph.entities.forEach((entity, position) => {
      this.entityPositions.set(entity.name, position);
      this.indexEntity(entity);
    });
    for (const r of graph.relations) {
      this.relationKeys.add(relationCacheKey(r));
      const outArr = this.outgoingRelations.get(r.from) ?? [];
      outArr.push(r);
      this.outgoingRelations.set(r.from, outArr);
      const inArr = this.incomingRelations.get(r.to) ?? [];
      inArr.push(r);
      this.incomingRelations.set(r.to, inArr);
    }
  }

  /** Refresh derived indexes after a successful database write. */
  private indexEntity(entity: Entity): void {
    const previous = this.nameIndex.get(entity.name);
    if (previous && previous.entityType !== entity.entityType) {
      const names = this.typeIndex.get(previous.entityType);
      names?.delete(entity.name);
      if (names?.size === 0) this.typeIndex.delete(previous.entityType);
    }
    this.nameIndex.set(entity.name, entity);
    let names = this.typeIndex.get(entity.entityType);
    if (!names) {
      names = new Set();
      this.typeIndex.set(entity.entityType, names);
    }
    names.add(entity.name);
    this.lowercaseCache.set(entity.name, computeLowercase(entity));
  }

  private cacheEntity(entity: Entity): void {
    if (!this.cache) return;
    const position = this.entityPositions.get(entity.name);
    if (position !== undefined) this.cache.entities[position] = entity;
    else {
      this.entityPositions.set(entity.name, this.cache.entities.length);
      this.cache.entities.push(entity);
    }
    this.indexEntity(entity);
  }

  // ==================== IGraphStorage — read ====================

  /**
   * Load the knowledge graph (read-only access).
   *
   * Ownership: the result is a READ-ONLY BORROWED VIEW. Do not mutate
   * it or any nested object, and do not keep it across writes. In
   * production it is the live cache (O(1), no copy). Outside production
   * (`NODE_ENV !== 'production'`) it is a deep-frozen copy, so a mutation
   * throws a TypeError. To change data, use getGraphForMutation().
   */
  async loadGraph(): Promise<ReadonlyKnowledgeGraph> {
    await this.ensureLoaded();
    return borrowGraphView(this.cache as ReadonlyKnowledgeGraph);
  }

  /** Get a fully independent deep copy of the graph for write operations. */
  async getGraphForMutation(): Promise<KnowledgeGraph> {
    await this.ensureLoaded();
    return deepCopyPlain(this.cache as KnowledgeGraph);
  }

  async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    await this.initSchema();
    const pool = await this.getPool();
    const [eRes, rRes] = await Promise.all([
      pool.query<Record<string, unknown>>('SELECT * FROM entities'),
      pool.query<Record<string, unknown>>('SELECT * FROM relations'),
    ]);
    const graph: KnowledgeGraph = {
      entities: eRes.rows.map((r) => this.rowToEntity(r)),
      relations: rRes.rows.map((r) => this.rowToRelation(r)),
    };
    this.cache = graph;
    this.rebuildIndexes(graph);
  }

  /**
   * In-memory cached graph, or null before the first load.
   *
   * Ownership: this is the LIVE cache in every environment (never copied
   * or frozen). Do not mutate it or keep it as a snapshot; use
   * `getGraphForMutation()` for an independent copy.
   */
  get cachedGraph(): ReadonlyKnowledgeGraph | null {
    return this.cache;
  }

  // ==================== IGraphStorage — write ====================

  /**
   * Save the whole graph. The storage saves and caches a copy of the graph,
   * so a later change to the caller's graph does not reach the cache.
   *
   * @param callerGraph - The knowledge graph to save
   */
  async saveGraph(callerGraph: KnowledgeGraph): Promise<void> {
    const graph = deepCopyPlain(callerGraph);
    // Match database conflict semantics before writing, so the live cache and
    // a subsequent hydration contain the same records. Entity upserts keep
    // the last value; relations use ON CONFLICT DO NOTHING (first value).
    graph.entities = [...new Map(graph.entities.map(entity => [entity.name, entity])).values()];
    const uniqueRelations = new Map<string, Relation>();
    for (const relation of graph.relations) {
      const key = relationCacheKey(relation);
      if (!uniqueRelations.has(key)) uniqueRelations.set(key, relation);
    }
    graph.relations = [...uniqueRelations.values()];
    await this.initSchema();
    const pool = await this.getPool();
    // Truncate-and-reinsert is the simplest correct implementation. For very
    // large graphs a smarter diff would be faster; v1 keeps it simple.
    // The whole replace runs in one database transaction on one checked-out
    // connection, so a failed insert cannot leave a truncated table. A pool
    // without `connect()` (a custom shim) keeps the non-transactional path.
    const client = pool.connect ? await pool.connect() : undefined;
    const db: PgQueryable = client ?? pool;
    try {
      if (client) await client.query('BEGIN');
      await db.query('TRUNCATE entities, relations');
      await this.insertEntityRows(db, graph.entities);
      await this.insertRelationRows(db, graph.relations);
      if (client) await client.query('COMMIT');
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original failure; the connection is released below.
        }
      }
      throw error;
    } finally {
      client?.release();
    }
    this.cache = graph;
    this.rebuildIndexes(this.cache);
    this.pendingAppends = 0;
  }

  private async insertEntityRows(db: PgQueryable, entities: Entity[]): Promise<void> {
    const batchSize = Math.min(MAX_INSERT_ROWS, Math.floor(MAX_INSERT_PARAMETERS / ENTITY_COLUMNS.length));
    for (let start = 0; start < entities.length; start += batchSize) {
      // PostgreSQL rejects updating one conflicting key twice in a statement.
      // Last-write-wins matches the previous sequential insertion behavior.
      const batch = new Map(entities.slice(start, start + batchSize).map(entity => [entity.name, entity]));
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (const entity of batch.values()) {
        const row = this.entityToRow(entity);
        tuples.push(`(${ENTITY_COLUMNS.map(column => {
          params.push(row[column]);
          return `$${params.length}`;
        }).join(', ')})`);
      }
      await db.query(
        `INSERT INTO entities (${ENTITY_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}
         ON CONFLICT (name) DO UPDATE SET ${ENTITY_COLUMNS.filter(column => column !== 'name')
           .map(column => `${column} = EXCLUDED.${column}`).join(', ')}`,
        params,
      );
    }
  }

  private async insertEntityRow(db: PgQueryable, entity: Entity): Promise<void> {
    await this.insertEntityRows(db, [entity]);
  }

  private async insertRelationRows(db: PgQueryable, relations: Relation[]): Promise<void> {
    const batchSize = Math.min(MAX_INSERT_ROWS, Math.floor(MAX_INSERT_PARAMETERS / RELATION_COLUMNS.length));
    for (let start = 0; start < relations.length; start += batchSize) {
      const params: unknown[] = [];
      const tuples = relations.slice(start, start + batchSize).map(relation => {
        const first = params.length + 1;
        const { from, to, relationType, metadata, createdAt, lastModified, weight, confidence, properties, ...extra } = relation;
        params.push(from, to, relationType, metadata ?? null, createdAt ?? null, lastModified ?? null,
          weight ?? null, confidence ?? null, properties ?? null, Object.keys(extra).length ? extra : null);
        return `(${RELATION_COLUMNS.map((_, index) => `$${first + index}`).join(', ')})`;
      });
      await db.query(
        `INSERT INTO relations (${RELATION_COLUMNS.join(', ')})
         VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
        params,
      );
    }
  }

  private async insertRelationRow(db: PgQueryable, relation: Relation): Promise<void> {
    await this.insertRelationRows(db, [relation]);
  }

  /**
   * Append one entity. The cache keeps a copy of the entity, not the caller's object.
   *
   * @param callerEntity - The entity to append
   */
  async appendEntity(callerEntity: Entity): Promise<void> {
    const entity = deepCopyPlain(callerEntity);
    await this.ensureLoaded();
    const pool = await this.getPool();
    await this.insertEntityRow(pool, entity);
    this.cacheEntity(entity);
    this.pendingAppends += 1;
  }

  /**
   * Append one relation. The cache keeps a copy of the relation, not the caller's object.
   *
   * @param callerRelation - The relation to append
   */
  async appendRelation(callerRelation: Relation): Promise<void> {
    const relation = deepCopyPlain(callerRelation);
    await this.ensureLoaded();
    const pool = await this.getPool();
    await this.insertRelationRow(pool, relation);
    if (!this.cache) return;
    const key = relationCacheKey(relation);
    if (!this.relationKeys.has(key)) {
      this.relationKeys.add(key);
      this.cache.relations.push(relation);
      const outArr = this.outgoingRelations.get(relation.from) ?? [];
      outArr.push(relation);
      this.outgoingRelations.set(relation.from, outArr);
      const inArr = this.incomingRelations.get(relation.to) ?? [];
      inArr.push(relation);
      this.incomingRelations.set(relation.to, inArr);
    }
    this.pendingAppends += 1;
  }

  async updateEntity(entityName: string, updates: Partial<Entity>): Promise<boolean> {
    await this.ensureLoaded();
    const existing = this.nameIndex.get(entityName);
    if (!existing) return false;
    const merged: Entity = {
      ...existing,
      ...deepCopyPlain(updates),
      name: entityName,
      lastModified: updates.lastModified ?? new Date().toISOString(),
    };
    const pool = await this.getPool();
    await this.insertEntityRow(pool, merged);
    this.cacheEntity(merged);
    this.pendingAppends += 1;
    return true;
  }

  async compact(): Promise<void> {
    if (this.cache) await this.saveGraph(this.cache);
  }

  clearCache(): void {
    this.cache = null;
    this.nameIndex.clear();
    this.entityPositions.clear();
    this.typeIndex.clear();
    this.lowercaseCache.clear();
    this.relationKeys.clear();
    this.outgoingRelations.clear();
    this.incomingRelations.clear();
    this.pendingAppends = 0;
  }

  // ==================== IGraphStorage — sync getters ====================

  getEntityByName(name: string): Entity | undefined {
    return this.nameIndex.get(name);
  }

  hasEntity(name: string): boolean {
    return this.nameIndex.has(name);
  }

  getEntitiesByType(entityType: string): Entity[] {
    return [...(this.typeIndex.get(entityType) ?? [])]
      .sort((a, b) => this.entityPositions.get(a)! - this.entityPositions.get(b)!)
      .map(name => this.nameIndex.get(name)!);
  }

  getEntityTypes(): string[] {
    // Preserve graph order even after an entity changes type.
    return [...this.typeIndex].map(([type, names]) => {
      let position = Infinity;
      for (const name of names) position = Math.min(position, this.entityPositions.get(name)!);
      return { type, position };
    }).sort((a, b) => a.position - b.position).map(entry => entry.type);
  }

  getLowercased(entityName: string): LowercaseData | undefined {
    return this.lowercaseCache.get(entityName);
  }

  getRelationsFrom(entityName: string): Relation[] {
    return this.outgoingRelations.get(entityName) ?? [];
  }

  getRelationsTo(entityName: string): Relation[] {
    return this.incomingRelations.get(entityName) ?? [];
  }

  getRelationsFor(entityName: string): Relation[] {
    return [
      ...(this.outgoingRelations.get(entityName) ?? []),
      ...(this.incomingRelations.get(entityName) ?? []),
    ];
  }

  hasRelations(entityName: string): boolean {
    return (
      (this.outgoingRelations.get(entityName)?.length ?? 0) +
        (this.incomingRelations.get(entityName)?.length ?? 0) >
      0
    );
  }

  // ==================== Full-text search ====================

  /**
   * tsvector-backed full-text search. Uses `plainto_tsquery` so the input is
   * free-form (no boolean operator syntax required); ranks via `ts_rank` on
   * the weighted `fts_vector` column (name × A, observations × B, tags × C).
   *
   * Results are ordered by descending score and capped at `options.limit`
   * (default 50). Empty / whitespace-only queries return `[]` without
   * issuing a SQL call.
   *
   * @example
   * ```typescript
   * const matches = await storage.fullTextSearch('authentication flow', { limit: 10 });
   * // → [{ name: 'AuthService', score: 0.62 }, ...]
   * ```
   */
  async fullTextSearch(
    query: string,
    options: { limit?: number } = {},
  ): Promise<Array<{ name: string; score: number }>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    await this.initSchema();
    const pool = await this.getPool();
    const limit = options.limit ?? 50;
    const res = await pool.query<{ name: string; score: number }>(
      `SELECT name, ts_rank(fts_vector, plainto_tsquery('english', $1))::float AS score
       FROM entities
       WHERE fts_vector @@ plainto_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT $2`,
      [trimmed, limit],
    );
    return res.rows.map((r) => ({ name: r.name, score: Number(r.score) }));
  }

  // ==================== Utility ====================

  getFilePath(): string {
    return this.connectionString;
  }

  getPendingAppends(): number {
    return this.pendingAppends;
  }

  /**
   * Close the underlying `pg.Pool`. Call from process-shutdown handlers to
   * avoid keeping the event loop alive on idle connections.
   */
  async close(): Promise<void> {
    if (this.pool) {
      try { await this.pool.end(); } catch (e) {
        logger.warn('PostgreSQLStorage.close: pool.end failed:', e);
      }
      this.pool = null;
    }
  }
}

/**
 * Text form of a `pg` column value. `pg` returns strings for text columns
 * and `Date` objects for timestamps; anything else is stringified
 * explicitly so an unexpected JSON column never becomes `[object Object]`.
 */
function columnText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value as number | boolean | bigint | null | undefined);
}

/** ISO-8601 form of a `pg` timestamp column (Date or parseable string). */
function columnIso(value: unknown): string {
  return new Date(value instanceof Date ? value : columnText(value)).toISOString();
}

/** Collision-free composite key, including names containing delimiters. */
function relationCacheKey(relation: Relation): string {
  return JSON.stringify([relation.from, relation.to, relation.relationType]);
}

/** Merge only extension data: canonical columns and object internals win. */
function mergeExtensionFields(target: object, extra: unknown, reserved: ReadonlySet<string>): void {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return;
  for (const [key, value] of Object.entries(extra)) {
    if (reserved.has(key) || UNSAFE_EXTENSION_KEYS.has(key)) continue;
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  }
}
