/**
 * JsonlColumnStore tests
 *
 * Covers Phase 8 task 65: durable JSONL sidecar implementation of
 * `IColumnStore<T>`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { JsonlColumnStore } from '../../../../src/core/columns/JsonlColumnStore.js';
import type { ObservationColumn } from '../../../../src/core/columns/IColumnStore.js';

describe('JsonlColumnStore', () => {
  let dir: string;
  let sidecar: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), `jsonl-column-store-${randomBytes(4).toString('hex')}-`));
    sidecar = join(dir, 'memory.observations.jsonl');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('put writes a JSONL line to the sidecar that can be re-read', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.put('alice', ['likes coffee', 'works at TechCo']);

    const raw = await fs.readFile(sidecar, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      name: 'alice',
      value: ['likes coffee', 'works at TechCo'],
    });
  });

  it('loads existing sidecar on construct — get returns stored value', async () => {
    await fs.writeFile(
      sidecar,
      JSON.stringify({ name: 'alice', value: ['x', 'y'] }) + '\n' +
      JSON.stringify({ name: 'bob', value: ['z'] }) + '\n',
      'utf-8',
    );
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await store.get('alice')).toEqual(['x', 'y']);
    expect(await store.get('bob')).toEqual(['z']);
    expect(await store.size()).toBe(2);
  });

  it('missing sidecar file = empty store, no throw', async () => {
    const ghost = join(dir, 'does-not-exist.jsonl');
    const store = new JsonlColumnStore<ObservationColumn>(ghost);
    expect(await store.get('alice')).toBeUndefined();
    expect(await store.size()).toBe(0);
  });

  it('delete rewrites the sidecar without the removed entry', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.put('alice', ['a']);
    await store.put('bob', ['b']);
    const removed = await store.delete('alice');
    expect(removed).toBe(true);

    const raw = await fs.readFile(sidecar, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ name: 'bob', value: ['b'] });
  });

  it('delete on absent key returns false and does not rewrite', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.put('alice', ['a']);
    const beforeStat = await fs.stat(sidecar);

    // ensure a measurable mtime gap on fast filesystems
    await new Promise((r) => setTimeout(r, 10));

    const removed = await store.delete('ghost');
    expect(removed).toBe(false);

    const afterStat = await fs.stat(sidecar);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('batchPut flushes the sidecar exactly once for the whole batch', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);

    // Spy on fs.rename — every flush calls it once. After ensureLoaded
    // primes the cache (no rename), batchPut should produce exactly one
    // rename call.
    await store.size(); // prime the cache (loads, no write)
    const renameSpy = vi.spyOn(fs, 'rename');

    await store.batchPut([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
      { name: 'carol', value: ['c'] },
    ]);

    expect(renameSpy).toHaveBeenCalledTimes(1);
    renameSpy.mockRestore();

    const raw = await fs.readFile(sidecar, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(3);
  });

  it('skips malformed JSON lines on load and logs a warning', async () => {
    await fs.writeFile(
      sidecar,
      JSON.stringify({ name: 'alice', value: ['good'] }) + '\n' +
      '{this is not valid json\n' +
      JSON.stringify({ name: 'bob', value: ['also good'] }) + '\n',
      'utf-8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await store.get('alice')).toEqual(['good']);
    expect(await store.get('bob')).toEqual(['also good']);
    expect(await store.size()).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('malformed');

    warnSpy.mockRestore();
  });

  it('skips lines with non-string name on load', async () => {
    await fs.writeFile(
      sidecar,
      JSON.stringify({ name: 123, value: ['bad'] }) + '\n' +
      JSON.stringify({ name: 'alice', value: ['good'] }) + '\n',
      'utf-8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await store.size()).toBe(1);
    expect(await store.get('alice')).toEqual(['good']);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('clear empties the cache and truncates the sidecar', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.batchPut([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
    ]);
    await store.clear();
    expect(await store.size()).toBe(0);
    expect(await store.get('alice')).toBeUndefined();

    const raw = await fs.readFile(sidecar, 'utf-8');
    expect(raw).toBe('');
  });

  it('works with non-string-array generic T (number values)', async () => {
    const store = new JsonlColumnStore<number>(sidecar);
    await store.put('alice', 42);
    await store.put('bob', -7);

    const raw = await fs.readFile(sidecar, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { name: 'alice', value: 42 },
      { name: 'bob', value: -7 },
    ]);

    const reloaded = new JsonlColumnStore<number>(sidecar);
    expect(await reloaded.get('alice')).toBe(42);
    expect(await reloaded.get('bob')).toBe(-7);
  });

  it('works with structured object generic T', async () => {
    interface Meta { score: number; tags: string[] }
    const store = new JsonlColumnStore<Meta>(sidecar);
    await store.put('alice', { score: 0.91, tags: ['vip', 'eng'] });
    const reloaded = new JsonlColumnStore<Meta>(sidecar);
    expect(await reloaded.get('alice')).toEqual({ score: 0.91, tags: ['vip', 'eng'] });
  });

  it('round-trips 100 entries via batchPut and reload', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    const entries = Array.from({ length: 100 }, (_, i) => ({
      name: `entity-${i}`,
      value: [`obs-${i}-a`, `obs-${i}-b`],
    }));
    await store.batchPut(entries);
    expect(await store.size()).toBe(100);

    const reloaded = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await reloaded.size()).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(await reloaded.get(`entity-${i}`)).toEqual([`obs-${i}-a`, `obs-${i}-b`]);
    }
  });

  it('put replaces a prior value (last-write-wins)', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.put('alice', ['v1']);
    await store.put('alice', ['v2']);
    expect(await store.get('alice')).toEqual(['v2']);

    const reloaded = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await reloaded.get('alice')).toEqual(['v2']);
    expect(await reloaded.size()).toBe(1);
  });

  it('has reflects presence including explicit empty values', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await store.has('alice')).toBe(false);
    await store.put('alice', []);
    expect(await store.has('alice')).toBe(true);
    expect(await store.get('alice')).toEqual([]);

    const reloaded = new JsonlColumnStore<ObservationColumn>(sidecar);
    expect(await reloaded.has('alice')).toBe(true);
    expect(await reloaded.get('alice')).toEqual([]);
  });

  it('keys() yields every stored name', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.batchPut([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
      { name: 'carol', value: ['c'] },
    ]);
    const seen: string[] = [];
    for await (const k of store.keys()) seen.push(k);
    expect(seen.sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('entries() returns a full snapshot', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecar);
    await store.batchPut([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
    ]);
    const snapshot = await store.entries();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.find((e) => e.name === 'alice')?.value).toEqual(['a']);
    expect(snapshot.find((e) => e.name === 'bob')?.value).toEqual(['b']);
  });
});
