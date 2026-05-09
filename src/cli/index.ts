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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

// Process-level safety nets — without these, an unhandled rejection or
// uncaught exception silently crashes the CLI. Errors route through the
// shared logger so output is consistent with every other module.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
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
 * Phase 0 step 7: when stdin is piped (non-TTY) and no subcommand is supplied
 * on the argv, treat each line of stdin as a separate command invocation.
 * Lines starting with `#` are ignored as comments. Blank lines are skipped.
 *
 * This enables Unix-style composition:
 *
 *   echo "search foo" | memoryjs
 *   cat commands.txt | memoryjs --output-format=table
 *
 * The global `--output-format` flag (default: json) lets callers choose
 * machine-readable output when piping.
 */
async function runPipedCommands(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const input = Buffer.concat(chunks).toString('utf-8');
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  // Prevent Commander from calling process.exit on per-line parse errors.
  program.exitOverride();

  for (const line of lines) {
    const lineArgs = line.split(/\s+/);
    try {
      await program.parseAsync(lineArgs, { from: 'user' });
    } catch (err) {
      logger.error(`Pipe-mode command failed: "${line}":`, err);
      process.exitCode = 1;
    }
  }
}

const isPiped = process.stdin.isTTY === false;
const hasSubcommand = process.argv.length > 2;

if (isPiped && !hasSubcommand) {
  void runPipedCommands();
} else {
  // Parse and execute (default path: argv-driven invocation)
  program.parse();
}
