/**
 * Exclusion CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerExclusionCommands } from '../../../src/cli/commands/exclusion.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('exclude CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerExclusionCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'secret', entityType: 'note', observations: ['password123'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('add, list, remove lifecycle', async () => {
    await h.parse(['exclude', 'add', 'password', '--scope', 'both', '--reason', 'PII']);
    const addLine = h.lastLine();
    expect(addLine).toMatch(/Added rule/);
    const id = addLine.match(/Added rule ([^:]+):/)?.[1];
    expect(id).toBeTruthy();

    await h.parse(['exclude', 'list']);
    expect(h.output()).toMatch(/password/);

    await h.parse(['exclude', 'remove', id!]);
    expect(h.output()).toMatch(/Removed rule/);
  });

  it('list empty state', async () => {
    await h.parse(['exclude', 'list']);
    expect(h.output()).toMatch(/no exclusion rules/);
  });

  it('rejects invalid scope', async () => {
    await expect(
      h.parse(['exclude', 'add', 'x', '--scope', 'invalid']),
    ).rejects.toThrow();
  });

  it('remove unknown id fails', async () => {
    await expect(h.parse(['exclude', 'remove', 'nope'])).rejects.toThrow();
  });
});
