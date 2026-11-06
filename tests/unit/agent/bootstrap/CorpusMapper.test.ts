/** CorpusMapper (RS-10): levels, relations, conflicts, determinism, empty corpus, partition rules. */
import { describe, it, expect } from 'vitest';
import { CorpusMapper, LOCATED_AT_RELATION, navigationLeafName, type CorpusSource } from '../../../../src/agent/bootstrap/CorpusMapper.js';
import { TOPIC_SUMMARIZES } from '../../../../src/agent/reconstruction/MemoryGraphBridge.js';
import { isNavigationNodeEntity } from '../../../../src/types/agent-memory.js';
import type { IGraphStorage, Relation } from '../../../../src/types/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { syntheticCorpus } from './bootstrapFixtures.js';

/** All relations of a storage. */
async function relationsOf(storage: IGraphStorage): Promise<Relation[]> {
  return [...(await storage.loadGraph()).relations];
}

/** Navigation nodes of a storage, by name. */
async function navNodes(storage: IGraphStorage) {
  return (await storage.loadGraph()).entities.filter(isNavigationNodeEntity);
}

withBothBackends('CorpusMapper', (backend) => {
  it('maps 50 documents in 5 groups into >= 2 levels with one root', async () => {
    const storage = backend.create();
    const map = await new CorpusMapper({ storage }).map(syntheticCorpus(50, 5));
    expect(map.levels).toBeGreaterThanOrEqual(2);
    expect(map.rootId).toBeDefined();
    const nodes = await navNodes(storage);
    expect(nodes.length).toBe(map.nodeCount);
    const roots = nodes.filter((n) => n.navigationNodeRecord.level === map.levels);
    expect(roots.map((n) => n.name)).toEqual([map.rootId]);
    expect(map.conflicts).toEqual([]);
  });

  it('links parents to children with TOPIC_SUMMARIZES and sets hierarchy', async () => {
    const storage = backend.create();
    const map = await new CorpusMapper({ storage }).map(syntheticCorpus(50, 5));
    const topic = (await relationsOf(storage)).filter((r) => r.relationType === TOPIC_SUMMARIZES);
    // A tree: every node except the root has exactly one parent edge.
    expect(topic.length).toBe(map.nodeCount - 1);
    const graph = await storage.loadGraph();
    const parentless = graph.entities.filter(isNavigationNodeEntity).filter((e) => !e.parentId);
    expect(parentless.map((e) => e.name)).toEqual([map.rootId]);
  });

  it('creates one source entity and one located_at relation per leaf', async () => {
    const storage = backend.create();
    await new CorpusMapper({ storage }).map(syntheticCorpus(50, 5));
    const located = (await relationsOf(storage)).filter((r) => r.relationType === LOCATED_AT_RELATION);
    expect(located.length).toBe(50);
    for (const rel of located.slice(0, 5)) {
      expect(rel.from).toMatch(/^nav-0-/);
      expect(storage.getEntityByName(rel.to)?.entityType).toBe('source');
    }
  });

  it('keeps the first text for a repeated ref and records the second as a conflict', async () => {
    const storage = backend.create();
    const sources: CorpusSource[] = [
      { ref: 'a.md', text: 'alpha ledger first version' },
      { ref: 'b.md', text: 'beta ledger' },
      { ref: 'a.md', text: 'alpha ledger second version' },
      { ref: 'b.md', text: 'beta ledger' },
    ];
    const map = await new CorpusMapper({ storage }).map(sources);
    expect(map.conflicts.map((c) => c.ref)).toEqual(['a.md']);
    const leaf = storage.getEntityByName(navigationLeafName('a.md'))!;
    expect(leaf.observations.some((o) => o.startsWith('[conflict]: '))).toBe(true);
    expect(isNavigationNodeEntity(leaf) && leaf.navigationNodeRecord.summary.includes('first')).toBe(true);
    const located = (await relationsOf(storage)).filter((r) => r.relationType === LOCATED_AT_RELATION);
    expect(located.length).toBe(2);
  });

  it('is a no-op for a repeated ref with identical text', async () => {
    const storage = backend.create();
    const sources: CorpusSource[] = [
      { ref: 'a.md', text: 'same words here' },
      { ref: 'a.md', text: 'same words here' },
    ];
    const map = await new CorpusMapper({ storage }).map(sources);
    expect(map.conflicts).toEqual([]);
    expect(map.nodeCount).toBe(2);
  });

  it('is deterministic: the same inputs give the same names on fresh storages', async () => {
    const a = backend.create();
    const b = backend.create();
    const mapA = await new CorpusMapper({ storage: a }).map(syntheticCorpus(20, 4));
    const mapB = await new CorpusMapper({ storage: b }).map(syntheticCorpus(20, 4));
    expect(mapB).toEqual(mapA);
    expect((await navNodes(a)).map((n) => n.name).sort()).toEqual((await navNodes(b)).map((n) => n.name).sort());
  });

  it('re-running over stored nodes writes nothing new', async () => {
    const storage = backend.create();
    const mapper = new CorpusMapper({ storage });
    const first = await mapper.map(syntheticCorpus(12, 3));
    const countBefore = (await storage.loadGraph()).entities.length;
    const second = await mapper.map(syntheticCorpus(12, 3));
    expect(second.rootId).toBe(first.rootId);
    expect((await storage.loadGraph()).entities.length).toBe(countBefore);
  });

  it('adds a conflict observation to a stored node once across re-runs', async () => {
    const storage = backend.create();
    const mapper = new CorpusMapper({ storage });
    await mapper.map([{ ref: 'a.md', text: 'first text' }]);
    const again = [
      { ref: 'a.md', text: 'first text' },
      { ref: 'a.md', text: 'changed text' },
    ];
    const map1 = await mapper.map(again);
    const map2 = await mapper.map(again);
    expect(map1.conflicts.length).toBe(1);
    expect(map2.conflicts.length).toBe(1);
    const leaf = storage.getEntityByName(navigationLeafName('a.md'))!;
    expect(leaf.observations.filter((o) => o.startsWith('[conflict]: ')).length).toBe(1);
  });

  it('returns an empty map for an empty corpus without throwing', async () => {
    const storage = backend.create();
    const map = await new CorpusMapper({ storage }).map([]);
    expect(map).toEqual({ rootId: undefined, levels: 0, nodeCount: 0, conflicts: [] });
  });

  it('reads text through a loader when no inline text is given', async () => {
    const storage = backend.create();
    const map = await new CorpusMapper({ storage }).map([{ ref: 'lazy.md', loader: async () => 'loaded body text' }]);
    expect(map.rootId).toBeDefined();
    expect(storage.getEntityByName(navigationLeafName('lazy.md'))).toBeDefined();
  });

  it('rejects a source with neither text nor loader', async () => {
    const storage = backend.create();
    await expect(new CorpusMapper({ storage }).map([{ ref: 'x.md' }])).rejects.toThrow(/neither text nor loader/);
  });

  it('rejects a partitioner that returns an empty shard', async () => {
    const storage = backend.create();
    const sources = syntheticCorpus(4, 2);
    await expect(
      new CorpusMapper({ storage }).map(sources, { partitioner: (s) => [s, []] }),
    ).rejects.toThrow(/empty shard/);
  });

  it('rejects a partitioner that drops a source', async () => {
    const storage = backend.create();
    const sources = syntheticCorpus(4, 2);
    await expect(
      new CorpusMapper({ storage }).map(sources, { partitioner: (s) => [s.slice(1)] }),
    ).rejects.toThrow(/dropped a source/);
  });

  it('rejects a partitioner that duplicates a source', async () => {
    const storage = backend.create();
    const sources = syntheticCorpus(3, 2);
    await expect(
      new CorpusMapper({ storage }).map(sources, { partitioner: (s) => [[...s, s[0]!]] }),
    ).rejects.toThrow(/duplicated a source/);
  });

  it('rejects a shard size below 2 and an already-aborted signal', async () => {
    const storage = backend.create();
    const sources = syntheticCorpus(3, 2);
    await expect(new CorpusMapper({ storage }).map(sources, { shardSize: 1 })).rejects.toThrow(/shardSize/);
    const controller = new AbortController();
    controller.abort();
    await expect(new CorpusMapper({ storage }).map(sources, { signal: controller.signal })).rejects.toThrow();
  });
});
