/**
 * Spell CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerSpellCommands } from '../../../src/cli/commands/spell.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('spell CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerSpellCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'typescript', entityType: 'topic', observations: ['language'] },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('rebuild, size, and suggest', async () => {
    await h.parse(['spell', 'rebuild']);
    const rebuilt = h.lastJson<{ rebuilt: boolean; vocabularySize: number }>();
    expect(rebuilt.rebuilt).toBe(true);

    await h.parse(['spell', 'size']);
    expect(h.lastJson<{ vocabularySize: number }>().vocabularySize).toBeGreaterThanOrEqual(0);

    await h.parse(['spell', 'suggest', 'typescrit', '-l', '3', '-d', '2']);
    expect(h.lastJson<{ count: number }>().count).toBeGreaterThanOrEqual(0);
  });
});
