/**
 * IOManager JSON round-trip for relation `metadata.proceduralGraph` (A13).
 *
 * Create via RelationManager, export JSON with IOManager, import into a fresh
 * ManagerContext, and assert the namespaced PG metadata is preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManagerContext } from '../../src/core/ManagerContext.js';

const proceduralGraphMetadata = {
  proceduralGraph: {
    schemaVersion: 1,
    condition: null,
    guidance: 'g',
    pitfalls: 'p',
  },
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('IOManager JSON round-trip (procedural graph metadata)', () => {
  it('preserves metadata.proceduralGraph across export and import into a fresh context', async () => {
    const source = new ManagerContext(path.join(dir, 'source.jsonl'));
    try {
      await source.entityManager.createEntities([
        { name: 'Start', entityType: 'ACTION', observations: ['entry'] },
        { name: 'End', entityType: 'ACTION', observations: ['terminal'] },
      ]);
      await source.relationManager.createRelations([
        {
          from: 'Start',
          to: 'End',
          relationType: 'LEADS_TO',
          metadata: proceduralGraphMetadata,
        },
      ]);

      const exportedGraph = await source.storage.loadGraph();
      const json = source.ioManager.exportGraph(exportedGraph, 'json');
      const parsed = JSON.parse(json) as {
        relations: Array<{ from: string; to: string; relationType: string; metadata?: unknown }>;
      };
      const exportedRelation = parsed.relations.find(
        (relation) => relation.from === 'Start' && relation.to === 'End' && relation.relationType === 'LEADS_TO',
      );
      expect(exportedRelation?.metadata).toEqual(proceduralGraphMetadata);

      const dest = new ManagerContext(path.join(dir, 'dest.jsonl'));
      try {
        const result = await dest.ioManager.importGraph('json', json);
        expect(result.errors).toEqual([]);
        expect(result.entitiesAdded).toBe(2);
        expect(result.relationsAdded).toBe(1);

        const imported = await dest.storage.loadGraph();
        const relation = imported.relations.find(
          (item) => item.from === 'Start' && item.to === 'End' && item.relationType === 'LEADS_TO',
        );
        expect(relation).toBeDefined();
        expect(relation?.metadata).toEqual(proceduralGraphMetadata);
      } finally {
        dest.close();
      }
    } finally {
      source.close();
    }
  });
});
