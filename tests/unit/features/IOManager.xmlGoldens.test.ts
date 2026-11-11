/**
 * Byte-for-byte goldens for `IOManager.exportGraph` in GraphML and GEXF form.
 *
 * These pin the whole document (indentation, key ids, edge ids, escaping), not substrings, so a
 * shared node/edge walk cannot change whitespace, ordering or attribute spelling without failing.
 * The inputs mirror the shapes the existing IOManager tests exercise: full optional fields, a
 * graph with no relations, and an empty graph.
 *
 * @module tests/unit/features/IOManager.xmlGoldens
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IOManager } from '../../../src/features/IOManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { KnowledgeGraph } from '../../../src/types/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tempDir: string;
let storage: GraphStorage;
let manager: IOManager;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'io-xml-golden-'));
  storage = new GraphStorage(path.join(tempDir, 'memory.jsonl'));
  manager = new IOManager(storage);
});

afterEach(() => {
  storage.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Fully-populated graph: every optional node and edge field set, two entities, one relation. */
const FULL_GRAPH: KnowledgeGraph = {
  entities: [
    {
      name: 'Alice',
      entityType: 'person',
      observations: ['Developer', 'Works remotely'],
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      tags: ['team', 'core'],
      importance: 8,
    },
    {
      name: 'Bob',
      entityType: 'person',
      observations: ['Manager'],
      createdAt: '2026-02-01T00:00:00.000Z',
      lastModified: '2026-02-02T00:00:00.000Z',
      tags: [],
      importance: 0,
    },
  ],
  relations: [
    {
      from: 'Alice',
      to: 'Bob',
      relationType: 'reports_to',
      createdAt: '2026-03-01T00:00:00.000Z',
      lastModified: '2026-03-02T00:00:00.000Z',
    },
  ],
};

describe('GraphML export golden', () => {
  it('renders the full document byte-for-byte', () => {
    expect(manager.exportGraph(FULL_GRAPH, 'graphml')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        '  <key id="d0" for="node" attr.name="entityType" attr.type="string"/>',
        '  <key id="d1" for="node" attr.name="observations" attr.type="string"/>',
        '  <key id="d2" for="node" attr.name="createdAt" attr.type="string"/>',
        '  <key id="d3" for="node" attr.name="lastModified" attr.type="string"/>',
        '  <key id="d4" for="node" attr.name="tags" attr.type="string"/>',
        '  <key id="d5" for="node" attr.name="importance" attr.type="double"/>',
        '  <key id="e0" for="edge" attr.name="relationType" attr.type="string"/>',
        '  <key id="e1" for="edge" attr.name="createdAt" attr.type="string"/>',
        '  <key id="e2" for="edge" attr.name="lastModified" attr.type="string"/>',
        '  <graph id="G" edgedefault="directed">',
        '    <node id="Alice">',
        '      <data key="d0">person</data>',
        '      <data key="d1">Developer; Works remotely</data>',
        '      <data key="d2">2026-01-01T00:00:00.000Z</data>',
        '      <data key="d3">2026-01-02T00:00:00.000Z</data>',
        '      <data key="d4">team; core</data>',
        '      <data key="d5">8</data>',
        '    </node>',
        '    <node id="Bob">',
        '      <data key="d0">person</data>',
        '      <data key="d1">Manager</data>',
        '      <data key="d2">2026-02-01T00:00:00.000Z</data>',
        '      <data key="d3">2026-02-02T00:00:00.000Z</data>',
        '      <data key="d5">0</data>',
        '    </node>',
        '    <edge id="e0" source="Alice" target="Bob">',
        '      <data key="e0">reports_to</data>',
        '      <data key="e1">2026-03-01T00:00:00.000Z</data>',
        '      <data key="e2">2026-03-02T00:00:00.000Z</data>',
        '    </edge>',
        '  </graph>',
        '</graphml>',
      ].join('\n'),
    );
  });

  it('omits optional node keys that are absent and numbers edges from e0', () => {
    const graph: KnowledgeGraph = {
      entities: [{ name: 'Solo', entityType: 'thing', observations: [] }],
      relations: [{ from: 'Solo', to: 'Solo', relationType: 'self' }],
    };
    expect(manager.exportGraph(graph, 'graphml')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        '  <key id="d0" for="node" attr.name="entityType" attr.type="string"/>',
        '  <key id="d1" for="node" attr.name="observations" attr.type="string"/>',
        '  <key id="d2" for="node" attr.name="createdAt" attr.type="string"/>',
        '  <key id="d3" for="node" attr.name="lastModified" attr.type="string"/>',
        '  <key id="d4" for="node" attr.name="tags" attr.type="string"/>',
        '  <key id="d5" for="node" attr.name="importance" attr.type="double"/>',
        '  <key id="e0" for="edge" attr.name="relationType" attr.type="string"/>',
        '  <key id="e1" for="edge" attr.name="createdAt" attr.type="string"/>',
        '  <key id="e2" for="edge" attr.name="lastModified" attr.type="string"/>',
        '  <graph id="G" edgedefault="directed">',
        '    <node id="Solo">',
        '      <data key="d0">thing</data>',
        '      <data key="d1"></data>',
        '    </node>',
        '    <edge id="e0" source="Solo" target="Solo">',
        '      <data key="e0">self</data>',
        '    </edge>',
        '  </graph>',
        '</graphml>',
      ].join('\n'),
    );
  });

  it('renders an empty graph', () => {
    expect(manager.exportGraph({ entities: [], relations: [] }, 'graphml')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        '  <key id="d0" for="node" attr.name="entityType" attr.type="string"/>',
        '  <key id="d1" for="node" attr.name="observations" attr.type="string"/>',
        '  <key id="d2" for="node" attr.name="createdAt" attr.type="string"/>',
        '  <key id="d3" for="node" attr.name="lastModified" attr.type="string"/>',
        '  <key id="d4" for="node" attr.name="tags" attr.type="string"/>',
        '  <key id="d5" for="node" attr.name="importance" attr.type="double"/>',
        '  <key id="e0" for="edge" attr.name="relationType" attr.type="string"/>',
        '  <key id="e1" for="edge" attr.name="createdAt" attr.type="string"/>',
        '  <key id="e2" for="edge" attr.name="lastModified" attr.type="string"/>',
        '  <graph id="G" edgedefault="directed">',
        '  </graph>',
        '</graphml>',
      ].join('\n'),
    );
  });
});

describe('GEXF export golden', () => {
  it('renders the full document byte-for-byte', () => {
    expect(manager.exportGraph(FULL_GRAPH, 'gexf')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">',
        '  <meta>',
        '    <creator>Memory MCP Server</creator>',
        '  </meta>',
        '  <graph mode="static" defaultedgetype="directed">',
        '    <attributes class="node">',
        '      <attribute id="0" title="entityType" type="string"/>',
        '      <attribute id="1" title="observations" type="string"/>',
        '    </attributes>',
        '    <nodes>',
        '      <node id="Alice" label="Alice">',
        '        <attvalues>',
        '          <attvalue for="0" value="person"/>',
        '          <attvalue for="1" value="Developer; Works remotely"/>',
        '        </attvalues>',
        '      </node>',
        '      <node id="Bob" label="Bob">',
        '        <attvalues>',
        '          <attvalue for="0" value="person"/>',
        '          <attvalue for="1" value="Manager"/>',
        '        </attvalues>',
        '      </node>',
        '    </nodes>',
        '    <edges>',
        '      <edge id="0" source="Alice" target="Bob" label="reports_to"/>',
        '    </edges>',
        '  </graph>',
        '</gexf>',
      ].join('\n'),
    );
  });

  it('renders an empty graph', () => {
    expect(manager.exportGraph({ entities: [], relations: [] }, 'gexf')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">',
        '  <meta>',
        '    <creator>Memory MCP Server</creator>',
        '  </meta>',
        '  <graph mode="static" defaultedgetype="directed">',
        '    <attributes class="node">',
        '      <attribute id="0" title="entityType" type="string"/>',
        '      <attribute id="1" title="observations" type="string"/>',
        '    </attributes>',
        '    <nodes>',
        '    </nodes>',
        '    <edges>',
        '    </edges>',
        '  </graph>',
        '</gexf>',
      ].join('\n'),
    );
  });

  it('escapes XML in ids, labels and values', () => {
    const graph: KnowledgeGraph = {
      entities: [{ name: 'A&B', entityType: 't<1>', observations: ['x"y'] }],
      relations: [{ from: 'A&B', to: 'A&B', relationType: 'r<&>' }],
    };
    const out = manager.exportGraph(graph, 'gexf');
    expect(out).toContain('<node id="A&amp;B" label="A&amp;B">');
    expect(out).toContain('<attvalue for="0" value="t&lt;1&gt;"/>');
    expect(out).toContain('<attvalue for="1" value="x&quot;y"/>');
    expect(out).toContain('label="r&lt;&amp;&gt;"');
  });
});
