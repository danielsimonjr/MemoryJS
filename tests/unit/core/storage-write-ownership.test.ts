/**
 * Write ownership of the storage backends.
 *
 * `saveGraph` and the append methods keep a copy of the objects that the
 * caller gives them. A later change to a caller object does not reach the
 * cache, and a later write of the same name does not change a caller object.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../src/types/index.js';

type Storage = GraphStorage | SQLiteStorage;

const backends: Array<[string, (dir: string) => Storage]> = [
  ['GraphStorage', dir => new GraphStorage(join(dir, 'graph.jsonl'))],
  ['SQLiteStorage', dir => new SQLiteStorage(join(dir, 'graph.db'))],
];

const note = (name: string, observations: string[]): Entity => ({
  name,
  entityType: 'note',
  observations,
  tags: ['t'],
});

describe.each(backends)('%s write ownership', (_label, make) => {
  let dir: string;
  let storage: Storage;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'memoryjs-ownership-'));
    storage = make(dir);
    await storage.ensureLoaded();
  });

  afterEach(async () => {
    if (storage instanceof SQLiteStorage) storage.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const cachedEntity = async (name: string) =>
    (await storage.loadGraph()).entities.find(e => e.name === name);
  const cachedRelation = async (relationType: string) =>
    (await storage.loadGraph()).relations.find(r => r.relationType === relationType);

  it('saveGraph keeps no reference to the caller graph', async () => {
    const graph: KnowledgeGraph = { entities: [note('a', ['one'])], relations: [] };
    await storage.saveGraph(graph);
    graph.entities[0].observations.push('changed');
    graph.entities[0].entityType = 'changed';
    graph.entities.push(note('b', []));
    expect(await cachedEntity('a')).toMatchObject({ entityType: 'note', observations: ['one'] });
    expect(await cachedEntity('b')).toBeUndefined();
    expect(storage.getEntityByName('b')).toBeUndefined();
  });

  it('an append of a saved name leaves the caller object unchanged', async () => {
    const a = note('a', ['one']);
    await storage.saveGraph({ entities: [a], relations: [] });
    await storage.appendEntity({ name: 'a', entityType: 'other', observations: ['two'] });
    expect(a).toEqual(note('a', ['one']));
    expect(await cachedEntity('a')).toMatchObject({ entityType: 'other', observations: ['two'] });
  });

  it('appendEntity and appendEntities keep no reference to the caller entity', async () => {
    const a = note('a', ['one']);
    const b = note('b', ['two']);
    await storage.appendEntity(a);
    await storage.appendEntities([b]);
    a.observations.push('changed');
    b.tags!.push('changed');
    expect((await cachedEntity('a'))!.observations).toEqual(['one']);
    expect((await cachedEntity('b'))!.tags).toEqual(['t']);
  });

  it('a second append of a name leaves the first caller object unchanged', async () => {
    const first = note('a', ['one']);
    await storage.appendEntity(first);
    const second: Entity = { name: 'a', entityType: 'other', observations: ['two'] };
    await storage.appendEntity(second);
    second.observations.push('changed');
    expect(first).toEqual(note('a', ['one']));
    expect((await cachedEntity('a'))!.observations).toEqual(['two']);
  });

  it('appendRelation and appendRelations keep no reference to the caller relation', async () => {
    await storage.appendEntities([note('a', []), note('b', [])]);
    const r1: Relation = { from: 'a', to: 'b', relationType: 'r1', properties: { source: 'one' } };
    const r2: Relation = { from: 'b', to: 'a', relationType: 'r2', weight: 0.5 };
    await storage.appendRelation(r1);
    await storage.appendRelations([r2]);
    r1.properties!.source = 'changed';
    r2.weight = 0.9;
    expect((await cachedRelation('r1'))!.properties).toEqual({ source: 'one' });
    expect((await cachedRelation('r2'))!.weight).toBe(0.5);
  });

  it('keeps the cache equal to the disk after the caller changes its objects', async () => {
    const graph: KnowledgeGraph = { entities: [note('a', ['one'])], relations: [] };
    await storage.saveGraph(graph);
    const b = note('b', ['two']);
    await storage.appendEntity(b);
    graph.entities[0].observations.push('changed');
    b.observations.push('changed');
    const observationsOf = (g: { entities: readonly Entity[] }) =>
      g.entities.map(e => [e.name, [...e.observations]]);
    const cached = observationsOf(await storage.loadGraph());
    if (storage instanceof SQLiteStorage) storage.close();
    storage = make(dir);
    await storage.ensureLoaded();
    expect(cached).toEqual([['a', ['one']], ['b', ['two']]]);
    expect(observationsOf(await storage.loadGraph())).toEqual(cached);
  });

  it('EntityManager.createEntities returns objects that are not the cache', async () => {
    const manager = new EntityManager(storage as GraphStorage);
    const [created] = await manager.createEntities([note('a', ['one'])]);
    created.observations.push('changed');
    expect((await cachedEntity('a'))!.observations).toEqual(['one']);
  });

  it('SessionManager.getActiveSession shows a storage update of an active session', async () => {
    const sessions = new SessionManager(storage, new WorkingMemoryManager(storage));
    const first = await sessions.startSession({ sessionId: 's1' });
    await sessions.startSession({ sessionId: 's2', previousSessionId: 's1' });

    expect((await sessions.getActiveSession('s1'))!.relatedSessionIds).toEqual(['s2']);
    expect(sessions.getActiveSessions().map(s => s.relatedSessionIds)).toEqual([['s2'], ['s1']]);
    expect(first.relatedSessionIds).toEqual([]);
  });
});
