/**
 * Graph Algorithm CLI Commands
 *
 * @module cli/commands/graph
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatPath, formatCentrality, formatComponents, formatError } from '../formatters.js';

/**
 * Register the `graph` command group: `shortest-path`, `centrality` and `components`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerGraphCommands(program: Command): void {
  const graph = program
    .command('graph')
    .description('Graph algorithms (shortest path, centrality, components)');

  graph
    .command('shortest-path <from> <to>')
    .description('Find shortest path between two entities')
    .action(runAction(program, async (ctx, options, logger, from: string, to: string) => {
      const result = await ctx.graphTraversal.findShortestPath(from, to);
      if (!result) {
        logger.error(formatError(`No path found between "${from}" and "${to}"`));
        process.exit(1);
      }
      logger.log(formatPath(result, options.format));
    }));

  graph
    .command('centrality')
    .description('Calculate centrality metrics')
    .option('-a, --algo <algorithm>', 'Algorithm: degree, betweenness, pagerank', 'degree')
    .option('--top <n>', 'Number of top entities', parseInt, 10)
    .option('-d, --direction <dir>', 'Direction for degree: in, out, both', 'both')
    .option('--damping <n>', 'Damping factor for PageRank', parseFloat, 0.85)
    .action(runAction(program, async (ctx, options, logger, opts: Record<string, unknown>) => {
      const algo = (opts.algo as string) || 'degree';
      const topN = (opts.top as number) || 10;
      let result;

      switch (algo) {
        case 'degree':
          result = await ctx.graphTraversal.calculateDegreeCentrality(
            opts.direction as 'in' | 'out' | 'both',
            topN
          );
          break;
        case 'betweenness':
          result = await ctx.graphTraversal.calculateBetweennessCentrality({ topN });
          break;
        case 'pagerank':
          result = await ctx.graphTraversal.calculatePageRank(
            opts.damping as number,
            100,
            1e-6,
            topN
          );
          break;
        default:
          logger.error(formatError(`Unknown algorithm: ${algo}. Use degree, betweenness, or pagerank.`));
          process.exit(1);
      }

      logger.log(formatCentrality(result, options.format));
    }));

  graph
    .command('components')
    .description('Find connected components')
    .action(runAction(program, async (ctx, options, logger) => {
      const result = await ctx.graphTraversal.findConnectedComponents();
      logger.log(formatComponents(result, options.format));
    }));
}
