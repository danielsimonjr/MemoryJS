/**
 * Tool affordance CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerToolAffordanceCommands } from '../../../src/cli/commands/toolAffordance.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('tool-affordance CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerToolAffordanceCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.toolAffordanceManager.recordOutcome('grep', {
      outcome: 'success',
      durationMs: 12,
    });
    await ctx.toolAffordanceManager.recordOutcome('search', {
      outcome: 'failure',
      durationMs: 50,
      errorMessage: 'timeout',
    });
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('list, show, stats, suggest', async () => {
    await h.parse(['tool-affordance', 'list']);
    expect(h.output()).toMatch(/grep/);

    await h.parse(['tool-affordance', 'show', 'grep']);
    expect(h.output()).toMatch(/grep/);

    await h.parse(['tool-affordance', 'stats', 'grep']);
    expect(h.output()).toMatch(/success_rate|"success_rate"/);

    await h.parse(['tool-affordance', 'suggest', 'find text', '--limit', '2']);
    expect(h.output().length).toBeGreaterThan(0);
  });

  it('empty/missing tool messages', async () => {
    const empty = await createCliHarness(registerToolAffordanceCommands);
    try {
      await empty.parse(['tool-affordance', 'list']);
      expect(empty.output()).toMatch(/no tool-affordance/);
      await empty.parse(['tool-affordance', 'show', 'missing']);
      expect(empty.output()).toMatch(/no affordance record/);
      await empty.parse(['tool-affordance', 'suggest', 'zzz']);
      expect(empty.output()).toMatch(/no tools matching/);
    } finally {
      await cleanupCliHarness(empty);
    }
  });
});
