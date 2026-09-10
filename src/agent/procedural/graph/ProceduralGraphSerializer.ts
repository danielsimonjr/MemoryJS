/**
 * Prompt-facing serialization of a Procedural Graph.
 *
 * Paper-compatible local shape is copied from feature plan 8.4.
 *
 * @module agent/procedural/graph/ProceduralGraphSerializer
 * @experimental
 */

import type { PGEdge, PGLocalization, PGNode } from '../../../types/proceduralGraph.js';
import { canonicalJson } from './canonical.js';
import type { ProceduralGraph } from './ProceduralGraph.js';

export type PGSerializerStyle = 'paper-compatible' | 'memoryjs';

export function serializeLocalContext(
  graph: ProceduralGraph,
  loc: PGLocalization,
  style: PGSerializerStyle,
): string {
  const nodeId = loc.nodeId ?? graph.snapshot.entryNodeId;
  const node = graph.getNode(nodeId);
  const lines: string[] = [
    `Active Cognitive Node: [${nodeId}] (Type: ${node?.type ?? 'STATE'})`,
    `Description: ${node?.description ?? ''}`,
  ];

  const hops = [...loc.hops].sort((a, b) => a.hop - b.hop);
  for (const group of hops) {
    if (group.edges.length === 0) {
      continue;
    }
    lines.push('');
    lines.push(hopHeader(group.hop));
    const edges = [...group.edges].sort(compareEdges);
    for (const edge of edges) {
      lines.push(...formatTransition(edge, style));
    }
  }
  return lines.join('\n');
}

export function serializeFullGraph(graph: ProceduralGraph, style: PGSerializerStyle): string {
  const lines: string[] = ['Complete Procedural Graph:'];
  const nodes = [...graph.snapshot.nodes].sort((a, b) => compareString(a.id, b.id));
  for (const node of nodes) {
    lines.push(formatNodeLine(node));
  }
  const edges = [...graph.snapshot.edges].sort(compareEdges);
  if (edges.length > 0) {
    lines.push('');
    for (const edge of edges) {
      lines.push(...formatTransition(edge, style));
    }
  }
  return lines.join('\n');
}

export function serializeGraphJson(graph: ProceduralGraph): string {
  return canonicalJson({
    nodes: graph.snapshot.nodes,
    edges: graph.snapshot.edges,
  });
}

function hopHeader(hop: number): string {
  if (hop === 1) {
    return 'Immediate Transition Options (Hop 1):';
  }
  return `Subsequent Horizon (Hop ${hop}):`;
}

function formatNodeLine(node: PGNode): string {
  return `Node: [${node.id}] (Type: ${node.type}) — ${node.description}`;
}

function formatTransition(edge: PGEdge, style: PGSerializerStyle): string[] {
  const relationSuffix = style === 'memoryjs' ? ` [${edge.relation}]` : '';
  const condition = edge.condition === null ? 'null' : edge.condition;
  const guidance = edge.guidance === null ? '(none)' : edge.guidance;
  const pitfalls = edge.pitfalls === null ? '(none)' : edge.pitfalls;
  return [
    `- Transition: [${edge.source}] → [${edge.target}]${relationSuffix} (Condition: ${condition})`,
    `  * Guidance: ${guidance}`,
    `  * Pitfalls to Avoid: ${pitfalls}`,
  ];
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEdges(a: PGEdge, b: PGEdge): number {
  return compareString(a.source, b.source)
    || compareString(a.target, b.target)
    || compareString(a.relation, b.relation);
}
