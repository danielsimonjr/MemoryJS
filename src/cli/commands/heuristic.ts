/**
 * Heuristic CLI commands — `memory heuristic` (Phase 3B.8).
 *
 * Thin wrapper around `ctx.heuristicManager` for guideline CRUD,
 * matching, reinforcement, and conflict detection.
 *
 * @module cli/commands/heuristic
 */

import { Command } from 'commander';
import { runAction, getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

/**
 * Register the `heuristic` command group: `add`, `list`, `count`, `get`, `match`, `reinforce`, `contradict`, `conflicts`, `remove` and `clear`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerHeuristicCommands(program: Command): void {
  const h = program
    .command('heuristic')
    .description('Manage condition→action heuristic guidelines (add, match, reinforce, conflicts)');

  h.command('add <condition> <action>')
    .description('Add a heuristic guideline. Returns the assigned id.')
    .option('-p, --priority <n>', 'Priority (numeric; higher wins ties)', parseFloat)
    .option('-c, --confidence <n>', 'Initial confidence 0–1', parseFloat)
    .option('-i, --importance <n>', 'Importance 0–10', parseFloat)
    .option('-a, --agent-id <id>', 'Owning agent ID')
    .action(runAction(program, async (ctx, _options, _logger, condition: string, action: string, opts: Record<string, unknown>) => {
      const id = await ctx.heuristicManager.add({
        condition,
        action,
        priority: opts.priority as number | undefined,
        initialConfidence: opts.confidence as number | undefined,
        importance: opts.importance as number | undefined,
        agentId: opts.agentId as string | undefined,
      });
      emitJson({ id });
    }));

  h.command('list')
    .description('List all heuristics')
    .action(runAction(program, async (ctx, _options, _logger) => {
      const heuristics = await ctx.heuristicManager.list();
      emitJson({ heuristics, count: heuristics.length });
    }));

  h.command('count')
    .description('Print the current heuristic count')
    .action(runAction(program, async (ctx, _options, _logger) => {
      const count = await ctx.heuristicManager.size();
      emitJson({ count });
    }));

  h.command('get <id>')
    .description('Get a heuristic by id')
    .action(runAction(program, async (ctx, _options, _logger, id: string) => {
      await ctx.storage.ensureLoaded();
      const heuristic = ctx.heuristicManager.get(id);
      emitJson({ id, heuristic: heuristic ?? null });
    }));

  h.command('match <input...>')
    .description('Match heuristics whose condition fits the given input')
    .option('-l, --limit <n>', 'Max matches to return', (v) => parseInt(v, 10))
    .option('-s, --min-score <n>', 'Minimum match score 0–1', parseFloat)
    .action(async (inputParts: string[], opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      const input = inputParts.join(' ');
      try {
        const matches = await ctx.heuristicManager.match(input, {
          limit: opts.limit as number | undefined,
          minScore: opts.minScore as number | undefined,
        });
        emitJson({ input, matches, count: matches.length });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('reinforce <id>')
    .description('Reinforce a heuristic (bump confidence toward 1)')
    .action(runAction(program, async (ctx, _options, _logger, id: string) => {
      const result = await ctx.heuristicManager.reinforce(id);
      emitJson({ id, result });
    }));

  h.command('contradict <id>')
    .description('Record a contradiction (decreases confidence)')
    .action(runAction(program, async (ctx, _options, _logger, id: string) => {
      const result = await ctx.heuristicManager.recordContradiction(id);
      emitJson({ id, result });
    }));

  h.command('conflicts')
    .description('Detect heuristics with conflicting actions for similar conditions')
    .action(runAction(program, async (ctx, _options, _logger) => {
      const conflicts = await ctx.heuristicManager.detectConflicts();
      emitJson({ conflicts, count: conflicts.length });
    }));

  h.command('remove <id>')
    .description('Remove a heuristic by id')
    .action(runAction(program, async (ctx, _options, _logger, id: string) => {
      await ctx.storage.ensureLoaded();
      const removed = await ctx.heuristicManager.remove(id);
      emitJson({ id, removed });
    }));

  h.command('clear')
    .description('Remove all heuristics. Destructive; no --dry-run yet.')
    .action(runAction(program, async (ctx, _options, _logger) => {
      await ctx.heuristicManager.clear();
      emitJson({ cleared: true });
    }));
}
