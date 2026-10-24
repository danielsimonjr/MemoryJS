/**
 * Working Memory Guard
 *
 * Looks up a working memory entity and checks its type before a write.
 *
 * @module agent/workingMemoryGuard
 */

import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity } from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';

/**
 * Returns the working memory entity with the given name.
 * Reads the entity once from storage.
 * Throws when the entity is missing, is not an AgentEntity, or is not working memory.
 * Each error text names the entity.
 * This function runs synchronously.
 */
export function requireWorkingMemoryEntity(
  storage: Pick<IGraphStorage, 'getEntityByName'>,
  entityName: string
): AgentEntity {
  const entity = storage.getEntityByName(entityName);
  if (!entity) {
    throw new Error(`Entity not found: ${entityName}`);
  }

  if (!isAgentEntity(entity)) {
    throw new Error(`Entity is not an AgentEntity: ${entityName}`);
  }

  if (entity.memoryType !== 'working') {
    throw new Error(`Entity is not working memory: ${entityName}`);
  }

  return entity;
}
