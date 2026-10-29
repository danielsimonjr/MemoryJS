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

  it('getLatestVersion returns the draft head', async () => {
    await ctx.entityManager.createEntities([
      {
        name: 'brew',
        entityType: 'concept',
        observations: ['keeps coffee'],
        version: 1,
        rootEntityName: 'brew',
        isLatest: false,
        lifecycleStatus: 'published',
        supersededBy: 'brew-v2',
      },
      {
        name: 'brew-v2',
        entityType: 'concept',
        observations: ['keeps coffee', 'trial tea'],
        version: 2,
        parentEntityName: 'brew',
        rootEntityName: 'brew',
        isLatest: true,
        lifecycleStatus: 'draft',
      },
    ]);
    const latest = await ctx.entityManager.getLatestVersion('brew');
    expect(latest?.name).toBe('brew-v2');
    expect(latest?.lifecycleStatus).toBe('draft');
  });

  it('getLatestPublished returns the published parent while the head is draft', async () => {
    await ctx.entityManager.createEntities([
      {
        name: 'brew',
        entityType: 'concept',
        observations: ['keeps coffee'],
        version: 1,
        rootEntityName: 'brew',
        isLatest: false,
        lifecycleStatus: 'published',
        supersededBy: 'brew-v2',
      },
      {
        name: 'brew-v2',
        entityType: 'concept',
        observations: ['trial tea'],
        version: 2,
        parentEntityName: 'brew',
        rootEntityName: 'brew',
        isLatest: true,
        lifecycleStatus: 'draft',
      },
    ]);
    const published = await ctx.entityManager.getLatestPublished('brew');
    expect(published?.name).toBe('brew');
  });

  it('getLatestPublished returns the published parent after the head is archived', async () => {
    await ctx.entityManager.createEntities([
      {
        name: 'brew',
        entityType: 'concept',
        observations: ['keeps coffee'],
        version: 1,
        rootEntityName: 'brew',
        isLatest: false,
        lifecycleStatus: 'published',
        supersededBy: 'brew-v2',
      },
      {
        name: 'brew-v2',
        entityType: 'concept',
        observations: ['trial tea'],
        version: 2,
        parentEntityName: 'brew',
        rootEntityName: 'brew',
        isLatest: true,
        lifecycleStatus: 'archived',
      },
    ]);
    const published = await ctx.entityManager.getLatestPublished('brew');
    expect(published?.name).toBe('brew');
  });

  it('getLatestPublished returns the head when the head is published', async () => {
    const published = await ctx.entityManager.getLatestPublished('alice');
    expect(published?.name).toBe('alice-v3');
  });
});
