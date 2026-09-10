/**
 * Structural validation, cycle-policy application, and candidate preparation.
 *
 * @module agent/procedural/graph/ProceduralGraphValidator
 * @experimental
 */

import type {
  PGCyclePolicy,
  PGDiagnostic,
  PGEdge,
  PGEditSet,
  PGSnapshot,
  PGValidationReport,
} from '../../../types/proceduralGraph.js';
import { PG_LIMITS } from './ProceduralGraphSchemas.js';
import { ProceduralGraph } from './ProceduralGraph.js';
import { canonicalJson } from './canonical.js';

export interface PGValidatorOptions {
  toolCatalog?: readonly string[];
  enforceToolCatalog: boolean;
  paperCompatible: boolean;
  staticMode?: boolean;
  baselineNodeIds?: readonly string[];
}

export function validateSnapshot(
  snapshot: PGSnapshot,
  opts: PGValidatorOptions,
): PGValidationReport {
  const diagnostics: PGDiagnostic[] = [];
  const seenNodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (seenNodeIds.has(node.id)) {
      if (!duplicateNodeIds.has(node.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'duplicate-node-id',
          message: `Duplicate node id '${node.id}'`,
          nodeId: node.id,
        });
        duplicateNodeIds.add(node.id);
      }
    }
    seenNodeIds.add(node.id);
  }

  const seenEdges = new Set<string>();
  for (const edge of snapshot.edges) {
    const key = `${edge.source}\0${edge.relation}\0${edge.target}`;
    if (seenEdges.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-edge',
        message: `Duplicate edge (${edge.source}, ${edge.relation}, ${edge.target})`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      });
    }
    seenEdges.add(key);
  }

  const vocab = new Set(snapshot.relationVocabulary);
  for (const edge of snapshot.edges) {
    if (!vocab.has(edge.relation)) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-relation',
        message: `Relation '${edge.relation}' is not in the declared vocabulary`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      });
    }
  }

  for (const edge of snapshot.edges) {
    if (!seenNodeIds.has(edge.source)) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-endpoint',
        message: `Edge source '${edge.source}' is not a node`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      });
    }
    if (!seenNodeIds.has(edge.target)) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-endpoint',
        message: `Edge target '${edge.target}' is not a node`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      });
    }
  }

  if (!seenNodeIds.has(snapshot.entryNodeId)) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-entry',
      message: `Entry node '${snapshot.entryNodeId}' is not in the graph`,
      nodeId: snapshot.entryNodeId,
    });
  }

  const graph = ProceduralGraph.fromSnapshot(snapshot);
  const reach = graph.reachesTerminal();
  if (!reach.ok) {
    for (const nodeId of reach.unreachable) {
      diagnostics.push({
        severity: 'error',
        code: 'unreachable-terminal',
        message: `Node '${nodeId}' has no directed path to a terminal`,
        nodeId,
      });
    }
  }

  if (opts.toolCatalog) {
    const catalog = new Set(opts.toolCatalog);
    const enforce = opts.paperCompatible ? false : opts.enforceToolCatalog;
    const severity = enforce ? 'error' : 'warning';
    for (const node of snapshot.nodes) {
      if (node.type !== 'ACTION') {
        continue;
      }
      const binding = node.actionName ?? node.id;
      if (!catalog.has(binding)) {
        diagnostics.push({
          severity,
          code: 'tool-catalog-mismatch',
          message: `ACTION node '${node.id}' binds to '${binding}', which is not in the tool catalog`,
          nodeId: node.id,
        });
      }
    }
  }

  if (opts.staticMode && opts.baselineNodeIds) {
    const present = new Set(snapshot.nodes.map((n) => n.id));
    for (const id of opts.baselineNodeIds) {
      if (!present.has(id)) {
        diagnostics.push({
          severity: 'error',
          code: 'static-node-id-removed',
          message: `Static mode forbids removing baseline node '${id}'`,
          nodeId: id,
        });
      }
    }
  }

  if (snapshot.nodes.length > PG_LIMITS.maxNodes || snapshot.edges.length > PG_LIMITS.maxEdges) {
    diagnostics.push({
      severity: 'error',
      code: 'limit-exceeded',
      message: `Graph exceeds limits (nodes ${snapshot.nodes.length}/${PG_LIMITS.maxNodes}, edges ${snapshot.edges.length}/${PG_LIMITS.maxEdges})`,
    });
  } else {
    const bytes = new TextEncoder().encode(canonicalJson(snapshot)).length;
    if (bytes > PG_LIMITS.maxSerializedBytes) {
      diagnostics.push({
        severity: 'error',
        code: 'limit-exceeded',
        message: `Serialized graph is ${bytes} bytes, limit ${PG_LIMITS.maxSerializedBytes}`,
      });
    }
    for (const node of snapshot.nodes) {
      if (node.id.length > PG_LIMITS.maxIdLength || node.description.length > PG_LIMITS.maxTextLength) {
        diagnostics.push({
          severity: 'error',
          code: 'limit-exceeded',
          message: `Node '${node.id}' exceeds length limits`,
          nodeId: node.id,
        });
      }
    }
    for (const edge of snapshot.edges) {
      const texts = [edge.condition, edge.guidance, edge.pitfalls];
      if (texts.some((t) => t !== null && t.length > PG_LIMITS.maxTextLength)) {
        diagnostics.push({
          severity: 'error',
          code: 'limit-exceeded',
          message: `Edge (${edge.source}, ${edge.relation}, ${edge.target}) exceeds text limits`,
          edge: { source: edge.source, target: edge.target, relation: edge.relation },
        });
      }
    }
  }

  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

export function applyCyclePolicy(
  graph: ProceduralGraph,
  policy: PGCyclePolicy,
): { graph: ProceduralGraph; repairs: PGEdge[]; diagnostics: PGDiagnostic[] } {
  if (policy === 'allow') {
    return { graph, repairs: [], diagnostics: [] };
  }

  if (policy === 'reject') {
    const closing = graph.findCycleClosingEdges();
    if (closing.length === 0) {
      return { graph, repairs: [], diagnostics: [] };
    }
    return {
      graph,
      repairs: [],
      diagnostics: closing.map((edge) => ({
        severity: 'error' as const,
        code: 'cycle-detected',
        message: `Cycle-closing edge (${edge.source}, ${edge.relation}, ${edge.target})`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      })),
    };
  }

  const repairs: PGEdge[] = [];
  const diagnostics: PGDiagnostic[] = [];
  let current = graph;
  for (;;) {
    const closing = current.findCycleClosingEdges();
    if (closing.length === 0) {
      break;
    }
    const remove = new Set(closing.map((e) => `${e.source}\0${e.relation}\0${e.target}`));
    for (const edge of closing) {
      repairs.push(edge);
      diagnostics.push({
        severity: 'info',
        code: 'cycle-repaired',
        message: `Removed cycle-closing edge (${edge.source}, ${edge.relation}, ${edge.target})`,
        edge: { source: edge.source, target: edge.target, relation: edge.relation },
      });
    }
    current = ProceduralGraph.fromSnapshot({
      ...current.snapshot,
      edges: current.snapshot.edges.filter(
        (e) => !remove.has(`${e.source}\0${e.relation}\0${e.target}`),
      ),
    });
  }
  return { graph: current, repairs, diagnostics };
}

export function prepareCandidate(
  retained: ProceduralGraph,
  edits: PGEditSet,
  opts: PGValidatorOptions & { cyclePolicy: PGCyclePolicy; nextRevisionId: string; parentRevisionId: string },
):
  | { ok: true; candidate: ProceduralGraph; repairs: PGEdge[]; diagnostics: PGDiagnostic[] }
  | { ok: false; diagnostics: PGDiagnostic[]; repairs: PGEdge[] } {
  const edited = retained.withEdits(edits);
  const cycled = applyCyclePolicy(edited.graph, opts.cyclePolicy);
  const candidate = ProceduralGraph.fromSnapshot({
    ...cycled.graph.snapshot,
    revisionId: opts.nextRevisionId,
    parentRevisionId: opts.parentRevisionId,
  });
  const report = validateSnapshot(candidate.snapshot, opts);
  const diagnostics = [...edited.diagnostics, ...cycled.diagnostics, ...report.diagnostics];
  const repairs = cycled.repairs;
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics, repairs };
  }
  return { ok: true, candidate, repairs, diagnostics };
}
