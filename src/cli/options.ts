/**
 * CLI Global Options
 *
 * Shared options and context for all CLI commands.
 *
 * @module cli/options
 */

export interface GlobalOptions {
  storage: string;
  format: 'json' | 'table' | 'csv';
  quiet: boolean;
  verbose: boolean;
}

export const defaultOptions: GlobalOptions = {
  storage: process.env.MEMORYJS_STORAGE_PATH || './memory.jsonl',
  format: (process.env.MEMORYJS_OUTPUT_FORMAT as GlobalOptions['format']) || 'json',
  quiet: false,
  verbose: false,
};

/**
 * Parse and validate global options from commander.
 */
export function parseGlobalOptions(opts: Record<string, unknown>): GlobalOptions {
  // Global option is `-o, --output-format` (json|table|csv) — renamed
  // from `-f, --format` to avoid shadowing the `import`/`export`
  // subcommand `--format` flag (data format: graphml, turtle, json-ld,
  // etc.). Internal `GlobalOptions.format` field name kept for
  // backwards compatibility with the formatter consumers.
  const rawFormat = opts.outputFormat as string | undefined;
  const format: GlobalOptions['format'] =
    rawFormat && (['json', 'table', 'csv'] as const).includes(rawFormat as 'json' | 'table' | 'csv')
      ? (rawFormat as GlobalOptions['format'])
      : defaultOptions.format;

  return {
    storage: (opts.storage as string) || defaultOptions.storage,
    format,
    quiet: Boolean(opts.quiet),
    verbose: Boolean(opts.verbose),
  };
}

/**
 * Logging utilities that respect quiet/verbose flags.
 */
export function createLogger(options: GlobalOptions) {
  return {
    info: (msg: string) => !options.quiet && console.log(msg),
    debug: (msg: string) => options.verbose && console.log(`[DEBUG] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    warn: (msg: string) => !options.quiet && console.warn(`[WARN] ${msg}`),
  };
}
