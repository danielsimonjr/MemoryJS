import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CompressionManager.priorityDedup', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'auth-v1', entityType: 'decision', observations: ['Use JWT'], importance: 3 },
      { name: 'auth-v2', entityType: 'decision', observations: ['Use JWT tokens', 'Added refresh'], importance: 8 },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps higher-priority entity and removes lower', async () => {
    const result = await ctx.compressionManager.priorityDedup({ threshold: 0.5 });
    if (result.groups.length > 0) {
      expect(result.groups[0].kept).toBe('auth-v2'); // higher importance
    }
  });

  it('dryRun returns groups without merging', async () => {
    const result = await ctx.compressionManager.priorityDedup({ threshold: 0.5, dryRun: true });
    // Entities should still exist
    const v1 = await ctx.entityManager.getEntity('auth-v1');
    expect(v1).toBeDefined();
  });

  it('returns empty groups when no duplicates found', async () => {
    await ctx.entityManager.createEntities([
      { name: 'unique-thing', entityType: 'other', observations: ['completely different'] },
    ]);
    const result = await ctx.compressionManager.priorityDedup({ threshold: 0.99 });
    expect(result.groups).toEqual([]);
    expect(result.totalRemoved).toBe(0);
  });
});
