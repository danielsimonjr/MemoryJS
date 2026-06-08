/**
 * RefIndex Unit Tests
 *
 * Covers Feature 1: Stable Index Dereferencing
 * Target: >90% coverage of RefIndex.ts, EntityManager ref methods,
 *         and the new error types in errors.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { RefIndex } from '../../../src/core/RefIndex.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { RefConflictError, RefNotFoundError, ValidationError } from '../../../src/utils/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory and return the cleanup fn */
async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = join(tmpdir(), `refindex-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
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

// ---------------------------------------------------------------------------
// RefIndex — core tests
// ---------------------------------------------------------------------------

describe('RefIndex', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let indexPath: string;
  let index: RefIndex;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    indexPath = join(dir, 'refs.jsonl');
    index = new RefIndex(indexPath);
  });

  afterEach(async () => {
    await cleanup();
  });

  // -------------------------------------------------------------------------
  describe('register / resolve round-trip', () => {
    it('stores a ref and resolves it to the entity name', async () => {
      await index.register('my-alias', 'Alice');
      const result = await index.resolve('my-alias');
      expect(result).toBe('Alice');
    });

    it('stores the description when provided', async () => {
      const entry = await index.register('step5', 'ToolOutput', 'Result of step 5');
      expect(entry.description).toBe('Result of step 5');
      expect(entry.ref).toBe('step5');
      expect(entry.entityName).toBe('ToolOutput');
      expect(entry.createdAt).toBeDefined();
    });

    it('omits description key when not provided', async () => {
      const entry = await index.register('no-desc', 'SomeEntity');
      expect('description' in entry).toBe(false);
    });

    it('returns the full RefEntry from register()', async () => {
      const entry = await index.register('alias1', 'EntityA');
      expect(entry).toMatchObject({
        ref: 'alias1',
        entityName: 'EntityA',
      });
      expect(typeof entry.createdAt).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  describe('duplicate register', () => {
    it('throws RefConflictError on duplicate alias', async () => {
      await index.register('dup', 'EntityA');
      await expect(index.register('dup', 'EntityB')).rejects.toBeInstanceOf(RefConflictError);
    });

    it('RefConflictError carries the correct ref in its message', async () => {
      await index.register('dup', 'EntityA');
      try {
        await index.register('dup', 'EntityB');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RefConflictError);
        expect((err as Error).message).toContain('dup');
      }
    });

    it('RefConflictError has the correct code', async () => {
      await index.register('dup', 'EntityA');
      try {
        await index.register('dup', 'EntityB');
      } catch (err) {
        expect((err as RefConflictError).code).toBe('REF_CONFLICT');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('resolve', () => {
    it('returns null for an unknown ref (no throw)', async () => {
      const result = await index.resolve('nonexistent');
      expect(result).toBeNull();
    });

    it('resolves to the correct entity among multiple refs', async () => {
      await index.register('ref-a', 'EntityA');
      await index.register('ref-b', 'EntityB');
      expect(await index.resolve('ref-a')).toBe('EntityA');
      expect(await index.resolve('ref-b')).toBe('EntityB');
    });
  });

  // -------------------------------------------------------------------------
  describe('refsForEntity', () => {
    it('returns all aliases for an entity', async () => {
      await index.register('alias1', 'Alice');
      await index.register('alias2', 'Alice');
      await index.register('alias3', 'Bob');

      const refs = await index.refsForEntity('Alice');
      expect(refs.sort()).toEqual(['alias1', 'alias2'].sort());
    });

    it('returns empty array when entity has no aliases', async () => {
      const refs = await index.refsForEntity('NoEntity');
      expect(refs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('deregister', () => {
    it('removes an alias so resolve returns null', async () => {
      await index.register('temp-alias', 'Alice');
      await index.deregister('temp-alias');
      expect(await index.resolve('temp-alias')).toBeNull();
    });

    it('is silent when alias does not exist', async () => {
      await expect(index.deregister('nonexistent')).resolves.toBeUndefined();
    });

    it('removes alias from refsForEntity after deregister', async () => {
      await index.register('alias1', 'Alice');
      await index.register('alias2', 'Alice');
      await index.deregister('alias1');
      const refs = await index.refsForEntity('Alice');
      expect(refs).toEqual(['alias2']);
    });
  });

  // -------------------------------------------------------------------------
  describe('purgeEntity', () => {
    it('removes all aliases for an entity and returns count', async () => {
      await index.register('ref1', 'Alice');
      await index.register('ref2', 'Alice');
      const count = await index.purgeEntity('Alice');
      expect(count).toBe(2);
      expect(await index.resolve('ref1')).toBeNull();
      expect(await index.resolve('ref2')).toBeNull();
    });

    it('returns 0 when entity has no aliases', async () => {
      const count = await index.purgeEntity('NonExistent');
      expect(count).toBe(0);
    });

    it('does not affect aliases of other entities', async () => {
      await index.register('ref-alice', 'Alice');
      await index.register('ref-bob', 'Bob');
      await index.purgeEntity('Alice');
      expect(await index.resolve('ref-bob')).toBe('Bob');
    });
  });

  // -------------------------------------------------------------------------
  describe('listRefs', () => {
    beforeEach(async () => {
      await index.register('ref1', 'Alice', 'First alias');
      await index.register('ref2', 'Alice', 'Second alias');
      await index.register('ref3', 'Bob');
    });

    it('returns all refs when no filter is provided', async () => {
      const all = await index.listRefs();
      expect(all).toHaveLength(3);
    });

    it('filters by entityName', async () => {
      const aliceRefs = await index.listRefs({ entityName: 'Alice' });
      expect(aliceRefs).toHaveLength(2);
      expect(aliceRefs.every(e => e.entityName === 'Alice')).toBe(true);
    });

    it('returns empty array when filter matches no refs', async () => {
      const result = await index.listRefs({ entityName: 'NoSuchEntity' });
      expect(result).toEqual([]);
    });

    it('each entry has the expected shape', async () => {
      const entries = await index.listRefs({ entityName: 'Alice' });
      for (const entry of entries) {
        expect(entry).toHaveProperty('ref');
        expect(entry).toHaveProperty('entityName', 'Alice');
        expect(entry).toHaveProperty('createdAt');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('stats', () => {
    it('reports total ref count', async () => {
      await index.register('ref1', 'Alice');
      await index.register('ref2', 'Bob');
      const s = await index.stats();
      expect(s.totalRefs).toBe(2);
    });

    it('reports 0 orphaned refs when no existing entity set is provided', async () => {
      await index.register('ref1', 'Alice');
      const s = await index.stats();
      expect(s.orphanedRefs).toBe(0);
    });

    it('reports orphaned refs when entity set is provided', async () => {
      await index.register('ref1', 'Alice');
      await index.register('ref2', 'Bob');
      // Bob is deleted; only Alice exists
      const s = await index.stats(new Set(['Alice']));
      expect(s.orphanedRefs).toBe(1);
    });

    it('includes lastRebuiltAt timestamp', async () => {
      const s = await index.stats();
      expect(typeof s.lastRebuiltAt).toBe('string');
      expect(s.lastRebuiltAt.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('JSONL persistence (write, reload, verify)', () => {
    it('persists entries across instances', async () => {
      // Write via first instance
      await index.register('persistent-ref', 'Alice', 'Survives reload');

      // Read via a fresh instance pointing to same file
      const index2 = new RefIndex(indexPath);
      const result = await index2.resolve('persistent-ref');
      expect(result).toBe('Alice');
    });

    it('reloads multiple entries correctly', async () => {
      await index.register('ref-a', 'EntityA');
      await index.register('ref-b', 'EntityB');

      const index2 = new RefIndex(indexPath);
      expect(await index2.resolve('ref-a')).toBe('EntityA');
      expect(await index2.resolve('ref-b')).toBe('EntityB');
    });

    it('persists deregister across reload', async () => {
      await index.register('ephemeral', 'Alice');
      await index.deregister('ephemeral');

      const index2 = new RefIndex(indexPath);
      expect(await index2.resolve('ephemeral')).toBeNull();
    });

    it('persists purgeEntity across reload', async () => {
      await index.register('ref1', 'Alice');
      await index.register('ref2', 'Alice');
      await index.purgeEntity('Alice');

      const index2 = new RefIndex(indexPath);
      expect(await index2.resolve('ref1')).toBeNull();
      expect(await index2.resolve('ref2')).toBeNull();
    });

    it('starts empty when sidecar file does not exist', async () => {
      const freshIndex = new RefIndex(join(dir, 'nonexistent-refs.jsonl'));
      const result = await freshIndex.resolve('anything');
      expect(result).toBeNull();
    });

    it('handles an empty sidecar file gracefully', async () => {
      await fs.writeFile(indexPath, '', 'utf-8');
      const freshIndex = new RefIndex(indexPath);
      const all = await freshIndex.listRefs();
      expect(all).toEqual([]);
    });

    it('JSONL file contains one JSON object per line', async () => {
      await index.register('r1', 'E1');
      await index.register('r2', 'E2');

      const raw = await fs.readFile(indexPath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim() !== '');
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// EntityManager ref integration tests
// ---------------------------------------------------------------------------

describe('EntityManager — ref integration', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let storagePath: string;
  let refIndexPath: string;
  let storage: GraphStorage;
  let manager: EntityManager;
  let refIndex: RefIndex;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    storagePath = join(dir, 'graph.jsonl');
    refIndexPath = join(dir, 'refs.jsonl');

    storage = new GraphStorage(storagePath);
    manager = new EntityManager(storage);
    refIndex = new RefIndex(refIndexPath);
    manager.setRefIndex(refIndex);

    // Seed one entity
    await manager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['Engineer'] },
    ]);
  });

  afterEach(async () => {
    await cleanup();
  });

  // -------------------------------------------------------------------------
  describe('resolveRef', () => {
    it('resolves a registered alias to the full entity', async () => {
      await refIndex.register('main-person', 'Alice');
      const entity = await manager.resolveRef('main-person');
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Alice');
      expect(entity!.entityType).toBe('person');
    });

    it('returns null when alias is unknown', async () => {
      const entity = await manager.resolveRef('nonexistent-alias');
      expect(entity).toBeNull();
    });

    it('returns null when alias points to a deleted entity', async () => {
      await refIndex.register('gone', 'Alice');
      await manager.deleteEntities(['Alice']);
      // After purge the alias should be gone
      const entity = await manager.resolveRef('gone');
      expect(entity).toBeNull();
    });

    it('throws ValidationError when no RefIndex is configured', async () => {
      const bareManager = new EntityManager(storage);
      await expect(bareManager.resolveRef('x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  describe('registerRef', () => {
    it('creates an alias via the entity manager', async () => {
      const entry = await manager.registerRef('em-alias', 'Alice', 'Via entity manager');
      expect(entry.ref).toBe('em-alias');
      expect(entry.entityName).toBe('Alice');
    });

    it('throws RefConflictError for duplicate alias', async () => {
      await manager.registerRef('dup', 'Alice');
      await expect(manager.registerRef('dup', 'Alice')).rejects.toBeInstanceOf(RefConflictError);
    });

    it('throws ValidationError when no RefIndex is configured', async () => {
      const bareManager = new EntityManager(storage);
      await expect(bareManager.registerRef('x', 'Alice')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  describe('deregisterRef', () => {
    it('removes an alias via the entity manager', async () => {
      await manager.registerRef('removable', 'Alice');
      await manager.deregisterRef('removable');
      expect(await refIndex.resolve('removable')).toBeNull();
    });

    it('throws ValidationError when no RefIndex is configured', async () => {
      const bareManager = new EntityManager(storage);
      await expect(bareManager.deregisterRef('x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  describe('listRefs', () => {
    it('lists all aliases via the entity manager', async () => {
      await manager.registerRef('ref1', 'Alice');
      await manager.registerRef('ref2', 'Alice');
      const all = await manager.listRefs();
      expect(all).toHaveLength(2);
    });

    it('filters by entityName', async () => {
      await manager.registerRef('ref-alice', 'Alice');

      // Create a second entity and register an alias for it
      await manager.createEntities([
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);
      await manager.registerRef('ref-bob', 'Bob');

      const aliceOnly = await manager.listRefs({ entityName: 'Alice' });
      expect(aliceOnly).toHaveLength(1);
      expect(aliceOnly[0].ref).toBe('ref-alice');
    });

    it('throws ValidationError when no RefIndex is configured', async () => {
      const bareManager = new EntityManager(storage);
      await expect(bareManager.listRefs()).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteEntities — purges refs', () => {
    it('removes aliases when entity is deleted', async () => {
      await manager.registerRef('alice-ref', 'Alice');
      await manager.deleteEntities(['Alice']);
      expect(await refIndex.resolve('alice-ref')).toBeNull();
    });

    it('removes multiple aliases for the same entity on delete', async () => {
      await manager.registerRef('alice-1', 'Alice');
      await manager.registerRef('alice-2', 'Alice');
      await manager.deleteEntities(['Alice']);
      expect(await refIndex.resolve('alice-1')).toBeNull();
      expect(await refIndex.resolve('alice-2')).toBeNull();
    });

    it('only purges aliases for the deleted entity', async () => {
      await manager.createEntities([
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);
      await manager.registerRef('alice-alias', 'Alice');
      await manager.registerRef('bob-alias', 'Bob');

      await manager.deleteEntities(['Alice']);

      expect(await refIndex.resolve('alice-alias')).toBeNull();
      expect(await refIndex.resolve('bob-alias')).toBe('Bob');
    });

    it('does not error when deleted entity has no aliases', async () => {
      await expect(manager.deleteEntities(['Alice'])).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Error types — standalone verification
// ---------------------------------------------------------------------------

describe('RefConflictError', () => {
  it('is an instance of Error', () => {
    const err = new RefConflictError('my-ref');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name RefConflictError', () => {
    const err = new RefConflictError('my-ref');
    expect(err.name).toBe('RefConflictError');
  });

  it('has code REF_CONFLICT', () => {
    const err = new RefConflictError('my-ref');
    expect(err.code).toBe('REF_CONFLICT');
  });

  it('message contains the ref', () => {
    const err = new RefConflictError('test-alias');
    expect(err.message).toContain('test-alias');
  });
});

describe('RefNotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new RefNotFoundError('missing-ref');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name RefNotFoundError', () => {
    const err = new RefNotFoundError('missing-ref');
    expect(err.name).toBe('RefNotFoundError');
  });

  it('has code REF_NOT_FOUND', () => {
    const err = new RefNotFoundError('missing-ref');
    expect(err.code).toBe('REF_NOT_FOUND');
  });

  it('message contains the ref', () => {
    const err = new RefNotFoundError('the-ref');
    expect(err.message).toContain('the-ref');
  });
});
