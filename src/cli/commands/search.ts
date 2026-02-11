/**
 * Search CLI Commands
 *
 * Fixed: uses autoSearch with real relevance scores instead of fake scoring.
 * Extended: --ranked, --boolean, --fuzzy, --suggest modes.
 *
 * @module cli/commands/search
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSearchResults, formatError } from '../formatters.js';
import type { Entity } from '../../types/types.js';

export function registerSearchCommands(program: Command): void {
  program
    .command('search <query>')
    .description('Search entities and observations')
    .option('-l, --limit <n>', 'Limit results', parseInt, 10)
    .option('-t, --type <type>', 'Filter by entity type')
    .option('--ranked', 'Use TF-IDF/BM25 ranked search')
    .option('--boolean', 'Use boolean search (AND/OR/NOT)')
    .option('--fuzzy', 'Use fuzzy search')
    .option('--threshold <n>', 'Fuzzy search threshold (0-1)', parseFloat, 0.6)
    .option('--suggest', 'Get search suggestions instead of results')
    .action(async (query: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const limit = (opts.limit as number) || 10;

        // Search suggestions mode
        if (opts.suggest) {
          const suggestions = await ctx.searchManager.getSearchSuggestions(query);
          if (options.format === 'json') {
            console.log(JSON.stringify(suggestions, null, 2));
          } else {
            console.log('Search suggestions:');
            for (const s of suggestions) {
              console.log(`  ${s}`);
            }
          }
          return;
        }

        let results: Array<{ entity: Entity; score: number }>;

        if (opts.ranked) {
          logger.debug('Using ranked search');
          results = await ctx.searchManager.searchNodesRanked(query, undefined, undefined, undefined, limit);
        } else if (opts.boolean) {
          logger.debug('Using boolean search');
          const boolResult = await ctx.searchManager.booleanSearch(query);
          results = boolResult.entities.map((entity: Entity, idx: number) => ({
            entity,
            score: 1.0 - idx * 0.01,
          }));
        } else if (opts.fuzzy) {
          logger.debug('Using fuzzy search');
          const fuzzyResult = await ctx.searchManager.fuzzySearch(query, opts.threshold as number);
          results = fuzzyResult.entities.map((entity: Entity, idx: number) => ({
            entity,
            score: 1.0 - idx * 0.01,
          }));
        } else {
          // Default: autoSearch with real relevance scores
          logger.debug('Using auto search');
          const autoResult = await ctx.searchManager.autoSearch(query, limit);
          results = autoResult.results;
          logger.debug(`Search method: ${autoResult.selectedMethod} (${autoResult.selectionReason})`);
        }

        // Apply type filter
        if (opts.type) {
          results = results.filter(r => r.entity.entityType === opts.type);
        }

        // Apply limit
        results = results.slice(0, limit);

        console.log(formatSearchResults(results, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
