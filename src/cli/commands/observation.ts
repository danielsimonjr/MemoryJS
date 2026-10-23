/**
 * Observation CLI Commands
 *
 * @module cli/commands/observation
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatSuccess, formatError, escapeCSV } from '../formatters.js';

/**
 * Register the `observation` command group: `add`, `remove` and `list`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerObservationCommands(program: Command): void {
  const observation = program
    .command('observation')
    .description('Manage entity observations');

  observation
    .command('add <entity> <text...>')
    .description('Add observation(s) to an entity')
    .action(runAction(program, async (ctx, options, logger, entity: string, text: string[]) => {
      const result = await ctx.observationManager.addObservations([{
        entityName: entity,
        contents: text,
      }]);

      const added = result[0]?.addedObservations || [];
      logger.info(formatSuccess(`Added ${added.length} observation(s) to ${entity}`));
      if (options.format === 'json') {
        logger.info(JSON.stringify(result, null, 2));
      }
    }));

  observation
    .command('remove <entity> <text...>')
    .description('Remove observation(s) from an entity')
    .action(runAction(program, async (ctx, _options, logger, entity: string, text: string[]) => {
      // Verify entity exists before attempting removal
      const existing = await ctx.entityManager.getEntity(entity);
      if (!existing) {
        logger.error(formatError(`Entity "${entity}" not found`));
        process.exit(1);
      }

      await ctx.observationManager.deleteObservations([{
        entityName: entity,
        observations: text,
      }]);

      logger.info(formatSuccess(`Removed observation(s) from ${entity}`));
    }));

  observation
    .command('list <entity>')
    .description('List observations for an entity')
    .action(runAction(program, async (ctx, options, logger, entity: string) => {
      const found = await ctx.entityManager.getEntity(entity);
      if (!found) {
        logger.error(formatError(`Entity "${entity}" not found`));
        process.exit(1);
      }

      const observations = found.observations || [];
      if (options.format === 'json') {
        logger.log(JSON.stringify(observations, null, 2));
      } else if (options.format === 'csv') {
        logger.log('index,observation');
        observations.forEach((o, i) => {
          logger.log(`${i + 1},${escapeCSV(o)}`);
        });
      } else {
        logger.log(`Observations for ${entity} (${observations.length}):`);
        observations.forEach((o, i) => logger.log(`  ${i + 1}. ${o}`));
      }
    }));
}
