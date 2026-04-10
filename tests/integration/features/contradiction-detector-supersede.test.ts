import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockSearch = (): SemanticSearch => ({
  calculateSimilarity: async () => 0.9,
} as unknown as SemanticSearch);

describe('ContradictionDetector.supersede', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Likes coffee'],
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new entity version with incremented version number', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const old = (await ctx.entityManager.getEntity('alice'))!;
    const updated = await detector.supersede(
      old,
      ['Lives in SF'],
      ctx.entityManager
    );
    expect(updated.name).toBe('alice-v2');
    expect(updated.version).toBe(2);
    expect(updated.parentEntityName).toBe('alice');
    expect(updated.rootEntityName).toBe('alice');
    expect(updated.isLatest).toBe(true);
  });

  it('marks old entity as superseded', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const old = (await ctx.entityManager.getEntity('alice'))!;
    await detector.supersede(old, ['Lives in SF'], ctx.entityManager);
    const oldReloaded = (await ctx.entityManager.getEntity('alice'))!;
    expect(oldReloaded.isLatest).toBe(false);
    expect(oldReloaded.supersededBy).toBe('alice-v2');
  });

  it('preserves rootEntityName across multiple supersessions', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const v1 = (await ctx.entityManager.getEntity('alice'))!;
    const v2 = await detector.supersede(v1, ['Lives in SF'], ctx.entityManager);
    const v3 = await detector.supersede(v2, ['Lives in LA'], ctx.entityManager);
    expect(v3.name).toBe('alice-v3');
    expect(v3.version).toBe(3);
    expect(v3.parentEntityName).toBe('alice-v2');
    expect(v3.rootEntityName).toBe('alice');
  });
});
