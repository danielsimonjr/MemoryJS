import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CompressionManager respects version chains', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Works at TechCorp'],
        rootEntityName: 'alice',
        version: 1,
        isLatest: false,
        supersededBy: 'alice_v2',
        tags: ['employee', 'developer'],
      },
      {
        name: 'alice_v2',
        entityType: 'person',
        observations: ['Lives in SF', 'Works at TechCorp'],
        parentEntityName: 'alice',
        rootEntityName: 'alice',
        version: 2,
        isLatest: true,
        tags: ['employee', 'developer'],
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('findDuplicates excludes superseded entities', async () => {
    const dupes = await ctx.compressionManager.findDuplicates(0.5);
    const names = dupes.flatMap(d => d.map(e => e));
    expect(names).not.toContain('alice');
  });
});
