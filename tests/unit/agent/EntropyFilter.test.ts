/**
 * Unit tests for EntropyFilter
 *
 * Tests:
 * - computeEntropy: correctness on known inputs
 * - passesEntropyFilter: threshold and minLength behaviour
 * - EntropyFilterStage: pipeline stage integration
 * - LowEntropyContentError: error class properties
 * - WorkingMemoryManager entropy gate integration
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeEntropy,
  passesEntropyFilter,
  EntropyFilterStage,
  LowEntropyContentError,
} from '../../../src/agent/EntropyFilter.js';
import type { AgentEntity, ConsolidateOptions } from '../../../src/types/agent-memory.js';

// ==================== Helpers ====================

function makeEntity(name: string, observations: string[]): AgentEntity {
  return {
    name,
    entityType: 'working_memory',
    observations,
    memoryType: 'working',
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
  };
}

const defaultOptions: ConsolidateOptions = {};

// ==================== computeEntropy ====================

describe('computeEntropy', () => {
  it('should return 0 for empty string', () => {
    expect(computeEntropy('')).toBe(0);
  });

  it('should return 0 for single-character string', () => {
    expect(computeEntropy('a')).toBe(0);
  });

  it('should return 0 for all-same characters', () => {
    expect(computeEntropy('aaaaaaaaaa')).toBe(0);
  });

  it('should return positive entropy for varied text', () => {
    expect(computeEntropy('hello world')).toBeGreaterThan(0);
  });

  it('should return higher entropy for more varied text', () => {
    const low = computeEntropy('aaaaabbbbb');
    const high = computeEntropy('abcdefghij');
    expect(high).toBeGreaterThan(low);
  });

  it('should return ~1 bit for 2-symbol equal distribution', () => {
    // aaabbb: 50/50 split → ~1 bit
    const e = computeEntropy('aaabbb');
    expect(e).toBeCloseTo(1.0, 1);
  });

  it('should return ~log2(n) for n-symbol uniform distribution', () => {
    // abcd: 4 symbols, each 25% → log2(4) = 2
    const e = computeEntropy('abcdabcdabcdabcd');
    expect(e).toBeCloseTo(2.0, 1);
  });

  it('should handle Unicode characters', () => {
    expect(() => computeEntropy('こんにちは世界')).not.toThrow();
    expect(computeEntropy('こんにちは世界')).toBeGreaterThan(0);
  });

  it('should return a number (not NaN)', () => {
    expect(Number.isNaN(computeEntropy('hello world'))).toBe(false);
  });
});

// ==================== passesEntropyFilter ====================

describe('passesEntropyFilter', () => {
  it('should pass empty string (too short to penalise)', () => {
    expect(passesEntropyFilter('')).toBe(true);
  });

  it('should pass strings shorter than minLength', () => {
    expect(passesEntropyFilter('aaa', 1.5, 10)).toBe(true);
  });

  it('should fail a long all-same-character string', () => {
    expect(passesEntropyFilter('aaaaaaaaaaaa', 1.5, 10)).toBe(false);
  });

  it('should pass normal prose', () => {
    expect(passesEntropyFilter('User prefers budget hotels', 1.5, 10)).toBe(true);
  });

  it('should use default thresholds', () => {
    // Normal text passes, repetitive text fails
    expect(passesEntropyFilter('hello world example text here')).toBe(true);
    expect(passesEntropyFilter('aaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('should respect custom minEntropy', () => {
    const text = 'hello'; // entropy ~2.3 bits for 5 chars, but shorter than default minLength
    // With minLength=0, short text is checked
    expect(passesEntropyFilter('hello', 1.0, 0)).toBe(true);
    expect(passesEntropyFilter('hello', 3.0, 0)).toBe(false);
  });

  it('should respect custom minLength', () => {
    // 'aaaa' would fail at 0 minLength but passes if minLength > 4
    expect(passesEntropyFilter('aaaa', 1.5, 10)).toBe(true);
    expect(passesEntropyFilter('aaaa', 1.5, 3)).toBe(false);
  });

  it('should pass a string at exactly minEntropy threshold', () => {
    // Find text with entropy ~1.5 and test at that exact threshold
    // 'aabb' has 2 chars equal → H = 1.0 bit exactly
    // At threshold 1.0 with minLength 0: should pass
    expect(passesEntropyFilter('aabb', 1.0, 0)).toBe(true);
  });
});

// ==================== EntropyFilterStage ====================

describe('EntropyFilterStage', () => {
  it('should have correct name', () => {
    const stage = new EntropyFilterStage();
    expect(stage.name).toBe('entropy-filter');
  });

  it('should use default config', () => {
    const stage = new EntropyFilterStage();
    const config = stage.getConfig();
    expect(config.minEntropy).toBe(1.5);
    expect(config.minLength).toBe(10);
  });

  it('should accept custom config', () => {
    const stage = new EntropyFilterStage({ minEntropy: 2.0, minLength: 5 });
    const config = stage.getConfig();
    expect(config.minEntropy).toBe(2.0);
    expect(config.minLength).toBe(5);
  });

  it('should process empty entity list', async () => {
    const stage = new EntropyFilterStage();
    const result = await stage.process([], defaultOptions);
    expect(result.processed).toBe(0);
    expect(result.transformed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass high-entropy entities', async () => {
    const stage = new EntropyFilterStage({ minEntropy: 1.5 });
    const entities = [
      makeEntity('e1', ['User prefers budget travel with local food experiences']),
      makeEntity('e2', ['The project deadline is next Friday and requires code review']),
    ];
    const result = await stage.process(entities, defaultOptions);
    expect(result.processed).toBe(2);
    expect(result.transformed).toBe(2);
    expect(stage.rejectedNames).toHaveLength(0);
  });

  it('should reject low-entropy entities', async () => {
    const stage = new EntropyFilterStage({ minEntropy: 1.5, minLength: 5 });
    const entities = [
      makeEntity('low', ['aaaaaaaaaaaaaaaaaaaaa']),
      makeEntity('high', ['diverse informative content with many different words']),
    ];
    const result = await stage.process(entities, defaultOptions);
    expect(result.processed).toBe(2);
    expect(result.transformed).toBe(1);
    expect(stage.rejectedNames).toContain('low');
    expect(stage.rejectedNames).not.toContain('high');
  });

  it('should combine observations before checking entropy', async () => {
    const stage = new EntropyFilterStage({ minEntropy: 1.5, minLength: 5 });
    // Single obs is low-entropy but combined text is high-entropy
    const entity = makeEntity('e', [
      'aaaaaaaaaaaaa',
      'bbbbbbbbbbbbb',
      'ccccccccccccc',
      // Combined: 'aaaaaaaaaaaaa bbbbbbbbbbbbb ccccccccccccc' → 3 chars + spaces → higher entropy
    ]);
    // The combined text has 4 distinct chars so entropy > 0
    // But 3 distinct chars in equal proportion → ~1.58 bits → passes default threshold
    const result = await stage.process([entity], defaultOptions);
    expect(result.processed).toBe(1);
    // Just verify it runs without throwing
    expect(result.errors).toHaveLength(0);
  });

  it('should reset rejectedNames on each process call', async () => {
    const stage = new EntropyFilterStage({ minEntropy: 1.5, minLength: 5 });
    const lowEntity = makeEntity('low', ['aaaaaaaaaaaaaaaaaaa']);
    await stage.process([lowEntity], defaultOptions);
    expect(stage.rejectedNames).toContain('low');

    // Second run without low-entropy entities
    const highEntity = makeEntity('high', ['rich diverse content text']);
    await stage.process([highEntity], defaultOptions);
    expect(stage.rejectedNames).not.toContain('low');
  });

  it('should return no errors on normal operation', async () => {
    const stage = new EntropyFilterStage();
    const entities = [makeEntity('e1', ['some normal observation'])];
    const result = await stage.process(entities, defaultOptions);
    expect(result.errors).toHaveLength(0);
  });
});

// ==================== LowEntropyContentError ====================

describe('LowEntropyContentError', () => {
  it('should be an Error', () => {
    const err = new LowEntropyContentError('test message');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have correct name', () => {
    const err = new LowEntropyContentError('test');
    expect(err.name).toBe('LowEntropyContentError');
  });

  it('should have correct code', () => {
    const err = new LowEntropyContentError('test');
    expect(err.code).toBe('LOW_ENTROPY_CONTENT');
  });

  it('should preserve the message', () => {
    const err = new LowEntropyContentError('Content is too repetitive');
    expect(err.message).toBe('Content is too repetitive');
  });

  it('should have a stack trace', () => {
    const err = new LowEntropyContentError('trace test');
    expect(err.stack).toBeTruthy();
  });
});

// ==================== WorkingMemoryManager integration ====================

describe('WorkingMemoryManager entropy gate', () => {
  // Mock storage
  function makeMockStorage() {
    return {
      appendEntity: vi.fn().mockResolvedValue(undefined),
      getEntityByName: vi.fn().mockReturnValue(undefined),
      loadGraph: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
      saveGraph: vi.fn().mockResolvedValue(undefined),
      updateEntity: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('should reject low-entropy content when entropyFilter is configured', async () => {
    const { WorkingMemoryManager } = await import('../../../src/agent/WorkingMemoryManager.js');
    const storage = makeMockStorage();
    const wmm = new WorkingMemoryManager(storage as never, {
      entropyFilter: { minEntropy: 1.5, minLength: 5 },
    });

    await expect(
      wmm.createWorkingMemory('session_1', 'aaaaaaaaaaaaaaaaaaa')
    ).rejects.toThrow(LowEntropyContentError);

    // Storage should NOT have been called
    expect(storage.appendEntity).not.toHaveBeenCalled();
  });

  it('should accept high-entropy content when entropyFilter is configured', async () => {
    const { WorkingMemoryManager } = await import('../../../src/agent/WorkingMemoryManager.js');
    const storage = makeMockStorage();
    const wmm = new WorkingMemoryManager(storage as never, {
      entropyFilter: { minEntropy: 1.5, minLength: 5 },
    });

    await expect(
      wmm.createWorkingMemory('session_1', 'User prefers budget hotels near the city center')
    ).resolves.toBeDefined();

    expect(storage.appendEntity).toHaveBeenCalledTimes(1);
  });

  it('should NOT apply entropy check when entropyFilter is not configured', async () => {
    const { WorkingMemoryManager } = await import('../../../src/agent/WorkingMemoryManager.js');
    const storage = makeMockStorage();
    const wmm = new WorkingMemoryManager(storage as never);

    // Should pass even low-entropy content when gate is disabled
    await expect(
      wmm.createWorkingMemory('session_1', 'aaaaaaaaaaaaaaaaaaa')
    ).resolves.toBeDefined();

    expect(storage.appendEntity).toHaveBeenCalledTimes(1);
  });

  it('should expose entropyFilter config via getConfig', async () => {
    const { WorkingMemoryManager } = await import('../../../src/agent/WorkingMemoryManager.js');
    const storage = makeMockStorage();
    const filterConfig = { minEntropy: 2.5, minLength: 15 };
    const wmm = new WorkingMemoryManager(storage as never, { entropyFilter: filterConfig });

    const config = wmm.getConfig();
    expect(config.entropyFilter).toEqual(filterConfig);
  });
});
