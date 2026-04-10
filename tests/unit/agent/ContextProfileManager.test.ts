/**
 * ContextProfileManager Unit Tests
 *
 * Tests for named context profiles that tune retrieval strategy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ContextProfileManager,
  type ContextProfile,
  type ProfileConfig,
} from '../../../src/agent/ContextProfileManager.js';
import { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { SalienceContext } from '../../../src/types/agent-memory.js';

/**
 * Create a mock storage.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  const graph = { entities, relations };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find(e => e.name === name)),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(undefined),
    getGraphForMutation: vi.fn().mockResolvedValue(graph),
  } as unknown as IGraphStorage;
}

describe('ContextProfileManager', () => {
  let manager: ContextProfileManager;

  beforeEach(() => {
    manager = new ContextProfileManager();
  });

  // ==================== Preset Profiles ====================

  describe('preset profiles', () => {
    it('should return default profile with balanced weights', () => {
      const profile = manager.getProfile('default');

      expect(profile.salienceWeights.importanceWeight).toBe(0.25);
      expect(profile.salienceWeights.recencyWeight).toBe(0.25);
      expect(profile.salienceWeights.frequencyWeight).toBe(0.20);
      expect(profile.salienceWeights.contextWeight).toBe(0.20);
      expect(profile.salienceWeights.noveltyWeight).toBe(0.10);
      expect(profile.temporalFocus).toBe('balanced');
      expect(profile.budgetAllocation).toEqual({ working: 34, episodic: 33, semantic: 33 });
    });

    it('should return planning profile with high importance and context', () => {
      const profile = manager.getProfile('planning');

      expect(profile.salienceWeights.importanceWeight).toBe(0.35);
      expect(profile.salienceWeights.contextWeight).toBe(0.30);
      expect(profile.salienceWeights.recencyWeight).toBe(0.10);
      expect(profile.salienceWeights.frequencyWeight).toBe(0.15);
      expect(profile.salienceWeights.noveltyWeight).toBe(0.10);
      expect(profile.temporalFocus).toBe('historical');
      expect(profile.budgetAllocation).toEqual({ working: 20, episodic: 30, semantic: 50 });
      expect(profile.preferredEntityTypes).toEqual(['concept', 'project', 'architecture']);
    });

    it('should return incident profile with high recency and importance', () => {
      const profile = manager.getProfile('incident');

      expect(profile.salienceWeights.recencyWeight).toBe(0.40);
      expect(profile.salienceWeights.importanceWeight).toBe(0.30);
      expect(profile.salienceWeights.noveltyWeight).toBe(0.05);
      expect(profile.salienceWeights.contextWeight).toBe(0.15);
      expect(profile.salienceWeights.frequencyWeight).toBe(0.10);
      expect(profile.temporalFocus).toBe('recent');
      expect(profile.budgetAllocation).toEqual({ working: 50, episodic: 30, semantic: 20 });
    });

    it('should return handoff profile with high recency and context', () => {
      const profile = manager.getProfile('handoff');

      expect(profile.salienceWeights.recencyWeight).toBe(0.35);
      expect(profile.salienceWeights.contextWeight).toBe(0.25);
      expect(profile.salienceWeights.importanceWeight).toBe(0.20);
      expect(profile.salienceWeights.frequencyWeight).toBe(0.10);
      expect(profile.salienceWeights.noveltyWeight).toBe(0.10);
      expect(profile.temporalFocus).toBe('recent');
      expect(profile.budgetAllocation).toEqual({ working: 40, episodic: 40, semantic: 20 });
    });

    it('should return review profile with high context weight', () => {
      const profile = manager.getProfile('review');

      expect(profile.salienceWeights.contextWeight).toBe(0.30);
      expect(profile.salienceWeights.importanceWeight).toBe(0.25);
      expect(profile.salienceWeights.recencyWeight).toBe(0.15);
      expect(profile.salienceWeights.frequencyWeight).toBe(0.15);
      expect(profile.salienceWeights.noveltyWeight).toBe(0.15);
      expect(profile.temporalFocus).toBe('balanced');
      expect(profile.budgetAllocation).toEqual({ working: 20, episodic: 50, semantic: 30 });
    });

    it('should have weights summing to 1.0 for all preset profiles', () => {
      const profileNames: ContextProfile[] = ['default', 'planning', 'incident', 'handoff', 'review'];

      for (const name of profileNames) {
        const profile = manager.getProfile(name);
        const sum =
          profile.salienceWeights.importanceWeight +
          profile.salienceWeights.recencyWeight +
          profile.salienceWeights.frequencyWeight +
          profile.salienceWeights.contextWeight +
          profile.salienceWeights.noveltyWeight;

        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it('should resolve auto profile to default when getting by name', () => {
      const autoProfile = manager.getProfile('auto');
      const defaultProfile = manager.getProfile('default');

      expect(autoProfile).toEqual(defaultProfile);
    });
  });

  // ==================== Profile Inference ====================

  describe('inferProfile', () => {
    it('should detect incident queries', () => {
      expect(manager.inferProfile("There's an outage in production")).toBe('incident');
      expect(manager.inferProfile('sev1 incident reported')).toBe('incident');
      expect(manager.inferProfile('The service is broken')).toBe('incident');
      expect(manager.inferProfile('Site is down')).toBe('incident');
      expect(manager.inferProfile('Emergency deployment needed')).toBe('incident');
      expect(manager.inferProfile('Critical alert triggered')).toBe('incident');
      expect(manager.inferProfile('On-call page received')).toBe('incident');
    });

    it('should detect planning queries', () => {
      expect(manager.inferProfile("Let's plan the architecture")).toBe('planning');
      expect(manager.inferProfile('Design the new API')).toBe('planning');
      expect(manager.inferProfile('Roadmap for Q2')).toBe('planning');
      expect(manager.inferProfile('Strategy meeting notes')).toBe('planning');
      expect(manager.inferProfile('New proposal for auth system')).toBe('planning');
    });

    it('should detect handoff queries', () => {
      expect(manager.inferProfile('Where did we left off?')).toBe('handoff');
      expect(manager.inferProfile("Let's pick up where we left off")).toBe('handoff');
      expect(manager.inferProfile('Can you hand off to the next agent?')).toBe('handoff');
      expect(manager.inferProfile('I need to catch up on progress')).toBe('handoff');
      expect(manager.inferProfile('Resume the previous task')).toBe('handoff');
      expect(manager.inferProfile('Continue from yesterday')).toBe('handoff');
    });

    it('should detect review queries', () => {
      expect(manager.inferProfile("Let's review what happened")).toBe('review');
      expect(manager.inferProfile('Sprint retrospective')).toBe('review');
      expect(manager.inferProfile('Give me a recap')).toBe('review');
      expect(manager.inferProfile('Summary of the project')).toBe('review');
      expect(manager.inferProfile('What happened last week?')).toBe('review');
    });

    it('should fall back to default for unmatched queries', () => {
      expect(manager.inferProfile('Tell me about entity X')).toBe('default');
      expect(manager.inferProfile('What is the weather today?')).toBe('default');
      expect(manager.inferProfile('Hello world')).toBe('default');
    });

    it('should return default for empty or null-ish input', () => {
      expect(manager.inferProfile('')).toBe('default');
      expect(manager.inferProfile(undefined as unknown as string)).toBe('default');
    });
  });

  // ==================== Custom Profiles ====================

  describe('registerProfile', () => {
    it('should register and retrieve a custom profile', () => {
      const customConfig: ProfileConfig = {
        salienceWeights: {
          importanceWeight: 0.10,
          recencyWeight: 0.50,
          frequencyWeight: 0.10,
          contextWeight: 0.20,
          noveltyWeight: 0.10,
        },
        temporalFocus: 'recent',
        budgetAllocation: { working: 60, episodic: 25, semantic: 15 },
        preferredEntityTypes: ['log', 'error'],
        maxTokens: 8000,
      };

      manager.registerProfile('debugging', customConfig);

      const retrieved = manager.getProfile('debugging');
      expect(retrieved).toEqual(customConfig);
    });

    it('should allow overriding built-in profiles', () => {
      const customDefault: ProfileConfig = {
        salienceWeights: {
          importanceWeight: 0.50,
          recencyWeight: 0.10,
          frequencyWeight: 0.10,
          contextWeight: 0.20,
          noveltyWeight: 0.10,
        },
        temporalFocus: 'historical',
        budgetAllocation: { working: 10, episodic: 10, semantic: 80 },
      };

      manager.registerProfile('default', customDefault);

      const retrieved = manager.getProfile('default');
      expect(retrieved.salienceWeights.importanceWeight).toBe(0.50);
      expect(retrieved.temporalFocus).toBe('historical');
    });

    it('should throw for unknown profile names', () => {
      expect(() => manager.getProfile('nonexistent')).toThrow('Unknown context profile');
    });
  });

  // ==================== Available Profiles ====================

  describe('getAvailableProfiles', () => {
    it('should list all preset profiles', () => {
      const profiles = manager.getAvailableProfiles();

      expect(profiles).toContain('default');
      expect(profiles).toContain('planning');
      expect(profiles).toContain('incident');
      expect(profiles).toContain('handoff');
      expect(profiles).toContain('review');
    });

    it('should include custom profiles after registration', () => {
      manager.registerProfile('custom', {
        salienceWeights: {
          importanceWeight: 0.20,
          recencyWeight: 0.20,
          frequencyWeight: 0.20,
          contextWeight: 0.20,
          noveltyWeight: 0.20,
        },
        temporalFocus: 'balanced',
        budgetAllocation: { working: 33, episodic: 34, semantic: 33 },
      });

      expect(manager.getAvailableProfiles()).toContain('custom');
    });
  });

  // ==================== Salience Context Building ====================

  describe('buildSalienceContext', () => {
    it('should build context with profile temporal focus', () => {
      const context = manager.buildSalienceContext('incident');

      expect(context.temporalFocus).toBe('recent');
    });

    it('should merge with base context', () => {
      const baseContext: SalienceContext = {
        currentTask: 'fix_bug',
        queryText: 'error in production',
        currentSession: 'session_123',
      };

      const context = manager.buildSalienceContext('incident', baseContext);

      expect(context.currentTask).toBe('fix_bug');
      expect(context.queryText).toBe('error in production');
      expect(context.currentSession).toBe('session_123');
      expect(context.temporalFocus).toBe('recent');
      expect(context.metadata?.contextProfile).toBe('incident');
    });

    it('should preserve explicit temporal focus from base context', () => {
      const baseContext: SalienceContext = {
        temporalFocus: 'historical',
      };

      const context = manager.buildSalienceContext('incident', baseContext);

      // Base context temporalFocus should be preserved
      expect(context.temporalFocus).toBe('historical');
    });

    it('should auto-detect profile from query text in auto mode', () => {
      const baseContext: SalienceContext = {
        queryText: "There's an outage in the API",
      };

      const context = manager.buildSalienceContext('auto', baseContext);

      expect(context.temporalFocus).toBe('recent');
      expect(context.metadata?.contextProfile).toBe('incident');
    });

    it('should fall back to default for auto mode with no query', () => {
      const context = manager.buildSalienceContext('auto');

      expect(context.temporalFocus).toBe('balanced');
      expect(context.metadata?.contextProfile).toBe('default');
    });

    it('should include preferred entity types in metadata', () => {
      const context = manager.buildSalienceContext('planning');

      expect(context.metadata?.preferredEntityTypes).toEqual(['concept', 'project', 'architecture']);
    });
  });

  // ==================== ContextWindowManager Integration ====================

  describe('ContextWindowManager integration', () => {
    let storage: IGraphStorage;
    let accessTracker: AccessTracker;
    let decayEngine: DecayEngine;
    let salienceEngine: SalienceEngine;
    let contextWindowManager: ContextWindowManager;

    beforeEach(() => {
      storage = createMockStorage();
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextWindowManager = new ContextWindowManager(storage, salienceEngine);
    });

    it('should expose context profile manager', () => {
      const profileManager = contextWindowManager.getContextProfileManager();
      expect(profileManager).toBeInstanceOf(ContextProfileManager);
    });

    it('should accept profile option in retrieveForContext', async () => {
      const result = await contextWindowManager.retrieveForContext({
        maxTokens: 4000,
        profile: 'incident',
        context: { queryText: 'system down' },
      });

      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
      expect(Array.isArray(result.memories)).toBe(true);
    });

    it('should accept auto profile in retrieveForContext', async () => {
      const result = await contextWindowManager.retrieveForContext({
        maxTokens: 4000,
        profile: 'auto',
        context: { queryText: 'production outage detected' },
      });

      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
    });

    it('should accept profile option in retrieveWithBudgetAllocation', async () => {
      const result = await contextWindowManager.retrieveWithBudgetAllocation({
        maxTokens: 4000,
        profile: 'planning',
        context: { queryText: 'design the new system' },
      });

      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
    });

    it('should allow registering custom profiles via manager', async () => {
      const profileManager = contextWindowManager.getContextProfileManager();
      profileManager.registerProfile('custom_debug', {
        salienceWeights: {
          importanceWeight: 0.20,
          recencyWeight: 0.40,
          frequencyWeight: 0.10,
          contextWeight: 0.20,
          noveltyWeight: 0.10,
        },
        temporalFocus: 'recent',
        budgetAllocation: { working: 50, episodic: 30, semantic: 20 },
      });

      const result = await contextWindowManager.retrieveForContext({
        maxTokens: 4000,
        profile: 'custom_debug' as ContextProfile,
      });

      expect(result).toBeDefined();
    });
  });
});
