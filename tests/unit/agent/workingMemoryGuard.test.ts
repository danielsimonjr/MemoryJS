/**
 * workingMemoryGuard Unit Tests
 *
 * Tests for the lookup that WorkingMemoryManager and ConsolidationPipeline run
 * before they write a working memory entity: the entity that comes back, the error
 * texts, and the single read from storage.
 */

import { describe, it, expect, vi } from 'vitest';
import { requireWorkingMemoryEntity } from '../../../src/agent/workingMemoryGuard.js';
import type { Entity, IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

/** Builds an entity that passes the AgentEntity check, with the given overrides. */
function agentEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name: 'wm-1',
    entityType: 'working_memory',
    observations: [],
    memoryType: 'working',
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
    ...overrides,
  } as AgentEntity;
}

/** Storage whose getEntityByName logs each call (name and receiver) and returns `found`. */
function storageReturning(found: unknown) {
  const calls: Array<{ self: unknown; args: unknown[] }> = [];
  const storage = {
    getEntityByName(this: unknown, ...args: unknown[]) {
      calls.push({ self: this, args });
      return found as Entity | undefined;
    },
  };
  return { storage: storage as unknown as IGraphStorage, calls };
}

describe('requireWorkingMemoryEntity', () => {
  it('returns the entity object that storage holds, not a copy', () => {
    const entity = agentEntity();
    const { storage } = storageReturning(entity);
    expect(requireWorkingMemoryEntity(storage, 'wm-1')).toBe(entity);
  });

  it('reads storage once, as a method of storage, with the name unchanged', () => {
    const { storage, calls } = storageReturning(agentEntity());
    requireWorkingMemoryEntity(storage, '  wm-1\t');
    expect(calls).toHaveLength(1);
    expect(calls[0].self).toBe(storage);
    expect(calls[0].args).toStrictEqual(['  wm-1\t']);
  });

  it('works with a storage object that offers only getEntityByName', () => {
    const entity = agentEntity();
    const getEntityByName = vi.fn(() => entity as Entity);
    expect(requireWorkingMemoryEntity({ getEntityByName }, 'wm-1')).toBe(entity);
    expect(getEntityByName).toHaveBeenCalledTimes(1);
  });

  it('throws when the entity is missing, and the text names the entity', () => {
    const { storage, calls } = storageReturning(undefined);
    expect(() => requireWorkingMemoryEntity(storage, ' gone ')).toThrow(new Error('Entity not found:  gone '));
    expect(calls).toHaveLength(1);
  });

  it('throws when the entity is not an AgentEntity, and the text names the entity', () => {
    const plain: Entity = { name: 'plain', entityType: 'note', observations: [] };
    const { storage } = storageReturning(plain);
    expect(() => requireWorkingMemoryEntity(storage, 'plain')).toThrow(new Error('Entity is not an AgentEntity: plain'));
  });

  it('throws when the entity is not working memory, and the text names the entity', () => {
    const { storage } = storageReturning(agentEntity({ memoryType: 'episodic' }));
    expect(() => requireWorkingMemoryEntity(storage, 'wm-1')).toThrow(new Error('Entity is not working memory: wm-1'));
  });

  it('checks the entity type before the memory type', () => {
    const { storage } = storageReturning({ name: 'x', entityType: 'note', observations: [], memoryType: 'episodic' });
    expect(() => requireWorkingMemoryEntity(storage, 'x')).toThrow('Entity is not an AgentEntity: x');
  });

  it('throws the error synchronously, not as a rejected promise', () => {
    const { storage } = storageReturning(undefined);
    let result: unknown;
    expect(() => {
      result = requireWorkingMemoryEntity(storage, 'gone');
    }).toThrow('Entity not found: gone');
    expect(result).toBeUndefined();
  });

  it('lets an error of storage pass unchanged', () => {
    const boom = new Error('storage down');
    const storage = {
      getEntityByName() {
        throw boom;
      },
    };
    expect(() => requireWorkingMemoryEntity(storage, 'wm-1')).toThrow(boom);
  });
});
