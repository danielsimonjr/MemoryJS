/**
 * Maintenance CLI Commands (stats, archive, compress, validate)
 *
 * @module cli/commands/maintenance
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatValidation, formatSuccess, formatError } from '../formatters.js';

export function registerMaintenanceCommands(program: Command): void {
  // Stats
  program
    .command('stats')
    .description('Show knowledge graph statistics')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const stats = await ctx.analyticsManager.getGraphStats();
        const graph = await ctx.storage.loadGraph();

        const observationCount = graph.entities.reduce(
          (sum, e) => sum + (e.observations?.length || 0),
          0
        );
        const allTags = new Set<string>();
        graph.entities.forEach(e => {
          (e.tags || []).forEach(tag => allTags.add(tag));
        });

        if (options.format === 'json') {
          console.log(JSON.stringify({
            ...stats,
            observationCount,
            uniqueTagCount: allTags.size,
          }, null, 2));
        } else {
          console.log(`
Knowledge Graph Statistics
==========================
Entities:      ${stats.totalEntities}
Relations:     ${stats.totalRelations}
Entity Types:  ${Object.keys(stats.entityTypesCounts).length}
Relation Types: ${Object.keys(stats.relationTypesCounts).length}
Observations:  ${observationCount}
Tags Used:     ${allTags.size}
`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // Archive
  program
    .command('archive')
    .description('Archive old or low-importance entities')
    .option('--older-than <date>', 'Archive entities older than ISO date')
    .option('--importance-lt <n>', 'Archive entities with importance below N', parseFloat)
    .option('--tags <tags...>', 'Archive entities with these tags')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const criteria: Record<string, unknown> = {};
        if (opts.olderThan) criteria.olderThan = opts.olderThan;
        if (opts.importanceLt !== undefined) criteria.importanceLessThan = opts.importanceLt;
        if (opts.tags) criteria.tags = opts.tags;

        if (Object.keys(criteria).length === 0) {
          logger.error(formatError('At least one criteria required (--older-than, --importance-lt, or --tags)'));
          process.exit(1);
        }

        const dryRun = Boolean(opts.dryRun);
        const result = await ctx.archiveManager.archiveEntities(
          criteria as { olderThan?: string; importanceLessThan?: number; tags?: string[] },
          dryRun
        );

        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const prefix = dryRun ? '[DRY RUN] Would archive' : 'Archived';
          logger.info(formatSuccess(`${prefix} ${result.archived} entities`));
          if (result.entityNames.length > 0) {
            for (const name of result.entityNames) {
              console.log(`  - ${name}`);
            }
          }
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // Compress
  program
    .command('compress')
    .description('Find and merge duplicate entities')
    .option('--threshold <n>', 'Similarity threshold (0-1)', parseFloat, 0.8)
    .option('--dry-run', 'Preview without applying changes')
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.compressionManager.compressGraph(
          opts.threshold as number,
          Boolean(opts.dryRun)
        );

        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const prefix = opts.dryRun ? '[DRY RUN] ' : '';
          logger.info(formatSuccess(`${prefix}Duplicates found: ${result.duplicatesFound}`));
          logger.info(`  Entities merged: ${result.entitiesMerged}`);
          logger.info(`  Observations compressed: ${result.observationsCompressed}`);
          logger.info(`  Relations consolidated: ${result.relationsConsolidated}`);
          if (result.mergedEntities.length > 0) {
            console.log('\nMerge details:');
            for (const m of result.mergedEntities) {
              console.log(`  ${m.kept} <- [${m.merged.join(', ')}]`);
            }
          }
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // Validate
  program
    .command('validate')
    .description('Validate graph integrity')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.analyticsManager.validateGraph();
        console.log(formatValidation(result, options.format));
        if (!result.isValid) {
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // Interactive mode
  program
    .command('interactive')
    .alias('i')
    .description('Start interactive REPL mode')
    .action(async () => {
      const options = getOptions(program);
      const { startInteractiveMode } = await import('../interactive.js');
      await startInteractiveMode(options);
    });
}
