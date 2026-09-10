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
});
