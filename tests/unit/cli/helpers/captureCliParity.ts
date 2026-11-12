/**
 * One-time recorder that captured commander 15.0.0 behavior for the MemoryJS
 * CLI tree as the pinned fixture the parser tests replay.
 *
 * commander is no longer a dependency. To re-record after an intentional CLI
 * change, install commander 15.0.0 into a scratch directory, point
 * `COMMANDER_PATH` at its `index.js`, temporarily route `src/cli/` imports back
 * to `'commander'`, and run:
 *
 *   COMMANDER_PATH=/path/to/node_modules/commander/index.js \
 *     npx tsx tests/unit/cli/helpers/captureCliParity.ts tests/unit/cli/fixtures/parseArgsPinned.json
 *
 * The import is dynamic on purpose: this file must not reintroduce a static
 * `commander` import into the repository. It is a development aid, so it is not
 * part of the build or the test run.
 */
import { writeFileSync } from 'node:fs';
import { registerCommands } from '../../../../src/cli/commands/index.js';
import { buildSyntheticProgram, SYNTHETIC_ARGV, type CommandLike } from './syntheticProgram.js';

const commanderPath = process.env.COMMANDER_PATH;
if (!commanderPath) {
  throw new Error(
    'Set COMMANDER_PATH to a commander@15.0.0 index.js before recording (see the header of this file).',
  );
}
const commander = (await import(commanderPath)) as {
  Command: new (name?: string) => never;
  Option: new (flags: string, description?: string) => never;
  InvalidArgumentError: new (message: string) => Error;
};
const { Command, Option, InvalidArgumentError } = commander;

interface Captured {
  path: string;
  args: unknown[];
  opts: Record<string, unknown>;
}

function pathOf(cmd: { name: () => unknown; parent: unknown }): string {
  const names: string[] = [];
  let current: { name: () => unknown; parent: unknown } | null = cmd;
  while (current) {
    const name = current.name();
    names.unshift(typeof name === 'string' ? name : '');
    current = (current.parent as typeof current | null) ?? null;
  }
  return names.join(' ');
}

class RecordingCommand extends Command {
  constructor(
    name?: string,
    private readonly captured?: Captured[],
    private readonly written?: string[],
  ) {
    super(name);
  }

  createCommand(name?: string): Command {
    return new RecordingCommand(name, this.captured, this.written);
  }

  action(fn: (...args: unknown[]) => unknown): this {
    const target = this;
    const captured = this.captured;
    const anyTarget = target as unknown as { _actionHandler: ((args: unknown[]) => unknown) | null };
    anyTarget._actionHandler = captured
      ? (args: unknown[]) => {
          captured.push({ path: pathOf(target), args, opts: target.opts() });
          return undefined;
        }
      : () => undefined;
    void fn;
    return this;
  }
}

function build(captured?: Captured[], written?: string[]): RecordingCommand {
  const program = new RecordingCommand(undefined, captured, written);
  program
    .name('memory')
    .description('MemoryJS - Knowledge Graph CLI')
    .version('5.1.0', '-v, --version', 'Output the current version');
  program
    .option('-s, --storage <path>', 'Path to storage file', './memory.jsonl')
    .option('--output-format <type>', 'Console output format (json|table|csv)', 'json')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--verbose', 'Enable verbose/debug output');
  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => written?.push(str),
    writeErr: (str: string) => written?.push(str),
  });
  registerCommands(program as never);
  return program;
}

function helpSnapshots(): Record<string, string> {
  const program = build();
  const out: Record<string, string> = { ROOT: program.helpInformation() };
  const walk = (cmd: Command, path: string): void => {
    for (const sub of cmd.commands) {
      const subPath = path ? `${path} ${sub.name()}` : sub.name();
      out[subPath] = sub.helpInformation();
      walk(sub, subPath);
    }
  };
  walk(program, '');
  return out;
}

const ARGV_CASES: string[][] = [
  ['entity', 'create', 'Alice', '-t', 'person', '-i', '7'],
  ['entity', 'create', 'Alice', '-o', 'one', 'two', 'three'],
  ['entity', 'create', 'Alice', '--tags', 'a', 'b'],
  ['entity', 'create', 'Alice'],
  ['entity', 'get', 'Alice'],
  ['entity', 'list', '-l', '5', '-t', 'person'],
  ['entity', 'update', 'Alice', '--tags', 'x'],
  ['search', 'hello world', '-l', '3', '--threshold', '0.4'],
  ['search', 'x', '--threshold=0.9'],
  ['search', 'x', '--ranked', '--fuzzy'],
  ['graph', 'centrality', '--top', '10', '--damping', '0.9'],
  ['graph', 'shortest-path', 'a', 'b'],
  ['relation', 'create', 'a', 'knows', 'b'],
  ['observation', 'add', 'Alice', 'obs one', 'obs two'],
  ['tag', 'add', 'Alice', 'x', 'y'],
  ['import', 'file.json'],
  ['import', 'file.json', '-f', 'csv'],
  ['export', 'out.csv', '-f', 'csv'],
  ['stats'],
  ['project-context', 'append-command', 'p1', '--name', 'test', '--command', 'npm test', '--purpose', 'runs'],
  ['doctor', '--json'],
  ['reindex', '--ranked'],
  ['interactive'],
  ['i'],
  ['--quiet', 'stats'],
  ['-q', 'stats'],
  ['--output-format', 'table', 'stats'],
  ['--output-format=csv', 'stats'],
  ['stats', '--', 'extra'],
  ['heuristic', 'match', 'one', 'two', '-l', '4'],
  ['tree', '--ascii'],
  ['obs-dedup', 'find', '--min-occurrences', '2'],
  ['spell', 'suggest', 'q', '-l', '3', '-s', '0.5'],
  ['cache', 'stats'],
  ['audit', 'log', '--op', 'create'],
  ['tool-affordance', 'suggest', 'hint', '--limit', '2'],
  ['decision', 'propose', '--context', 'c', '--decision', 'd', '--alternative', 'a1', 'a2'],
  ['exclude', 'add', 'pat', '--scope', 'both'],
  ['hierarchy', 'set-parent', 'child', 'parent'],
  ['relation', 'list', '--from', 'a'],
  ['graph', 'components'],
];

const ERROR_CASES: string[][] = [
  ['entity', 'create'],
  ['nope'],
  ['entity', 'nope'],
  ['stats', '--unknown-flag'],
  ['project-context', 'append-command', 'p1'],
  ['import', 'file.json', '-f', 'bogus'],
  ['compress', '--threshold', 'NaN'],
  ['search'],
  ['interactive', '--bad'],
  ['entity', 'get'],
  ['audit', 'log', '--op', 'explode'],
  ['search', 'x', '--limit'],
  ['stats', '--storag', 'x'],
  ['entity', 'list', '--limt', '3'],
];

async function captureRun(argv: string[]): Promise<{
  argv: string[];
  captured: Captured[];
  written: string[];
  errorMessage: string | undefined;
  exitCode: number | undefined;
}> {
  const captured: Captured[] = [];
  const written: string[] = [];
  const program = build(captured, written);
  let errorMessage: string | undefined;
  let exitCode: number | undefined;
  try {
    await program.parseAsync(['node', 'memory', ...argv]);
  } catch (err) {
    const candidate = err as { exitCode?: number; message?: string };
    errorMessage = candidate.message;
    exitCode = candidate.exitCode;
  }
  return { argv, captured, written, errorMessage: errorMessage ?? null, exitCode: exitCode ?? null };
}

async function captureSynthetic(argv: string[]): Promise<{
  argv: string[];
  record: unknown;
  written: string[];
  errorMessage: string | undefined;
  exitCode: number | undefined;
  help: string;
}> {
  const written: string[] = [];
  const { program, last } = buildSyntheticProgram(
    Command as unknown as new (name?: string) => CommandLike,
    Option as unknown as new (flags: string, description?: string) => { choices(v: string[]): unknown; default(v: unknown): unknown } as never,
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
  return {
    argv,
    record: last(),
    written,
    errorMessage: errorMessage ?? null,
    exitCode: exitCode ?? null,
    help: program.helpInformation(),
  };
}

const invocations = [];
for (const argv of ARGV_CASES) invocations.push(await captureRun(argv));
const errors = [];
for (const argv of ERROR_CASES) errors.push(await captureRun(argv));
const synthetic = [];
for (const argv of SYNTHETIC_ARGV) synthetic.push(await captureSynthetic(argv));
const version = await captureRun(['--version']);
const helpRoot = await captureRun(['--help']);

/** Reuse one program across several parses, the way pipe mode does. */
async function captureRepeatedParse(
  sequence: string[][],
): Promise<{ sequence: string[][]; captured: Captured[] }> {
  const captured: Captured[] = [];
  const written: string[] = [];
  const program = build(captured, written);
  for (const argv of sequence) {
    try {
      await program.parseAsync(['node', 'memory', ...argv]);
    } catch {
      // Record what the action saw before the failure.
    }
  }
  return { sequence, captured };
}

/** Call parseOptions directly on a fresh program, the way pipe mode primes globals. */
function captureParseOptions(argv: string[]): {
  argv: string[];
  operands: string[];
  unknown: string[];
  opts: Record<string, unknown>;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  const program = build(captured, []);
  const parsed = program.parseOptions(argv);
  return {
    argv,
    operands: parsed.operands,
    unknown: parsed.unknown,
    opts: JSON.parse(JSON.stringify(program.opts())) as Record<string, unknown>,
    captured,
  };
}

const repeatedParse = [
  await captureRepeatedParse([
    ['entity', 'list', '-l', '2'],
    ['entity', 'list'],
    ['stats'],
    ['entity', 'list', '--tags', 'a'],
  ]),
  await captureRepeatedParse([
    ['search', 'x', '--ranked'],
    ['search', 'y'],
  ]),
];

const parseOptions = [
  captureParseOptions(['--storage', 'x', 'entity', 'create', 'N', '-t', 'person', '--unknown', 'z']),
  captureParseOptions(['--output-format=table', 'stats']),
  captureParseOptions(['-s', 'y', '-q', 'entity', 'list']),
];

const fixture = {
  commanderVersion: '15.0.0',
  program: { name: 'memory', version: '5.1.0' },
  help: helpSnapshots(),
  invocations,
  errors,
  synthetic,
  repeatedParse,
  parseOptions,
  version,
  helpRoot,
};

writeFileSync(process.argv[2] ?? '/dev/stdout', JSON.stringify(fixture, null, 2) + '\n');
