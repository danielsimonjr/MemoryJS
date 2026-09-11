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

  it('createSkeleton persists Start-LEADS_TO-End and paperCompatible defaults to repair', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const production = new ProceduralGraphManager({ backing, ownsBacking: false });
    const skeleton = await production.createSkeleton({ graphId: 'skel' });
    expect(skeleton.ok).toBe(true);
    const graph = await production.getGraph('skel');
    expect(graph?.snapshot.cyclePolicy).toBe('reject');
    expect(graph?.hasNode('Start')).toBe(true);
    expect(graph?.hasNode('End')).toBe(true);
    expect(graph?.outgoing('Start')[0]?.relation).toBe('LEADS_TO');

    const paperBacking = new InMemoryProceduralGraphBacking();
    const paper = new ProceduralGraphManager({
      backing: paperBacking,
      ownsBacking: false,
      paperCompatible: true,
    });
    const paperSkel = await paper.createSkeleton({ graphId: 'paper-skel' });
    expect(paperSkel.ok).toBe(true);
    expect((await paper.getGraph('paper-skel'))?.snapshot.cyclePolicy).toBe('repair');
  });

  it('openSession pins the revision and prepareCandidate applies detached edits', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    const session = await manager.openSession(GRAPH_ID, {
      taskDescription: 't',
      toolCatalog: ['do'],
    });
    expect(session).toBeDefined();
    expect(session?.revisionId).toBe(created.ok ? created.head.revisionId : '');
    expect(session?.graph.hasNode('Do')).toBe(true);

    const prepared = await manager.prepareCandidate(GRAPH_ID, {
      add_nodes: [],
      delete_nodes: [],
      add_edges: [],
      delete_edges: [],
    });
    expect(prepared.ok).toBe(true);

    const missing = await manager.prepareCandidate('no-such-graph', {
      add_nodes: [],
      delete_nodes: [],
      add_edges: [],
      delete_edges: [],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics.some((d) => d.code === 'not-found')).toBe(true);
    }

    const listed = await manager.listRevisions(GRAPH_ID);
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.revisionId).toBe(created.ok ? created.head.revisionId : '');
  });

  it('evolve fixed_expert is a no-op and canEvolve=false reports policy-denied', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    const deps = {
      rollout: vi.fn(),
      evaluate: vi.fn(),
      refiner: { complete: vi.fn() },
      tokenizer: {
        encode: (text: string) => text.split(/\s+/).map((_, i) => i),
        decode: (tokens: number[]) => tokens.join(' '),
      },
    };
    const result = await manager.evolve(
      {
        graphId: GRAPH_ID,
        mode: 'fixed_expert',
        trainingTasks: [],
        validationTasks: [],
        batchSize: 1,
        maxRounds: 1,
        maxTokens: 16,
        cyclePolicy: 'reject',
        paperCompatible: false,
        toolCatalog: ['do'],
        taskDescription: 't',
        taskFailurePolicy: 'fail-round',
      },
      deps,
    );
    expect(result.stoppedBecause).toBe('fixed-mode');
    expect(deps.rollout).not.toHaveBeenCalled();

    const denied = new ProceduralGraphManager({
      backing,
      ownsBacking: false,
      policy: { canEvolve: () => false },
    });
    const aborted = await denied.evolve(
      {
        graphId: GRAPH_ID,
        mode: 'fixed_expert',
        trainingTasks: [],
        validationTasks: [],
        batchSize: 1,
        maxRounds: 1,
        maxTokens: 16,
        cyclePolicy: 'reject',
        paperCompatible: false,
        toolCatalog: ['do'],
        taskDescription: 't',
        taskFailurePolicy: 'fail-round',
      },
      deps,
    );
    expect(aborted.stoppedBecause).toBe('policy-denied');
  });

  it('rollback to the current revision commits and canRead=false hides graphs', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rolled = await manager.rollback(GRAPH_ID, created.head.revisionId, created.head.headVersion);
    expect(rolled.status).toBe('committed');
    if (rolled.status === 'committed') {
      expect(rolled.head.headVersion).toBe(2);
      expect(rolled.head.revisionId).toBe(created.head.revisionId);
    }

    const hidden = new ProceduralGraphManager({
      backing,
      ownsBacking: false,
      policy: { canRead: () => false, canWrite: () => false },
    });
    expect(await hidden.getGraph(GRAPH_ID)).toBeUndefined();
    expect(await hidden.openSession(GRAPH_ID, { taskDescription: 't', toolCatalog: [] })).toBeUndefined();
    expect(await hidden.exportGraph(GRAPH_ID)).toBeUndefined();
    expect((await hidden.listRejections(GRAPH_ID)).total).toBe(0);
    expect((await hidden.listRevisions(GRAPH_ID)).total).toBe(0);
    const writeDenied = await hidden.rollback(GRAPH_ID, created.head.revisionId, 2);
    expect(writeDenied.status).toBe('not-found');
  });

  it('importGraph rejects non-JSON and openSession misses unknown graphs', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const bad = await manager.importGraph('not-json{');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.diagnostics.some((d) => d.code === 'not-raw-json')).toBe(true);
    }
    expect(await manager.openSession('missing', { taskDescription: 't', toolCatalog: [] })).toBeUndefined();
    expect(await manager.exportGraph('missing')).toBeUndefined();
    expect(await manager.getGraph('missing', 'rev')).toBeUndefined();
  });

    it('createGraph reports graph-exists and persist-failed, import schema and write denials', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const first = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(first.ok).toBe(true);
    const duplicate = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.diagnostics.some((d) => d.code === 'graph-exists')).toBe(true);
    }

    const exploding = new InMemoryProceduralGraphBacking();
    vi.spyOn(exploding, 'createGraph').mockRejectedValueOnce(new Error('disk full'));
    const persist = new ProceduralGraphManager({ backing: exploding, ownsBacking: false });
    const failed = await persist.createGraph({
      graphId: 'explode',
      nodes: nodes(),
      edges: edges(),
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.diagnostics.some((d) => d.code === 'persist-failed')).toBe(true);
    }

    const schema = await manager.importGraph(JSON.stringify({ graphId: 'nope' }));
    expect(schema.ok).toBe(false);

    const denied = new ProceduralGraphManager({
      backing,
      ownsBacking: false,
      policy: { canWrite: () => false, canRead: () => false },
    });
    const imported = await denied.importGraph(JSON.stringify((await backing.loadRevision(GRAPH_ID, first.ok ? first.head.revisionId : ''))));
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.diagnostics.some((d) => d.code === 'policy-denied')).toBe(true);
    }
    const prepared = await denied.prepareCandidate(GRAPH_ID, {
      add_nodes: [],
      delete_nodes: [],
      add_edges: [],
      delete_edges: [],
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.diagnostics.some((d) => d.code === 'policy-denied')).toBe(true);
    }
  });

  it('rollback conflict, dispose is idempotent, and listRevisions paginates', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const conflict = await manager.rollback(GRAPH_ID, created.head.revisionId, 99);
    expect(conflict.status).toBe('conflict');

    const page = await manager.listRevisions(GRAPH_ID, { offset: 0, limit: 1 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);

    const owned = new InMemoryProceduralGraphBacking();
    const close = vi.spyOn(owned, 'close');
    const ownedManager = new ProceduralGraphManager({ backing: owned, ownsBacking: true });
    await ownedManager.dispose();
    await ownedManager.dispose();
    expect(close).toHaveBeenCalledTimes(1);
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
