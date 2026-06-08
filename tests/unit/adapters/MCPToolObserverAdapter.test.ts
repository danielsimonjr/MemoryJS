/**
 * MCPToolObserverAdapter — Phase Tool C unit tests.
 *
 * Covers:
 * - wrapToolCall happy path: handler completes → observeComplete +
 *   resolved value returned
 * - wrapToolCall failure path: handler throws → observeError +
 *   error re-thrown
 * - extractToolName handles { name }, { tool }, { method, params: { name } }
 *   shapes and falls back to 'unknown'
 * - non-MCP envelope still runs observation under 'unknown' tool name
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCPToolObserverAdapter,
  extractToolName,
} from '../../../src/adapters/MCPToolObserverAdapter.js';
import { ToolCallObserver } from '../../../src/agent/ToolCallObserver.js';
import { ToolAffordanceManager } from '../../../src/agent/ToolAffordanceManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';
import { EntityNotFoundError, VersionConflictError } from '../../../src/utils/errors.js';
import { vi } from 'vitest';

function createMockStorage(): IGraphStorage & { _entities: Map<string, Entity> } {
  const entities = new Map<string, Entity>();
  return {
    _entities: entities,
    async appendEntity(entity: Entity) {
      entities.set(entity.name, entity);
    },
    async updateEntity(name: string, updates: Partial<Entity>): Promise<boolean> {
      const cur = entities.get(name);
      if (!cur) return false;
      entities.set(name, { ...cur, ...updates });
      return true;
    },
    getEntityByName(name: string): Entity | undefined {
      return entities.get(name);
    },
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: Array.from(entities.values()), relations: [] };
    },
  } as unknown as IGraphStorage & { _entities: Map<string, Entity> };
}

function createFakeEntityManager(storage: IGraphStorage): EntityManager {
  return {
    updateEntity: vi.fn(async (
      name: string,
      updates: Partial<Entity>,
      options?: { expectedVersion?: number },
    ) => {
      const entity = storage.getEntityByName(name);
      if (!entity) throw new EntityNotFoundError(name);
      if (options?.expectedVersion !== undefined) {
        const live = entity.version ?? 1;
        if (live !== options.expectedVersion) {
          throw new VersionConflictError(name, options.expectedVersion, live);
        }
      }
      const merged: Partial<Entity> = { ...updates };
      if (options?.expectedVersion !== undefined) {
        merged.version = (entity.version ?? 1) + 1;
      }
      const ok = await storage.updateEntity(name, merged);
      if (!ok) throw new EntityNotFoundError(name);
      return { ...entity, ...merged } as Entity;
    }),
    deleteEntities: vi.fn(),
  } as unknown as EntityManager;
}

describe('extractToolName', () => {
  it('reads the { name } shape directly', () => {
    expect(extractToolName({ name: 'shell.run' })).toBe('shell.run');
  });

  it('reads the { tool } shape', () => {
    expect(extractToolName({ tool: 'grep.search' })).toBe('grep.search');
  });

  it('reads the MCP tools/call shape', () => {
    expect(
      extractToolName({
        method: 'tools/call',
        params: { name: 'fs.write' },
      }),
    ).toBe('fs.write');
  });

  it('falls back to "unknown" for an unrecognized envelope', () => {
    expect(extractToolName({ foo: 'bar' })).toBe('unknown');
  });

  it('falls back to "unknown" for non-object input', () => {
    expect(extractToolName(null)).toBe('unknown');
    expect(extractToolName('string')).toBe('unknown');
    expect(extractToolName(undefined)).toBe('unknown');
  });
});

describe('MCPToolObserverAdapter', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let observer: ToolCallObserver;
  let adapter: MCPToolObserverAdapter;

  beforeEach(() => {
    storage = createMockStorage();
    const em = createFakeEntityManager(storage);
    const mgr = new ToolAffordanceManager(storage, em);
    observer = new ToolCallObserver(mgr);
    adapter = new MCPToolObserverAdapter(observer);
  });

  it('records observeComplete when the handler resolves', async () => {
    const result = await adapter.wrapToolCall(
      { name: 'shell.run' },
      async () => 'ok',
    );
    expect(result).toBe('ok');
    const rec = observer['manager' as keyof ToolCallObserver];
    // Indirect verification: the manager has a record for 'shell.run'.
    const stats = (observer as unknown as { manager: ToolAffordanceManager }).manager.rollingStats('shell.run');
    expect(stats?.success_rate).toBe(1);
    expect(stats?.total_calls).toBe(1);
    void rec;
  });

  it('records observeError and re-throws when the handler rejects', async () => {
    await expect(
      adapter.wrapToolCall(
        { name: 'shell.run' },
        async () => {
          throw new Error('command not found');
        },
      ),
    ).rejects.toThrow('command not found');

    const stats = (observer as unknown as { manager: ToolAffordanceManager }).manager.rollingStats('shell.run');
    expect(stats?.success_rate).toBe(0);
    expect(stats?.common_failure_modes).toContain('command not found');
  });

  it('observes under "unknown" when the envelope is non-MCP', async () => {
    await adapter.wrapToolCall(
      { not_an_envelope: true },
      async () => 'fine',
    );
    const stats = (observer as unknown as { manager: ToolAffordanceManager }).manager.rollingStats('unknown');
    expect(stats?.total_calls).toBe(1);
  });

  it('handles tools/call shape', async () => {
    await adapter.wrapToolCall(
      { method: 'tools/call', params: { name: 'fs.write' } },
      async () => 'wrote',
    );
    const stats = (observer as unknown as { manager: ToolAffordanceManager }).manager.rollingStats('fs.write');
    expect(stats?.total_calls).toBe(1);
  });
});
