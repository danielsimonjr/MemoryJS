/**
 * Graph algorithm CLI command coverage.
 */

import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerGraphCommands } from '../../../src/cli/commands/graph.js';
import { createCliHarness, cleanupCliHarness, errorLines, type CliHarness } from './helpers/cliTestHarness.js';

describe('graph CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerGraphCommands);
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([
      { name: 'A', entityType: 'node', observations: [] },
      { name: 'B', entityType: 'node', observations: [] },
      { name: 'C', entityType: 'node', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'A', to: 'B', relationType: 'links' },
      { from: 'B', to: 'C', relationType: 'links' },
    ]);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('shortest-path between connected nodes', async () => {
    await h.parse(['graph', 'shortest-path', 'A', 'C']);
    expect(h.output()).toMatch(/A/);
    expect(h.output()).toMatch(/C/);
  });

  it('shortest-path fails for disconnected nodes', async () => {
    const ctx = new ManagerContext(h.storagePath);
    await ctx.entityManager.createEntities([{ name: 'Z', entityType: 'node', observations: [] }]);
    await expect(h.parse(['graph', 'shortest-path', 'A', 'Z'])).rejects.toThrow();
  });

  it('centrality algorithms: degree, betweenness, pagerank', async () => {
    for (const algo of ['degree', 'betweenness', 'pagerank']) {
      h.logSpy.mockClear();
      await h.parse(['graph', 'centrality', '-a', algo, '--top', '2']);
      expect(h.output().length).toBeGreaterThan(0);
    }
  });

  it('centrality rejects unknown algorithm', async () => {
    await expect(h.parse(['graph', 'centrality', '-a', 'bogus'])).rejects.toThrow();
  });

  it('components lists connected subgraphs', async () => {
    await h.parse(['graph', 'components']);
    expect(h.output().length).toBeGreaterThan(0);
  });
});

describe('graph error path', () => {
  it('logs the error once, then exits 1', async () => {
    const h = await createCliHarness(registerGraphCommands);
    try {
      // A directory at the storage path makes every read fail with EISDIR.
      await fs.mkdir(h.storagePath);
      await expect(h.parse(['graph', 'components'])).rejects.toThrow('process.exit called');
      expect(errorLines(h.errorSpy)).toEqual(['[ERROR] ✗ EISDIR: illegal operation on a directory, read']);
      expect(h.errorSpy.mock.invocationCallOrder[0]).toBeLessThan(h.processExitSpy.mock.invocationCallOrder[0]!);
      expect(h.processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await cleanupCliHarness(h);
    }
  });
});
