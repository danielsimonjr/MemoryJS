/**
 * IColumnStore + reference impl tests
 *
 * Covers Phase 8 task 64: interface contract + InMemoryColumnStore.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryColumnStore,
  type ObservationColumn,
} from '../../../../src/core/columns/IColumnStore.js';

describe('InMemoryColumnStore', () => {
  it('get returns undefined for absent keys', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    expect(await store.get('alice')).toBeUndefined();
  });

  it('put then get round-trips the value', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', ['coffee', 'TechCo']);
    expect(await store.get('alice')).toEqual(['coffee', 'TechCo']);
  });

  it('put replaces the prior value (last-write-wins)', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', ['v1']);
    await store.put('alice', ['v2']);
    expect(await store.get('alice')).toEqual(['v2']);
  });

  it('has reflects presence', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    expect(await store.has('alice')).toBe(false);
    await store.put('alice', []);
    expect(await store.has('alice')).toBe(true);
  });

  it('has returns true for explicit empty values (distinct from absent)', async () => {
    // Important — observations: [] is a legitimate value (entity exists
    // but has no observations). Distinguishing it from "no column entry"
    // (use inline fallback) matters for the read-path integration.
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', []);
    expect(await store.has('alice')).toBe(true);
    expect(await store.get('alice')).toEqual([]);
  });

  it('delete removes the entry and reports whether it was there', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    expect(await store.delete('ghost')).toBe(false);
    await store.put('alice', ['x']);
    expect(await store.delete('alice')).toBe(true);
    expect(await store.has('alice')).toBe(false);
  });

  it('batchPut writes every entry', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.batchPut([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
      { name: 'carol', value: ['c'] },
    ]);
    expect(await store.size()).toBe(3);
    expect(await store.get('bob')).toEqual(['b']);
  });

  it('batchPut on empty array is a no-op', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.batchPut([]);
    expect(await store.size()).toBe(0);
  });

  it('keys iterates every name', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', []);
    await store.put('bob', []);
    const names: string[] = [];
    for await (const k of store.keys()) names.push(k);
    expect(names.sort()).toEqual(['alice', 'bob']);
  });

  it('entries returns every (name, value) pair', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', ['a']);
    await store.put('bob', ['b']);
    const list = await store.entries();
    expect(list.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'alice', value: ['a'] },
      { name: 'bob', value: ['b'] },
    ]);
  });

  it('size reflects entry count', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    expect(await store.size()).toBe(0);
    await store.put('a', []);
    await store.put('b', []);
    expect(await store.size()).toBe(2);
    await store.delete('a');
    expect(await store.size()).toBe(1);
  });

  it('clear drops every entry', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', ['x']);
    await store.put('bob', ['y']);
    await store.clear();
    expect(await store.size()).toBe(0);
    expect(await store.has('alice')).toBe(false);
  });

  it('generic over value type — works with arbitrary T', async () => {
    interface Profile { age: number; role: string }
    const store = new InMemoryColumnStore<Profile>();
    await store.put('alice', { age: 30, role: 'eng' });
    const got = await store.get('alice');
    expect(got).toEqual({ age: 30, role: 'eng' });
  });

  it('stores 1000 entries without dropping any', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      name: `e${i}`,
      value: [`obs-${i}`],
    }));
    await store.batchPut(entries);
    expect(await store.size()).toBe(1000);
    expect(await store.get('e500')).toEqual(['obs-500']);
  });
});
