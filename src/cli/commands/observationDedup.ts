/**
 * Observation-dedup CLI commands — `memory obs-dedup`.
 *
 * Thin wrapper around `ctx.observationDedupManager` for cross-entity
 * duplicate detection (exact and Jaccard).
 *
 * @module cli/commands/observationDedup
 */

import { Command } from '../parseArgs.js';
import { addJsonCommand } from './helpers.js';


interface DedupFilter {
  entityType?: string | string[];
  projectId?: string;
  sessionId?: string;
  minOccurrences?: number;
  maxGroups?: number;
}

/** Filter options shared by both obs-dedup subcommands, in declaration order. */
const DEDUP_FILTER_OPTIONS = [
  { flags: '--entity-type <type>', description: 'Filter to one entityType (or comma-separated list)' },
  { flags: '--project-id <id>', description: 'Filter to one projectId' },
  { flags: '--session-id <id>', description: 'Filter to one sessionId' },
  { flags: '--min-occurrences <n>', description: 'Minimum occurrences per group (≥2)', parse: (v: string) => parseInt(v, 10) },
  { flags: '--max-groups <n>', description: 'Maximum groups to return', parse: (v: string) => parseInt(v, 10) },
] as const;

function buildFilter(opts: Record<string, unknown>): DedupFilter {  const filter: DedupFilter = {};
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

/**
 * Register the `obs-dedup` command group for cross-entity duplicate observations.
 *
 * `find` reports exact duplicates. `find-jaccard` reports near-duplicates by Jaccard similarity.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerObservationDedupCommands(program: Command): void {
  const od = program
    .command('obs-dedup')
    .description('Cross-entity observation duplicate detection (exact and Jaccard similarity)');

  addJsonCommand<[Record<string, unknown>]>(od, program, {
    name: 'find',
    description: 'Find observations that appear verbatim across multiple entities',
    options: DEDUP_FILTER_OPTIONS,
    body: async (_options, ctx, opts) => {
      const filter = buildFilter(opts);
      const groups = await ctx.observationDedupManager.findDuplicateObservations(filter);
      return { filter, groups, count: groups.length };
    },
  });

  addJsonCommand<[Record<string, unknown>]>(od, program, {
    name: 'find-jaccard',
    description: 'Find near-duplicate observations across entities by Jaccard similarity',
    options: DEDUP_FILTER_OPTIONS,
    body: async (_options, ctx, opts) => {
      const filter = buildFilter(opts);
      const groups = await ctx.observationDedupManager.findJaccardDuplicates(filter);
      return { filter, groups, count: groups.length };
    },
  });
}
