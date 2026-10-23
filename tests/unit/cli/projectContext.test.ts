/**
 * Project context CLI command coverage.
 */

import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerProjectContextCommands } from '../../../src/cli/commands/projectContext.js';
import { createCliHarness, cleanupCliHarness, errorLines, type CliHarness } from './helpers/cliTestHarness.js';

describe('project-context CLI', () => {
  let h: CliHarness;
  const projectId = 'memjs';

  beforeEach(async () => {
    h = await createCliHarness(registerProjectContextCommands);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('append all sections, show, clear', async () => {
    await h.parse(['project-context', 'show', projectId]);
    expect(h.output()).toMatch(/no project-context/);

    await h.parse(['project-context', 'append-fact', projectId, 'Uses JSONL']);
    await h.parse(['project-context', 'append-convention', projectId, 'Semver']);
    await h.parse([
      'project-context', 'append-command', projectId,
      '--name', 'test', '--command', 'npm test', '--purpose', 'run tests',
    ]);
    await h.parse([
      'project-context', 'append-glossary', projectId,
      '--term', 'entity', '--definition', 'graph node',
    ]);

    await h.parse(['project-context', 'show', projectId]);
    expect(h.output()).toMatch(/JSONL/);
    expect(h.output()).toMatch(/npm test/);

    await h.parse(['project-context', 'clear', projectId]);
    expect(h.output()).toMatch(/cleared/);
  });

  it('clear unknown project fails', async () => {
    await expect(h.parse(['project-context', 'clear', 'ghost'])).rejects.toThrow();
  });
});

describe('projectContext error path', () => {
  it('logs the error once, then exits 1', async () => {
    const h = await createCliHarness(registerProjectContextCommands);
    try {
      // A directory at the storage path makes every read fail with EISDIR.
      await fs.mkdir(h.storagePath);
      await expect(h.parse(['project-context', 'show', 'p1'])).rejects.toThrow('process.exit called');
      expect(errorLines(h.errorSpy)).toEqual(['[ERROR] ✗ EISDIR: illegal operation on a directory, read']);
      expect(h.errorSpy.mock.invocationCallOrder[0]).toBeLessThan(h.processExitSpy.mock.invocationCallOrder[0]!);
      expect(h.processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await cleanupCliHarness(h);
    }
  });
});
