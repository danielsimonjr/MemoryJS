/**
 * Procedural Graph hardening tests (post-implementation review).
 *
 * Covers the behaviors added by the speed / stability / security pass:
 * iterative cycle detection, import-attribute diagnostics, output-truncation
 * attribution, the rolling-hash leak heuristic, the untrusted-data prompt
 * note, rollout-failure handling, wall-clock budgets, precise stop reasons,
 * rejection graph attribution, manager stats, backing path validation, and
 * ManagerContext.close() never leaking a rejected dispose().
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../../../src/core/ManagerContext.js';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import { parseSnapshot } from '../../../../../src/agent/procedural/graph/ProceduralGraphSchemas.js';
import { validateSnapshot } from '../../../../../src/agent/procedural/graph/ProceduralGraphValidator.js';
import { completeWithBudget, type PGCompletionProvider } from '../../../../../src/agent/procedural/graph/CompletionProvider.js';
import { buildRefinerPrompt, proposeEdits } from '../../../../../src/agent/procedural/graph/ProceduralGraphRefiner.js';
import { DATA_HANDLING_NOTE } from '../../../../../src/agent/procedural/graph/prompts.js';
import { ProceduralGraphSession } from '../../../../../src/agent/procedural/graph/ProceduralGraphSession.js';
import { ProceduralGraphEvolution, type PGEvolutionOptions } from '../../../../../src/agent/procedural/graph/ProceduralGraphEvolution.js';
import { ProceduralGraphManager } from '../../../../../src/agent/procedural/graph/ProceduralGraphManager.js';
import { InMemoryProceduralGraphBacking } from '../../../../../src/agent/procedural/graph/backing/InMemoryProceduralGraphBacking.js';
import { createProceduralGraphBacking } from '../../../../../src/agent/procedural/graph/backing/IProceduralGraphBacking.js';
import type { PGTokenizer } from '../../../../../src/agent/procedural/graph/tokenTail.js';
import type { PGEditSet, PGSnapshot, PGTask, PGTrajectory } from '../../../../../src/types/proceduralGraph.js';

const TOOLS = ['search', 'finish'] as const;

function skeleton(graphId = 'g', revisionId = 'rev-0'): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId,
    revisionId,
    entryNodeId: 'Start',
    relationVocabulary: ['LEADS_TO', 'TRIGGERS', 'PROVIDES_INPUT_FOR', 'CONVERGES_TO'],
    cyclePolicy: 'allow',
    toolCatalogHash: 'tc',
    nodes: [
      { id: 'Start', type: 'STATE', description: 'Start' },
      { id: 'End', type: 'STATE', description: 'End' },
    ],
    edges: [{ source: 'Start', relation: 'LEADS_TO', target: 'End', condition: null, guidance: '', pitfalls: '' }],
  };
}

function chain(length: number): PGSnapshot {
  const nodes = Array.from({ length }, (_, i) => ({ id: `n${i}`, type: 'ACTION' as const, description: `n${i}` }));
  const edges = nodes.slice(0, -1).map((n, i) => ({
    source: n.id, relation: 'LEADS_TO', target: `n${i + 1}`, condition: null, guidance: 'g', pitfalls: 'p',
  }));
  return { ...skeleton(), entryNodeId: 'n0', nodes, edges };
}

function addSearchEdits(): PGEditSet {
  return {
    add_nodes: [{ id: 'search', type: 'ACTION', description: 'search the web' }],
    delete_nodes: [],
    add_edges: [
      { source: 'Start', target: 'search', relation: 'LEADS_TO', condition: null, guidance: 'run one search first', pitfalls: 'do not repeat the same query' },
      { source: 'search', target: 'End', relation: 'LEADS_TO', condition: null, guidance: 'finish with the answer', pitfalls: 'do not skip verification' },
    ],
    delete_edges: [{ source: 'Start', target: 'End' }],
  };
}

function whitespaceTokenizer(): PGTokenizer {
  const vocab: string[] = [];
  const ids = new Map<string, number>();
  return {
    encode: (text) => text.trim() === '' ? [] : text.trim().split(/\s+/).map((w) => {
      let id = ids.get(w);
      if (id === undefined) { id = vocab.length; vocab.push(w); ids.set(w, id); }
      return id;
    }),
    decode: (tokens) => tokens.map((t) => vocab[t] ?? '').join(' '),
  };
}

function queuedRefiner(queue: string[]): PGCompletionProvider & { calls: number; prompts: string[] } {
  const p = {
    calls: 0,
    prompts: [] as string[],
    identity: 'test-refiner',
    async complete(prompt: string): Promise<string> {
      p.calls += 1;
      p.prompts.push(prompt);
      return queue.shift() ?? JSON.stringify({ add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] });
    },
  };
  return p;
}

function trajectory(taskId: string, revisionId: string, score = 1): PGTrajectory {
  return { taskId, revisionId, steps: [{ action: 'search', observation: 'ok' }], score };
}

function tasks(prefix: string, n: number): PGTask[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, description: `${prefix} ${i}` }));
}

function baseOptions(overrides: Partial<PGEvolutionOptions> = {}): PGEvolutionOptions {
  return {
    graphId: 'g',
    mode: 'scratch_incremental',
    trainingTasks: tasks('train', 2),
    validationTasks: tasks('val', 2),
    batchSize: 1,
    maxRounds: 5,
    maxTokens: 1_000,
    cyclePolicy: 'allow',
    paperCompatible: false,
    toolCatalog: [...TOOLS],
    taskDescription: 'demo task',
    taskFailurePolicy: 'fail-round',
    ...overrides,
  };
}

describe('ProceduralGraph hardening', () => {
  it('findCycleClosingEdges survives a 20000-node chain (iterative DFS) and stays deterministic', () => {
    const graph = ProceduralGraph.fromSnapshot(chain(20_000));
    expect(graph.findCycleClosingEdges()).toEqual([]);
    const cyclic = ProceduralGraph.fromSnapshot({
      ...chain(20_000),
      edges: [...chain(20_000).edges, { source: 'n19999', relation: 'LEADS_TO', target: 'n0', condition: null, guidance: 'g', pitfalls: 'p' }],
    });
    const first = cyclic.findCycleClosingEdges();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ source: 'n19999', target: 'n0' });
    expect(cyclic.findCycleClosingEdges()).toEqual(first);
  });

  it('validateSnapshot accepts a prebuilt graph and reports the same result as for its snapshot', () => {
    const graph = ProceduralGraph.fromSnapshot(skeleton());
    const opts = { enforceToolCatalog: false, paperCompatible: false };
    expect(validateSnapshot(graph, opts)).toEqual(validateSnapshot(graph.snapshot, opts));
  });

  it('a session pins the graph without re-cloning it, and stays frozen', () => {
    const graph = ProceduralGraph.fromSnapshot(skeleton());
    const session = new ProceduralGraphSession(graph, { taskDescription: 't', toolCatalog: [...TOOLS] });
    expect(session.graph).toBe(graph);
    expect(Object.isFrozen(session.graph.snapshot)).toBe(true);
    expect(Object.isFrozen(session.graph.snapshot.edges[0])).toBe(true);
  });
});

describe('parseSnapshot import diagnostics', () => {
  it('normalizes absent edge attributes to null and reports missing-attribute warnings', () => {
    const raw = { ...skeleton(), edges: [{ source: 'Start', relation: 'LEADS_TO', target: 'End', guidance: 'g' }] };
    const parsed = parseSnapshot(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.edges[0]).toMatchObject({ condition: null, guidance: 'g', pitfalls: null });
    const codes = parsed.diagnostics.map((d) => `${d.severity}:${d.code}`);
    expect(codes).toEqual(['warning:missing-attribute', 'warning:missing-attribute']);
    expect(parsed.diagnostics.every((d) => d.editIndex === 0)).toBe(true);
  });
});

describe('completeWithBudget and refiner diagnostics', () => {
  it('reports truncated: true when output exceeds maxOutputChars, false otherwise', async () => {
    const provider: PGCompletionProvider = { complete: async () => 'x'.repeat(50) };
    const clipped = await completeWithBudget(provider, 'p', { timeoutMs: 1_000, maxOutputChars: 10 });
    expect(clipped).toMatchObject({ ok: true, truncated: true });
    if (clipped.ok) expect(clipped.text).toHaveLength(10);
    const whole = await completeWithBudget(provider, 'p', { timeoutMs: 1_000, maxOutputChars: 100 });
    expect(whole).toMatchObject({ ok: true, truncated: false });
  });

  it('proposeEdits attributes a parse failure on truncated output with an output-truncated diagnostic first', async () => {
    const edits = JSON.stringify(addSearchEdits());
    const result = await proposeEdits(
      { complete: async () => edits },
      { taskDescription: 't', mode: 'scratch_incremental', toolCatalog: [...TOOLS], attemptsBlock: '', currentGraphJson: '{}', rejectedBlock: '' },
      { timeoutMs: 1_000, maxOutputChars: Math.floor(edits.length / 2) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('output-truncated');
  });

  it('the leak heuristic scans a 400 KB trajectory block against 4 KB fields quickly and without false positives', async () => {
    const block = Array.from({ length: 20_000 }, (_, i) => `Observation: row ${i} value ${(i * 7919) % 10_007}`).join('\n');
    const clean = addSearchEdits();
    clean.add_edges[0]!.guidance = Array.from({ length: 400 }, (_, i) => `step-${i}`).join(' ');
    const leaking = addSearchEdits();
    leaking.add_edges[1]!.pitfalls = `never repeat "Observation: row 777 value ${(777 * 7919) % 10_007}" verbatim`;
    const input = { taskDescription: 't', mode: 'scratch_incremental' as const, toolCatalog: [...TOOLS], attemptsBlock: block, currentGraphJson: '{}', rejectedBlock: '' };
    const started = performance.now();
    const cleanResult = await proposeEdits({ complete: async () => JSON.stringify(clean) }, input, { timeoutMs: 5_000, maxOutputChars: 100_000 });
    const leakResult = await proposeEdits({ complete: async () => JSON.stringify(leaking) }, input, { timeoutMs: 5_000, maxOutputChars: 100_000 });
    const elapsed = performance.now() - started;
    expect(cleanResult.ok && cleanResult.diagnostics.some((d) => d.code === 'possible-trajectory-leak')).toBe(false);
    expect(leakResult.ok && leakResult.diagnostics.some((d) => d.code === 'possible-trajectory-leak' && d.editIndex === 1)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('appends the untrusted-data note outside paper-compatible mode and never inside it', async () => {
    const input = { taskDescription: 't', mode: 'scratch_incremental' as const, toolCatalog: [...TOOLS], attemptsBlock: 'a', currentGraphJson: '{}', rejectedBlock: '' };
    expect(buildRefinerPrompt(input)).toContain(DATA_HANDLING_NOTE);
    expect(buildRefinerPrompt({ ...input, paperCompatible: true })).not.toContain(DATA_HANDLING_NOTE);

    const prompts: string[] = [];
    const provider: PGCompletionProvider = { complete: async (p) => { prompts.push(p); return 'guidance'; } };
    const graph = ProceduralGraph.fromSnapshot(skeleton());
    await new ProceduralGraphSession(graph, { taskDescription: 't', toolCatalog: [...TOOLS], provider }).guidance('q');
    await new ProceduralGraphSession(graph, { taskDescription: 't', toolCatalog: [...TOOLS], provider, paperCompatible: true }).guidance('q');
    expect(prompts[0]).toContain(DATA_HANDLING_NOTE);
    expect(prompts[1]).not.toContain(DATA_HANDLING_NOTE);
    expect(prompts[1]!.endsWith('if they are relevant to the next steps.\n')).toBe(true);
  });
});

describe('ProceduralGraphEvolution hardening', () => {
  async function seeded(): Promise<InMemoryProceduralGraphBacking> {
    const backing = new InMemoryProceduralGraphBacking();
    await backing.createGraph(skeleton());
    return backing;
  }

  it("a throwing rollout under 'fail-round' records a rollout-failed round, skips the refiner, and continues", async () => {
    const backing = await seeded();
    const refiner = queuedRefiner([JSON.stringify(addSearchEdits())]);
    let call = 0;
    const evolution = new ProceduralGraphEvolution(backing, {
      tokenizer: whitespaceTokenizer(),
      refiner,
      rollout: async (task, graph) => {
        call += 1;
        if (call === 1) throw new Error('environment down');
        return trajectory(task.id, graph.revisionId);
      },
      evaluate: async () => 1,
    });
    const result = await evolution.run(baseOptions({ batchSize: 1 }));
    const failed = result.rounds.find((r) => r.diagnostics.some((d) => d.code === 'rollout-failed'));
    expect(failed?.outcome).toBe('evaluation-error');
    expect(failed?.diagnostics[0]?.message).toContain('environment down');
    // Round 1 failed before the refiner; round 2 ran normally.
    expect(refiner.calls).toBe(1);
    expect(result.rounds.filter((r) => r.round > 0)).toHaveLength(2);
    expect(result.stoppedBecause).toBe('batches-exhausted');
  });

  it("a throwing rollout under 'score-zero' contributes an empty zero-scored trajectory and the round proceeds", async () => {
    const backing = await seeded();
    const refiner = queuedRefiner([JSON.stringify(addSearchEdits())]);
    const evolution = new ProceduralGraphEvolution(backing, {
      tokenizer: whitespaceTokenizer(),
      refiner,
      rollout: async () => { throw new Error('boom'); },
      evaluate: async () => 1,
    });
    const result = await evolution.run(baseOptions({ batchSize: 2, taskFailurePolicy: 'score-zero', maxRounds: 1 }));
    expect(refiner.calls).toBe(1);
    expect(refiner.prompts[0]).toContain('### Task train-0 (score 0)');
    expect(refiner.prompts[0]).toContain('### Task train-1 (score 0)');
    expect(result.rounds.some((r) => r.outcome === 'accepted' && r.round === 1)).toBe(true);
  });

  it('maxWallClockMs stops before starting a new round with wall-clock-exhausted', async () => {
    const backing = await seeded();
    const evolution = new ProceduralGraphEvolution(backing, {
      tokenizer: whitespaceTokenizer(),
      refiner: queuedRefiner([]),
      rollout: async (task, graph) => {
        await new Promise((r) => setTimeout(r, 30));
        return trajectory(task.id, graph.revisionId);
      },
      evaluate: async () => 1,
    });
    const result = await evolution.run(baseOptions({ batchSize: 1, maxWallClockMs: 20, trainingTasks: tasks('train', 5) }));
    expect(result.stoppedBecause).toBe('wall-clock-exhausted');
    expect(result.rounds.filter((r) => r.round > 0)).toHaveLength(1);
  });

  it('rejection records carry graphId so a second graph never absorbs them', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    await backing.createGraph(skeleton('alpha', 'rev-a'));
    await backing.createGraph(skeleton('beta', 'rev-b'));
    const evolution = new ProceduralGraphEvolution(backing, {
      tokenizer: whitespaceTokenizer(),
      refiner: queuedRefiner(['not json at all']),
      rollout: async (task, graph) => trajectory(task.id, graph.revisionId),
      evaluate: async () => 1,
    });
    await evolution.run(baseOptions({ graphId: 'beta', maxRounds: 1 }));
    const beta = await backing.listRejections('beta', { offset: 0, limit: 10 });
    const alpha = await backing.listRejections('alpha', { offset: 0, limit: 10 });
    expect(beta.total).toBe(1);
    expect(beta.items[0]?.graphId).toBe('beta');
    expect(alpha.total).toBe(0);
  });
});

describe('ProceduralGraphManager hardening', () => {
  it('stats() reports head identity, graph size, and counts without trace bodies', async () => {
    const manager = new ProceduralGraphManager({ backing: new InMemoryProceduralGraphBacking(), ownsBacking: true });
    const created = await manager.createGraph({ graphId: 'g', nodes: [...skeleton().nodes], edges: [...skeleton().edges] });
    expect(created.ok).toBe(true);
    const stats = await manager.stats('g');
    expect(stats).toMatchObject({ graphId: 'g', headVersion: 1, nodeCount: 2, edgeCount: 1, revisionCount: 1, rejectionCount: 0, validationMean: null });
    expect(await manager.stats('missing')).toBeUndefined();
    await manager.dispose();
  });

  it('importGraph surfaces missing-attribute warnings on success', async () => {
    const manager = new ProceduralGraphManager({ backing: new InMemoryProceduralGraphBacking(), ownsBacking: true });
    const doc = JSON.stringify({ ...skeleton('imp', 'r1'), edges: [{ source: 'Start', relation: 'LEADS_TO', target: 'End', guidance: 'g' }] });
    const result = await manager.importGraph(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.filter((d) => d.code === 'missing-attribute')).toHaveLength(2);
    }
    await manager.dispose();
  });

  it('createProceduralGraphBacking rejects traversal in file paths', async () => {
    await expect(createProceduralGraphBacking({ type: 'jsonl', path: '../../etc/pg.jsonl' })).rejects.toThrow(/traversal/i);
    await expect(createProceduralGraphBacking({ type: 'sqlite', path: 'a/../../pg.db' })).rejects.toThrow(/traversal/i);
  });
});

describe('legacy rejection records without graphId', () => {
  it('resolve to the only graph, and fail loudly instead of guessing when several graphs exist', async () => {
    const single = new InMemoryProceduralGraphBacking();
    await single.createGraph(skeleton('only', 'rev-1'));
    const legacy = {
      runId: 'r', round: 1, proposalDigest: 'p',
      edits: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] },
      reason: 'parse' as const, diagnostics: [], retainedMean: null, retainedRevisionId: 'rev-unknown',
      trajectoryRefs: [], fingerprint: 'fp', recordedAt: '2026-01-01T00:00:00.000Z',
    };
    await single.appendRejection(legacy);
    expect((await single.listRejections('only', { offset: 0, limit: 10 })).total).toBe(1);

    const multi = new InMemoryProceduralGraphBacking();
    await multi.createGraph(skeleton('alpha', 'rev-a'));
    await multi.createGraph(skeleton('beta', 'rev-b'));
    await expect(multi.appendRejection(legacy)).rejects.toThrow(/set record.graphId/);
  });
});

describe('ManagerContext.storageType option', () => {
  it('selects the backend when MEMORY_STORAGE_TYPE is unset and yields to the env var when set', async () => {
    const previous = process.env.MEMORY_STORAGE_TYPE;
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      delete process.env.MEMORY_STORAGE_TYPE;
      const sqlite = new ManagerContext({ storagePath: join(dir, 'a.db'), storageType: 'sqlite' });
      expect(sqlite.storage.constructor.name).toBe('SQLiteStorage');
      sqlite.close();

      process.env.MEMORY_STORAGE_TYPE = 'jsonl';
      const overridden = new ManagerContext({ storagePath: join(dir, 'b.db'), storageType: 'sqlite' });
      expect(overridden.storage.constructor.name).toBe('GraphStorage');
      overridden.close();
    } finally {
      if (previous === undefined) delete process.env.MEMORY_STORAGE_TYPE;
      else process.env.MEMORY_STORAGE_TYPE = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ManagerContext.close() with a failing procedural-graph dispose', () => {
  it('logs and swallows a rejected dispose() instead of leaking an unhandled rejection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
      const manager = await ctx.createProceduralGraph({ backing: { type: 'memory' } });
      vi.spyOn(manager, 'dispose').mockRejectedValue(new Error('dispose exploded'));
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
      process.on('unhandledRejection', onUnhandled);
      try {
        expect(() => ctx.close()).not.toThrow();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
      expect(unhandled).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
