/**
 * Tests for Procedural Graph prompt serialization.
 */

import { describe, it, expect } from 'vitest';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import {
  serializeFullGraph,
  serializeLocalContext,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphSerializer.js';
import { toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGNode, PGSnapshot } from '../../../../../src/types/proceduralGraph.js';
import {
  EXPECTED_LOCAL_SERIALIZATION,
  HOTPOTQA_MODE2_SNAPSHOT,
} from './fixtures/hotpotqa-mode2.js';

function n(id: string, extras: Partial<PGNode> = {}): PGNode {
  return { id, type: extras.type ?? 'STATE', description: extras.description ?? id, ...extras };
}

function e(source: string, target: string, extras: Partial<PGEdge> = {}): PGEdge {
  return {
    source,
    relation: extras.relation ?? 'LEADS_TO',
    target,
    condition: extras.condition === undefined ? null : extras.condition,
    guidance: extras.guidance === undefined ? null : extras.guidance,
    pitfalls: extras.pitfalls === undefined ? null : extras.pitfalls,
    ...extras,
  };
}

function snap(nodes: PGNode[], edges: PGEdge[], extra: Partial<PGSnapshot> = {}): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId: 'g',
    revisionId: 'r',
    entryNodeId: 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy: 'allow',
    toolCatalogHash: toolCatalogHash([]),
    nodes,
    edges,
    ...extra,
  };
}

describe('ProceduralGraphSerializer', () => {
  it('paper-compatible local serialization of the HotpotQA fixture equals the expected string', () => {
    const graph = ProceduralGraph.fromSnapshot(HOTPOTQA_MODE2_SNAPSHOT);
    const loc = graph.locate('First_Hop_Retrieve');
    const withHops = { ...loc, hops: graph.neighborhood('First_Hop_Retrieve', 2) };
    expect(serializeLocalContext(graph, withHops, 'paper-compatible')).toBe(EXPECTED_LOCAL_SERIALIZATION);
  });

  it('memoryjs style prints the relation label; paper-compatible style does not', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('Start'), n('End')],
      [e('Start', 'End', { relation: 'TRIGGERS', condition: 'ready', guidance: 'go', pitfalls: 'stop' })],
    ));
    const loc = {
      matched: true,
      nodeId: 'Start',
      hops: graph.neighborhood('Start', 1),
      usedFullGraph: false,
      reason: 'exact-id' as const,
    };
    const paper = serializeLocalContext(graph, loc, 'paper-compatible');
    const memoryjs = serializeLocalContext(graph, loc, 'memoryjs');
    expect(paper).toContain('- Transition: [Start] → [End] (Condition: ready)');
    expect(paper).not.toContain('[TRIGGERS]');
    expect(memoryjs).toContain('- Transition: [Start] → [End] [TRIGGERS] (Condition: ready)');
  });

  it('null condition prints as (Condition: null)', () => {
    const graph = ProceduralGraph.fromSnapshot(snap(
      [n('Start'), n('End')],
      [e('Start', 'End', { condition: null, guidance: 'g', pitfalls: 'p' })],
    ));
    const loc = {
      matched: true,
      nodeId: 'Start',
      hops: graph.neighborhood('Start', 1),
      usedFullGraph: false,
    };
    const text = serializeLocalContext(graph, loc, 'paper-compatible');
    expect(text).toContain('(Condition: null)');
  });

  it('serializeFullGraph is deterministic regardless of input order', () => {
    const nodesA = [n('Z'), n('A'), n('M')];
    const nodesB = [n('A'), n('M'), n('Z')];
    const edgesA = [
      e('M', 'Z', { relation: 'TRIGGERS' }),
      e('A', 'M', { relation: 'LEADS_TO' }),
    ];
    const edgesB = [
      e('A', 'M', { relation: 'LEADS_TO' }),
      e('M', 'Z', { relation: 'TRIGGERS' }),
    ];
    const left = serializeFullGraph(
      ProceduralGraph.fromSnapshot(snap(nodesA, edgesA, { entryNodeId: 'A' })),
      'paper-compatible',
    );
    const right = serializeFullGraph(
      ProceduralGraph.fromSnapshot(snap(nodesB, edgesB, { entryNodeId: 'A' })),
      'paper-compatible',
    );
    expect(left).toBe(right);
    expect(left.startsWith('Complete Procedural Graph:\n')).toBe(true);
    const nodeLines = left.split('\n').filter((line) => line.startsWith('Node:'));
    expect(nodeLines[0]).toContain('[A]');
    expect(nodeLines[1]).toContain('[M]');
    expect(nodeLines[2]).toContain('[Z]');
  });
});
