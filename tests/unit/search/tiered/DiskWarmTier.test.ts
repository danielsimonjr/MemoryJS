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
    /**
     * Force `durableWriteFile` to fail end-to-end. The tmp-write +
     * rename path falls back to a direct write on EPERM (Windows-style)
     * — to test the rollback path we need BOTH the rename and the
     * fallback's open(target, 'w') to throw. Path-based filter on
     * `fs.open` lets the tmp open succeed but rejects the fallback.
     */
    function injectFlushFailure(target: string): void {
      vi.spyOn(fs, 'rename').mockRejectedValue(new Error('synthetic-rename'));
      const realOpen = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation((p, ...rest) => {
        if (p === target) {
          return Promise.reject(new Error('synthetic-fallback'));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (realOpen as any)(p, ...rest);
      });
    }

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
});
