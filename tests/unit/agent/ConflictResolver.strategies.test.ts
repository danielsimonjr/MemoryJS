/**
 * ConflictResolver strategy selection (CL-16 pickFirstMax)
 *
 * Pins the tie-break behaviour of the most_recent / highest_confidence /
 * most_confirmations / trusted_agent strategies: the first maximum wins.
 */

import { describe, it, expect } from 'vitest';
import { ConflictResolver } from '../../../src/agent/ConflictResolver.js';
import type { AgentEntity, AgentMetadata, ConflictInfo } from '../../../src/types/agent-memory.js';

function memory(name: string, agentId: string, options: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations: [`observation for ${name}`],
    agentId,
    visibility: 'shared',
    memoryType: 'working',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    importance: 5,
    accessCount: 0,
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    confidence: 0.5,
    confirmationCount: 0,
    ...options,
  } as AgentEntity;
}

function conflictOf(primary: string, others: string[], strategy: ConflictInfo['suggestedStrategy']): ConflictInfo {
  return {
    primaryMemory: primary,
    conflictingMemories: others,
    detectionMethod: 'similarity',
    similarityScore: 0.9,
    suggestedStrategy: strategy,
    detectedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('ConflictResolver strategy tie-breaks (pickFirstMax)', () => {
  const resolver = new ConflictResolver();
  const agents = new Map<string, AgentMetadata>();

  it('most_recent picks the strictly latest timestamp', () => {
    const memories = [
      memory('a', 'x', { lastModified: '2026-01-01T00:00:00.000Z' }),
      memory('b', 'y', { lastModified: '2026-03-01T00:00:00.000Z' }),
      memory('c', 'z', { lastModified: '2026-02-01T00:00:00.000Z' }),
    ];
    const result = resolver.resolveConflict(conflictOf('a', ['b', 'c'], 'most_recent'), memories, agents);
    expect(result.resolvedMemory.name).toBe('b');
  });

  it('most_recent keeps the first memory on a timestamp tie', () => {
    const same = '2026-05-05T00:00:00.000Z';
    const memories = [
      memory('first', 'x', { lastModified: same }),
      memory('second', 'y', { lastModified: same }),
    ];
    const result = resolver.resolveConflict(conflictOf('first', ['second'], 'most_recent'), memories, agents);
    expect(result.resolvedMemory.name).toBe('first');
  });

  it('most_recent falls back to createdAt, then 1970 when both are missing', () => {
    const memories = [
      memory('old', 'x', { lastModified: undefined, createdAt: '2020-01-01T00:00:00.000Z' }),
      memory('newer', 'y', { lastModified: undefined, createdAt: '2024-01-01T00:00:00.000Z' }),
      memory('none', 'z', { lastModified: undefined, createdAt: undefined }),
    ];
    const result = resolver.resolveConflict(conflictOf('old', ['newer', 'none'], 'most_recent'), memories, agents);
    expect(result.resolvedMemory.name).toBe('newer');
  });

  it('highest_confidence defaults a missing confidence to 0.5 and keeps the first tie', () => {
    const memories = [
      memory('missing', 'x', { confidence: undefined }),
      memory('half', 'y', { confidence: 0.5 }),
      memory('high', 'z', { confidence: 0.9 }),
      memory('also-high', 'w', { confidence: 0.9 }),
    ];
    const result = resolver.resolveConflict(
      conflictOf('missing', ['half', 'high', 'also-high'], 'highest_confidence'),
      memories,
      agents,
    );
    expect(result.resolvedMemory.name).toBe('high');
  });

  it('most_confirmations defaults a missing count to 0 and keeps the first tie', () => {
    const memories = [
      memory('none', 'x', { confirmationCount: undefined }),
      memory('three-a', 'y', { confirmationCount: 3 }),
      memory('three-b', 'z', { confirmationCount: 3 }),
    ];
    const result = resolver.resolveConflict(
      conflictOf('none', ['three-a', 'three-b'], 'most_confirmations'),
      memories,
      agents,
    );
    expect(result.resolvedMemory.name).toBe('three-a');
  });

  it('trusted_agent uses trustLevel with a 0.5 default for unknown agents', () => {
    const trusted = new Map<string, AgentMetadata>([
      ['alpha', { agentId: 'alpha', trustLevel: 0.2 } as AgentMetadata],
      ['beta', { agentId: 'beta', trustLevel: 0.8 } as AgentMetadata],
      ['gamma', { agentId: 'gamma', trustLevel: 0.8 } as AgentMetadata],
    ]);
    const memories = [
      memory('from-alpha', 'alpha'),
      memory('from-unknown', 'unknown'),
      memory('from-beta', 'beta'),
      memory('from-gamma', 'gamma'),
    ];
    const result = resolver.resolveConflict(
      conflictOf('from-alpha', ['from-unknown', 'from-beta', 'from-gamma'], 'trusted_agent'),
      memories,
      trusted,
    );
    expect(result.resolvedMemory.name).toBe('from-beta');
  });

  it('merge_all uses the pickFirstMax most-recent base', () => {
    const memories = [
      memory('older', 'x', { lastModified: '2026-01-01T00:00:00.000Z', confidence: 0.4 }),
      memory('newer', 'y', { lastModified: '2026-02-01T00:00:00.000Z', confidence: 0.6 }),
    ];
    const result = resolver.resolveConflict(conflictOf('older', ['newer'], 'merge_all'), memories, agents);
    expect(result.resolvedMemory.name).toBe('newer');
    expect(result.resolvedMemory.confidence).toBeCloseTo(0.5);
  });
});

describe('ConflictResolver pickFirstMax edge cases', () => {
  it('throws the native reduce TypeError on an empty array', () => {
    const resolver = new ConflictResolver() as unknown as {
      pickFirstMax: (memories: AgentEntity[], keyOf: (m: AgentEntity) => number) => AgentEntity;
    };
    expect(() => resolver.pickFirstMax([], () => 0)).toThrow(TypeError);
  });

  it('returns the sole element without calling keyOf', () => {
    const resolver = new ConflictResolver() as unknown as {
      pickFirstMax: (memories: AgentEntity[], keyOf: (m: AgentEntity) => number) => AgentEntity;
    };
    const only = memory('only', 'x');
    let calls = 0;
    expect(resolver.pickFirstMax([only], () => (calls++, 1))).toBe(only);
    expect(calls).toBe(0);
  });
});
