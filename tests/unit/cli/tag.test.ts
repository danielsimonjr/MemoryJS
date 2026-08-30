/**
 * Tag CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerTagCommands } from '../../../src/cli/commands/tag.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('tag CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerTagCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: [] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('add and remove tags', async () => {
    await h.parse(['tag', 'add', 'Alice', 'vip', 'eng']);
    expect(h.output()).toMatch(/Added tags/);

    await h.parse(['tag', 'remove', 'Alice', 'vip']);
    expect(h.output()).toMatch(/Removed tags/);
  });

  it('alias and aliases in json/csv/table formats', async () => {
    await h.parse(['tag', 'alias', 'js', 'javascript', '-d', 'lang alias']);
    expect(h.output()).toMatch(/Created alias/);

    await h.parse(['--output-format', 'json', 'tag', 'aliases']);
    expect(h.lastJson<unknown[]>()).toHaveLength(1);

    h.logSpy.mockClear();
    await h.parse(['--output-format', 'csv', 'tag', 'aliases']);
    expect(h.lastLine()).toContain('javascript');

    h.logSpy.mockClear();
    await h.parse(['--output-format', 'table', 'tag', 'aliases']);
    expect(h.output()).toMatch(/js -> javascript/);
  });
});
