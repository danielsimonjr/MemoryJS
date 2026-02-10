/**
 * Agent Memory Configuration - env var and programmatic config for all agent memory components.
 * @module agent/AgentMemoryConfig
 */

import type { WorkingMemoryConfig } from './WorkingMemoryManager.js';
import type { SessionConfig } from './SessionManager.js';
import type { EpisodicMemoryConfig } from './EpisodicMemoryManager.js';
import type { ConsolidationPipelineConfig } from './ConsolidationPipeline.js';
import type { SummarizationConfig } from './SummarizationService.js';
import type { DecayEngineConfig } from './DecayEngine.js';
import type { DecaySchedulerConfig } from './DecayScheduler.js';
import type { SalienceEngineConfig } from './SalienceEngine.js';
import type { ContextWindowManagerConfig } from './ContextWindowManager.js';
import type { MemoryFormatterConfig } from './MemoryFormatter.js';
import type { MultiAgentConfig } from './MultiAgentMemoryManager.js';
import type { ConflictResolverConfig } from './ConflictResolver.js';

/** All sub-configurations are optional — defaults applied by each component. */
export interface AgentMemoryConfig {
  workingMemory?: WorkingMemoryConfig;
  session?: SessionConfig;
  episodic?: EpisodicMemoryConfig;
  consolidation?: ConsolidationPipelineConfig;
  summarization?: SummarizationConfig;
  decay?: DecayEngineConfig;
  decayScheduler?: DecaySchedulerConfig;
  salience?: SalienceEngineConfig;
  contextWindow?: ContextWindowManagerConfig;
  formatter?: MemoryFormatterConfig;
  multiAgent?: MultiAgentConfig;
  conflictResolver?: ConflictResolverConfig;
  enableAutoDecay?: boolean;
  enableMultiAgent?: boolean;
  defaultAgentId?: string;
}

const ENV_PREFIX = 'AGENT_MEMORY_';

/** Load configuration from AGENT_MEMORY_* environment variables. */
export function loadConfigFromEnv(): AgentMemoryConfig {
  return {
    workingMemory: {
      defaultTTLHours: getEnvNumber(`${ENV_PREFIX}DEFAULT_TTL_HOURS`),
      maxPerSession: getEnvNumber(`${ENV_PREFIX}MAX_PER_SESSION`),
      autoPromote: getEnvBool(`${ENV_PREFIX}AUTO_PROMOTE`),
      autoPromoteConfidenceThreshold: getEnvNumber(`${ENV_PREFIX}AUTO_PROMOTE_CONFIDENCE`),
    },
    session: {
      consolidateOnEnd: getEnvBool(`${ENV_PREFIX}SESSION_CONSOLIDATE_ON_END`),
      cleanupOnEnd: getEnvBool(`${ENV_PREFIX}SESSION_CLEANUP_ON_END`),
      promoteOnEnd: getEnvBool(`${ENV_PREFIX}SESSION_PROMOTE_ON_END`),
    },
    episodic: {
      autoLinkTemporal: getEnvBool(`${ENV_PREFIX}EPISODIC_AUTO_LINK_TEMPORAL`),
      maxSequenceLength: getEnvNumber(`${ENV_PREFIX}EPISODIC_MAX_SEQUENCE`),
    },
    consolidation: {
      summarizationEnabled: getEnvBool(`${ENV_PREFIX}CONSOLIDATION_SUMMARIZATION`),
      patternExtractionEnabled: getEnvBool(`${ENV_PREFIX}CONSOLIDATION_PATTERN_EXTRACTION`),
      minPromotionConfidence: getEnvNumber(`${ENV_PREFIX}CONSOLIDATION_MIN_CONFIDENCE`),
    },
    summarization: {
      provider: getEnvString(`${ENV_PREFIX}SUMMARIZATION_PROVIDER`),
      model: getEnvString(`${ENV_PREFIX}SUMMARIZATION_MODEL`),
    },
    decay: {
      halfLifeHours: getEnvNumber(`${ENV_PREFIX}DECAY_HALF_LIFE_HOURS`),
      minImportance: getEnvNumber(`${ENV_PREFIX}DECAY_MIN_IMPORTANCE`),
      importanceModulation: getEnvBool(`${ENV_PREFIX}DECAY_IMPORTANCE_MOD`),
      accessModulation: getEnvBool(`${ENV_PREFIX}DECAY_ACCESS_MOD`),
    },
    salience: {
      importanceWeight: getEnvNumber(`${ENV_PREFIX}SALIENCE_IMPORTANCE_WEIGHT`),
      recencyWeight: getEnvNumber(`${ENV_PREFIX}SALIENCE_RECENCY_WEIGHT`),
      frequencyWeight: getEnvNumber(`${ENV_PREFIX}SALIENCE_FREQUENCY_WEIGHT`),
      contextWeight: getEnvNumber(`${ENV_PREFIX}SALIENCE_CONTEXT_WEIGHT`),
      noveltyWeight: getEnvNumber(`${ENV_PREFIX}SALIENCE_NOVELTY_WEIGHT`),
    },
    contextWindow: {
      defaultMaxTokens: getEnvNumber(`${ENV_PREFIX}CONTEXT_MAX_TOKENS`),
      tokenMultiplier: getEnvNumber(`${ENV_PREFIX}CONTEXT_TOKEN_MULTIPLIER`),
      reserveBuffer: getEnvNumber(`${ENV_PREFIX}CONTEXT_RESERVE_BUFFER`),
      diversityThreshold: getEnvNumber(`${ENV_PREFIX}CONTEXT_DIVERSITY_THRESHOLD`),
      enforceDiversity: getEnvBool(`${ENV_PREFIX}CONTEXT_ENFORCE_DIVERSITY`),
    },
    formatter: {
      includeTimestamps: getEnvBool(`${ENV_PREFIX}FORMAT_TIMESTAMPS`),
      includeMemoryType: getEnvBool(`${ENV_PREFIX}FORMAT_MEMORY_TYPE`),
    },
    multiAgent: {
      defaultAgentId: getEnvString(`${ENV_PREFIX}MULTI_AGENT_DEFAULT_AGENT_ID`),
      defaultVisibility: getEnvString(`${ENV_PREFIX}MULTI_AGENT_DEFAULT_VISIBILITY`) as
        | 'private'
        | 'shared'
        | 'public'
        | undefined,
    },
    conflictResolver: {
      similarityThreshold: getEnvNumber(`${ENV_PREFIX}CONFLICT_SIMILARITY_THRESHOLD`),
      defaultStrategy: getEnvString(`${ENV_PREFIX}CONFLICT_DEFAULT_STRATEGY`) as
        | 'most_recent'
        | 'highest_confidence'
        | 'most_confirmations'
        | 'trusted_agent'
        | 'merge_all'
        | undefined,
      detectNegations: getEnvBool(`${ENV_PREFIX}CONFLICT_DETECT_NEGATIONS`),
    },
    enableAutoDecay: getEnvBool(`${ENV_PREFIX}ENABLE_AUTO_DECAY`),
    enableMultiAgent: getEnvBool(`${ENV_PREFIX}ENABLE_MULTI_AGENT`),
    defaultAgentId: getEnvString(`${ENV_PREFIX}DEFAULT_AGENT_ID`),
  };
}

/** Merge user config with env config, removing undefined values. */
export function mergeConfig(
  userConfig: AgentMemoryConfig,
  envConfig: AgentMemoryConfig
): AgentMemoryConfig {
  return {
    workingMemory: mergeSubConfig(userConfig.workingMemory, envConfig.workingMemory),
    session: mergeSubConfig(userConfig.session, envConfig.session),
    episodic: mergeSubConfig(userConfig.episodic, envConfig.episodic),
    consolidation: mergeSubConfig(userConfig.consolidation, envConfig.consolidation),
    summarization: mergeSubConfig(userConfig.summarization, envConfig.summarization),
    decay: mergeSubConfig(userConfig.decay, envConfig.decay),
    decayScheduler: mergeSubConfig(userConfig.decayScheduler, envConfig.decayScheduler),
    salience: mergeSubConfig(userConfig.salience, envConfig.salience),
    contextWindow: mergeSubConfig(userConfig.contextWindow, envConfig.contextWindow),
    formatter: mergeSubConfig(userConfig.formatter, envConfig.formatter),
    multiAgent: mergeSubConfig(userConfig.multiAgent, envConfig.multiAgent),
    conflictResolver: mergeSubConfig(userConfig.conflictResolver, envConfig.conflictResolver),
    enableAutoDecay: userConfig.enableAutoDecay ?? envConfig.enableAutoDecay,
    enableMultiAgent: userConfig.enableMultiAgent ?? envConfig.enableMultiAgent,
    defaultAgentId: userConfig.defaultAgentId ?? envConfig.defaultAgentId,
  };
}

/** Validate configuration values. Throws on invalid ranges. */
export function validateConfig(config: AgentMemoryConfig): void {
  // Validate decay settings
  if (config.decay?.halfLifeHours !== undefined && config.decay.halfLifeHours <= 0) {
    throw new Error('decay.halfLifeHours must be positive');
  }
  if (
    config.decay?.minImportance !== undefined &&
    (config.decay.minImportance < 0 || config.decay.minImportance > 10)
  ) {
    throw new Error('decay.minImportance must be between 0 and 10');
  }

  // Validate salience weights
  const salienceWeights = [
    config.salience?.importanceWeight,
    config.salience?.recencyWeight,
    config.salience?.frequencyWeight,
    config.salience?.contextWeight,
    config.salience?.noveltyWeight,
  ].filter((w) => w !== undefined);

  if (salienceWeights.some((w) => w! < 0 || w! > 1)) {
    throw new Error('Salience weights must be between 0 and 1');
  }

  // Validate context window
  if (
    config.contextWindow?.defaultMaxTokens !== undefined &&
    config.contextWindow.defaultMaxTokens <= 0
  ) {
    throw new Error('contextWindow.defaultMaxTokens must be positive');
  }

  // Validate conflict resolver
  if (
    config.conflictResolver?.similarityThreshold !== undefined &&
    (config.conflictResolver.similarityThreshold < 0 ||
      config.conflictResolver.similarityThreshold > 1)
  ) {
    throw new Error('conflictResolver.similarityThreshold must be between 0 and 1');
  }
}

// ==================== Helper Functions ====================

function getEnvNumber(key: string): number | undefined {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}

function getEnvBool(key: string): boolean | undefined {
  const value = process.env[key];
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true';
}

function getEnvString(key: string): string | undefined {
  return process.env[key];
}

function mergeSubConfig<T extends object>(
  user: T | undefined,
  env: T | undefined
): T | undefined {
  if (!user && !env) return undefined;
  if (!user) return removeUndefined(env!) as T;
  if (!env) return user;

  const envClean = removeUndefined(env);
  return { ...envClean, ...user };
}

function removeUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
