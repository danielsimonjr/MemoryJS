/**
 * Graph Algorithm CLI Commands
 *
 * @module cli/commands/graph
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatPath, formatCentrality, formatComponents, formatError } from '../formatters.js';

export function registerGraphCommands(program: Command): void {
  const graph = program
    .command('graph')
    .description('Graph algorithms (shortest path, centrality, components)');

  graph
    .command('shortest-path <from> <to>')
    .description('Find shortest path between two entities')
    .action(async (from: string, to: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.graphTraversal.findShortestPath(from, to);
        if (!result) {
          logger.error(formatError(`No path found between "${from}" and "${to}"`));
          process.exit(1);
        }
        console.log(formatPath(result, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  graph
    .command('centrality')
    .description('Calculate centrality metrics')
    .option('-a, --algo <algorithm>', 'Algorithm: degree, betweenness, pagerank', 'degree')
    .option('--top <n>', 'Number of top entities', parseInt, 10)
    .option('-d, --direction <dir>', 'Direction for degree: in, out, both', 'both')
    .option('--damping <n>', 'Damping factor for PageRank', parseFloat, 0.85)
    .action(async (opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
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

        console.log(formatCentrality(result, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  graph
    .command('components')
    .description('Find connected components')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.graphTraversal.findConnectedComponents();
        console.log(formatComponents(result, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
