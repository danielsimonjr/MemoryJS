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
program
  .option('-s, --storage <path>', 'Path to storage file', './memory.jsonl')
  .option('-f, --format <type>', 'Output format (json|table|csv)', 'json')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--verbose', 'Enable verbose/debug output');

// Register all commands
registerCommands(program);

// Parse and execute
program.parse();
