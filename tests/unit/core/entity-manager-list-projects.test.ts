import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager.listProjects', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-lp-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'a', entityType: 'thing', observations: [], projectId: 'p1' },
      { name: 'b', entityType: 'thing', observations: [], projectId: 'p2' },
      { name: 'c', entityType: 'thing', observations: [], projectId: 'p1' },
      { name: 'd', entityType: 'thing', observations: [] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns distinct projectId values', async () => {
    const projects = await ctx.entityManager.listProjects();
    expect(projects.sort()).toEqual(['p1', 'p2']);
  });

  it('excludes global (undefined) projects', async () => {
    const projects = await ctx.entityManager.listProjects();
    expect(projects).not.toContain(undefined);
  });
});
