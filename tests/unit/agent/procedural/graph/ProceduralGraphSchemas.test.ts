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
});
