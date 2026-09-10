/**
 * Immutable Procedural Graph snapshot wrapper.
 *
 * Does not validate; callers run `validateSnapshot` / `prepareCandidate`.
 *
 * @module agent/procedural/graph/ProceduralGraph
 * @experimental
 */

import type {
  PGDiagnostic,
  PGEdge,
  PGEditSet,
  PGLocalization,
  PGNode,
  PGSnapshot,
} from '../../../types/proceduralGraph.js';
import { graphDigest } from './canonical.js';

export class ProceduralGraph {
  readonly snapshot: PGSnapshot;
  readonly digest: string;

  private readonly nodesById: ReadonlyMap<string, PGNode>;
  private readonly outgoingById: ReadonlyMap<string, readonly PGEdge[]>;
  private readonly incomingById: ReadonlyMap<string, readonly PGEdge[]>;

  private constructor(snapshot: PGSnapshot) {
    this.snapshot = snapshot;
    this.digest = graphDigest(snapshot);

    const nodesById = new Map<string, PGNode>();
    for (const node of snapshot.nodes) {
      nodesById.set(node.id, node);
    }
    this.nodesById = nodesById;

    const outgoing = new Map<string, PGEdge[]>();
    const incoming = new Map<string, PGEdge[]>();
    for (const node of snapshot.nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }
    for (const edge of snapshot.edges) {
      const out = outgoing.get(edge.source);
      if (out) {
        out.push(edge);
      } else {
        outgoing.set(edge.source, [edge]);
      }
      const inn = incoming.get(edge.target);
      if (inn) {
        inn.push(edge);
      } else {
        incoming.set(edge.target, [edge]);
      }
    }
    for (const list of outgoing.values()) {
      list.sort(compareOutgoing);
    }
    for (const list of incoming.values()) {
      list.sort(compareIncoming);
    }
    this.outgoingById = outgoing;
    this.incomingById = incoming;
  }

  /** Deep-freezes a copy. Does not validate. */
  static fromSnapshot(snapshot: PGSnapshot): ProceduralGraph {
    return new ProceduralGraph(deepFreeze(structuredClone(snapshot)));
  }

  hasNode(id: string): boolean {
    return this.nodesById.has(id);
  }

  getNode(id: string): PGNode | undefined {
    return this.nodesById.get(id);
  }

  /** Outgoing edges, sorted by `(target, relation)`. */
  outgoing(id: string): readonly PGEdge[] {
    return this.outgoingById.get(id) ?? [];
  }

  incoming(id: string): readonly PGEdge[] {
    return this.incomingById.get(id) ?? [];
  }

  /** Zero out-degree node ids, sorted. */
  terminals(): readonly string[] {
    return this.snapshot.nodes
      .filter((n) => this.outgoing(n.id).length === 0)
      .map((n) => n.id)
      .sort(compareString);
  }

  /**
   * PG-03 localization. `undefined` lastAction → entry node.
   * Exact id match first; optional `actionName` binding; hops stay empty
   * (filled by `neighborhood`).
   */
  locate(
    lastAction: string | undefined,
    opts?: { allowActionBinding?: boolean },
  ): PGLocalization {
    if (lastAction === undefined) {
      return {
        matched: true,
        nodeId: this.snapshot.entryNodeId,
        hops: [],
        usedFullGraph: false,
        reason: 'entry',
      };
    }

    if (this.hasNode(lastAction)) {
      return {
        matched: true,
        nodeId: lastAction,
        hops: [],
        usedFullGraph: false,
        reason: 'exact-id',
      };
    }

    if (opts?.allowActionBinding) {
      const matches: string[] = [];
      for (const node of this.snapshot.nodes) {
        if (node.actionName === lastAction) {
          matches.push(node.id);
        }
      }
      if (matches.length === 1) {
        return {
          matched: true,
          nodeId: matches[0],
          hops: [],
          usedFullGraph: false,
          reason: 'action-binding',
        };
      }
      if (matches.length > 1) {
        return {
          matched: false,
          hops: [],
          usedFullGraph: false,
          reason: 'ambiguous',
        };
      }
    }

    return {
      matched: false,
      hops: [],
      usedFullGraph: false,
      reason: 'not-found',
    };
  }

  /**
   * Outgoing BFS by hop. An edge appears in the first hop that reaches it.
   * A visited-edge set bounds cycles.
   */
  neighborhood(nodeId: string, hops: number): PGLocalization['hops'] {
    if (hops <= 0 || !this.hasNode(nodeId)) {
      return [];
    }

    const result: PGLocalization['hops'] = [];
    const visited = new Set<string>();
    let frontier: string[] = [nodeId];

    for (let hop = 1; hop <= hops; hop++) {
      const hopEdges: PGEdge[] = [];
      const next: string[] = [];
      const nextSeen = new Set<string>();
      const orderedFrontier = [...frontier].sort(compareString);
      for (const id of orderedFrontier) {
        for (const edge of this.outgoing(id)) {
          const key = edgeKey(edge);
          if (visited.has(key)) {
            continue;
          }
          visited.add(key);
          hopEdges.push(edge);
          if (!nextSeen.has(edge.target)) {
            nextSeen.add(edge.target);
            next.push(edge.target);
          }
        }
      }
      hopEdges.sort(compareEdges);
      if (hopEdges.length === 0) {
        break;
      }
      result.push({ hop, edges: hopEdges });
      frontier = next;
    }
    return result;
  }

  /**
   * Every node must have a directed path to some zero-outdegree terminal (PG-08).
   */
  reachesTerminal(): { ok: true } | { ok: false; unreachable: string[] } {
    const terminals = this.terminals();
    const canReach = new Set<string>(terminals);
    const reverse = new Map<string, string[]>();
    for (const edge of this.snapshot.edges) {
      const list = reverse.get(edge.target);
      if (list) {
        list.push(edge.source);
      } else {
        reverse.set(edge.target, [edge.source]);
      }
    }
    const queue = [...terminals];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const pred of reverse.get(current) ?? []) {
        if (!canReach.has(pred)) {
          canReach.add(pred);
          queue.push(pred);
        }
      }
    }
    const unreachable = this.snapshot.nodes
      .map((n) => n.id)
      .filter((id) => !canReach.has(id))
      .sort(compareString);
    if (unreachable.length === 0) {
      return { ok: true };
    }
    return { ok: false, unreachable };
  }

  /**
   * Cycle-closing back edges. DFS from `entryNodeId`, then remaining nodes
   * in sorted id order. Back edges are recorded in discovery order.
   */
  findCycleClosingEdges(): PGEdge[] {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const node of this.snapshot.nodes) {
      color.set(node.id, WHITE);
    }
    const closing: PGEdge[] = [];

    const visit = (id: string): void => {
      color.set(id, GRAY);
      for (const edge of this.outgoing(id)) {
        const targetColor = color.get(edge.target) ?? WHITE;
        if (targetColor === WHITE) {
          visit(edge.target);
        } else if (targetColor === GRAY) {
          closing.push(edge);
        }
      }
      color.set(id, BLACK);
    };

    const entry = this.snapshot.entryNodeId;
    if (this.hasNode(entry) && color.get(entry) === WHITE) {
      visit(entry);
    }
    const remaining = this.snapshot.nodes
      .map((n) => n.id)
      .filter((id) => color.get(id) === WHITE)
      .sort(compareString);
    for (const id of remaining) {
      if (color.get(id) === WHITE) {
        visit(id);
      }
    }
    return closing;
  }

  /**
   * Apply feature-plan 9.5 steps 1–4 only (no cycle policy, no validation).
   * Revision identifiers are left unchanged.
   */
  withEdits(edits: PGEditSet): { graph: ProceduralGraph; diagnostics: PGDiagnostic[] } {
    const diagnostics: PGDiagnostic[] = [];
    const nodes = new Map<string, PGNode>();
    for (const node of this.snapshot.nodes) {
      nodes.set(node.id, cloneNode(node));
    }
    let edges = this.snapshot.edges.map(cloneEdge);

    const deletePairs = new Set(
      edits.delete_edges.map((e) => pairKey(e.source, e.target)),
    );
    edges = edges.filter((e) => !deletePairs.has(pairKey(e.source, e.target)));

    const deletedIds = new Set(edits.delete_nodes);
    for (let i = 0; i < edits.delete_nodes.length; i++) {
      const id = edits.delete_nodes[i];
      if (!nodes.has(id)) {
        diagnostics.push({
          severity: 'warning',
          code: 'missing-node',
          message: `delete_nodes[${i}] '${id}' is not in the graph`,
          nodeId: id,
          editIndex: i,
        });
      }
    }
    for (const id of deletedIds) {
      nodes.delete(id);
    }
    edges = edges.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target));

    for (let i = 0; i < edits.add_nodes.length; i++) {
      const incoming = edits.add_nodes[i];
      if (nodes.has(incoming.id)) {
        diagnostics.push({
          severity: 'warning',
          code: 'duplicate-add-node',
          message: `add_nodes[${i}] id '${incoming.id}' already exists`,
          nodeId: incoming.id,
          editIndex: i,
        });
        continue;
      }
      nodes.set(incoming.id, cloneNode(incoming));
    }

    const edgeKeys = new Set(edges.map(edgeKey));
    for (let i = 0; i < edits.add_edges.length; i++) {
      const incoming = edits.add_edges[i];
      const key = edgeKey(incoming);
      if (edgeKeys.has(key)) {
        diagnostics.push({
          severity: 'warning',
          code: 'duplicate-edge',
          message: `add_edges[${i}] triplet already exists`,
          edge: { source: incoming.source, target: incoming.target, relation: incoming.relation },
          editIndex: i,
        });
        continue;
      }
      edges.push(cloneEdge(incoming));
      edgeKeys.add(key);
    }

    const next: PGSnapshot = {
      ...this.snapshot,
      nodes: [...nodes.values()],
      edges,
    };
    return { graph: ProceduralGraph.fromSnapshot(next), diagnostics };
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

function cloneNode(node: PGNode): PGNode {
  return {
    id: node.id,
    type: node.type,
    description: node.description,
    ...(node.actionName !== undefined ? { actionName: node.actionName } : {}),
  };
}

function cloneEdge(edge: PGEdge): PGEdge {
  return {
    source: edge.source,
    relation: edge.relation,
    target: edge.target,
    condition: edge.condition,
    guidance: edge.guidance,
    pitfalls: edge.pitfalls,
  };
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOutgoing(a: PGEdge, b: PGEdge): number {
  return compareString(a.target, b.target) || compareString(a.relation, b.relation);
}

function compareIncoming(a: PGEdge, b: PGEdge): number {
  return compareString(a.source, b.source) || compareString(a.relation, b.relation);
}

function compareEdges(a: PGEdge, b: PGEdge): number {
  return compareString(a.source, b.source)
    || compareString(a.target, b.target)
    || compareString(a.relation, b.relation);
}

function edgeKey(edge: Pick<PGEdge, 'source' | 'relation' | 'target'>): string {
  return `${edge.source}\0${edge.relation}\0${edge.target}`;
}

function pairKey(source: string, target: string): string {
  return `${source}\0${target}`;
}
