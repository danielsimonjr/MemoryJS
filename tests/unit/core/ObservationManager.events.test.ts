/**
 * ObservationManager event emission (DES-3).
 *
 * `addObservations` emits `observation:added` (once per entity, only the
 * observations actually appended) and `deleteObservations` emits
 * `observation:deleted` (only the observations actually removed). Both run on
 * JSONL and SQLite. Also covers the downstream consumers that were dead until
 * these emitters existed: ObserverPipeline routing and TransitionLedger
 * (which must record one entry per observation write, not two).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { TransitionLedger } from '../../../src/core/TransitionLedger.js';
import { ObserverPipeline, type ObservationScore } from '../../../src/agent/ObserverPipeline.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type {
  GraphEvent,
  IGraphStorage,
  ObservationAddedEvent,
  ObservationDeletedEvent,
} from '../../../src/types/types.js';
import { withBothBackends, makeTempDir, removeTempDir } from '../../helpers/tempStorage.js';

/** Seed the same three entities on every backend. */
async function seed(storage: IGraphStorage): Promise<void> {
  await storage.saveGraph({
    entities: [
      { name: 'Alice', entityType: 'person', observations: ['Developer', 'Team lead'] },
      { name: 'Bob', entityType: 'person', observations: ['Designer'] },
      { name: 'Project', entityType: 'project', observations: [] },
    ],
    relations: [],
  });
}

/** Subscribe to every event on the storage emitter and record it in order. */
function recordEvents(storage: IGraphStorage): GraphEvent[] {
  const log: GraphEvent[] = [];
  storage.events!.onAny((event: GraphEvent) => {
    log.push(event);
  });
  return log;
}

function addedEvents(log: GraphEvent[]): ObservationAddedEvent[] {
  return log.filter((e): e is ObservationAddedEvent => e.type === 'observation:added');
}

function deletedEvents(log: GraphEvent[]): ObservationDeletedEvent[] {
  return log.filter((e): e is ObservationDeletedEvent => e.type === 'observation:deleted');
}

describe('ObservationManager event emission (DES-3)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
    vi.restoreAllMocks();
  });

  withBothBackends('observation:added / observation:deleted', (backend) => {
    function setup() {
      const storage = backend.create();
      const manager = new ObservationManager(storage as unknown as GraphStorage);
      return { storage, manager };
    }

    it('addObservations emits once per entity with exactly the appended strings', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.addObservations([
        { entityName: 'Alice', contents: ['Prefers TypeScript', 'Works remotely'] },
        { entityName: 'Bob', contents: ['Uses Figma'] },
      ]);

      const added = addedEvents(log);
      expect(added).toHaveLength(2);
      expect(added[0]).toMatchObject({
        type: 'observation:added',
        entityName: 'Alice',
        observations: ['Prefers TypeScript', 'Works remotely'],
      });
      expect(typeof added[0].timestamp).toBe('string');
      expect(added[1]).toMatchObject({ entityName: 'Bob', observations: ['Uses Figma'] });
    });

    it('adding an already-present observation emits nothing', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.addObservations([{ entityName: 'Alice', contents: ['Developer'] }]);

      expect(addedEvents(log)).toHaveLength(0);
    });

    it('emits only the newly appended strings when the batch mixes new and existing', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.addObservations([
        { entityName: 'Alice', contents: ['Developer', 'Mentors juniors'] },
      ]);

      const added = addedEvents(log);
      expect(added).toHaveLength(1);
      expect(added[0].observations).toEqual(['Mentors juniors']);
    });

    it('orders entity:updated before observation:added for the same entity', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.addObservations([{ entityName: 'Alice', contents: ['Ordering probe'] }]);

      const types = log.map((e) => e.type);
      const updatedAt = types.indexOf('entity:updated');
      const addedAt = types.indexOf('observation:added');
      expect(updatedAt).toBeGreaterThanOrEqual(0);
      expect(addedAt).toBeGreaterThan(updatedAt);
    });

    it('deleteObservations emits only the observations actually removed', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.deleteObservations([
        { entityName: 'Alice', observations: ['Developer', 'Never existed'] },
      ]);

      const deleted = deletedEvents(log);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({
        type: 'observation:deleted',
        entityName: 'Alice',
        observations: ['Developer'],
      });
      expect(typeof deleted[0].timestamp).toBe('string');
    });

    it('deleting only absent strings emits nothing', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.deleteObservations([{ entityName: 'Alice', observations: ['Nope'] }]);

      expect(deletedEvents(log)).toHaveLength(0);
    });

    it('does not emit observation events for entities that do not exist', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const log = recordEvents(storage);

      await manager.deleteObservations([{ entityName: 'Ghost', observations: ['x'] }]);

      expect(deletedEvents(log)).toHaveLength(0);
    });

    it('ObserverPipeline attached to the storage emitter receives every appended observation', async () => {
      const { storage, manager } = setup();
      await seed(storage);

      const entityManager = { addTags: vi.fn().mockResolvedValue({}) } as unknown as EntityManager;
      const pipeline = new ObserverPipeline(entityManager, { minImportanceThreshold: 0 });
      const scored: ObservationScore[] = [];
      pipeline.onScored((s) => scored.push(s));
      const detach = pipeline.attach(storage.events!);
      cleanups.push(detach);

      await manager.addObservations([
        { entityName: 'Alice', contents: ['Prefers TypeScript', 'Works remotely'] },
      ]);

      expect(pipeline.getStats().processed).toBe(2);
      expect(scored.map((s) => s.entityName)).toEqual(['Alice', 'Alice']);
      expect(scored.map((s) => s.observation)).toEqual(['Prefers TypeScript', 'Works remotely']);
    });

    it('TransitionLedger records one observations entry per write, not two', async () => {
      const { storage, manager } = setup();
      await seed(storage);
      const dir = makeTempDir('memoryjs-ledger-');
      const ledger = new TransitionLedger(`${dir}/ledger.jsonl`);
      const detach = ledger.attachToEmitter(storage.events!);
      cleanups.push(detach, () => removeTempDir(dir));

      await manager.addObservations([{ entityName: 'Alice', contents: ['Ledger probe'] }]);
      expect(ledger.query({ entityId: 'Alice', field: 'observations' })).toHaveLength(1);

      await manager.deleteObservations([{ entityName: 'Alice', observations: ['Ledger probe'] }]);
      expect(ledger.query({ entityId: 'Alice', field: 'observations' })).toHaveLength(2);
    });
  });
});
