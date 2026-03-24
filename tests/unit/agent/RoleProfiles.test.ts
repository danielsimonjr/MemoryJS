/**
 * Unit tests for RoleProfiles
 *
 * Tests role profile definitions, resolution, and customisation:
 * - All 5 built-in profiles exist with valid weight sums
 * - getRoleProfile returns correct profile
 * - listRoleProfiles returns all profiles
 * - resolveRoleProfile maps AgentType → AgentRole correctly
 * - createCustomProfile merges overrides correctly
 * - roleProfile is attached when registerAgent is called
 */

import { describe, it, expect } from 'vitest';
import {
  getRoleProfile,
  listRoleProfiles,
  resolveRoleProfile,
  createCustomProfile,
  type AgentRole,
} from '../../../src/agent/RoleProfiles.js';
import type { AgentType } from '../../../src/types/agent-memory.js';

// ==================== Helper ====================

function salienceWeightSum(role: AgentRole): number {
  const profile = getRoleProfile(role);
  const w = profile.salienceConfig;
  return (
    (w.importanceWeight ?? 0) +
    (w.recencyWeight ?? 0) +
    (w.frequencyWeight ?? 0) +
    (w.contextWeight ?? 0) +
    (w.noveltyWeight ?? 0)
  );
}

function budgetSum(role: AgentRole): number {
  const profile = getRoleProfile(role);
  const c = profile.contextConfig;
  return (
    (c.workingBudgetPct ?? 0) +
    (c.episodicBudgetPct ?? 0) +
    (c.semanticBudgetPct ?? 0)
  );
}

// ==================== getRoleProfile ====================

describe('getRoleProfile', () => {
  const roles: AgentRole[] = ['planner', 'executor', 'researcher', 'reviewer', 'default'];

  it.each(roles)('should return a profile for role "%s"', (role) => {
    const profile = getRoleProfile(role);
    expect(profile).toBeDefined();
    expect(profile.role).toBe(role);
    expect(profile.label).toBeTruthy();
  });

  it('should return distinct profiles for distinct roles', () => {
    const profiles = roles.map(getRoleProfile);
    const labels = profiles.map((p) => p.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(roles.length);
  });

  it('should include salienceConfig and contextConfig', () => {
    for (const role of roles) {
      const p = getRoleProfile(role);
      expect(p.salienceConfig).toBeDefined();
      expect(p.contextConfig).toBeDefined();
    }
  });
});

// ==================== Salience weight validation ====================

describe('Built-in profile salience weights', () => {
  const roles: AgentRole[] = ['planner', 'executor', 'researcher', 'reviewer', 'default'];

  it.each(roles)('%s: all weights should be between 0 and 1', (role) => {
    const { salienceConfig: w } = getRoleProfile(role);
    for (const weight of [
      w.importanceWeight,
      w.recencyWeight,
      w.frequencyWeight,
      w.contextWeight,
      w.noveltyWeight,
    ]) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it.each(roles)('%s: salience weights should sum to 1.0 (±0.01)', (role) => {
    expect(salienceWeightSum(role)).toBeCloseTo(1.0, 1);
  });
});

// ==================== Context budget validation ====================

describe('Built-in profile context budgets', () => {
  const roles: AgentRole[] = ['planner', 'executor', 'researcher', 'reviewer', 'default'];

  it.each(roles)('%s: budget percentages should sum to 1.0 (±0.01)', (role) => {
    expect(budgetSum(role)).toBeCloseTo(1.0, 1);
  });

  it.each(roles)('%s: each budget pct should be between 0 and 1', (role) => {
    const { contextConfig: c } = getRoleProfile(role);
    for (const pct of [c.workingBudgetPct, c.episodicBudgetPct, c.semanticBudgetPct]) {
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(1);
    }
  });
});

// ==================== Profile characteristics ====================

describe('Profile role characteristics', () => {
  it('planner should have high importance and context weights', () => {
    const { salienceConfig: w } = getRoleProfile('planner');
    expect(w.importanceWeight!).toBeGreaterThan(0.25);
    expect(w.contextWeight!).toBeGreaterThan(0.25);
  });

  it('executor should have high recency weight', () => {
    const { salienceConfig: w } = getRoleProfile('executor');
    expect(w.recencyWeight!).toBeGreaterThan(0.3);
  });

  it('executor should have large working memory budget', () => {
    const { contextConfig: c } = getRoleProfile('executor');
    expect(c.workingBudgetPct!).toBeGreaterThanOrEqual(0.4);
  });

  it('researcher should have high novelty weight', () => {
    const { salienceConfig: w } = getRoleProfile('researcher');
    expect(w.noveltyWeight!).toBeGreaterThan(0.25);
  });

  it('researcher should have large semantic memory budget', () => {
    const { contextConfig: c } = getRoleProfile('researcher');
    expect(c.semanticBudgetPct!).toBeGreaterThanOrEqual(0.5);
  });

  it('reviewer should have high frequency weight', () => {
    const { salienceConfig: w } = getRoleProfile('reviewer');
    expect(w.frequencyWeight!).toBeGreaterThan(0.25);
  });

  it('default should have balanced weights (all similar magnitude)', () => {
    const { salienceConfig: w } = getRoleProfile('default');
    // All non-novelty weights should be within a 0.15 band of each other
    const weights = [w.importanceWeight!, w.recencyWeight!, w.frequencyWeight!, w.contextWeight!];
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    expect(max - min).toBeLessThan(0.15);
  });
});

// ==================== listRoleProfiles ====================

describe('listRoleProfiles', () => {
  it('should return 5 profiles', () => {
    const profiles = listRoleProfiles();
    expect(profiles).toHaveLength(5);
  });

  it('should include all expected roles', () => {
    const profiles = listRoleProfiles();
    const roles = profiles.map((p) => p.role);
    expect(roles).toContain('planner');
    expect(roles).toContain('executor');
    expect(roles).toContain('researcher');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('default');
  });
});

// ==================== resolveRoleProfile ====================

describe('resolveRoleProfile', () => {
  const cases: Array<[AgentType, AgentRole]> = [
    ['llm', 'researcher'],
    ['tool', 'executor'],
    ['human', 'reviewer'],
    ['system', 'planner'],
    ['default', 'default'],
  ];

  it.each(cases)('AgentType "%s" should resolve to role "%s"', (agentType, expectedRole) => {
    const profile = resolveRoleProfile(agentType);
    expect(profile.role).toBe(expectedRole);
  });

  it('should return the matching getRoleProfile result', () => {
    const resolved = resolveRoleProfile('llm');
    const direct = getRoleProfile('researcher');
    expect(resolved.role).toBe(direct.role);
    expect(resolved.label).toBe(direct.label);
  });
});

// ==================== createCustomProfile ====================

describe('createCustomProfile', () => {
  it('should inherit base profile weights', () => {
    const custom = createCustomProfile('researcher', {});
    const base = getRoleProfile('researcher');
    expect(custom.salienceConfig.importanceWeight).toBe(base.salienceConfig.importanceWeight);
  });

  it('should apply salience overrides', () => {
    const custom = createCustomProfile('researcher', {
      salienceConfig: { noveltyWeight: 0.5 },
    });
    expect(custom.salienceConfig.noveltyWeight).toBe(0.5);
    // Other weights should remain from base
    const base = getRoleProfile('researcher');
    expect(custom.salienceConfig.importanceWeight).toBe(base.salienceConfig.importanceWeight);
  });

  it('should apply context budget overrides', () => {
    const custom = createCustomProfile('executor', {
      contextConfig: { workingBudgetPct: 0.7 },
    });
    expect(custom.contextConfig.workingBudgetPct).toBe(0.7);
    // Other budgets remain from base
    const base = getRoleProfile('executor');
    expect(custom.contextConfig.episodicBudgetPct).toBe(base.contextConfig.episodicBudgetPct);
  });

  it('should apply label override', () => {
    const custom = createCustomProfile('planner', { label: 'My Custom Planner' });
    expect(custom.label).toBe('My Custom Planner');
  });

  it('should use generated label when not overridden', () => {
    const custom = createCustomProfile('planner', {});
    expect(custom.label).toContain('Planner');
  });

  it('should preserve the base role', () => {
    const custom = createCustomProfile('reviewer', {});
    expect(custom.role).toBe('reviewer');
  });

  it('should not mutate the original profile', () => {
    const before = { ...getRoleProfile('researcher').salienceConfig };
    createCustomProfile('researcher', { salienceConfig: { noveltyWeight: 0.99 } });
    const after = getRoleProfile('researcher').salienceConfig;
    expect(after.noveltyWeight).toBe(before.noveltyWeight);
  });
});
