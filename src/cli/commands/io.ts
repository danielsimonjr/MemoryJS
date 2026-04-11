/**
 * Import/Export CLI Commands
 *
 * @module cli/commands/io
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Command, Option } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError } from '../formatters.js';
import { validateFilePath } from '../../utils/entityUtils.js';

const IMPORT_FORMATS = ['json', 'csv', 'graphml'] as const;
const EXPORT_FORMATS = ['json', 'csv', 'graphml', 'gexf', 'dot', 'markdown', 'mermaid'] as const;

export function registerIOCommands(program: Command): void {
  program
    .command('import <file>')
    .description('Import data from file')
    .addOption(
      new Option('-f, --format <format>', 'File format')
        .choices([...IMPORT_FORMATS])
        .default('json')
    )
    .option('--merge <strategy>', 'Merge strategy (replace|skip|merge|fail)', 'skip')
    .action(async (file: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        // Defense-in-depth: validate path even after resolve() to catch null bytes
        // and ensure the path is a normalized absolute path
        const resolvedPath = validateFilePath(resolve(file));
        const data = readFileSync(resolvedPath, 'utf-8');

        const result = await ctx.ioManager.importGraph(
          opts.format as typeof IMPORT_FORMATS[number],
          data,
          opts.merge as 'replace' | 'skip' | 'merge' | 'fail'
        );

        logger.info(formatSuccess(
          `Imported ${result.entitiesAdded} entities and ${result.relationsAdded} relations`
        ));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  program
    .command('export <file>')
    .description('Export data to file')
    .addOption(
      new Option('-f, --format <format>', 'Output format')
        .choices([...EXPORT_FORMATS])
        .default('json')
    )
    .action(async (file: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const resolvedPath = validateFilePath(resolve(file));
        const graph = await ctx.storage.loadGraph();
        const data = ctx.ioManager.exportGraph(
          graph,
          opts.format as typeof EXPORT_FORMATS[number]
        );

        writeFileSync(resolvedPath, data, 'utf-8');

        logger.info(formatSuccess(`Exported to ${resolvedPath}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
