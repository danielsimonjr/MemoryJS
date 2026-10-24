/**
 * Re-appending an entity name that already exists.
 *
 * `appendEntity` and `appendEntities` write an existing name in place.
 * The write must keep the rowid, the relations of the entity and the
 * `parentId` of its children, and it must keep the full-text index exact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import type { Entity } from '../../../src/types/index.js';

/** A fresh copy per test: the storage keeps the objects that it is given and updates them in place. */
const makeSeed = (): Entity[] => [
  { name: 'Alpha', entityType: 'note', observations: ['alpha original'] },
  { name: 'Beta', entityType: 'note', observations: ['beta original'], parentId: 'Alpha' },
  { name: 'Gamma', entityType: 'note', observations: ['gamma original'] },
];

/**
 * The index is exact when the FTS5 integrity check finds no difference to the entities table.
 * The check is an INSERT command, so the connection cannot be read-only. It changes nothing.
 */
function indexIsExact(dbFile: string): boolean {
  const raw = new Database(dbFile);
  try {
    raw.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES('integrity-check', 1)").run();
    return true;
  } catch {
    return false;
  } finally {
    raw.close();
  }
}

function userVersion(dbFile: string): number {
  const raw = new Database(dbFile, { readonly: true });
  try {
    return raw.pragma('user_version', { simple: true }) as number;
  } finally {
    raw.close();
  }
}

describe('re-appending an existing entity name', () => {
  let storage: SQLiteStorage;
  let testDir: string;
  let dbFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sqlite-append-replace-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    dbFile = join(testDir, 'memory.db');
    storage = new SQLiteStorage(dbFile);
    await storage.saveGraph({
      entities: makeSeed(),
      relations: [
        { from: 'Alpha', to: 'Beta', relationType: 'knows' },
        { from: 'Gamma', to: 'Alpha', relationType: 'cites' },
      ],
    });
  });

  afterEach(async () => {
    storage.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Close the storage and read the file again, so no cache can hide a lost row. */
  async function reload() {
    storage.close();
    storage = new SQLiteStorage(dbFile);
    return storage.loadGraph();
  }

  it('keeps the relations of the replaced entity', async () => {
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha updated'] });

    const graph = await reload();

    expect(graph.relations.map(r => `${r.from}>${r.relationType}>${r.to}`).sort()).toStrictEqual([
      'Alpha>knows>Beta',
      'Gamma>cites>Alpha',
    ]);
  });

  it('keeps the parentId of the children of the replaced entity', async () => {
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha updated'] });

    const graph = await reload();

    expect(graph.entities.find(e => e.name === 'Beta')?.parentId).toBe('Alpha');
  });

  it('keeps the relations and children after a batch append', async () => {
    await storage.appendEntities([
      { name: 'Alpha', entityType: 'note', observations: ['alpha batch'] },
      { name: 'Delta', entityType: 'note', observations: ['delta new'] },
    ]);

    const graph = await reload();

    expect(graph.relations).toHaveLength(2);
    expect(graph.entities.find(e => e.name === 'Beta')?.parentId).toBe('Alpha');
    expect(graph.entities.find(e => e.name === 'Alpha')?.observations).toStrictEqual(['alpha batch']);
  });

  it('leaves no index posting for the old content', async () => {
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha updated'] });

    expect(indexIsExact(dbFile)).toBe(true);
    expect(storage.fullTextSearch('original').map(r => r.name).sort()).toStrictEqual(['Beta', 'Gamma']);
    expect(storage.fullTextSearch('updated').map(r => r.name)).toStrictEqual(['Alpha']);
  });

  it('ranks the new content after the replace', async () => {
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha updated'] });

    const ranked = storage.fullTextSearch('alpha');

    expect(ranked.map(r => r.name)).toStrictEqual(['Alpha']);
    expect(ranked[0].score).toBeLessThan(0);
  });

  it('replaces the entity with the highest rowid without a ghost posting', async () => {
    // A replaced row got a new rowid, which equals the old one when the row held the highest rowid.
    await storage.appendEntity({ name: 'Gamma', entityType: 'note', observations: ['gamma changed'] });

    expect(indexIsExact(dbFile)).toBe(true);
    expect(storage.fullTextSearch('original').map(r => r.name).sort()).toStrictEqual(['Alpha', 'Beta']);
    expect(storage.fullTextSearch('changed').map(r => r.name)).toStrictEqual(['Gamma']);
  });

  it('replaces the same name twice in a row', async () => {
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha second'] });
    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['alpha third'] });

    expect(indexIsExact(dbFile)).toBe(true);
    expect(storage.fullTextSearch('second')).toStrictEqual([]);
    expect(storage.fullTextSearch('third').map(r => r.name)).toStrictEqual(['Alpha']);
    expect((await reload()).relations).toHaveLength(2);
  });

  it('writes every column of the new entity and clears a column the new entity omits', async () => {
    const full: Entity = {
      name: 'Alpha',
      entityType: 'person',
      observations: ['one', 'two'],
      tags: ['t1'],
      importance: 7,
      createdAt: '2020-01-01T00:00:00.000Z',
      lastModified: '2021-01-01T00:00:00.000Z',
      projectId: 'p',
      version: 3,
      isLatest: false,
      supersededBy: 'Alpha2',
      contentHash: 'abc',
    };
    await storage.appendEntity(full);

    const alpha = (await reload()).entities.find(e => e.name === 'Alpha');

    expect(alpha).toMatchObject(full);
    expect(alpha?.parentId).toBeUndefined();

    await storage.appendEntity({ name: 'Alpha', entityType: 'note', observations: ['bare'] });

    const bare = (await reload()).entities.find(e => e.name === 'Alpha');
    expect(bare?.tags).toBeUndefined();
    expect(bare?.importance).toBeUndefined();
    expect(bare?.projectId).toBeUndefined();
    expect(bare?.supersededBy).toBeUndefined();
    expect(bare?.contentHash).toBeUndefined();
  });
});

describe('a store that holds postings of replaced rows', () => {
  let testDir: string;
  let dbFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sqlite-stale-repair-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    dbFile = join(testDir, 'memory.db');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Build a store the way the old write did: INSERT OR REPLACE leaves the delete trigger silent. */
  async function buildDamagedStore(): Promise<void> {
    const first = new SQLiteStorage(dbFile);
    await first.saveGraph({ entities: makeSeed(), relations: [] });
    first.close();
    const raw = new Database(dbFile);
    const replace = raw.prepare(
      "INSERT OR REPLACE INTO entities (name, entityType, observations, createdAt, lastModified) VALUES (?, 'note', ?, 'x', 'x')",
    );
    replace.run('Alpha', JSON.stringify(['alpha updated']));
    replace.run('Gamma', JSON.stringify(['gamma changed']));
    // A store from an older release has no marker.
    raw.pragma('user_version = 0');
    raw.close();
  }

  it('passes the integrity check on an undamaged store (control)', async () => {
    const storage = new SQLiteStorage(dbFile);
    await storage.saveGraph({ entities: makeSeed(), relations: [] });
    storage.close();

    expect(indexIsExact(dbFile)).toBe(true);
  });

  it('fails the integrity check on a damaged store (control)', async () => {
    await buildDamagedStore();

    expect(indexIsExact(dbFile)).toBe(false);
  });

  it('is repaired when the storage opens it', async () => {
    await buildDamagedStore();

    const storage = new SQLiteStorage(dbFile);
    try {
      await storage.loadGraph();

      expect(storage.fullTextSearch('original').map(r => r.name)).toStrictEqual(['Beta']);
      expect(storage.fullTextSearch('updated').map(r => r.name)).toStrictEqual(['Alpha']);
      expect(storage.fullTextSearch('changed').map(r => r.name)).toStrictEqual(['Gamma']);
    } finally {
      storage.close();
    }
    expect(indexIsExact(dbFile)).toBe(true);
  });

  it('sets the marker when it repairs, so the next open does not repair again', async () => {
    await buildDamagedStore();
    expect(userVersion(dbFile)).toBe(0);

    const first = new SQLiteStorage(dbFile);
    await first.loadGraph();
    first.close();

    expect(userVersion(dbFile)).toBeGreaterThan(0);
  });

  it('marks a new store at creation', async () => {
    const storage = new SQLiteStorage(dbFile);
    await storage.loadGraph();
    storage.close();

    expect(userVersion(dbFile)).toBeGreaterThan(0);
  });
});
