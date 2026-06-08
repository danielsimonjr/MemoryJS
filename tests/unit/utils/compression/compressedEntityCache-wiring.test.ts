/**
 * `ctx.compressedEntityCache` wiring tests (Phase 10 task 79)
 *
 * Covers the env-gated lazy getter on `ManagerContext` that returns
 * a `CompressedMap<string, Entity>` for callers who want compressed
 * entity caching.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import type { Entity } from '../../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `compressed-cache-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedEnv = process.env.MEMORY_CACHE_COMPRESS;

function makeEntity(name: string): Entity {
  return {
    name,
    entityType: 'person',
    observations: [`observation about ${name}`],
    createdAt: '2026-05-11T00:00:00Z',
    lastModified: '2026-05-11T00:00:00Z',
  };
}

describe('ctx.compressedEntityCache env-gated activation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_CACHE_COMPRESS;
    else process.env.MEMORY_CACHE_COMPRESS = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('unset → null', () => {
    delete process.env.MEMORY_CACHE_COMPRESS;
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.compressedEntityCache).toBeNull();
  });

  it("='false' → null", () => {
    process.env.MEMORY_CACHE_COMPRESS = 'false';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.compressedEntityCache).toBeNull();
  });

  it("='yes' → null (strict 'true' literal-match)", () => {
    process.env.MEMORY_CACHE_COMPRESS = 'yes';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.compressedEntityCache).toBeNull();
  });

  it("='1' → null (strict 'true' literal-match)", () => {
    process.env.MEMORY_CACHE_COMPRESS = '1';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.compressedEntityCache).toBeNull();
  });

  it("='true' → CompressedMap instance", () => {
    process.env.MEMORY_CACHE_COMPRESS = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const cache = ctx.compressedEntityCache;
    expect(cache).not.toBeNull();
    expect(cache!.size).toBe(0);
  });

  it('cached after first access (lazy + sticky)', () => {
    process.env.MEMORY_CACHE_COMPRESS = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const first = ctx.compressedEntityCache;
    process.env.MEMORY_CACHE_COMPRESS = 'false';
    expect(ctx.compressedEntityCache).toBe(first);
  });

  it('round-trips an entity through the compressed cache', () => {
    process.env.MEMORY_CACHE_COMPRESS = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const cache = ctx.compressedEntityCache!;
    const alice = makeEntity('alice');
    cache.set('alice', alice);
    const back = cache.get('alice');
    expect(back).toEqual(alice);
  });

  it('exercises hot/cold transition past hotThreshold=1000', () => {
    process.env.MEMORY_CACHE_COMPRESS = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const cache = ctx.compressedEntityCache!;
    // Insert 1500 entities — last 1000 stay hot, first 500 demote to cold.
    for (let i = 0; i < 1500; i++) cache.set(`e${i}`, makeEntity(`e${i}`));
    const stats = cache.stats();
    expect(stats.hotCount).toBe(1000);
    expect(stats.coldCount).toBe(500);
    // Old entity still retrievable.
    const back = cache.get('e0');
    expect(back?.name).toBe('e0');
  });
});
