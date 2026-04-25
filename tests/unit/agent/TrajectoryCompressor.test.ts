import { describe, it, expect } from 'vitest';
import { TrajectoryCompressor } from '../../../src/agent/TrajectoryCompressor.js';
import type { Entity } from '../../../src/types/types.js';
import type { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';

/** Minimal ContextWindowManager stub — TrajectoryCompressor only calls
 * `compressForContext`. Returns a tagged short version of the input so
 * we can verify foldContext delegated correctly. */
function stubContextWindow(): ContextWindowManager {
  return {
    compressForContext: (text: string, opts?: { level?: 'light' | 'medium' | 'aggressive' }) => ({
      compressed: `[stub:${opts?.level ?? 'medium'}] ${text.slice(0, 50)}`,
      legend: {},
      ratio: 0.5,
      originalLength: text.length,
      compressedLength: 50,
    }),
  } as unknown as ContextWindowManager;
}

function makeEntity(name: string, observations: string[]): Entity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'memory_turn',
    observations,
    createdAt: now,
    lastModified: now,
  } as Entity;
}

describe('TrajectoryCompressor.distill', () => {
  it('returns empty result for empty input', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const out = await c.distill([]);
    expect(out.summary).toBe('');
    expect(out.originalCount).toBe(0);
  });

  it('produces a CompressedMemory with summary + key facts', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const obs = [
      'the user prefers italian food',
      'the user prefers mexican food',
      'completely unrelated note',
    ];
    const out = await c.distill(obs);
    expect(out.originalCount).toBe(3);
    expect(out.keyFacts.length).toBeGreaterThan(0);
    expect(out.summary.length).toBeGreaterThan(0);
    expect(out.compressionRatio).toBeGreaterThan(0);
    expect(out.compressionRatio).toBeLessThan(2); // bounded
  });

  it('respects maxLength truncation', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const longObs = Array.from({ length: 20 }, (_, i) => `observation number ${i} with content`);
    const out = await c.distill(longObs, { maxLength: 100 });
    expect(out.summary.length).toBeLessThanOrEqual(101); // 100 + ellipsis
  });
});

describe('TrajectoryCompressor.abstractAtLevel', () => {
  it('returns entities unchanged at fine granularity', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const e = makeEntity('e1', ['a', 'b', 'c', 'd', 'e']);
    const out = await c.abstractAtLevel([e], 'fine');
    expect(out).toEqual([e]);
  });

  it('trims to at-most-3 observations at medium granularity', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const e = makeEntity('e1', ['a a a', 'b a b', 'c a c', 'd', 'e']);
    const out = await c.abstractAtLevel([e], 'medium');
    expect(out[0].observations.length).toBeLessThanOrEqual(3);
  });

  it('produces a single-summary observation at coarse granularity', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const e = makeEntity('e1', ['the cat sat', 'the cat ran', 'the dog sat']);
    const out = await c.abstractAtLevel([e], 'coarse');
    expect(out[0].observations.length).toBe(1);
  });
});

describe('TrajectoryCompressor.foldContext', () => {
  it('returns input unchanged when under token budget', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const text = 'short';
    const out = await c.foldContext(text, 100);
    expect(out).toBe(text);
  });

  it('delegates to ContextWindowManager.compressForContext when over budget', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const text = 'x'.repeat(1000); // ~250 tokens at 4 chars/token
    const out = await c.foldContext(text, 50); // hard budget
    expect(out).toContain('[stub:');
  });

  it('chooses aggressive level when ratio > 2', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const text = 'x'.repeat(2000); // ~500 tokens
    const out = await c.foldContext(text, 100); // ratio 5x
    expect(out).toContain('[stub:aggressive]');
  });
});

describe('TrajectoryCompressor.findRedundancies + mergeRedundant', () => {
  it('groups entities with high token overlap', async () => {
    const c = new TrajectoryCompressor(stubContextWindow(), { redundancyThreshold: 0.5 });
    const e1 = makeEntity('e1', ['the quick brown fox jumps over the lazy dog']);
    const e2 = makeEntity('e2', ['the quick brown fox jumps over a lazy dog']);
    const e3 = makeEntity('e3', ['totally unrelated content here']);
    const groups = await c.findRedundancies([e1, e2, e3]);
    expect(groups.length).toBe(1);
    expect(groups[0].entities.map((e) => e.name).sort()).toEqual(['e1', 'e2']);
    expect(groups[0].avgSimilarity).toBeGreaterThan(0.5);
  });

  it('returns no groups when no entities are similar enough', async () => {
    const c = new TrajectoryCompressor(stubContextWindow(), { redundancyThreshold: 0.9 });
    const e1 = makeEntity('e1', ['hello world']);
    const e2 = makeEntity('e2', ['goodbye universe']);
    const groups = await c.findRedundancies([e1, e2]);
    expect(groups).toEqual([]);
  });

  it('mergeRedundant union strategy unions all observations', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const e1 = makeEntity('e1', ['a', 'b']);
    const e2 = makeEntity('e2', ['b', 'c']);
    const merged = await c.mergeRedundant(
      { entities: [e1, e2], canonicalName: 'e1', avgSimilarity: 0.8 },
      'union-observations',
    );
    expect(merged.observations.sort()).toEqual(['a', 'b', 'c']);
  });

  it('mergeRedundant keep-newest picks the most-recently modified', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    const old = makeEntity('old', ['stale']);
    const fresh = makeEntity('fresh', ['fresh']);
    fresh.lastModified = new Date(Date.now() + 1000).toISOString();
    const merged = await c.mergeRedundant(
      { entities: [old, fresh], canonicalName: 'old', avgSimilarity: 0.8 },
      'keep-newest',
    );
    expect(merged.name).toBe('fresh');
  });

  it('mergeRedundant throws on empty group', async () => {
    const c = new TrajectoryCompressor(stubContextWindow());
    await expect(
      c.mergeRedundant({ entities: [], canonicalName: '', avgSimilarity: 0 }, 'keep-newest'),
    ).rejects.toThrow(/empty group/);
  });
});
