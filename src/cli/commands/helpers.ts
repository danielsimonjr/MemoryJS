/**
 * CLI Command Helpers
 *
 * Shared utilities for all command files.
 *
 * @module cli/commands/helpers
 */

import { Command } from 'commander';
import { ManagerContext } from '../../core/ManagerContext.js';
import { parseGlobalOptions, createLogger, type GlobalOptions } from '../options.js';
import { findConfigFile, loadConfig, mergeConfig } from '../config.js';
import { formatError } from '../formatters.js';

/**
 * Get merged options from config file and CLI.
 */
export function getOptions(program: Command): GlobalOptions {
  const cliOpts = program.opts();
  const configPath = findConfigFile();
  const fileConfig = configPath ? loadConfig(configPath) : {};
  return mergeConfig(fileConfig, parseGlobalOptions(cliOpts));
}

/**
 * Create a ManagerContext with the specified storage path.
 */
export function createContext(options: GlobalOptions): ManagerContext {
  return new ManagerContext(options.storage);
}

/**
 * Wrap a command action with standard error handling.
 */
export function withErrorHandling(
  program: Command,
  fn: (options: GlobalOptions, ctx: ManagerContext, logger: ReturnType<typeof createLogger>) => Promise<void>
): () => Promise<void> {
  return async () => {
    const options = getOptions(program);
    const logger = createLogger(options);
    const ctx = createContext(options);
    try {
      await fn(options, ctx, logger);
    } catch (error) {
      logger.error(formatError((error as Error).message));
      process.exit(1);
    }
  };
}

export { createLogger, type GlobalOptions };
