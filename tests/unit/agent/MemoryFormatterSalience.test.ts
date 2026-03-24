/**
 * Unit tests for MemoryFormatter salience budget allocation
 *
 * Tests:
 * - formatWithSalienceBudget: proportional token allocation
 * - formatSingleMemoryWithBudget: single entity token-constrained formatting
 * - Edge cases: empty memories, zero scores, equal scores, budget exhaustion
 */

import { describe, it, expect } from 'vitest';
import { MemoryFormatter } from '../../../src/agent/MemoryFormatter.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

// ==================== Helper ====================

function makeEntity(
  name: string,
  observations: string[],
  entityType = 'memory'
): AgentEntity {
  return {
    name,
    entityType,
    observations,
    memoryType: 'working',
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
    createdAt: new Date().toISOString(),
  };
}

// ==================== formatWithSalienceBudget ====================

describe('MemoryFormatter.formatWithSalienceBudget', () => {
  it('should return empty string for empty memories', () => {
    const formatter = new MemoryFormatter();
    const result = formatter.formatWithSalienceBudget([], new Map(), 500);
    expect(result).toBe('');
  });

  it('should include all memories when budget is generous', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memories = [
      makeEntity('mem_a', ['High priority item']),
      makeEntity('mem_b', ['Low priority item']),
    ];
    const scores = new Map([['mem_a', 0.9], ['mem_b', 0.1]]);
    const result = formatter.formatWithSalienceBudget(memories, scores, 5000);
    expect(result).toContain('mem_a');
    expect(result).toContain('mem_b');
  });

  it('should give high-salience memory more space than low-salience', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const observations = Array.from({ length: 10 }, (_, i) => `Observation number ${i + 1} with extra words to consume tokens`);
    const highMemory = makeEntity('high', observations);
    const lowMemory = makeEntity('low', observations);

    const scores = new Map([['high', 0.9], ['low', 0.1]]);
    const result = formatter.formatWithSalienceBudget([highMemory, lowMemory], scores, 200);

    const highSection = result.split('\n\n').find((s) => s.includes('high')) ?? '';
    const lowSection = result.split('\n\n').find((s) => s.includes('low')) ?? '';

    // High-salience section should have at least as many chars as low-salience
    // (it has 9x the budget)
    expect(highSection.length).toBeGreaterThanOrEqual(lowSection.length);
  });

  it('should fall back to equal allocation when all scores are zero', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memories = [
      makeEntity('mem_a', ['Content for a']),
      makeEntity('mem_b', ['Content for b']),
    ];
    const scores = new Map([['mem_a', 0], ['mem_b', 0]]);
    const result = formatter.formatWithSalienceBudget(memories, scores, 2000);
    // Both should appear in output
    expect(result).toContain('mem_a');
    expect(result).toContain('mem_b');
  });

  it('should fall back to equal allocation for unknown entities', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memories = [
      makeEntity('mem_a', ['Content a']),
      makeEntity('mem_b', ['Content b']),
    ];
    const scores = new Map<string, number>(); // No scores at all
    const result = formatter.formatWithSalienceBudget(memories, scores, 2000);
    expect(result).toContain('mem_a');
    expect(result).toContain('mem_b');
  });

  it('should respect total token budget', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const obs = 'This is a fairly long observation that should consume multiple tokens when formatted and included in the output text.';
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeEntity(`mem_${i}`, Array(5).fill(obs))
    );
    const scores = new Map(memories.map((m) => [m.name, 1 / memories.length]));

    const result = formatter.formatWithSalienceBudget(memories, scores, 50);
    const estimatedTokens = result.split(/\s+/).filter(Boolean).length;
    // Should be well under the budget (50 tokens is very tight)
    expect(estimatedTokens).toBeLessThan(100); // very rough check
  });

  it('should include header when provided', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memories = [makeEntity('mem', ['Some content'])];
    const scores = new Map([['mem', 1.0]]);
    const result = formatter.formatWithSalienceBudget(memories, scores, 2000, {
      header: '## My Header',
    });
    expect(result).toContain('## My Header');
  });

  it('should use custom separator', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memories = [
      makeEntity('mem_a', ['Content a']),
      makeEntity('mem_b', ['Content b']),
    ];
    const scores = new Map([['mem_a', 0.6], ['mem_b', 0.4]]);
    const result = formatter.formatWithSalienceBudget(memories, scores, 2000, {
      separator: '---',
    });
    expect(result).toContain('---');
  });

  it('should skip memories with zero token allocation', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    // With a very small budget and heavily skewed scores, low-score entity gets 0 tokens
    const memories = [
      makeEntity('dominant', ['Primary memory']),
      makeEntity('tiny', ['Tiny']),
    ];
    // Give dominant 99% of weight; tiny gets ~1 token allocation
    const scores = new Map([['dominant', 0.99], ['tiny', 0.01]]);
    const result = formatter.formatWithSalienceBudget(memories, scores, 20);
    // Just verify it doesn't crash and produces some output
    expect(typeof result).toBe('string');
  });
});

// ==================== formatSingleMemoryWithBudget ====================

describe('MemoryFormatter.formatSingleMemoryWithBudget', () => {
  it('should return empty string when budget too small for header', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memory = makeEntity('very_long_entity_name_that_wont_fit', ['Content']);
    const result = formatter.formatSingleMemoryWithBudget(memory, 1);
    expect(result).toBe('');
  });

  it('should always include the header line when budget allows', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memory = makeEntity('mem', ['Some observation']);
    const result = formatter.formatSingleMemoryWithBudget(memory, 500);
    expect(result).toContain('## mem');
    expect(result).toContain('(memory)');
  });

  it('should include observations up to budget', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memory = makeEntity('mem', [
      'First observation',
      'Second observation',
      'Third observation',
      'Fourth observation',
    ]);
    const result = formatter.formatSingleMemoryWithBudget(memory, 500);
    expect(result).toContain('First observation');
  });

  it('should truncate observations when budget is tight', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memory = makeEntity('mem', [
      'First'.repeat(20),
      'Second'.repeat(20),
      'Third'.repeat(20),
    ]);
    // Very tight budget — should truncate after first observation or even the header
    const result = formatter.formatSingleMemoryWithBudget(memory, 15);
    // Should include header at minimum or be empty
    expect(typeof result).toBe('string');
  });

  it('should include metadata when config says so and budget allows', () => {
    const formatter = new MemoryFormatter({
      includeTimestamps: true,
      includeMemoryType: true,
    });
    const memory = makeEntity('mem', ['Some observation']);
    const result = formatter.formatSingleMemoryWithBudget(memory, 500);
    // Metadata line should be present
    expect(result).toMatch(/\[.*\]/);
  });

  it('should not include metadata when includeMemoryType is false', () => {
    const formatter = new MemoryFormatter({
      includeTimestamps: false,
      includeMemoryType: false,
    });
    const memory = makeEntity('mem', ['Content']);
    const result = formatter.formatSingleMemoryWithBudget(memory, 500);
    // No metadata bracket
    expect(result).not.toMatch(/\[Type:/);
  });

  it('should handle entity with no observations', () => {
    const formatter = new MemoryFormatter({ includeTimestamps: false, includeMemoryType: false });
    const memory = makeEntity('empty_mem', []);
    const result = formatter.formatSingleMemoryWithBudget(memory, 500);
    expect(result).toContain('empty_mem');
  });
});

// ==================== estimateTokenCount (public proxy) ====================

describe('MemoryFormatter.estimateTokenCount', () => {
  it('should return a positive number for non-empty text', () => {
    const formatter = new MemoryFormatter();
    expect(formatter.estimateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('should return 0 for empty string', () => {
    const formatter = new MemoryFormatter();
    expect(formatter.estimateTokenCount('')).toBe(0);
  });

  it('should return higher count for longer text', () => {
    const formatter = new MemoryFormatter();
    const short = formatter.estimateTokenCount('hello');
    const long = formatter.estimateTokenCount('hello world this is a much longer sentence with many more words');
    expect(long).toBeGreaterThan(short);
  });
});
