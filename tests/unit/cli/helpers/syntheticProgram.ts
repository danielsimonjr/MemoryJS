/**
 * Synthetic command trees and argv cases used by the CLI parser parity tests.
 *
 * The real MemoryJS tree does not exercise every option form (negation, optional
 * option-arguments, combined short flags, repeated options), so these small trees
 * cover the rest of the parser surface. Both the captain script that recorded
 * commander 15.0.0 output and the tests that replay it through the in-repo
 * parser build the same tree from this module.
 *
 * @module tests/unit/cli/helpers/syntheticProgram
 */

/** The minimal constructor surface both parsers expose. */
export interface CommandLike {
  name(str?: string): unknown;
  description(str?: string): unknown;
  version(str?: string, flags?: string, description?: string): unknown;
  option(...args: unknown[]): CommandLike;
  requiredOption(...args: unknown[]): CommandLike;
  addOption(option: unknown): CommandLike;
  command(nameAndArgs: string): CommandLike;
  action(fn: (...args: unknown[]) => unknown): CommandLike;
  alias(alias?: string): unknown;
  exitOverride(fn?: (err: unknown) => void): CommandLike;
  configureOutput(configuration: Record<string, unknown>): CommandLike;
  parseAsync(argv: string[]): Promise<unknown>;
  helpInformation(): string;
  opts(): Record<string, unknown>;
}

/** An Option constructor: `new Option(flags, description)`. */
export interface OptionLike {
  choices(values: string[]): OptionLike;
  default(value: unknown, description?: string): OptionLike;
}

/** Constructor for the parser's invalid-argument error. */
export type InvalidArgumentCtor = new (message: string) => Error;

/** What a leaf action received, for comparison between implementations. */
export interface LeafRecord {
  leaf: Record<string, unknown>;
  root: Record<string, unknown>;
}

/** The result of one synthetic run. */
export interface SyntheticOutcome {
  record: LeafRecord | null;
  written: string[];
  errorMessage: string | undefined;
  exitCode: number | undefined;
  help: string;
}

/**
 * Build the synthetic program.
 *
 * @param CommandCtor - The Command class to build on.
 * @param OptionCtor - The Option class used by `addOption`.
 * @param InvalidArgument - The error class the finite-number parser throws.
 * @param output - Optional output sinks, applied before subcommands are added so they inherit it.
 * @returns The program plus a getter for the last recorded action.
 */
export function buildSyntheticProgram(
  CommandCtor: new (name?: string) => CommandLike,
  OptionCtor: new (flags: string, description?: string) => OptionLike,
  InvalidArgument: InvalidArgumentCtor,
  output?: Record<string, unknown>,
): { program: CommandLike; last: () => LeafRecord | null } {
  let record: LeafRecord | null = null;
  const program = new CommandCtor();
  program.name('demo').description('Synthetic demo program').version('9.9.9');
  program.exitOverride();
  if (output) program.configureOutput(output);

  program
    .option('-s, --storage <path>', 'Storage path', './demo.jsonl')
    .option('-c, --color', 'Enable color')
    .option('--no-cache', 'Disable the cache')
    .option('-n, --name <name>', 'A name')
    .option('-v, --values <n...>', 'Repeatable numbers', (value: string) => Number(value))
    .option('--tag <tag>', 'A tag')
    .option('-d, --depth [n]', 'Optional depth');

  const leaf = program.command('leaf <target>');
  leaf
    .option('-f, --force', 'Force it')
    .option('-r, --repeat <n>', 'Repeat count', (value: string) => Number(value))
    .option('--mode <mode>', 'Mode', 'fast')
    .action((_target: unknown, options: unknown) => {
      record = { leaf: options as Record<string, unknown>, root: program.opts() };
    });

  program
    .command('required')
    .requiredOption('--key <key>', 'A required key')
    .action((options: unknown) => {
      record = { leaf: options as Record<string, unknown>, root: program.opts() };
    });

  program
    .command('choices')
    .addOption(new OptionCtor('--level <level>', 'Level').choices(['low', 'high']).default('low'))
    .action(() => {
      record = { leaf: {}, root: program.opts() };
    });

  program
    .command('finite')
    .option('--ratio <n>', 'Ratio', (value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new InvalidArgument('Expected a finite number');
      return parsed;
    })
    .action(() => {
      record = { leaf: {}, root: program.opts() };
    });

  program.command('grouped').action(() => {
    record = { leaf: {}, root: program.opts() };
  });

  program.command('aliased').alias('al').action(() => {
    record = { leaf: {}, root: program.opts() };
  });

  return { program, last: () => record };
}

/** The argv cases the synthetic tree covers. */
export const SYNTHETIC_ARGV: string[][] = [
  ['leaf', 'x'],
  ['leaf', 'x', '-f'],
  ['leaf', 'x', '--force'],
  ['leaf', 'x', '-r', '3'],
  ['leaf', 'x', '-r', '3', '-r', '4'],
  ['leaf', 'x', '--mode=slow'],
  ['leaf', 'x', '--mode', 'slow'],
  ['leaf', 'x', '-fr', '5'],
  ['leaf', 'x', '-rf'],
  ['leaf', 'x', '-fr5'],
  ['--no-cache', 'leaf', 'x'],
  ['--cache', 'leaf', 'x'],
  ['-c', 'leaf', 'x'],
  ['-s', '/tmp/a', 'leaf', 'x'],
  ['--storage=/tmp/b', 'leaf', 'x'],
  ['-v', '1', '2', '3', 'leaf', 'x'],
  ['--values', '4', '--values', '5', 'leaf', 'x'],
  ['-n', 'alpha', '-n', 'beta', 'leaf', 'x'],
  ['--tag', 'a', '--tag', 'b', 'leaf', 'x'],
  ['-d', 'leaf', 'x'],
  ['-d', '3', 'leaf', 'x'],
  ['leaf', '--', 'x'],
  ['leaf', '--', '-f'],
  ['grouped', '--', 'tail', 'more'],
  ['required', '--key', 'k'],
  ['choices', '--level', 'high'],
  ['choices'],
  ['finite', '--ratio', '0.5'],
  ['aliased'],
  ['al'],
  ['leaf'],
  ['leaf', 'x', '--nope'],
  ['grouped', '--nope'],
  ['required'],
  ['choices', '--level', 'medium'],
  ['finite', '--ratio', 'NaN'],
  ['nope-command'],
  ['grouped', 'extra'],
  ['--help'],
  ['leaf', '--help'],
];
