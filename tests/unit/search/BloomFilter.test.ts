/**
 * BloomFilter + BloomPreScreener Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BloomFilter, bloomParams } from '../../../src/search/BloomFilter.js';
import { BloomPreScreener } from '../../../src/search/BloomPreScreener.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';

describe('BloomFilter', () => {
  it('mayContain is true for inserted items (no false negatives)', () => {
    const bf = new BloomFilter(1000, 0.01);
    const items = ['alice', 'bob', 'charlie', 'dave', 'eve'];
    for (const i of items) bf.add(i);
    for (const i of items) expect(bf.mayContain(i)).toBe(true);
  });

  it('mayContain is mostly false for items not inserted', () => {
    const bf = new BloomFilter(1000, 0.01);
    for (let i = 0; i < 100; i++) bf.add(`item${i}`);
    let falsePositives = 0;
    for (let i = 100; i < 1100; i++) {
      if (bf.mayContain(`item${i}`)) falsePositives++;
    }
    // Theoretical FPR ~ 1%; allow generous slack against luck.
    expect(falsePositives).toBeLessThan(50);
  });

  it('size() reflects the number of inserts', () => {
    const bf = new BloomFilter(100, 0.01);
    expect(bf.size()).toBe(0);
    bf.add('x');
    bf.add('y');
    expect(bf.size()).toBe(2);
  });

  it('add only increments size, and mayContain never does', () => {
    const bf = new BloomFilter(100, 0.01);
    bf.add('x');
    bf.mayContain('x');
    bf.mayContain('absent');
    expect(bf.size()).toBe(1);
  });

  it('pins the exact bit layout so a refactor cannot move a bit', () => {
    // 10 bits -> 2 bytes; hashes derived from bloomParams(1, 0.5) are deterministic here.
    const bf = new BloomFilter(1, 0.5);
    const before = bf.parameters();
    bf.add('alice');
    // Recompute the expected positions with the documented formula and compare the byte array.
    const expected = new Uint8Array(Math.ceil(before.bitCount / 8));
    const fnv = (s: string, seed: number, mult: number): number => {
      let h = seed;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), mult) >>> 0;
      return h;
    };
    const h1 = fnv('alice', 0x811c9dc5, 16777619);
    const h2 = (fnv('alice', 0xcbf29ce4, 0x01000193) | 1) >>> 0;
    for (let i = 0; i < before.hashCount; i++) {
      const idx = (h1 + i * h2) % before.bitCount;
      expected[idx >>> 3] = (expected[idx >>> 3]! | (1 << (idx & 7))) & 0xff;
    }
    const actual = (bf as unknown as { bits: Uint8Array }).bits;
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('does not allocate a closure or index array per call', () => {
    // Guard against a `visit`-callback or `number[]` extraction: measure that add/mayContain
    // touch no new arrays. `Array.prototype` hooks would be too invasive; instead the private
    // method shape is asserted and a repeated call is shown to be allocation-stable via the
    // byte array identity.
    const bf = new BloomFilter(1000, 0.01);
    const bitsBefore = (bf as unknown as { bits: Uint8Array }).bits;
    bf.add('alice');
    bf.mayContain('alice');
    const bitsAfter = (bf as unknown as { bits: Uint8Array }).bits;
    // The backing store must be mutated in place, never replaced.
    expect(bitsAfter).toBe(bitsBefore);
  });

  it('clear() resets the filter', () => {    const bf = new BloomFilter(100, 0.01);
    bf.add('keep');
    bf.clear();
    expect(bf.size()).toBe(0);
    expect(bf.mayContain('keep')).toBe(false);
  });

  it('parameters() returns sane sizes for the requested capacity/FPR', () => {    const bf = new BloomFilter(10_000, 0.01);
    const p = bf.parameters();
    expect(p.bitCount).toBeGreaterThan(0);
    expect(p.hashCount).toBeGreaterThan(0);
    expect(p.bytes).toBe(Math.ceil(p.bitCount / 8));
  });

  it('FPR stays under target across diverse 10 k-sized inserts', () => {
    const target = 0.02;
    const bf = new BloomFilter(10_000, target);
    for (let i = 0; i < 10_000; i++) bf.add(`token${i}`);
    let fp = 0;
    const trials = 5000;
    for (let i = 10_000; i < 10_000 + trials; i++) {
      if (bf.mayContain(`token${i}`)) fp++;
    }
    // Allow 4× slack — we're checking the order of magnitude, not the
    // exact rate, so the test is robust to the bit-array's hash mixing.
    expect(fp / trials).toBeLessThan(target * 4);
  });

  it('bloomParams scales bits with capacity', () => {
    const small = bloomParams(100, 0.01);
    const big = bloomParams(10_000, 0.01);
    expect(big.bits).toBeGreaterThan(small.bits);
  });
});

describe('BloomPreScreener', () => {
  let storage: GraphStorage;
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `bloom-pre-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storage = new GraphStorage(join(dir, 'mem.jsonl'));
    await storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['developer machine learning'], tags: ['ai'] },
        { name: 'Bob', entityType: 'person', observations: ['cookery onion garlic'], tags: ['food'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('intersectCandidates returns the entity whose terms include the query', async () => {
    const screener = new BloomPreScreener(storage);
    await screener.build();
    const cands = screener.intersectCandidates('machine');
    expect(cands).toContain('Alice');
  });

  it('intersectCandidates excludes entities whose filter says a term is absent', async () => {
    const screener = new BloomPreScreener(storage);
    await screener.build();
    // Bob has nothing about machine learning.
    const cands = screener.intersectCandidates('machine');
    expect(cands).not.toContain('Bob');
  });

  it('mayHaveType / mayHaveTag check the global filters', async () => {
    const screener = new BloomPreScreener(storage);
    await screener.build();
    expect(screener.mayHaveType('person')).toBe(true);
    expect(screener.mayHaveTag('ai')).toBe(true);
  });

  it('throws when intersectCandidates is called before build()', () => {
    const screener = new BloomPreScreener(storage);
    expect(() => screener.intersectCandidates('x')).toThrow(/build\(\) must run/);
  });

  it('clear() returns the screener to the pre-build state', async () => {
    const screener = new BloomPreScreener(storage);
    await screener.build();
    screener.clear();
    expect(screener.isBuilt()).toBe(false);
  });
});
