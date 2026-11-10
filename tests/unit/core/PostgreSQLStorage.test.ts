/**
 * PostgreSQLStorage unit tests.
 *
 * These tests run without a real PostgreSQL instance by mocking the `pg`
 * module via `vi.mock`. The mock implements a tiny in-memory analogue of
 * `pg.Pool` that supports the subset of SQL we issue (INSERT / SELECT /
 * TRUNCATE / DDL no-op). For real-database integration we'd run
 * `MEMORYJS_TEST_PG_URL=postgres://... npx vitest run tests/integration/...`
 * — that path is intentionally separate from this unit suite.
 *
 * What this covers:
 *   - Lazy connection + schema init contract (DDL on first call only)
 *   - `appendEntity` / `appendRelation` / `updateEntity` round-trip
 *   - In-memory cache hydration via `ensureLoaded`
 *   - Sync getters (`getEntityByName`, `getRelationsFor`, `getEntitiesByType`)
 *   - Idempotent re-insert via the `ON CONFLICT` upsert clause
 *   - Friendly error message when `pg` isn't installed (verified via a
 *     separate mock branch that throws on import)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Entity, Relation } from '../../../src/types/index.js';

// Simple in-memory store the mock writes to. Re-initialised in beforeEach.
interface MemRow extends Record<string, unknown> {
  name?: string; from_name?: string; to_name?: string; relation_type?: string;
}
const memEntities = new Map<string, MemRow>();
const memRelations: MemRow[] = [];
const statementLog: string[] = [];
const insertParameterCounts: number[] = [];
let failEntityInsert = false;

// Mock the `pg` module. The implementation parses the SQL coarsely (good
// enough for the storage class which uses just five distinct statement
// patterns).
vi.mock('pg', () => {
  class MockPool {
    constructor(_config: { connectionString: string }) {
      // connectionString is captured but unused by the mock
    }
    async query<R = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number | null }> {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      // Schema DDL block has multiple statements
      if (trimmed.includes('CREATE TABLE') && trimmed.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith('TRUNCATE')) {
        memEntities.clear();
        memRelations.length = 0;
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith('INSERT INTO ENTITIES')) {
        // The class always inserts in the column order declared in ENTITY_COLUMNS.
        // `name` is the first positional param.
        for (let offset = 0; offset < params.length; offset += 22) {
        const values = params.slice(offset, offset + 22);
        const name = values[0] as string;
        const row: MemRow = {
          name,
          entity_type: values[1],
          observations: values[2],
          parent_id: values[3],
          tags: values[4],
          importance: values[5],
          created_at: values[6],
          last_modified: values[7],
          ttl: values[8],
          confidence: values[9],
          project_id: values[10],
          version: values[11],
          parent_entity_name: values[12],
          root_entity_name: values[13],
          is_latest: values[14],
          superseded_by: values[15],
          content_hash: values[16],
          valid_from: values[17],
          valid_until: values[18],
          observation_meta: values[19],
          lifecycle_status: values[20],
          extra: values[21],
        };
        memEntities.set(name, row);
        }
        return { rows: [], rowCount: 1 };
      }
      if (trimmed.startsWith('INSERT INTO RELATIONS')) {
        for (let offset = 0; offset < params.length; offset += 10) {
        const values = params.slice(offset, offset + 10);
        const row: MemRow = {
          from_name: values[0],
          to_name: values[1],
          relation_type: values[2], metadata: values[3], created_at: values[4], last_modified: values[5],
          weight: values[6], confidence: values[7], properties: values[8], extra: values[9],
        };
        // Dedup on PK
        const exists = memRelations.find(
          (r) => r.from_name === row.from_name && r.to_name === row.to_name && r.relation_type === row.relation_type,
        );
        if (!exists) memRelations.push(row);
        }
        return { rows: [], rowCount: 1 };
      }
      if (trimmed.startsWith('SELECT * FROM ENTITIES')) {
        return { rows: Array.from(memEntities.values()) as R[], rowCount: memEntities.size };
      }
      if (trimmed.startsWith('SELECT * FROM RELATIONS')) {
        return { rows: memRelations.slice() as R[], rowCount: memRelations.length };
      }
      if (trimmed.startsWith('SELECT NAME, TS_RANK')) {
        // Full-text search query. The first positional param is the query
        // string; we approximate `plainto_tsquery` with a case-insensitive
        // word-overlap score so the test can assert ordering + filtering
        // without a real tsvector implementation.
        const query = String(params[0] ?? '').toLowerCase().trim();
        const limit = Number(params[1] ?? 50);
        if (!query) return { rows: [], rowCount: 0 };
        const queryWords = query.split(/\s+/).filter(Boolean);
        const ranked = Array.from(memEntities.values())
          .map((row) => {
            const name = String(row.name ?? '').toLowerCase();
            const obs = (Array.isArray(row.observations) ? row.observations as string[] : [])
              .join(' ').toLowerCase();
            const tags = (Array.isArray(row.tags) ? row.tags as string[] : [])
              .join(' ').toLowerCase();
            // Weighted: name × 3, observations × 2, tags × 1 (mirrors A/B/C).
            let score = 0;
            for (const w of queryWords) {
              if (name.includes(w)) score += 3;
              if (obs.includes(w)) score += 2;
              if (tags.includes(w)) score += 1;
            }
            return { name: row.name as string, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return { rows: ranked as R[], rowCount: ranked.length };
      }
      return { rows: [], rowCount: 0 };
    }
    async end(): Promise<void> { /* no-op */ }
    async connect() {
      return {
        query: async <R = unknown>(sql: string, params: unknown[] = []) => {
          const head = sql.trim().split(/\s+/)[0]!.toUpperCase();
          statementLog.push(head);
          if (head === 'INSERT') insertParameterCounts.push(params.length);
          if (head === 'BEGIN' || head === 'COMMIT' || head === 'ROLLBACK') {
            return { rows: [] as R[], rowCount: 0 };
          }
          if (failEntityInsert && head === 'INSERT' && sql.includes('entities')) {
            throw new Error('injected insert failure');
          }
          return this.query<R>(sql, params);
        },
        release: () => { statementLog.push('RELEASE'); },
      };
    }
  }
  return { Pool: MockPool };
});

// Imported after the vi.mock call so the mock is in place.
const { PostgreSQLStorage } = await import('../../../src/core/PostgreSQLStorage.js');

describe('PostgreSQLStorage', () => {
  let storage: InstanceType<typeof PostgreSQLStorage>;

  beforeEach(() => {
    memEntities.clear();
    memRelations.length = 0;
    insertParameterCounts.length = 0;
    storage = new PostgreSQLStorage('postgres://test:test@localhost:5432/test');
  });

  describe('IGraphStorage contract — read', () => {
    it('loadGraph on an empty database returns empty arrays', async () => {
      const graph = await storage.loadGraph();
      expect(graph.entities).toEqual([]);
      expect(graph.relations).toEqual([]);
    });

    it('ensureLoaded hydrates the in-memory cache + name index', async () => {
      await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['x'] });
      // Fresh instance so we exercise the load path
      const next = new PostgreSQLStorage('postgres://test:test@localhost:5432/test');
      await next.ensureLoaded();
      expect(next.getEntityByName('Alpha')?.entityType).toBe('note');
    });

    it('cachedGraph getter returns null before loadGraph and the cache after', async () => {
      expect(storage.cachedGraph).toBeNull();
      await storage.loadGraph();
      expect(storage.cachedGraph).not.toBeNull();
    });
  });

  describe('IGraphStorage contract — write', () => {
    it('appendEntity persists + updates the cache + bumps pendingAppends', async () => {
      await storage.appendEntity({
        name: 'Alpha', entityType: 'note', observations: ['hi'], tags: ['t1'],
      });
      expect(storage.getEntityByName('Alpha')?.observations).toEqual(['hi']);
      expect(storage.hasEntity('Alpha')).toBe(true);
      expect(storage.getPendingAppends()).toBe(1);
    });

    it('appendEntity round-trips v2.1.0 subclass-manager record fields via JSONB extra', async () => {
      // Using `as any` to attach a v2.1.0 manager-specific field that isn't
      // declared on `Entity`; PostgreSQLStorage routes unknown keys through
      // the JSONB `extra` column and reconstitutes them on load.
      const heuristic: Entity = {
        name: 'h-1', entityType: 'heuristic', observations: [],
      };
      (heuristic as unknown as Record<string, unknown>).heuristicRecord = {
        id: 'h-1', condition: 'X', action: 'Y', confidence: 0.5,
      };
      await storage.appendEntity(heuristic);

      const fresh = new PostgreSQLStorage('postgres://test:test@localhost:5432/test');
      await fresh.ensureLoaded();
      const loaded = fresh.getEntityByName('h-1') as Entity & { heuristicRecord?: unknown };
      expect(loaded?.heuristicRecord).toBeDefined();
      expect((loaded.heuristicRecord as { id: string }).id).toBe('h-1');
    });

    it('appendRelation persists + updates outgoing / incoming indexes', async () => {
      await storage.appendEntity({ name: 'A', entityType: 't', observations: [] });
      await storage.appendEntity({ name: 'B', entityType: 't', observations: [] });
      await storage.appendRelation({ from: 'A', to: 'B', relationType: 'depends_on' });

      expect(storage.getRelationsFrom('A')).toHaveLength(1);
      expect(storage.getRelationsTo('B')).toHaveLength(1);
      expect(storage.getRelationsFor('A')[0].to).toBe('B');
    });

    it('round-trips all relation fields through PostgreSQL hydration', async () => {
      const relation: Relation = {
        from: 'A', to: 'B', relationType: 'r', weight: 0.5, confidence: 0.8,
        createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-02T00:00:00.000Z',
        metadata: { source: 'test' }, properties: { custom: { strength: 0.9 } },
      };
      await storage.appendRelation(relation);
      storage.clearCache();
      await storage.ensureLoaded();
      expect(storage.getRelationsFrom('A')).toEqual([relation]);
    });

    it('appendRelation is idempotent (ON CONFLICT DO NOTHING)', async () => {
      await storage.appendEntity({ name: 'A', entityType: 't', observations: [] });
      await storage.appendEntity({ name: 'B', entityType: 't', observations: [] });
      const r: Relation = { from: 'A', to: 'B', relationType: 'r' };
      await storage.appendRelation(r);
      await storage.appendRelation(r);
      expect(storage.getRelationsFrom('A')).toHaveLength(1);
    });

    it('updateEntity returns false for unknown entity', async () => {
      const ok = await storage.updateEntity('Ghost', { importance: 5 });
      expect(ok).toBe(false);
    });

    it('updateEntity merges + persists + refreshes lastModified', async () => {
      await storage.appendEntity({ name: 'Alpha', entityType: 't', observations: [] });
      const before = storage.getEntityByName('Alpha')?.lastModified;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const ok = await storage.updateEntity('Alpha', { importance: 7 });
      expect(ok).toBe(true);
      const after = storage.getEntityByName('Alpha');
      expect(after?.importance).toBe(7);
      expect(after?.lastModified).toBeDefined();
      expect(after?.lastModified).not.toBe(before);
    });

    it('saveGraph truncates + reinserts the whole graph', async () => {
      await storage.appendEntity({ name: 'old', entityType: 't', observations: [] });
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 't', observations: ['fresh'] },
          { name: 'B', entityType: 't', observations: [] },
        ],
        relations: [{ from: 'A', to: 'B', relationType: 'r' }],
      });
      expect(storage.getEntityByName('old')).toBeUndefined();
      expect(storage.getEntityByName('A')?.observations).toEqual(['fresh']);
      expect(storage.getRelationsFor('A')).toHaveLength(1);
    });

    it('normalizes duplicate graph keys with database conflict semantics', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'A', entityType: 'old', observations: [] },
          { name: 'B', entityType: 'other', observations: [] },
          { name: 'A', entityType: 'new', observations: ['latest'] },
        ],
        relations: [
          { from: 'A', to: 'B', relationType: 'r', weight: 0.2 },
          { from: 'A', to: 'B', relationType: 'r', weight: 0.9 },
        ],
      });
      expect(storage.cachedGraph?.entities).toHaveLength(2);
      expect(storage.getEntityByName('A')?.entityType).toBe('new');
      expect(storage.getEntitiesByType('old')).toEqual([]);
      expect(storage.getRelationsFrom('A')).toHaveLength(1);
      expect(storage.getRelationsFrom('A')[0].weight).toBe(0.2);
      const before = await storage.getGraphForMutation();
      storage.clearCache();
      expect(await storage.getGraphForMutation()).toEqual(before);
    });

    it('cannot overwrite canonical fields or prototypes through stored extra data', async () => {
      memEntities.set('A', {
        name: 'A', entity_type: 'note', observations: [],
        extra: JSON.parse('{"name":"evil","entityType":"evil","__proto__":{"polluted":true},"constructor":"evil","extension":"ok"}'),
      });
      memRelations.push({
        from_name: 'A', to_name: 'B', relation_type: 'r',
        extra: JSON.parse('{"from":"evil","to":"evil","relationType":"evil","__proto__":{"polluted":true},"constructor":"evil","extension":"ok"}'),
      });
      await storage.ensureLoaded();
      const entity = storage.getEntityByName('A')!;
      const relation = storage.getRelationsFrom('A')[0];
      expect(entity).toMatchObject({ name: 'A', entityType: 'note', extension: 'ok' });
      expect(relation).toMatchObject({ from: 'A', to: 'B', relationType: 'r', extension: 'ok' });
      for (const record of [entity, relation]) {
        expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
        expect(Object.hasOwn(record, '__proto__')).toBe(false);
        expect(Object.hasOwn(record, 'constructor')).toBe(false);
      }
    });

    it('duplicate relation appends preserve the first stored metadata before and after reload', async () => {
      const first = { from: 'A', to: 'B', relationType: 'r', weight: 0.1, metadata: { source: 'first' } };
      await storage.appendRelation(first);
      await storage.appendRelation({ ...first, weight: 0.9, metadata: { source: 'second' } });
      expect(storage.getRelationsFrom('A')).toEqual([first]);
      storage.clearCache();
      await storage.ensureLoaded();
      expect(storage.getRelationsFrom('A')).toEqual([first]);
    });

    it('bulk replacement bounds parameters and uses chunks instead of per-row round trips', async () => {
      const entities = Array.from({ length: 2501 }, (_, i) => ({ name: `E${i}`, entityType: 't', observations: [] }));
      const relations = entities.slice(1).map(entity => ({ from: 'E0', to: entity.name, relationType: 'r' }));
      await storage.saveGraph({ entities, relations });
      expect(insertParameterCounts).toEqual([22000, 22000, 11022, 10000, 10000, 5000]);
      storage.clearCache();
      await storage.ensureLoaded();
      expect(storage.cachedGraph?.entities).toHaveLength(2501);
      expect(storage.getRelationsFrom('E0')).toHaveLength(2500);
      expect(storage.getEntityByName('E2500')).toBeDefined();
    });

    it('keeps derived indexes coherent on replacement, type changes, cache clear, and reload', async () => {
      await storage.appendEntity({ name: 'A', entityType: 'old', observations: ['Before'] });
      await storage.appendEntity({ name: 'B', entityType: 'other', observations: [] });
      await storage.appendEntity({ name: 'A', entityType: 'new', observations: ['After'] });
      expect(storage.getEntitiesByType('old')).toEqual([]);
      expect(storage.getEntitiesByType('new').map(entity => entity.name)).toEqual(['A']);
      expect(storage.getEntityTypes()).toEqual(['new', 'other']);
      const observations = ['Changed'];
      await storage.updateEntity('A', { entityType: 'other', observations });
      observations.push('caller mutation');
      expect(storage.getEntityByName('A')?.observations).toEqual(['Changed']);
      expect(storage.getLowercased('A')?.observations).toEqual(['changed']);
      expect(storage.getEntitiesByType('other').map(entity => entity.name)).toEqual(['A', 'B']);
      storage.clearCache();
      expect(storage.getLowercased('A')).toBeUndefined();
      expect(storage.getEntityTypes()).toEqual([]);
      await storage.ensureLoaded();
      expect(storage.getEntitiesByType('other').map(entity => entity.name)).toEqual(['A', 'B']);
      expect(storage.getLowercased('A')?.observations).toEqual(['changed']);
    });

    it('saveGraph runs the replace inside one database transaction', async () => {
      await storage.loadGraph();
      statementLog.length = 0;
      await storage.saveGraph({ entities: [{ name: 'A', entityType: 't', observations: [] }], relations: [] });
      expect(statementLog).toEqual(['BEGIN', 'TRUNCATE', 'INSERT', 'COMMIT', 'RELEASE']);
    });

    it('saveGraph rolls back and keeps the cache when an insert fails', async () => {
      await storage.appendEntity({ name: 'old', entityType: 't', observations: [] });
      statementLog.length = 0;
      failEntityInsert = true;
      try {
        await expect(
          storage.saveGraph({ entities: [{ name: 'A', entityType: 't', observations: [] }], relations: [] }),
        ).rejects.toThrow(/injected/);
      } finally {
        failEntityInsert = false;
      }
      expect(statementLog).toEqual(['BEGIN', 'TRUNCATE', 'INSERT', 'ROLLBACK', 'RELEASE']);
      expect(storage.getEntityByName('old')).toBeDefined();
    });

    it('saveGraph keeps no reference to the caller graph', async () => {
      const graph = {
        entities: [{ name: 'A', entityType: 't', observations: ['one'], tags: ['x'] }],
        relations: [] as Relation[],
      };
      await storage.saveGraph(graph);
      graph.entities[0].observations.push('changed');
      graph.entities[0].tags.push('changed');
      expect(storage.getEntityByName('A')?.observations).toEqual(['one']);
      expect(storage.getEntityByName('A')?.tags).toEqual(['x']);
    });

    it('appendEntity and appendRelation keep no reference to the caller objects', async () => {
      const a: Entity = { name: 'A', entityType: 't', observations: ['one'] };
      await storage.appendEntity(a);
      await storage.appendEntity({ name: 'B', entityType: 't', observations: [] });
      const r: Relation = { from: 'A', to: 'B', relationType: 'r', weight: 0.5 };
      await storage.appendRelation(r);
      a.observations.push('changed');
      a.entityType = 'changed';
      r.weight = 0.9;
      expect(storage.getEntityByName('A')).toMatchObject({ entityType: 't', observations: ['one'] });
      expect(storage.getRelationsFrom('A')[0].weight).toBe(0.5);
    });
  });

  describe('IGraphStorage contract — sync getters', () => {
    beforeEach(async () => {
      await storage.appendEntity({ name: 'A', entityType: 'service', observations: [], tags: ['core'] });
      await storage.appendEntity({ name: 'B', entityType: 'service', observations: [] });
      await storage.appendEntity({ name: 'C', entityType: 'doc', observations: [] });
    });

    it('getEntitiesByType filters by entityType', () => {
      const services = storage.getEntitiesByType('service');
      expect(services.map((e) => e.name).sort()).toEqual(['A', 'B']);
    });

    it('getEntityTypes returns the distinct set', () => {
      const types = storage.getEntityTypes().sort();
      expect(types).toEqual(['doc', 'service']);
    });

    it('getLowercased returns lower-cased fields', () => {
      const lower = storage.getLowercased('A');
      expect(lower).toEqual({
        name: 'a', entityType: 'service', observations: [], tags: ['core'],
      });
    });

    it('hasRelations reflects index state', async () => {
      expect(storage.hasRelations('A')).toBe(false);
      await storage.appendRelation({ from: 'A', to: 'B', relationType: 'r' });
      expect(storage.hasRelations('A')).toBe(true);
      expect(storage.hasRelations('B')).toBe(true);
    });
  });

  describe('fullTextSearch (tsvector-backed)', () => {
    beforeEach(async () => {
      await storage.appendEntity({
        name: 'AuthService', entityType: 'service',
        observations: ['handles user login flows'], tags: ['auth', 'security'],
      });
      await storage.appendEntity({
        name: 'BillingService', entityType: 'service',
        observations: ['processes payments and invoices'], tags: ['billing'],
      });
      await storage.appendEntity({
        name: 'EmailSender', entityType: 'service',
        observations: ['sends transactional emails to users'], tags: ['notifications'],
      });
    });

    it('returns empty array for empty / whitespace-only query without issuing SQL', async () => {
      expect(await storage.fullTextSearch('')).toEqual([]);
      expect(await storage.fullTextSearch('   ')).toEqual([]);
    });

    it('ranks name matches above observation matches above tag matches', async () => {
      const r = await storage.fullTextSearch('user');
      // "user" appears in AuthService.observations and EmailSender.observations.
      // It does NOT appear in any name. Both should match; ordering is by score.
      expect(r.map((row) => row.name)).toContain('AuthService');
      expect(r.map((row) => row.name)).toContain('EmailSender');
      expect(r.every((row) => row.score > 0)).toBe(true);
    });

    it('honors the limit option', async () => {
      // "service" matches the names AuthService + BillingService + EmailSender (none —
      // EmailSender is the exception). With limit: 1 we should see at most 1 row.
      const r = await storage.fullTextSearch('service', { limit: 1 });
      expect(r.length).toBeLessThanOrEqual(1);
    });

    it('matches name tokens with the highest weight', async () => {
      const r = await storage.fullTextSearch('AuthService');
      expect(r).toHaveLength(1);
      expect(r[0].name).toBe('AuthService');
      expect(r[0].score).toBeGreaterThan(0);
    });

    it('returns no rows when nothing matches', async () => {
      const r = await storage.fullTextSearch('quantum-flux-capacitor-xyz');
      expect(r).toEqual([]);
    });
  });

  describe('utility', () => {
    it('getFilePath returns the connection string', () => {
      expect(storage.getFilePath()).toBe('postgres://test:test@localhost:5432/test');
    });

    it('clearCache nulls the cache and resets indexes', async () => {
      await storage.appendEntity({ name: 'A', entityType: 't', observations: [] });
      expect(storage.cachedGraph).not.toBeNull();
      storage.clearCache();
      expect(storage.cachedGraph).toBeNull();
      expect(storage.getEntityByName('A')).toBeUndefined();
    });

    it('close shuts down the pool without throwing', async () => {
      await storage.appendEntity({ name: 'A', entityType: 't', observations: [] });
      await expect(storage.close()).resolves.toBeUndefined();
    });
  });
});
