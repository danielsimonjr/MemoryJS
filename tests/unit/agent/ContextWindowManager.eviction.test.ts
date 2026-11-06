/**
 * ContextWindowManager eviction hook tests (spec RS-8).
 *
 * Covers recording during spillover, `[evicted]` lines in retrieveForContext and wakeUp,
 * budget handling and the no-change-when-unset guarantee.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { EvictionIndex } from '../../../src/agent/harness/EvictionIndex.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';
import type { AgentEntity, ExcludedEntity } from '../../../src/types/agent-memory.js';

function createMockStorage(entities: Entity[] = []): IGraphStorage {
  const graph = { entities, relations: [] };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find((e) => e.name === name)),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getRelationsFor: vi.fn().mockReturnValue([]),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
}

function createTestEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
    ...overrides,
  };
}

function words(count: number, prefix = 'word'): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');
}

const EVICTED_LINE = '[evicted]: e1–e4 — older span';

describe('ContextWindowManager eviction hook', () => {
  let entity: AgentEntity;

  function build(
    config: ConstructorParameters<typeof ContextWindowManager>[2] = {},
    entities: Entity[] = [entity],
  ): ContextWindowManager {
    const storage = createMockStorage(entities);
    const accessTracker = new AccessTracker(storage);
    const decayEngine = new DecayEngine(storage, accessTracker);
    const salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
    return new ContextWindowManager(storage, salienceEngine, config);
  }

  function indexWith(...ranges: Array<{ fromAddr: string; toAddr: string; summary: string; tokens: number }>): EvictionIndex {
    const index = new EvictionIndex();
    for (const r of ranges) index.record(r);
    return index;
  }

  beforeEach(() => {
    entity = createTestEntity({ name: 'memo', observations: [words(20)] });
  });

  describe('retrieveForContext', () => {
    it('appends eviction lines last in excludedSummary when the budget allows', async () => {
      const cwm = build();
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: 'older span', tokens: 40 }));

      const tokens = cwm.estimateTokens(entity);
      const result = await cwm.retrieveForContext({ maxTokens: 100 + tokens + 50 });

      expect(result.memories.map((m) => m.name)).toEqual(['memo']);
      expect(result.excludedSummary).toBe(EVICTED_LINE);
    });

    it('drops eviction lines first when the remaining budget is too small', async () => {
      const cwm = build();
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: 'older span', tokens: 40 }));

      const tokens = cwm.estimateTokens(entity);
      const result = await cwm.retrieveForContext({ maxTokens: 100 + tokens });

      expect(result.memories.map((m) => m.name)).toEqual(['memo']);
      expect(result.excludedSummary).toBeUndefined();
    });

    it('yields no line when the summary alone is longer than the whole budget', async () => {
      const cwm = build();
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: words(500), tokens: 40 }));

      const result = await cwm.retrieveForContext({ maxTokens: 100 + cwm.estimateTokens(entity) + 50 });
      expect(result.excludedSummary).toBeUndefined();
    });

    it('appends at most maxEvictionLines lines, keeping the newest', async () => {
      const cwm = build({ maxEvictionLines: 2 });
      cwm.setEvictionIndex(indexWith(
        { fromAddr: 'e1', toAddr: 'e1', summary: 's1', tokens: 1 },
        { fromAddr: 'e2', toAddr: 'e2', summary: 's2', tokens: 1 },
        { fromAddr: 'e3', toAddr: 'e3', summary: 's3', tokens: 1 },
      ));

      const result = await cwm.retrieveForContext({ maxTokens: 1000 });
      expect(result.excludedSummary).toBe('[evicted]: e2–e2 — s2\n[evicted]: e3–e3 — s3');
    });

    it('is unchanged when no index is set', async () => {
      const plain = build();
      const withUnset = build();
      withUnset.setEvictionIndex(undefined);
      const options = { maxTokens: 1000 };
      const a = await plain.retrieveForContext(options);
      const b = await withUnset.retrieveForContext(options);
      expect(b).toEqual(a);
      expect(a.excludedSummary).toBeUndefined();
    });
  });

  describe('wakeUp', () => {
    it('appends eviction lines last in L1 within the L1 budget', async () => {
      const cwm = build({}, []);
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: 'older span', tokens: 40 }));

      const result = await cwm.wakeUp({ maxL1Tokens: 500 });
      expect(result.l1).toBe(EVICTED_LINE);
    });

    it('drops eviction lines when the L1 budget is zero', async () => {
      const cwm = build({}, []);
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: 'older span', tokens: 40 }));

      const result = await cwm.wakeUp({ maxL1Tokens: 0 });
      expect(result.l1).toBe('');
    });

    it('is unchanged when no index is set', async () => {
      const result = await build({}, []).wakeUp({ maxL1Tokens: 500 });
      expect(result.l1).not.toContain('[evicted]');
    });
  });

  describe('handleSpillover recording', () => {
    function excluded(addr: string | undefined, tokens: number, name: string): ExcludedEntity {
      const e = createTestEntity({ name, observations: ['x'] });
      if (addr !== undefined) e.interactionAddr = addr;
      return { entity: e, reason: 'budget_exceeded', tokens, salience: 0.5 };
    }

    it('records the address span, token total and first suggestion as summary', () => {
      const cwm = build();
      const index = new EvictionIndex();
      cwm.setEvictionIndex(index);

      const out = cwm.handleSpillover([excluded('e9', 10, 'a'), excluded('e12', 15, 'b'), excluded('e3', 5, 'c')]);

      expect(index.list()).toEqual([
        { fromAddr: 'e3', toAddr: 'e12', summary: out.suggestions[0], tokens: 30 },
      ]);
      expect(out.suggestions.length).toBeGreaterThan(0);
    });

    it('skips recording when no spilled entity has a valid address', () => {
      const cwm = build();
      const index = new EvictionIndex();
      cwm.setEvictionIndex(index);

      cwm.handleSpillover([excluded(undefined, 10, 'a'), excluded('bogus', 5, 'b')]);

      expect(index.size).toBe(0);
    });

    it('records nothing when no index is set', () => {
      expect(() => build().handleSpillover([excluded('e1', 10, 'a')])).not.toThrow();
    });
  });

  describe('hardening', () => {
    const est = (cwm: ContextWindowManager, text: string): number =>
      (cwm as unknown as { estimateStringTokens(t: string): number }).estimateStringTokens(text);

    function spill(addr: string, tokens: number): ExcludedEntity {
      return { entity: createTestEntity({ name: addr, interactionAddr: addr }), reason: 'budget_exceeded', tokens, salience: 0.5 };
    }

    it('S6: handleSpillover stays total on NaN tokens and dedupes repeated ranges', () => {
      const cwm = build();
      const index = new EvictionIndex();
      cwm.setEvictionIndex(index);
      expect(() => cwm.handleSpillover([spill('e1', Number.NaN), spill('e2', 1)])).not.toThrow();
      expect(index.list()).toEqual([expect.objectContaining({ fromAddr: 'e1', toAddr: 'e2', tokens: 0 })]);
      cwm.handleSpillover([spill('e1', 3), spill('e2', 4)]);
      expect(index.list()).toEqual([expect.objectContaining({ fromAddr: 'e1', toAddr: 'e2', tokens: 7 })]);
    });

    it('S7: totalTokens includes the appended eviction-line tokens', async () => {
      const plain = await build().retrieveForContext({ maxTokens: 1000 });
      const cwm = build();
      cwm.setEvictionIndex(indexWith({ fromAddr: 'e1', toAddr: 'e4', summary: 'older span', tokens: 40 }));
      const result = await cwm.retrieveForContext({ maxTokens: 1000 });
      expect(result.totalTokens).toBe(plain.totalTokens + est(cwm, EVICTED_LINE) + 1);
    });

    it('N5: counts the newline joiner, dropping a line that only fits without it', async () => {
      const cwm = build({}, []);
      const ranges = [
        { fromAddr: 'e1', toAddr: 'e1', summary: 's1', tokens: 1 },
        { fromAddr: 'e2', toAddr: 'e2', summary: 's2', tokens: 1 },
      ];
      cwm.setEvictionIndex(indexWith(...ranges));
      const lines = ranges.map((r) => `[evicted]: ${r.fromAddr}–${r.toAddr} — ${r.summary}`);
      const withoutJoiners = lines.reduce((sum, l) => sum + est(cwm, l), 0);
      const result = await cwm.wakeUp({ maxL1Tokens: withoutJoiners + 1 });
      expect(result.l1).toBe(lines[1]);
    });
  });
});
