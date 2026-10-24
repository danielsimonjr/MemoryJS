/**
 * Relation CLI Commands
 *
 * @module cli/commands/relation
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatRelations, formatSuccess } from '../formatters.js';

/**
 * Register the `relation` command group: `create`, `list` and `delete`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerRelationCommands(program: Command): void {
  const relation = program
    .command('relation')
    .description('Manage relations between entities');

  relation
    .command('create <from> <type> <to>')
    .description('Create a new relation')
    .action(runAction(program, async (ctx, _options, logger, from: string, relationType: string, to: string) => {
      await ctx.relationManager.createRelations([{ from, to, relationType }]);
      logger.info(formatSuccess(`Created relation: ${from} --[${relationType}]--> ${to}`));
    }));

  relation
    .command('list')
    .description('List relations')
    .option('--from <entity>', 'Filter by source entity')
    .option('--to <entity>', 'Filter by target entity')
    .option('-t, --type <type>', 'Filter by relation type')
    .action(runAction(program, async (ctx, options, logger, opts: Record<string, unknown>) => {
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

      logger.log(formatRelations(relations, options.format));
    }));

  relation
    .command('delete <from> <type> <to>')
    .description('Delete a relation')
    .action(runAction(program, async (ctx, _options, logger, from: string, relationType: string, to: string) => {
      await ctx.relationManager.deleteRelations([{ from, to, relationType }]);
      logger.info(formatSuccess(`Deleted relation: ${from} --[${relationType}]--> ${to}`));
    }));
}
