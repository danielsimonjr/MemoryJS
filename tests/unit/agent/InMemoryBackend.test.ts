import { describe, it, expect } from 'vitest';
import { InMemoryBackend } from '../../../src/agent/InMemoryBackend.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { runMemoryBackendContract } from './IMemoryBackend.contract.test.js';
import type { IGraphStorage } from '../../../src/types/types.js';

/** Tiny mock storage that satisfies IGraphStorage's surface enough for
 * `DecayEngine` to construct without needing real disk I/O. */
function createMockStorage(): IGraphStorage {
  return {
    loadGraph: async () => ({ entities: [], relations: [] }),
    appendEntity: async () => {},
    appendRelation: async () => {},
    saveGraph: async () => {},
    updateEntity: async () => true,
    updateRelation: async () => true,
    deleteEntity: async () => true,
    deleteRelation: async () => true,
    getEntity: async () => null,
    getRelation: async () => null,
    getFilePath: () => '/tmp/mock.jsonl',
    events: { onAny: () => () => {}, on: () => () => {}, off: () => {}, emit: () => {} } as unknown as IGraphStorage['events'],
  } as unknown as IGraphStorage;
}

// Run the parameterized contract suite (9 contract tests).
runMemoryBackendContract('InMemoryBackend', () => {
  const storage = createMockStorage();
  const tracker = new AccessTracker(storage);
  const decay = new DecayEngine(storage, tracker);
  return new InMemoryBackend(decay);
});

// Backend-specific tests.
describe('InMemoryBackend specifics', () => {
  function mk() {
    const storage = createMockStorage();
    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);
    return new InMemoryBackend(decay);
  }

  it('keeps separate sessions isolated', async () => {
    const backend = mk();
    await backend.add({
      id: 'a-1', sessionId: 'a', content: 'apple', role: 'user',
      importance: 2.0, createdAt: new Date().toISOString(),
    });
    await backend.add({
      id: 'b-1', sessionId: 'b', content: 'banana', role: 'user',
      importance: 2.0, createdAt: new Date().toISOString(),
    });
    // Session 'a' results contain only 'apple' content — never 'banana'.
    const aResults = await backend.get_weighted('', 'a', { threshold: 0 });
    expect(aResults.every((r) => r.turn.content === 'apple')).toBe(true);
    expect(aResults.every((r) => r.turn.sessionId === 'a')).toBe(true);
    const bResults = await backend.get_weighted('', 'b', { threshold: 0 });
    expect(bResults.every((r) => r.turn.content === 'banana')).toBe(true);
  });

  it('list_sessions reflects add then delete', async () => {
    const backend = mk();
    await backend.add({
      id: '1', sessionId: 'x', content: 'hello', role: 'user',
      importance: 2.0, createdAt: new Date().toISOString(),
    });
    expect(await backend.list_sessions()).toContain('x');
    await backend.delete_session('x');
    expect(await backend.list_sessions()).not.toContain('x');
  });

  it('preserves insertion order when scores tie', async () => {
    const backend = mk();
    const t = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) {
      await backend.add({
        id: `t-${i}`, sessionId: 's', content: `content ${i}`, role: 'user',
        importance: 2.0, createdAt: t,
      });
    }
    const result = await backend.get_weighted('', 's', { limit: 10, threshold: 0 });
    expect(result.length).toBe(3);
  });

  it('round-trips metadata field', async () => {
    const backend = mk();
    const meta = { provenance: 'unit-test', priority: 'high' };
    await backend.add({
      id: 'm-1', sessionId: 's', content: 'hello metadata', role: 'user',
      importance: 2.0, createdAt: new Date().toISOString(),
      metadata: meta,
    });
    const result = await backend.get_weighted('hello', 's', { threshold: 0 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].turn.metadata).toEqual(meta);
  });
});
