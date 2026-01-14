/**
 * MemoryFormatter Unit Tests
 *
 * Tests for memory formatting utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFormatter } from '../../../src/agent/MemoryFormatter.js';
import type { AgentEntity, ContextPackage, TokenBreakdown } from '../../../src/types/agent-memory.js';

/**
 * Create a test agent entity.
 */
function createTestEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
    ...overrides,
  };
}

/**
 * Create a test context package.
 */
function createTestPackage(memories: AgentEntity[] = []): ContextPackage {
  const breakdown: TokenBreakdown = {
    working: 100,
    episodic: 50,
    semantic: 75,
    procedural: 0,
    mustInclude: 25,
  };

  return {
    memories,
    totalTokens: 250,
    breakdown,
    excluded: [],
    suggestions: ['Consider adding more context'],
  };
}

describe('MemoryFormatter', () => {
  let formatter: MemoryFormatter;

  beforeEach(() => {
    formatter = new MemoryFormatter();
  });

  describe('formatForPrompt', () => {
    it('should format memories as text', () => {
      const memories = [
        createTestEntity({ name: 'memory1', observations: ['First observation'] }),
        createTestEntity({ name: 'memory2', observations: ['Second observation'] }),
      ];

      const result = formatter.formatForPrompt(memories);

      expect(result).toContain('memory1');
      expect(result).toContain('memory2');
      expect(result).toContain('First observation');
      expect(result).toContain('Second observation');
    });

    it('should include header when provided', () => {
      const memories = [createTestEntity({ name: 'test' })];

      const result = formatter.formatForPrompt(memories, {
        header: '## Memory Context',
      });

      expect(result).toContain('## Memory Context');
    });

    it('should respect token limit', () => {
      const memories = Array.from({ length: 100 }, (_, i) =>
        createTestEntity({
          name: `memory_${i}`,
          observations: [`Long observation text for memory ${i} that takes up tokens`],
        })
      );

      const result = formatter.formatForPrompt(memories, { maxTokens: 50 });

      expect(result).toContain('truncated');
    });

    it('should use custom separator', () => {
      const memories = [
        createTestEntity({ name: 'm1' }),
        createTestEntity({ name: 'm2' }),
      ];

      const result = formatter.formatForPrompt(memories, { separator: '\n---\n' });

      expect(result).toContain('---');
    });
  });

  describe('formatSingleMemory', () => {
    it('should format entity with template', () => {
      const memory = createTestEntity({
        name: 'user_preference',
        entityType: 'preference',
        observations: ['Likes Italian food', 'Prefers quiet places'],
        memoryType: 'semantic',
      });

      const result = formatter.formatSingleMemory(memory);

      expect(result).toContain('user_preference');
      expect(result).toContain('preference');
      expect(result).toContain('Likes Italian food');
    });

    it('should include memory type when configured', () => {
      const memory = createTestEntity({ memoryType: 'episodic' });

      const result = formatter.formatSingleMemory(memory);

      expect(result).toContain('episodic');
    });
  });

  describe('formatAsJSON', () => {
    it('should return JSON object with memories', () => {
      const memories = [
        createTestEntity({ name: 'm1' }),
        createTestEntity({ name: 'm2' }),
      ];
      const pkg = createTestPackage(memories);

      const result = formatter.formatAsJSON(pkg) as Record<string, unknown>;

      expect(result.memories).toBeDefined();
      expect((result.memories as object[]).length).toBe(2);
      expect(result.totalTokens).toBe(250);
    });

    it('should include breakdown when requested', () => {
      const pkg = createTestPackage([createTestEntity()]);

      const result = formatter.formatAsJSON(pkg, { includeBreakdown: true }) as Record<string, unknown>;

      expect(result.breakdown).toBeDefined();
    });

    it('should include suggestions when requested', () => {
      const pkg = createTestPackage([createTestEntity()]);

      const result = formatter.formatAsJSON(pkg, { includeSuggestions: true }) as Record<string, unknown>;

      expect(result.suggestions).toBeDefined();
    });

    it('should return compact format when requested', () => {
      const pkg = createTestPackage([createTestEntity({ name: 'test' })]);

      const result = formatter.formatAsJSON(pkg, { compact: true }) as Record<string, unknown>;

      // Compact format uses short keys
      expect(result.m).toBeDefined();
      expect(result.tokens).toBe(250);
    });
  });

  describe('memoryToJSON', () => {
    it('should convert memory to JSON object', () => {
      const memory = createTestEntity({
        name: 'test_mem',
        entityType: 'preference',
        observations: ['Obs1', 'Obs2'],
        sessionId: 'session_123',
        importance: 8,
      });

      const result = formatter.memoryToJSON(memory) as Record<string, unknown>;

      expect(result.name).toBe('test_mem');
      expect(result.type).toBe('preference');
      expect(result.observations).toEqual(['Obs1', 'Obs2']);
      expect(result.sessionId).toBe('session_123');
      expect(result.importance).toBe(8);
    });
  });

  describe('formatCompact', () => {
    it('should format in minimal token format', () => {
      const memories = [
        createTestEntity({ name: 'food_pref', observations: ['Italian'] }),
        createTestEntity({ name: 'travel_pref', observations: ['Beach vacation'] }),
      ];

      const result = formatter.formatCompact(memories, 1000);

      expect(result).toContain('food_pref: Italian');
      expect(result).toContain('travel_pref: Beach vacation');
    });

    it('should respect token limit', () => {
      const memories = Array.from({ length: 50 }, (_, i) =>
        createTestEntity({
          name: `mem_${i}`,
          observations: [`Very long observation ${i}`],
        })
      );

      const result = formatter.formatCompact(memories, 20);

      // Should truncate
      expect(result.split('\n').length).toBeLessThan(50);
    });
  });

  describe('formatByType', () => {
    it('should group memories by type', () => {
      const memories = [
        createTestEntity({ name: 'w1', memoryType: 'working' }),
        createTestEntity({ name: 'e1', memoryType: 'episodic' }),
        createTestEntity({ name: 's1', memoryType: 'semantic' }),
      ];

      const result = formatter.formatByType(memories);

      expect(result).toContain('Working Memory');
      expect(result).toContain('Episodic Memory');
      expect(result).toContain('Semantic Memory');
    });

    it('should maintain type order', () => {
      const memories = [
        createTestEntity({ name: 's1', memoryType: 'semantic' }),
        createTestEntity({ name: 'w1', memoryType: 'working' }),
      ];

      const result = formatter.formatByType(memories);

      // Working should come before Semantic
      expect(result.indexOf('Working')).toBeLessThan(result.indexOf('Semantic'));
    });
  });

  describe('formatSummary', () => {
    it('should return summary text', () => {
      const memories = [
        createTestEntity({ name: 'm1' }),
        createTestEntity({ name: 'm2' }),
      ];
      const pkg = createTestPackage(memories);

      const result = formatter.formatSummary(pkg);

      expect(result).toContain('Memory Context Summary');
      expect(result).toContain('Total memories: 2');
      expect(result).toContain('Estimated tokens: 250');
      expect(result).toContain('Token Breakdown');
    });

    it('should include suggestions', () => {
      const pkg = createTestPackage([createTestEntity()]);

      const result = formatter.formatSummary(pkg);

      expect(result).toContain('Suggestions');
      expect(result).toContain('Consider adding more context');
    });
  });

  describe('configuration', () => {
    it('should use custom configuration', () => {
      const customFormatter = new MemoryFormatter({
        includeTimestamps: false,
        includeMemoryType: false,
        tokenMultiplier: 1.5,
      });

      const config = customFormatter.getConfig();

      expect(config.includeTimestamps).toBe(false);
      expect(config.includeMemoryType).toBe(false);
      expect(config.tokenMultiplier).toBe(1.5);
    });

    it('should use custom template', () => {
      const customFormatter = new MemoryFormatter({
        promptTemplate: '{name}: {observations}',
      });

      const memory = createTestEntity({
        name: 'test',
        observations: ['Hello'],
      });

      const result = customFormatter.formatSingleMemory(memory);

      expect(result).toBe('test: - Hello');
    });
  });
});
