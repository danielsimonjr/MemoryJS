/**
 * Extended search CLI command coverage (registerSearchCommands).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerSearchCommands } from '../../../src/cli/commands/search.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('search CLI (extended modes)', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerSearchCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['engineer typescript'] },
      { name: 'Bob', entityType: 'person', observations: ['manager'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('auto search with type filter and limit', async () => {
    await h.parse(['search', 'engineer', '-l', '5', '-t', 'person']);
    expect(h.output().length).toBeGreaterThan(0);
  });

  it('ranked, boolean, fuzzy modes', async () => {
    for (const mode of ['--ranked', '--boolean', '--fuzzy']) {
      h.logSpy.mockClear();
      await h.parse(['search', 'Alice', mode, '--threshold', '0.5']);
      expect(h.output().length).toBeGreaterThan(0);
    }
  });

  it('--suggest returns suggestions (possibly empty)', async () => {
    await h.parse(['search', 'eng', '--suggest']);
    expect(h.output()).toBeTruthy();
  });

  it('--suggest json format', async () => {
    await h.parse(['--output-format', 'json', 'search', 'eng', '--suggest']);
    expect(Array.isArray(h.lastJson())).toBe(true);
  });
});
