/**
 * ProceduralGraphManager facade tests (Wave 3 / Agent D).
 */

import { describe, it, expect, vi } from 'vitest';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import type {
  PGEdge,
  PGNode,
  PGRejectionRecord,
  PGSnapshot,
} from '../../../../../src/types/proceduralGraph.js';
import { InMemoryProceduralGraphBacking } from '../../../../../src/agent/procedural/graph/backing/InMemoryProceduralGraphBacking.js';
import { ProceduralGraphManager } from '../../../../../src/agent/procedural/graph/ProceduralGraphManager.js';
import { graphDigest, toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';

const GRAPH_ID = 'pg-manager-test';

function nodes(): PGNode[] {
  return [
    { id: 'Start', type: 'STATE', description: 'Start' },
    { id: 'Do', type: 'ACTION', description: 'do work', actionName: 'do' },
    { id: 'End', type: 'STATE', description: 'End' },
  ];
}

function edges(): PGEdge[] {
  return [
    { source: 'Start', relation: 'LEADS_TO', target: 'Do', condition: null, guidance: '', pitfalls: '' },
    { source: 'Do', relation: 'LEADS_TO', target: 'End', condition: null, guidance: '', pitfalls: '' },
  ];
}

describe('ProceduralGraphManager', () => {
  it('createGraph validates and persists', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const result = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.head.graphId).toBe(GRAPH_ID);
    expect(result.head.headVersion).toBe(1);
    expect(result.head.validationMean).toBeNull();
    const graph = await manager.getGraph(GRAPH_ID);
    expect(graph).toBeDefined();
    expect(graph?.hasNode('Do')).toBe(true);
    expect(graph?.snapshot.cyclePolicy).toBe('reject');
    expect(await backing.loadHead(GRAPH_ID)).toBeDefined();
  });

  it('importGraph rejects a snapshot with a missing endpoint and persists nothing', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const snapshot: PGSnapshot = {
      schemaVersion: 1,
      graphId: 'broken',
      revisionId: 'r1',
      entryNodeId: 'Start',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
      cyclePolicy: 'reject',
      toolCatalogHash: toolCatalogHash([]),
      nodes: [
        { id: 'Start', type: 'STATE', description: 'Start' },
        { id: 'End', type: 'STATE', description: 'End' },
      ],
      edges: [
        {
          source: 'Start',
          relation: 'LEADS_TO',
          target: 'Missing',
          condition: null,
          guidance: '',
          pitfalls: '',
        },
      ],
    };
    const result = await manager.importGraph(JSON.stringify(snapshot));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'missing-endpoint')).toBe(true);
    expect(await backing.loadHead('broken')).toBeUndefined();
    expect(await manager.getGraph('broken')).toBeUndefined();
  });

  it('exportGraph → importGraph round-trips digest', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    const exported = await manager.exportGraph(GRAPH_ID);
    expect(exported).toBeTypeOf('string');
    const imported = await manager.importGraph(exported!, { graphId: 'copy' });
    expect(imported.ok).toBe(true);
    const original = await manager.getGraph(GRAPH_ID);
    const copy = await manager.getGraph('copy');
    expect(original).toBeDefined();
    expect(copy).toBeDefined();
    expect(copy?.digest).toBe(original?.digest);
    expect(copy?.digest).toBe(graphDigest(copy!.snapshot));
  });

  it('rollback returns not-found for unknown revision', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await manager.rollback(GRAPH_ID, 'does-not-exist', created.head.headVersion);
    expect(result.status).toBe('not-found');
    const head = await backing.loadHead(GRAPH_ID);
    expect(head?.revisionId).toBe(created.head.revisionId);
    expect(head?.headVersion).toBe(1);
  });

  it('policy canWrite=false blocks createGraph', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({
      backing,
      ownsBacking: false,
      policy: { canWrite: () => false },
    });
    const result = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'policy-denied')).toBe(true);
    expect(await backing.loadHead(GRAPH_ID)).toBeUndefined();
  });

  it('audit hook receives one event per mutation', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const events: Array<{ op: string; graphId: string }> = [];
    const manager = new ProceduralGraphManager({
      backing,
      ownsBacking: false,
      policy: {
        audit: (event) => {
          events.push({ op: event.op, graphId: event.graphId });
        },
      },
    });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    const exported = await manager.exportGraph(GRAPH_ID);
    const imported = await manager.importGraph(exported!, { graphId: 'audited-copy' });
    expect(imported.ok).toBe(true);
    expect(events).toEqual([
      { op: 'createGraph', graphId: GRAPH_ID },
      { op: 'importGraph', graphId: 'audited-copy' },
    ]);
  });

  it('listRejections strips trajectoryRefs', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const record: PGRejectionRecord = {
      runId: 'run-1',
      round: 1,
      proposalDigest: 'abc',
      edits: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] },
      reason: 'structural',
      diagnostics: [],
      retainedMean: null,
      retainedRevisionId: created.head.revisionId,
      trajectoryRefs: ['secret-trace-id'],
      fingerprint: 'fp',
      recordedAt: new Date().toISOString(),
    };
    await backing.appendRejection(record);
    const listed = await manager.listRejections(GRAPH_ID);
    expect(listed.total).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.trajectoryRefs).toBeUndefined();
    expect('trajectoryRefs' in listed.items[0]!).toBe(false);
  });

  it('dispose closes an owned backing and not an injected one', async () => {
    const owned = new InMemoryProceduralGraphBacking();
    const ownedClose = vi.spyOn(owned, 'close');
    const ownedManager = new ProceduralGraphManager({ backing: owned, ownsBacking: true });
    await ownedManager.dispose();
    expect(ownedClose).toHaveBeenCalledTimes(1);

    const injected = new InMemoryProceduralGraphBacking();
    const injectedClose = vi.spyOn(injected, 'close');
    const injectedManager = new ProceduralGraphManager({ backing: injected, ownsBacking: false });
    await injectedManager.dispose();
    expect(injectedClose).not.toHaveBeenCalled();
  });
});
