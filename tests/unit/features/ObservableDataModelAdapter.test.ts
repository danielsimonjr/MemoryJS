/**
 * ObservableDataModelAdapter Unit Tests
 *
 * NC Path C integration: adapter that exposes a memoryjs GraphStorage as
 * a JSON-UI ObservableDataModel-shaped object so DataProvider can bind
 * to it in external-store mode via useSyncExternalStore.
 *
 * Tests cover:
 * - Factory awaits loadGraph once and returns a usable adapter
 * - Initial snapshot reflects entities already in storage
 * - snapshot() is identity-stable between mutations
 * - snapshot() returns a new reference after a mutation
 * - get(path) walks the projected shape via slash-separated paths
 * - get("") and empty paths return undefined
 * - subscribe fires synchronously on entity:created
 * - subscribe fires on entity:updated, entity:deleted, relation:created, relation:deleted
 * - Two subscribers receive independent notifications
 * - Registering the same callback twice produces two independent subscriptions
 * - Unsubscribing stops future notifications for that listener only
 * - set() and delete() throw ReadOnlyMemoryGraphDataError
 * - A throwing projection is logged via onError and produces an empty snapshot
 * - A throwing listener does not block other listeners
 * - dispose() releases the storage subscription and makes the adapter inert
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import {
  createObservableDataModelFromGraph,
  ReadOnlyMemoryGraphDataError,
  type GraphProjection,
} from '../../../src/features/ObservableDataModelAdapter.js';
import type { Entity } from '../../../src/types/types.js';

// ==================== Test harness ====================

let tempDir: string;
let storagePath: string;
let storage: GraphStorage;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(tmpdir(), 'memoryjs-adapter-'));
  storagePath = join(tempDir, 'memory.jsonl');
  storage = new GraphStorage(storagePath);
  // Seed an empty graph file so loadGraph succeeds.
  await storage.saveGraph({ entities: [], relations: [] });
});

afterEach(async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Dropbox/antivirus file locking on Windows — ignore.
  }
});

const SIMPLE_PROJECTION: GraphProjection = (entities) => ({
  entityCount: entities.length,
  names: entities.map((e) => e.name),
});

const USER_PROJECTION: GraphProjection = (entities) => {
  const user = entities.find((e) => e.entityType === 'user');
  return {
    userName: user?.name ?? null,
    messageCount: entities.filter((e) => e.entityType === 'message').length,
  };
};

function makeEntity(
  name: string,
  entityType: string,
  observations: string[] = [],
): Entity {
  return {
    name,
    entityType,
    observations,
    createdAt: new Date().toISOString(),
  };
}

// ==================== Factory and initial state ====================

describe('createObservableDataModelFromGraph — factory', () => {
  it('returns a usable adapter after a single loadGraph warm-up', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.snapshot).toBe('function');
    expect(typeof adapter.subscribe).toBe('function');
    expect(typeof adapter.dispose).toBe('function');
    adapter.dispose();
  });

  it('initial snapshot reflects entities already in storage at construction time', async () => {
    await storage.saveGraph({
      entities: [makeEntity('Alice', 'user'), makeEntity('m1', 'message')],
      relations: [],
    });
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    expect(adapter.snapshot()).toEqual({
      entityCount: 2,
      names: ['Alice', 'm1'],
    });
    adapter.dispose();
  });
});

// ==================== Snapshot identity stability ====================

describe('adapter.snapshot — identity stability', () => {
  it('returns the same reference across repeated calls with no mutation between', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    const a = adapter.snapshot();
    const b = adapter.snapshot();
    const c = adapter.snapshot();
    expect(a).toBe(b);
    expect(b).toBe(c);
    adapter.dispose();
  });

  it('returns a NEW reference after a mutation event fires', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    const before = adapter.snapshot();
    // Fire an entity:created event directly so we do not depend on the
    // full createEntities pipeline in this unit test.
    storage.events.emitEntityCreated(makeEntity('Bob', 'user'));
    const after = adapter.snapshot();
    expect(after).not.toBe(before);
    adapter.dispose();
  });
});

// ==================== get() path walking ====================

describe('adapter.get — path walking', () => {
  it('returns undefined for empty path', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    expect(adapter.get('')).toBeUndefined();
    expect(adapter.get('/')).toBeUndefined();
    adapter.dispose();
  });

  it('reads top-level projected values', async () => {
    await storage.saveGraph({
      entities: [makeEntity('Alice', 'user')],
      relations: [],
    });
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    expect(adapter.get('entityCount')).toBe(1);
    expect(adapter.get('/entityCount')).toBe(1);
    adapter.dispose();
  });

  it('walks into nested objects and arrays', async () => {
    const projection: GraphProjection = (entities) => ({
      user: entities.find((e) => e.entityType === 'user')
        ? { name: entities.find((e) => e.entityType === 'user')!.name }
        : null,
      names: entities.map((e) => e.name),
    });
    await storage.saveGraph({
      entities: [makeEntity('Alice', 'user'), makeEntity('Bob', 'user')],
      relations: [],
    });
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection,
    });
    expect(adapter.get('user/name')).toBe('Alice');
    expect(adapter.get('names/0')).toBe('Alice');
    expect(adapter.get('names/1')).toBe('Bob');
    expect(adapter.get('names/2')).toBeUndefined();
    adapter.dispose();
  });

  it('returns undefined for missing intermediate keys', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: () => ({ a: { b: 'c' } as never }),
    });
    expect(adapter.get('a/b')).toBe('c');
    expect(adapter.get('a/missing')).toBeUndefined();
    expect(adapter.get('nonexistent/path')).toBeUndefined();
    adapter.dispose();
  });
});

// ==================== Subscribe / notify ====================

describe('adapter.subscribe — notifications', () => {
  it('fires on entity:created synchronously with the emit call', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let fireCount = 0;
    adapter.subscribe(() => fireCount++);
    // Synchronous emit → synchronous listener fire.
    storage.events.emitEntityCreated(makeEntity('Alice', 'user'));
    expect(fireCount).toBe(1);
    adapter.dispose();
  });

  it('fires on entity:updated, entity:deleted, relation:created, relation:deleted', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let fireCount = 0;
    adapter.subscribe(() => fireCount++);
    storage.events.emitEntityUpdated('Alice', { observations: ['new fact'] });
    storage.events.emitEntityDeleted('Bob');
    storage.events.emitRelationCreated({
      from: 'Alice',
      to: 'Bob',
      relationType: 'knows',
    });
    storage.events.emitRelationDeleted({
      from: 'Alice',
      to: 'Bob',
      relationType: 'knows',
    });
    expect(fireCount).toBe(4);
    adapter.dispose();
  });

  it('two subscribers receive independent notifications', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let a = 0;
    let b = 0;
    adapter.subscribe(() => a++);
    adapter.subscribe(() => b++);
    storage.events.emitEntityCreated(makeEntity('X', 'user'));
    expect(a).toBe(1);
    expect(b).toBe(1);
    adapter.dispose();
  });

  it('registering the same callback twice produces two independent subscriptions', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let fireCount = 0;
    const cb = () => fireCount++;
    adapter.subscribe(cb);
    adapter.subscribe(cb);
    storage.events.emitEntityCreated(makeEntity('X', 'user'));
    expect(fireCount).toBe(2);
    adapter.dispose();
  });

  it('unsubscribing stops future notifications for that listener only', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let a = 0;
    let b = 0;
    const unsubA = adapter.subscribe(() => a++);
    adapter.subscribe(() => b++);
    storage.events.emitEntityCreated(makeEntity('X', 'user'));
    expect(a).toBe(1);
    expect(b).toBe(1);
    unsubA();
    storage.events.emitEntityCreated(makeEntity('Y', 'user'));
    expect(a).toBe(1); // did not fire
    expect(b).toBe(2); // fired
    adapter.dispose();
  });
});

// ==================== Read-only enforcement ====================

describe('adapter.set / adapter.delete — read-only enforcement', () => {
  it('set throws ReadOnlyMemoryGraphDataError with the offending path', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    try {
      adapter.set('user/name', 'Alice');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReadOnlyMemoryGraphDataError);
      expect((err as Error).message).toContain('user/name');
      expect((err as Error).message).toContain('withTransaction');
    }
    adapter.dispose();
  });

  it('delete throws ReadOnlyMemoryGraphDataError', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    expect(() => adapter.delete('user/name')).toThrow(
      ReadOnlyMemoryGraphDataError,
    );
    adapter.dispose();
  });
});

// ==================== Error isolation ====================

describe('adapter error handling', () => {
  it('a throwing projection is logged via onError and falls back to an empty snapshot', async () => {
    const errors: Error[] = [];
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: () => {
        throw new Error('projection boom');
      },
      onError: (err) => errors.push(err),
    });
    const snap = adapter.snapshot();
    expect(snap).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('projection boom');
    adapter.dispose();
  });

  it('a throwing listener does not block other listeners', async () => {
    const errors: Error[] = [];
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
      onError: (err) => errors.push(err),
    });
    let bFired = false;
    adapter.subscribe(() => {
      throw new Error('listener a boom');
    });
    adapter.subscribe(() => {
      bFired = true;
    });
    storage.events.emitEntityCreated(makeEntity('X', 'user'));
    expect(bFired).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('listener a boom');
    adapter.dispose();
  });
});

// ==================== Lifecycle ====================

describe('adapter.dispose', () => {
  it('is idempotent — calling twice does not throw', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    adapter.dispose();
    expect(() => adapter.dispose()).not.toThrow();
  });

  it('stops firing notifications after dispose', async () => {
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: SIMPLE_PROJECTION,
    });
    let fireCount = 0;
    adapter.subscribe(() => fireCount++);
    adapter.dispose();
    storage.events.emitEntityCreated(makeEntity('X', 'user'));
    expect(fireCount).toBe(0);
  });
});

// ==================== Realistic NC-shaped projection ====================

describe('NC-shaped projection — user + messages', () => {
  it('projects a mixed-entity graph into a flat view', async () => {
    await storage.saveGraph({
      entities: [
        makeEntity('Alice', 'user'),
        makeEntity('m1', 'message'),
        makeEntity('m2', 'message'),
        makeEntity('m3', 'message'),
      ],
      relations: [],
    });
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: USER_PROJECTION,
    });
    expect(adapter.snapshot()).toEqual({
      userName: 'Alice',
      messageCount: 3,
    });
    expect(adapter.get('userName')).toBe('Alice');
    expect(adapter.get('messageCount')).toBe(3);
    adapter.dispose();
  });

  it('reflects a new message after emitEntityCreated', async () => {
    await storage.saveGraph({
      entities: [makeEntity('Alice', 'user'), makeEntity('m1', 'message')],
      relations: [],
    });
    const adapter = await createObservableDataModelFromGraph(storage, {
      projection: USER_PROJECTION,
    });
    expect(adapter.get('messageCount')).toBe(1);

    // Mutate through the real entity manager path so the storage cache
    // is updated before the event fires.
    const graph = await storage.getGraphForMutation();
    graph.entities.push(makeEntity('m2', 'message'));
    await storage.saveGraph(graph);
    storage.events.emitEntityCreated(makeEntity('m2', 'message'));

    expect(adapter.get('messageCount')).toBe(2);
    adapter.dispose();
  });
});
