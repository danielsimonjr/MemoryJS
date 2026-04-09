/**
 * Tag CLI Commands
 *
 * @module cli/commands/tag
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError, escapeCSV } from '../formatters.js';

export function registerTagCommands(program: Command): void {
  const tag = program
    .command('tag')
    .description('Manage entity tags and aliases');

  tag
    .command('add <entity> <tags...>')
    .description('Add tags to an entity')
    .action(async (entity: string, tags: string[]) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        await ctx.entityManager.addTags(entity, tags);
        logger.info(formatSuccess(`Added tags [${tags.join(', ')}] to ${entity}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  tag
    .command('remove <entity> <tags...>')
    .description('Remove tags from an entity')
    .action(async (entity: string, tags: string[]) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        await ctx.entityManager.removeTags(entity, tags);
        logger.info(formatSuccess(`Removed tags [${tags.join(', ')}] from ${entity}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  tag
    .command('alias <alias> <canonical>')
    .description('Create a tag alias')
    .option('-d, --description <desc>', 'Alias description')
    .action(async (alias: string, canonical: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.tagManager.addTagAlias(alias, canonical, opts.description as string | undefined);
        logger.info(formatSuccess(`Created alias: ${alias} -> ${canonical}`));
        if (!options.quiet && options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  tag
    .command('aliases')
    .description('List all tag aliases')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const aliases = await ctx.tagManager.listTagAliases();
        if (options.format === 'json') {
          console.log(JSON.stringify(aliases, null, 2));
        } else if (options.format === 'csv') {
          console.log('alias,canonical,description');
          for (const a of aliases) {
            console.log(`${escapeCSV(a.alias)},${escapeCSV(a.canonical)},${escapeCSV(a.description || '')}`);
          }
        } else {
          if (aliases.length === 0) {
            console.log('No tag aliases defined.');
          } else {
            console.log(`Tag aliases (${aliases.length}):`);
            for (const a of aliases) {
              const desc = a.description ? ` (${a.description})` : '';
              console.log(`  ${a.alias} -> ${a.canonical}${desc}`);
            }
          }
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
