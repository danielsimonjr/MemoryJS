import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager version chain navigation', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-vc-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC'],
        version: 1,
        rootEntityName: 'alice',
        isLatest: false,
        supersededBy: 'alice-v2',
      },
      {
        name: 'alice-v2',
        entityType: 'person',
        observations: ['Lives in SF'],
        version: 2,
        parentEntityName: 'alice',
        rootEntityName: 'alice',
        isLatest: false,
        supersededBy: 'alice-v3',
      },
      {
        name: 'alice-v3',
        entityType: 'person',
        observations: ['Lives in LA'],
        version: 3,
        parentEntityName: 'alice-v2',
        rootEntityName: 'alice',
        isLatest: true,
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getVersionChain returns all versions in order', async () => {
    const chain = await ctx.entityManager.getVersionChain('alice');
    expect(chain.map(e => e.name)).toEqual(['alice', 'alice-v2', 'alice-v3']);
  });

  it('getVersionChain works from any entity in chain', async () => {
    const chain = await ctx.entityManager.getVersionChain('alice-v2');
    expect(chain.map(e => e.name)).toEqual(['alice', 'alice-v2', 'alice-v3']);
  });

  it('getLatestVersion returns the latest', async () => {
    const latest = await ctx.entityManager.getLatestVersion('alice');
    expect(latest?.name).toBe('alice-v3');
  });
});
