/**
 * Observation CLI Commands
 *
 * @module cli/commands/observation
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError, escapeCSV } from '../formatters.js';

export function registerObservationCommands(program: Command): void {
  const observation = program
    .command('observation')
    .description('Manage entity observations');

  observation
    .command('add <entity> <text...>')
    .description('Add observation(s) to an entity')
    .action(async (entity: string, text: string[]) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.observationManager.addObservations([{
          entityName: entity,
          contents: text,
        }]);

        const added = result[0]?.addedObservations || [];
        logger.info(formatSuccess(`Added ${added.length} observation(s) to ${entity}`));
        if (!options.quiet && options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  observation
    .command('remove <entity> <text...>')
    .description('Remove observation(s) from an entity')
    .action(async (entity: string, text: string[]) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
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
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  observation
    .command('list <entity>')
    .description('List observations for an entity')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const found = await ctx.entityManager.getEntity(entity);
        if (!found) {
          logger.error(formatError(`Entity "${entity}" not found`));
          process.exit(1);
        }

        const observations = found.observations || [];
        if (options.format === 'json') {
          console.log(JSON.stringify(observations, null, 2));
        } else if (options.format === 'csv') {
          console.log('index,observation');
          observations.forEach((o, i) => {
            console.log(`${i + 1},${escapeCSV(o)}`);
          });
        } else {
          console.log(`Observations for ${entity} (${observations.length}):`);
          observations.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
