/**
 * Shared harness for CLI command integration tests.
 *
 * Spins up an isolated JSONL storage path, wires global commander
 * options, and captures stdout/stderr without subprocess overhead.
 */

import { vi, type MockInstance } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface CliHarness {
  testDir: string;
  storagePath: string;
  program: Command;
  logSpy: MockInstance;
  infoSpy: MockInstance;
  errorSpy: MockInstance;
  processExitSpy: MockInstance;
  parse: (args: string[]) => Promise<void>;
  output: () => string;
  lastLine: () => string;
  lastJson: <T = unknown>() => T;
}

export async function createCliHarness(
  register: (program: Command) => void,
): Promise<CliHarness> {
  const testDir = join(tmpdir(), `cli-harness-${Date.now()}-${Math.random()}`);
  await fs.mkdir(testDir, { recursive: true });
  const storagePath = join(testDir, 'graph.jsonl');

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  program
    .option('-s, --storage <path>', 'Storage path', storagePath)
    .option('--output-format <type>', 'Output format', 'json')
    .option('-q, --quiet', 'Suppress output')
    .option('--verbose', 'Enable verbose');

  register(program);

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);

  const baseArgs = ['node', 'memory', '--storage', storagePath];

  return {
    testDir,
    storagePath,
    program,
    logSpy,
    infoSpy,
    errorSpy,
    processExitSpy,
    parse: (args: string[]) => program.parseAsync([...baseArgs, ...args]),
    output: () =>
      [...logSpy.mock.calls, ...infoSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .join('\n'),
    lastLine: () => {
      const calls = [...logSpy.mock.calls, ...infoSpy.mock.calls];
      return calls[calls.length - 1]?.join(' ') ?? '';
    },
    lastJson: <T = unknown>() => {
      const calls = logSpy.mock.calls.map((c) => c.join(' '));
      return JSON.parse(calls[calls.length - 1]!) as T;
    },
  };
}

export async function cleanupCliHarness(h: CliHarness): Promise<void> {
  h.logSpy.mockRestore();
  h.infoSpy.mockRestore();
  h.errorSpy.mockRestore();
  h.processExitSpy.mockRestore();
  try {
    await fs.rm(h.testDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
