/**
 * `memory check` CLI command tests.
 *
 * Dry-run vs --apply paths against a deliberately-broken JSONL graph.
 * Confirms detection of orphan relations and missing parents, the
 * exit-code contract (non-zero on issues without --apply, zero after
 * --apply), and that --apply actually mutates the on-disk graph.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerCheckCommand } from '../../../src/cli/commands/check.js';

describe('check CLI command', () => {
  let testDir: string;
  let storagePath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `check-cli-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storagePath = join(testDir, 'graph.jsonl');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('-s, --storage <path>', 'Storage path');
    registerCheckCommand(program);
    return program;
  }

  function lastJson<T = unknown>(): T {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    return JSON.parse(calls[calls.length - 1]) as T;
  }

  // Build a graph with: one valid entity pair, one orphan relation, one
  // missing-parent entity. Used by multiple tests below.
  async function writeBrokenGraph(): Promise<void> {
    const lines = [
      JSON.stringify({ type: 'entity', name: 'A', entityType: 't', observations: [] }),
      JSON.stringify({ type: 'entity', name: 'B', entityType: 't', observations: [] }),
      JSON.stringify({ type: 'entity', name: 'C', entityType: 't', observations: [], parentId: 'PHANTOM' }),
      // Relation pointing at a missing 'to' endpoint
      JSON.stringify({ type: 'relation', from: 'A', to: 'GHOST', relationType: 'dangling' }),
      // Valid relation
      JSON.stringify({ type: 'relation', from: 'A', to: 'B', relationType: 'real' }),
    ];
    await fs.writeFile(storagePath, lines.join('\n') + '\n');
  }

  it('reports a clean graph as ok with no findings', async () => {
    const ctx = new ManagerContext(storagePath);
    await ctx.entityManager.createEntities([
      { name: 'A', entityType: 't', observations: [] },
      { name: 'B', entityType: 't', observations: [] },
    ]);
    await ctx.relationManager.createRelations([{ from: 'A', to: 'B', relationType: 'r' }]);

    const program = makeProgram();
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'check']);
    const report = lastJson<{ ok: boolean; orphanRelations: unknown[]; missingParents: unknown[] }>();
    expect(report.ok).toBe(true);
    expect(report.orphanRelations).toHaveLength(0);
    expect(report.missingParents).toHaveLength(0);
  });

  it('reports orphan relations and missing parents on a broken graph (dry-run default)', async () => {
    await writeBrokenGraph();

    const program = makeProgram();
    let exited = false;
    try {
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'check']);
    } catch (e) {
      exited = true;
      expect((e as Error).message).toMatch(/exit|1/);
    }

    const report = lastJson<{
      ok: boolean;
      applied: boolean;
      orphanRelations: Array<{ from: string; to: string; reason: string }>;
      missingParents: Array<{ entity: string; parentId: string }>;
    }>();
    expect(report.ok).toBe(false);
    expect(report.applied).toBe(false);
    expect(report.orphanRelations).toHaveLength(1);
    expect(report.orphanRelations[0]).toMatchObject({ from: 'A', to: 'GHOST', reason: 'to-missing' });
    expect(report.missingParents).toHaveLength(1);
    expect(report.missingParents[0]).toMatchObject({ entity: 'C', parentId: 'PHANTOM' });
    expect(exited).toBe(true);
  });

  it('--apply deletes orphan relations and clears missing parentIds', async () => {
    await writeBrokenGraph();

    const program = makeProgram();
    // exitOverride keeps us in-process; --apply should NOT call process.exit
    // because issues were repaired.
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'check', '--apply']);

    const report = lastJson<{
      applied: boolean;
      orphanRelations: unknown[];
      missingParents: unknown[];
      actions?: { orphanRelationsDeleted: number; missingParentsCleared: number };
    }>();
    expect(report.applied).toBe(true);
    expect(report.actions?.orphanRelationsDeleted).toBe(1);
    expect(report.actions?.missingParentsCleared).toBe(1);

    // Re-read the graph and verify the orphan relation is gone and C has no parent.
    const ctx = new ManagerContext(storagePath);
    const graph = await ctx.storage.loadGraph();
    expect(graph.relations.some((r) => r.to === 'GHOST')).toBe(false);
    expect(graph.relations.some((r) => r.from === 'A' && r.to === 'B')).toBe(true);
    const c = graph.entities.find((e) => e.name === 'C');
    expect(c?.parentId).toBeUndefined();
  });

  it('--apply on a clean graph stays a no-op', async () => {
    const ctx = new ManagerContext(storagePath);
    await ctx.entityManager.createEntities([
      { name: 'A', entityType: 't', observations: [] },
    ]);

    const program = makeProgram();
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'check', '--apply']);
    const report = lastJson<{ ok: boolean; applied: boolean; actions?: unknown }>();
    expect(report.ok).toBe(true);
    expect(report.applied).toBe(true);
    // `actions` is only attached when there was something to fix.
    expect(report.actions).toBeUndefined();
  });
});
