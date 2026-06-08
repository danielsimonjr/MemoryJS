/**
 * Reindex CLI command — `memory reindex`.
 *
 * Rebuilds the search-side indexes that get out of sync if the graph
 * file is mutated outside the running process (manual edit, restore from
 * backup, etc.). Two indexes are reachable from `ManagerContext`:
 *
 *   - TF-IDF / BM25 ranked search index (via `rankedSearch.buildIndex`)
 *   - Spell-checker vocabulary (via `spellChecker.rebuild`)
 *
 * Other indexes (N-gram, Bloom pre-screener) are private to their
 * consumers and rebuild on first use, so they don't need a manual hook.
 *
 * Each rebuild is timed and the result emitted as JSON for piping.
 *
 * @module cli/commands/reindex
 */

import { Command } from 'commander';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RankedSearch } from '../../search/RankedSearch.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function registerReindexCommand(program: Command): void {
  program
    .command('reindex')
    .description('Rebuild search-side indexes (TF-IDF/BM25 ranked + spell vocabulary).')
    .option('--ranked', 'Rebuild only the ranked-search (TF-IDF/BM25) index')
    .option('--spell', 'Rebuild only the spell-checker vocabulary')
    .action(async (opts: { ranked?: boolean; spell?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      const targets = opts.ranked === true || opts.spell === true
        ? { ranked: Boolean(opts.ranked), spell: Boolean(opts.spell) }
        : { ranked: true, spell: true };

      const result: Record<string, { ok: boolean; durationMs: number; detail?: string }> = {};

      if (targets.ranked) {
        const t = performance.now();
        try {
          // ctx.rankedSearch is constructed without a storageDir, so its
          // indexManager is undefined and buildIndex() refuses to run. We
          // construct an ad-hoc instance with the graph file's directory so
          // the rebuild persists alongside the JSONL on disk.
          const storageDir = dirname(options.storage);
          const ranked = new RankedSearch(ctx.storage as GraphStorage, storageDir);
          await ranked.buildIndex();
          result.ranked = { ok: true, durationMs: performance.now() - t };
        } catch (e) {
          result.ranked = {
            ok: false,
            durationMs: performance.now() - t,
            detail: e instanceof Error ? e.message : String(e),
          };
        }
      }

      if (targets.spell) {
        const t = performance.now();
        try {
          await ctx.spellChecker.rebuild();
          result.spell = { ok: true, durationMs: performance.now() - t };
        } catch (e) {
          result.spell = {
            ok: false,
            durationMs: performance.now() - t,
            detail: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const failed = Object.values(result).filter((r) => !r.ok).length;
      emitJson({ ok: failed === 0, failed, result });
      if (failed > 0) {
        logger.error(formatError(`${failed} index(es) failed to rebuild`));
        process.exit(1);
      }
    });
}
