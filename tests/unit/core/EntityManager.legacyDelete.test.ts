/**
 * Tests for the legacy deleteEntities fallback in EntityManager (CL-15).
 *
 * A storage without a `deleteEntities` method takes the full-graph rewrite path.
 * That path must drop the named entities and every relation that touches them,
 * and save the result once.
 */

import { describe, it, expect } from 'vitest';
import { AsyncMutex } from '../../../src/utils/AsyncMutex.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';

function makeLegacyStorage(graph: KnowledgeGraph) {
  const saved: KnowledgeGraph[] = [];
  const storage = {
    graphMutex: new AsyncMutex(),
    ensureLoaded: async () => {},
    getEntityByName: () => undefined,
    getGraphForMutation: async () => graph,
    saveGraph: async (g: KnowledgeGraph) => {
      saved.push(JSON.parse(JSON.stringify(g)) as KnowledgeGraph);
    },
  };
  return { storage: storage as unknown as GraphStorage, saved };
}

describe('EntityManager.deleteEntities legacy fallback', () => {
  it('removes the named entities and their incident relations, then saves once', async () => {
    const graph: KnowledgeGraph = {
      entities: [
        { name: 'A', entityType: 't', observations: [] },
        { name: 'B', entityType: 't', observations: [] },
        { name: 'C', entityType: 't', observations: [] },
      ],
      relations: [
        { from: 'A', to: 'B', relationType: 'r' },
        { from: 'B', to: 'C', relationType: 'r' },
        { from: 'C', to: 'C', relationType: 'self' },
      ],
    };
    const { storage, saved } = makeLegacyStorage(graph);
    const manager = new EntityManager(storage);

    await manager.deleteEntities(['B']);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.entities.map(e => e.name)).toEqual(['A', 'C']);
    expect(saved[0]!.relations).toEqual([{ from: 'C', to: 'C', relationType: 'self' }]);
  });

  it('saves an unchanged graph when no named entity exists', async () => {
    const graph: KnowledgeGraph = {
      entities: [{ name: 'A', entityType: 't', observations: [] }],
      relations: [],
    };
    const { storage, saved } = makeLegacyStorage(graph);
    const manager = new EntityManager(storage);

    await manager.deleteEntities(['ghost']);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.entities.map(e => e.name)).toEqual(['A']);
  });
});
