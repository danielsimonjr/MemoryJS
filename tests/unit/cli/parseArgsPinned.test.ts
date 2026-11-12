/**
 * Pinned-behavior tests for the in-repo CLI argument parser.
 *
 * Every expectation here was recorded from commander 15.0.0 by running the real
 * MemoryJS command tree through it. The recorder is
 * `tests/unit/cli/helpers/captureCliParity.ts`; its output is
 * `tests/unit/cli/fixtures/parseArgsPinned.json`. These tests replay the same
 * argv through `src/cli/parseArgs.ts`, so the parity claim keeps being checked
 * after commander has been removed from the dependency list.
 *
 * Covered: which action runs and with which positional arguments and options,
 * `--help` for the root program and every registered subcommand, `--version`
 * output and stream, error messages for missing arguments, missing required
 * options, unknown options and commands, invalid choices, and invalid argument
 * parsers, and the exit code reported through `exitOverride`.
 *
 * @module tests/unit/cli/parseArgsPinned.test
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '../../../src/cli/parseArgs.js';
import { registerCommands } from '../../../src/cli/commands/index.js';

interface Captured {
  path: string;
  args: unknown[];
  opts: Record<string, unknown>;
}

interface RecordedRun {
  argv: string[];
  captured: Captured[];
  written: string[];
  errorMessage?: string;
  exitCode?: number;
}

interface PinnedFixture {
  commanderVersion: string;
  program: { name: string; version: string };
  help: Record<string, string>;
  invocations: RecordedRun[];
  errors: RecordedRun[];
  repeatedParse: Array<{ sequence: string[][]; captured: Captured[] }>;
  parseOptions: Array<{
    argv: string[];
    operands: string[];
    unknown: string[];
    opts: Record<string, unknown>;
    captured: Captured[];
  }>;
  version: RecordedRun;
  helpRoot: RecordedRun;
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'parseArgsPinned.json'), 'utf-8'),
) as PinnedFixture;

/** Build a MemoryJS program that records each action instead of running it. */
function buildProgram(captured: Captured[], written: string[]): Command {
  class RecordingCommand extends Command {
    /**
     * Create a recording subcommand, so every level intercepts `.action()`.
     *
     * @param name - The subcommand name.
     */
    createCommand(name?: string): Command {
      return new RecordingCommand(name);
    }

    /**
     * Record the action call instead of running the real handler.
     *
     * @param _fn - The real handler; these tests compare only its arguments.
     */
    action(_fn: (...args: unknown[]) => unknown): this {
      const target = this;
      const anyTarget = target as unknown as {
        _actionHandler: ((args: unknown[]) => unknown) | null;
      };
      anyTarget._actionHandler = (args: unknown[]) => {
        captured.push({ path: pathOf(target), args, opts: target.opts() });
        return undefined;
      };
      return this;
    }
  }

  const program = new RecordingCommand();
  program.name('memory').description('MemoryJS - Knowledge Graph CLI');
  program.version('5.1.0', '-v, --version', 'Output the current version');
  program
    .option('-s, --storage <path>', 'Path to storage file', './memory.jsonl')
    .option('--output-format <type>', 'Console output format (json|table|csv)', 'json')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--verbose', 'Enable verbose/debug output');
  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => written.push(str),
    writeErr: (str: string) => written.push(str),
  });
  registerCommands(program);
  return program;
}

/** The space-joined command names from the root to this command. */
function pathOf(cmd: Command): string {
  const names: string[] = [];
  for (let current: Command | null = cmd; current; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(' ');
}

/** Replay one argv through the in-repo parser. */
async function replay(argv: string[]): Promise<RecordedRun> {
  const captured: Captured[] = [];
  const written: string[] = [];
  const program = buildProgram(captured, written);
  let errorMessage: string | undefined;
  let exitCode: number | undefined;
  try {
    await program.parseAsync(['node', 'memory', ...argv]);
  } catch (err) {
    const candidate = err as { exitCode?: number; message?: string };
    errorMessage = candidate.message;
    exitCode = candidate.exitCode;
  }
  return { argv, captured, written, errorMessage, exitCode };
}

/** Normalize a value the way the recorded JSON did (undefined/NaN become null). */
function asRecorded<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

describe('parseArgs pinned behavior', () => {
  it('was recorded from commander 15.0.0', () => {
    expect(fixture.commanderVersion).toBe('15.0.0');
    expect(fixture.program).toEqual({ name: 'memory', version: '5.1.0' });
  });

  describe('help text', () => {
    let program: Command;

    beforeAll(() => {
      const written: string[] = [];
      program = buildProgram([], written);
    });

    it('matches the recorded help for the root program', () => {
      expect(program.helpInformation()).toBe(fixture.help.ROOT);
    });

    it('matches the recorded help for every registered subcommand', () => {
      const walk = (cmd: Command, path: string): void => {
        for (const sub of cmd.commands) {
          const subPath = path ? `${path} ${sub.name()}` : sub.name();
          const expected = fixture.help[subPath];
          expect(expected, `missing pinned help for '${subPath}'`).toBeTypeOf('string');
          expect(sub.helpInformation()).toBe(expected);
          walk(sub, subPath);
        }
      };
      walk(program, '');
    });

    it('pins exactly the recorded command set', () => {
      const seen: string[] = [];
      const walk = (cmd: Command, path: string): void => {
        for (const sub of cmd.commands) {
          const subPath = path ? `${path} ${sub.name()}` : sub.name();
          seen.push(subPath);
          walk(sub, subPath);
        }
      };
      walk(program, '');
      expect(Object.keys(fixture.help).sort()).toEqual(['ROOT', ...seen.sort()]);
    });
  });

  describe('valid invocations', () => {
    for (const recorded of fixture.invocations) {
      it(`runs the recorded action for: ${recorded.argv.join(' ')}`, async () => {
        const ours = await replay(recorded.argv);
        expect(asRecorded(ours.captured)).toEqual(recorded.captured);
        expect(ours.errorMessage ?? null).toBe(recorded.errorMessage);
        expect(ours.exitCode ?? null).toBe(recorded.exitCode);
      });
    }
  });

  describe('errors', () => {
    for (const recorded of fixture.errors) {
      it(`reports the recorded error for: ${recorded.argv.join(' ')}`, async () => {
        const ours = await replay(recorded.argv);
        expect(ours.errorMessage ?? null).toBe(recorded.errorMessage);
        expect(ours.exitCode ?? null).toBe(recorded.exitCode);
        expect(ours.written).toEqual(recorded.written);
        expect(asRecorded(ours.captured)).toEqual(recorded.captured);
      });
    }
  });

  it('matches the recorded version output, stream, and exit code', async () => {
    const ours = await replay(['--version']);
    expect(ours.written).toEqual(fixture.version.written);
    expect(ours.written).toEqual(['5.1.0\n']);
    expect(ours.exitCode ?? null).toBe(fixture.version.exitCode);
    expect(fixture.version.exitCode).toBe(0);
  });

  it('matches the recorded root help output and exit code for --help', async () => {
    const ours = await replay(['--help']);
    expect(ours.written).toEqual(fixture.helpRoot.written);
    expect(ours.written).toEqual([fixture.help.ROOT]);
    expect(ours.exitCode ?? null).toBe(fixture.helpRoot.exitCode);
  });

  describe('repeated parse on one program (pipe-mode reuse)', () => {
    for (const recorded of fixture.repeatedParse) {
      it(`resets state between parses for: ${recorded.sequence.map((a) => a.join(' ')).join(' | ')}`, async () => {
        const captured: Captured[] = [];
        const program = buildProgram(captured, []);
        for (const argv of recorded.sequence) {
          try {
            await program.parseAsync(['node', 'memory', ...argv]);
          } catch {
            // The recorded run records whatever the action saw before a failure.
          }
        }
        expect(asRecorded(captured)).toEqual(recorded.captured);
      });
    }
  });

  it('parseAsync({ from: "user" }) matches a recorded pipe-mode line', async () => {
    const recorded =
      fixture.invocations.find((run) => run.argv.join(' ') === 'entity list -l 2') ??
      fixture.invocations[0];
    const captured: Captured[] = [];
    const program = buildProgram(captured, []);
    await program.parseAsync(recorded.argv, { from: 'user' });
    expect(asRecorded(captured)).toEqual(recorded.captured);
  });

  it("pipe mode still calls parseAsync(args, { from: 'user' })", () => {
    const source = readFileSync(join(import.meta.dirname, '../../../src/cli/index.ts'), 'utf-8');
    expect(source).toMatch(/parseAsync\(\s*lineArgs\s*,\s*\{\s*from:\s*'user'\s*\}\s*\)/);
  });

  describe('parseOptions (the pipe-mode global priming call)', () => {
    for (const recorded of fixture.parseOptions) {
      it(`splits and stores like commander for: ${recorded.argv.join(' ')}`, () => {
        const captured: Captured[] = [];
        const program = buildProgram(captured, []);
        const parsed = program.parseOptions(recorded.argv);
        expect(parsed.operands).toEqual(recorded.operands);
        expect(parsed.unknown).toEqual(recorded.unknown);
        expect(asRecorded(program.opts())).toEqual(recorded.opts);
        expect(captured).toEqual([]);
      });
    }
  });
});
