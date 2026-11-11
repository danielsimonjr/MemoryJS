/**
 * Heuristic CLI commands — `memory heuristic` (Phase 3B.8).
 *
 * Thin wrapper around `ctx.heuristicManager` for guideline CRUD,
 * matching, reinforcement, and conflict detection.
 *
 * @module cli/commands/heuristic
 */

import { Command } from '../parseArgs.js';
import { getOptions, createContext, createLogger, addJsonCommand, emitJson } from './helpers.js';
import { formatError } from '../formatters.js';

/** Options shared by the heuristic subcommands that emit JSON. */
const PRIORITY_OPTION = { flags: '-p, --priority <n>', description: 'Priority (numeric; higher wins ties)', parse: parseFloat } as const;
const CONFIDENCE_OPTION = { flags: '-c, --confidence <n>', description: 'Initial confidence 0–1', parse: parseFloat } as const;
const IMPORTANCE_OPTION = { flags: '-i, --importance <n>', description: 'Importance 0–10', parse: parseFloat } as const;
const AGENT_ID_OPTION = { flags: '-a, --agent-id <id>', description: 'Owning agent ID' } as const;

/**
 * Register the `heuristic` command group: `add`, `list`, `count`, `get`, `match`, `reinforce`, `contradict`, `conflicts`, `remove` and `clear`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerHeuristicCommands(program: Command): void {
  const h = program
    .command('heuristic')
    .description('Manage condition→action heuristic guidelines (add, match, reinforce, conflicts)');

  addJsonCommand<[string, string]>(h, program, {
    name: 'add <condition> <action>',
    description: 'Add a heuristic guideline. Returns the assigned id.',
    options: [PRIORITY_OPTION, CONFIDENCE_OPTION, IMPORTANCE_OPTION, AGENT_ID_OPTION],
    body: async (_options, ctx, condition, action, opts) => {
      const id = await ctx.heuristicManager.add({
        condition,
        action,
        priority: opts.priority as number | undefined,
        initialConfidence: opts.confidence as number | undefined,
        importance: opts.importance as number | undefined,
        agentId: opts.agentId as string | undefined,
      });
      return { id };
    },
  });

  addJsonCommand(h, program, {
    name: 'list',
    description: 'List all heuristics',
    options: [],
    body: async (_options, ctx) => {
      const heuristics = await ctx.heuristicManager.list();
      return { heuristics, count: heuristics.length };
    },
  });

  addJsonCommand(h, program, {
    name: 'count',
    description: 'Print the current heuristic count',
    options: [],
    body: async (_options, ctx) => {
      const count = await ctx.heuristicManager.size();
      return { count };
    },
  });

  addJsonCommand<[string]>(h, program, {
    name: 'get <id>',
    description: 'Get a heuristic by id',
    options: [],
    body: async (_options, ctx, id) => {
      await ctx.storage.ensureLoaded();
      const heuristic = ctx.heuristicManager.get(id);
      return { id, heuristic: heuristic ?? null };
    },
  });

  // `match` keeps its manual try/catch: it is the one heuristic action that does not use
  // `runAction` (its error path logs through the logger and exits 1 directly).
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

  addJsonCommand<[string]>(h, program, {
    name: 'reinforce <id>',
    description: 'Reinforce a heuristic (bump confidence toward 1)',
    options: [],
    body: async (_options, ctx, id) => {
      const result = await ctx.heuristicManager.reinforce(id);
      return { id, result };
    },
  });

  addJsonCommand<[string]>(h, program, {
    name: 'contradict <id>',
    description: 'Record a contradiction (decreases confidence)',
    options: [],
    body: async (_options, ctx, id) => {
      const result = await ctx.heuristicManager.recordContradiction(id);
      return { id, result };
    },
  });

  addJsonCommand(h, program, {
    name: 'conflicts',
    description: 'Detect heuristics with conflicting actions for similar conditions',
    options: [],
    body: async (_options, ctx) => {
      const conflicts = await ctx.heuristicManager.detectConflicts();
      return { conflicts, count: conflicts.length };
    },
  });

  addJsonCommand<[string]>(h, program, {
    name: 'remove <id>',
    description: 'Remove a heuristic by id',
    options: [],
    body: async (_options, ctx, id) => {
      await ctx.storage.ensureLoaded();
      const removed = await ctx.heuristicManager.remove(id);
      return { id, removed };
    },
  });

  addJsonCommand(h, program, {
    name: 'clear',
    description: 'Remove all heuristics. Destructive; no --dry-run yet.',
    options: [],
    body: async (_options, ctx) => {
      await ctx.heuristicManager.clear();
      return { cleared: true };
    },
  });
}
