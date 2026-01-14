/**
 * ConflictResolver Unit Tests
 *
 * Tests for conflict detection and resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictResolver } from '../../../src/agent/ConflictResolver.js';
import type { AgentEntity, AgentMetadata } from '../../../src/types/agent-memory.js';

/**
 * Create a mock agent entity.
 */
function createMockMemory(
  name: string,
  agentId: string,
  observations: string[] = [],
  options: Partial<AgentEntity> = {}
): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations,
    agentId,
    visibility: 'shared',
    memoryType: 'working',
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    importance: 5,
    accessCount: 0,
    lastAccessedAt: new Date().toISOString(),
    confidence: 0.5,
    confirmationCount: 0,
    ...options,
  };
}

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const config = resolver.getConfig();

      expect(config.similarityThreshold).toBe(0.7);
      expect(config.defaultStrategy).toBe('most_recent');
      expect(config.detectNegations).toBe(true);
    });

    it('should create with custom configuration', () => {
      const customResolver = new ConflictResolver({
        similarityThreshold: 0.5,
        defaultStrategy: 'highest_confidence',
        detectNegations: false,
      });

      const config = customResolver.getConfig();

      expect(config.similarityThreshold).toBe(0.5);
      expect(config.defaultStrategy).toBe('highest_confidence');
      expect(config.detectNegations).toBe(false);
    });
  });

  describe('detectConflicts', () => {
    it('should detect conflicts between similar memories from different agents', () => {
      // Use a resolver with lower threshold to ensure conflict detection
      const sensitiveResolver = new ConflictResolver({ similarityThreshold: 0.3 });

      const memories = [
        createMockMemory('user_preference', 'agent_1', ['User likes coffee', 'Prefers morning meetings']),
        createMockMemory('user_pref', 'agent_2', ['User likes coffee', 'Prefers afternoon meetings']),
      ];

      const conflicts = sensitiveResolver.detectConflicts(memories);

      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should not detect conflicts between same-agent memories', () => {
      const memories = [
        createMockMemory('mem_1', 'agent_1', ['Data point A']),
        createMockMemory('mem_2', 'agent_1', ['Data point A similar']),
      ];

      const conflicts = resolver.detectConflicts(memories);

      expect(conflicts.length).toBe(0);
    });

    it('should detect negation-based conflicts', () => {
      // Use a resolver with lower threshold to ensure similarity triggers negation check
      const sensitiveResolver = new ConflictResolver({ similarityThreshold: 0.3 });

      const memories = [
        createMockMemory('feature_status', 'agent_1', ['The important feature X is now enabled']),
        createMockMemory('feature_info', 'agent_2', ['The important feature X is not enabled']),
      ];

      const conflicts = sensitiveResolver.detectConflicts(memories);

      expect(conflicts.some((c) => c.detectionMethod === 'negation')).toBe(true);
    });

    it('should emit conflict event on detection', () => {
      const sensitiveResolver = new ConflictResolver({ similarityThreshold: 0.3 });
      const eventHandler = vi.fn();
      sensitiveResolver.on('memory:conflict', eventHandler);

      const memories = [
        createMockMemory('similar_1', 'agent_1', ['Important data about project alpha status']),
        createMockMemory('similar_2', 'agent_2', ['Important data about project alpha version']),
      ];

      sensitiveResolver.detectConflicts(memories);

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should return empty array for no conflicts', () => {
      const memories = [
        createMockMemory('topic_a', 'agent_1', ['Completely different topic']),
        createMockMemory('topic_b', 'agent_2', ['Unrelated subject matter']),
      ];

      const conflicts = resolver.detectConflicts(memories);

      expect(conflicts.length).toBe(0);
    });
  });

  describe('resolveConflict', () => {
    const agents = new Map<string, AgentMetadata>([
      [
        'agent_1',
        {
          name: 'Agent 1',
          type: 'llm',
          trustLevel: 0.9,
          capabilities: ['read', 'write'],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
      ],
      [
        'agent_2',
        {
          name: 'Agent 2',
          type: 'llm',
          trustLevel: 0.5,
          capabilities: ['read', 'write'],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
      ],
    ]);

    it('should resolve using most_recent strategy', () => {
      const oldDate = new Date('2024-01-01').toISOString();
      const newDate = new Date('2024-01-15').toISOString();

      const memories = [
        createMockMemory('mem_old', 'agent_1', ['Old data'], { lastModified: oldDate }),
        createMockMemory('mem_new', 'agent_2', ['New data'], { lastModified: newDate }),
      ];

      const conflict = {
        primaryMemory: 'mem_old',
        conflictingMemories: ['mem_new'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'most_recent' as const,
        detectedAt: new Date().toISOString(),
      };

      const result = resolver.resolveConflict(conflict, memories, agents, 'most_recent');

      expect(result.resolvedMemory.name).toBe('mem_new');
      expect(result.strategy).toBe('most_recent');
    });

    it('should resolve using highest_confidence strategy', () => {
      const memories = [
        createMockMemory('low_conf', 'agent_1', ['Data'], { confidence: 0.3 }),
        createMockMemory('high_conf', 'agent_2', ['Data'], { confidence: 0.9 }),
      ];

      const conflict = {
        primaryMemory: 'low_conf',
        conflictingMemories: ['high_conf'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'highest_confidence' as const,
        detectedAt: new Date().toISOString(),
      };

      const result = resolver.resolveConflict(conflict, memories, agents, 'highest_confidence');

      expect(result.resolvedMemory.name).toBe('high_conf');
    });

    it('should resolve using most_confirmations strategy', () => {
      const memories = [
        createMockMemory('few_confirms', 'agent_1', ['Data'], { confirmationCount: 1 }),
        createMockMemory('many_confirms', 'agent_2', ['Data'], { confirmationCount: 10 }),
      ];

      const conflict = {
        primaryMemory: 'few_confirms',
        conflictingMemories: ['many_confirms'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'most_confirmations' as const,
        detectedAt: new Date().toISOString(),
      };

      const result = resolver.resolveConflict(conflict, memories, agents, 'most_confirmations');

      expect(result.resolvedMemory.name).toBe('many_confirms');
    });

    it('should resolve using trusted_agent strategy', () => {
      const memories = [
        createMockMemory('trusted', 'agent_1', ['Data from trusted']),
        createMockMemory('untrusted', 'agent_2', ['Data from less trusted']),
      ];

      const conflict = {
        primaryMemory: 'trusted',
        conflictingMemories: ['untrusted'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'trusted_agent' as const,
        detectedAt: new Date().toISOString(),
      };

      const result = resolver.resolveConflict(conflict, memories, agents, 'trusted_agent');

      expect(result.resolvedMemory.name).toBe('trusted'); // agent_1 has higher trust
    });

    it('should resolve using merge_all strategy', () => {
      const memories = [
        createMockMemory('mem_1', 'agent_1', ['Observation A', 'Observation B']),
        createMockMemory('mem_2', 'agent_2', ['Observation B', 'Observation C']),
      ];

      const conflict = {
        primaryMemory: 'mem_1',
        conflictingMemories: ['mem_2'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'merge_all' as const,
        detectedAt: new Date().toISOString(),
      };

      const result = resolver.resolveConflict(conflict, memories, agents, 'merge_all');

      expect(result.resolvedMemory.observations).toContain('Observation A');
      expect(result.resolvedMemory.observations).toContain('Observation B');
      expect(result.resolvedMemory.observations).toContain('Observation C');
    });

    it('should emit resolution event', () => {
      const eventHandler = vi.fn();
      resolver.on('memory:conflict_resolved', eventHandler);

      const memories = [
        createMockMemory('mem_1', 'agent_1', ['Data']),
        createMockMemory('mem_2', 'agent_2', ['Data']),
      ];

      const conflict = {
        primaryMemory: 'mem_1',
        conflictingMemories: ['mem_2'],
        detectionMethod: 'similarity' as const,
        suggestedStrategy: 'most_recent' as const,
        detectedAt: new Date().toISOString(),
      };

      resolver.resolveConflict(conflict, memories, agents);

      expect(eventHandler).toHaveBeenCalled();
    });
  });
});
