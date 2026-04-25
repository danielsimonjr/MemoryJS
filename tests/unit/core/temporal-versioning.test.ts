/**
 * η.4.4 Temporal Versioning expansion (entity + observation)
 *
 * Mirror of v1.9.0 RelationManager temporal tests, lifted to entities
 * via EntityManager.invalidateEntity / entityAsOf / entityTimeline,
 * and to observations via ObservationManager.invalidateObservation /
 * observationsAsOf.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { EntityNotFoundError, ValidationError } from '../../../src/utils/errors.js';

describe('η.4.4 Temporal Versioning', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let observationManager: ObservationManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `temporal-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    observationManager = new ObservationManager(storage);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // -------- EntityManager.invalidateEntity --------
  describe('invalidateEntity', () => {
    it('sets validUntil to the supplied ISO timestamp', async () => {
      await entityManager.createEntities([
        { name: 'Acme', entityType: 'company', observations: [] },
      ]);
      await entityManager.invalidateEntity('Acme', '2025-12-31T00:00:00Z');
      const e = await entityManager.getEntity('Acme');
      expect(e?.validUntil).toBe('2025-12-31T00:00:00Z');
    });

    it('defaults to current time when no timestamp supplied', async () => {
      await entityManager.createEntities([
        { name: 'Beta', entityType: 'company', observations: [] },
      ]);
      const before = new Date().toISOString();
      await entityManager.invalidateEntity('Beta');
      const e = await entityManager.getEntity('Beta');
      expect(e?.validUntil).toBeDefined();
      expect(e!.validUntil! >= before).toBe(true);
    });

    it('is idempotent — second call updates the timestamp', async () => {
      await entityManager.createEntities([
        { name: 'Gamma', entityType: 'company', observations: [] },
      ]);
      await entityManager.invalidateEntity('Gamma', '2025-01-01T00:00:00Z');
      await entityManager.invalidateEntity('Gamma', '2026-01-01T00:00:00Z');
      const e = await entityManager.getEntity('Gamma');
      expect(e?.validUntil).toBe('2026-01-01T00:00:00Z');
    });

    it('throws EntityNotFoundError when the entity does not exist', async () => {
      await expect(entityManager.invalidateEntity('Ghost')).rejects.toThrow(EntityNotFoundError);
    });
  });

  // -------- EntityManager.entityAsOf --------
  describe('entityAsOf', () => {
    it('returns the entity when asOf is within its validity window', async () => {
      await entityManager.createEntities([
        { name: 'X', entityType: 't', observations: [] },
      ]);
      await entityManager.updateEntity('X', { validFrom: '2024-01-01T00:00:00Z' });
      const e = await entityManager.entityAsOf('X', '2024-06-15T00:00:00Z');
      expect(e?.name).toBe('X');
    });

    it('returns null when asOf is before validFrom', async () => {
      await entityManager.createEntities([
        { name: 'Y', entityType: 't', observations: [] },
      ]);
      await entityManager.updateEntity('Y', { validFrom: '2024-01-01T00:00:00Z' });
      expect(await entityManager.entityAsOf('Y', '2023-06-15T00:00:00Z')).toBeNull();
    });

    it('returns null when asOf is after validUntil', async () => {
      await entityManager.createEntities([
        { name: 'Z', entityType: 't', observations: [] },
      ]);
      await entityManager.invalidateEntity('Z', '2024-01-01T00:00:00Z');
      expect(await entityManager.entityAsOf('Z', '2024-06-15T00:00:00Z')).toBeNull();
    });

    it('treats undefined validFrom/validUntil as unbounded (always-valid)', async () => {
      await entityManager.createEntities([
        { name: 'Forever', entityType: 't', observations: [] },
      ]);
      // No validFrom, no validUntil — entity should be returned for any asOf
      const past = await entityManager.entityAsOf('Forever', '1999-01-01T00:00:00Z');
      const future = await entityManager.entityAsOf('Forever', '2099-01-01T00:00:00Z');
      expect(past?.name).toBe('Forever');
      expect(future?.name).toBe('Forever');
    });

    it('rejects non-ISO asOf strings with ValidationError', async () => {
      await entityManager.createEntities([
        { name: 'A', entityType: 't', observations: [] },
      ]);
      await expect(entityManager.entityAsOf('A', 'not-a-date')).rejects.toThrow(ValidationError);
    });
  });

  // -------- EntityManager.entityTimeline --------
  describe('entityTimeline', () => {
    it('returns supersession chain sorted by validFrom ascending', async () => {
      await entityManager.createEntities([
        { name: 'V1', entityType: 'doc', observations: ['draft'] },
      ]);
      await entityManager.updateEntity('V1', {
        validFrom: '2024-01-01T00:00:00Z',
        rootEntityName: 'V1',
      });
      await entityManager.createEntities([
        { name: 'V2', entityType: 'doc', observations: ['final'] },
      ]);
      await entityManager.updateEntity('V2', {
        validFrom: '2024-06-01T00:00:00Z',
        rootEntityName: 'V1',
        parentEntityName: 'V1',
        version: 2,
      });
      const timeline = await entityManager.entityTimeline('V1');
      expect(timeline.map(e => e.name)).toEqual(['V1', 'V2']);
    });

    it('returns just the named entity when not part of a supersession chain', async () => {
      await entityManager.createEntities([
        { name: 'Solo', entityType: 't', observations: [] },
      ]);
      const timeline = await entityManager.entityTimeline('Solo');
      expect(timeline.map(e => e.name)).toEqual(['Solo']);
    });

    it('returns empty array when entity does not exist', async () => {
      expect(await entityManager.entityTimeline('Missing')).toEqual([]);
    });
  });

  // -------- ObservationManager.invalidateObservation --------
  describe('invalidateObservation', () => {
    it('creates an observationMeta entry with validUntil', async () => {
      await entityManager.createEntities([
        { name: 'Bob', entityType: 'person', observations: ['Works at Acme'] },
      ]);
      await observationManager.invalidateObservation(
        'Bob', 'Works at Acme', '2024-12-31T00:00:00Z',
      );
      const e = await entityManager.getEntity('Bob');
      expect(e?.observationMeta).toEqual([
        { content: 'Works at Acme', validUntil: '2024-12-31T00:00:00Z' },
      ]);
    });

    it('updates an existing meta entry on second call', async () => {
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['x'] },
      ]);
      await observationManager.invalidateObservation('Alice', 'x', '2024-01-01T00:00:00Z');
      await observationManager.invalidateObservation('Alice', 'x', '2025-01-01T00:00:00Z');
      const e = await entityManager.getEntity('Alice');
      expect(e?.observationMeta?.length).toBe(1);
      expect(e?.observationMeta?.[0].validUntil).toBe('2025-01-01T00:00:00Z');
    });

    it('throws ValidationError when observation not on entity', async () => {
      await entityManager.createEntities([
        { name: 'Charlie', entityType: 'p', observations: ['real'] },
      ]);
      await expect(
        observationManager.invalidateObservation('Charlie', 'fake'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws EntityNotFoundError when entity does not exist', async () => {
      await expect(
        observationManager.invalidateObservation('Ghost', 'anything'),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  // -------- ObservationManager.observationsAsOf --------
  describe('observationsAsOf', () => {
    it('returns all observations for an entity with no observationMeta (legacy behavior)', async () => {
      await entityManager.createEntities([
        { name: 'Legacy', entityType: 't', observations: ['a', 'b', 'c'] },
      ]);
      const obs = await observationManager.observationsAsOf('Legacy', '2024-06-15T00:00:00Z');
      expect(obs).toEqual(['a', 'b', 'c']);
    });

    it('filters out observations whose validUntil < asOf', async () => {
      await entityManager.createEntities([
        { name: 'Mixed', entityType: 't', observations: ['old', 'new'] },
      ]);
      await observationManager.invalidateObservation('Mixed', 'old', '2024-01-01T00:00:00Z');
      const obs = await observationManager.observationsAsOf('Mixed', '2024-06-15T00:00:00Z');
      expect(obs).toEqual(['new']);
    });

    it('filters out observations whose validFrom > asOf', async () => {
      await entityManager.createEntities([
        { name: 'Future', entityType: 't', observations: ['preview'] },
      ]);
      await entityManager.updateEntity('Future', {
        observationMeta: [{ content: 'preview', validFrom: '2026-01-01T00:00:00Z' }],
      });
      const past = await observationManager.observationsAsOf('Future', '2024-06-15T00:00:00Z');
      const present = await observationManager.observationsAsOf('Future', '2026-06-15T00:00:00Z');
      expect(past).toEqual([]);
      expect(present).toEqual(['preview']);
    });

    it('returns empty array when entity does not exist', async () => {
      expect(
        await observationManager.observationsAsOf('Missing', '2024-06-15T00:00:00Z'),
      ).toEqual([]);
    });

    it('rejects non-ISO asOf with ValidationError', async () => {
      await expect(
        observationManager.observationsAsOf('any', 'bad'),
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------- Persistence roundtrip --------
  describe('JSONL persistence', () => {
    it('roundtrips validFrom / validUntil / observationMeta through storage', async () => {
      await entityManager.createEntities([
        { name: 'Round', entityType: 't', observations: ['fact1', 'fact2'] },
      ]);
      await entityManager.updateEntity('Round', {
        validFrom: '2024-01-01T00:00:00Z',
        validUntil: '2025-12-31T00:00:00Z',
      });
      await observationManager.invalidateObservation('Round', 'fact1', '2024-12-31T00:00:00Z');

      // Force a fresh storage read
      const fresh = new GraphStorage(storage.getFilePath());
      const freshManager = new EntityManager(fresh);
      const e = await freshManager.getEntity('Round');
      expect(e?.validFrom).toBe('2024-01-01T00:00:00Z');
      expect(e?.validUntil).toBe('2025-12-31T00:00:00Z');
      expect(e?.observationMeta).toEqual([
        { content: 'fact1', validUntil: '2024-12-31T00:00:00Z' },
      ]);
    });
  });
});
