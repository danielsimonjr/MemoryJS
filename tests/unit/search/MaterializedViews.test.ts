/**
 * MaterializedViewsManager Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { MaterializedViewsManager } from '../../../src/search/MaterializedViews.js';
import { EntityManager } from '../../../src/core/EntityManager.js';

describe('MaterializedViewsManager', () => {
  let storage: GraphStorage;
  let mgr: MaterializedViewsManager;
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `mat-view-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storage = new GraphStorage(join(dir, 'mem.jsonl'));
    await storage.saveGraph({
      entities: [
        { name: 'A', entityType: 'note', observations: ['hello'], tags: ['active'] },
        { name: 'B', entityType: 'note', observations: ['world'], tags: ['active'] },
        { name: 'C', entityType: 'project', observations: ['build'], tags: [] },
      ],
      relations: [],
    });
    mgr = new MaterializedViewsManager(storage, storage.events);
  });

  afterEach(async () => {
    mgr.dispose();
    storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('register + query materialises matching entity names', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    const result = await mgr.query('notes');
    expect(result.members).toEqual(['A', 'B']);
    expect(result.refreshed).toBe(true);
  });

  it('repeated query returns the cached result with refreshed=false', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    await mgr.query('notes');
    const second = await mgr.query('notes');
    expect(second.refreshed).toBe(false);
    expect(second.members).toEqual(['A', 'B']);
  });

  it('invalidateAll forces the next query to recompute', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    await mgr.query('notes');
    mgr.invalidateAll();
    const result = await mgr.query('notes');
    expect(result.refreshed).toBe(true);
  });

  it('an entity:created event marks every view dirty so the next query refreshes', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    await mgr.query('notes');

    // Append a new note via the storage layer; this fires the event.
    storage.events.emitEntityCreated({
      name: 'D',
      entityType: 'note',
      observations: ['extra'],
    });

    const refreshed = await mgr.query('notes');
    expect(refreshed.refreshed).toBe(true);
  });

  it('query throws on an unregistered name', async () => {
    await expect(mgr.query('does-not-exist')).rejects.toThrow(/no view named/);
  });

  it('unregister + dispose drop all views', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    expect(mgr.list()).toHaveLength(1);
    mgr.unregister('notes');
    expect(mgr.list()).toHaveLength(0);
  });

  it('snapshot reflects size and dirty state', async () => {
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    await mgr.query('notes');
    const snap = mgr.snapshot();
    expect(snap[0]).toMatchObject({ name: 'notes', size: 2, dirty: false });
  });
});

describe('MaterializedViewsManager per-view invalidation (CMP-3)', () => {
  let storage: GraphStorage;
  let mgr: MaterializedViewsManager;
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `mat-view-cmp3-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storage = new GraphStorage(join(dir, 'mem.jsonl'));
    await storage.saveGraph({
      entities: [
        { name: 'A', entityType: 'note', observations: ['hello'], tags: ['active'] },
        { name: 'B', entityType: 'note', observations: ['world'], tags: ['active'] },
        { name: 'C', entityType: 'project', observations: ['build'], tags: [] },
      ],
      relations: [],
    });
    mgr = new MaterializedViewsManager(storage, storage.events);
  });

  afterEach(async () => {
    mgr.dispose();
    storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('observation-only update leaves a tag view clean (refreshed=false)', async () => {
    mgr.register({ name: 'tagged', filters: { tags: ['active'] } });
    await mgr.query('tagged');
    await storage.updateEntity('A', { observations: ['hello again'] });
    const result = await mgr.query('tagged');
    expect(result.refreshed).toBe(false);
    expect(result.members).toEqual(['A', 'B']);
  });

  it('tag update dirties a tag view', async () => {
    mgr.register({ name: 'tagged', filters: { tags: ['active'] } });
    await mgr.query('tagged');
    await storage.updateEntity('C', { tags: ['active'] });
    const result = await mgr.query('tagged');
    expect(result.refreshed).toBe(true);
    expect(result.members).toEqual(['A', 'B', 'C']);
  });

  it('an update dirties a view with a modifiedAfter bound', async () => {
    mgr.register({ name: 'recent', filters: { modifiedAfter: '2000-01-01T00:00:00Z' } });
    await mgr.query('recent');
    await storage.updateEntity('A', { observations: ['changed'] });
    const result = await mgr.query('recent');
    expect(result.refreshed).toBe(true);
  });

  it('entity:created still dirties every view', async () => {
    mgr.register({ name: 'tagged', filters: { tags: ['active'] } });
    mgr.register({ name: 'notes', filters: { entityType: 'note' } });
    await mgr.query('tagged');
    await mgr.query('notes');
    await new EntityManager(storage).createEntities([
      { name: 'D', entityType: 'note', observations: ['new'], tags: ['active'] },
    ]);
    expect((await mgr.query('tagged')).refreshed).toBe(true);
    const notes = await mgr.query('notes');
    expect(notes.refreshed).toBe(true);
    expect(notes.members).toEqual(['A', 'B', 'D']);
  });
});
