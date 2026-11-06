/**
 * AgentMemoryManager.collaborativeSynthesis: lazy-once construction.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AgentMemoryManager } from '../../../src/agent/AgentMemoryManager.js';
import { CollaborativeSynthesis } from '../../../src/agent/CollaborativeSynthesis.js';
import { createStorageFromPath } from '../../../src/core/StorageFactory.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';

afterEach(() => {
  cleanupTempDirs();
});

describe('AgentMemoryManager.collaborativeSynthesis', () => {
  it('builds a CollaborativeSynthesis once and returns the same instance', () => {
    const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
    const manager = new AgentMemoryManager(storage);
    const first = manager.collaborativeSynthesis;
    expect(first).toBeInstanceOf(CollaborativeSynthesis);
    expect(manager.collaborativeSynthesis).toBe(first);
  });
});
