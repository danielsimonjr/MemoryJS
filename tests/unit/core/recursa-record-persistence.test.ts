/**
 * Recursa record fields survive a save → reload round trip on both backends,
 * and `EntityManager.updateEntity` does not strip them (UpdateEntitySchema).
 *
 * Regression for the persistence allowlists in GraphStorage
 * (`OPTIONAL_PERSISTED_ENTITY_FIELDS`), SQLiteStorage (`EXTENSION_FIELDS`)
 * and `src/utils/schemas.ts`: a record key missing from any of them is
 * silently dropped on disk.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity } from '../../../src/types/types.js';
import { makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../helpers/tempStorage.js';

const RECORD_KEYS = [
  'skillRecord',
  'instructionSetRecord',
  'knowledgeSnapshotRecord',
  'knowledgeRevisionRecord',
  'navigationNodeRecord',
  'coverageRecord',
  'taskRecord',
  'learningTraceRecord',
] as const;

const openedStorages: Array<{ close?: () => void }> = [];
function track<T>(storage: T): T {
  openedStorages.push(storage as unknown as { close?: () => void });
  return storage;
}

const BACKENDS = [
  { name: 'jsonl', open: (p: string) => track(new GraphStorage(p)), path: makeTempJsonlPath },
  { name: 'sqlite', open: (p: string) => track(new SQLiteStorage(p)), path: makeTempSqlitePath },
] as const;

afterEach(() => {
  for (const storage of openedStorages.splice(0)) storage.close?.();
  cleanupTempDirs();
});

function entityWith(key: string, index: number): Entity {
  return {
    name: `rec-${key}-${index}`,
    entityType: 'recursa-test',
    observations: [`[record]: ${key}`],
    [key]: { marker: key, nested: { n: index, list: [1, 2, 3] } },
  } as unknown as Entity;
}

describe.each(BACKENDS)('Recursa record persistence [$name]', (backend) => {
  it('keeps every record field across clearCache and a full reopen', async () => {
    const filePath = backend.path();
    const first = backend.open(filePath);
    const entities = RECORD_KEYS.map((key, i) => entityWith(key, i));
    const manager = new EntityManager(first as never);
    await manager.createEntities(entities);

    first.clearCache();
    const afterClear = await first.loadGraph();
    for (const key of RECORD_KEYS) {
      const found = afterClear.entities.find((e) => e.name.startsWith(`rec-${key}-`));
      expect(found, `${key} missing after clearCache`).toBeDefined();
      expect((found as unknown as Record<string, unknown>)[key], `${key} dropped after clearCache`).toEqual({
        marker: key,
        nested: { n: RECORD_KEYS.indexOf(key), list: [1, 2, 3] },
      });
    }

    first.close?.();
    const reopened = backend.open(filePath);
    const afterReopen = await reopened.loadGraph();
    for (const key of RECORD_KEYS) {
      const found = afterReopen.entities.find((e) => e.name.startsWith(`rec-${key}-`));
      expect((found as unknown as Record<string, unknown> | undefined)?.[key], `${key} dropped after reopen`).toMatchObject({ marker: key });
    }
  });

  it('updateEntity keeps a record field that is set through the update path', async () => {
    const storage = backend.open(backend.path());
    const manager = new EntityManager(storage as never);
    await manager.createEntities([
      { name: 'plain', entityType: 'recursa-test', observations: ['start'] } as Entity,
    ]);
    for (const key of RECORD_KEYS) {
      await manager.updateEntity('plain', { [key]: { marker: `${key}-updated` } } as never);
    }
    storage.clearCache();
    const graph = await storage.loadGraph();
    const plain = graph.entities.find((e) => e.name === 'plain') as unknown as Record<string, unknown>;
    for (const key of RECORD_KEYS) {
      expect(plain[key], `${key} stripped by updateEntity`).toEqual({ marker: `${key}-updated` });
    }
  });
});
