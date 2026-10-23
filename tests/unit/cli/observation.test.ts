/**
 * Observation CLI command coverage.
 */

import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerObservationCommands } from '../../../src/cli/commands/observation.js';
import { createCliHarness, cleanupCliHarness, errorLines, type CliHarness } from './helpers/cliTestHarness.js';

describe('observation CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerObservationCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['seed'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('add, list (table/json/csv), and remove observations', async () => {
    await h.parse(['observation', 'add', 'Alice', 'note', 'one']);
    expect(h.output()).toMatch(/Added/);

    await h.parse(['observation', 'list', 'Alice']);
    expect(h.output()).toMatch(/note/);

    h.logSpy.mockClear();
    await h.parse(['--output-format', 'json', 'observation', 'list', 'Alice']);
    expect(h.lastJson<string[]>()).toContain('seed');

    h.logSpy.mockClear();
    await h.parse(['--output-format', 'csv', 'observation', 'list', 'Alice']);
    expect(h.output()).toMatch(/observation/);

    await h.parse(['observation', 'remove', 'Alice', 'seed']);
    expect(h.output()).toMatch(/Removed/);
  });

  it('remove/list fail for missing entity', async () => {
    await expect(h.parse(['observation', 'remove', 'Ghost', 'x'])).rejects.toThrow();
    await expect(h.parse(['observation', 'list', 'Ghost'])).rejects.toThrow();
  });
});

describe('observation error path', () => {
  it('logs the error once, then exits 1', async () => {
    const h = await createCliHarness(registerObservationCommands);
    try {
      // A directory at the storage path makes every read fail with EISDIR.
      await fs.mkdir(h.storagePath);
      await expect(h.parse(['observation', 'list', 'nosuch'])).rejects.toThrow('process.exit called');
      expect(errorLines(h.errorSpy)).toEqual(['[ERROR] ✗ EISDIR: illegal operation on a directory, read']);
      expect(h.errorSpy.mock.invocationCallOrder[0]).toBeLessThan(h.processExitSpy.mock.invocationCallOrder[0]!);
      expect(h.processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await cleanupCliHarness(h);
    }
  });
});
