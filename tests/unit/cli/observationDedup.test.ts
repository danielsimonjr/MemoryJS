/**
 * Observation dedup CLI command coverage.
 */

import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerObservationDedupCommands } from '../../../src/cli/commands/observationDedup.js';
import { createCliHarness, cleanupCliHarness, errorLines, type CliHarness } from './helpers/cliTestHarness.js';

describe('obs-dedup CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerObservationDedupCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'A', entityType: 'note', observations: ['shared fact'] },
      { name: 'B', entityType: 'note', observations: ['shared fact'] },
      { name: 'C', entityType: 'note', observations: ['shared fact almost'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('find exact duplicates with filters', async () => {
    await h.parse([
      'obs-dedup', 'find',
      '--entity-type', 'note',
      '--min-occurrences', '2',
      '--max-groups', '10',
    ]);
    const result = h.lastJson<{ count: number }>();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it('find-jaccard near duplicates', async () => {
    await h.parse(['obs-dedup', 'find-jaccard', '--entity-type', 'note,memo']);
    expect(h.lastJson<{ count: number }>().count).toBeGreaterThanOrEqual(0);
  });
});

describe('observationDedup error path', () => {
  it('logs the error once, then exits 1', async () => {
    const h = await createCliHarness(registerObservationDedupCommands);
    try {
      // A directory at the storage path makes every read fail with EISDIR.
      await fs.mkdir(h.storagePath);
      await expect(h.parse(['obs-dedup', 'find'])).rejects.toThrow('process.exit called');
      expect(errorLines(h.errorSpy)).toEqual(['[ERROR] ✗ EISDIR: illegal operation on a directory, read']);
      expect(h.errorSpy.mock.invocationCallOrder[0]).toBeLessThan(h.processExitSpy.mock.invocationCallOrder[0]!);
      expect(h.processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await cleanupCliHarness(h);
    }
  });
});
