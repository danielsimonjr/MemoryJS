import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ObservationManager triggers contradiction detection', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-om-cd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    const mockDetector = new ContradictionDetector(
      { calculateSimilarity: async () => 0.95 } as any,
      0.85
    );
    ctx.observationManager.setContradictionDetector(mockDetector, ctx.entityManager);

    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new version instead of appending when contradiction detected', async () => {
    await ctx.observationManager.addObservations([
      { entityName: 'alice', contents: ['Lives in SF'] },
    ]);

    const newVersion = await ctx.entityManager.getEntity('alice-v2');
    expect(newVersion).toBeDefined();
    expect(newVersion!.observations).toContain('Lives in SF');

    const oldVersion = await ctx.entityManager.getEntity('alice');
    expect(oldVersion!.isLatest).toBe(false);
    expect(oldVersion!.supersededBy).toBe('alice-v2');
  });
});
