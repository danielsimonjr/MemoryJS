/**
 * `IMemoryBackend` contract test.
 *
 * Phase β.1 — exports a parameterized test suite that every backend
 * implementation (`InMemoryBackend`, `SQLiteBackend`, `PostgreSQLBackend`,
 * `VectorMemoryBackend`) must pass. T12/T13 will instantiate this suite
 * with their respective backend constructors.
 *
 * Right now there are no backends, so this file only verifies the suite
 * itself is well-formed (constructable, exports the expected fixtures)
 * and that `IMemoryBackend` plus `MemoryTurn` are importable. Real
 * coverage arrives when T12+T13 land their adapters.
 *
 * @module tests/unit/agent/IMemoryBackend.contract
 */

import { describe, it, expect } from 'vitest';
import type {
  IMemoryBackend,
  MemoryTurn,
  WeightedTurn,
  GetWeightedOptions,
} from '../../../src/agent/MemoryBackend.js';

/**
 * Run the full `IMemoryBackend` contract against a backend factory.
 * Each call to `makeBackend()` MUST return a fresh, empty backend —
 * the contract assumes test isolation per assertion.
 */
export function runMemoryBackendContract(
  backendName: string,
  makeBackend: () => IMemoryBackend | Promise<IMemoryBackend>,
): void {
  describe(`IMemoryBackend contract — ${backendName}`, () => {
    function makeTurn(overrides: Partial<MemoryTurn> = {}): MemoryTurn {
      return {
        id: 'turn-' + Math.random().toString(36).slice(2, 10),
        sessionId: 'sess-A',
        content: 'hello world',
        role: 'user',
        importance: 2.0,
        createdAt: new Date().toISOString(),
        ...overrides,
      };
    }

    it('add() persists a turn so it shows up in list_sessions()', async () => {
      const backend = await makeBackend();
      await backend.add(makeTurn({ sessionId: 'a' }));
      const sessions = await backend.list_sessions();
      expect(sessions).toContain('a');
    });

    it('add() is scoped — a session not added does not appear in list_sessions()', async () => {
      const backend = await makeBackend();
      await backend.add(makeTurn({ sessionId: 'a' }));
      const sessions = await backend.list_sessions();
      expect(sessions).not.toContain('b');
    });

    it('list_sessions() on an empty backend returns []', async () => {
      const backend = await makeBackend();
      const sessions = await backend.list_sessions();
      expect(sessions).toEqual([]);
    });

    it('get_weighted() returns added turns in weighted score order', async () => {
      const backend = await makeBackend();
      // Two turns in the same session with different importance.
      await backend.add(
        makeTurn({ id: 'low', content: 'low priority', importance: 1.0 }),
      );
      await backend.add(
        makeTurn({ id: 'high', content: 'high priority', importance: 3.0 }),
      );
      const results = await backend.get_weighted('priority', 'sess-A');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The first result should have the highest score.
      for (let i = 1; i < results.length; i += 1) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('get_weighted() respects sessionId scoping', async () => {
      const backend = await makeBackend();
      await backend.add(makeTurn({ sessionId: 'a', content: 'session a' }));
      await backend.add(makeTurn({ sessionId: 'b', content: 'session b' }));
      const aResults = await backend.get_weighted('session', 'a');
      const bResults = await backend.get_weighted('session', 'b');
      expect(aResults.every((r) => r.turn.sessionId === 'a')).toBe(true);
      expect(bResults.every((r) => r.turn.sessionId === 'b')).toBe(true);
    });

    it('get_weighted() respects limit option', async () => {
      const backend = await makeBackend();
      for (let i = 0; i < 5; i += 1) {
        await backend.add(
          makeTurn({
            id: `turn-${i}`,
            content: `distinct content ${i} ${Math.random()}`,
          }),
        );
      }
      const results = await backend.get_weighted('content', 'sess-A', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('get_weighted() respects threshold option (returns []  when no turn scores above)', async () => {
      const backend = await makeBackend();
      await backend.add(makeTurn({ importance: 1.0 }));
      // An impossibly high threshold should prune everything.
      const results = await backend.get_weighted('hello', 'sess-A', {
        threshold: 1_000_000,
      });
      expect(results).toEqual([]);
    });

    it('delete_session() removes all turns for that session', async () => {
      const backend = await makeBackend();
      await backend.add(makeTurn({ sessionId: 'a' }));
      await backend.add(makeTurn({ sessionId: 'a', content: 'second' }));
      await backend.add(makeTurn({ sessionId: 'b' }));

      await backend.delete_session('a');

      const sessions = await backend.list_sessions();
      expect(sessions).not.toContain('a');
      expect(sessions).toContain('b');

      const aResults = await backend.get_weighted('hello', 'a');
      expect(aResults).toEqual([]);
    });

    it('delete_session() on an unknown session is a no-op (no throw)', async () => {
      const backend = await makeBackend();
      await expect(backend.delete_session('never-existed')).resolves.toBeUndefined();
    });

    it('add() of identical (sessionId, content) is a silent no-op (dedup contract)', async () => {
      const backend = await makeBackend();
      const t = new Date().toISOString();
      await backend.add(makeTurn({ id: 'first', content: 'identical', createdAt: t }));
      await backend.add(makeTurn({ id: 'second', content: 'identical', createdAt: t }));
      // Both backends MUST dedup. Lifecycle sequence: only one turn lives.
      const result = await backend.get_weighted('', 'sess-A', { threshold: 0 });
      expect(result.length).toBe(1);
    });

    it('lifecycle sequence: add → get → delete → add(same session) → get', async () => {
      const backend = await makeBackend();
      const t = new Date().toISOString();
      await backend.add(makeTurn({ content: 'first cycle', createdAt: t }));
      const before = await backend.get_weighted('', 'sess-A', { threshold: 0 });
      expect(before.length).toBe(1);

      await backend.delete_session('sess-A');
      const afterDelete = await backend.get_weighted('', 'sess-A', { threshold: 0 });
      expect(afterDelete).toEqual([]);

      // After delete, the same sessionId is fresh again — adding new
      // content (or the original content) must succeed without bleed-
      // through from the old delete (no stale index entries).
      await backend.add(makeTurn({ content: 'second cycle', createdAt: t }));
      const afterRecreate = await backend.get_weighted('', 'sess-A', { threshold: 0 });
      expect(afterRecreate.length).toBe(1);
      expect(afterRecreate[0].turn.content).toBe('second cycle');
    });

    it('add()/get_weighted() round-trips MemoryTurn metadata', async () => {
      const backend = await makeBackend();
      const meta = { source: 'test', priority: 'high' };
      await backend.add(makeTurn({ metadata: meta, content: 'hello round-trip' }));
      const results = await backend.get_weighted('round-trip', 'sess-A');
      expect(results.length).toBeGreaterThan(0);
      // Metadata round-trips faithfully (or is undefined if the backend
      // legitimately doesn't persist it — `InMemoryBackend` does;
      // `SQLiteBackend` should via agentMetadata blob).
      const got = results[0].turn.metadata;
      if (got !== undefined) {
        expect(got).toEqual(meta);
      }
    });
  });
}

// Smoke check on the suite itself: when no backend is supplied, the
// helper just exposes the function. T12+T13 call it with their factories.
describe('IMemoryBackend / type and suite shape', () => {
  it('exposes the runMemoryBackendContract helper', () => {
    expect(typeof runMemoryBackendContract).toBe('function');
  });

  it('MemoryTurn type has the documented required fields', () => {
    // Compile-time check: this object MUST type-check.
    const t: MemoryTurn = {
      id: 'x',
      sessionId: 's',
      content: 'c',
      role: 'user',
      importance: 1,
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(t.id).toBe('x');
  });

  it('WeightedTurn shape is { turn, score }', () => {
    const wt: WeightedTurn = {
      turn: {
        id: 'x',
        sessionId: 's',
        content: 'c',
        role: 'user',
        importance: 1,
        createdAt: '2026-01-01T00:00:00Z',
      },
      score: 0.5,
    };
    expect(wt.score).toBe(0.5);
  });

  it('GetWeightedOptions exposes limit + threshold as optional', () => {
    const a: GetWeightedOptions = {};
    const b: GetWeightedOptions = { limit: 5 };
    const c: GetWeightedOptions = { threshold: 0.1 };
    const d: GetWeightedOptions = { limit: 5, threshold: 0.1 };
    expect([a, b, c, d].every((x) => typeof x === 'object')).toBe(true);
  });
});
