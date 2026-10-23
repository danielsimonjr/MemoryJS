/**
 * Entity CLI Commands
 *
 * @module cli/commands/entity
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatEntities, formatEntityDetail, formatSuccess, formatError } from '../formatters.js';

/**
 * Register the `entity` command group: `create`, `get`, `list`, `update` and `delete`.
 *
 * @param program - The root Commander program that receives the commands.
 */
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
    .action(runAction(program, async (ctx, options, logger, name: string, opts: Record<string, unknown>) => {
      const [created] = await ctx.entityManager.createEntities([{
        name,
        entityType: (opts.type as string) || 'generic',
        observations: (opts.observation as string[]) || [],
        tags: (opts.tags as string[]) || [],
        importance: opts.importance as number | undefined,
      }]);

      logger.info(formatSuccess(`Created entity: ${created.name}`));
      logger.info(formatEntityDetail(created, options.format));
    }));

  entity
    .command('get <name>')
    .description('Get an entity by name')
    .action(runAction(program, async (ctx, options, logger, name: string) => {
      const found = await ctx.entityManager.getEntity(name);
      if (!found) {
        logger.error(formatError(`Entity "${name}" not found`));
        process.exit(1);
      }
      logger.log(formatEntityDetail(found, options.format));
    }));

  entity
    .command('list')
    .description('List entities')
    .option('-t, --type <type>', 'Filter by entity type')
    .option('--tags <tags...>', 'Filter by tags')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .action(runAction(program, async (ctx, options, logger, opts: Record<string, unknown>) => {
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

      logger.log(formatEntities(entities, options.format));
    }));

  entity
    .command('update <name>')
    .description('Update an entity')
    .option('-t, --type <type>', 'New entity type')
    .option('-o, --observation <obs...>', 'Add observations')
    .option('--tags <tags...>', 'Set tags')
    .option('-i, --importance <n>', 'Set importance (0-10)', parseFloat)
    .action(runAction(program, async (ctx, options, logger, name: string, opts: Record<string, unknown>) => {
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
      logger.info(formatEntityDetail(updated, options.format));
    }));

  entity
    .command('delete <name>')
    .description('Delete an entity')
    .action(runAction(program, async (ctx, _options, logger, name: string) => {
      await ctx.entityManager.deleteEntities([name]);
      logger.info(formatSuccess(`Deleted entity: ${name}`));
    }));
}
