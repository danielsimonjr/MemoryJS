/**
 * Role Profiles
 *
 * Pre-built salience weight and context-window budget configurations
 * for common agent roles. Each profile is a named set of overrides that
 * can be attached to an agent at registration time.
 *
 * @module agent/RoleProfiles
 */

import type { SalienceEngineConfig } from './SalienceEngine.js';
import type { ContextWindowManagerConfig } from './ContextWindowManager.js';
import type { AgentType } from '../types/agent-memory.js';

// ==================== Core Types ====================

/**
 * Role identifier for built-in agent profiles.
 */
export type AgentRole =
  | 'planner'
  | 'executor'
  | 'researcher'
  | 'reviewer'
  | 'default';

/**
 * A role profile encapsulates salience weight overrides and context window
 * budget percentages optimised for a specific agent role.
 *
 * @example
 * ```typescript
 * const profile = getRoleProfile('researcher');
 * const engine = new SalienceEngine(storage, accessTracker, decayEngine, profile.salienceConfig);
 * const cwm = new ContextWindowManager(storage, engine, profile.contextConfig);
 * ```
 */
export interface RoleProfile {
  /** Unique role identifier */
  role: AgentRole;
  /** Human-readable label */
  label: string;
  /** Salience engine weight overrides for this role */
  salienceConfig: SalienceEngineConfig;
  /** Context window budget overrides for this role */
  contextConfig: ContextWindowManagerConfig;
}

// ==================== Built-in Profile Definitions ====================

/**
 * Planner profile: emphasises importance and context relevance.
 * Plans are high-importance, context-sensitive decisions.
 */
const plannerProfile: RoleProfile = {
  role: 'planner',
  label: 'Planner',
  salienceConfig: {
    importanceWeight: 0.35,
    recencyWeight: 0.15,
    frequencyWeight: 0.1,
    contextWeight: 0.3,
    noveltyWeight: 0.1,
  },
  contextConfig: {
    workingBudgetPct: 0.25,
    episodicBudgetPct: 0.25,
    semanticBudgetPct: 0.5,
  },
};

/**
 * Executor profile: emphasises recency and working memory.
 * Executors focus on the current task and short-term context.
 */
const executorProfile: RoleProfile = {
  role: 'executor',
  label: 'Executor',
  salienceConfig: {
    importanceWeight: 0.2,
    recencyWeight: 0.4,
    frequencyWeight: 0.2,
    contextWeight: 0.1,
    noveltyWeight: 0.1,
  },
  contextConfig: {
    workingBudgetPct: 0.5,
    episodicBudgetPct: 0.3,
    semanticBudgetPct: 0.2,
  },
};

/**
 * Researcher profile: emphasises novelty and semantic knowledge.
 * Researchers need broad knowledge and value new information.
 */
const researcherProfile: RoleProfile = {
  role: 'researcher',
  label: 'Researcher',
  salienceConfig: {
    importanceWeight: 0.2,
    recencyWeight: 0.1,
    frequencyWeight: 0.15,
    contextWeight: 0.2,
    noveltyWeight: 0.35,
  },
  contextConfig: {
    workingBudgetPct: 0.2,
    episodicBudgetPct: 0.2,
    semanticBudgetPct: 0.6,
  },
};

/**
 * Reviewer profile: emphasises frequency (seen before) and importance.
 * Reviewers check quality and care about what has been accessed often.
 */
const reviewerProfile: RoleProfile = {
  role: 'reviewer',
  label: 'Reviewer',
  salienceConfig: {
    importanceWeight: 0.3,
    recencyWeight: 0.2,
    frequencyWeight: 0.3,
    contextWeight: 0.15,
    noveltyWeight: 0.05,
  },
  contextConfig: {
    workingBudgetPct: 0.2,
    episodicBudgetPct: 0.4,
    semanticBudgetPct: 0.4,
  },
};

/**
 * Default profile: balanced weights matching the engine defaults.
 */
const defaultProfile: RoleProfile = {
  role: 'default',
  label: 'Default',
  salienceConfig: {
    importanceWeight: 0.25,
    recencyWeight: 0.25,
    frequencyWeight: 0.2,
    contextWeight: 0.2,
    noveltyWeight: 0.1,
  },
  contextConfig: {
    workingBudgetPct: 0.3,
    episodicBudgetPct: 0.3,
    semanticBudgetPct: 0.4,
  },
};

// ==================== Profile Registry ====================

const PROFILES: Record<AgentRole, RoleProfile> = {
  planner: plannerProfile,
  executor: executorProfile,
  researcher: researcherProfile,
  reviewer: reviewerProfile,
  default: defaultProfile,
};

// ==================== Public API ====================

/**
 * Get a built-in role profile by role name.
 *
 * @param role - Role identifier
 * @returns The matching RoleProfile
 *
 * @example
 * ```typescript
 * const profile = getRoleProfile('planner');
 * console.log(profile.salienceConfig.importanceWeight); // 0.35
 * ```
 */
export function getRoleProfile(role: AgentRole): RoleProfile {
  return PROFILES[role];
}

/**
 * List all built-in role profiles.
 *
 * @returns Array of all role profiles
 */
export function listRoleProfiles(): RoleProfile[] {
  return Object.values(PROFILES);
}

/**
 * Resolve a role profile from an AgentType.
 *
 * Maps AgentType values to the closest matching AgentRole:
 * - 'llm'    → 'researcher' (broad knowledge emphasis)
 * - 'tool'   → 'executor' (task execution focus)
 * - 'human'  → 'reviewer' (review and verification focus)
 * - 'system' → 'planner' (strategic planning focus)
 * - 'default'→ 'default' (balanced)
 *
 * @param agentType - AgentType to resolve
 * @returns The matching RoleProfile
 */
export function resolveRoleProfile(agentType: AgentType): RoleProfile {
  const mapping: Record<AgentType, AgentRole> = {
    llm: 'researcher',
    tool: 'executor',
    human: 'reviewer',
    system: 'planner',
    default: 'default',
  };
  const role = mapping[agentType] ?? 'default';
  return PROFILES[role];
}

/**
 * Create a custom role profile by merging overrides onto a base profile.
 *
 * @param base - Base role to start from
 * @param overrides - Partial overrides for salience and context configs
 * @returns A new RoleProfile (not registered in the built-in registry)
 *
 * @example
 * ```typescript
 * const custom = createCustomProfile('researcher', {
 *   salienceConfig: { noveltyWeight: 0.5 },
 * });
 * ```
 */
export function createCustomProfile(
  base: AgentRole,
  overrides: {
    label?: string;
    salienceConfig?: Partial<SalienceEngineConfig>;
    contextConfig?: Partial<ContextWindowManagerConfig>;
  }
): RoleProfile {
  const baseProfile = PROFILES[base];
  return {
    role: base,
    label: overrides.label ?? `Custom (${baseProfile.label})`,
    salienceConfig: {
      ...baseProfile.salienceConfig,
      ...overrides.salienceConfig,
    },
    contextConfig: {
      ...baseProfile.contextConfig,
      ...overrides.contextConfig,
    },
  };
}
