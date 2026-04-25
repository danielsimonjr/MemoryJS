import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ObservationManager pre-storage validation hook (T31)', () => {
  let file: string;
  const prevFlag = process.env.MEMORY_VALIDATE_ON_STORE;
  const prevEmbedding = process.env.MEMORY_EMBEDDING_PROVIDER;

  beforeEach(() => {
    file = path.join(os.tmpdir(), `validate-hook-${Date.now()}-${Math.random()}.jsonl`);
    // Disable the local embedding service so MemoryValidator falls back
    // to its no-op ContradictionDetector — this tests the duplicate-
    // detection branch (which doesn't need a semantic backend) cleanly.
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
  });
  afterEach(() => {
    if (existsSync(file)) {
      try { rmSync(file, { force: true }); } catch { /* lock */ }
    }
    if (prevFlag === undefined) delete process.env.MEMORY_VALIDATE_ON_STORE;
    else process.env.MEMORY_VALIDATE_ON_STORE = prevFlag;
    if (prevEmbedding === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = prevEmbedding;
  });

  it('flag off: addObservations behaves as before (duplicates pass through)', async () => {
    delete process.env.MEMORY_VALIDATE_ON_STORE;
    const ctx = new ManagerContext(file);
    await ctx.entityManager.createEntities([{
      name: 'e1',
      entityType: 'note',
      observations: ['initial'],
    }]);
    const result = await ctx.observationManager.addObservations([
      { entityName: 'e1', contents: ['second observation'] },
    ]);
    expect(result[0].addedObservations).toEqual(['second observation']);
  });

  it('flag on: validator skips duplicate observations with a warning', async () => {
    process.env.MEMORY_VALIDATE_ON_STORE = 'true';
    const ctx = new ManagerContext(file);
    // Wire the validator to ObservationManager (the constructor wires only
    // when the flag was set BEFORE construction; for runtime-toggled tests
    // we wire explicitly).
    ctx.observationManager.setMemoryValidator(ctx.memoryValidator);

    await ctx.entityManager.createEntities([{
      name: 'e1',
      entityType: 'note',
      observations: ['existing observation'],
    }]);

    // Validator's `validateConsistency` flags duplicate-observation as a
    // blocking issue. Net behaviour: duplicate is skipped before exact-
    // match dedup would have caught it (validator runs first).
    const result = await ctx.observationManager.addObservations([
      {
        entityName: 'e1',
        contents: ['existing observation', 'a brand new fact'],
      },
    ]);

    // 'existing observation' was filtered as exact-duplicate by the
    // pre-validator-pass, then 'a brand new fact' passed through validation.
    // Net: only the new fact is added.
    expect(result[0].addedObservations).toEqual(['a brand new fact']);
  });

  it('flag on without validator wired: addObservations still works (validator missing is non-blocking)', async () => {
    // Sanity: forgetting setMemoryValidator() shouldn't break the path.
    process.env.MEMORY_VALIDATE_ON_STORE = 'true';
    const ctx = new ManagerContext(file);
    // Note: NOT calling ctx.observationManager.setMemoryValidator(...)
    await ctx.entityManager.createEntities([{
      name: 'e1',
      entityType: 'note',
      observations: [],
    }]);
    const result = await ctx.observationManager.addObservations([
      { entityName: 'e1', contents: ['fresh observation'] },
    ]);
    expect(result[0].addedObservations).toEqual(['fresh observation']);
  });
});
