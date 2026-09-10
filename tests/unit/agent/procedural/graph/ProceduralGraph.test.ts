/**
 * Tests for the immutable ProceduralGraph wrapper.
 */

import { describe, it, expect } from 'vitest';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import { toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGEditSet, PGNode, PGSnapshot } from '../../../../../src/types/proceduralGraph.js';

function n(id: string, extras: Partial<PGNode> = {}): PGNode {
  return { id, type: extras.type ?? 'ACTION', description: extras.description ?? id, ...extras };
}

function e(source: string, target: string, extras: Partial<PGEdge> = {}): PGEdge {
  return {
    source,
    relation: extras.relation ?? 'LEADS_TO',
    target,
    condition: extras.condition ?? null,
    guidance: extras.guidance ?? 'g',
    pitfalls: extras.pitfalls ?? 'p',
    ...extras,
  };
}

function snap(nodes: PGNode[], edges: PGEdge[], extra: Partial<PGSnapshot> = {}): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId: 'g',
    revisionId: 'r',
    entryNodeId: nodes[0]?.id ?? 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy: 'allow',
    toolCatalogHash: toolCatalogHash([]),
    nodes,
    edges,
    ...extra,
  };
}

const emptyEdits = (): PGEditSet => ({
  add_nodes: [],
  delete_nodes: [],
  add_edges: [],
  delete_edges: [],
});

describe('ProceduralGraph', () => {
  it("locate(undefined) returns the entry node with reason 'entry'", () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('Start', { type: 'STATE' }), n('End', { type: 'STATE' })],
      [e('Start', 'End')],
      { entryNodeId: 'Start' },
    ));
    const loc = graph.locate(undefined);
    expect(loc.matched).toBe(true);
    expect(loc.nodeId).toBe('Start');
    expect(loc.reason).toBe('entry');
    expect(loc.hops).toEqual([]);
  });

  it('locate matches node id exactly and not case-insensitively', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('Start', { type: 'STATE' }), n('Scan_Index'), n('End', { type: 'STATE' })],
      [e('Start', 'Scan_Index'), e('Scan_Index', 'End')],
      { entryNodeId: 'Start' },
    ));
    expect(graph.locate('Scan_Index').matched).toBe(true);
    expect(graph.locate('Scan_Index').reason).toBe('exact-id');
    expect(graph.locate('scan_index').matched).toBe(false);
    expect(graph.locate('scan_index').reason).toBe('not-found');
  });

  it("locate falls back to actionName binding only when allowed; ambiguity yields reason 'ambiguous'", () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [
        n('Start', { type: 'STATE' }),
        n('node_a', { actionName: 'lookup' }),
        n('node_b', { actionName: 'lookup' }),
        n('node_c', { actionName: 'unique_tool' }),
        n('End', { type: 'STATE' }),
      ],
      [e('Start', 'node_a'), e('node_a', 'node_b'), e('node_b', 'node_c'), e('node_c', 'End')],
      { entryNodeId: 'Start' },
    ));
    expect(graph.locate('unique_tool').matched).toBe(false);
    const bound = graph.locate('unique_tool', { allowActionBinding: true });
    expect(bound.matched).toBe(true);
    expect(bound.nodeId).toBe('node_c');
    expect(bound.reason).toBe('action-binding');
    const amb = graph.locate('lookup', { allowActionBinding: true });
    expect(amb.matched).toBe(false);
    expect(amb.reason).toBe('ambiguous');
  });

  it('locate on a terminal node is matched with empty hops', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('Start', { type: 'STATE' }), n('End', { type: 'STATE' })],
      [e('Start', 'End')],
      { entryNodeId: 'Start' },
    ));
    const loc = graph.locate('End');
    expect(loc.matched).toBe(true);
    expect(loc.nodeId).toBe('End');
    expect(loc.hops).toEqual([]);
  });

  it('neighborhood groups edges by hop and respects hopLimit 2 on a 4-deep chain', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B'), n('C'), n('D'), n('E')],
      [e('A', 'B'), e('B', 'C'), e('C', 'D'), e('D', 'E')],
      { entryNodeId: 'A' },
    ));
    const hops = graph.neighborhood('A', 2);
    expect(hops).toHaveLength(2);
    expect(hops[0]?.hop).toBe(1);
    expect(hops[0]?.edges.map((x) => `${x.source}->${x.target}`)).toEqual(['A->B']);
    expect(hops[1]?.hop).toBe(2);
    expect(hops[1]?.edges.map((x) => `${x.source}->${x.target}`)).toEqual(['B->C']);
    expect(hops.flatMap((h) => h.edges).some((x) => x.source === 'C')).toBe(false);
  });

  it('neighborhood on a cycle terminates and lists each edge once', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B'), n('C')],
      [e('A', 'B'), e('B', 'C'), e('C', 'A')],
      { entryNodeId: 'A' },
    ));
    const hops = graph.neighborhood('A', 10);
    const keys = hops.flatMap((h) => h.edges).map((x) => `${x.source}->${x.target}`);
    expect(keys).toEqual(['A->B', 'B->C', 'C->A']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('neighborhood preserves parallel edges with different relations', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B')],
      [e('A', 'B', { relation: 'LEADS_TO' }), e('A', 'B', { relation: 'TRIGGERS' })],
      { entryNodeId: 'A' },
    ));
    const hops = graph.neighborhood('A', 1);
    expect(hops[0]?.edges).toHaveLength(2);
    expect(hops[0]?.edges.map((x) => x.relation).sort()).toEqual(['LEADS_TO', 'TRIGGERS']);
  });

  it('withEdits deletes all edges between endpoints regardless of relation before re-adding', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B')],
      [e('A', 'B', { relation: 'LEADS_TO' }), e('A', 'B', { relation: 'TRIGGERS' })],
      { entryNodeId: 'A' },
    ));
    const { graph: next } = graph.withEdits({
      ...emptyEdits(),
      delete_edges: [{ source: 'A', target: 'B' }],
      add_edges: [e('A', 'B', { relation: 'PROVIDES_INPUT_FOR', guidance: 'keep', pitfalls: 'avoid' })],
    });
    expect(next.outgoing('A')).toHaveLength(1);
    expect(next.outgoing('A')[0]?.relation).toBe('PROVIDES_INPUT_FOR');
  });

  it('withEdits removes incident edges of deleted nodes', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B'), n('C')],
      [e('A', 'B'), e('B', 'C')],
      { entryNodeId: 'A' },
    ));
    const { graph: next } = graph.withEdits({
      ...emptyEdits(),
      delete_nodes: ['B'],
    });
    expect(next.hasNode('B')).toBe(false);
    expect(next.outgoing('A')).toHaveLength(0);
    expect(next.incoming('C')).toHaveLength(0);
  });

  it('withEdits applies deletions before additions so a re-added edge survives', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B')],
      [e('A', 'B', { guidance: 'old', pitfalls: 'old-p' })],
      { entryNodeId: 'A' },
    ));
    const { graph: next } = graph.withEdits({
      ...emptyEdits(),
      delete_edges: [{ source: 'A', target: 'B' }],
      add_edges: [e('A', 'B', { guidance: 'new', pitfalls: 'new-p' })],
    });
    expect(next.outgoing('A')).toHaveLength(1);
    expect(next.outgoing('A')[0]?.guidance).toBe('new');
  });

  it('reachesTerminal fails for a node whose only path loops', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B'), n('C'), n('D')],
      [e('A', 'D'), e('B', 'C'), e('C', 'B')],
      { entryNodeId: 'A' },
    ));
    const reach = graph.reachesTerminal();
    expect(reach.ok).toBe(false);
    if (!reach.ok) {
      expect(reach.unreachable).toEqual(['B', 'C']);
    }
  });

  it('findCycleClosingEdges is deterministic across two runs and across node insertion order', () => {
    const nodesFwd = [n('A'), n('B'), n('C'), n('D')];
    const nodesRev = [n('D'), n('C'), n('B'), n('A')];
    const edges = [e('A', 'B'), e('B', 'C'), e('C', 'A'), e('A', 'D')];
    const g1 = ProceduralGraph.fromSnapshot(snap(nodesFwd, edges, { entryNodeId: 'A' }));
    const g2 = ProceduralGraph.fromSnapshot(snap(nodesRev, [...edges].reverse(), { entryNodeId: 'A' }));
    const a = g1.findCycleClosingEdges();
    const b = g1.findCycleClosingEdges();
    const c = g2.findCycleClosingEdges();
    expect(a).toEqual(b);
    expect(a.map((x) => `${x.source}|${x.relation}|${x.target}`))
      .toEqual(c.map((x) => `${x.source}|${x.relation}|${x.target}`));
    expect(a.length).toBeGreaterThan(0);
  });
});
