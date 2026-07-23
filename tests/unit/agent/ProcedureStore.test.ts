/**
 * 3B.4 — ProcedureStore Tests (decomposed graph shape)
 *
 * Covers the JSON-blob → graph decomposition: step entities +
 * has_step/precedes/has_fallback relations, roundtrip fidelity
 * (recursive fallbacks, hostile param strings, timeouts), update
 * replacing steps without orphans or dangling relations, legacy-blob
 * auto-migration on load, and bulk migrateLegacyProcedures.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import {
  ProcedureStore,
  migrateLegacyProcedures,
  stepEntityName,
  fallbackEntityName,
  PROCEDURE_ENTITY_TYPE,
  PROCEDURE_STEP_ENTITY_TYPE,
  HAS_STEP_RELATION,
  PRECEDES_RELATION,
  HAS_FALLBACK_RELATION,
} from '../../../src/agent/procedural/index.js';
import type { Procedure, ProcedureStep } from '../../../src/types/procedure.js';

describe('3B.4 ProcedureStore (decomposed graph shape)', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let store: ProcedureStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `proc-store-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    store = new ProcedureStore(entityManager, relationManager);
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  function makeProcedure(overrides: Partial<Procedure> = {}): Procedure {
    return {
      id: 'proc-test',
      name: 'proc-test',
      description: 'A test procedure.',
      steps: [
        { order: 1, action: 'fetch', parameters: { url: 'https://x.test' } },
        { order: 2, action: 'parse', parameters: {} },
        { order: 3, action: 'store', parameters: { table: 'results' } },
      ],
      triggers: ['run test'],
      successRate: 0.85,
      executionCount: 12,
      ...overrides,
    };
  }

  // -------- (1) save creates graph structure --------
  describe('save — graph decomposition', () => {
    it('creates one procedure-step entity per step, parented to the procedure', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      for (const step of proc.steps) {
        const entity = await entityManager.getEntity(stepEntityName(proc.id, step.order));
        expect(entity).not.toBeNull();
        expect(entity?.entityType).toBe(PROCEDURE_STEP_ENTITY_TYPE);
        expect(entity?.parentId).toBe(proc.id);
      }
    });

    it('step entity observations are one human-readable line per field', async () => {
      const proc = makeProcedure({
        steps: [{ order: 1, action: 'fetch', parameters: { url: 'https://x.test' }, timeout: 5000 }],
      });
      await store.save(proc);

      const entity = await entityManager.getEntity(stepEntityName(proc.id, 1));
      expect(entity?.observations).toContain('[order]: 1');
      expect(entity?.observations).toContain('[action]: fetch');
      expect(entity?.observations).toContain('[timeout]: 5000');
      expect(entity?.observations).toContain('[param]: "url"="https://x.test"');
    });

    it('procedure entity carries scalar prefix lines, not JSON blobs', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      const entity = await entityManager.getEntity(proc.id);
      expect(entity?.entityType).toBe(PROCEDURE_ENTITY_TYPE);
      expect(entity?.observations).toContain('A test procedure.');
      expect(entity?.observations).toContain('[success-rate]: 0.85');
      expect(entity?.observations).toContain('[execution-count]: 12');
      expect(entity?.observations.some(o => o.startsWith('[procedure-steps]:'))).toBe(false);
      expect(entity?.observations.some(o => o.startsWith('[procedure-meta]:'))).toBe(false);
      expect(entity?.tags).toEqual(['procedure', 'run test']);
    });

    it('creates has_step relations from the procedure to every top-level step', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      const relations = await relationManager.getRelations(proc.id);
      const hasStep = relations.filter(
        r => r.from === proc.id && r.relationType === HAS_STEP_RELATION,
      );
      expect(hasStep.map(r => r.to).sort()).toEqual([
        stepEntityName(proc.id, 1),
        stepEntityName(proc.id, 2),
        stepEntityName(proc.id, 3),
      ]);
    });

    it('chains consecutive steps with precedes relations', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      const step1 = stepEntityName(proc.id, 1);
      const step2 = stepEntityName(proc.id, 2);
      const step3 = stepEntityName(proc.id, 3);

      const rels1 = await relationManager.getRelations(step1);
      expect(rels1).toContainEqual(
        expect.objectContaining({ from: step1, to: step2, relationType: PRECEDES_RELATION }),
      );
      const rels2 = await relationManager.getRelations(step2);
      expect(rels2).toContainEqual(
        expect.objectContaining({ from: step2, to: step3, relationType: PRECEDES_RELATION }),
      );
      // Last step has no outgoing precedes.
      const rels3 = await relationManager.getRelations(step3);
      expect(rels3.some(r => r.from === step3 && r.relationType === PRECEDES_RELATION)).toBe(false);
    });

    it('creates has_fallback relations, chained for recursive fallbacks', async () => {
      const proc = makeProcedure({
        steps: [
          {
            order: 1,
            action: 'risky',
            parameters: {},
            fallback: {
              order: 91,
              action: 'safe',
              parameters: {},
              fallback: { order: 92, action: 'safest', parameters: {} },
            },
          },
        ],
      });
      await store.save(proc);

      const step1 = stepEntityName(proc.id, 1);
      const fb1 = fallbackEntityName(step1);
      const fb2 = fallbackEntityName(fb1);

      const rels1 = await relationManager.getRelations(step1);
      expect(rels1).toContainEqual(
        expect.objectContaining({ from: step1, to: fb1, relationType: HAS_FALLBACK_RELATION }),
      );
      const relsFb1 = await relationManager.getRelations(fb1);
      expect(relsFb1).toContainEqual(
        expect.objectContaining({ from: fb1, to: fb2, relationType: HAS_FALLBACK_RELATION }),
      );

      const fb1Entity = await entityManager.getEntity(fb1);
      expect(fb1Entity?.entityType).toBe(PROCEDURE_STEP_ENTITY_TYPE);
      expect(fb1Entity?.parentId).toBe(proc.id);
      const fb2Entity = await entityManager.getEntity(fb2);
      expect(fb2Entity?.observations).toContain('[action]: safest');
    });
  });

  // -------- (2) roundtrip fidelity --------
  describe('save → load roundtrip', () => {
    it('roundtrips steps, description, triggers, and scalars', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      const loaded = await store.load(proc.id);
      expect(loaded).toBeDefined();
      expect(loaded?.steps).toEqual(proc.steps);
      expect(loaded?.description).toBe(proc.description);
      expect(loaded?.triggers).toEqual(proc.triggers);
      expect(loaded?.successRate).toBe(0.85);
      expect(loaded?.executionCount).toBe(12);
    });

    it('roundtrips recursive fallbacks and timeouts', async () => {
      const steps: ProcedureStep[] = [
        {
          order: 1,
          action: 'primary',
          parameters: { mode: 'fast' },
          timeout: 1500,
          fallback: {
            order: 91,
            action: 'secondary',
            parameters: { mode: 'slow' },
            timeout: 30000,
            fallback: { order: 92, action: 'tertiary', parameters: {} },
          },
        },
        { order: 2, action: 'wrap-up', parameters: {}, timeout: 250 },
      ];
      const proc = makeProcedure({ steps });
      await store.save(proc);

      const loaded = await store.load(proc.id);
      expect(loaded?.steps).toEqual(steps);
    });

    it('roundtrips hostile parameter strings (equals, newlines, unicode, quotes)', async () => {
      const parameters = {
        'key=with=equals': 'value=with=equals',
        'multi\nline\nkey': 'line1\nline2\r\nline3',
        'unicode-✓-ключ-鍵': 'värde ✓ 値 \u{1F600}',
        'quotes "and" \\backslashes\\': 'she said "hi\\there"',
        '[param]: sneaky prefix': '[order]: 99',
        '': 'empty key',
      };
      const proc = makeProcedure({
        steps: [{ order: 1, action: 'hostile', parameters }],
      });
      await store.save(proc);

      const loaded = await store.load(proc.id);
      expect(loaded?.steps[0].parameters).toEqual(parameters);
    });

    it('preserves step order across a fresh storage reload', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      const fresh = new GraphStorage(storage.getFilePath());
      const freshStore = new ProcedureStore(
        new EntityManager(fresh),
        new RelationManager(fresh),
      );
      const loaded = await freshStore.load(proc.id);
      expect(loaded?.steps.map(s => s.action)).toEqual(['fetch', 'parse', 'store']);
    });

    it('returns undefined for unknown or non-procedure entities', async () => {
      expect(await store.load('missing')).toBeUndefined();
      await entityManager.createEntities([
        { name: 'not-a-proc', entityType: 'person', observations: ['x'] },
      ]);
      expect(await store.load('not-a-proc')).toBeUndefined();
    });
  });

  // -------- (3) update replaces the step graph --------
  describe('update', () => {
    it('replaces steps without orphan step entities or dangling relations', async () => {
      const proc = makeProcedure({
        steps: [
          { order: 1, action: 'a', parameters: {} },
          { order: 2, action: 'b', parameters: {}, fallback: { order: 91, action: 'b-fb', parameters: {} } },
          { order: 3, action: 'c', parameters: {} },
        ],
      });
      await store.save(proc);

      const newSteps: ProcedureStep[] = [
        { order: 1, action: 'a-v2', parameters: { fresh: 'yes' } },
        { order: 5, action: 'e', parameters: {} },
      ];
      await store.update({ ...proc, steps: newSteps });

      // New shape loads back exactly.
      const loaded = await store.load(proc.id);
      expect(loaded?.steps).toEqual(newSteps);

      // Old step entities (orders 2, 3 and the fallback) are gone.
      const oldStep2 = stepEntityName(proc.id, 2);
      expect(await entityManager.getEntity(oldStep2)).toBeNull();
      expect(await entityManager.getEntity(stepEntityName(proc.id, 3))).toBeNull();
      expect(await entityManager.getEntity(fallbackEntityName(oldStep2))).toBeNull();

      // No relation anywhere still references a deleted step entity.
      const graph = await storage.loadGraph();
      const liveNames = new Set(graph.entities.map(e => e.name));
      for (const rel of graph.relations) {
        expect(liveNames.has(rel.from)).toBe(true);
        expect(liveNames.has(rel.to)).toBe(true);
      }

      // has_step now points only at the new steps.
      const hasStep = (await relationManager.getRelations(proc.id))
        .filter(r => r.from === proc.id && r.relationType === HAS_STEP_RELATION)
        .map(r => r.to)
        .sort();
      expect(hasStep).toEqual([
        stepEntityName(proc.id, 1),
        stepEntityName(proc.id, 5),
      ]);

      // Only the two new step entities remain.
      const stepEntities = graph.entities.filter(
        e => e.entityType === PROCEDURE_STEP_ENTITY_TYPE,
      );
      expect(stepEntities.map(e => e.name).sort()).toEqual([
        stepEntityName(proc.id, 1),
        stepEntityName(proc.id, 5),
      ]);
    });

    it('rewrites reused step names with the new content', async () => {
      const proc = makeProcedure({
        steps: [{ order: 1, action: 'old-action', parameters: { keep: 'no' } }],
      });
      await store.save(proc);

      await store.update({
        ...proc,
        steps: [{ order: 1, action: 'new-action', parameters: { keep: 'yes' } }],
      });

      const loaded = await store.load(proc.id);
      expect(loaded?.steps[0].action).toBe('new-action');
      expect(loaded?.steps[0].parameters).toEqual({ keep: 'yes' });
    });

    it('updates scalar observations and triggers on the procedure entity', async () => {
      const proc = makeProcedure();
      await store.save(proc);

      await store.update({
        ...proc,
        triggers: ['new trigger'],
        successRate: 0.5,
        executionCount: 13,
      });

      const entity = await entityManager.getEntity(proc.id);
      expect(entity?.observations).toContain('[success-rate]: 0.5');
      expect(entity?.observations).toContain('[execution-count]: 13');
      expect(entity?.tags).toEqual(['procedure', 'new trigger']);
    });

    it('throws when the procedure entity does not exist', async () => {
      await expect(store.update(makeProcedure({ id: 'ghost' }))).rejects.toThrow();
    });
  });

  // -------- (4) legacy JSON-blob migration on load --------
  describe('legacy auto-migration', () => {
    const legacySteps: ProcedureStep[] = [
      { order: 1, action: 'legacy-a', parameters: { k: 'v' } },
      {
        order: 2,
        action: 'legacy-b',
        parameters: {},
        fallback: { order: 91, action: 'legacy-fb', parameters: {} },
      },
    ];

    async function createLegacyEntity(id: string): Promise<void> {
      await entityManager.createEntities([
        {
          name: id,
          entityType: PROCEDURE_ENTITY_TYPE,
          observations: [
            'Legacy description.',
            `[procedure-steps]:${JSON.stringify(legacySteps)}`,
            `[procedure-meta]:${JSON.stringify({
              triggers: ['legacy trigger'],
              successRate: 0.4,
              executionCount: 7,
            })}`,
          ],
          tags: ['procedure', 'legacy trigger'],
        },
      ]);
    }

    it('load() decodes a legacy blob entity correctly', async () => {
      await createLegacyEntity('proc-legacy');
      const loaded = await store.load('proc-legacy');
      expect(loaded?.steps).toEqual(legacySteps);
      expect(loaded?.description).toBe('Legacy description.');
      expect(loaded?.triggers).toEqual(['legacy trigger']);
      expect(loaded?.successRate).toBe(0.4);
      expect(loaded?.executionCount).toBe(7);
    });

    it('load() rewrites the legacy entity to the decomposed shape', async () => {
      await createLegacyEntity('proc-legacy');
      await store.load('proc-legacy');

      const entity = await entityManager.getEntity('proc-legacy');
      expect(entity?.observations.some(o => o.startsWith('[procedure-steps]:'))).toBe(false);
      expect(entity?.observations.some(o => o.startsWith('[procedure-meta]:'))).toBe(false);
      expect(entity?.observations).toContain('[success-rate]: 0.4');
      expect(entity?.observations).toContain('[execution-count]: 7');

      // Step entities + relations now exist.
      const step1 = await entityManager.getEntity(stepEntityName('proc-legacy', 1));
      expect(step1?.entityType).toBe(PROCEDURE_STEP_ENTITY_TYPE);
      const hasStep = (await relationManager.getRelations('proc-legacy'))
        .filter(r => r.relationType === HAS_STEP_RELATION);
      expect(hasStep).toHaveLength(2);
      const fbRels = (await relationManager.getRelations(stepEntityName('proc-legacy', 2)))
        .filter(r => r.relationType === HAS_FALLBACK_RELATION);
      expect(fbRels).toHaveLength(1);

      // Second load reads the decomposed shape and agrees with the first.
      const reloaded = await store.load('proc-legacy');
      expect(reloaded?.steps).toEqual(legacySteps);
      expect(reloaded?.executionCount).toBe(7);
    });

    it('migrateLegacyProcedures counts and converts only legacy entities', async () => {
      await createLegacyEntity('proc-legacy-1');
      await createLegacyEntity('proc-legacy-2');
      // Already-decomposed procedure must not be counted.
      await store.save(makeProcedure({ id: 'proc-modern' }));

      const migrated = await migrateLegacyProcedures(entityManager, relationManager);
      expect(migrated).toBe(2);

      for (const id of ['proc-legacy-1', 'proc-legacy-2']) {
        const entity = await entityManager.getEntity(id);
        expect(entity?.observations.some(o => o.startsWith('[procedure-steps]:'))).toBe(false);
        expect(await entityManager.getEntity(stepEntityName(id, 1))).not.toBeNull();
        const loaded = await store.load(id);
        expect(loaded?.steps).toEqual(legacySteps);
      }

      // Second run is a no-op.
      expect(await migrateLegacyProcedures(entityManager, relationManager)).toBe(0);
    });
  });
});
