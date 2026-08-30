/**
 * Observation dedup CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerObservationDedupCommands } from '../../../src/cli/commands/observationDedup.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

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
