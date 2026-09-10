/**
 * RelationManager metadata round-trip (procedural graph).
 *
 * Pins A1: `metadata.proceduralGraph` is admitted by CreateRelationSchema
 * and persists through GraphStorage and SQLiteStorage.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { isNodeSqliteAvailable } from '../../../src/core/nodeSqliteAdapter.js';
import type { GraphStorage as GraphStorageType } from '../../../src/core/GraphStorage.js';

const require = createRequire(import.meta.url);

function isBetterSqlite3Available(): boolean {
  try {
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const sqliteDriverAvailable = isBetterSqlite3Available() || isNodeSqliteAvailable();

const proceduralGraphMetadata = {
  proceduralGraph: {
    schemaVersion: 1,
    condition: null,
    guidance: 'g',
    pitfalls: 'p',
  },
};

describe('RelationManager metadata (procedural graph)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir === undefined) break;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    tempDirs.push(dir);
    return dir;
  }

  async function seedLeadsToRelation(storage: GraphStorageType): Promise<void> {
    const entityManager = new EntityManager(storage);
    const relationManager = new RelationManager(storage);

    await entityManager.createEntities([
      { name: 'Start', entityType: 'ACTION', observations: ['entry'] },
      { name: 'End', entityType: 'ACTION', observations: ['terminal'] },
    ]);

    await relationManager.createRelations([
      {
        from: 'Start',
        to: 'End',
        relationType: 'LEADS_TO',
        metadata: proceduralGraphMetadata,
      },
    ]);
  }

  it('round-trips metadata.proceduralGraph through GraphStorage', async () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'graph.jsonl');
    const storage = new GraphStorage(filePath);

    await seedLeadsToRelation(storage);

    const reloaded = new GraphStorage(filePath);
    const graph = await reloaded.loadGraph();
    const relation = graph.relations.find(
      (r) => r.from === 'Start' && r.to === 'End' && r.relationType === 'LEADS_TO',
    );

    expect(relation).toBeDefined();
    expect(relation?.metadata).toEqual(proceduralGraphMetadata);
  });

  it.skipIf(!sqliteDriverAvailable)(
    'round-trips metadata.proceduralGraph through SQLiteStorage',
    async () => {
      const dir = makeTempDir();
      const filePath = join(dir, 'graph.db');
      const storage = new SQLiteStorage(filePath);

      try {
        await seedLeadsToRelation(storage as unknown as GraphStorageType);
      } finally {
        storage.close();
      }

      const reloaded = new SQLiteStorage(filePath);
      try {
        const graph = await reloaded.loadGraph();
        const relation = graph.relations.find(
          (r) => r.from === 'Start' && r.to === 'End' && r.relationType === 'LEADS_TO',
        );

        expect(relation).toBeDefined();
        expect(relation?.metadata).toEqual(proceduralGraphMetadata);
      } finally {
        reloaded.close();
      }
    },
  );
});
