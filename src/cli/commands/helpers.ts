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
import { findConfigFile, loadConfig, mergeCliConfig } from '../config.js';
import { formatError } from '../formatters.js';

/**
 * Get merged options from config file and CLI.
 */
export function getOptions(program: Command): GlobalOptions {
  const cliOpts = program.opts();
  const configPath = findConfigFile();
  const fileConfig = configPath ? loadConfig(configPath) : {};
  return mergeCliConfig(fileConfig, parseGlobalOptions(cliOpts));
}

/**
 * Create a ManagerContext with the specified storage path.
 */
export function createContext(options: GlobalOptions): ManagerContext {
  return new ManagerContext(options.storage);
}

/**
 * Create a command action that runs a handler body in a shared error frame.
 *
 * The action reads the options, creates the logger and creates the context before the try block.
 * An error in one of these steps rejects the action.
 * The action does not log that error and does not exit.
 * The body receives the context, the options, the logger and then the command arguments.
 * If the body throws, the action logs the error message through formatError.
 * Then the action calls process.exit with code 1.
 *
 * @param program - The Commander program that holds the global options.
 * @param body - The async command logic.
 * @returns The action listener. The listener takes the command arguments, without the context, options and logger.
 */
export function runAction<A extends unknown[]>(
  program: Command,
  body: (
    ctx: ManagerContext,
    options: GlobalOptions,
    logger: ReturnType<typeof createLogger>,
    ...args: A
  ) => Promise<void>
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    const options = getOptions(program);
    const logger = createLogger(options);
    const ctx = createContext(options);
    try {
      await body(ctx, options, logger, ...args);
    } catch (error) {
      logger.error(formatError((error as Error).message));
      process.exit(1);
    }
  };
}

export { createLogger, type GlobalOptions };
