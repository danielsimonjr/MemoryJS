import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SemanticForget } from '../../../src/features/SemanticForget.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticForget exact match path', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let forget: SemanticForget;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Likes coffee'],
      },
      {
        name: 'bob',
        entityType: 'person',
        observations: ['Lives in NYC', 'Hates tea'],
      },
    ]);
    forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes exact-matching observation across all entities', async () => {
    const result = await forget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);
    expect(result.deletedObservations.map(d => d.entityName).sort()).toEqual(['alice', 'bob']);
  });

  it('returns not_found for missing content', async () => {
    const result = await forget.forgetByContent('Lives in Mars');
    expect(result.method).toBe('not_found');
    expect(result.deletedObservations).toHaveLength(0);
  });

  it('dryRun does not mutate storage', async () => {
    const result = await forget.forgetByContent('Lives in NYC', { dryRun: true });
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);

    const alice = await ctx.entityManager.getEntity('alice');
    expect(alice!.observations).toContain('Lives in NYC');
  });

  it('deletes entity when all observations are removed', async () => {
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: ['Only fact'] },
    ]);
    const result = await forget.forgetByContent('Only fact');
    expect(result.deletedEntities).toContain('carol');

    const carol = await ctx.entityManager.getEntity('carol');
    expect(carol).toBeNull();
  });

  it('respects projectId filter', async () => {
    await ctx.entityManager.createEntities([
      { name: 'dan', entityType: 'person', observations: ['Lives in NYC'], projectId: 'p1' },
    ]);
    const result = await forget.forgetByContent('Lives in NYC', { projectId: 'p1' });
    expect(result.deletedObservations).toHaveLength(1);
    expect(result.deletedObservations[0].entityName).toBe('dan');
  });
});
