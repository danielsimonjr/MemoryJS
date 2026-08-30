/**
 * Maintenance CLI command coverage (stats, archive, compress, validate).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerMaintenanceCommands } from '../../../src/cli/commands/maintenance.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('maintenance CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerMaintenanceCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'Old', entityType: 'note', observations: ['a'], tags: ['archive-me'], importance: 2 },
      { name: 'DupA', entityType: 'person', observations: ['same text'] },
      { name: 'DupB', entityType: 'person', observations: ['same text'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('stats in table and json formats', async () => {
    await h.parse(['--output-format', 'table', 'stats']);
    expect(h.output()).toMatch(/Entities:/);

    h.logSpy.mockClear();
    await h.parse(['--output-format', 'json', 'stats']);
    const stats = h.lastJson<{ totalEntities: number }>();
    expect(stats.totalEntities).toBeGreaterThanOrEqual(3);
  });

  it('validate reports graph status', async () => {
    await h.parse(['validate']);
    expect(h.output()).toMatch(/Validation|Valid/);
  });

  it('archive with importance filter (dry-run)', async () => {
    await h.parse(['archive', '--importance-lt', '3', '--dry-run']);
    expect(h.output()).toMatch(/archive/i);
  });

  it('archive rejects missing criteria', async () => {
    await expect(h.parse(['archive'])).rejects.toThrow();
  });

  it('compress with threshold (dry-run)', async () => {
    await h.parse(['compress', '--threshold', '0.5', '--dry-run']);
    expect(h.output()).toMatch(/Duplicates found|duplicatesFound/i);
  });

  it('compress json output', async () => {
    await h.parse(['--output-format', 'json', 'compress', '--dry-run']);
    expect(h.lastJson<{ duplicatesFound: number }>().duplicatesFound).toBeGreaterThanOrEqual(0);
  });
});
