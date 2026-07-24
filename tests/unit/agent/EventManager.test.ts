/**
 * R1 — EventManager Tests (n-ary event reification)
 *
 * Covers, on BOTH backends (JSONL GraphStorage + SQLiteStorage):
 * - recordEvent → graph shape: event hub entity (`entityType: 'event'`,
 *   `event-<action>-<shortId>` name, `[action]:` / `[occurred-at]:` lines,
 *   flow tag) + role-typed relations verified via RelationManager
 * - endpoint handling: autoCreateEndpoints on ('concept' stubs, existing
 *   entities untouched) and off (throws before writing anything)
 * - getEvent join + queryEvents by each filter (actor, target, action,
 *   flowKey incl. case-insensitivity, timeRange, limit, combinations)
 * - getFlow chronological ordering
 * - whoDidWhat convenience join (by target, context, timeRange)
 * - roundtrip across a fresh storage reload
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import {
  EventManager,
  EVENT_ENTITY_TYPE,
  EVENT_STUB_ENTITY_TYPE,
  EVENT_TAG,
  FLOW_TAG_PREFIX,
  ACTOR_OF_RELATION,
  TARGETED_RELATION,
  OCCURRED_IN_RELATION,
  PARTICIPANT_IN_RELATION,
  eventEntityName,
} from '../../../src/agent/events/index.js';

type AnyStorage = GraphStorage | SQLiteStorage;

interface BackendSpec {
  label: string;
  fileName: string;
  make: (filePath: string) => AnyStorage;
}

const backends: BackendSpec[] = [
  {
    label: 'JSONL backend (GraphStorage)',
    fileName: 'memory.jsonl',
    make: (p) => new GraphStorage(p),
  },
  {
    label: 'SQLite backend (SQLiteStorage)',
    fileName: 'memory.db',
    make: (p) => new SQLiteStorage(p),
  },
];

for (const backend of backends) {
  describe(`R1 EventManager — ${backend.label}`, () => {
    let testDir: string;
    let filePath: string;
    let storage: AnyStorage;
    let entityManager: EntityManager;
    let relationManager: RelationManager;
    let events: EventManager;

    beforeEach(async () => {
      testDir = join(tmpdir(), `event-manager-${Date.now()}-${Math.random()}`);
      await fs.mkdir(testDir, { recursive: true });
      filePath = join(testDir, backend.fileName);
      storage = backend.make(filePath);
      entityManager = new EntityManager(storage);
      relationManager = new RelationManager(storage);
      events = new EventManager(entityManager, relationManager);
    });

    afterEach(async () => {
      closeStorage(storage);
      try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
    });

    function closeStorage(s: AnyStorage): void {
      if (s instanceof SQLiteStorage) s.close();
    }

    async function seedPeople(): Promise<void> {
      await entityManager.createEntities([
        { name: 'alice', entityType: 'person', observations: ['engineer'] },
        { name: 'bob', entityType: 'person', observations: ['reviewer'] },
        { name: 'api-service', entityType: 'service', observations: ['REST API'] },
        { name: 'production', entityType: 'environment', observations: ['prod cluster'] },
      ]);
    }

    // -------- (1) recordEvent → graph shape --------
    describe('recordEvent — graph shape', () => {
      it('creates an event hub entity following the naming convention', async () => {
        await seedPeople();
        const record = await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
        });

        expect(record.name).toMatch(/^event-deployed-[0-9a-f]{4}$/);
        const entity = await entityManager.getEntity(record.name);
        expect(entity).not.toBeNull();
        expect(entity?.entityType).toBe(EVENT_ENTITY_TYPE);
        expect(entity?.tags).toContain(EVENT_TAG);
      });

      it('sanitizes hostile action strings in the name but preserves the raw action', async () => {
        const record = await events.recordEvent({ action: 'Ship It!', actor: 'alice' });
        expect(record.name).toMatch(/^event-ship-it--[0-9a-f]{4}$/);
        expect(record.action).toBe('Ship It!');
        const loaded = await events.getEvent(record.name);
        expect(loaded?.action).toBe('Ship It!');
      });

      it('encodes action, occurred-at, and detail as observation lines', async () => {
        await seedPeople();
        const record = await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          occurredAt: '2026-07-01T12:00:00.000Z',
          detail: ['version 1.2.3', 'zero downtime'],
        });

        const entity = await entityManager.getEntity(record.name);
        expect(entity?.observations).toContain('[action]: deployed');
        expect(entity?.observations).toContain('[occurred-at]: 2026-07-01T12:00:00.000Z');
        expect(entity?.observations).toContain('version 1.2.3');
        expect(entity?.observations).toContain('zero downtime');
      });

      it('stores the flow key as a lowercased flow:<key> tag', async () => {
        const record = await events.recordEvent({
          action: 'approved',
          actor: 'bob',
          flowKey: 'Release-42',
        });
        const entity = await entityManager.getEntity(record.name);
        expect(entity?.tags).toContain(`${FLOW_TAG_PREFIX}release-42`);
        expect(record.flowKey).toBe('release-42');
      });

      it('wires all four role-typed relations around the hub', async () => {
        await seedPeople();
        const record = await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          participants: ['bob'],
        });

        const rels = await relationManager.getRelations(record.name);
        expect(rels).toContainEqual(
          expect.objectContaining({ from: 'alice', to: record.name, relationType: ACTOR_OF_RELATION }),
        );
        expect(rels).toContainEqual(
          expect.objectContaining({ from: record.name, to: 'api-service', relationType: TARGETED_RELATION }),
        );
        expect(rels).toContainEqual(
          expect.objectContaining({ from: record.name, to: 'production', relationType: OCCURRED_IN_RELATION }),
        );
        expect(rels).toContainEqual(
          expect.objectContaining({ from: 'bob', to: record.name, relationType: PARTICIPANT_IN_RELATION }),
        );
        expect(rels).toHaveLength(4);
      });

      it('carries importance onto the event entity and validates inputs', async () => {
        const record = await events.recordEvent({ action: 'noted', actor: 'alice', importance: 7 });
        const entity = await entityManager.getEntity(record.name);
        expect(entity?.importance).toBe(7);

        await expect(events.recordEvent({ action: '', actor: 'alice' })).rejects.toThrow(/action/);
        await expect(events.recordEvent({ action: 'x', actor: '  ' })).rejects.toThrow(/actor/);
        await expect(
          events.recordEvent({ action: 'x', actor: 'alice', occurredAt: 'not-a-date' }),
        ).rejects.toThrow(/occurredAt/);
      });

      it('accepts Date occurredAt and normalizes to ISO', async () => {
        const when = new Date('2026-06-15T08:30:00.000Z');
        const record = await events.recordEvent({ action: 'met', actor: 'alice', occurredAt: when });
        expect(record.occurredAt).toBe('2026-06-15T08:30:00.000Z');
      });
    });

    // -------- (2) endpoint handling --------
    describe('endpoint auto-creation', () => {
      it('creates missing endpoints as concept stubs by default', async () => {
        await events.recordEvent({
          action: 'mentioned',
          actor: 'carol',
          target: 'widget',
          context: 'standup',
          participants: ['dave'],
        });

        for (const name of ['carol', 'widget', 'standup', 'dave']) {
          const entity = await entityManager.getEntity(name);
          expect(entity).not.toBeNull();
          expect(entity?.entityType).toBe(EVENT_STUB_ENTITY_TYPE);
        }
      });

      it('leaves existing endpoint entities untouched', async () => {
        await seedPeople();
        await events.recordEvent({ action: 'deployed', actor: 'alice', target: 'api-service' });

        const alice = await entityManager.getEntity('alice');
        expect(alice?.entityType).toBe('person');
        expect(alice?.observations).toEqual(['engineer']);
      });

      it('with autoCreateEndpoints: false, throws and writes nothing', async () => {
        await seedPeople();
        const strict = new EventManager(entityManager, relationManager, {
          autoCreateEndpoints: false,
        });

        await expect(
          strict.recordEvent({ action: 'deployed', actor: 'alice', target: 'ghost-service' }),
        ).rejects.toThrow(/ghost-service/);

        // Nothing was written: no event entity, no stub.
        expect(await entityManager.listEntities({ entityType: EVENT_ENTITY_TYPE })).toHaveLength(0);
        expect(await entityManager.getEntity('ghost-service')).toBeNull();
      });

      it('with autoCreateEndpoints: false, succeeds when all endpoints exist', async () => {
        await seedPeople();
        const strict = new EventManager(entityManager, relationManager, {
          autoCreateEndpoints: false,
        });
        const record = await strict.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
        });
        expect(await events.getEvent(record.name)).not.toBeNull();
      });
    });

    // -------- (3) getEvent join --------
    describe('getEvent', () => {
      it('joins the hub entity with all role endpoints', async () => {
        await seedPeople();
        const record = await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          participants: ['bob'],
          occurredAt: '2026-07-01T12:00:00.000Z',
          flowKey: 'release-42',
          detail: ['version 1.2.3'],
          importance: 8,
        });

        const loaded = await events.getEvent(record.name);
        expect(loaded).toEqual({
          name: record.name,
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          participants: ['bob'],
          occurredAt: '2026-07-01T12:00:00.000Z',
          flowKey: 'release-42',
          detail: ['version 1.2.3'],
          importance: 8,
          createdAt: expect.any(String) as unknown as string,
        });
      });

      it('returns null for unknown names and non-event entities', async () => {
        await seedPeople();
        expect(await events.getEvent('missing')).toBeNull();
        expect(await events.getEvent('alice')).toBeNull();
      });
    });

    // -------- (4) queryEvents --------
    describe('queryEvents', () => {
      beforeEach(async () => {
        await seedPeople();
        await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          occurredAt: '2026-07-01T10:00:00.000Z',
          flowKey: 'release-42',
        });
        await events.recordEvent({
          action: 'approved',
          actor: 'bob',
          target: 'api-service',
          occurredAt: '2026-07-01T09:00:00.000Z',
          flowKey: 'release-42',
        });
        await events.recordEvent({
          action: 'deployed',
          actor: 'bob',
          target: 'production',
          occurredAt: '2026-07-02T10:00:00.000Z',
        });
      });

      it('filters by actor via the relation index', async () => {
        const result = await events.queryEvents({ actor: 'alice' });
        expect(result).toHaveLength(1);
        expect(result[0].action).toBe('deployed');
        expect(result[0].actor).toBe('alice');
      });

      it('filters by target', async () => {
        const result = await events.queryEvents({ target: 'api-service' });
        expect(result.map(e => e.action)).toEqual(['approved', 'deployed']); // chronological
      });

      it('filters by action', async () => {
        const result = await events.queryEvents({ action: 'deployed' });
        expect(result).toHaveLength(2);
        expect(result.every(e => e.action === 'deployed')).toBe(true);
      });

      it('filters by flowKey, case-insensitively', async () => {
        const result = await events.queryEvents({ flowKey: 'RELEASE-42' });
        expect(result).toHaveLength(2);
        expect(result.every(e => e.flowKey === 'release-42')).toBe(true);
      });

      it('filters by timeRange with inclusive bounds', async () => {
        const result = await events.queryEvents({
          timeRange: { start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T10:00:00.000Z' },
        });
        expect(result.map(e => e.action)).toEqual(['approved', 'deployed']);

        const openEnded = await events.queryEvents({
          timeRange: { start: '2026-07-02T00:00:00.000Z' },
        });
        expect(openEnded).toHaveLength(1);
        expect(openEnded[0].actor).toBe('bob');
        expect(openEnded[0].target).toBe('production');
      });

      it('combines filters (ANDed) and applies limit after sorting', async () => {
        const combined = await events.queryEvents({ actor: 'bob', action: 'deployed' });
        expect(combined).toHaveLength(1);
        expect(combined[0].target).toBe('production');

        const limited = await events.queryEvents({ limit: 2 });
        expect(limited).toHaveLength(2);
        expect(limited.map(e => e.occurredAt)).toEqual([
          '2026-07-01T09:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
        ]);
      });

      it('returns all events chronologically with an empty filter', async () => {
        const all = await events.queryEvents();
        expect(all.map(e => e.occurredAt)).toEqual([
          '2026-07-01T09:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          '2026-07-02T10:00:00.000Z',
        ]);
      });
    });

    // -------- (5) getFlow ordering --------
    describe('getFlow', () => {
      it('orders flow events chronologically regardless of insert order', async () => {
        await events.recordEvent({
          action: 'merged',
          actor: 'alice',
          occurredAt: '2026-07-03T12:00:00.000Z',
          flowKey: 'pr-7',
        });
        await events.recordEvent({
          action: 'opened',
          actor: 'alice',
          occurredAt: '2026-07-01T12:00:00.000Z',
          flowKey: 'pr-7',
        });
        await events.recordEvent({
          action: 'reviewed',
          actor: 'bob',
          occurredAt: '2026-07-02T12:00:00.000Z',
          flowKey: 'pr-7',
        });
        // Different flow — must not leak in.
        await events.recordEvent({ action: 'opened', actor: 'bob', flowKey: 'pr-8' });

        const flow = await events.getFlow('pr-7');
        expect(flow.map(e => e.action)).toEqual(['opened', 'reviewed', 'merged']);
      });

      it('falls back to createdAt ordering when occurredAt is absent', async () => {
        const first = await events.recordEvent({ action: 'started', actor: 'alice', flowKey: 'f' });
        await new Promise(resolve => setTimeout(resolve, 5));
        const second = await events.recordEvent({ action: 'finished', actor: 'alice', flowKey: 'f' });

        const flow = await events.getFlow('f');
        expect(flow.map(e => e.name)).toEqual([first.name, second.name]);
      });
    });

    // -------- (6) whoDidWhat --------
    describe('whoDidWhat', () => {
      beforeEach(async () => {
        await seedPeople();
        await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          occurredAt: '2026-07-01T10:00:00.000Z',
        });
        await events.recordEvent({
          action: 'restarted',
          actor: 'bob',
          target: 'api-service',
          occurredAt: '2026-07-01T11:00:00.000Z',
        });
        await events.recordEvent({
          action: 'paged',
          actor: 'bob',
          context: 'production',
          occurredAt: '2026-07-01T12:00:00.000Z',
        });
      });

      it('answers "who did what to <target>" chronologically', async () => {
        const rows = await events.whoDidWhat({ target: 'api-service' });
        expect(rows.map(r => [r.actor, r.action, r.occurredAt])).toEqual([
          ['alice', 'deployed', '2026-07-01T10:00:00.000Z'],
          ['bob', 'restarted', '2026-07-01T11:00:00.000Z'],
        ]);
        expect(rows[0].event.context).toBe('production');
      });

      it('answers "who did what in <context>"', async () => {
        const rows = await events.whoDidWhat({ context: 'production' });
        expect(rows.map(r => r.action)).toEqual(['deployed', 'paged']);
      });

      it('applies timeRange and limit', async () => {
        const rows = await events.whoDidWhat({
          timeRange: { start: '2026-07-01T10:30:00.000Z' },
          limit: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe('restarted');
      });
    });

    // -------- (7) roundtrip across storage reload --------
    describe('persistence', () => {
      it('roundtrips a full event across a fresh storage instance', async () => {
        await seedPeople();
        const record = await events.recordEvent({
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          participants: ['bob'],
          occurredAt: '2026-07-01T12:00:00.000Z',
          flowKey: 'release-42',
          detail: ['version 1.2.3'],
        });

        closeStorage(storage);
        storage = backend.make(filePath);
        const freshEvents = new EventManager(
          new EntityManager(storage),
          new RelationManager(storage),
        );

        const loaded = await freshEvents.getEvent(record.name);
        expect(loaded).toMatchObject({
          name: record.name,
          action: 'deployed',
          actor: 'alice',
          target: 'api-service',
          context: 'production',
          participants: ['bob'],
          occurredAt: '2026-07-01T12:00:00.000Z',
          flowKey: 'release-42',
          detail: ['version 1.2.3'],
        });

        const flow = await freshEvents.getFlow('release-42');
        expect(flow.map(e => e.name)).toEqual([record.name]);
      });
    });
  });
}

// -------- backend-independent helpers --------

describe('eventEntityName', () => {
  it('sanitizes to alphanumerics + hyphens, lowercased', () => {
    expect(eventEntityName('Ship It!', 'a1b2')).toBe('event-ship-it--a1b2');
    expect(eventEntityName('deployed', '00ff')).toBe('event-deployed-00ff');
  });
});
