/**
 * Smoke CLI command tests.
 *
 * Verifies that the smoke subcommand registered on a fresh commander program
 * runs against an isolated storage path, walks every step without failure,
 * and exits with code 0. Subprocess-spawning is avoided in favour of
 * commander's parseAsync so the assertion is cheap (~3 s incl. ManagerContext
 * spinup) and stays in-process for clean teardown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerSmokeCommand } from '../../../src/cli/commands/smoke.js';

describe('smoke CLI command', () => {
  let testDir: string;
  let storagePath: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `smoke-cli-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storagePath = join(testDir, 'graph.jsonl');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    registerSmokeCommand(program);
    return program;
  }

  it('runs the full smoke sequence and prints a pass summary', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'memoryjs', 'smoke', '--storage', storagePath, '--keep']);

    const calls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(calls).toMatch(/Smoke test passed: 30\/30 steps/);
  });

  it('writes a graph file when --storage is supplied', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'memoryjs', 'smoke', '--storage', storagePath, '--keep']);

    const stat = await fs.stat(storagePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('emits per-step lines in --verbose mode', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'memoryjs', 'smoke', '--storage', storagePath, '--keep', '--verbose']);

    const calls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(calls).toMatch(/entity:create/);
    expect(calls).toMatch(/decision:accept/);
    expect(calls).toMatch(/spell:rebuild \+ suggest/);
  });
});
