/**
 * Tag CLI Commands
 *
 * @module cli/commands/tag
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatSuccess, escapeCSV } from '../formatters.js';

/**
 * Register the `tag` command group: `add`, `remove`, `alias` and `aliases`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerTagCommands(program: Command): void {
  const tag = program
    .command('tag')
    .description('Manage entity tags and aliases');

  tag
    .command('add <entity> <tags...>')
    .description('Add tags to an entity')
    .action(runAction(program, async (ctx, _options, logger, entity: string, tags: string[]) => {
      await ctx.entityManager.addTags(entity, tags);
      logger.info(formatSuccess(`Added tags [${tags.join(', ')}] to ${entity}`));
    }));

  tag
    .command('remove <entity> <tags...>')
    .description('Remove tags from an entity')
    .action(runAction(program, async (ctx, _options, logger, entity: string, tags: string[]) => {
      await ctx.entityManager.removeTags(entity, tags);
      logger.info(formatSuccess(`Removed tags [${tags.join(', ')}] from ${entity}`));
    }));

  tag
    .command('alias <alias> <canonical>')
    .description('Create a tag alias')
    .option('-d, --description <desc>', 'Alias description')
    .action(runAction(program, async (ctx, options, logger, alias: string, canonical: string, opts: Record<string, unknown>) => {
      const result = await ctx.tagManager.addTagAlias(alias, canonical, opts.description as string | undefined);
      logger.info(formatSuccess(`Created alias: ${alias} -> ${canonical}`));
      if (options.format === 'json') {
        logger.info(JSON.stringify(result, null, 2));
      }
    }));

  tag
    .command('aliases')
    .description('List all tag aliases')
    .action(runAction(program, async (ctx, options, logger) => {
      const aliases = await ctx.tagManager.listTagAliases();
      if (options.format === 'json') {
        logger.log(JSON.stringify(aliases, null, 2));
      } else if (options.format === 'csv') {
        logger.log('alias,canonical,description');
        for (const a of aliases) {
          logger.log(`${escapeCSV(a.alias)},${escapeCSV(a.canonical)},${escapeCSV(a.description || '')}`);
        }
      } else {
        if (aliases.length === 0) {
          logger.log('No tag aliases defined.');
        } else {
          logger.log(`Tag aliases (${aliases.length}):`);
          for (const a of aliases) {
            const desc = a.description ? ` (${a.description})` : '';
            logger.log(`  ${a.alias} -> ${a.canonical}${desc}`);
          }
        }
      }
    }));
}
