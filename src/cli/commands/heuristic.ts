/**
 * Heuristic CLI commands — `memory heuristic` (Phase 3B.8).
 *
 * Thin wrapper around `ctx.heuristicManager` for guideline CRUD,
 * matching, reinforcement, and conflict detection.
 *
 * @module cli/commands/heuristic
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

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
    .action(async (condition: string, action: string, opts: Record<string, unknown>) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const id = await ctx.heuristicManager.add({
          condition,
          action,
          priority: opts.priority as number | undefined,
          initialConfidence: opts.confidence as number | undefined,
          importance: opts.importance as number | undefined,
          agentId: opts.agentId as string | undefined,
        });
        emitJson({ id });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('list')
    .description('List all heuristics')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const heuristics = await ctx.heuristicManager.list();
        emitJson({ heuristics, count: heuristics.length });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('count')
    .description('Print the current heuristic count')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const count = await ctx.heuristicManager.size();
        emitJson({ count });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('get <id>')
    .description('Get a heuristic by id')
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const heuristic = ctx.heuristicManager.get(id);
        emitJson({ id, heuristic: heuristic ?? null });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

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
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const result = await ctx.heuristicManager.reinforce(id);
        emitJson({ id, result });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('contradict <id>')
    .description('Record a contradiction (decreases confidence)')
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const result = await ctx.heuristicManager.recordContradiction(id);
        emitJson({ id, result });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('conflicts')
    .description('Detect heuristics with conflicting actions for similar conditions')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const conflicts = await ctx.heuristicManager.detectConflicts();
        emitJson({ conflicts, count: conflicts.length });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('remove <id>')
    .description('Remove a heuristic by id')
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const removed = await ctx.heuristicManager.remove(id);
        emitJson({ id, removed });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  h.command('clear')
    .description('Remove all heuristics. Destructive; no --dry-run yet.')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        await ctx.heuristicManager.clear();
        emitJson({ cleared: true });
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
