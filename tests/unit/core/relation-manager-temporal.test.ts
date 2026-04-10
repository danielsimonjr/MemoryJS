import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('RelationManager.invalidateRelation', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-rt-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-06-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets validUntil on matching active relation', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBe('2026-03-01');
  });

  it('defaults ended to current ISO timestamp', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBeDefined();
    expect(r?.properties?.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when no active relation found', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    await expect(
      ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-04-01')
    ).rejects.toThrow();
  });
});

describe('RelationManager.queryAsOf', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-qa-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only relations valid at the given date', async () => {
    const mid2025 = await ctx.relationManager.queryAsOf('kai', '2025-06-15');
    expect(mid2025.map(r => r.to)).toEqual(['orion']);

    const mid2026 = await ctx.relationManager.queryAsOf('kai', '2026-06-15');
    expect(mid2026.map(r => r.to)).toEqual(['nova']);
  });

  it('includes relations without validFrom (always valid start)', async () => {
    await ctx.relationManager.createRelations([
      { from: 'kai', to: 'kai', relationType: 'self', properties: {} },
    ]);
    const result = await ctx.relationManager.queryAsOf('kai', '2020-01-01');
    expect(result.some(r => r.relationType === 'self')).toBe(true);
  });

  it('supports direction filter', async () => {
    const outgoing = await ctx.relationManager.queryAsOf('kai', '2026-06-15', {
      direction: 'outgoing',
    });
    expect(outgoing.length).toBeGreaterThan(0);
    expect(outgoing.every(r => r.from === 'kai')).toBe(true);
  });
});

describe('RelationManager.timeline', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-tl-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all relations sorted chronologically by validFrom', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.length).toBe(2);
    expect(tl[0].to).toBe('orion');
    expect(tl[1].to).toBe('nova');
  });

  it('includes expired and current relations', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.some(r => r.properties?.validUntil)).toBe(true);
    expect(tl.some(r => !r.properties?.validUntil)).toBe(true);
  });
});
