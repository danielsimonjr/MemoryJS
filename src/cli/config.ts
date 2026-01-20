/**
 * CLI Configuration File Support
 *
 * Load configuration from .memoryjsrc or memoryjs.config.json.
 *
 * @module cli/config
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import type { GlobalOptions } from './options.js';

const CONFIG_FILES = [
  '.memoryjsrc',
  '.memoryjsrc.json',
  'memoryjs.config.json',
];

/**
 * Search for config file starting from cwd and moving up.
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;
  const root = resolve('/');

  while (currentDir !== root) {
    for (const filename of CONFIG_FILES) {
      const configPath = resolve(currentDir, filename);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }

  return null;
}

/**
 * Load configuration from file.
 */
export function loadConfig(configPath: string): Partial<GlobalOptions> {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    return validateConfig(config);
  } catch (error) {
    console.warn(`Warning: Failed to load config from ${configPath}`);
    return {};
  }
}

/**
 * Validate and sanitize config values.
 */
function validateConfig(config: Record<string, unknown>): Partial<GlobalOptions> {
  const validated: Partial<GlobalOptions> = {};

  if (typeof config.storage === 'string') {
    validated.storage = config.storage;
  }

  if (config.format && ['json', 'table', 'csv'].includes(config.format as string)) {
    validated.format = config.format as GlobalOptions['format'];
  }

  if (typeof config.quiet === 'boolean') {
    validated.quiet = config.quiet;
  }

  if (typeof config.verbose === 'boolean') {
    validated.verbose = config.verbose;
  }

  return validated;
}

/**
 * Merge config file with CLI options. CLI takes precedence.
 */
export function mergeConfig(
  fileConfig: Partial<GlobalOptions>,
  cliOptions: Partial<GlobalOptions>
): GlobalOptions {
  return {
    storage: cliOptions.storage ?? fileConfig.storage ?? './memory.jsonl',
    format: cliOptions.format ?? fileConfig.format ?? 'json',
    quiet: cliOptions.quiet ?? fileConfig.quiet ?? false,
    verbose: cliOptions.verbose ?? fileConfig.verbose ?? false,
  };
}
