/**
 * Project context CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerProjectContextCommands } from '../../../src/cli/commands/projectContext.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

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
