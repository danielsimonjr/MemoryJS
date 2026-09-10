/**
 * Tests for snapshot validation, cycle policy, and candidate preparation.
 */

import { describe, it, expect } from 'vitest';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import {
  applyCyclePolicy,
  prepareCandidate,
  validateSnapshot,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphValidator.js';
import { toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGEditSet, PGNode, PGSnapshot } from '../../../../../src/types/proceduralGraph.js';
import {
  HOTPOTQA_MODE2_NODES,
  HOTPOTQA_MODE2_SNAPSHOT,
} from './fixtures/hotpotqa-mode2.js';

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
    revisionId: 'r1',
    entryNodeId: 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy: 'allow',
    toolCatalogHash: toolCatalogHash([]),
    nodes,
    edges,
    ...extra,
  };
}

const validNodes = [n('Start', { type: 'STATE' }), n('lookup'), n('End', { type: 'STATE' })];
const validEdges = [e('Start', 'lookup'), e('lookup', 'End')];

function validSnapshot(extra: Partial<PGSnapshot> = {}): PGSnapshot {
  return snap(validNodes, validEdges, extra);
}

const emptyEdits = (): PGEditSet => ({
  add_nodes: [],
  delete_nodes: [],
  add_edges: [],
  delete_edges: [],
});

describe('ProceduralGraphValidator', () => {
  it('validateSnapshot flags a missing endpoint', () => {
    const report = validateSnapshot(
      snap([n('Start', { type: 'STATE' })], [e('Start', 'Missing')], { entryNodeId: 'Start' }),
      { enforceToolCatalog: false, paperCompatible: true },
    );
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((d) => d.code === 'missing-endpoint')).toBe(true);
  });

  it('flags unknown relation outside vocabulary', () => {
    const report = validateSnapshot(
      snap(
        [n('Start', { type: 'STATE' }), n('End', { type: 'STATE' })],
        [e('Start', 'End', { relation: 'INVENTED' })],
        { entryNodeId: 'Start' },
      ),
      { enforceToolCatalog: false, paperCompatible: true },
    );
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((d) => d.code === 'unknown-relation')).toBe(true);
  });

  it('accepts declared extension vocabulary', () => {
    const report = validateSnapshot(
      snap(
        [n('Start', { type: 'STATE' }), n('End', { type: 'STATE' })],
        [e('Start', 'End', { relation: 'CUSTOM_REL' })],
        { entryNodeId: 'Start', relationVocabulary: [...PG_BUILT_IN_RELATIONS, 'CUSTOM_REL'] },
      ),
      { enforceToolCatalog: false, paperCompatible: true },
    );
    expect(report.diagnostics.some((d) => d.code === 'unknown-relation')).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('accepts a terminal not named End', () => {
    const report = validateSnapshot(
      snap(
        [n('Start', { type: 'STATE' }), n('Done', { type: 'STATE' })],
        [e('Start', 'Done')],
        { entryNodeId: 'Start' },
      ),
      { enforceToolCatalog: false, paperCompatible: true },
    );
    expect(report.ok).toBe(true);
    expect(report.diagnostics.some((d) => d.code === 'unreachable-terminal')).toBe(false);
  });

  it('tool-catalog mismatch is a warning when enforceToolCatalog=false and an error when true', () => {
    const snapshot = validSnapshot();
    const warn = validateSnapshot(snapshot, {
      toolCatalog: ['other_tool'],
      enforceToolCatalog: false,
      paperCompatible: false,
    });
    expect(warn.diagnostics.some((d) => d.code === 'tool-catalog-mismatch' && d.severity === 'warning')).toBe(true);
    expect(warn.ok).toBe(true);

    const err = validateSnapshot(snapshot, {
      toolCatalog: ['other_tool'],
      enforceToolCatalog: true,
      paperCompatible: false,
    });
    expect(err.diagnostics.some((d) => d.code === 'tool-catalog-mismatch' && d.severity === 'error')).toBe(true);
    expect(err.ok).toBe(false);
  });

  it('staticMode rejects removal of a baseline node id', () => {
    const report = validateSnapshot(validSnapshot(), {
      enforceToolCatalog: false,
      paperCompatible: true,
      staticMode: true,
      baselineNodeIds: ['Start', 'lookup', 'End', 'Scan_Index'],
    });
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((d) => d.code === 'static-node-id-removed' && d.nodeId === 'Scan_Index')).toBe(true);
  });

  it("applyCyclePolicy 'allow' leaves a cycle; 'reject' errors; 'repair' removes closing edges and records them", () => {
    const cyclic = ProceduralGraph.fromSnapshot(snap(
      [n('A'), n('B'), n('C')],
      [e('A', 'B'), e('B', 'C'), e('C', 'A')],
      { entryNodeId: 'A' },
    ));

    const allowed = applyCyclePolicy(cyclic, 'allow');
    expect(allowed.graph.findCycleClosingEdges().length).toBeGreaterThan(0);
    expect(allowed.repairs).toEqual([]);

    const rejected = applyCyclePolicy(cyclic, 'reject');
    expect(rejected.diagnostics.some((d) => d.code === 'cycle-detected' && d.severity === 'error')).toBe(true);
    expect(rejected.graph.findCycleClosingEdges().length).toBeGreaterThan(0);

    const repaired = applyCyclePolicy(cyclic, 'repair');
    expect(repaired.graph.findCycleClosingEdges()).toEqual([]);
    expect(repaired.repairs.length).toBeGreaterThan(0);
  });

  it('prepareCandidate never returns ok when any error diagnostic exists', () => {
    const retained = ProceduralGraph.fromSnapshot(validSnapshot());
    const result = prepareCandidate(retained, {
      ...emptyEdits(),
      add_edges: [e('Start', 'ghost', { guidance: 'x', pitfalls: 'y' })],
    }, {
      enforceToolCatalog: false,
      paperCompatible: true,
      cyclePolicy: 'reject',
      nextRevisionId: 'r2',
      parentRevisionId: 'r1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }
  });

  it('prepareCandidate assigns nextRevisionId and parentRevisionId', () => {
    const retained = ProceduralGraph.fromSnapshot(validSnapshot());
    const result = prepareCandidate(retained, emptyEdits(), {
      enforceToolCatalog: false,
      paperCompatible: true,
      cyclePolicy: 'reject',
      nextRevisionId: 'r2',
      parentRevisionId: 'r1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.snapshot.revisionId).toBe('r2');
      expect(result.candidate.snapshot.parentRevisionId).toBe('r1');
    }
  });

  it('static-mode rename: deleting Scan_Index and adding scan_index_v2 is static-node-id-removed', () => {
    const scan = HOTPOTQA_MODE2_NODES.find((node) => node.id === 'Scan_Index');
    expect(scan).toBeDefined();
    const retained = ProceduralGraph.fromSnapshot(HOTPOTQA_MODE2_SNAPSHOT);
    const result = prepareCandidate(retained, {
      add_nodes: [{
        id: 'scan_index_v2',
        type: scan!.type,
        description: scan!.description,
      }],
      delete_nodes: ['Scan_Index'],
      add_edges: [],
      delete_edges: [],
    }, {
      enforceToolCatalog: false,
      paperCompatible: true,
      staticMode: true,
      baselineNodeIds: HOTPOTQA_MODE2_NODES.map((node) => node.id),
      cyclePolicy: 'allow',
      nextRevisionId: 'r2',
      parentRevisionId: HOTPOTQA_MODE2_SNAPSHOT.revisionId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => (
        d.code === 'static-node-id-removed' && d.severity === 'error' && d.nodeId === 'Scan_Index'
      ))).toBe(true);
    }
  });

  it("property: applyCyclePolicy repair is acyclic and deterministic across 200 random graphs", () => {
    const rng = mulberry32(20260912);
    for (let i = 0; i < 200; i++) {
      const snapshot = randomPossiblyCyclicSnapshot(rng);
      const first = ProceduralGraph.fromSnapshot(snapshot);
      const second = ProceduralGraph.fromSnapshot({
        ...snapshot,
        nodes: [...snapshot.nodes],
        edges: [...snapshot.edges],
      });
      const a = applyCyclePolicy(first, 'repair');
      const b = applyCyclePolicy(second, 'repair');
      expect(a.graph.findCycleClosingEdges(), `graph ${i} first run acyclic`).toEqual([]);
      expect(b.graph.findCycleClosingEdges(), `graph ${i} second run acyclic`).toEqual([]);
      expect(a.graph.digest, `graph ${i} digest`).toBe(b.graph.digest);
      expect(
        a.repairs.map((edge) => `${edge.source}|${edge.relation}|${edge.target}`),
        `graph ${i} repairs`,
      ).toEqual(b.repairs.map((edge) => `${edge.source}|${edge.relation}|${edge.target}`));
      const again = applyCyclePolicy(a.graph, 'repair');
      expect(again.graph.digest, `graph ${i} repair idempotent`).toBe(a.graph.digest);
      expect(again.repairs, `graph ${i} second repair empty`).toEqual([]);
    }
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randomPossiblyCyclicSnapshot(rng: () => number): PGSnapshot {
  const nodeCount = randInt(rng, 2, 8);
  const nodes: PGNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(n(`n${i}`, {
      type: pick(rng, ['ACTION', 'SKILL', 'REASONING', 'STATE'] as const),
      description: `desc-${i}-${randInt(rng, 0, 99)}`,
    }));
  }
  const seen = new Set<string>();
  const edges: PGEdge[] = [];
  const pushEdge = (source: string, target: string, relation: PGEdge['relation'], extras: Partial<PGEdge> = {}): void => {
    const key = `${source}\0${relation}\0${target}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push(e(source, target, { relation, ...extras }));
  };
  const edgeCount = randInt(rng, 1, nodeCount + 3);
  for (let i = 0; i < edgeCount; i++) {
    pushEdge(
      pick(rng, nodes).id,
      pick(rng, nodes).id,
      pick(rng, PG_BUILT_IN_RELATIONS),
      {
        condition: rng() < 0.5 ? null : `cond-${i}`,
        guidance: `g-${i}`,
        pitfalls: `p-${i}`,
      },
    );
  }
  if (rng() < 0.7) {
    for (let i = 0; i < nodes.length; i++) {
      pushEdge(
        nodes[i]!.id,
        nodes[(i + 1) % nodes.length]!.id,
        'LEADS_TO',
        { guidance: `cycle-${i}`, pitfalls: `cycle-p-${i}` },
      );
    }
  }
  if (edges.length === 0) {
    pushEdge(nodes[0]!.id, nodes[nodes.length - 1]!.id, 'LEADS_TO');
  }
  return snap(nodes, edges, {
    graphId: `g-${randInt(rng, 0, 9999)}`,
    revisionId: `r-${randInt(rng, 0, 9999)}`,
    entryNodeId: nodes[0]!.id,
    cyclePolicy: 'repair',
  });
}
