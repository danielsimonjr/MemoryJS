/**
 * Spell CLI command coverage.
 */

import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerSpellCommands } from '../../../src/cli/commands/spell.js';
import { createCliHarness, cleanupCliHarness, errorLines, type CliHarness } from './helpers/cliTestHarness.js';

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

describe('spell error path', () => {
  it('logs the error once, then exits 1', async () => {
    const h = await createCliHarness(registerSpellCommands);
    try {
      // A directory at the storage path makes every read fail with EISDIR.
      await fs.mkdir(h.storagePath);
      await expect(h.parse(['spell', 'rebuild'])).rejects.toThrow('process.exit called');
      expect(errorLines(h.errorSpy)).toEqual(['[ERROR] ✗ EISDIR: illegal operation on a directory, read']);
      expect(h.errorSpy.mock.invocationCallOrder[0]).toBeLessThan(h.processExitSpy.mock.invocationCallOrder[0]!);
      expect(h.processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await cleanupCliHarness(h);
    }
  });
});

describe('spell ManagerContext construction', () => {
  it('rejects without logging when the context cannot be built', async () => {
    const h = await createCliHarness(registerSpellCommands);
    try {
      // The path traversal check in the ManagerContext constructor throws before the action's try.
      await expect(
        h.program.parseAsync(['node', 'memory', '--storage', '../unsafe/graph.jsonl', 'spell', 'size'])
      ).rejects.toThrow(
        'Failed to Path traversal detected in file path: ../unsafe/graph.jsonl file: ../unsafe/graph.jsonl'
      );
      expect(errorLines(h.errorSpy)).toEqual([]);
      expect(h.processExitSpy).not.toHaveBeenCalled();
    } finally {
      await cleanupCliHarness(h);
    }
  });
});
