/**
 * CRDT Unit Tests
 *
 * Covers Phase 5 step 53: VectorClock, LWWRegister, ORSet, CRDTGraph.
 */

import { describe, it, expect } from 'vitest';
import {
  VectorClock,
  LWWRegister,
  ORSet,
  CRDTGraph,
} from '../../../src/features/CRDT.js';

describe('VectorClock', () => {
  it('tick increments the replica counter', () => {
    const c = new VectorClock();
    c.tick('a');
    c.tick('a');
    c.tick('b');
    expect(c.state).toEqual({ a: 2, b: 1 });
  });

  it('merge takes the per-replica max', () => {
    const a = new VectorClock({ a: 3, b: 1 });
    const b = new VectorClock({ a: 1, b: 4, c: 2 });
    a.merge(b);
    expect(a.state).toEqual({ a: 3, b: 4, c: 2 });
  });

  it('compare detects happened-before / concurrent / equal', () => {
    expect(new VectorClock({ a: 1 }).compare(new VectorClock({ a: 2 }))).toBe(-1);
    expect(new VectorClock({ a: 3 }).compare(new VectorClock({ a: 2 }))).toBe(1);
    expect(new VectorClock({ a: 1 }).compare(new VectorClock({ a: 1 }))).toBe(0);
    expect(
      new VectorClock({ a: 1, b: 2 }).compare(new VectorClock({ a: 2, b: 1 })),
    ).toBe('concurrent');
  });
});

describe('LWWRegister', () => {
  it('set replaces value when ts is newer', () => {
    const r = new LWWRegister({ value: 'a', ts: 1, replicaId: 'r1' });
    r.set('b', 'r2', 5);
    expect(r.state.value).toBe('b');
  });

  it('older ts is rejected', () => {
    const r = new LWWRegister({ value: 'a', ts: 5, replicaId: 'r1' });
    r.set('b', 'r2', 1);
    expect(r.state.value).toBe('a');
  });

  it('breaks ties on replicaId lexicographically (higher wins)', () => {
    const r = new LWWRegister({ value: 'a', ts: 5, replicaId: 'r1' });
    r.set('b', 'r2', 5);
    expect(r.state.value).toBe('b');
    // Replaying the same write is a no-op.
    r.set('b', 'r2', 5);
    expect(r.state.value).toBe('b');
  });

  it('merge is idempotent (replay produces same state)', () => {
    const r = new LWWRegister({ value: 'a', ts: 1, replicaId: 'r1' });
    const incoming = { value: 'b', ts: 5, replicaId: 'r2' };
    r.merge(incoming);
    const after1 = { ...r.state };
    r.merge(incoming);
    expect(r.state).toEqual(after1);
  });
});

describe('ORSet', () => {
  it('add then has returns true', () => {
    const s = new ORSet<string>();
    s.add('x');
    expect(s.has('x')).toBe(true);
    expect(s.values()).toEqual(['x']);
  });

  it('remove then has returns false', () => {
    const s = new ORSet<string>();
    s.add('x');
    s.remove('x');
    expect(s.has('x')).toBe(false);
  });

  it('concurrent add survives concurrent remove on a replica that never saw the add', () => {
    const a = new ORSet<string>();
    a.add('x', 'tag-a');

    const b = new ORSet<string>();
    b.add('x', 'tag-b');
    a.merge(b.state);

    // c hasn't seen tag-b, so remove only tombstones tag-a.
    const c = new ORSet<string>();
    c.add('x', 'tag-a');
    c.remove('x');
    a.merge(c.state);

    expect(a.has('x')).toBe(true);
  });

  it('merge is commutative', () => {
    const a = new ORSet<string>();
    a.add('x');
    a.add('y');

    const b = new ORSet<string>();
    b.add('y');
    b.add('z');

    const a2 = new ORSet<string>();
    a2.add('x');
    a2.add('y');
    const b2 = new ORSet<string>();
    b2.add('y');
    b2.add('z');

    a.merge(b.state);
    b2.merge(a2.state);
    expect(a.values().sort()).toEqual(b2.values().sort());
  });
});

describe('CRDTGraph', () => {
  it('upsertEntity + toGraph round-trips an entity', () => {
    const g = new CRDTGraph('r1');
    g.upsertEntity({
      name: 'alice',
      entityType: 'person',
      observations: ['coffee'],
      tags: ['expert'],
      importance: 7,
    });
    const out = g.toGraph();
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.name).toBe('alice');
    expect(out.entities[0]!.tags).toEqual(['expert']);
    expect(out.entities[0]!.observations).toEqual(['coffee']);
    expect(out.entities[0]!.importance).toBe(7);
  });

  it('deleteEntity is a tombstone (filtered from toGraph)', () => {
    const g = new CRDTGraph('r1');
    g.upsertEntity({ name: 'alice', entityType: 'person', observations: [] });
    g.deleteEntity('alice');
    expect(g.toGraph().entities).toHaveLength(0);
  });

  it('merge converges across two replicas with disjoint writes', () => {
    const a = new CRDTGraph('replica-a');
    const b = new CRDTGraph('replica-b');

    a.upsertEntity({ name: 'alice', entityType: 'person', observations: ['coffee'] });
    b.upsertEntity({ name: 'bob', entityType: 'person', observations: ['tea'] });

    a.merge(b.state);
    b.merge(a.state);

    const aOut = a.toGraph();
    const bOut = b.toGraph();
    expect(aOut.entities.map((e) => e.name).sort()).toEqual(['alice', 'bob']);
    expect(bOut.entities.map((e) => e.name).sort()).toEqual(['alice', 'bob']);
  });

  it('merge converges across two replicas with concurrent writes to same entity', () => {
    const a = new CRDTGraph('replica-a');
    const b = new CRDTGraph('replica-b');

    a.upsertEntity({ name: 'alice', entityType: 'person', observations: ['coffee'] });
    b.upsertEntity({ name: 'alice', entityType: 'person', observations: ['tea'] });

    a.merge(b.state);
    b.merge(a.state);

    const aOut = a.toGraph();
    const bOut = b.toGraph();
    expect(aOut.entities[0]!.observations.sort()).toEqual(['coffee', 'tea']);
    expect(bOut.entities[0]!.observations.sort()).toEqual(['coffee', 'tea']);
  });

  it('merge is idempotent (replay = no change)', () => {
    const a = new CRDTGraph('replica-a');
    a.upsertEntity({ name: 'alice', entityType: 'person', observations: ['coffee'] });
    const b = new CRDTGraph('replica-b');
    b.upsertEntity({ name: 'bob', entityType: 'person', observations: ['tea'] });

    a.merge(b.state);
    const after1 = JSON.stringify(a.toGraph());
    a.merge(b.state);
    const after2 = JSON.stringify(a.toGraph());
    expect(after1).toBe(after2);
  });

  it('relations are deduped + tombstone-deleted across replicas', () => {
    const a = new CRDTGraph('replica-a');
    const b = new CRDTGraph('replica-b');

    a.upsertEntity({ name: 'alice', entityType: 'person', observations: [] });
    a.upsertEntity({ name: 'bob', entityType: 'person', observations: [] });
    a.addRelation({ from: 'alice', to: 'bob', relationType: 'knows' });

    b.upsertEntity({ name: 'alice', entityType: 'person', observations: [] });
    b.upsertEntity({ name: 'bob', entityType: 'person', observations: [] });
    b.addRelation({ from: 'alice', to: 'bob', relationType: 'knows' });

    a.merge(b.state);
    b.merge(a.state);

    expect(a.toGraph().relations).toHaveLength(1);
    expect(b.toGraph().relations).toHaveLength(1);

    // Now delete on one side, merge.
    a.deleteRelation('alice', 'bob', 'knows');
    b.merge(a.state);
    expect(b.toGraph().relations).toHaveLength(0);
  });

  it('merge is associative — (A∪B)∪C === A∪(B∪C)', () => {
    const a = new CRDTGraph('a');
    a.upsertEntity({ name: 'x', entityType: 'thing', observations: ['from-a'] });
    const b = new CRDTGraph('b');
    b.upsertEntity({ name: 'x', entityType: 'thing', observations: ['from-b'] });
    const c = new CRDTGraph('c');
    c.upsertEntity({ name: 'y', entityType: 'thing', observations: ['from-c'] });

    const left = new CRDTGraph('left', JSON.parse(JSON.stringify(a.state)));
    left.merge(b.state);
    left.merge(c.state);

    const right = new CRDTGraph('right', JSON.parse(JSON.stringify(a.state)));
    // Build B∪C separately, then merge into right.
    const bc = new CRDTGraph('tmp', JSON.parse(JSON.stringify(b.state)));
    bc.merge(c.state);
    right.merge(bc.state);

    const leftOut = left.toGraph();
    const rightOut = right.toGraph();
    expect(leftOut.entities.map((e) => e.name).sort()).toEqual(
      rightOut.entities.map((e) => e.name).sort(),
    );
    const xL = leftOut.entities.find((e) => e.name === 'x')!;
    const xR = rightOut.entities.find((e) => e.name === 'x')!;
    expect(xL.observations.sort()).toEqual(xR.observations.sort());
  });

  it('HLC issues distinct timestamps for back-to-back same-ms ops on one replica', () => {
    const a = new CRDTGraph('a');
    a.upsertEntity({ name: 'e1', entityType: 'thing', observations: [] });
    a.upsertEntity({ name: 'e2', entityType: 'thing', observations: [] });
    a.upsertEntity({ name: 'e3', entityType: 'thing', observations: [] });
    const tss = [
      a.state.entities['e1']!.entityType.ts,
      a.state.entities['e2']!.entityType.ts,
      a.state.entities['e3']!.entityType.ts,
    ];
    // Strict monotonic — no two ops on the same replica share a ts.
    for (let i = 1; i < tss.length; i++) {
      expect(tss[i]).toBeGreaterThan(tss[i - 1]!);
    }
  });

  it('concurrent delete + readd resolves by LWW timestamp', async () => {
    const a = new CRDTGraph('replica-a');
    a.upsertEntity({ name: 'alice', entityType: 'person', observations: ['x'] });

    const b = new CRDTGraph('replica-b', JSON.parse(JSON.stringify(a.state)));

    // Both replicas now have alice. A deletes, then B upserts again.
    a.deleteEntity('alice');
    await new Promise((r) => setTimeout(r, 5));
    b.upsertEntity({ name: 'alice', entityType: 'person', observations: ['y'] });

    a.merge(b.state);
    b.merge(a.state);

    // The later write (upsert) wins via LWWRegister<tombstone>.
    expect(a.toGraph().entities).toHaveLength(1);
    expect(b.toGraph().entities).toHaveLength(1);
  });
});
