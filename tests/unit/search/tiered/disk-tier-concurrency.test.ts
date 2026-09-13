import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiskWarmTier } from '../../../../src/search/tiered/DiskWarmTier.js';
import { BrotliColdTier } from '../../../../src/search/tiered/BrotliColdTier.js';

for (const Tier of [DiskWarmTier, BrotliColdTier]) {
  describe(`${Tier.name} concurrent durability`, () => {
    let dir: string;
    let filePath: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'tier-concurrency-'));
      filePath = join(dir, 'shard');
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('retains every simultaneous cold-start write after restart', async () => {
      const tier = new Tier<number>({ filePath });
      await Promise.all(Array.from({ length: 20 }, (_, i) => tier.put(String(i), i)));
      const restored = new Tier<number>({ filePath });
      expect(await tier.size()).toBe(20);
      expect(await restored.size()).toBe(20);
      for (let i = 0; i < 20; i++) expect(await restored.get(String(i))).toBe(i);
    });

    it('orders overlapping writes, deletion, clear, and reload', async () => {
      const tier = new Tier<number>({ filePath });
      await tier.put('old', 1);
      await Promise.all([
        tier.put('a', 2), tier.delete('old'), tier.clear(),
        tier.put('kept', 3), tier.reload(), tier.put('last', 4),
      ]);
      const restored = new Tier<number>({ filePath });
      expect(await restored.size()).toBe(2);
      expect(await restored.get('kept')).toBe(3);
      expect(await tier.get('last')).toBe(4);
    });

    it('keeps a failed write invisible to an overlapping read and later write', async () => {
      const tier = new Tier<number>({ filePath });
      await tier.put('key', 1);
      let release!: () => void;
      let started!: () => void;
      const blocked = new Promise<void>(r => { release = r; });
      const entered = new Promise<void>(r => { started = r; });
      vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
        started();
        await blocked;
        throw new Error('injected write failure');
      });
      const failed = expect(tier.put('key', 2)).rejects.toThrow('injected');
      await entered;
      const read = tier.get('key');
      const write = tier.put('other', 3);
      release();
      await failed;
      expect(await read).toBe(1);
      await write;
      const restored = new Tier<number>({ filePath });
      expect(await restored.get('key')).toBe(1);
      expect(await restored.get('other')).toBe(3);
    });
  });
}
