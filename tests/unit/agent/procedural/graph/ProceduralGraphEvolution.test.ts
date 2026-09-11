/**
 * ProceduralGraphEvolution unit tests (Wave 2 / Agent D).
 *
 * Scripted fakes: rollout returns fixed trajectories; evaluate returns
 * per-revision scores from a map keyed by graphDigest; refiner returns
 * queued JSON strings. The in-memory backing lives in this file and does
 * not depend on Agent B's class existing.
 */

import { describe, it, expect } from 'vitest';
import type {
  PGEditSet,
  PGEvaluationReport,
  PGHead,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
  PGTask,
  PGTrajectory,
} from '../../../../../src/types/proceduralGraph.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../src/types/proceduralGraph.js';
import {
  ProceduralGraphEvolution,
  type PGEvolutionDependencies,
  type PGEvolutionOptions,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphEvolution.js';
import type { PGCompletionProvider } from '../../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { PGTokenizer } from '../../../../../src/agent/procedural/graph/tokenTail.js';
import { concatTrajectories, tokenTail } from '../../../../../src/agent/procedural/graph/tokenTail.js';
import { graphDigest, toolCatalogHash } from '../../../../../src/agent/procedural/graph/canonical.js';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import { prepareCandidate } from '../../../../../src/agent/procedural/graph/ProceduralGraphValidator.js';
import { serializeGraphJson } from '../../../../../src/agent/procedural/graph/ProceduralGraphSerializer.js';

const GRAPH_ID = 'pg-evolve-test';
const TOOLS = ['lookup', 'search', 'scan'] as const;

interface BackingStore {
  heads: Map<string, PGHead>;
  revisions: Map<string, { snapshot: PGSnapshot; createdAt: string }>;
  evaluations: Map<string, PGEvaluationReport>;
  rounds: PGRoundRecord[];
  rejections: PGRejectionRecord[];
}

function revKey(graphId: string, revisionId: string): string {
  return `${graphId}\0${revisionId}`;
}

function evalKey(graphId: string, revisionId: string, fingerprint: string): string {
  return `${graphId}\0${revisionId}\0${fingerprint}`;
}

/**
 * In-file Section 4.7 fake. Shared store lets a second handle bump the
 * head between rounds (stale-head conflict).
 */
class InMemoryProceduralGraphBackingFake {
  readonly kind = 'memory' as const;

  constructor(readonly store: BackingStore = emptyStore()) {}

  fork(): InMemoryProceduralGraphBackingFake {
    return new InMemoryProceduralGraphBackingFake(this.store);
  }

  bumpHead(graphId: string): void {
    const head = this.store.heads.get(graphId);
    if (head) {
      this.store.heads.set(graphId, { ...head, headVersion: head.headVersion + 1 });
    }
  }

  async createGraph(revision: PGSnapshot): Promise<PGHead> {
    if (this.store.heads.has(revision.graphId)) {
      throw new Error('graph-exists');
    }
    const now = new Date().toISOString();
    const snapshot = structuredClone(revision);
    this.store.revisions.set(revKey(revision.graphId, revision.revisionId), { snapshot, createdAt: now });
    const head: PGHead = {
      graphId: revision.graphId,
      revisionId: revision.revisionId,
      headVersion: 1,
      graphDigest: graphDigest(snapshot),
      validationMean: null,
      evaluationFingerprint: null,
      validationReportRef: null,
      updatedAt: now,
    };
    this.store.heads.set(revision.graphId, head);
    return { ...head };
  }

  async loadHead(graphId: string): Promise<PGHead | undefined> {
    const head = this.store.heads.get(graphId);
    return head ? { ...head } : undefined;
  }

  async loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined> {
    const row = this.store.revisions.get(revKey(graphId, revisionId));
    return row ? structuredClone(row.snapshot) : undefined;
  }

  async listRevisions(
    graphId: string,
    page: { offset: number; limit: number },
  ): Promise<{ items: Array<{ revisionId: string; parentRevisionId?: string; graphDigest: string; createdAt: string }>; total: number }> {
    const items = [...this.store.revisions.entries()]
      .filter(([key]) => key.startsWith(`${graphId}\0`))
      .map(([, row]) => ({
        revisionId: row.snapshot.revisionId,
        parentRevisionId: row.snapshot.parentRevisionId,
        graphDigest: graphDigest(row.snapshot),
        createdAt: row.createdAt,
      }));
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length };
  }

  async commitRetainedRevision(input: {
    expectedHeadVersion: number;
    revision: PGSnapshot;
    validation: PGEvaluationReport;
    round: PGRoundRecord;
  }): Promise<{ status: 'committed'; head: PGHead } | { status: 'conflict'; currentHead: PGHead | undefined }> {
    const current = this.store.heads.get(input.revision.graphId);
    if (!current || current.headVersion !== input.expectedHeadVersion) {
      return { status: 'conflict', currentHead: current ? { ...current } : undefined };
    }
    const now = new Date().toISOString();
    const snapshot = structuredClone(input.revision);
    this.store.revisions.set(revKey(snapshot.graphId, snapshot.revisionId), { snapshot, createdAt: now });
    this.store.evaluations.set(
      evalKey(snapshot.graphId, snapshot.revisionId, input.validation.fingerprint),
      structuredClone(input.validation),
    );
    this.store.rounds.push(structuredClone(input.round));
    const head: PGHead = {
      graphId: snapshot.graphId,
      revisionId: snapshot.revisionId,
      headVersion: input.expectedHeadVersion + 1,
      graphDigest: graphDigest(snapshot),
      validationMean: input.validation.meanScore,
      evaluationFingerprint: input.validation.fingerprint,
      validationReportRef: snapshot.revisionId,
      updatedAt: now,
    };
    this.store.heads.set(snapshot.graphId, head);
    return { status: 'committed', head: { ...head } };
  }

  async setHead(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
    round: PGRoundRecord,
  ): Promise<{ status: 'committed'; head: PGHead } | { status: 'conflict'; currentHead: PGHead | undefined }> {
    const current = this.store.heads.get(graphId);
    const row = this.store.revisions.get(revKey(graphId, revisionId));
    if (!current || !row || current.headVersion !== expectedHeadVersion) {
      return { status: 'conflict', currentHead: current ? { ...current } : undefined };
    }
    this.store.rounds.push(structuredClone(round));
    const head: PGHead = {
      ...current,
      revisionId,
      headVersion: expectedHeadVersion + 1,
      graphDigest: graphDigest(row.snapshot),
      updatedAt: new Date().toISOString(),
    };
    this.store.heads.set(graphId, head);
    return { status: 'committed', head: { ...head } };
  }

  async saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): Promise<void> {
    this.store.evaluations.set(evalKey(graphId, revisionId, report.fingerprint), structuredClone(report));
  }

  async loadEvaluation(graphId: string, revisionId: string, fingerprint: string): Promise<PGEvaluationReport | undefined> {
    const report = this.store.evaluations.get(evalKey(graphId, revisionId, fingerprint));
    return report ? structuredClone(report) : undefined;
  }

  async appendRejection(record: PGRejectionRecord): Promise<void> {
    this.store.rejections.push(structuredClone(record));
  }

  async listRejections(
    graphId: string,
    page: { offset: number; limit: number },
  ): Promise<{ items: PGRejectionRecord[]; total: number }> {
    const items = [...this.store.rejections].reverse();
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length };
  }

  async appendRound(_graphId: string, round: PGRoundRecord): Promise<void> {
    this.store.rounds.push(structuredClone(round));
  }

  async close(): Promise<void> {
    // no-op
  }
}

function emptyStore(): BackingStore {
  return {
    heads: new Map(),
    revisions: new Map(),
    evaluations: new Map(),
    rounds: [],
    rejections: [],
  };
}

function skeletonSnapshot(graphId: string, revisionId: string, cyclePolicy: PGSnapshot['cyclePolicy'] = 'allow'): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId,
    revisionId,
    entryNodeId: 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy,
    toolCatalogHash: toolCatalogHash([...TOOLS]),
    nodes: [
      { id: 'Start', type: 'STATE', description: 'Start' },
      { id: 'End', type: 'STATE', description: 'End' },
    ],
    edges: [
      { source: 'Start', relation: 'LEADS_TO', target: 'End', condition: null, guidance: '', pitfalls: '' },
    ],
  };
}

function addActionEdits(id: string, note: string): PGEditSet {
  return {
    add_nodes: [{ id, type: 'ACTION', description: `${id} ${note}` }],
    delete_nodes: [],
    add_edges: [
      {
        source: 'Start',
        target: id,
        relation: 'LEADS_TO',
        condition: null,
        guidance: `take ${id} next step now`,
        pitfalls: `avoid skipping ${id} entirely`,
      },
      {
        source: id,
        target: 'End',
        relation: 'LEADS_TO',
        condition: null,
        guidance: `finish after ${id} completes`,
        pitfalls: `do not loop after ${id} runs`,
      },
    ],
    delete_edges: [{ source: 'Start', target: 'End' }],
  };
}

function structuralFailEdits(): PGEditSet {
  return {
    add_nodes: [],
    delete_nodes: [],
    add_edges: [
      {
        source: 'Start',
        target: 'Ghost',
        relation: 'LEADS_TO',
        condition: null,
        guidance: 'walk toward a missing node',
        pitfalls: 'do not invent endpoints',
      },
    ],
    delete_edges: [],
  };
}

function editsJson(edits: PGEditSet): string {
  return JSON.stringify(edits);
}

function candidateDigest(retained: ProceduralGraph, edits: PGEditSet): string {
  const prepared = prepareCandidate(retained, edits, {
    toolCatalog: [...TOOLS],
    enforceToolCatalog: false,
    paperCompatible: true,
    staticMode: false,
    cyclePolicy: 'allow',
    nextRevisionId: 'preview',
    parentRevisionId: retained.snapshot.revisionId,
  });
  if (!prepared.ok) {
    throw new Error(`preview prepareCandidate failed: ${prepared.diagnostics.map((d) => d.code).join(',')}`);
  }
  return prepared.candidate.digest;
}

function whitespaceTokenizer(): PGTokenizer {
  const vocab: string[] = [];
  const index = new Map<string, number>();

  function idFor(word: string): number {
    const existing = index.get(word);
    if (existing !== undefined) {
      return existing;
    }
    const id = vocab.length;
    vocab.push(word);
    index.set(word, id);
    return id;
  }

  return {
    encode(text: string): number[] {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return [];
      }
      return trimmed.split(/\s+/).map(idFor);
    },
    decode(tokens: number[]): string {
      return tokens.map((t) => vocab[t] ?? '').join(' ');
    },
  };
}

function queuedRefiner(queue: string[]): PGCompletionProvider & { prompts: string[]; calls: number } {
  const prompts: string[] = [];
  const provider: PGCompletionProvider & { prompts: string[]; calls: number } = {
    identity: 'test-refiner',
    prompts,
    calls: 0,
    async complete(prompt: string): Promise<string> {
      provider.calls += 1;
      prompts.push(prompt);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('refiner queue exhausted');
      }
      return next;
    },
  };
  return provider;
}

function sliceBetween(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < 0 || to < from) {
    return '';
  }
  return text.slice(from + start.length, to);
}

function attemptsBlockOf(prompt: string): string {
  return sliceBetween(
    prompt,
    'Recent execution trajectories: ',
    'Current Procedural Graph representation:',
  ).replace(/\n$/, '');
}

function currentGraphJsonOf(prompt: string): string {
  return sliceBetween(
    prompt,
    'Current Procedural Graph representation: ',
    'Previously rejected candidates:',
  ).replace(/\n$/, '');
}

function rejectedBlockOf(prompt: string): string {
  return sliceBetween(prompt, 'Previously rejected candidates: ', 'Your job is to refine');
}

function task(id: string): PGTask {
  return { id, description: id };
}

function trajectoryFor(taskId: string, action: string): PGTrajectory {
  return {
    taskId,
    revisionId: 'seed',
    score: 1,
    steps: [{ action, observation: `${action}-ok` }],
  };
}

interface Harness {
  backing: InMemoryProceduralGraphBackingFake;
  retained: ProceduralGraph;
  retainedDigest: string;
  evaluateCalls: Array<{ taskId: string; digest: string }>;
  rolloutCalls: number;
  refiner: PGCompletionProvider & { prompts: string[]; calls: number };
  deps: PGEvolutionDependencies;
  evolution: ProceduralGraphEvolution;
  scoreByDigest: Map<string, number | 'nan'>;
}

async function createHarness(args: {
  refinerQueue: string[];
  scoreByDigest?: Map<string, number | 'nan'>;
  defaultCandidateScore?: number;
  rolloutDelayByTask?: Record<string, number>;
  onRollout?: (task: PGTask) => void;
}): Promise<Harness> {
  const backing = new InMemoryProceduralGraphBackingFake();
  const seed = skeletonSnapshot(GRAPH_ID, 'rev-seed');
  await backing.createGraph(seed);
  const retained = ProceduralGraph.fromSnapshot(seed);
  const retainedDigest = retained.digest;
  const evaluateCalls: Array<{ taskId: string; digest: string }> = [];
  const scoreByDigest = args.scoreByDigest ?? new Map<string, number | 'nan'>();
  if (!scoreByDigest.has(retainedDigest)) {
    scoreByDigest.set(retainedDigest, 0.5);
  }
  const refiner = queuedRefiner(args.refinerQueue);
  let rolloutCalls = 0;
  const deps: PGEvolutionDependencies = {
    tokenizer: whitespaceTokenizer(),
    refiner,
    async rollout(t) {
      rolloutCalls += 1;
      args.onRollout?.(t);
      const delay = args.rolloutDelayByTask?.[t.id] ?? 0;
      if (delay > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });
      }
      return trajectoryFor(t.id, t.id);
    },
    async evaluate(t, graph) {
      const digest = graphDigest(graph);
      evaluateCalls.push({ taskId: t.id, digest });
      const mapped = scoreByDigest.get(digest);
      if (mapped === 'nan') {
        return Number.NaN;
      }
      if (typeof mapped === 'number') {
        return mapped;
      }
      return args.defaultCandidateScore ?? 0.4;
    },
  };
  return {
    backing,
    retained,
    retainedDigest,
    evaluateCalls,
    get rolloutCalls() {
      return rolloutCalls;
    },
    refiner,
    deps,
    evolution: new ProceduralGraphEvolution(backing, deps),
    scoreByDigest,
  };
}

function baseOptions(overrides: Partial<PGEvolutionOptions> = {}): PGEvolutionOptions {
  return {
    graphId: GRAPH_ID,
    mode: 'scratch_incremental',
    trainingTasks: [task('train-a'), task('train-b')],
    validationTasks: [task('val-1')],
    batchSize: 1,
    maxRounds: 2,
    maxTokens: 4_000,
    cyclePolicy: 'allow',
    paperCompatible: true,
    enforceToolCatalog: false,
    toolCatalog: [...TOOLS],
    taskDescription: 'evolve the skeleton',
    concurrency: 1,
    taskFailurePolicy: 'fail-round',
    ...overrides,
  };
}

describe('ProceduralGraphEvolution', () => {
  it('baseline is evaluated once and reused across rounds with the same fingerprint', async () => {
    const first = addActionEdits('lookup', 'alpha');
    const second = addActionEdits('search', 'beta');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const scores = new Map<string, number | 'nan'>([
      [graphDigest(preview.snapshot), 0.6],
      [candidateDigest(preview, first), 0.2],
      [candidateDigest(preview, second), 0.1],
    ]);
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: scores,
    });
    const result = await h.evolution.run(baseOptions());
    const baselineCalls = h.evaluateCalls.filter((c) => c.digest === h.retainedDigest);
    expect(baselineCalls).toHaveLength(1);
    expect(result.rounds.some((r) => r.round === 0 && r.outcome === 'accepted')).toBe(true);
    expect(result.rounds.filter((r) => r.round > 0)).toHaveLength(2);
    expect(h.evaluateCalls.filter((c) => c.digest !== h.retainedDigest)).toHaveLength(2);
  });

  it('structurally invalid proposal appends a rejection and makes zero evaluate calls', async () => {
    const h = await createHarness({
      refinerQueue: [editsJson(structuralFailEdits())],
    });
    const result = await h.evolution.run(baseOptions({
      validationTasks: [],
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    }));
    expect(h.evaluateCalls).toHaveLength(0);
    expect(h.backing.store.rejections).toHaveLength(1);
    expect(h.backing.store.rejections[0]?.reason).toBe('structural');
    expect(result.rounds.some((r) => r.outcome === 'rejected-structural')).toBe(true);
    expect(result.retained.revisionId).toBe('rev-seed');
  });

  it('candidateMean equal to baseline is accepted', async () => {
    const edits = addActionEdits('lookup', 'equal');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const digest = candidateDigest(preview, edits);
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [digest, 0.5],
      ]),
    });
    const result = await h.evolution.run(baseOptions({ maxRounds: 1, trainingTasks: [task('train-a')] }));
    const accepted = result.rounds.find((r) => r.round === 1);
    expect(accepted?.outcome).toBe('accepted');
    expect(accepted?.candidateMean).toBe(0.5);
    expect(accepted?.baselineMean).toBe(0.5);
    expect(result.retained.graphDigest).toBe(digest);
    expect(result.retained.validationMean).toBe(0.5);
    expect(result.retained.revisionId).not.toBe('rev-seed');
  });

  it('lower is rejected and the retained revision and cached score are unchanged', async () => {
    const edits = addActionEdits('lookup', 'lower');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.7],
        [candidateDigest(preview, edits), 0.2],
      ]),
    });
    const result = await h.evolution.run(baseOptions({ maxRounds: 1, trainingTasks: [task('train-a')] }));
    const rejected = result.rounds.find((r) => r.round === 1);
    expect(rejected?.outcome).toBe('rejected-validation');
    expect(rejected?.candidateMean).toBe(0.2);
    expect(result.retained.revisionId).toBe('rev-seed');
    expect(result.retained.graphDigest).toBe(h.retainedDigest);
    expect(result.retained.validationMean).toBe(0.7);
    const head = await h.backing.loadHead(GRAPH_ID);
    expect(head?.revisionId).toBe('rev-seed');
    expect(h.backing.store.rejections[0]?.reason).toBe('validation');
  });

  it('higher is accepted and becomes the new baseline', async () => {
    const edits = addActionEdits('lookup', 'higher');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const digest = candidateDigest(preview, edits);
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.4],
        [digest, 0.9],
      ]),
    });
    const result = await h.evolution.run(baseOptions({ maxRounds: 1, trainingTasks: [task('train-a')] }));
    expect(result.rounds.find((r) => r.round === 1)?.outcome).toBe('accepted');
    expect(result.retained.graphDigest).toBe(digest);
    expect(result.retained.validationMean).toBe(0.9);
    const head = await h.backing.loadHead(GRAPH_ID);
    expect(head?.graphDigest).toBe(digest);
  });

  it('a rejected candidate is never the starting graph of the next round', async () => {
    const first = addActionEdits('lookup', 'unique-rejected-note');
    const second = addActionEdits('search', 'follow-up');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.8],
        [candidateDigest(preview, first), 0.1],
        [candidateDigest(preview, second), 0.1],
      ]),
    });
    await h.evolution.run(baseOptions());
    expect(h.refiner.prompts).toHaveLength(2);
    const expectedJson = serializeGraphJson(h.retained);
    expect(currentGraphJsonOf(h.refiner.prompts[1]!)).toBe(expectedJson);
    expect(currentGraphJsonOf(h.refiner.prompts[1]!)).not.toContain('unique-rejected-note');
    expect(currentGraphJsonOf(h.refiner.prompts[0]!)).toBe(expectedJson);
  });

  it('rejected_block passed to the refiner contains the previous rejection', async () => {
    const first = addActionEdits('lookup', 'rejected-block');
    const second = addActionEdits('search', 'after-reject');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.9],
        [candidateDigest(preview, first), 0.1],
        [candidateDigest(preview, second), 0.1],
      ]),
    });
    await h.evolution.run(baseOptions());
    expect(rejectedBlockOf(h.refiner.prompts[0]!).trim()).toBe('');
    const block = rejectedBlockOf(h.refiner.prompts[1]!);
    expect(block).toContain('reason: validation');
    expect(block).toContain('candidateMean: 0.1');
  });

  it('trajectories are concatenated in batch order even when rollouts complete out of order', async () => {
    const edits = addActionEdits('lookup', 'order');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, edits), 0.2],
      ]),
      rolloutDelayByTask: { 't-first': 40, 't-second': 20, 't-third': 1 },
    });
    await h.evolution.run(baseOptions({
      trainingTasks: [task('t-first'), task('t-second'), task('t-third')],
      batchSize: 3,
      maxRounds: 1,
      concurrency: 3,
    }));
    const attempts = attemptsBlockOf(h.refiner.prompts[0]!);
    const expected = concatTrajectories([
      trajectoryFor('t-first', 't-first'),
      trajectoryFor('t-second', 't-second'),
      trajectoryFor('t-third', 't-third'),
    ]);
    expect(attempts).toBe(expected);
    expect(attempts.indexOf('### Task t-first')).toBeLessThan(attempts.indexOf('### Task t-second'));
    expect(attempts.indexOf('### Task t-second')).toBeLessThan(attempts.indexOf('### Task t-third'));
  });

  it('tail truncation keeps only the last maxTokens tokens of the attempts block', async () => {
    const edits = addActionEdits('lookup', 'tail');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const tokenizer = whitespaceTokenizer();
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, edits), 0.2],
      ]),
    });
    h.deps.tokenizer = tokenizer;
    const maxTokens = 6;
    await h.evolution.run(baseOptions({
      trainingTasks: [task('t-first'), task('t-second')],
      batchSize: 2,
      maxRounds: 1,
      maxTokens,
    }));
    const full = concatTrajectories([
      trajectoryFor('t-first', 't-first'),
      trajectoryFor('t-second', 't-second'),
    ]);
    expect(attemptsBlockOf(h.refiner.prompts[0]!)).toBe(tokenTail(full, maxTokens, tokenizer));
  });

  it('evaluator NaN marks the round evaluation-error and does not promote', async () => {
    const edits = addActionEdits('lookup', 'nan');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, edits), 'nan'],
      ]),
    });
    const result = await h.evolution.run(baseOptions({ maxRounds: 1, trainingTasks: [task('train-a')] }));
    const round = result.rounds.find((r) => r.round === 1);
    expect(round?.outcome).toBe('evaluation-error');
    expect(result.retained.revisionId).toBe('rev-seed');
    expect(result.retained.validationMean).toBe(0.5);
    expect(h.backing.store.rejections).toHaveLength(0);
  });

  it('stale head conflict stops the run with stoppedBecause \'conflict\'', async () => {
    const first = addActionEdits('lookup', 'conflict-low');
    const second = addActionEdits('search', 'conflict-high');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    let refinerCalls = 0;
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, first), 0.1],
        [candidateDigest(preview, second), 0.9],
      ]),
      onRollout: () => {
        if (refinerCalls >= 1) {
          h.backing.bumpHead(GRAPH_ID);
        }
      },
    });
    const counting: PGCompletionProvider = {
      identity: h.refiner.identity,
      complete: async (prompt, opts) => {
        const text = await h.refiner.complete(prompt, opts);
        refinerCalls += 1;
        return text;
      },
    };
    h.deps.refiner = counting;
    const evolution = new ProceduralGraphEvolution(h.backing, h.deps);
    const result = await evolution.run(baseOptions());
    expect(result.stoppedBecause).toBe('conflict');
    expect(result.rounds.some((r) => r.outcome === 'conflict')).toBe(true);
    expect(result.retained.revisionId).toBe('rev-seed');
  });

  it('fixed_expert performs no rollout, no refiner call', async () => {
    const h = await createHarness({ refinerQueue: [] });
    const result = await h.evolution.run(baseOptions({ mode: 'fixed_expert' }));
    expect(result.stoppedBecause).toBe('fixed-mode');
    expect(h.rolloutCalls).toBe(0);
    expect(h.refiner.calls).toBe(0);
    expect(h.evaluateCalls).toHaveLength(0);
    expect(result.retained.revisionId).toBe('rev-seed');
    expect(result.rounds).toHaveLength(0);
  });

  it('scratch_onetime under paperCompatible commits without evaluation; under !paperCompatible it is gated', async () => {
    const edits = addActionEdits('lookup', 'onetime');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const digest = candidateDigest(preview, edits);

    const paper = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.9],
        [digest, 0.1],
      ]),
    });
    const paperResult = await paper.evolution.run(baseOptions({
      mode: 'scratch_onetime',
      paperCompatible: true,
      maxRounds: 4,
      batchSize: 1,
      trainingTasks: [task('train-a'), task('train-b')],
    }));
    expect(paper.evaluateCalls).toHaveLength(0);
    expect(paperResult.retained.graphDigest).toBe(digest);
    expect(paperResult.retained.validationMean).toBeNull();
    expect(paperResult.retained.revisionId).not.toBe('rev-seed');

    const gated = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.9],
        [digest, 0.1],
      ]),
    });
    const gatedResult = await gated.evolution.run(baseOptions({
      mode: 'scratch_onetime',
      paperCompatible: false,
      enforceToolCatalog: false,
      maxRounds: 4,
      batchSize: 1,
      trainingTasks: [task('train-a'), task('train-b')],
    }));
    expect(gated.evaluateCalls.length).toBeGreaterThan(0);
    expect(gatedResult.retained.revisionId).toBe('rev-seed');
    expect(gatedResult.retained.validationMean).toBe(0.9);
    expect(gatedResult.rounds.some((r) => r.outcome === 'rejected-validation')).toBe(true);
  });

  it('AbortSignal aborts between rounds with stoppedBecause \'aborted\'', async () => {
    const first = addActionEdits('lookup', 'abort-1');
    const second = addActionEdits('search', 'abort-2');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const controller = new AbortController();
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, first), 0.2],
        [candidateDigest(preview, second), 0.2],
      ]),
    });
    const originalEvaluate = h.deps.evaluate;
    h.deps.evaluate = async (t, graph, signal) => {
      const score = await originalEvaluate(t, graph, signal);
      if (graphDigest(graph) !== h.retainedDigest) {
        controller.abort();
      }
      return score;
    };
    const evolution = new ProceduralGraphEvolution(h.backing, h.deps);
    const result = await evolution.run(baseOptions({ signal: controller.signal }));
    expect(result.stoppedBecause).toBe('aborted');
    expect(result.rounds.filter((r) => r.round > 0)).toHaveLength(1);
    expect(h.refiner.calls).toBe(1);
  });

    it('missing head or revision stops with not-found and parse failures reject structurally', async () => {
    const missing = new ProceduralGraphEvolution(new InMemoryProceduralGraphBackingFake(), {
      tokenizer: whitespaceTokenizer(),
      refiner: queuedRefiner([]),
      rollout: async () => trajectoryFor('t', 't'),
      evaluate: async () => 1,
    });
    const missingHead = await missing.run(baseOptions({ graphId: 'absent' }));
    expect(missingHead.stoppedBecause).toBe('not-found');
    expect(missingHead.retained.revisionId).toBe('');

    const detached = new InMemoryProceduralGraphBackingFake();
    await detached.createGraph(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    detached.store.revisions.clear();
    const orphaned = new ProceduralGraphEvolution(detached, {
      tokenizer: whitespaceTokenizer(),
      refiner: queuedRefiner([]),
      rollout: async () => trajectoryFor('t', 't'),
      evaluate: async () => 1,
    });
    const missingRev = await orphaned.run(baseOptions());
    expect(missingRev.stoppedBecause).toBe('not-found');
    expect(missingRev.retained.revisionId).toBe('rev-seed');

    const parseFail = await createHarness({ refinerQueue: ['not-json'] });
    const parsed = await parseFail.evolution.run(baseOptions({
      maxRounds: 1,
      trainingTasks: [task('train-a')],
      validationTasks: [],
    }));
    expect(parsed.rounds.some((r) => r.outcome === 'rejected-structural')).toBe(true);
    expect(parseFail.backing.store.rejections[0]?.reason).toBe('parse');
  });

  it('baseline evaluation error refuses promotion and score-zero records a zero', async () => {
    const edits = addActionEdits('lookup', 'no-baseline');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 'nan'],
        [candidateDigest(preview, edits), 0.9],
      ]),
    });
    const result = await h.evolution.run(baseOptions({
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    }));
    expect(result.rounds.some((r) => r.round === 0 && r.outcome === 'evaluation-error')).toBe(true);
    expect(result.rounds.some((r) => r.round === 1 && r.outcome === 'evaluation-error')).toBe(true);
    expect(result.retained.revisionId).toBe('rev-seed');

    const throwing = await createHarness({
      refinerQueue: [editsJson(addActionEdits('search', 'zero'))],
    });
    throwing.deps.evaluate = async () => {
      throw new Error('evaluator exploded');
    };
    const zeroed = await throwing.evolution.run(baseOptions({
      taskFailurePolicy: 'score-zero',
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    }));
    expect(zeroed.rounds.some((r) => r.round === 0 && r.outcome === 'accepted')).toBe(true);
    expect(zeroed.retained.validationMean).toBe(0);
  });

  it('already-aborted signal, empty training, and out-of-range scores take the documented exits', async () => {
    const aborted = await createHarness({ refinerQueue: [] });
    const controller = new AbortController();
    controller.abort();
    const abortResult = await aborted.evolution.run(baseOptions({
      signal: controller.signal,
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    }));
    expect(abortResult.stoppedBecause).toBe('aborted');

    const empty = await createHarness({ refinerQueue: [] });
    const exhausted = await empty.evolution.run(baseOptions({
      trainingTasks: [],
      maxRounds: 0,
    }));
    expect(exhausted.stoppedBecause).toBe('batches-exhausted');

    const edits = addActionEdits('lookup', 'oor');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const range = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, edits), 1.5],
      ]),
    });
    const ranged = await range.evolution.run(baseOptions({
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    }));
    expect(ranged.rounds.some((r) => r.outcome === 'evaluation-error')).toBe(true);
    expect(ranged.retained.revisionId).toBe('rev-seed');
  });

  it('static_onetime paperCompatible conflict and session option defaults are recorded', async () => {
    const edits = addActionEdits('lookup', 'static');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(edits)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.5],
        [candidateDigest(preview, edits), 0.9],
      ]),
    });
    const originalCommit = h.backing.commitRetainedRevision.bind(h.backing);
    h.backing.commitRetainedRevision = async (input) => {
      h.backing.bumpHead(GRAPH_ID);
      return originalCommit(input);
    };
    const result = await h.evolution.run(baseOptions({
      mode: 'static_onetime',
      paperCompatible: true,
      maxRounds: 1,
      trainingTasks: [task('train-a')],
      sessionOptions: {
        hopLimit: 3,
        trajectoryWindow: 2,
        timeoutMs: 1_000,
        maxOutputChars: 500,
      },
      manifestExtras: { runId: 'ignored', note: 'kept' },
    }));
    expect(result.stoppedBecause).toBe('conflict');
    expect(result.manifest.note).toBe('kept');
    expect(result.manifest.runId).not.toBe('ignored');
    expect(result.manifest.hopLimit).toBe(3);
  });

  it('restart after a rejected round resumes from the retained head with the cached score', async () => {
    const first = addActionEdits('lookup', 'restart-low');
    const second = addActionEdits('search', 'restart-high');
    const preview = ProceduralGraph.fromSnapshot(skeletonSnapshot(GRAPH_ID, 'rev-seed'));
    const h = await createHarness({
      refinerQueue: [editsJson(first), editsJson(second)],
      scoreByDigest: new Map<string, number | 'nan'>([
        [preview.digest, 0.55],
        [candidateDigest(preview, first), 0.2],
        [candidateDigest(preview, second), 0.8],
      ]),
    });
    const restartOpts = baseOptions({
      maxRounds: 1,
      trainingTasks: [task('train-a')],
    });
    const firstResult = await h.evolution.run(restartOpts);
    expect(firstResult.retained.revisionId).toBe('rev-seed');
    expect(firstResult.retained.validationMean).toBe(0.55);
    const baselineCallsAfterFirst = h.evaluateCalls.filter((c) => c.digest === h.retainedDigest).length;
    expect(baselineCallsAfterFirst).toBe(1);

    const secondResult = await h.evolution.run(restartOpts);
    const baselineCallsAfterSecond = h.evaluateCalls.filter((c) => c.digest === h.retainedDigest).length;
    expect(baselineCallsAfterSecond).toBe(baselineCallsAfterFirst);
    expect(secondResult.retained.graphDigest).toBe(candidateDigest(preview, second));
    expect(secondResult.retained.validationMean).toBe(0.8);
    expect(secondResult.rounds.some((r) => r.round === 0)).toBe(false);
  });
});
