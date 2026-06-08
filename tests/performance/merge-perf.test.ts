import { describe, it, expect } from 'vitest';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { Entity } from '../../src/types/index.js';

describe('Merge Performance', () => {
  it('should merge entities efficiently', async () => {
    // We want a large graph and to merge many entities
    const numEntities = 100000;
    const numMergeEntities = 2000;

    // Create an array of entities where index is used in the name
    const entities: Entity[] = Array.from({ length: numEntities }, (_, i) => ({
      name: `Entity${i}`,
      entityType: 'test',
      observations: [`Obs ${i}`],
      isLatest: true
    }));

    // Pick the names from the array (so they match the find condition)
    const mergeNames = Array.from({ length: numMergeEntities }, (_, i) => `Entity${i * 10}`); // Spread out the ones we merge

    const mockStorage = {
      getGraphForMutation: async () => ({
        entities,
        relations: []
      }),
      updateEntity: async () => {},
      appendEntity: async () => {},
      saveGraph: async () => {},
      deleteEntity: async () => {},
      deleteEntities: async () => {}, // In case bulk deletion is used
    } as unknown as GraphStorage;

    const compressionManager = new CompressionManager(mockStorage);

    const start = process.hrtime.bigint();

    await compressionManager.mergeEntities(mergeNames, 'MergedEntity');

    const end = process.hrtime.bigint();
    const timeMs = Number(end - start) / 1_000_000;
    console.log(`Merge time: ${timeMs.toFixed(2)}ms`);
    expect(timeMs).toBeLessThan(5000); // adjust as needed
  });
});
