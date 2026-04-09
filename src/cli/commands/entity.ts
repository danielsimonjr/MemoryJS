/**
 * Entity CLI Commands
 *
 * @module cli/commands/entity
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import {
  formatEntities,
  formatEntityDetail,
  formatSuccess,
  formatError,
} from '../formatters.js';

export function registerEntityCommands(program: Command): void {
  const entity = program
    .command('entity')
    .description('Manage entities (create, read, update, delete)');

  entity
    .command('create <name>')
    .description('Create a new entity')
    .option('-t, --type <type>', 'Entity type', 'generic')
    .option('-o, --observation <obs...>', 'Observations to add')
    .option('--tags <tags...>', 'Tags to add')
    .option('-i, --importance <n>', 'Importance score (0-10)', parseFloat)
    .action(async (name: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const [created] = await ctx.entityManager.createEntities([{
          name,
          entityType: (opts.type as string) || 'generic',
          observations: (opts.observation as string[]) || [],
          tags: (opts.tags as string[]) || [],
          importance: opts.importance as number | undefined,
        }]);

        logger.info(formatSuccess(`Created entity: ${created.name}`));
        if (!options.quiet) {
          console.log(formatEntityDetail(created, options.format));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  entity
    .command('get <name>')
    .description('Get an entity by name')
    .action(async (name: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const found = await ctx.entityManager.getEntity(name);
        if (!found) {
          logger.error(formatError(`Entity "${name}" not found`));
          process.exit(1);
        }
        console.log(formatEntityDetail(found, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  entity
    .command('list')
    .description('List entities')
    .option('-t, --type <type>', 'Filter by entity type')
    .option('--tags <tags...>', 'Filter by tags')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        // Direct storage access for listing — entityManager has no listAll()
        const graph = await ctx.storage.loadGraph();
        let entities = [...graph.entities];

        if (opts.type) {
          entities = entities.filter(e => e.entityType === opts.type);
        }
        if (opts.tags) {
          const tags = opts.tags as string[];
          entities = entities.filter(e =>
            tags.some(tag => (e.tags || []).includes(tag))
          );
        }
        if (opts.limit) {
          entities = entities.slice(0, opts.limit as number);
        }

        console.log(formatEntities(entities, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  entity
    .command('update <name>')
    .description('Update an entity')
    .option('-t, --type <type>', 'New entity type')
    .option('-o, --observation <obs...>', 'Add observations')
    .option('--tags <tags...>', 'Set tags')
    .option('-i, --importance <n>', 'Set importance (0-10)', parseFloat)
    .action(async (name: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const existing = await ctx.entityManager.getEntity(name);
        if (!existing) {
          throw new Error(`Entity "${name}" not found`);
        }

        const updates: Record<string, unknown> = {};
        if (opts.type) updates.entityType = opts.type;
        if (opts.observation) {
          updates.observations = [...(existing.observations || []), ...(opts.observation as string[])];
        }
        if (opts.tags) updates.tags = opts.tags;
        if (opts.importance !== undefined) updates.importance = opts.importance;

        const updated = await ctx.entityManager.updateEntity(name, updates);

        logger.info(formatSuccess(`Updated entity: ${updated.name}`));
        if (!options.quiet) {
          console.log(formatEntityDetail(updated, options.format));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  entity
    .command('delete <name>')
    .description('Delete an entity')
    .action(async (name: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        await ctx.entityManager.deleteEntities([name]);
        logger.info(formatSuccess(`Deleted entity: ${name}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
