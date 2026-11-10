/**
 * Pinned-behavior tests for the parser surface the MemoryJS tree does not use.
 *
 * The expectations were recorded from commander 15.0.0 by
 * `tests/unit/cli/helpers/captureCliParity.ts` into
 * `tests/unit/cli/fixtures/parseArgsPinned.json` (`synthetic` block), running a
 * small synthetic command tree twice: once through commander and then through
 * `src/cli/parseArgs.ts`. This file replays the same argv through the in-repo
 * parser only, so the surface stays guarded after commander is removed.
 *
 * Covered: `--no-` negation with and without a positive flag, combined short
 * flags, `=value` forms, repeated and variadic options, optional
 * option-arguments, the `--` separator, required options, choices, aliases,
 * unknown options and commands, excess arguments, and help.
 *
 * @module tests/unit/cli/parseArgsSurfacePinned.test
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, Option, InvalidArgumentError } from '../../../src/cli/parseArgs.js';
import { buildSyntheticProgram, type CommandLike, type OptionLike } from './helpers/syntheticProgram.js';

interface SyntheticRun {
  argv: string[];
  record: unknown;
  written: string[];
  errorMessage?: string;
  exitCode?: number;
  help: string;
}

interface PinnedFixture {
  synthetic: SyntheticRun[];
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'parseArgsPinned.json'), 'utf-8'),
) as PinnedFixture;

/** Replay one argv through the synthetic tree on the in-repo parser. */
async function replay(argv: string[]): Promise<SyntheticRun> {
  const written: string[] = [];
  const { program, last } = buildSyntheticProgram(
    Command as unknown as new (name?: string) => CommandLike,
    Option as unknown as new (flags: string, description?: string) => OptionLike,
    InvalidArgumentError as never,
    {
      writeOut: (str: string) => written.push(str),
      writeErr: (str: string) => written.push(str),
    },
  );
  let errorMessage: string | undefined;
  let exitCode: number | undefined;
  try {
    await program.parseAsync(['node', 'demo', ...argv]);
  } catch (err) {
    const candidate = err as { exitCode?: number; message?: string };
    errorMessage = candidate.message;
    exitCode = candidate.exitCode;
  }
  return { argv, record: last(), written, errorMessage, exitCode, help: program.helpInformation() };
}

/** Normalize a value the way the recorded JSON did (undefined/NaN become null). */
function asRecorded<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

describe('parseArgs synthetic surface, pinned from commander 15.0.0', () => {
  for (const recorded of fixture.synthetic) {
    it(`matches the recorded behavior for: ${recorded.argv.join(' ')}`, async () => {
      const ours = await replay(recorded.argv);
      expect(ours.errorMessage ?? null).toBe(recorded.errorMessage);
      expect(ours.exitCode ?? null).toBe(recorded.exitCode);
      expect(ours.written).toEqual(recorded.written);
      expect(asRecorded(ours.record)).toEqual(recorded.record);
      expect(ours.help).toBe(recorded.help);
    });
  }

  it('recorded a case for every synthetic argv form', () => {
    expect(fixture.synthetic.length).toBeGreaterThanOrEqual(40);
    expect(fixture.synthetic.some((run) => run.argv.includes('--no-cache'))).toBe(true);
    expect(fixture.synthetic.some((run) => run.argv.includes('--'))).toBe(true);
  });
});
