/**
 * Phase 10 review-fix regression tests
 *
 * Targets the substantive findings from the Phase 10 review:
 * - #1 CompressedMap demotion preserves hot entry on compression failure
 * - #3 + #4 Iterator does NOT promote cold entries
 * - #5 Adapter errors wrap underlying messages with adapter name
 * - #8 compressedEntityCache exercises full Entity shape (locks JSON
 *      round-trip against future schema drift)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CompressedMap } from '../../../../src/utils/compression/CompressedMap.js';
import {
  ZlibCompressionAdapter,
  IdentityCompressionAdapter,
  type ICompressionAdapter,
} from '../../../../src/utils/compression/ICompressionAdapter.js';
import { BrotliCompressionAdapter } from '../../../../src/utils/compression/BrotliCompressionAdapter.js';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import type { Entity } from '../../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `compression-review-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedEnv = process.env.MEMORY_CACHE_COMPRESS;

describe('Review #1: CompressedMap.enforceHotBudget preserves hot entry on demotion failure', () => {
  it('throws when compress fails AND keeps the would-be-evicted entry retrievable from hot', () => {
    class ThrowingAdapter implements ICompressionAdapter {
      readonly name = 'throwing';
      compress(): Buffer {
        throw new Error('synthetic-compress-failure');
      }
      decompress(input: Buffer): Buffer {
        return input;
      }
    }
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new ThrowingAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    // Insert 'c' — this pushes hot to 3, triggers demote of 'a',
    // adapter throws. Pre-fix: 'a' was already deleted from hot
    // before compress ran → silent data loss. Post-fix: 'a' stays
    // in hot, the demotion error surfaces.
    expect(() => map.set('c', 3)).toThrow(/CompressedMap: failed to demote.*synthetic-compress-failure/);
    // 'a' still retrievable (the failed demotion left it in hot).
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    // The size is "over budget by 1" (3 entries with hotThreshold=2)
    // — better than silent data loss, per the fix rationale.
    expect(map.size).toBe(3);
  });

  it('also throws when serialize throws (e.g., BigInt value with default JSON serializer)', () => {
    const map = new CompressedMap<string, bigint>({
      hotThreshold: 1,
      adapter: new IdentityCompressionAdapter(),
      // Default serialize is JSON.stringify, which throws on BigInt.
    });
    map.set('a', 1n);
    // Second insert triggers demotion of 'a'. JSON.stringify(1n) throws.
    expect(() => map.set('b', 2n)).toThrow(/CompressedMap: failed to demote/);
    expect(map.get('a')).toBe(1n);
  });
});

describe('Review #3 + #4: Iterator does NOT promote cold entries', () => {
  it('iterating values() does not move cold entries to hot', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // pushes 'a' to cold
    const beforeStats = map.stats();
    expect(beforeStats.hotCount).toBe(2);
    expect(beforeStats.coldCount).toBe(1);

    // Iterate everything — pre-fix doc didn't make it clear that
    // this doesn't promote; verify the behavior locks in.
    const all = [...map.values()];
    expect(all.sort()).toEqual([1, 2, 3]);

    const afterStats = map.stats();
    expect(afterStats.hotCount).toBe(2);
    expect(afterStats.coldCount).toBe(1);
  });

  it('iteration yields hot entries (insertion order) THEN cold entries (insertion order)', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // a → cold; hot = [b, c]
    map.set('d', 4); // b → cold; hot = [c, d]; cold = [a, b]
    const keys = [...map.keys()];
    // Hot tier in insertion order (c, d) THEN cold tier in
    // insertion order (a, b) — NOT global insertion order
    // (which would be a, b, c, d).
    expect(keys).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('Review #5: Adapter errors identify which adapter rejected', () => {
  it('ZlibCompressionAdapter.decompress throws with adapter name in the message', () => {
    const adapter = new ZlibCompressionAdapter();
    expect(() => adapter.decompress(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toThrow(
      /ZlibCompressionAdapter: decompress failed/,
    );
  });

  it('BrotliCompressionAdapter.decompress throws with adapter name in the message', () => {
    const adapter = new BrotliCompressionAdapter();
    expect(() => adapter.decompress(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toThrow(
      /BrotliCompressionAdapter: decompress failed/,
    );
  });

  it('Cross-adapter: zlib output rejected by brotli with clear error', () => {
    const zlib = new ZlibCompressionAdapter();
    const brotli = new BrotliCompressionAdapter();
    const compressed = zlib.compress(Buffer.from('hello world this is sample text'));
    expect(() => brotli.decompress(compressed)).toThrow(
      /BrotliCompressionAdapter: decompress failed/,
    );
  });

  it('Cross-adapter: brotli output rejected by zlib with clear error', () => {
    const zlib = new ZlibCompressionAdapter();
    const brotli = new BrotliCompressionAdapter();
    const compressed = brotli.compress(Buffer.from('hello world this is sample text'));
    expect(() => zlib.decompress(compressed)).toThrow(
      /ZlibCompressionAdapter: decompress failed/,
    );
  });
});

describe('Review #8: compressedEntityCache locks Entity JSON round-trip across schema', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_CACHE_COMPRESS = 'true';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_CACHE_COMPRESS;
    else process.env.MEMORY_CACHE_COMPRESS = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('round-trips an Entity with every documented optional field', () => {
    // This test exists to catch schema drift: if `Entity` gains a
    // field that doesn't survive `JSON.stringify` / `JSON.parse`
    // (e.g., a Set or Map or function), the round-trip will lose
    // it and this test will fail — forcing the implementer to
    // either update the custom serialize/deserialize on
    // `compressedEntityCache` or pick a serializable type.
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const cache = ctx.compressedEntityCache!;
    const fullEntity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['observation 1', 'observation 2 with longer text', 'observation 3'],
      tags: ['active', 'expert', 'reviewed'],
      importance: 7,
      parentId: 'team:engineering',
      createdAt: '2026-01-01T00:00:00Z',
      lastModified: '2026-05-11T00:00:00Z',
      ttl: 3600,
      confidence: 0.85,
      projectId: 'project-x',
      version: 3,
      contentHash: 'sha256:abc123def456',
    };
    cache.set('alice', fullEntity);
    const back = cache.get('alice');
    expect(back).toEqual(fullEntity);
  });

  it('compresses + decompresses a populated cache without losing field shape', () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const cache = ctx.compressedEntityCache!;
    // Hot threshold is 1000; insert > threshold to force demotion.
    for (let i = 0; i < 1100; i++) {
      cache.set(`e${i}`, {
        name: `e${i}`,
        entityType: 'thing',
        observations: [`obs ${i}`],
        tags: i % 2 === 0 ? ['even'] : ['odd'],
        importance: i % 10,
      });
    }
    // Pick a cold-tier entity (first one inserted is now coldest).
    const cold = cache.get('e0');
    expect(cold).toEqual({
      name: 'e0',
      entityType: 'thing',
      observations: ['obs 0'],
      tags: ['even'],
      importance: 0,
    });
  });
});
