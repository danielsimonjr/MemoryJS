/**
 * Tool Affordance CLI Commands — `memory tool-affordance` (Phase Tool D).
 *
 * Read-only — record happens via the observer API (ToolCallObserver
 * or MCPToolObserverAdapter), not the CLI.
 *
 * @module cli/commands/toolAffordance
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

export function registerToolAffordanceCommands(program: Command): void {
  const ta = program
    .command('tool-affordance')
    .description('Inspect per-tool rolling outcome statistics');

  ta
    .command('list')
    .description('List all tools with affordance records')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const recs = await ctx.toolAffordanceManager.list();
        if (recs.length === 0) {
          logger.info('(no tool-affordance records)');
          return;
        }
        for (const r of recs) {
          const pct = (r.successRate * 100).toFixed(1);
          logger.info(`${r.toolName} | success=${pct}% | calls=${r.totalCalls} | window=${r.outcomes.length}`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  ta
    .command('show <toolName>')
    .description('Show the full record for a single tool')
    .action(async (toolName: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const rec = ctx.toolAffordanceManager.get(toolName);
        if (!rec) {
          logger.info(`(no affordance record for '${toolName}')`);
          return;
        }
        logger.info(JSON.stringify(rec, null, 2));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  ta
    .command('stats <toolName>')
    .description('Show flat stats: success_rate / total_calls / common_failure_modes / avg_duration_ms')
    .action(async (toolName: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const stats = ctx.toolAffordanceManager.rollingStats(toolName);
        if (!stats) {
          logger.info(`(no affordance record for '${toolName}')`);
          return;
        }
        logger.info(JSON.stringify(stats, null, 2));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  ta
    .command('suggest <hint>')
    .description('Suggest tools matching a task hint, ranked by success rate × recency')
    .option('--limit <n>', 'Maximum suggestions to return', '5')
    .action(async (hint: string, opts: { limit?: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const parsedLimit = opts.limit ? Number(opts.limit) : 5;
        const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.trunc(parsedLimit) : 5;
        const suggestions = await ctx.toolAffordanceManager.suggestTool(hint, { limit });
        if (suggestions.length === 0) {
          logger.info(`(no tools matching '${hint}')`);
          return;
        }
        for (const s of suggestions) {
          logger.info(`${s.toolName} | score=${s.score.toFixed(3)}`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
