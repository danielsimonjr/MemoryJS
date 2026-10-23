/**
 * Spell CLI commands — `memory spell`.
 *
 * Thin wrapper around `ctx.spellChecker` for vocabulary management
 * and suggestion lookup.
 *
 * @module cli/commands/spell
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';


function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

/**
 * Register the `spell` command group: `suggest`, `rebuild` and `size`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerSpellCommands(program: Command): void {
  const sp = program
    .command('spell')
    .description('Spell-suggest queries against the graph vocabulary');

  sp.command('suggest <query>')
    .description('Suggest corrections for a (possibly misspelled) query')
    .option('-l, --limit <n>', 'Max suggestions to return', (v) => parseInt(v, 10))
    .option('-s, --min-score <n>', 'Minimum match score 0–1', parseFloat)
    .option('-d, --max-distance <n>', 'Maximum Levenshtein distance', parseFloat)
    .action(runAction(program, async (ctx, _options, _logger, query: string, opts: Record<string, unknown>) => {
      const suggestions = await ctx.spellChecker.suggest(query, {
        limit: opts.limit as number | undefined,
        minScore: opts.minScore as number | undefined,
        maxDistance: opts.maxDistance as number | undefined,
      });
      emitJson({ query, suggestions, count: suggestions.length });
    }));

  sp.command('rebuild')
    .description('Rebuild the spell-checker vocabulary index from the graph')
    .action(runAction(program, async (ctx, _options, _logger) => {
      await ctx.spellChecker.rebuild();
      emitJson({ rebuilt: true, vocabularySize: ctx.spellChecker.vocabularySize() });
    }));

  sp.command('size')
    .description('Print the current vocabulary size')
    .action(runAction(program, async (ctx, _options, _logger) => {
      emitJson({ vocabularySize: ctx.spellChecker.vocabularySize() });
    }));
}
