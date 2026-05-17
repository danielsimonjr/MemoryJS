/**
 * Observation-dedup CLI commands — `memory obs-dedup`.
 *
 * Thin wrapper around `ctx.observationDedupManager` for cross-entity
 * duplicate detection (exact and Jaccard).
 *
 * @module cli/commands/observationDedup
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

interface DedupFilter {
  entityType?: string | string[];
  projectId?: string;
  sessionId?: string;
  minOccurrences?: number;
  maxGroups?: number;
}

function buildFilter(opts: Record<string, unknown>): DedupFilter {
  const filter: DedupFilter = {};
  const entityType = opts.entityType as string | undefined;
  if (entityType) {
    filter.entityType = entityType.includes(',')
      ? entityType.split(',').map((s) => s.trim()).filter(Boolean)
      : entityType;
  }
  if (typeof opts.projectId === 'string') filter.projectId = opts.projectId;
  if (typeof opts.sessionId === 'string') filter.sessionId = opts.sessionId;
  if (typeof opts.minOccurrences === 'number' && opts.minOccurrences >= 2) {
    filter.minOccurrences = opts.minOccurrences;
  }
  if (typeof opts.maxGroups === 'number' && opts.maxGroups > 0) {
    filter.maxGroups = opts.maxGroups;
  }
  return filter;
}

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function registerObservationDedupCommands(program: Command): void {
  const od = program
    .command('obs-dedup')
    .description('Cross-entity observation duplicate detection (exact and Jaccard similarity)');

  od.command('find')
    .description('Find observations that appear verbatim across multiple entities')
    .option('--entity-type <type>', 'Filter to one entityType (or comma-separated list)')
    .option('--project-id <id>', 'Filter to one projectId')
    .option('--session-id <id>', 'Filter to one sessionId')
    .option('--min-occurrences <n>', 'Minimum occurrences per group (≥2)', (v) => parseInt(v, 10))
    .option('--max-groups <n>', 'Maximum groups to return', (v) => parseInt(v, 10))
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const filter = buildFilter(opts);
        const groups = await ctx.observationDedupManager.findDuplicateObservations(filter);
        emitJson({ filter, groups, count: groups.length });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  od.command('find-jaccard')
    .description('Find near-duplicate observations across entities by Jaccard similarity')
    .option('--entity-type <type>', 'Filter to one entityType (or comma-separated list)')
    .option('--project-id <id>', 'Filter to one projectId')
    .option('--session-id <id>', 'Filter to one sessionId')
    .option('--min-occurrences <n>', 'Minimum occurrences per group (≥2)', (v) => parseInt(v, 10))
    .option('--max-groups <n>', 'Maximum groups to return', (v) => parseInt(v, 10))
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const filter = buildFilter(opts);
        const groups = await ctx.observationDedupManager.findJaccardDuplicates(filter);
        emitJson({ filter, groups, count: groups.length });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
