/**
 * Mutation-copy ownership tests (wave 1, step 2, defect C).
 *
 * - getGraphForMutation returns a fully independent deep copy.
 * - A failed transaction leaves the live cache unchanged.
 * - loadGraph is a read-only borrowed view; outside production it is
 *   deep-frozen so accidental mutation throws.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { TransactionManager } from '../../../src/core/TransactionManager.js';
import type { Entity, Relation } from '../../../src/types/types.js';

function makeEntity(name: string): Entity {
  return {
    name,
    entityType: 'test',
    observations: ['first'],
    tags: ['t1'],
    observationMeta: [{ observation: 'first', confidence: 0.5 }],
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
  } as Entity;
}

type Backend = { label: string; make: (dir: string) => GraphStorage };

const backends: Backend[] = [
  { label: 'JSONL', make: dir => new GraphStorage(join(dir, 'g.jsonl')) },
  { label: 'SQLite', make: dir => new SQLiteStorage(join(dir, 'g.db')) as unknown as GraphStorage },
];

describe.each(backends)('graph ownership ($label)', ({ make }) => {
  let dir: string;
  let storage: GraphStorage;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mjs-mut-iso-'));
    storage = make(dir);
    await storage.appendEntity(makeEntity('Alpha'));
    await storage.appendEntity(makeEntity('Beta'));
    await storage.appendRelation({
      from: 'Alpha',
      to: 'Beta',
      relationType: 'links_to',
      metadata: { nested: { weight: 1 } },
      // Explicit timestamps: a rollback restores from backup, and restore
      // fills missing timestamps. That normalisation is not aliasing.
      createdAt: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
    } as Relation);
  });

  afterEach(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function liveSnapshot(): Promise<unknown> {
    return JSON.parse(JSON.stringify(await storage.loadGraph()));
  }

  it('nested edits on a getGraphForMutation copy leave the live cache unchanged', async () => {
    const before = await liveSnapshot();
    const copy = await storage.getGraphForMutation();
    const alpha = copy.entities.find(e => e.name === 'Alpha')!;
    (alpha.observationMeta as Array<{ confidence: number }>)[0].confidence = 0.99;
    alpha.observations.push('leak');
    const rel = copy.relations[0] as Relation & { metadata: { nested: { weight: number } } };
    rel.metadata.nested.weight = 42;
    expect(await liveSnapshot()).toEqual(before);
  });

  it('a failed transaction leaves the live cache unchanged', async () => {
    const before = await liveSnapshot();
    const tx = new TransactionManager(storage);
    tx.begin();
    tx.updateEntity('Alpha', { observations: ['changed'] });
    tx.deleteEntity('DoesNotExist');
    const result = await tx.commit();
    expect(result.success).toBe(false);
    expect(await liveSnapshot()).toEqual(before);
  });

  it('outside production, mutating the loadGraph result throws', async () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    const graph = await storage.loadGraph();
    expect(() => (graph.entities as Entity[]).push(makeEntity('X'))).toThrow(TypeError);
    expect(() => (graph.entities[0].observations as string[]).push('x')).toThrow(TypeError);
    const rel = graph.relations[0] as Relation & { metadata: { nested: { weight: number } } };
    expect(() => {
      rel.metadata.nested.weight = 7;
    }).toThrow(TypeError);
  });

  it('the frozen loadGraph view still reflects later writes', async () => {
    await storage.loadGraph();
    await storage.appendEntity(makeEntity('Gamma'));
    const graph = await storage.loadGraph();
    expect(graph.entities.map(e => e.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
