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
 * Search: simple LIKE-based for v1; the `to_tsvector` / `tsquery` path is
 * deferred. The `fullTextSearch` method falls back to substring scoring.
 *
 * @module core/PostgreSQLStorage
 */

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
interface PgPool {
  query<R = unknown>(text: string, params?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
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
      if (!FIRST_CLASS_ENTITY_KEYS.has(key)) {
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
      name: String(row.name),
      entityType: String(row.entity_type),
      observations: Array.isArray(row.observations) ? row.observations as string[] : [],
    };
    if (row.parent_id != null) entity.parentId = String(row.parent_id);
    if (Array.isArray(row.tags)) entity.tags = row.tags as string[];
    if (row.importance != null) entity.importance = Number(row.importance);
    if (row.created_at != null) entity.createdAt = new Date(String(row.created_at)).toISOString();
    if (row.last_modified != null) entity.lastModified = new Date(String(row.last_modified)).toISOString();
    if (row.ttl != null) entity.ttl = Number(row.ttl);
    if (row.confidence != null) entity.confidence = Number(row.confidence);
    if (row.project_id != null) entity.projectId = String(row.project_id);
    if (row.version != null) entity.version = Number(row.version);
    if (row.parent_entity_name != null) entity.parentEntityName = String(row.parent_entity_name);
    if (row.root_entity_name != null) entity.rootEntityName = String(row.root_entity_name);
    if (row.is_latest != null) entity.isLatest = Boolean(row.is_latest);
    if (row.superseded_by != null) entity.supersededBy = String(row.superseded_by);
    if (row.content_hash != null) entity.contentHash = String(row.content_hash);
    if (row.valid_from != null) entity.validFrom = new Date(String(row.valid_from)).toISOString();
    if (row.valid_until != null) entity.validUntil = new Date(String(row.valid_until)).toISOString();
    if (row.observation_meta != null) {
      entity.observationMeta = row.observation_meta as Entity['observationMeta'];
    }
    if (row.lifecycle_status != null) {
      entity.lifecycleStatus = String(row.lifecycle_status) as Entity['lifecycleStatus'];
    }
    if (row.extra != null && typeof row.extra === 'object') {
      Object.assign(entity, row.extra);
    }
    return entity;
  }

  private rowToRelation(row: Record<string, unknown>): Relation {
    const relation: Relation = {
      from: String(row.from_name),
      to: String(row.to_name),
      relationType: String(row.relation_type),
    };
    return relation;
  }

  // ==================== Cache management ====================

  private rebuildIndexes(graph: KnowledgeGraph): void {
    this.nameIndex.clear();
    this.outgoingRelations.clear();
    this.incomingRelations.clear();
    for (const e of graph.entities) this.nameIndex.set(e.name, e);
    for (const r of graph.relations) {
      const outArr = this.outgoingRelations.get(r.from) ?? [];
      outArr.push(r);
      this.outgoingRelations.set(r.from, outArr);
      const inArr = this.incomingRelations.get(r.to) ?? [];
      inArr.push(r);
      this.incomingRelations.set(r.to, inArr);
    }
  }

  // ==================== IGraphStorage — read ====================

  async loadGraph(): Promise<ReadonlyKnowledgeGraph> {
    await this.ensureLoaded();
    return this.cache as ReadonlyKnowledgeGraph;
  }

  async getGraphForMutation(): Promise<KnowledgeGraph> {
    await this.ensureLoaded();
    const cache = this.cache as KnowledgeGraph;
    return {
      entities: cache.entities.map((e) => ({
        ...e,
        observations: [...e.observations],
        tags: e.tags ? [...e.tags] : undefined,
      })),
      relations: cache.relations.map((r) => ({ ...r })),
    };
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

  get cachedGraph(): ReadonlyKnowledgeGraph | null {
    return this.cache;
  }

  // ==================== IGraphStorage — write ====================

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await this.initSchema();
    const pool = await this.getPool();
    // Truncate-and-reinsert is the simplest correct implementation. For very
    // large graphs a smarter diff would be faster; v1 keeps it simple.
    await pool.query('TRUNCATE entities, relations');
    for (const entity of graph.entities) {
      await this.insertEntityRow(pool, entity);
    }
    for (const relation of graph.relations) {
      await this.insertRelationRow(pool, relation);
    }
    this.cache = {
      entities: graph.entities.map((e) => ({ ...e })),
      relations: graph.relations.map((r) => ({ ...r })),
    };
    this.rebuildIndexes(this.cache);
    this.pendingAppends = 0;
  }

  private async insertEntityRow(pool: PgPool, entity: Entity): Promise<void> {
    const row = this.entityToRow(entity);
    const cols = ENTITY_COLUMNS.join(', ');
    const placeholders = ENTITY_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const values = ENTITY_COLUMNS.map((c) => row[c as keyof typeof row]);
    await pool.query(
      `INSERT INTO entities (${cols}) VALUES (${placeholders})
       ON CONFLICT (name) DO UPDATE SET ${ENTITY_COLUMNS.filter((c) => c !== 'name')
         .map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      values,
    );
  }

  private async insertRelationRow(pool: PgPool, relation: Relation): Promise<void> {
    await pool.query(
      `INSERT INTO relations (from_name, to_name, relation_type)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [relation.from, relation.to, relation.relationType],
    );
  }

  async appendEntity(entity: Entity): Promise<void> {
    await this.ensureLoaded();
    const pool = await this.getPool();
    await this.insertEntityRow(pool, entity);
    if (!this.cache) return;
    const existingIdx = this.cache.entities.findIndex((e) => e.name === entity.name);
    if (existingIdx >= 0) this.cache.entities[existingIdx] = entity;
    else this.cache.entities.push(entity);
    this.nameIndex.set(entity.name, entity);
    this.pendingAppends += 1;
  }

  async appendRelation(relation: Relation): Promise<void> {
    await this.ensureLoaded();
    const pool = await this.getPool();
    await this.insertRelationRow(pool, relation);
    if (!this.cache) return;
    const duplicate = this.cache.relations.some(
      (r) => r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType,
    );
    if (!duplicate) {
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
      ...updates,
      name: entityName,
      lastModified: updates.lastModified ?? new Date().toISOString(),
    };
    const pool = await this.getPool();
    await this.insertEntityRow(pool, merged);
    if (this.cache) {
      const idx = this.cache.entities.findIndex((e) => e.name === entityName);
      if (idx >= 0) this.cache.entities[idx] = merged;
    }
    this.nameIndex.set(entityName, merged);
    this.pendingAppends += 1;
    return true;
  }

  async compact(): Promise<void> {
    if (this.cache) await this.saveGraph(this.cache);
  }

  clearCache(): void {
    this.cache = null;
    this.nameIndex.clear();
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
    const result: Entity[] = [];
    for (const entity of this.nameIndex.values()) {
      if (entity.entityType === entityType) result.push(entity);
    }
    return result;
  }

  getEntityTypes(): string[] {
    const types = new Set<string>();
    for (const entity of this.nameIndex.values()) types.add(entity.entityType);
    return Array.from(types);
  }

  getLowercased(entityName: string): LowercaseData | undefined {
    const e = this.nameIndex.get(entityName);
    if (!e) return undefined;
    return {
      name: e.name.toLowerCase(),
      entityType: e.entityType.toLowerCase(),
      observations: e.observations.map((o) => o.toLowerCase()),
      tags: e.tags?.map((t) => t.toLowerCase()) ?? [],
    };
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
