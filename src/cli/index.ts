/**
 * MemoryJS CLI
 *
 * Command-line interface for MemoryJS knowledge graph operations.
 * Supports entity/relation CRUD, search, import/export, and interactive mode.
 *
 * @module cli
 */

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

// Process-level safety nets — without these, errors are swallowed silently.
// We log via the shared logger and let Node's default behaviour (or other
// registered handlers, e.g. WorkerPoolManager's worker shutdown) decide what
// to do with the process. Calling process.exit(1) here would race with
// WorkerPool's shutdownAllSync and skip worker teardown.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

// Get package version
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Try to find package.json relative to the CLI file
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('memory')
  .description('MemoryJS - Knowledge Graph CLI')
  .version(getVersion(), '-v, --version', 'Output the current version');

// Global options
//
// `--output-format` controls console-render format (json|table|csv).
// Renamed from `-f, --format` to avoid clashing with the `import`/`export`
// subcommands' `--format` flag (data format: graphml, turtle, json-ld,
// etc.). Long-form-only — the `-o` short flag is reserved for entity
// `--observation` and similar subcommand options.
program
  .option('-s, --storage <path>', 'Path to storage file', './memory.jsonl')
  .option('--output-format <type>', 'Console output format (json|table|csv)', 'json')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--verbose', 'Enable verbose/debug output');

// Register all commands
registerCommands(program);

/**
 * When stdin is piped (non-TTY) and no positional subcommand is supplied on
 * the argv, treat each line of stdin as a separate command invocation. Lines
 * starting with `#` are ignored as comments. Blank lines are skipped.
 *
 * This enables Unix-style composition:
 *
 *   echo "search foo" | memoryjs
 *   cat commands.txt | memoryjs --output-format=table
 *
 * The global `--output-format` flag (default: json) lets callers choose
 * machine-readable output when piping.
 *
 * **Limitation:** global flags set on the outer invocation persist for every
 * line. Per-line commands should not pass globals like `--storage`
 * themselves; set globals once on the outer invocation.
 */

/**
 * Tokenise a single command line, respecting single/double quotes and
 * backslash escapes. Returns the argv array Commander expects.
 *
 *   tokenizeLine(`search "hello world"`)  → ['search', 'hello world']
 *   tokenizeLine(`get "Smith\\'s file"`)  → ['get', "Smith's file"]
 */
function tokenizeLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (/\s/.test(ch as string) && !inSingle && !inDouble) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

async function runPipedCommands(): Promise<void> {
  if (!process.stdin) {
    program.help();
    return;
  }

  let executedAny = false;

  // Stream line-by-line so a multi-megabyte pipe doesn't fully buffer in
  // memory and so the first command starts running before the producer
  // finishes writing.
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const lineArgs = tokenizeLine(line);
    if (lineArgs.length === 0) continue;
    executedAny = true;
    try {
      await program.parseAsync(lineArgs, { from: 'user' });
    } catch (err) {
      // Commander throws on legitimate non-error exits like --help / --version.
      const code = (err as { code?: string } | null)?.code ?? '';
      if (
        code === 'commander.helpDisplayed' ||
        code === 'commander.help' ||
        code === 'commander.version'
      ) {
        continue;
      }
      logger.error(`Pipe-mode command failed: "${line}":`, err);
      process.exitCode = 1;
    }
  }

  if (!executedAny) {
    // Empty pipe (or comments-only) — surface help instead of silent no-op.
    program.help();
  }
}

// Pipe-mode trigger: stdin is non-TTY AND argv has no positional subcommand.
// Filtering argv for non-flag tokens lets `cat x | memoryjs
// --output-format=table` correctly enter pipe mode (the flag is a global
// option, not a subcommand).
const isPiped = process.stdin && process.stdin.isTTY === false;
const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const hasSubcommand = positionalArgs.length > 0;

if (isPiped && !hasSubcommand) {
  // Populate global options from the outer argv without invoking the full
  // subcommand-routing pipeline. parseOptions is Commander's documented
  // flag-only parser and avoids exception-as-control-flow.
  program.parseOptions(process.argv.slice(2));
  // Suppress process.exit on per-line parse errors during the pipe loop.
  program.exitOverride();
  runPipedCommands().catch((err) => {
    logger.error('Pipe-mode failed:', err);
    process.exitCode = 1;
  });
} else {
  // Parse and execute (default path: argv-driven invocation)
  program.parse();
}
