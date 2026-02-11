/**
 * Relation CLI Commands
 *
 * @module cli/commands/relation
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatRelations, formatSuccess, formatError } from '../formatters.js';

export function registerRelationCommands(program: Command): void {
  const relation = program
    .command('relation')
    .description('Manage relations between entities');

  relation
    .command('create <from> <type> <to>')
    .description('Create a new relation')
    .action(async (from: string, relationType: string, to: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        await ctx.relationManager.createRelations([{ from, to, relationType }]);
        logger.info(formatSuccess(`Created relation: ${from} --[${relationType}]--> ${to}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  relation
    .command('list')
    .description('List relations')
    .option('--from <entity>', 'Filter by source entity')
    .option('--to <entity>', 'Filter by target entity')
    .option('-t, --type <type>', 'Filter by relation type')
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        // Direct storage access for listing — relationManager has no listAll()
        const graph = await ctx.storage.loadGraph();
        let relations = [...graph.relations];

        if (opts.from) {
          relations = relations.filter(r => r.from === opts.from);
        }
        if (opts.to) {
          relations = relations.filter(r => r.to === opts.to);
        }
        if (opts.type) {
          relations = relations.filter(r => r.relationType === opts.type);
        }

        console.log(formatRelations(relations, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  relation
    .command('delete <from> <type> <to>')
    .description('Delete a relation')
    .action(async (from: string, relationType: string, to: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        await ctx.relationManager.deleteRelations([{ from, to, relationType }]);
        logger.info(formatSuccess(`Deleted relation: ${from} --[${relationType}]--> ${to}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
