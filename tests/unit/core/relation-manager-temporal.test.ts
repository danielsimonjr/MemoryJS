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
