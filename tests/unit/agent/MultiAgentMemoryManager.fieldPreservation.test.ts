/**
 * Regression: createAgentMemory keeps the caller's entity fields instead of
 * rebuilding the entity from the managed fields only.
 */

import { it, expect } from 'vitest';
import { MultiAgentMemoryManager } from '../../../src/agent/MultiAgentMemoryManager.js';
import { withBothBackends } from '../../helpers/tempStorage.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

withBothBackends('MultiAgentMemoryManager.createAgentMemory field preservation', (backend) => {
  it('keeps every caller-supplied entity field through creation and reload', async () => {
    const storage = backend.create();
    const manager = new MultiAgentMemoryManager(storage);
    // SQLite enforces parentId as a foreign key.
    await manager.createAgentMemory('default', { name: 'parent-entity' });
    const fields: Partial<AgentEntity> = {
      rootEntityName: 'fact_v1',
      parentEntityName: 'fact_v1',
      version: 2,
      tags: ['alpha', 'beta'],
      ttl: 3600000,
      projectId: 'proj-1',
      parentId: 'parent-entity',
      contentHash: 'a'.repeat(64),
      isLatest: true,
    };

    const created = await manager.createAgentMemory('default', { name: 'fact_v2', ...fields });
    for (const [key, value] of Object.entries(fields)) {
      expect(created[key as keyof AgentEntity], key).toEqual(value);
    }
    expect(created.agentId).toBe('default');
    expect(created.accessCount).toBe(0);

    const stored = (await storage.getEntityByName('fact_v2')) as AgentEntity | null;
    expect(stored).not.toBeNull();
    for (const [key, value] of Object.entries(fields)) {
      expect(stored![key as keyof AgentEntity], key).toEqual(value);
    }
  });
});
