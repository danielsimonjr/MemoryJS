/**
 * Tests for Procedural Graph Zod schemas and parsers.
 */

import { describe, it, expect } from 'vitest';
import {
  PG_LIMITS,
  parseEditSet,
  parseSnapshot,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphSchemas.js';
import { toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';

const PAPER_EDIT_SET = `{
"add_nodes": [{"id":"lookup", "type": "ACTION", "description":"Look up the entity"}],
"delete_nodes": ["node_id"],
"add_edges": [{"source":"Start", "target":"lookup", "relation":"LEADS_TO", "condition":null, "guidance":"Call lookup next", "pitfalls":"Do not skip lookup"}],
"delete_edges": [{"source":"Start", "target":"End"}]
}`;

describe('ProceduralGraphSchemas', () => {
  it("parseEditSet accepts the paper's exact output format example with concrete values", () => {
    const result = parseEditSet(PAPER_EDIT_SET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.add_nodes).toEqual([
        { id: 'lookup', type: 'ACTION', description: 'Look up the entity' },
      ]);
      expect(result.value.delete_nodes).toEqual(['node_id']);
      expect(result.value.add_edges[0]?.condition).toBeNull();
      expect(result.value.delete_edges).toEqual([{ source: 'Start', target: 'End' }]);
    }
  });

  it('parseEditSet rejects a fenced ```json block', () => {
    const fenced = '```json\n' + PAPER_EDIT_SET + '\n```';
    const result = parseEditSet(fenced);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'not-raw-json')).toBe(true);
    }
  });

  it('rejects surrounding prose', () => {
    const result = parseEditSet('Here is the edit set:\n' + PAPER_EDIT_SET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'not-raw-json')).toBe(true);
    }
  });

  it('rejects unknown top-level key', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [],
"delete_edges": [],
"rename_nodes": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'unknown-key')).toBe(true);
    }
  });

  it('rejects add_edges entry with missing pitfalls', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [{"source":"A", "target":"B", "relation":"LEADS_TO", "condition":null, "guidance":"go"}],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'missing-required-attribute')).toBe(true);
      expect(result.diagnostics.some((d) => d.editIndex === 0)).toBe(true);
    }
  });

  it('accepts condition null', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [{"source":"A", "target":"B", "relation":"LEADS_TO", "condition":null, "guidance":"go", "pitfalls":"stop"}],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.add_edges[0]?.condition).toBeNull();
    }
  });

  it('rejects add_edges entry whose condition is not a string or null', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [{"source":"A", "target":"B", "relation":"LEADS_TO", "condition":1, "guidance":"go", "pitfalls":"stop"}],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'invalid-condition')).toBe(true);
      expect(result.diagnostics.some((d) => d.editIndex === 0)).toBe(true);
    }
  });

  it('rejects delete_edges entry with relation field', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [],
"delete_edges": [{"source":"A", "target":"B", "relation":"LEADS_TO"}]
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.editIndex === 0)).toBe(true);
    }
  });

  it('rejects add_nodes entry with a type outside PGNodeType', () => {
    const raw = `{
"add_nodes": [{"id":"A", "type": "TOOL", "description":"nope"}],
"delete_nodes": [],
"add_edges": [],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'invalid-node-type')).toBe(true);
      expect(result.diagnostics.some((d) => d.editIndex === 0)).toBe(true);
    }
  });

  it('rejects duplicate add_nodes ids', () => {
    const raw = `{
"add_nodes": [{"id":"A", "type": "ACTION", "description":"one"}, {"id":"A", "type": "ACTION", "description":"two"}],
"delete_nodes": [],
"add_edges": [],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'duplicate-add-node')).toBe(true);
    }
  });

  it('reports editIndex on failures', () => {
    const raw = `{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [
  {"source":"A", "target":"B", "relation":"LEADS_TO", "condition":null, "guidance":"go", "pitfalls":"ok"},
  {"source":"B", "target":"C", "relation":"LEADS_TO", "condition":null, "guidance":"go"}
],
"delete_edges": []
}`;
    const result = parseEditSet(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.editIndex === 1)).toBe(true);
    }
  });

  it('parseSnapshot accepts null guidance on an imported edge and reports no error', () => {
    const result = parseSnapshot({
      schemaVersion: 1,
      graphId: 'g',
      revisionId: 'r',
      entryNodeId: 'Start',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
      cyclePolicy: 'allow',
      toolCatalogHash: toolCatalogHash([]),
      nodes: [
        { id: 'Start', type: 'STATE', description: 's' },
        { id: 'End', type: 'STATE', description: 'e' },
      ],
      edges: [{
        source: 'Start',
        relation: 'LEADS_TO',
        target: 'End',
        condition: null,
        guidance: null,
        pitfalls: null,
      }],
    });
    expect(result.ok).toBe(true);
  });

  it('PG_LIMITS admit 131 nodes and 265 edges', () => {
    expect(PG_LIMITS.maxNodes).toBeGreaterThanOrEqual(131);
    expect(PG_LIMITS.maxEdges).toBeGreaterThanOrEqual(265);
  });

  it('parseEditSet rejects missing arrays, non-arrays, and non-object JSON', () => {
    const missing = parseEditSet('{"add_nodes":[],"delete_nodes":[],"add_edges":[]}');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics.some((d) => d.code === 'missing-field')).toBe(true);
    }

    const notArray = parseEditSet('{"add_nodes":{},"delete_nodes":[],"add_edges":[],"delete_edges":[]}');
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) {
      expect(notArray.diagnostics.some((d) => d.code === 'invalid-type')).toBe(true);
    }

    expect(parseEditSet('[]').ok).toBe(false);
    expect(parseEditSet('{').ok).toBe(false);
    expect(parseEditSet('{not json}').ok).toBe(false);
  });

  it('parseEditSet reports invalid delete_nodes and add_edges item shapes', () => {
    const badDeletes = parseEditSet(`{
"add_nodes": [],
"delete_nodes": [""],
"add_edges": [],
"delete_edges": []
}`);
    expect(badDeletes.ok).toBe(false);
    if (!badDeletes.ok) {
      expect(badDeletes.diagnostics.some((d) => d.code === 'invalid-type')).toBe(true);
    }

    const notEdge = parseEditSet(`{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [null],
"delete_edges": []
}`);
    expect(notEdge.ok).toBe(false);
    if (!notEdge.ok) {
      expect(notEdge.diagnostics.some((d) => d.code === 'invalid-type')).toBe(true);
    }

    const extraEdgeKey = parseEditSet(`{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [{"source":"A","target":"B","relation":"LEADS_TO","condition":null,"guidance":"go now","pitfalls":"stop now","extra":1}],
"delete_edges": []
}`);
    expect(extraEdgeKey.ok).toBe(false);

    const duplicateEdge = parseEditSet(`{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [
  {"source":"A","target":"B","relation":"LEADS_TO","condition":null,"guidance":"go now","pitfalls":"stop now"},
  {"source":"A","target":"B","relation":"LEADS_TO","condition":null,"guidance":"go later","pitfalls":"stop later"}
],
"delete_edges": []
}`);
    expect(duplicateEdge.ok).toBe(false);
    if (!duplicateEdge.ok) {
      expect(duplicateEdge.diagnostics.some((d) => d.code === 'duplicate-add-edge')).toBe(true);
    }

    expect(parseEditSet(`{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [],
"delete_edges": [null]
}`).ok).toBe(false);

    expect(parseEditSet(`{
"add_nodes": [],
"delete_nodes": [],
"add_edges": [],
"delete_edges": [{"source":"","target":"B"}]
}`).ok).toBe(false);
  });

  it('parseSnapshot maps unrecognized keys and omitted edge attributes', () => {
    const unknown = parseSnapshot({
      schemaVersion: 1,
      graphId: 'g',
      revisionId: 'r',
      entryNodeId: 'Start',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
      cyclePolicy: 'allow',
      toolCatalogHash: toolCatalogHash([]),
      nodes: [{ id: 'Start', type: 'STATE', description: 's' }],
      edges: [],
      extra: true,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.diagnostics.some((d) => d.code === 'unknown-key')).toBe(true);
    }

    const omitted = parseSnapshot({
      schemaVersion: 1,
      graphId: 'g',
      revisionId: 'r',
      entryNodeId: 'Start',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
      cyclePolicy: 'allow',
      toolCatalogHash: toolCatalogHash([]),
      nodes: [
        { id: 'Start', type: 'STATE', description: 's' },
        { id: 'End', type: 'STATE', description: 'e' },
      ],
      edges: [{ source: 'Start', relation: 'LEADS_TO', target: 'End' }],
    });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) {
      expect(omitted.value.edges[0]?.condition).toBeNull();
      expect(omitted.value.edges[0]?.guidance).toBeNull();
      expect(omitted.value.edges[0]?.pitfalls).toBeNull();
    }

    expect(parseSnapshot(null).ok).toBe(false);
    expect(parseSnapshot({
      schemaVersion: 1,
      graphId: 'g',
      revisionId: 'r',
      entryNodeId: 'Start',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
      cyclePolicy: 'allow',
      toolCatalogHash: toolCatalogHash([]),
      nodes: [],
      edges: [null],
    }).ok).toBe(false);
  });
});
