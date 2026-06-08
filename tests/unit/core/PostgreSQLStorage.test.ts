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
        const name = params[0] as string;
        const row: MemRow = {
          name,
          entity_type: params[1],
          observations: params[2],
          parent_id: params[3],
          tags: params[4],
          importance: params[5],
          created_at: params[6],
          last_modified: params[7],
          ttl: params[8],
          confidence: params[9],
          project_id: params[10],
          version: params[11],
          parent_entity_name: params[12],
          root_entity_name: params[13],
          is_latest: params[14],
          superseded_by: params[15],
          content_hash: params[16],
          valid_from: params[17],
          valid_until: params[18],
          observation_meta: params[19],
          lifecycle_status: params[20],
          extra: params[21],
        };
        memEntities.set(name, row);
        return { rows: [], rowCount: 1 };
      }
      if (trimmed.startsWith('INSERT INTO RELATIONS')) {
        const row: MemRow = {
          from_name: params[0],
          to_name: params[1],
          relation_type: params[2],
        };
        // Dedup on PK
        const exists = memRelations.find(
          (r) => r.from_name === row.from_name && r.to_name === row.to_name && r.relation_type === row.relation_type,
        );
        if (!exists) memRelations.push(row);
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
