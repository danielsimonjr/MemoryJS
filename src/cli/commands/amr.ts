/**
 * `memory amr` CLI group: the Agent Memory Repo (AMR) commands `context`, `check`, `export`,
 * `import` and `commit`.
 *
 * Each action prints one JSON object. `export` and `import` are dry runs unless `--apply` is given.
 * An action exits 1 only when its exit rule says so: `check` when it finds an issue, `export` when a
 * file is refused or the write fails, `import` when an entity fails, and `commit` when the commit is
 * refused. An exit rule sets `process.exitCode`; it does not call `process.exit`, which can drop the
 * queued output on a POSIX pipe. Bad flag values throw a `ValidationError`, which `runAction` reports
 * with exit 1.
 *
 * The `context` budgets have no upper cap here: the CLI serves a person. `AmrToolAdapter` caps them at
 * `AMR_READER_DEFAULTS`.
 *
 * The AMR modules confine every read and write to the root. This group adds no path rule.
 *
 * @module cli/commands/amr
 * @experimental
 */

import path from 'node:path';
import { Command } from '../parseArgs.js';
import { runAction, emitJson } from './helpers.js';
import { ValidationError } from '../../utils/errors.js';
import { loadAmrContext, checkAmr, type AmrReaderOptions } from '../../features/amr/AmrReader.js';
import { exportAmr, importAmr, type AmrSyncMode, type AmrSyncOptions } from '../../features/amr/AmrSync.js';
import { GitRunner } from '../../features/amr/GitRunner.js';
import { commitAmrEdits, AMR_COMMIT_MESSAGE_MAX_CHARS } from '../../features/amr/AmrWriter.js';

/** Raw Commander option values. A flag holds `true`; a value option holds its text. */
type RawOptions = Record<string, unknown>;

/**
 * Read a text option.
 * @param value - Raw option value.
 * @returns The text, or undefined when the option is absent.
 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parse a positive integer option.
 * @param raw - Raw option text.
 * @param flag - Flag name, for the message.
 * @returns The number, or undefined when the option is absent.
 * @throws ValidationError when the text is not a positive safe integer.
 */
function positiveInt(raw: unknown, flag: string): number | undefined {
  const text = textOf(raw);
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(n)) {
    throw new ValidationError(`${flag} must be a positive integer`, [flag]);
  }
  return n;
}

/**
 * Set exit code 1 and let the process end when its output is written. `process.exit` can drop queued
 * stdout on a POSIX pipe, so a large report would be cut.
 */
function exitWithFailure(): void {
  process.exitCode = 1;
}

/**
 * Parse the `--mode` option.
 * @param raw - Raw option text.
 * @returns The mode, or undefined when the option is absent.
 * @throws ValidationError when the mode is not `add-only` or `reconcile`.
 */
function syncMode(raw: unknown): AmrSyncMode | undefined {
  const text = textOf(raw);
  if (text === undefined) return undefined;
  if (text === 'add-only' || text === 'reconcile') return text;
  throw new ValidationError('--mode must be add-only or reconcile', ['mode']);
}

/**
 * Parse the `--types` option, a comma-separated list.
 * @param raw - Raw option text.
 * @returns The types, or undefined when the option is absent.
 */
function typeList(raw: unknown): string[] | undefined {
  const text = textOf(raw);
  if (text === undefined) return undefined;
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/**
 * Build the reader budget from the `context` options. Only the given budgets are set.
 * @param opts - Raw options of `context`.
 * @returns The reader options that were given.
 * @throws ValidationError when a budget is not a positive integer.
 */
function budgetOf(opts: RawOptions): Partial<AmrReaderOptions> {
  const budget: Partial<AmrReaderOptions> = {};
  const maxFiles = positiveInt(opts.maxFiles, '--max-files');
  const maxTotalBytes = positiveInt(opts.maxTotalBytes, '--max-total-bytes');
  const maxDepth = positiveInt(opts.maxDepth, '--max-depth');
  if (maxFiles !== undefined) budget.maxFiles = maxFiles;
  if (maxTotalBytes !== undefined) budget.maxTotalBytes = maxTotalBytes;
  if (maxDepth !== undefined) budget.maxDepth = maxDepth;
  return budget;
}

/**
 * Register the `amr` command group.
 *
 * @param program - The root Commander program that receives the commands.
 * @returns Nothing. The commands are added to the program.
 */
export function registerAmrCommands(program: Command): void {
  const amr = program
    .command('amr')
    .description('Agent Memory Repo: read, check, export, import and commit memory files');

  amr
    .command('context <root>')
    .description('Print the bounded AMR context block of a memory root. Read-only. No upper cap on the budgets (the tool adapter caps them at the reader defaults).')
    .option('--max-files <n>', 'Largest number of files to read (positive integer)')
    .option('--max-total-bytes <n>', 'Largest total bytes to read (positive integer)')
    .option('--max-depth <n>', 'Deepest folder level to read (positive integer)')
    .action(
      runAction(program, async (_ctx, _options, _logger, root: string, opts: RawOptions) => {
        emitJson(await loadAmrContext(path.resolve(root), budgetOf(opts)));
      }),
    );

  amr
    .command('check <root>')
    .description('Check a memory root: links, metadata, case duplicates and secrets. Exit 1 on any issue.')
    .action(
      runAction(program, async (_ctx, _options, _logger, root: string) => {
        const report = await checkAmr(path.resolve(root));
        emitJson(report);
        if (report.issues.length > 0) exitWithFailure();
      }),
    );

  amr
    .command('export <root>')
    .description('Export graph entities to the memory root. Dry run unless --apply is given.')
    .option('--apply', 'Write the files and commit them in one commit')
    .option('--types <a,b>', 'Export only these entity types (comma separated)')
    .option('--namespace <ns>', 'Namespace prefix of the exported files')
    .option('--mode <mode>', 'add-only (default) or reconcile')
    .action(
      runAction(program, async (ctx, _options, _logger, root: string, opts: RawOptions) => {
        const abs = path.resolve(root);
        const apply = opts.apply === true;
        const graph = await ctx.storage.loadGraph();
        const syncOpts: AmrSyncOptions = { dryRun: !apply };
        if (apply) syncOpts.runner = new GitRunner(abs);
        const types = typeList(opts.types);
        if (types !== undefined) syncOpts.types = types;
        const namespace = textOf(opts.namespace);
        if (namespace !== undefined) syncOpts.namespace = namespace;
        const mode = syncMode(opts.mode);
        if (mode !== undefined) syncOpts.mode = mode;
        // The whole graph goes in. The `types` option is the only filter.
        const report = await exportAmr([...graph.entities], [...graph.relations], abs, syncOpts);
        emitJson(report);
        if (report.writeError !== undefined || report.files.some((f) => f.action === 'refused')) exitWithFailure();
      }),
    );

  amr
    .command('import <root>')
    .description('Import memory files into the graph. Dry run unless --apply is given.')
    .option('--apply', 'Apply the changes to the graph')
    .option('--namespace <ns>', 'Namespace prefix of the imported files')
    .option('--mode <mode>', 'add-only (default) or reconcile')
    .action(
      runAction(program, async (ctx, _options, _logger, root: string, opts: RawOptions) => {
        const mode = syncMode(opts.mode);
        const namespace = textOf(opts.namespace);
        const report = await importAmr(ctx, path.resolve(root), {
          dryRun: opts.apply !== true,
          ...(mode !== undefined ? { mode } : {}),
          ...(namespace !== undefined ? { namespace } : {}),
        });
        emitJson(report);
        if (report.entities.some((e) => e.action === 'error')) exitWithFailure();
      }),
    );

  amr
    .command('commit <root>')
    .description('Commit the hand edits of a memory root in one commit. Exit 1 when the commit is refused.')
    .option('--message <m>', `Commit message (required, at most ${AMR_COMMIT_MESSAGE_MAX_CHARS} characters)`)
    .action(
      runAction(program, async (_ctx, _options, _logger, root: string, opts: RawOptions) => {
        const message = textOf(opts.message);
        if (message === undefined || message.trim() === '') {
          throw new ValidationError('--message is required', ['message']);
        }
        if (message.length > AMR_COMMIT_MESSAGE_MAX_CHARS) {
          throw new ValidationError(`--message must be at most ${AMR_COMMIT_MESSAGE_MAX_CHARS} characters`, ['message']);
        }
        const abs = path.resolve(root);
        const result = await commitAmrEdits(abs, { runner: new GitRunner(abs), message });
        emitJson(result);
        if (!result.ok) exitWithFailure();
      }),
    );
}
