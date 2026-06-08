/**
 * Diagnostic CLI command tests.
 *
 * Verifies the JSON-shape contracts of `memory diag`, `memory env`,
 * `memory health`, `memory version`. Health checks against a seeded graph
 * with a deliberately-broken state (orphan relation) to confirm failure
 * paths are caught.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerDiagCommand } from '../../../src/cli/commands/diag.js';

describe('diag CLI commands', () => {
  let testDir: string;
  let storagePath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `diag-cli-${Date.now()}-${Math.random()}`);
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
    registerDiagCommand(program);
    return program;
  }

  function lastJson(): unknown {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    const lastBlock = calls[calls.length - 1];
    return JSON.parse(lastBlock);
  }

  it('version emits memoryjs + node + platform', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'version']);
    const v = lastJson() as { memoryjs: string; node: string; platform: string };
    expect(typeof v.memoryjs).toBe('string');
    expect(v.node).toMatch(/^v\d+/);
    expect(v.platform).toMatch(/\//);
  });

  it('env returns the catalog with current/default/set fields', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'env', '--all']);
    const out = lastJson() as { count: number; vars: Array<{ name: string; set: boolean; default: string }> };
    expect(out.count).toBeGreaterThan(10);
    expect(out.vars.some((v) => v.name === 'MEMORY_STORAGE_TYPE')).toBe(true);
    expect(out.vars.some((v) => v.name === 'MEMORYJS_STORAGE_PATH')).toBe(true);
  });

  it('diag emits a snapshot with version + storage + runtime', async () => {
    // Seed an entity so the storage counts are non-zero.
    const ctx = new ManagerContext(storagePath);
    await ctx.entityManager.createEntities([{ name: 'X', entityType: 't', observations: [] }]);

    const program = makeProgram();
    await program.parseAsync(['node', 'memory', '--storage', storagePath, 'diag']);
    const snap = lastJson() as {
      memoryjs: { version: string };
      runtime: { node: string };
      storage: { exists: boolean; entities: number };
    };
    expect(snap.memoryjs.version).toBeDefined();
    expect(snap.runtime.node).toMatch(/^v\d+/);
    expect(snap.storage.exists).toBe(true);
    expect(snap.storage.entities).toBe(1);
  });

  it('health passes on a clean graph', async () => {
    const ctx = new ManagerContext(storagePath);
    await ctx.entityManager.createEntities([
      { name: 'A', entityType: 't', observations: [] },
      { name: 'B', entityType: 't', observations: [] },
    ]);
    await ctx.relationManager.createRelations([{ from: 'A', to: 'B', relationType: 'r' }]);

    const program = makeProgram();
    await expect(
      program.parseAsync(['node', 'memory', '--storage', storagePath, 'health'])
    ).resolves.not.toThrow();
    const out = lastJson() as { ok: boolean; failed: number };
    expect(out.ok).toBe(true);
    expect(out.failed).toBe(0);
  });

  it('health flags an orphan relation as a failed check', async () => {
    // Hand-write a JSONL with a relation pointing at a non-existent entity.
    await fs.writeFile(
      storagePath,
      [
        JSON.stringify({ type: 'entity', name: 'A', entityType: 't', observations: [] }),
        JSON.stringify({ type: 'relation', from: 'A', to: 'GHOST', relationType: 'dangling' }),
      ].join('\n') + '\n',
    );

    const program = makeProgram();
    // exitOverride throws on process.exit(1); catch it so the test can assert.
    let exited = false;
    try {
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'health']);
    } catch (e) {
      exited = true;
      expect((e as Error).message).toMatch(/exit|1/);
    }
    const out = lastJson() as { ok: boolean; failed: number; checks: Array<{ name: string; ok: boolean }> };
    expect(out.ok).toBe(false);
    expect(out.failed).toBeGreaterThan(0);
    expect(out.checks.some((c) => c.name === 'relations:no-orphans' && !c.ok)).toBe(true);
    // process.exit(1) was called by the action — exitOverride converted it to a throw.
    expect(exited).toBe(true);
  });
});
