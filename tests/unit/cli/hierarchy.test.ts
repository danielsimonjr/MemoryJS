/**
 * Hierarchy CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerHierarchyCommands } from '../../../src/cli/commands/hierarchy.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('hierarchy CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerHierarchyCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'root', entityType: 'org', observations: [] },
      { name: 'child', entityType: 'team', observations: [] },
      { name: 'grandchild', entityType: 'person', observations: [] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('set-parent, children, ancestors, descendants, roots', async () => {
    await h.parse(['hierarchy', 'set-parent', 'child', 'root']);
    expect(h.output()).toMatch(/Set parent/);

    await h.parse(['hierarchy', 'set-parent', 'grandchild', 'child']);
    await h.parse(['hierarchy', 'children', 'root']);
    expect(h.output()).toMatch(/child/);

    await h.parse(['hierarchy', 'ancestors', 'grandchild']);
    expect(h.output()).toMatch(/child/);

    await h.parse(['hierarchy', 'descendants', 'root']);
    expect(h.output()).toMatch(/grandchild/);

    await h.parse(['hierarchy', 'roots']);
    expect(h.output()).toMatch(/root/);

    await h.parse(['hierarchy', 'set-parent', 'child', 'none']);
    expect(h.output()).toMatch(/Removed parent/);
  });
});
