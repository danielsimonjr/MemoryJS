/**
 * In-memory procedural-graph backing contract runner.
 */

import { InMemoryProceduralGraphBacking } from '../../../../../../src/agent/procedural/graph/backing/InMemoryProceduralGraphBacking.js';
import { createProceduralGraphBacking } from '../../../../../../src/agent/procedural/graph/backing/IProceduralGraphBacking.js';
import { runBackingContract } from './backingContract.js';

runBackingContract('memory', async () => new InMemoryProceduralGraphBacking());

describe('createProceduralGraphBacking memory factory', () => {
  it('returns a memory backing and never reads MEMORY_STORAGE_TYPE', async () => {
    const previous = process.env.MEMORY_STORAGE_TYPE;
    process.env.MEMORY_STORAGE_TYPE = 'sqlite';
    try {
      const backing = await createProceduralGraphBacking({ type: 'memory' });
      expect(backing.kind).toBe('memory');
      await backing.close();
    } finally {
      if (previous === undefined) {
        delete process.env.MEMORY_STORAGE_TYPE;
      } else {
        process.env.MEMORY_STORAGE_TYPE = previous;
      }
    }
  });
});
