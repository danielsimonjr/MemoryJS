/**
 * η.5.5.c — Optimistic Concurrency Control on EntityManager.updateEntity
 *
 * When `options.expectedVersion` is supplied, the live entity's `version`
 * must match or `VersionConflictError` is thrown. On success, `version`
 * auto-increments. Omitting the option preserves legacy LWW semantics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { EntityNotFoundError, VersionConflictError } from '../../../src/utils/errors.js';

describe('η.5.5.c Optimistic Concurrency Control', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `occ-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('omitting expectedVersion preserves last-write-wins behavior (no version bump)', async () => {
    await entityManager.createEntities([
      { name: 'A', entityType: 't', observations: [] },
    ]);
    await entityManager.updateEntity('A', { importance: 5 });
    const e = await entityManager.getEntity('A');
    expect(e?.importance).toBe(5);
    expect(e?.version).toBeUndefined(); // legacy entities stay version-less
  });

  it('matching expectedVersion succeeds and auto-increments version', async () => {
    await entityManager.createEntities([
      { name: 'B', entityType: 't', observations: [] },
    ]);
    // Legacy entity has no version field — treated as version 1.
    const updated = await entityManager.updateEntity(
      'B',
      { importance: 7 },
      { expectedVersion: 1 },
    );
    expect(updated.version).toBe(2);
    expect(updated.importance).toBe(7);
  });

  it('mismatched expectedVersion throws VersionConflictError with expected/actual', async () => {
    await entityManager.createEntities([
      { name: 'C', entityType: 't', observations: [] },
    ]);
    // First OCC write bumps version to 2.
    await entityManager.updateEntity('C', { importance: 3 }, { expectedVersion: 1 });

    // Second caller asserts they still hold version 1 — should conflict.
    let caught: VersionConflictError | undefined;
    try {
      await entityManager.updateEntity('C', { importance: 9 }, { expectedVersion: 1 });
    } catch (e) {
      if (e instanceof VersionConflictError) caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught?.entityName).toBe('C');
    expect(caught?.expected).toBe(1);
    expect(caught?.actual).toBe(2);

    // Live state unchanged from the first OCC write.
    const live = await entityManager.getEntity('C');
    expect(live?.importance).toBe(3);
    expect(live?.version).toBe(2);
  });

  it('chains correctly across multiple OCC writes', async () => {
    await entityManager.createEntities([
      { name: 'D', entityType: 't', observations: [] },
    ]);
    let updated = await entityManager.updateEntity('D', { importance: 1 }, { expectedVersion: 1 });
    expect(updated.version).toBe(2);
    updated = await entityManager.updateEntity('D', { importance: 2 }, { expectedVersion: 2 });
    expect(updated.version).toBe(3);
    updated = await entityManager.updateEntity('D', { importance: 3 }, { expectedVersion: 3 });
    expect(updated.version).toBe(4);
  });

  it('OCC respects an entity that was preset to a higher version', async () => {
    await entityManager.createEntities([
      { name: 'E', entityType: 't', observations: [] },
    ]);
    // Caller sets version=5 directly (e.g., via supersession resolution).
    await entityManager.updateEntity('E', { version: 5 });

    // Now an OCC writer asserting version=1 should conflict.
    await expect(
      entityManager.updateEntity('E', { importance: 9 }, { expectedVersion: 1 }),
    ).rejects.toThrow(VersionConflictError);

    // OCC writer with the correct version succeeds and bumps to 6.
    const updated = await entityManager.updateEntity(
      'E',
      { importance: 9 },
      { expectedVersion: 5 },
    );
    expect(updated.version).toBe(6);
  });

  it('throws EntityNotFoundError when entity does not exist (regardless of expectedVersion)', async () => {
    await expect(
      entityManager.updateEntity('Ghost', { importance: 9 }, { expectedVersion: 1 }),
    ).rejects.toThrow(EntityNotFoundError);
  });

  it('non-OCC writes do NOT auto-increment version (preserves legacy semantics)', async () => {
    await entityManager.createEntities([
      { name: 'F', entityType: 't', observations: [] },
    ]);
    await entityManager.updateEntity('F', { version: 3 });
    // Subsequent non-OCC update leaves version at 3.
    await entityManager.updateEntity('F', { importance: 7 });
    const e = await entityManager.getEntity('F');
    expect(e?.version).toBe(3);
    expect(e?.importance).toBe(7);
  });
});
