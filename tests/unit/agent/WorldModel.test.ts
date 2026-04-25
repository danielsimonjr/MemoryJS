/**
 * 3B.7 — WorldModelManager + WorldStateSnapshot Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { WorldStateSnapshot, WorldModelManager } from '../../../src/agent/world/index.js';
import type { WorldStateEntity } from '../../../src/agent/world/index.js';

describe('3B.7 WorldStateSnapshot', () => {
  function entity(name: string, overrides: Partial<WorldStateEntity> = {}): WorldStateEntity {
    return {
      name,
      entityType: 't',
      importance: 5,
      confidence: 0.8,
      observationCount: 1,
      tags: ['x'],
      lastModified: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  describe('construction + accessors', () => {
    it('exposes size and entities in insertion order', () => {
      const snap = new WorldStateSnapshot([entity('A'), entity('B'), entity('C')]);
      expect(snap.size).toBe(3);
      expect(snap.entities().map(e => e.name)).toEqual(['A', 'B', 'C']);
    });

    it('takenAt defaults to current time', () => {
      const before = new Date().toISOString();
      const snap = new WorldStateSnapshot([entity('A')]);
      expect(snap.takenAt >= before).toBe(true);
    });
  });

  describe('diffTo', () => {
    it('reports added/removed/modified correctly', () => {
      const before = new WorldStateSnapshot([entity('A'), entity('B')]);
      const after = new WorldStateSnapshot([
        entity('B', { importance: 7 }), // modified
        entity('C'), // added
      ]);
      const change = before.diffTo(after);
      expect(change.removed.map(e => e.name)).toEqual(['A']);
      expect(change.added.map(e => e.name)).toEqual(['C']);
      expect(change.modified).toHaveLength(1);
      expect(change.modified[0].name).toBe('B');
      expect(change.modified[0].fields).toContain('importance');
    });

    it('reports tag changes via set comparison (order-insensitive)', () => {
      const before = new WorldStateSnapshot([entity('A', { tags: ['x', 'y'] })]);
      const after = new WorldStateSnapshot([entity('A', { tags: ['y', 'x'] })]);
      // Same set, different order — should NOT be reported as modified.
      expect(before.diffTo(after).modified).toHaveLength(0);
    });

    it('detects an entity-type change as modified', () => {
      const before = new WorldStateSnapshot([entity('A', { entityType: 'old' })]);
      const after = new WorldStateSnapshot([entity('A', { entityType: 'new' })]);
      const mods = before.diffTo(after).modified;
      expect(mods).toHaveLength(1);
      expect(mods[0].fields).toContain('entityType');
    });

    it('returns no changes for identical snapshots', () => {
      const a = entity('A');
      const before = new WorldStateSnapshot([a]);
      const after = new WorldStateSnapshot([{ ...a }]);
      const change = before.diffTo(after);
      expect(change.removed).toEqual([]);
      expect(change.added).toEqual([]);
      expect(change.modified).toEqual([]);
    });
  });

  describe('JSON serialization', () => {
    it('toJSON / fromJSON roundtrip', () => {
      const original = new WorldStateSnapshot(
        [entity('A', { importance: 9 }), entity('B')],
        '2024-06-15T00:00:00Z',
      );
      const round = WorldStateSnapshot.fromJSON(original.toJSON());
      expect(round.takenAt).toBe('2024-06-15T00:00:00Z');
      expect(round.size).toBe(2);
      expect(round.entitiesByName.get('A')?.importance).toBe(9);
    });
  });
});

describe('3B.7 WorldModelManager', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let world: WorldModelManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `world-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    // Bare minimum: no causal reasoner, no validator. Tests for those
    // delegations live in their dedicated suites.
    world = new WorldModelManager(entityManager, undefined, undefined);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('getCurrentState returns a snapshot reflecting the live graph', async () => {
    await entityManager.createEntities([
      { name: 'A', entityType: 'person', observations: ['fact1', 'fact2'], importance: 7 },
      { name: 'B', entityType: 'project', observations: ['note'], importance: 3 },
    ]);
    const snap = await world.getCurrentState();
    expect(snap.size).toBe(2);
    const a = snap.entitiesByName.get('A');
    expect(a?.entityType).toBe('person');
    expect(a?.observationCount).toBe(2);
    expect(a?.importance).toBe(7);
  });

  it('getCurrentState caps snapshot size at maxSnapshotSize, prefers high-importance', async () => {
    const small = new WorldModelManager(entityManager, undefined, undefined, {
      maxSnapshotSize: 2,
    });
    await entityManager.createEntities([
      { name: 'low1', entityType: 't', observations: ['o'], importance: 1 },
      { name: 'low2', entityType: 't', observations: ['o'], importance: 2 },
      { name: 'high', entityType: 't', observations: ['o'], importance: 9 },
      { name: 'mid', entityType: 't', observations: ['o'], importance: 5 },
    ]);
    const snap = await small.getCurrentState();
    expect(snap.size).toBe(2);
    expect(snap.entitiesByName.has('high')).toBe(true);
    expect(snap.entitiesByName.has('mid')).toBe(true);
  });

  it('detectStateChange diffs two snapshots', async () => {
    await entityManager.createEntities([
      { name: 'A', entityType: 't', observations: ['v1'], importance: 5 },
    ]);
    const before = await world.getCurrentState();
    await entityManager.updateEntity('A', { importance: 9 });
    const after = await world.getCurrentState();
    const change = world.detectStateChange(before, after);
    expect(change.modified).toHaveLength(1);
    expect(change.modified[0].fields).toContain('importance');
  });

  it('validateFact returns null when no MemoryValidator is wired', async () => {
    await entityManager.createEntities([
      { name: 'X', entityType: 't', observations: ['existing'] },
    ]);
    const result = await world.validateFact('new fact', 'X');
    expect(result).toBeNull();
  });

  it('validateFact returns null when entity does not exist', async () => {
    const result = await world.validateFact('any', 'Ghost');
    expect(result).toBeNull();
  });

  it('predictOutcome returns empty when no CausalReasoner is wired', async () => {
    const chains = await world.predictOutcome('action', ['effect']);
    expect(chains).toEqual([]);
  });
});
