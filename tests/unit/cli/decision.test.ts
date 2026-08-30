/**
 * Decision CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { registerDecisionCommands } from '../../../src/cli/commands/decision.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('decision CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerDecisionCommands);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('full lifecycle: propose → accept → list → find → export → import', async () => {
    await h.parse([
      'decision', 'propose',
      '--context', 'Need auth',
      '--decision', 'Use JWT',
      '--alternative', 'sessions',
      '--consequence', 'stateless',
    ]);
    const proposeOut = h.lastLine();
    expect(proposeOut).toMatch(/Proposed/);
    const id = proposeOut.match(/Proposed ([^:]+):/)?.[1];
    expect(id).toBeTruthy();

    h.infoSpy.mockClear();
    await h.parse(['decision', 'accept', id!]);
    expect(h.lastLine()).toMatch(/accepted/);

    h.infoSpy.mockClear();
    await h.parse(['decision', 'list', '--status', 'accepted']);
    expect(h.output()).toMatch(/JWT/);

    h.infoSpy.mockClear();
    await h.parse(['decision', 'find', 'auth']);
    expect(h.output()).toMatch(/JWT/);

    h.infoSpy.mockClear();
    await h.parse(['decision', 'export', id!]);
    expect(h.output()).toMatch(/## Context/);

    const adrPath = join(h.testDir, 'adr.md');
    h.infoSpy.mockClear();
    await h.parse(['decision', 'export', id!, '--out', adrPath]);
    expect(h.output()).toMatch(/Wrote/);

    h.infoSpy.mockClear();
    await h.parse(['decision', 'propose', '--context', 'v2', '--decision', 'Use OAuth']);
    const secondId = h.lastLine().match(/Proposed ([^:]+):/)?.[1];
    h.infoSpy.mockClear();
    await h.parse(['decision', 'accept', secondId!]);
    h.infoSpy.mockClear();
    await h.parse(['decision', 'supersede', id!, secondId!]);
    expect(h.output()).toMatch(/superseded/);
  });

  it('reject with reason', async () => {
    await h.parse(['decision', 'propose', '--context', 'x', '--decision', 'y']);
    const id = h.lastLine().match(/Proposed ([^:]+):/)?.[1];
    h.infoSpy.mockClear();
    await h.parse(['decision', 'reject', id!, '--reason', 'too risky']);
    expect(h.output()).toMatch(/rejected/);
  });

  it('list/find empty states', async () => {
    await h.parse(['decision', 'list']);
    expect(h.output()).toMatch(/no decisions/);
    await h.parse(['decision', 'find', 'missing']);
    expect(h.output()).toMatch(/no decisions matching/);
  });

  it('import rejects invalid ADR', async () => {
    const bad = join(h.testDir, 'bad.md');
    await fs.writeFile(bad, '# No sections\n', 'utf8');
    await expect(h.parse(['decision', 'import', bad])).rejects.toThrow();
  });

  it('import accepts valid ADR', async () => {
    const good = join(h.testDir, 'good.md');
    await fs.writeFile(
      good,
      '## Context\nNeed cache\n\n## Decision\nUse Redis\n',
      'utf8',
    );
    await h.parse(['decision', 'import', good]);
    expect(h.output()).toMatch(/Imported/);
  });
});
