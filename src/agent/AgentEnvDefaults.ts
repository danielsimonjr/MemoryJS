/**
 * Environment-derived defaults for agent-memory components.
 *
 * Each reader returns the value used when the caller's config does not set the
 * field. Code-supplied config always wins. Readers run when the owning getter
 * first builds its component, so a change to the environment after that point
 * is not seen by the built instance.
 *
 * @module agent/AgentEnvDefaults
 * @internal
 */

import { readEnvLooseFlag, readEnvNumber, type EnvNumberBounds } from '../utils/envConfig.js';
import { logger } from '../utils/logger.js';
import type { EntropyFilterConfig } from './EntropyFilter.js';
import type { WorkingMemoryConfig } from './WorkingMemoryManager.js';
import type { MultiAgentConfig } from './MultiAgentMemoryManager.js';
import type { MemoryVisibility } from '../types/agent-memory.js';

/**
 * `name=value` pairs already warned about in this process. Each component
 * construction re-reads the env, so without this an invalid value would log
 * once per instance.
 */
const warnedKeys = new Set<string>();

function isValidNumber(raw: string, bounds: EnvNumberBounds): boolean {
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return false;
  if (bounds.integer && !Number.isInteger(n)) return false;
  if (bounds.min !== undefined && n < bounds.min) return false;
  return bounds.max === undefined || n <= bounds.max;
}

/** `readEnvNumber`, but an invalid value is warned about once per process. */
function readNumberWarnOnce(name: string, defaultValue: number, bounds: EnvNumberBounds): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '' || isValidNumber(raw, bounds)) {
    return readEnvNumber(name, defaultValue, bounds);
  }
  const key = `${name}=${raw}`;
  if (warnedKeys.has(key)) return defaultValue;
  warnedKeys.add(key);
  return readEnvNumber(name, defaultValue, bounds);
}

/** Default entropy threshold in bits, matching `EntropyFilterStage`. */
export const DEFAULT_ENTROPY_THRESHOLD_BITS = 1.5;

/** Default cognitive-load threshold, matching `CognitiveLoadAnalyzer`. */
export const DEFAULT_COGNITIVE_LOAD_MAX = 0.7;

const VISIBILITY_VALUES: readonly MemoryVisibility[] = ['private', 'team', 'org', 'shared', 'public'];

/**
 * `WorkingMemoryConfig.entropyFilter` from `MEMORY_ENTROPY_FILTER_ENABLED` (loose
 * flag) and `MEMORY_ENTROPY_THRESHOLD` (bits, >= 0). Returns `undefined` when the
 * filter is disabled, so no gate is applied.
 */
export function readEntropyFilterFromEnv(): EntropyFilterConfig | undefined {
  if (!readEnvLooseFlag('MEMORY_ENTROPY_FILTER_ENABLED', false)) return undefined;
  return {
    minEntropy: readNumberWarnOnce('MEMORY_ENTROPY_THRESHOLD', DEFAULT_ENTROPY_THRESHOLD_BITS, { min: 0 }),
  };
}

/**
 * `MultiAgentConfig.defaultVisibility` from `MEMORY_DEFAULT_VISIBILITY`. Returns
 * `undefined` when unset or invalid, so the manager falls back to `'private'`.
 */
export function readDefaultVisibilityFromEnv(): MemoryVisibility | undefined {
  const raw = process.env['MEMORY_DEFAULT_VISIBILITY'];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim().toLowerCase() as MemoryVisibility;
  if (VISIBILITY_VALUES.includes(value)) return value;
  const key = `MEMORY_DEFAULT_VISIBILITY=${raw}`;
  if (warnedKeys.has(key)) return undefined;
  warnedKeys.add(key);
  logger.warn(
    `MEMORY_DEFAULT_VISIBILITY='${raw}' is not one of ${VISIBILITY_VALUES.join('|')}; using private`,
  );
  return undefined;
}

/**
 * `CognitiveLoadConfig.loadThreshold` from `MEMORY_COGNITIVE_LOAD_MAX` (0-1).
 */
export function readCognitiveLoadMaxFromEnv(): number {
  return readNumberWarnOnce('MEMORY_COGNITIVE_LOAD_MAX', DEFAULT_COGNITIVE_LOAD_MAX, { min: 0, max: 1 });
}

/**
 * Whether the consolidation scheduler is enabled. `MEMORY_CONSOLIDATION_SCHEDULER_ENABLED`
 * and the original `MEMORY_AUTO_CONSOLIDATION` are aliases; either one set to `true` enables it.
 */
export function readConsolidationSchedulerEnabled(): boolean {
  return (
    readEnvLooseFlag('MEMORY_AUTO_CONSOLIDATION', false) ||
    readEnvLooseFlag('MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', false)
  );
}

/** `config` with `entropyFilter` filled from the env when the caller left it unset. */
export function withEnvWorkingMemory(config?: WorkingMemoryConfig): WorkingMemoryConfig {
  return { ...config, entropyFilter: config?.entropyFilter ?? readEntropyFilterFromEnv() };
}

/** `config` with `defaultVisibility` filled from the env when the caller left it unset. */
export function withEnvMultiAgent(config?: MultiAgentConfig): MultiAgentConfig {
  return { ...config, defaultVisibility: config?.defaultVisibility ?? readDefaultVisibilityFromEnv() };
}
