import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager auto-stamps projectId from context default', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-em-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stamps defaultProjectId on new entities without explicit projectId', async () => {
    const ctx = new ManagerContext({
      storagePath: path.join(tmpDir, 'memory.jsonl'),
      defaultProjectId: 'proj-1',
    });
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: [] },
    ]);
    const entity = await ctx.entityManager.getEntity('alice');
    expect(entity?.projectId).toBe('proj-1');
  });

  it('does not overwrite explicit projectId', async () => {
    const ctx = new ManagerContext({
      storagePath: path.join(tmpDir, 'memory2.jsonl'),
      defaultProjectId: 'proj-1',
    });
    await ctx.entityManager.createEntities([
      { name: 'bob', entityType: 'person', observations: [], projectId: 'proj-2' },
    ]);
    const entity = await ctx.entityManager.getEntity('bob');
    expect(entity?.projectId).toBe('proj-2');
  });

  it('leaves projectId undefined when no default is set', async () => {
    const ctx = new ManagerContext(path.join(tmpDir, 'memory3.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: [] },
    ]);
    const entity = await ctx.entityManager.getEntity('carol');
    expect(entity?.projectId).toBeUndefined();
  });
});
