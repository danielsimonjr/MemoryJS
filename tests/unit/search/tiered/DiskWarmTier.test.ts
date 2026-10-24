/**
 * DiskWarmTier tests
 *
 * Covers Phase 9 task 71: JSONL-sidecar-backed `IIndexTier<string, V>`
 * implementation. Mirrors the JsonlColumnStore test patterns
 * (durable-write rollback, malformed-line tolerance, reload visibility).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { DiskWarmTier } from '../../../../src/search/tiered/DiskWarmTier.js';
import { injectFlushFailure } from '../../../test-utils/inject-flush-failure.js';

describe('DiskWarmTier', () => {
  let dir: string;
  let sidecar: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), `disk-warm-tier-${randomBytes(4).toString('hex')}-`));
    sidecar = join(dir, 'warm.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('round-trip basics', () => {
    it('put + get round-trips a value', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 42);
      expect(await tier.get('alice')).toBe(42);
    });

    it('get returns undefined for absent keys', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.get('ghost')).toBeUndefined();
    });

    it('put replaces a prior value', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      await tier.put('alice', 2);
      expect(await tier.get('alice')).toBe(2);
    });

    it('delete returns true when something was removed, false otherwise', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      expect(await tier.delete('alice')).toBe(true);
      expect(await tier.delete('alice')).toBe(false);
    });

    it('has reflects presence', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.has('alice')).toBe(false);
      await tier.put('alice', 0); // explicit zero — distinct from absent
      expect(await tier.has('alice')).toBe(true);
    });

    it('size counts entries', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.size()).toBe(0);
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      expect(await tier.size()).toBe(2);
    });

    it('clear empties the tier and truncates the sidecar', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      await tier.clear();
      expect(await tier.size()).toBe(0);
      expect(await tier.get('alice')).toBeUndefined();
      const raw = await fs.readFile(sidecar, 'utf-8');
      expect(raw).toBe('');
    });

    it('missing sidecar = empty tier with no throw', async () => {
      const ghost = join(dir, 'does-not-exist.jsonl');
      const tier = new DiskWarmTier<number>({ filePath: ghost });
      expect(await tier.get('alice')).toBeUndefined();
      expect(await tier.size()).toBe(0);
    });
  });

  describe('persistence', () => {
    it('values survive across instances backed by the same file', async () => {
      const first = new DiskWarmTier<number>({ filePath: sidecar });
      await first.put('alice', 1);
      await first.put('bob', 2);

      const second = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await second.get('alice')).toBe(1);
      expect(await second.get('bob')).toBe(2);
      expect(await second.size()).toBe(2);
    });

    it('wire format is one JSON object per line with {k, v}', async () => {
      const tier = new DiskWarmTier<number[]>({ filePath: sidecar });
      await tier.put('alice', [1, 4, 7]);

      const raw = await fs.readFile(sidecar, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({ k: 'alice', v: [1, 4, 7] });
    });

    it('delete rewrites the sidecar without the removed entry', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      await tier.delete('alice');

      const reloaded = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await reloaded.has('alice')).toBe(false);
      expect(await reloaded.get('bob')).toBe(2);
    });
  });

  describe('maxEntries eviction', () => {
    it('fires onEvict for the oldest entry when over the bound', async () => {
      const evicted: Array<{ k: string; v: number }> = [];
      const tier = new DiskWarmTier<number>({
        filePath: sidecar,
        maxEntries: 2,
        onEvict: (k, v) => evicted.push({ k, v }),
      });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      // Third put should evict 'alice' (oldest by insertion order).
      await tier.put('carol', 3);

      expect(evicted).toEqual([{ k: 'alice', v: 1 }]);
      expect(await tier.has('alice')).toBe(false);
      expect(await tier.get('bob')).toBe(2);
      expect(await tier.get('carol')).toBe(3);
      expect(await tier.size()).toBe(2);
      expect(tier.getEvictionCount()).toBe(1);
    });

    it('replacing an existing key refreshes its position (does not evict it)', async () => {
      const evicted: Array<{ k: string; v: number }> = [];
      const tier = new DiskWarmTier<number>({
        filePath: sidecar,
        maxEntries: 2,
        onEvict: (k, v) => evicted.push({ k, v }),
      });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      // Refresh 'alice' — it now becomes the newest.
      await tier.put('alice', 10);
      // Next insert should evict 'bob', not 'alice'.
      await tier.put('carol', 3);

      expect(evicted).toEqual([{ k: 'bob', v: 2 }]);
      expect(await tier.get('alice')).toBe(10);
      expect(await tier.has('bob')).toBe(false);
      expect(await tier.get('carol')).toBe(3);
    });

    it('unbounded by default — no eviction fires', async () => {
      const evicted: Array<{ k: string; v: number }> = [];
      const tier = new DiskWarmTier<number>({
        filePath: sidecar,
        onEvict: (k, v) => evicted.push({ k, v }),
      });
      for (let i = 0; i < 50; i++) await tier.put(`k-${i}`, i);
      expect(evicted).toHaveLength(0);
      expect(tier.getEvictionCount()).toBe(0);
      expect(await tier.size()).toBe(50);
    });

    it('eviction persists — evicted keys are gone from the sidecar', async () => {
      const tier = new DiskWarmTier<number>({
        filePath: sidecar,
        maxEntries: 2,
        onEvict: () => {},
      });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      await tier.put('carol', 3);

      const reloaded = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await reloaded.has('alice')).toBe(false);
      expect(await reloaded.get('bob')).toBe(2);
      expect(await reloaded.get('carol')).toBe(3);
    });

    it('survives a missing onEvict callback', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar, maxEntries: 1 });
      await tier.put('alice', 1);
      await expect(tier.put('bob', 2)).resolves.toBeUndefined();
      expect(await tier.has('alice')).toBe(false);
      expect(tier.getEvictionCount()).toBe(1);
    });
  });

  describe('snapshot-restore rollback on flush failure', () => {
    // Shared helper — see `tests/test-utils/inject-flush-failure.ts`.

    it('put: cache rolls back when no prior value existed', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      injectFlushFailure(sidecar);
      await expect(tier.put('bob', 2)).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();
      expect(await tier.has('bob')).toBe(false);
      expect(await tier.get('alice')).toBe(1);
    });

    it('put: cache rolls back to the prior value when one existed', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      injectFlushFailure(sidecar);
      await expect(tier.put('alice', 99)).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();
      expect(await tier.get('alice')).toBe(1);
    });

    it('put: rollback restores an evicted entry when flush fails', async () => {
      const evicted: Array<{ k: string; v: number }> = [];
      const tier = new DiskWarmTier<number>({
        filePath: sidecar,
        maxEntries: 2,
        onEvict: (k, v) => evicted.push({ k, v }),
      });
      await tier.put('alice', 1);
      await tier.put('bob', 2);

      injectFlushFailure(sidecar);
      await expect(tier.put('carol', 3)).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();

      // No durable eviction happened — onEvict must NOT have fired,
      // the evictee must be restored, and the failed put must be gone.
      expect(evicted).toHaveLength(0);
      expect(tier.getEvictionCount()).toBe(0);
      expect(await tier.get('alice')).toBe(1);
      expect(await tier.get('bob')).toBe(2);
      expect(await tier.has('carol')).toBe(false);
      expect(await tier.size()).toBe(2);
    });

    it('delete: cache restores the deleted value on flush failure', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 7);
      injectFlushFailure(sidecar);
      await expect(tier.delete('alice')).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();
      expect(await tier.get('alice')).toBe(7);
    });

    it('clear: cache restores on flush failure', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      await tier.put('bob', 2);
      injectFlushFailure(sidecar);
      await expect(tier.clear()).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();
      expect(await tier.size()).toBe(2);
      expect(await tier.get('alice')).toBe(1);
      expect(await tier.get('bob')).toBe(2);
    });
  });

  describe('malformed-line tolerance', () => {
    it('skips malformed JSON lines on load and warns', async () => {
      await fs.writeFile(
        sidecar,
        JSON.stringify({ k: 'alice', v: 1 }) + '\n' +
          '{this is not valid json\n' +
          JSON.stringify({ k: 'bob', v: 2 }) + '\n',
        'utf-8',
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.get('alice')).toBe(1);
      expect(await tier.get('bob')).toBe(2);
      expect(await tier.size()).toBe(2);
      expect(warnSpy).toHaveBeenCalled();
      const warnText = warnSpy.mock.calls.flat().join(' ');
      expect(warnText).toContain('malformed');
    });

    it('skips lines with non-string k on load', async () => {
      await fs.writeFile(
        sidecar,
        JSON.stringify({ k: 42, v: 'bad' }) + '\n' +
          JSON.stringify({ k: 'alice', v: 1 }) + '\n',
        'utf-8',
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.size()).toBe(1);
      expect(await tier.get('alice')).toBe(1);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('reload()', () => {
    it('drops the cache so external edits become visible', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 1);
      // External writer (simulated migration tool) replaces the file.
      await fs.writeFile(sidecar, JSON.stringify({ k: 'alice', v: 99 }) + '\n', 'utf-8');
      // Before reload: stale cache still wins.
      expect(await tier.get('alice')).toBe(1);
      await tier.reload();
      expect(await tier.get('alice')).toBe(99);
    });
  });

  describe('name accessor', () => {
    it('defaults to "warm"', () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(tier.name).toBe('warm');
    });

    it('uses the supplied name', () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar, name: 'warm-alpha' });
      expect(tier.name).toBe('warm-alpha');
    });
  });

  describe('generic V', () => {
    it('works with string values', async () => {
      const tier = new DiskWarmTier<string>({ filePath: sidecar });
      await tier.put('alice', 'hello');
      const reloaded = new DiskWarmTier<string>({ filePath: sidecar });
      expect(await reloaded.get('alice')).toBe('hello');
    });

    it('works with number values', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('alice', 3.14);
      await tier.put('bob', -7);
      const reloaded = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await reloaded.get('alice')).toBe(3.14);
      expect(await reloaded.get('bob')).toBe(-7);
    });

    it('works with array values (posting list shape)', async () => {
      const tier = new DiskWarmTier<number[]>({ filePath: sidecar });
      await tier.put('term-1', [1, 4, 7, 12]);
      const reloaded = new DiskWarmTier<number[]>({ filePath: sidecar });
      expect(await reloaded.get('term-1')).toEqual([1, 4, 7, 12]);
    });

    it('works with structured object values', async () => {
      interface Posting { docIds: number[]; tf: number }
      const tier = new DiskWarmTier<Posting>({ filePath: sidecar });
      await tier.put('alice', { docIds: [1, 2, 3], tf: 0.42 });
      const reloaded = new DiskWarmTier<Posting>({ filePath: sidecar });
      expect(await reloaded.get('alice')).toEqual({ docIds: [1, 2, 3], tf: 0.42 });
    });
  });

  describe('file format and order (pins)', () => {
    it('writes one {"k","v"} line per entry, in insertion order', async () => {
      const tier = new DiskWarmTier<unknown>({ filePath: sidecar });
      await tier.put('a', 1);
      await tier.put('b', { x: 2 });
      expect(await fs.readFile(sidecar, 'utf-8')).toBe('{"k":"a","v":1}\n{"k":"b","v":{"x":2}}\n');
    });

    it('writes an empty file after clear()', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('a', 1);
      await tier.clear();
      expect(await fs.readFile(sidecar, 'utf-8')).toBe('');
    });

    it('moves a re-written key to the end of the file', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('a', 1);
      await tier.put('b', 2);
      await tier.put('c', 3);
      await tier.put('a', 9);
      expect(await fs.readFile(sidecar, 'utf-8')).toBe(
        '{"k":"b","v":2}\n{"k":"c","v":3}\n{"k":"a","v":9}\n',
      );
    });

    it('returns every key after reload()', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('a', 1);
      await tier.put('b', 2);
      await tier.put('c', 3);
      await tier.reload();
      expect([await tier.get('a'), await tier.get('b'), await tier.get('c')]).toEqual([1, 2, 3]);
    });

    it('restores the file and the entry order after a failed delete', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('a', 1);
      await tier.put('b', 2);
      await tier.put('c', 3);
      const before = await fs.readFile(sidecar, 'utf-8');
      injectFlushFailure(sidecar);
      await expect(tier.delete('b')).rejects.toThrow(/synthetic/);
      vi.restoreAllMocks();
      expect(await fs.readFile(sidecar, 'utf-8')).toBe(before);
      expect(await tier.get('b')).toBe(2);
      await tier.put('d', 4);
      expect(await fs.readFile(sidecar, 'utf-8')).toBe(`${before}{"k":"d","v":4}\n`);
    });

    it('loads the good line, skips a bad line and a numeric key, and warns with the exact texts', async () => {
      await fs.writeFile(sidecar, '{"k":"a","v":1}\n{not json\n{"k":5,"v":2}\n', 'utf-8');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.get('a')).toBe(1);
      expect(await tier.size()).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const warnText = warnSpy.mock.calls.flat().join('\n');
      expect(warnText).toContain(`DiskWarmTier(warm): skipping malformed line in ${sidecar}`);
      expect(warnText).toContain(`DiskWarmTier(warm): skipping line with non-string key in ${sidecar}`);
    });
  });

  describe('lock, read errors, text encoding and names (pins)', () => {
    it('keeps has(), size() and reload() behind a write that fails', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('old', 1);
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
        entered();
        await blocked;
        throw new Error('injected write failure');
      });

      const order: string[] = [];
      const failed = tier.put('new', 2).catch(() => { order.push('put'); });
      await started;
      const hasNew = tier.has('new').then(found => { order.push('has'); return found; });
      const size = tier.size().then(count => { order.push('size'); return count; });
      const reloaded = tier.reload().then(() => { order.push('reload'); });
      release();
      await Promise.all([failed, hasNew, size, reloaded]);

      expect(await hasNew).toBe(false);
      expect(await size).toBe(1);
      expect(order).toEqual(['put', 'has', 'size', 'reload']);
    });

    it('writes no file for clear() on an empty tier', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.clear();
      await expect(fs.access(sidecar)).rejects.toThrow();
    });

    it('rejects a read when the sidecar path is a directory', async () => {
      const tier = new DiskWarmTier<number>({ filePath: dir });
      await expect(tier.size()).rejects.toThrow();
    });

    it('names the tier in the warning text', async () => {
      await fs.writeFile(sidecar, '{not json\n', 'utf-8');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar, name: 'mine' });
      expect(await tier.size()).toBe(0);
      expect(warnSpy.mock.calls.flat().join('\n')).toContain(
        `DiskWarmTier(mine): skipping malformed line in ${sidecar}`,
      );
    });

    it('stores non-ASCII text as UTF-8 and reads it back', async () => {
      const value = { text: 'ünï€𝄞' };
      const tier = new DiskWarmTier<typeof value>({ filePath: sidecar });
      await tier.put('ü€', value);

      const expected = `${JSON.stringify({ k: 'ü€', v: value })}\n`;
      expect((await fs.readFile(sidecar)).equals(Buffer.from(expected, 'utf-8'))).toBe(true);
      const second = new DiskWarmTier<typeof value>({ filePath: sidecar });
      expect(await second.get('ü€')).toEqual(value);
    });

    it('writes no value field for an undefined value and reads the key back', async () => {
      const tier = new DiskWarmTier<number | undefined>({ filePath: sidecar });
      await tier.put('a', undefined);
      expect(await fs.readFile(sidecar, 'utf-8')).toBe('{"k":"a"}\n');

      const second = new DiskWarmTier<number | undefined>({ filePath: sidecar });
      expect(await second.has('a')).toBe(true);
      expect(await second.get('a')).toBeUndefined();
    });

    it('warns once per line that is the value null or has no string key', async () => {
      await fs.writeFile(sidecar, 'null\n5\n"str"\n[]\ntrue\n{"k":"a","v":1}\n', 'utf-8');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.size()).toBe(1);
      const warnings = warnSpy.mock.calls.map(call => call.join(' '));
      expect(warnings).toEqual([
        `[WARN] DiskWarmTier(warm): skipping malformed line in ${sidecar}`,
        `[WARN] DiskWarmTier(warm): skipping line with non-string key in ${sidecar}`,
        `[WARN] DiskWarmTier(warm): skipping line with non-string key in ${sidecar}`,
        `[WARN] DiskWarmTier(warm): skipping line with non-string key in ${sidecar}`,
        `[WARN] DiskWarmTier(warm): skipping line with non-string key in ${sidecar}`,
      ]);
    });

    it('keeps an empty-string key across a reload', async () => {
      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      await tier.put('', 7);
      expect(await fs.readFile(sidecar, 'utf-8')).toBe('{"k":"","v":7}\n');

      const second = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await second.get('')).toBe(7);
    });

    it('loads CRLF line ends and whitespace-only lines without a warning', async () => {
      await fs.writeFile(sidecar, '{"k":"a","v":1}\r\n   \r\n\r\n{"k":"b","v":2}\r\n', 'utf-8');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tier = new DiskWarmTier<number>({ filePath: sidecar });
      expect(await tier.size()).toBe(2);
      expect(await tier.get('a')).toBe(1);
      expect(await tier.get('b')).toBe(2);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
