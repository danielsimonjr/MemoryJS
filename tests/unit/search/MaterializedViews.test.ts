/**
 * MaterializedViewsManager Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { MaterializedViewsManager } from '../../../src/search/MaterializedViews.js';

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
