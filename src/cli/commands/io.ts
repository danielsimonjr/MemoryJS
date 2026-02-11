/**
 * Import/Export CLI Commands
 *
 * @module cli/commands/io
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError } from '../formatters.js';

export function registerIOCommands(program: Command): void {
  program
    .command('import <file>')
    .description('Import data from file')
    .option('-f, --format <format>', 'File format (json|csv|graphml)', 'json')
    .option('--merge <strategy>', 'Merge strategy (replace|skip|merge|fail)', 'skip')
    .action(async (file: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const fs = await import('fs');
        const data = fs.readFileSync(file, 'utf-8');

        const result = await ctx.ioManager.importGraph(
          opts.format as 'json' | 'csv' | 'graphml',
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
    .option('-f, --format <format>', 'Output format (json|csv|graphml|gexf|dot|markdown|mermaid)', 'json')
    .action(async (file: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const graph = await ctx.storage.loadGraph();
        const data = ctx.ioManager.exportGraph(
          graph,
          opts.format as 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid'
        );

        const fs = await import('fs');
        fs.writeFileSync(file, data, 'utf-8');

        logger.info(formatSuccess(`Exported to ${file}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
