/**
 * In-memory procedural-graph backing contract runner.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('requires a path for jsonl and sqlite factory configs', async () => {
    await expect(createProceduralGraphBacking({ type: 'jsonl' })).rejects.toThrow(/path is required/);
    await expect(createProceduralGraphBacking({ type: 'sqlite', path: '' })).rejects.toThrow(/path is required/);
  });

  it('opens a sqlite backing when a path is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      const backing = await createProceduralGraphBacking({ type: 'sqlite', path: join(dir, 'pg.db') });
      expect(backing.kind).toBe('sqlite');
      await backing.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown backing type at the factory exhaustiveness branch', async () => {
    await expect(
      createProceduralGraphBacking({
        type: 'unknown',
      } as unknown as { type: 'jsonl' | 'sqlite' | 'memory' }),
    ).rejects.toThrow(/unsupported procedural graph backing type/i);
  });
});
