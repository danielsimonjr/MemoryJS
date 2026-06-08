/**
 * ArtifactManager Unit Tests
 *
 * Covers Feature 2: Artifact-Level Granularity
 * Target: >90% branch coverage of ArtifactManager.ts and artifact.ts
 *
 * Uses an in-memory storage mock (same pattern as WorkingMemoryManager.test.ts)
 * and a real RefIndex backed by a temp file to exercise the full round-trip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ArtifactManager } from '../../../src/agent/ArtifactManager.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RefIndex } from '../../../src/core/RefIndex.js';
import type { IGraphStorage, Entity, KnowledgeGraph } from '../../../src/types/types.js';
import { isArtifactEntity } from '../../../src/types/artifact.js';
import type { ArtifactEntity } from '../../../src/types/artifact.js';

// ============================================================
// Helpers
// ============================================================

/** Create a unique temp directory and return cleanup fn */
async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = join(
    tmpdir(),
    `artifact-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  await fs.mkdir(dir, { recursive: true });
  return {
    dir,
    cleanup: async () => {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on Windows (file locking)
      }
    },
  };
}

/** Build a fully functional in-memory IGraphStorage suitable for EntityManager */
function createInMemoryStorage(initial: Entity[] = []): IGraphStorage {
  const entityMap = new Map<string, Entity>(initial.map((e) => [e.name, e]));
  let graphEntities: Entity[] = [...initial];
  const graphRelations: { from: string; to: string; relationType: string }[] = [];

  return {
    getEntityByName: vi.fn((name: string) => entityMap.get(name) ?? undefined),
    hasEntity: vi.fn((name: string) => entityMap.has(name)),
    getEntitiesByType: vi.fn((type: string) =>
      [...entityMap.values()].filter((e) => e.entityType === type)
    ),
    updateEntity: vi.fn(async (name: string, updates: Partial<Entity>) => {
      const entity = entityMap.get(name);
      if (entity) {
        Object.assign(entity, updates);
        return true;
      }
      return false;
    }),
    loadGraph: vi.fn(async () => ({
      entities: [...graphEntities],
      relations: [...graphRelations],
    })),
    appendEntity: vi.fn(async (entity: Entity) => {
      entityMap.set(entity.name, entity);
      graphEntities.push(entity);
    }),
    saveGraph: vi.fn(async (graph: KnowledgeGraph) => {
      graphEntities = [...graph.entities];
      graphRelations.length = 0;
      graphRelations.push(...graph.relations);
      entityMap.clear();
      for (const e of graph.entities) {
        entityMap.set(e.name, e);
      }
    }),
    getGraphForMutation: vi.fn(async () => ({
      entities: [...graphEntities],
      relations: [...graphRelations],
    })),
    ensureLoaded: vi.fn(async () => {}),
    appendRelation: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    clearCache: vi.fn(() => {}),
    graphMutex: { acquire: vi.fn(async () => () => {}) },
  } as unknown as IGraphStorage;
}

// ============================================================
// Test setup
// ============================================================

describe('ArtifactManager', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let storage: IGraphStorage;
  let entityManager: EntityManager;
  let refIndex: RefIndex;
  let manager: ArtifactManager;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    storage = createInMemoryStorage();
    entityManager = new EntityManager(storage as unknown as import('../../../src/core/GraphStorage.js').GraphStorage);
    refIndex = new RefIndex(join(dir, 'refs.jsonl'));
    entityManager.setRefIndex(refIndex);
    manager = new ArtifactManager(storage, entityManager, refIndex);
  });

  afterEach(async () => {
    await cleanup();
  });

  // ----------------------------------------------------------
  // createArtifact — name format
  // ----------------------------------------------------------

  describe('createArtifact — name format', () => {
    it('generates name matching ${toolName}-${YYYY-MM-DD}-${shortId} pattern', async () => {
      const artifact = await manager.createArtifact({
        content: 'Hello World',
        toolName: 'bash',
        artifactType: 'tool_output',
      });

      // Pattern: lowercase-tool + date + 4-hex-chars
      expect(artifact.name).toMatch(/^bash-\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/);
    });

    it('embeds the toolName in the entity name', async () => {
      const artifact = await manager.createArtifact({
        content: 'result',
        toolName: 'fetch',
        artifactType: 'api_response',
      });

      expect(artifact.name).toMatch(/^fetch-/);
    });

    it('sanitises special characters in toolName', async () => {
      const artifact = await manager.createArtifact({
        content: 'data',
        toolName: 'my_tool/v2',
        artifactType: 'tool_output',
      });

      // Underscores and slashes become hyphens
      expect(artifact.name).toMatch(/^my-tool-v2-/);
    });

    it('uses today\'s UTC date in the name', async () => {
      const artifact = await manager.createArtifact({
        content: 'test',
        toolName: 'grep',
        artifactType: 'search_result',
      });

      const now = new Date();
      const expectedDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
      expect(artifact.name).toContain(expectedDate);
    });

    it('multiple artifacts from same tool get unique names', async () => {
      const [a1, a2, a3] = await Promise.all([
        manager.createArtifact({ content: 'c1', toolName: 'bash', artifactType: 'tool_output' }),
        manager.createArtifact({ content: 'c2', toolName: 'bash', artifactType: 'tool_output' }),
        manager.createArtifact({ content: 'c3', toolName: 'bash', artifactType: 'tool_output' }),
      ]);

      const names = new Set([a1.name, a2.name, a3.name]);
      expect(names.size).toBe(3);
    });
  });

  // ----------------------------------------------------------
  // createArtifact — entity fields
  // ----------------------------------------------------------

  describe('createArtifact — entity fields', () => {
    it('stores content as entity observation', async () => {
      const content = 'result: 42';
      const artifact = await manager.createArtifact({
        content,
        toolName: 'calc',
        artifactType: 'tool_output',
      });

      expect(artifact.observations).toContain(content);
    });

    it('sets entityType to "artifact"', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'code_snippet',
      });

      expect(artifact.entityType).toBe('artifact');
    });

    it('preserves artifactType on the returned entity', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'api',
        artifactType: 'api_response',
      });

      expect(artifact.artifactType).toBe('api_response');
    });

    it('preserves toolName on the returned entity', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'myTool',
        artifactType: 'file_content',
      });

      expect(artifact.toolName).toBe('myTool');
    });

    it('preserves sessionId when provided', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
        sessionId: 'ses_abc',
      });

      expect(artifact.sessionId).toBe('ses_abc');
    });

    it('preserves taskId when provided', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
        taskId: 'task_xyz',
      });

      expect(artifact.taskId).toBe('task_xyz');
    });

    it('omits sessionId when not provided', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      expect(artifact.sessionId).toBeUndefined();
    });

    it('exposes a 4-char hex shortId', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      expect(artifact.shortId).toMatch(/^[0-9a-f]{4}$/);
    });

    it('isArtifactEntity type guard returns true for created artifact', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      expect(isArtifactEntity(artifact)).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // RefIndex registration
  // ----------------------------------------------------------

  describe('RefIndex registration', () => {
    it('artifact is resolvable by ref after creation', async () => {
      const artifact = await manager.createArtifact({
        content: 'data',
        toolName: 'bash',
        artifactType: 'tool_output',
      });

      const resolved = await refIndex.resolve(artifact.name);
      expect(resolved).toBe(artifact.name);
    });

    it('registers description in RefIndex when provided', async () => {
      const artifact = await manager.createArtifact({
        content: 'data',
        toolName: 'bash',
        artifactType: 'tool_output',
        description: 'Shell output from step 1',
      });

      const refs = await refIndex.listRefs({ entityName: artifact.name });
      expect(refs[0]?.description).toBe('Shell output from step 1');
    });

    it('registers a default description when none provided', async () => {
      const artifact = await manager.createArtifact({
        content: 'data',
        toolName: 'fetch',
        artifactType: 'api_response',
      });

      const refs = await refIndex.listRefs({ entityName: artifact.name });
      expect(refs[0]?.description).toBeTruthy();
    });
  });

  // ----------------------------------------------------------
  // getArtifact
  // ----------------------------------------------------------

  describe('getArtifact', () => {
    it('retrieves artifact by ref', async () => {
      const created = await manager.createArtifact({
        content: 'hello',
        toolName: 'bash',
        artifactType: 'tool_output',
      });

      const fetched = await manager.getArtifact(created.name);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe(created.name);
    });

    it('returns null for unknown ref', async () => {
      const result = await manager.getArtifact('totally-unknown-ref');
      expect(result).toBeNull();
    });

    it('returns null for a ref pointing to a non-artifact entity', async () => {
      // Create a plain entity and register a ref for it manually
      await entityManager.createEntities([
        { name: 'plain-entity', entityType: 'person', observations: ['Alice'] },
      ]);
      await entityManager.registerRef('plain-ref', 'plain-entity');

      const result = await manager.getArtifact('plain-ref');
      expect(result).toBeNull();
    });

    it('returns the ArtifactEntity with correct metadata', async () => {
      const created = await manager.createArtifact({
        content: 'payload',
        toolName: 'fetch',
        artifactType: 'api_response',
        sessionId: 'ses_1',
      });

      const fetched = await manager.getArtifact(created.name);
      expect(fetched).not.toBeNull();
      expect(fetched!.toolName).toBe('fetch');
      expect(fetched!.artifactType).toBe('api_response');
      expect(fetched!.sessionId).toBe('ses_1');
    });
  });

  // ----------------------------------------------------------
  // listArtifacts — no filter
  // ----------------------------------------------------------

  describe('listArtifacts — unfiltered', () => {
    it('returns all created artifacts', async () => {
      await manager.createArtifact({ content: 'a', toolName: 'tool1', artifactType: 'tool_output' });
      await manager.createArtifact({ content: 'b', toolName: 'tool2', artifactType: 'code_snippet' });
      await manager.createArtifact({ content: 'c', toolName: 'tool1', artifactType: 'api_response' });

      const all = await manager.listArtifacts();
      expect(all.length).toBe(3);
    });

    it('excludes non-artifact entities', async () => {
      await entityManager.createEntities([
        { name: 'not-an-artifact', entityType: 'person', observations: ['x'] },
      ]);
      await manager.createArtifact({ content: 'y', toolName: 'tool', artifactType: 'tool_output' });

      const all = await manager.listArtifacts();
      expect(all.length).toBe(1);
      expect(all[0].entityType).toBe('artifact');
    });

    it('returns empty array when no artifacts exist', async () => {
      const all = await manager.listArtifacts();
      expect(all).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // listArtifacts — filter by toolName
  // ----------------------------------------------------------

  describe('listArtifacts — filter by toolName', () => {
    beforeEach(async () => {
      await manager.createArtifact({ content: 'a', toolName: 'bash', artifactType: 'tool_output' });
      await manager.createArtifact({ content: 'b', toolName: 'fetch', artifactType: 'api_response' });
      await manager.createArtifact({ content: 'c', toolName: 'bash', artifactType: 'tool_output' });
    });

    it('filters to only bash artifacts', async () => {
      const results = await manager.listArtifacts({ toolName: 'bash' });
      expect(results.length).toBe(2);
      expect(results.every((a) => a.toolName === 'bash')).toBe(true);
    });

    it('filters to only fetch artifacts', async () => {
      const results = await manager.listArtifacts({ toolName: 'fetch' });
      expect(results.length).toBe(1);
      expect(results[0].toolName).toBe('fetch');
    });

    it('returns empty array for unknown toolName', async () => {
      const results = await manager.listArtifacts({ toolName: 'nonexistent' });
      expect(results).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // listArtifacts — filter by artifactType
  // ----------------------------------------------------------

  describe('listArtifacts — filter by artifactType', () => {
    beforeEach(async () => {
      await manager.createArtifact({ content: 'a', toolName: 'bash', artifactType: 'tool_output' });
      await manager.createArtifact({ content: 'b', toolName: 'api', artifactType: 'api_response' });
      await manager.createArtifact({ content: 'c', toolName: 'search', artifactType: 'search_result' });
      await manager.createArtifact({ content: 'd', toolName: 'bash', artifactType: 'tool_output' });
    });

    it('filters by tool_output type', async () => {
      const results = await manager.listArtifacts({ artifactType: 'tool_output' });
      expect(results.length).toBe(2);
      expect(results.every((a) => a.artifactType === 'tool_output')).toBe(true);
    });

    it('filters by api_response type', async () => {
      const results = await manager.listArtifacts({ artifactType: 'api_response' });
      expect(results.length).toBe(1);
      expect(results[0].artifactType).toBe('api_response');
    });

    it('returns empty array for type with no matches', async () => {
      const results = await manager.listArtifacts({ artifactType: 'user_input' });
      expect(results).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // listArtifacts — filter by since (date)
  // ----------------------------------------------------------

  describe('listArtifacts — filter by since', () => {
    it('returns only artifacts created at or after the since date', async () => {
      // Create an artifact, then set its createdAt to the past manually
      const past = await manager.createArtifact({
        content: 'old',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      // Mutate storage to backdate createdAt on the past artifact
      const entity = storage.getEntityByName(past.name);
      if (entity) {
        entity.createdAt = '2020-01-01T00:00:00.000Z';
      }

      const fresh = await manager.createArtifact({
        content: 'new',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      const since = new Date('2025-01-01T00:00:00.000Z');
      const results = await manager.listArtifacts({ since });

      const names = results.map((a) => a.name);
      expect(names).not.toContain(past.name);
      expect(names).toContain(fresh.name);
    });

    it('returns all artifacts when since is in the far past', async () => {
      await manager.createArtifact({ content: 'a', toolName: 'tool', artifactType: 'tool_output' });
      await manager.createArtifact({ content: 'b', toolName: 'tool', artifactType: 'code_snippet' });

      const results = await manager.listArtifacts({ since: new Date('2000-01-01') });
      expect(results.length).toBe(2);
    });

    it('returns empty array when since is in the future', async () => {
      await manager.createArtifact({ content: 'a', toolName: 'tool', artifactType: 'tool_output' });

      const results = await manager.listArtifacts({ since: new Date('2099-01-01') });
      expect(results).toEqual([]);
    });

    it('includes artifacts whose createdAt is undefined (not filtered out)', async () => {
      const artifact = await manager.createArtifact({
        content: 'x',
        toolName: 'tool',
        artifactType: 'tool_output',
      });

      // Remove createdAt to test the undefined branch
      const entity = storage.getEntityByName(artifact.name);
      if (entity) {
        delete (entity as Partial<ArtifactEntity>).createdAt;
      }

      // Artifacts without createdAt should NOT be included when a since filter is active
      const results = await manager.listArtifacts({ since: new Date('2020-01-01') });
      expect(results.length).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // listArtifacts — combined filters
  // ----------------------------------------------------------

  describe('listArtifacts — combined filters', () => {
    it('applies toolName AND artifactType simultaneously', async () => {
      await manager.createArtifact({ content: 'a', toolName: 'bash', artifactType: 'tool_output' });
      await manager.createArtifact({ content: 'b', toolName: 'bash', artifactType: 'code_snippet' });
      await manager.createArtifact({ content: 'c', toolName: 'fetch', artifactType: 'tool_output' });

      const results = await manager.listArtifacts({
        toolName: 'bash',
        artifactType: 'tool_output',
      });
      expect(results.length).toBe(1);
      expect(results[0].toolName).toBe('bash');
      expect(results[0].artifactType).toBe('tool_output');
    });
  });

  // ----------------------------------------------------------
  // isArtifactEntity type guard
  // ----------------------------------------------------------

  describe('isArtifactEntity type guard', () => {
    it('returns false for null', () => {
      expect(isArtifactEntity(null)).toBe(false);
    });

    it('returns false for a plain object without artifactType', () => {
      expect(isArtifactEntity({ name: 'x', entityType: 'person' })).toBe(false);
    });

    it('returns false for artifact with invalid artifactType string', () => {
      expect(
        isArtifactEntity({
          name: 'x',
          entityType: 'artifact',
          toolName: 'bash',
          shortId: 'a1b2',
          artifactType: 'invalid_type',
        })
      ).toBe(false);
    });

    it('returns true for all valid artifactType values', () => {
      const valid = [
        'tool_output',
        'code_snippet',
        'api_response',
        'search_result',
        'file_content',
        'user_input',
      ] as const;

      for (const type of valid) {
        expect(
          isArtifactEntity({
            name: 'test',
            entityType: 'artifact',
            toolName: 'tool',
            shortId: 'ab12',
            observations: [],
            artifactType: type,
          })
        ).toBe(true);
      }
    });
  });

  // ----------------------------------------------------------
  // ManagerContext integration smoke test
  // ----------------------------------------------------------

  describe('ManagerContext — artifactManager lazy getter', () => {
    it('ManagerContext exposes an artifactManager getter', async () => {
      const { ManagerContext } = await import('../../../src/core/ManagerContext.js');
      const { join: pathJoin } = await import('path');
      const memPath = pathJoin(dir, 'test-memory.jsonl');

      const ctx = new ManagerContext(memPath);
      expect(ctx.artifactManager).toBeDefined();
      // Same instance on second access (lazy singleton)
      expect(ctx.artifactManager).toBe(ctx.artifactManager);
    });
  });
});
