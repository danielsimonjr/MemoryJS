/**
 * DiskWarmTier append mode + compaction tests
 *
 * Covers DES-14: `compactEvery` appends one record per put/delete and rewrites
 * the whole file once the threshold is reached. Also covers the wire
 * compatibility rules: a default-mode file loads in append mode, the compacted
 * file matches a fresh full write byte for byte, and a torn final line is
 * tolerated on load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { DiskWarmTier } from '../../../../src/search/tiered/DiskWarmTier.js';

async function readLines(path: string): Promise<string[]> {
  const raw = await fs.readFile(path, 'utf-8');
  return raw.split('\n').filter(line => line !== '');
}

describe('DiskWarmTier append mode (compactEvery)', () => {
  let dir: string;
  let sidecar: string;
  let reference: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), `warm-compact-${randomBytes(4).toString('hex')}-`));
    sidecar = join(dir, 'warm.jsonl');
    reference = join(dir, 'reference.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rejects a non-positive compactEvery', () => {
    expect(() => new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 0 })).toThrow(RangeError);
    expect(() => new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 1.5 })).toThrow(RangeError);
  });

  it('append then reload round-trips values and last-wins overwrites', async () => {
    const tier = new DiskWarmTier<{ postings: number[] }>({ filePath: sidecar, compactEvery: 100 });
    await tier.put('alice', { postings: [1] });
    await tier.put('bob', { postings: [2] });
    await tier.put('alice', { postings: [1, 4, 7] });

    // Three puts append three lines, with no rewrite.
    expect(await readLines(sidecar)).toHaveLength(3);

    const reloaded = new DiskWarmTier<{ postings: number[] }>({ filePath: sidecar, compactEvery: 100 });
    expect(await reloaded.get('alice')).toEqual({ postings: [1, 4, 7] });
    expect(await reloaded.get('bob')).toEqual({ postings: [2] });
    expect(await reloaded.size()).toBe(2);
  });

  it('delete appends a tombstone and the key is absent after reload', async () => {
    const tier = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(await tier.delete('a')).toBe(true);
    expect(await readLines(sidecar)).toHaveLength(3);

    const reloaded = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    expect(await reloaded.has('a')).toBe(false);
    expect(await reloaded.get('b')).toBe(2);
  });

  it('compaction triggers at the threshold and shrinks the file to the live entries', async () => {
    const tier = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 5 });
    for (let i = 0; i < 4; i++) await tier.put('hot', i);
    // Four appends are below the threshold of five, so the file keeps four lines.
    expect(await readLines(sidecar)).toHaveLength(4);

    // The fifth record reaches the threshold and triggers a full rewrite.
    await tier.put('hot', 4);
    expect(await readLines(sidecar)).toHaveLength(1);

    await tier.put('cold', 9);
    const reloaded = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 5 });
    expect(await reloaded.get('hot')).toBe(4);
    expect(await reloaded.get('cold')).toBe(9);
  });

  it('a compacted file is byte-equivalent to a fresh full write of the same entries', async () => {
    const appendTier = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 3 });
    await appendTier.put('a', 1);
    await appendTier.put('b', 2);
    await appendTier.put('a', 3); // third record: compaction, order becomes b, a

    const fullTier = new DiskWarmTier<number>({ filePath: reference });
    await fullTier.put('b', 2);
    await fullTier.put('a', 3);

    expect(await fs.readFile(sidecar, 'utf-8')).toBe(await fs.readFile(reference, 'utf-8'));
  });

  it('eviction under append mode tombstones the evicted key and still calls onEvict', async () => {
    const evicted: Array<[string, number]> = [];
    const tier = new DiskWarmTier<number>({
      filePath: sidecar,
      compactEvery: 100,
      maxEntries: 2,
      onEvict: (k, v) => evicted.push([k, v]),
    });
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.put('c', 3);

    expect(evicted).toEqual([['a', 1]]);
    expect(tier.getEvictionCount()).toBe(1);

    const reloaded = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100, maxEntries: 2 });
    expect(await reloaded.has('a')).toBe(false);
    expect(await reloaded.get('b')).toBe(2);
    expect(await reloaded.get('c')).toBe(3);
  });

  it('a file written by default mode loads unchanged in append mode', async () => {
    const full = new DiskWarmTier<number>({ filePath: sidecar });
    await full.put('x', 10);
    await full.put('y', 20);
    const before = await fs.readFile(sidecar, 'utf-8');

    const appendMode = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 50 });
    expect(await appendMode.get('x')).toBe(10);
    expect(await appendMode.get('y')).toBe(20);
    expect(await fs.readFile(sidecar, 'utf-8')).toBe(before);
  });

  it('tolerates a torn final line from a crash and does not merge the next append into it', async () => {
    await fs.writeFile(sidecar, '{"k":"a","v":1}\n{"k":"b","v":2}\n{"k":"c","v"');

    const tier = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    expect(await tier.get('a')).toBe(1);
    expect(await tier.get('b')).toBe(2);
    expect(await tier.has('c')).toBe(false);

    await tier.put('d', 4);

    const reloaded = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    expect(await reloaded.get('a')).toBe(1);
    expect(await reloaded.get('b')).toBe(2);
    expect(await reloaded.has('c')).toBe(false);
    expect(await reloaded.get('d')).toBe(4);
  });

  it('clear in append mode leaves an empty file that reloads empty', async () => {
    const tier = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    await tier.put('a', 1);
    await tier.clear();
    expect(await fs.readFile(sidecar, 'utf-8')).toBe('');
    const reloaded = new DiskWarmTier<number>({ filePath: sidecar, compactEvery: 100 });
    expect(await reloaded.size()).toBe(0);
  });
});
