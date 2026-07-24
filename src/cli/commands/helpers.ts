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

export { createLogger, type GlobalOptions };
