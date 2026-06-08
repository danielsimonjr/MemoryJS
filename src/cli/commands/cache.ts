/**
 * Cache CLI commands — `memory cache`.
 *
 *   memory cache stats     Snapshot of search-cache hit/miss/size per tier.
 *   memory cache clear     Bust all search caches; useful after a manual
 *                          graph edit when stale results show up.
 *
 * Caches inspected here are the global per-tier search caches
 * (`basic` / `ranked` / `boolean` / `fuzzy`) exported from
 * `utils/searchCache.ts`. Per-cache TTL cleanup is also exposed.
 *
 * @module cli/commands/cache
 */

import { Command } from 'commander';
import { clearAllSearchCaches, cleanupAllCaches, getAllCacheStats } from '../../utils/searchCache.js';
import { getOptions, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function registerCacheCommands(program: Command): void {
  const cache = program
    .command('cache')
    .description('Inspect or bust the per-tier search caches (basic / ranked / boolean / fuzzy)');

  cache
    .command('stats')
    .description('Per-cache hits/misses/size/hitRate snapshot. Stats are process-local — fresh CLI invocations start at zero.')
    .action(() => {
      try {
        const stats = getAllCacheStats();
        emitJson({ stats });
      } catch (error) {
        const logger = createLogger(getOptions(program));
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  cache
    .command('clear')
    .description('Clear all four search caches. Idempotent; safe to call any time.')
    .action(() => {
      try {
        clearAllSearchCaches();
        emitJson({ cleared: true, caches: ['basic', 'ranked', 'boolean', 'fuzzy'] });
      } catch (error) {
        const logger = createLogger(getOptions(program));
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  cache
    .command('cleanup')
    .description('Sweep expired entries (TTL) across all caches without dropping live entries.')
    .action(() => {
      try {
        cleanupAllCaches();
        emitJson({ cleaned: true, caches: ['basic', 'ranked', 'boolean', 'fuzzy'] });
      } catch (error) {
        const logger = createLogger(getOptions(program));
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
