/**
 * WriteAheadLog Unit Tests
 *
 * Covers Phase 6 step 40: append-only WAL + replay + checkpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WriteAheadLog,
  applyWALToGraph,
  type WALEntry,
} from '../../../src/core/WriteAheadLog.js';
import type { Entity, Relation } from '../../../src/types/types.js';

describe('WriteAheadLog', () => {
  let testDir: string;
  let walPath: string;
  let wal: WriteAheadLog;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wal-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    walPath = join(testDir, 'memory.jsonl.wal');
    wal = new WriteAheadLog(walPath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* swallow cleanup errors */
    }
  });

  describe('walPathFor', () => {
    it('appends .wal to the storage path', () => {
      expect(WriteAheadLog.walPathFor('/data/memory.jsonl')).toBe(
        '/data/memory.jsonl.wal',
      );
    });
  });

  describe('append', () => {
    it('appends a JSONL line per entry', async () => {
      await wal.append({
        op: 'put-entity',
        entity: { name: 'a', entityType: 'x', observations: [] },
        ts: '2026-05-11T00:00:00Z',
      });
      const content = await fs.readFile(walPath, 'utf-8');
      expect(content.split('\n').filter(Boolean)).toHaveLength(1);
      const parsed = JSON.parse(content.trim());
      expect(parsed.op).toBe('put-entity');
    });

    it('appends without overwriting prior entries', async () => {
      await wal.append({
        op: 'put-entity',
        entity: { name: 'a', entityType: 'x', observations: [] },
        ts: 't1',
      });
      await wal.append({
        op: 'delete-entity',
        name: 'a',
        ts: 't2',
      });
      const lines = (await fs.readFile(walPath, 'utf-8'))
        .split('\n')
        .filter(Boolean);
      expect(lines).toHaveLength(2);
    });

    it('respects fsyncOnAppend: false (still writes, just no sync)', async () => {
      const soft = new WriteAheadLog(walPath, { fsyncOnAppend: false });
      await soft.append({ op: 'delete-entity', name: 'x', ts: 't' });
      const content = await fs.readFile(walPath, 'utf-8');
      expect(content).toContain('"op":"delete-entity"');
    });

    it('creates the parent dir if missing', async () => {
      const deepPath = join(testDir, 'nested/dir/memory.jsonl.wal');
      const deepWal = new WriteAheadLog(deepPath);
      await deepWal.append({ op: 'delete-entity', name: 'x', ts: 't' });
      const content = await fs.readFile(deepPath, 'utf-8');
      expect(content).toContain('"op":"delete-entity"');
    });
  });

  describe('hasPending', () => {
    it('returns false for an absent WAL', () => {
      expect(wal.hasPending()).toBe(false);
    });

    it('returns true after at least one append', async () => {
      await wal.append({ op: 'delete-entity', name: 'x', ts: 't' });
      expect(wal.hasPending()).toBe(true);
    });
  });

  describe('replay', () => {
    it('returns [] for an absent WAL', async () => {
      expect(await wal.replay()).toEqual([]);
    });

    it('returns entries in append order', async () => {
      const entries: WALEntry[] = [
        { op: 'put-entity', entity: { name: 'a', entityType: 'x', observations: [] }, ts: 't1' },
        { op: 'put-relation', relation: { from: 'a', to: 'b', relationType: 'knows' }, ts: 't2' },
        { op: 'delete-entity', name: 'a', ts: 't3' },
      ];
      for (const e of entries) await wal.append(e);
      const replayed = await wal.replay();
      expect(replayed.map((e) => e.op)).toEqual([
        'put-entity',
        'put-relation',
        'delete-entity',
      ]);
    });

    it('tolerates a malformed *tail* (crash-during-append fingerprint)', async () => {
      await wal.append({ op: 'delete-entity', name: 'a', ts: 't1' });
      // Inject a malformed trailing line (no following entries).
      await fs.appendFile(walPath, 'not-json\n');
      const replayed = await wal.replay();
      expect(replayed).toHaveLength(1);
      expect((replayed[0] as { name: string }).name).toBe('a');
    });

    it('throws on a malformed line in the *middle* of the log by default', async () => {
      await wal.append({ op: 'delete-entity', name: 'a', ts: 't1' });
      // Inject a malformed line that's NOT the tail.
      await fs.appendFile(walPath, 'not-json\n');
      await wal.append({ op: 'delete-entity', name: 'b', ts: 't2' });
      await expect(wal.replay()).rejects.toThrow(/Malformed lines in the middle/);
    });

    it('tolerateGaps:true permits a middle-of-log malformed line', async () => {
      await wal.append({ op: 'delete-entity', name: 'a', ts: 't1' });
      await fs.appendFile(walPath, 'not-json\n');
      await wal.append({ op: 'delete-entity', name: 'b', ts: 't2' });
      const replayed = await wal.replay({ tolerateGaps: true });
      expect(replayed.map((e) => (e as { name: string }).name)).toEqual(['a', 'b']);
    });

    it('skips entries with unknown op kinds', async () => {
      await fs.writeFile(
        walPath,
        JSON.stringify({ op: 'put-entity', entity: { name: 'a', entityType: 'x', observations: [] }, ts: 't' }) +
          '\n' +
          JSON.stringify({ op: 'unknown-op', payload: 'x' }) +
          '\n',
      );
      const replayed = await wal.replay();
      expect(replayed).toHaveLength(1);
      expect(replayed[0]!.op).toBe('put-entity');
    });
  });

  describe('checkpoint', () => {
    it('removes the WAL file', async () => {
      await wal.append({ op: 'delete-entity', name: 'x', ts: 't' });
      expect(wal.hasPending()).toBe(true);
      await wal.checkpoint();
      expect(wal.hasPending()).toBe(false);
    });

    it('is idempotent on a missing WAL', async () => {
      await wal.checkpoint();
      await wal.checkpoint();
      expect(wal.hasPending()).toBe(false);
    });
  });

  describe('stats', () => {
    it('returns null when no WAL exists', async () => {
      expect(await wal.stats()).toBeNull();
    });

    it('reports size + entryCount for an active WAL', async () => {
      await wal.append({ op: 'delete-entity', name: 'a', ts: 't1' });
      await wal.append({ op: 'delete-entity', name: 'b', ts: 't2' });
      const stats = await wal.stats();
      expect(stats).not.toBeNull();
      expect(stats!.entryCount).toBe(2);
      expect(stats!.size).toBeGreaterThan(0);
    });
  });
});

describe('applyWALToGraph', () => {
  function emptyGraph(): { entities: Entity[]; relations: Relation[] } {
    return { entities: [], relations: [] };
  }

  it('put-entity inserts a new entity', () => {
    const graph = emptyGraph();
    applyWALToGraph(
      [
        {
          op: 'put-entity',
          entity: { name: 'a', entityType: 'x', observations: [] },
          ts: 't',
        },
      ],
      graph,
    );
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]!.name).toBe('a');
  });

  it('put-entity replaces an existing entity (same name)', () => {
    const graph: { entities: Entity[]; relations: Relation[] } = {
      entities: [{ name: 'a', entityType: 'x', observations: ['old'] }],
      relations: [],
    };
    applyWALToGraph(
      [
        {
          op: 'put-entity',
          entity: { name: 'a', entityType: 'x', observations: ['new'] },
          ts: 't',
        },
      ],
      graph,
    );
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]!.observations).toEqual(['new']);
  });

  it('delete-entity removes the entity and its relations', () => {
    const graph: { entities: Entity[]; relations: Relation[] } = {
      entities: [
        { name: 'a', entityType: 'x', observations: [] },
        { name: 'b', entityType: 'x', observations: [] },
      ],
      relations: [
        { from: 'a', to: 'b', relationType: 'knows' },
        { from: 'b', to: 'a', relationType: 'knows' },
      ],
    };
    applyWALToGraph([{ op: 'delete-entity', name: 'a', ts: 't' }], graph);
    expect(graph.entities.map((e) => e.name)).toEqual(['b']);
    expect(graph.relations).toEqual([]);
  });

  it('put-relation dedups by (from, to, relationType)', () => {
    const graph: { entities: Entity[]; relations: Relation[] } = {
      entities: [],
      relations: [{ from: 'a', to: 'b', relationType: 'knows' }],
    };
    applyWALToGraph(
      [
        {
          op: 'put-relation',
          relation: { from: 'a', to: 'b', relationType: 'knows' },
          ts: 't',
        },
      ],
      graph,
    );
    expect(graph.relations).toHaveLength(1);
  });

  it('delete-relation removes the matching triple', () => {
    const graph: { entities: Entity[]; relations: Relation[] } = {
      entities: [],
      relations: [
        { from: 'a', to: 'b', relationType: 'knows' },
        { from: 'a', to: 'b', relationType: 'likes' },
      ],
    };
    applyWALToGraph(
      [
        {
          op: 'delete-relation',
          from: 'a',
          to: 'b',
          relationType: 'knows',
          ts: 't',
        },
      ],
      graph,
    );
    expect(graph.relations).toEqual([{ from: 'a', to: 'b', relationType: 'likes' }]);
  });

  it('replays a sequence in order', () => {
    const graph = emptyGraph();
    applyWALToGraph(
      [
        {
          op: 'put-entity',
          entity: { name: 'a', entityType: 'x', observations: [] },
          ts: 't1',
        },
        {
          op: 'put-entity',
          entity: { name: 'b', entityType: 'x', observations: [] },
          ts: 't2',
        },
        {
          op: 'put-relation',
          relation: { from: 'a', to: 'b', relationType: 'knows' },
          ts: 't3',
        },
        { op: 'delete-entity', name: 'a', ts: 't4' },
      ],
      graph,
    );
    expect(graph.entities.map((e) => e.name)).toEqual(['b']);
    expect(graph.relations).toEqual([]);
  });
});

describe('end-to-end recovery', () => {
  it('append → crash → replay → checkpoint round-trips', async () => {
    const dir = join(tmpdir(), `wal-e2e-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const walPath = WriteAheadLog.walPathFor(join(dir, 'memory.jsonl'));
    const wal1 = new WriteAheadLog(walPath);

    await wal1.append({
      op: 'put-entity',
      entity: { name: 'a', entityType: 'person', observations: ['hi'] },
      ts: 't1',
    });
    await wal1.append({
      op: 'put-relation',
      relation: { from: 'a', to: 'b', relationType: 'knows' },
      ts: 't2',
    });

    // Simulate process restart — new WAL instance against the same file.
    const wal2 = new WriteAheadLog(walPath);
    expect(wal2.hasPending()).toBe(true);
    const replayed = await wal2.replay();
    expect(replayed).toHaveLength(2);

    const graph = { entities: [] as Entity[], relations: [] as Relation[] };
    applyWALToGraph(replayed, graph);
    expect(graph.entities).toHaveLength(1);
    expect(graph.relations).toHaveLength(1);

    await wal2.checkpoint();
    expect(wal2.hasPending()).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
