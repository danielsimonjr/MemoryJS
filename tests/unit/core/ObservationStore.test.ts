/**
 * ObservationStore Smoke Tests
 */

import { describe, it, expect } from 'vitest';
import { ObservationStore } from '../../../src/core/ObservationStore.js';

describe('ObservationStore', () => {
  it('intern returns a stable hash for identical content', () => {
    const store = new ObservationStore();
    const a = store.intern('hello world');
    const b = store.intern('hello world');
    expect(a).toBe(b);
    expect(store.refCount(a)).toBe(2);
    expect(store.size()).toBe(1);
  });

  it('intern returns different hashes for different content', () => {
    const store = new ObservationStore();
    const a = store.intern('hello');
    const b = store.intern('world');
    expect(a).not.toBe(b);
    expect(store.size()).toBe(2);
  });

  it('get returns the original content', () => {
    const store = new ObservationStore();
    const h = store.intern('Created on 2025-01-15');
    expect(store.get(h)).toBe('Created on 2025-01-15');
  });

  it('release decrements refCount and removes the entry at zero', () => {
    const store = new ObservationStore();
    const h = store.intern('x');
    store.intern('x'); // refCount=2
    expect(store.release(h)).toBe('decremented');
    expect(store.release(h)).toBe('removed');
    expect(store.size()).toBe(0);
    expect(store.get(h)).toBeUndefined();
  });

  it('release on unknown hash returns "unknown"', () => {
    const store = new ObservationStore();
    expect(store.release('deadbeef')).toBe('unknown');
  });

  it('intern after full release recreates the entry with refCount=1', () => {
    const store = new ObservationStore();
    const h1 = store.intern('roundtrip');
    store.release(h1);
    expect(store.size()).toBe(0);
    const h2 = store.intern('roundtrip');
    expect(h2).toBe(h1); // SHA-256 stable across re-add
    expect(store.refCount(h2)).toBe(1);
  });

  it('stats reflects unique observations and bytes saved', () => {
    const store = new ObservationStore();
    const dup = 'duplicated content of some length';
    store.intern(dup);
    store.intern(dup);
    store.intern(dup);
    store.intern('unique content');
    const stats = store.stats();
    expect(stats.uniqueObservations).toBe(2);
    expect(stats.totalReferences).toBe(4);
    expect(stats.dedupRatio).toBe(2);
    expect(stats.bytesSaved).toBe(dup.length * 2); // 3 refs - 1 unique = 2 dup-saves
  });

  it('internAll / getAll round-trip an array', () => {
    const store = new ObservationStore();
    const inputs = ['a', 'b', 'c', 'a'];
    const hashes = store.internAll(inputs);
    expect(hashes).toHaveLength(4);
    expect(hashes[0]).toBe(hashes[3]); // 'a' deduped
    const resolved = store.getAll(hashes);
    expect(resolved).toEqual(['a', 'b', 'c', 'a']);
  });

  it('clear drops every entry', () => {
    const store = new ObservationStore();
    store.intern('keep');
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('static hash is stable and matches the instance hash', () => {
    const store = new ObservationStore();
    const expected = ObservationStore.hash('content');
    const actual = store.intern('content');
    expect(actual).toBe(expected);
  });
});
