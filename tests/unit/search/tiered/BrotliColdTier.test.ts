/**
 * BrotliColdTier tests — Phase 9 task 72
 *
 * Covers:
 *  - Round-trip put/get/delete/has/size/clear
 *  - Persistence across instances (write, construct new, read same data)
 *  - Compressed-bytes < uncompressed payload bound
 *  - Snapshot-restore rollback on injected flush failure
 *  - Malformed-after-decompress line tolerance
 *  - reload() picks up external edits
 *  - Generic V works for string, number, array
 *  - Configurable quality is respected (q=1 vs q=11)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BrotliColdTier } from '../../../../src/search/tiered/BrotliColdTier.js';
import { compress } from '../../../../src/utils/compressionUtil.js';
import { injectFlushFailure as sharedInjectFlushFailure } from '../../../test-utils/inject-flush-failure.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `cold-tier-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('BrotliColdTier — construction', () => {
  it('rejects empty filePath', () => {
    expect(() => new BrotliColdTier<number>({ filePath: '' })).toThrow(/filePath/);
  });

  it('rejects out-of-range quality', () => {
    expect(() => new BrotliColdTier<number>({ filePath: '/tmp/x.br', quality: 12 })).toThrow(/quality/);
    expect(() => new BrotliColdTier<number>({ filePath: '/tmp/x.br', quality: -1 })).toThrow(/quality/);
  });

  it('defaults name to "cold"', () => {
    const t = new BrotliColdTier<number>({ filePath: '/tmp/whatever.br' });
    expect(t.name).toBe('cold');
  });

  it('accepts a custom name', () => {
    const t = new BrotliColdTier<number>({ filePath: '/tmp/whatever.br', name: 'frozen' });
    expect(t.name).toBe('frozen');
  });
});

describe('BrotliColdTier — round-trip', () => {
  let dir: string;
  let filePath: string;
  let tier: BrotliColdTier<number>;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'shard.br');
    tier = new BrotliColdTier<number>({ filePath });
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('put + get round-trips a value', async () => {
    await tier.put('alice', 42);
    expect(await tier.get('alice')).toBe(42);
  });

  it('get returns undefined for an absent key', async () => {
    expect(await tier.get('ghost')).toBeUndefined();
  });

  it('put replaces a prior value', async () => {
    await tier.put('alice', 1);
    await tier.put('alice', 2);
    expect(await tier.get('alice')).toBe(2);
  });

  it('delete returns true when something was removed, false otherwise', async () => {
    await tier.put('alice', 1);
    expect(await tier.delete('alice')).toBe(true);
    expect(await tier.delete('alice')).toBe(false);
  });

  it('has reflects presence', async () => {
    expect(await tier.has('alice')).toBe(false);
    await tier.put('alice', 0); // explicit zero — distinct from "absent"
    expect(await tier.has('alice')).toBe(true);
  });

  it('size counts entries across mutations', async () => {
    expect(await tier.size()).toBe(0);
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(await tier.size()).toBe(2);
    await tier.delete('a');
    expect(await tier.size()).toBe(1);
  });

  it('clear drops every entry', async () => {
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.clear();
    expect(await tier.size()).toBe(0);
    expect(await tier.get('a')).toBeUndefined();
  });

  it('clear is a no-op on an empty tier (no disk write)', async () => {
    // No prior data, no flush happens — file should not exist.
    await tier.clear();
    expect(await tier.compressedBytes()).toBe(0);
  });
});

describe('BrotliColdTier — persistence across instances', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'persist.br');
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('a second instance reads what the first one wrote', async () => {
    const first = new BrotliColdTier<string>({ filePath });
    await first.put('alice', 'works at TechCo');
    await first.put('bob', 'likes chess');

    const second = new BrotliColdTier<string>({ filePath });
    expect(await second.get('alice')).toBe('works at TechCo');
    expect(await second.get('bob')).toBe('likes chess');
    expect(await second.size()).toBe(2);
  });

  it('deleting from one instance is visible to a fresh instance', async () => {
    const first = new BrotliColdTier<number>({ filePath });
    await first.put('a', 1);
    await first.put('b', 2);
    await first.delete('a');

    const second = new BrotliColdTier<number>({ filePath });
    expect(await second.has('a')).toBe(false);
    expect(await second.get('b')).toBe(2);
  });

  it('missing file = empty cache, no throw', async () => {
    const tier = new BrotliColdTier<number>({ filePath });
    expect(await tier.size()).toBe(0);
    expect(await tier.get('anything')).toBeUndefined();
  });
});

describe('BrotliColdTier — compression effectiveness', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'compress.br');
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  /**
   * Inverted-index posting list flavoured payload. Brotli should
   * compress this heavily because the repeated field names ("docId",
   * "freq") and the doc-id prefix dominate the byte budget.
   */
  function makePostingPayload(): Array<{ docId: string; freq: number }> {
    const posts: Array<{ docId: string; freq: number }> = [];
    for (let i = 0; i < 20; i++) {
      posts.push({ docId: `entity-${i.toString().padStart(6, '0')}`, freq: (i % 7) + 1 });
    }
    return posts;
  }

  it('compressed shard is smaller than the synthetic uncompressed lower bound', async () => {
    const tier = new BrotliColdTier<Array<{ docId: string; freq: number }>>({ filePath });
    let uncompressedLowerBound = 0;
    for (let i = 0; i < 10; i++) {
      const key = `term-${i.toString().padStart(4, '0')}`;
      const value = makePostingPayload();
      // Approximate the unencoded JSONL line length we'd write — this
      // is the lower bound for what an *uncompressed* JSONL store
      // would take on disk. Brotli should comfortably beat it.
      const line = JSON.stringify({ k: key, v: value });
      uncompressedLowerBound += line.length + 1; // +1 for the trailing newline
      await tier.put(key, value);
    }
    const compressed = await tier.compressedBytes();
    expect(compressed).toBeGreaterThan(0);
    expect(compressed).toBeLessThan(uncompressedLowerBound);
  });

  it('respects configurable quality — q=11 produces <= q=1 size on compressible payload', async () => {
    // Use a deeply-repetitive payload so quality has room to matter.
    const repeats = 'lorem ipsum dolor sit amet '.repeat(200);

    const lowQ = new BrotliColdTier<string>({
      filePath: join(dir, 'q1.br'),
      quality: 1,
    });
    const highQ = new BrotliColdTier<string>({
      filePath: join(dir, 'q11.br'),
      quality: 11,
    });
    for (let i = 0; i < 10; i++) {
      await lowQ.put(`k${i}`, repeats);
      await highQ.put(`k${i}`, repeats);
    }
    const lowBytes = await lowQ.compressedBytes();
    const highBytes = await highQ.compressedBytes();
    expect(highBytes).toBeLessThanOrEqual(lowBytes);
  });

  it('compressedBytes returns 0 when the shard file does not exist', async () => {
    const tier = new BrotliColdTier<number>({ filePath });
    expect(await tier.compressedBytes()).toBe(0);
  });
});

describe('BrotliColdTier — snapshot-restore rollback on flush failure', () => {
  let dir: string;
  let filePath: string;
  let tier: BrotliColdTier<string>;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'rollback.br');
    tier = new BrotliColdTier<string>({ filePath });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  // Shared helper — see `tests/test-utils/inject-flush-failure.ts`.
  const injectFlushFailure = (): void => {
    sharedInjectFlushFailure(filePath);
  };

  it('put: cache rolls back on flush failure (no-prior-value branch)', async () => {
    await tier.put('alice', 'a-1');
    injectFlushFailure();
    await expect(tier.put('bob', 'b-1')).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await tier.has('bob')).toBe(false);
    expect(await tier.get('alice')).toBe('a-1');
  });

  it('put: cache rolls back to prior value (had-prior branch)', async () => {
    await tier.put('alice', 'original');
    injectFlushFailure();
    await expect(tier.put('alice', 'replacement')).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await tier.get('alice')).toBe('original');
  });

  it('delete: cache restores the deleted value on flush failure', async () => {
    await tier.put('alice', 'keepme');
    injectFlushFailure();
    await expect(tier.delete('alice')).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await tier.get('alice')).toBe('keepme');
  });

  it('clear: cache restores every entry on flush failure', async () => {
    await tier.put('alice', 'x');
    await tier.put('bob', 'y');
    injectFlushFailure();
    await expect(tier.clear()).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await tier.size()).toBe(2);
    expect(await tier.get('alice')).toBe('x');
    expect(await tier.get('bob')).toBe('y');
  });
});

describe('BrotliColdTier — malformed line tolerance', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'malformed.br');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('warns and skips malformed lines after decompression', async () => {
    // Hand-craft a JSONL stream with a good line, a malformed line, a
    // good line, and a record with a non-string key. Compress as a
    // single brotli frame so the tier's decompression path sees it.
    const lines = [
      JSON.stringify({ k: 'alice', v: 1 }),
      '{not-json',
      JSON.stringify({ k: 'bob', v: 2 }),
      JSON.stringify({ k: 999, v: 3 }), // non-string key — should be skipped
    ].join('\n') + '\n';
    const result = await compress(lines, { quality: 6 });
    await fs.writeFile(filePath, result.compressed);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tier = new BrotliColdTier<number>({ filePath });
    expect(await tier.get('alice')).toBe(1);
    expect(await tier.get('bob')).toBe(2);
    expect(await tier.has('999')).toBe(false);
    expect(await tier.size()).toBe(2);

    // Two warnings: malformed JSON + non-string key.
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('BrotliColdTier — reload()', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'reload.br');
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('picks up an externally-written shard after reload()', async () => {
    const tier = new BrotliColdTier<string>({ filePath });
    await tier.put('alice', 'v1');

    // External writer (simulated migration tool) overwrites the
    // shard with a different value for the same key.
    const externalLine = JSON.stringify({ k: 'alice', v: 'external-edit' }) + '\n';
    const compressed = await compress(externalLine, { quality: 6 });
    await fs.writeFile(filePath, compressed.compressed);

    // Before reload: the stale cache still wins.
    expect(await tier.get('alice')).toBe('v1');
    // After reload: the fresh value is visible.
    await tier.reload();
    expect(await tier.get('alice')).toBe('external-edit');
  });
});

describe('BrotliColdTier — generic V', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('works with V = string', async () => {
    const tier = new BrotliColdTier<string>({ filePath: join(dir, 'str.br') });
    await tier.put('k', 'hello world');
    expect(await tier.get('k')).toBe('hello world');
  });

  it('works with V = number', async () => {
    const tier = new BrotliColdTier<number>({ filePath: join(dir, 'num.br') });
    await tier.put('k', 3.14);
    expect(await tier.get('k')).toBe(3.14);
  });

  it('works with V = array (posting-list flavoured)', async () => {
    interface Posting { docId: string; freq: number }
    const tier = new BrotliColdTier<Posting[]>({ filePath: join(dir, 'arr.br') });
    const value: Posting[] = [
      { docId: 'doc-1', freq: 3 },
      { docId: 'doc-2', freq: 1 },
    ];
    await tier.put('term', value);
    expect(await tier.get('term')).toEqual(value);
  });

  it('persists complex values across instances', async () => {
    interface Posting { docId: string; freq: number }
    const path = join(dir, 'arr-persist.br');
    const first = new BrotliColdTier<Posting[]>({ filePath: path });
    await first.put('term', [{ docId: 'a', freq: 5 }]);

    const second = new BrotliColdTier<Posting[]>({ filePath: path });
    expect(await second.get('term')).toEqual([{ docId: 'a', freq: 5 }]);
  });
});
