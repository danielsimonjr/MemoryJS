/**
 * CLI Command Registry
 *
 * Registers all command categories with the main program.
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import { ManagerContext } from '../../core/ManagerContext.js';
import { parseGlobalOptions, createLogger, type GlobalOptions } from '../options.js';
import { findConfigFile, loadConfig, mergeConfig } from '../config.js';
import {
  formatEntities,
  formatRelations,
  formatEntityDetail,
  formatSearchResults,
  formatSuccess,
  formatError,
} from '../formatters.js';

/**
 * Get merged options from config file and CLI.
 */
function getOptions(program: Command): GlobalOptions {
  const cliOpts = program.opts();
  const configPath = findConfigFile();
  const fileConfig = configPath ? loadConfig(configPath) : {};
  return mergeConfig(fileConfig, parseGlobalOptions(cliOpts));
}

/**
 * Create a ManagerContext with the specified storage path.
 */
function createContext(options: GlobalOptions): ManagerContext {
  return new ManagerContext(options.storage);
}

export function registerCommands(program: Command): void {
  // ==================== Entity Commands ====================
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
        const [entity] = await ctx.entityManager.createEntities([{
          name,
          entityType: (opts.type as string) || 'generic',
          observations: (opts.observation as string[]) || [],
          tags: (opts.tags as string[]) || [],
          importance: opts.importance as number | undefined,
        }]);

        logger.info(formatSuccess(`Created entity: ${entity.name}`));
        if (!options.quiet) {
          console.log(formatEntityDetail(entity, options.format));
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
        const entity = await ctx.entityManager.getEntity(name);
        if (!entity) {
          logger.error(formatError(`Entity "${name}" not found`));
          process.exit(1);
        }
        console.log(formatEntityDetail(entity, options.format));
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
        const graph = await ctx.storage.loadGraph();
        let entities = [...graph.entities];

        // Apply filters
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

        const entity = await ctx.entityManager.updateEntity(name, updates);

        logger.info(formatSuccess(`Updated entity: ${entity.name}`));
        if (!options.quiet) {
          console.log(formatEntityDetail(entity, options.format));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  entity
    .command('delete <name>')
    .description('Delete an entity')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, _opts: Record<string, unknown>) => {
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

  // ==================== Relation Commands ====================
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
        await ctx.relationManager.createRelations([{
          from,
          to,
          relationType,
        }]);

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
        const graph = await ctx.storage.loadGraph();
        let relations = [...graph.relations];

        // Apply filters
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

  // ==================== Search Command ====================
  program
    .command('search <query>')
    .description('Search entities and observations')
    .option('-l, --limit <n>', 'Limit results', parseInt, 10)
    .option('-t, --type <type>', 'Filter by entity type')
    .action(async (query: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        logger.debug(`Searching for: ${query}`);
        const result = await ctx.searchManager.searchNodes(query);

        let entities = result.entities.map((entity, idx) => ({
          entity,
          score: 1.0 - idx * 0.01, // Simple ranking by position
        }));

        if (opts.type) {
          entities = entities.filter(r => r.entity.entityType === opts.type);
        }
        if (opts.limit) {
          entities = entities.slice(0, opts.limit as number);
        }

        console.log(formatSearchResults(entities, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // ==================== Import Command ====================
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

  // ==================== Export Command ====================
  program
    .command('export <file>')
    .description('Export data to file')
    .option('-f, --format <format>', 'Output format (json|csv|graphml|markdown|mermaid)', 'json')
    .action(async (file: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const graph = await ctx.storage.loadGraph();
        const data = ctx.ioManager.exportGraph(
          graph,
          opts.format as 'json' | 'csv' | 'graphml' | 'markdown' | 'mermaid'
        );

        const fs = await import('fs');
        fs.writeFileSync(file, data, 'utf-8');

        logger.info(formatSuccess(`Exported to ${file}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // ==================== Stats Command ====================
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

        // Compute additional stats not in GraphStats
        const observationCount = graph.entities.reduce(
          (sum, e) => sum + (e.observations?.length || 0),
          0
        );
        const allTags = new Set<string>();
        graph.entities.forEach(e => {
          (e.tags || []).forEach(tag => allTags.add(tag));
        });
        const uniqueTagCount = allTags.size;

        if (options.format === 'json') {
          console.log(JSON.stringify({
            ...stats,
            observationCount,
            uniqueTagCount,
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
Tags Used:     ${uniqueTagCount}
`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  // ==================== Interactive Mode ====================
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
