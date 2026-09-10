/**
 * Offline retained-checkpoint self-evolution for Procedural Graphs.
 *
 * Orchestrates caller-owned rollout / evaluate / refiner callbacks around
 * the feature-plan 9.7 loop. Expected outcomes (rejection, conflict, abort,
 * evaluation error, fixed mode) are recorded on {@link PGEvolutionResult}
 * and never thrown.
 *
 * Backing persistence is duck-typed against Section 4.7
 * (`IProceduralGraphBacking`). Agent B owns `backing/**`.
 *
 * @module agent/procedural/graph/ProceduralGraphEvolution
 * @experimental
 */

import { randomUUID } from 'node:crypto';
import type {
  PGConstructionMode,
  PGCyclePolicy,
  PGDiagnostic,
  PGEditSet,
  PGEvaluationReport,
  PGHead,
  PGRefinementMode,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
  PGTask,
  PGTrajectory,
} from '../../../types/proceduralGraph.js';
import type { PGCompletionProvider } from './CompletionProvider.js';
import type { PGTokenizer } from './tokenTail.js';
import { concatTrajectories, tokenTail } from './tokenTail.js';
import {
  canonicalJson,
  evaluationFingerprint,
  graphDigest,
  sha256Hex,
  toolCatalogHash,
} from './canonical.js';
import { ProceduralGraph } from './ProceduralGraph.js';
import { prepareCandidate } from './ProceduralGraphValidator.js';
import { serializeGraphJson } from './ProceduralGraphSerializer.js';
import type { PGSerializerStyle } from './ProceduralGraphSerializer.js';
import { proposeEdits, serializeRejections } from './ProceduralGraphRefiner.js';
import type { PGSessionOptions } from './ProceduralGraphSession.js';

const PROMPTS_VERSION = 'paper-B.5-v1';
const DEFAULT_SUCCESS_THRESHOLD = 1.0;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_HOP_LIMIT = 2;
const DEFAULT_TRAJECTORY_WINDOW = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_REJECTION_MAX_RECORDS = 20;
const DEFAULT_REJECTION_MAX_CHARS = 8_000;
const EMPTY_EDITS: PGEditSet = {
  add_nodes: [],
  delete_nodes: [],
  add_edges: [],
  delete_edges: [],
};

/**
 * Section 4.7 backing contract (duck-typed). Agent B owns
 * `backing/IProceduralGraphBacking.ts`; this file does not import that
 * module so Wave 2 typecheck can pass before the backing lands.
 */
interface PGCommitInput {
  expectedHeadVersion: number;
  revision: PGSnapshot;
  validation: PGEvaluationReport;
  round: PGRoundRecord;
}

type PGCommitResult =
  | { status: 'committed'; head: PGHead }
  | { status: 'conflict'; currentHead: PGHead | undefined };

interface IProceduralGraphBacking {
  readonly kind: 'jsonl' | 'sqlite' | 'memory';
  createGraph(revision: PGSnapshot): Promise<PGHead>;
  loadHead(graphId: string): Promise<PGHead | undefined>;
  loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined>;
  listRevisions(
    graphId: string,
    page: { offset: number; limit: number },
  ): Promise<{
    items: Array<{ revisionId: string; parentRevisionId?: string; graphDigest: string; createdAt: string }>;
    total: number;
  }>;
  commitRetainedRevision(input: PGCommitInput): Promise<PGCommitResult>;
  setHead(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
    round: PGRoundRecord,
  ): Promise<PGCommitResult>;
  saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): Promise<void>;
  loadEvaluation(graphId: string, revisionId: string, fingerprint: string): Promise<PGEvaluationReport | undefined>;
  appendRejection(record: PGRejectionRecord): Promise<void>;
  listRejections(
    graphId: string,
    page: { offset: number; limit: number },
  ): Promise<{ items: PGRejectionRecord[]; total: number }>;
  appendRound(graphId: string, round: PGRoundRecord): Promise<void>;
  close(): Promise<void>;
}

export interface PGEvolutionDependencies {
  rollout(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<PGTrajectory>;
  evaluate(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<number>;
  refiner: PGCompletionProvider;
  tokenizer: PGTokenizer;
}

export interface PGEvolutionOptions {
  graphId: string;
  mode: PGConstructionMode;
  trainingTasks: readonly PGTask[];
  validationTasks: readonly PGTask[];
  batchSize: number;
  maxRounds: number;
  maxTokens: number;
  cyclePolicy: PGCyclePolicy;
  paperCompatible: boolean;
  enforceToolCatalog?: boolean;
  successThreshold?: number;
  toolCatalog: readonly string[];
  taskDescription: string;
  concurrency?: number;
  taskFailurePolicy: 'fail-round' | 'score-zero';
  rejectionMemory?: { maxRecords: number; maxChars: number };
  manifestExtras?: Record<string, unknown>;
  signal?: AbortSignal;
  sessionOptions?: Partial<PGSessionOptions>;
}

export interface PGEvolutionResult {
  runId: string;
  manifest: Record<string, unknown>;
  retained: { revisionId: string; graphDigest: string; validationMean: number | null };
  rounds: PGRoundRecord[];
  stoppedBecause: 'rounds-exhausted' | 'batches-exhausted' | 'aborted' | 'conflict' | 'fixed-mode';
}

export class ProceduralGraphEvolution {
  constructor(
    private readonly backing: IProceduralGraphBacking,
    private readonly deps: PGEvolutionDependencies,
  ) {}

  async run(opts: PGEvolutionOptions): Promise<PGEvolutionResult> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const resolved = resolveOptions(opts, this.deps);
    const manifest = buildManifest(runId, startedAt, resolved);
    const fingerprint = evaluationFingerprint(fingerprintParts(manifest));

    const missing = emptyRetained();
    const head = await this.backing.loadHead(opts.graphId);
    if (!head) {
      return {
        runId,
        manifest,
        retained: missing,
        rounds: [],
        stoppedBecause: 'conflict',
      };
    }

    if (opts.mode === 'fixed_expert') {
      return {
        runId,
        manifest,
        retained: {
          revisionId: head.revisionId,
          graphDigest: head.graphDigest,
          validationMean: head.validationMean,
        },
        rounds: [],
        stoppedBecause: 'fixed-mode',
      };
    }

    const loaded = await this.backing.loadRevision(opts.graphId, head.revisionId);
    if (!loaded) {
      return {
        runId,
        manifest,
        retained: {
          revisionId: head.revisionId,
          graphDigest: head.graphDigest,
          validationMean: head.validationMean,
        },
        rounds: [],
        stoppedBecause: 'conflict',
      };
    }

    let retained = ProceduralGraph.fromSnapshot(loaded);
    let expectedHeadVersion = head.headVersion;
    const rounds: PGRoundRecord[] = [];
    const rejections: PGRejectionRecord[] = [];
    const paperOnetime = isOnetime(opts.mode) && opts.paperCompatible;

    let baseline: PGEvaluationReport | null = null;
    if (!paperOnetime) {
      const cached = await this.backing.loadEvaluation(opts.graphId, head.revisionId, fingerprint);
      if (cached && cached.fingerprint === fingerprint && cached.graphDigest === graphDigest(retained.snapshot)) {
        baseline = cached;
      } else {
        const evaluatedAt = new Date().toISOString();
        const roundStarted = evaluatedAt;
        const report = await this.evaluateValidationSet(retained.snapshot, resolved, fingerprint);
        const roundFinished = new Date().toISOString();
        if (isPromotableReport(report)) {
          baseline = report;
          await this.backing.saveEvaluation(opts.graphId, retained.snapshot.revisionId, report);
          const round0 = makeRound({
            runId,
            round: 0,
            retainedRevisionId: retained.snapshot.revisionId,
            candidateRevisionId: retained.snapshot.revisionId,
            outcome: 'accepted',
            baselineMean: report.meanScore,
            candidateMean: report.meanScore,
            diagnostics: [],
            repairs: [],
            startedAt: roundStarted,
            finishedAt: roundFinished,
          });
          rounds.push(round0);
          await this.backing.appendRound(opts.graphId, round0);
        } else {
          const round0 = makeRound({
            runId,
            round: 0,
            retainedRevisionId: retained.snapshot.revisionId,
            candidateRevisionId: retained.snapshot.revisionId,
            outcome: 'evaluation-error',
            baselineMean: null,
            candidateMean: null,
            diagnostics: [evalErrorDiagnostic('baseline evaluation is incomplete or invalid')],
            repairs: [],
            startedAt: roundStarted,
            finishedAt: roundFinished,
          });
          rounds.push(round0);
          await this.backing.appendRound(opts.graphId, round0);
        }
      }
    }

    const finish = (
      stoppedBecause: PGEvolutionResult['stoppedBecause'],
      validationMean: number | null = paperOnetime ? null : (baseline?.meanScore ?? null),
    ): PGEvolutionResult => ({
      runId,
      manifest,
      retained: {
        revisionId: retained.snapshot.revisionId,
        graphDigest: retained.digest,
        validationMean,
      },
      rounds,
      stoppedBecause,
    });

    if (opts.signal?.aborted) {
      return finish('aborted');
    }

    const batches = trainingBatches(opts.trainingTasks, opts.batchSize, opts.mode);
    const maxRefineRounds = isOnetime(opts.mode) ? 1 : Math.max(0, opts.maxRounds);
    let refineRound = 0;

    for (const batch of batches) {
      if (opts.signal?.aborted) {
        return finish('aborted');
      }
      if (refineRound >= maxRefineRounds) {
        return finish('rounds-exhausted');
      }
      refineRound += 1;
      const roundNumber = refineRound;
      const roundStarted = new Date().toISOString();
      const refineMode = refinementModeOf(opts.mode);

      const rolled = await mapInChunks(batch, resolved.concurrency, (task, index) =>
        this.deps.rollout(task, retained.snapshot, opts.signal).then((trajectory) => ({ index, trajectory })),
      );
      const traces = restoreDeterministicBatchOrder(rolled);

      const attemptsBlock = tokenTail(
        concatTrajectories(traces),
        opts.maxTokens,
        this.deps.tokenizer,
      );
      const rejected = serializeRejections(rejections, resolved.rejectionMemory);

      const proposal = await proposeEdits(
        this.deps.refiner,
        {
          taskDescription: opts.taskDescription,
          mode: refineMode,
          toolCatalog: opts.toolCatalog,
          attemptsBlock,
          currentGraphJson: serializeGraphJson(retained),
          rejectedBlock: rejected.text,
        },
        {
          timeoutMs: resolved.timeoutMs,
          maxOutputChars: resolved.maxOutputChars,
        },
      );

      if (!proposal.ok) {
        const record = await this.recordRejection({
          runId,
          round: roundNumber,
          reason: 'parse',
          proposalRaw: proposal.raw,
          edits: EMPTY_EDITS,
          diagnostics: proposal.diagnostics,
          retained,
          baseline,
          fingerprint,
          traces,
          startedAt: roundStarted,
        });
        rejections.push(record);
        rounds.push(recordToRound(record, 'rejected-structural'));
        await this.backing.appendRound(opts.graphId, rounds[rounds.length - 1]!);
        continue;
      }

      const staticMode = opts.mode.startsWith('static_');
      const prepared = prepareCandidate(retained, proposal.edits, {
        toolCatalog: opts.toolCatalog,
        enforceToolCatalog: resolved.enforceToolCatalog,
        paperCompatible: opts.paperCompatible,
        staticMode,
        baselineNodeIds: staticMode ? retained.snapshot.nodes.map((n) => n.id) : undefined,
        cyclePolicy: opts.cyclePolicy,
        nextRevisionId: nextRevisionId(runId, roundNumber),
        parentRevisionId: retained.snapshot.revisionId,
      });
      const combinedDiagnostics = [...proposal.diagnostics, ...prepared.diagnostics];

      if (!prepared.ok) {
        const record = await this.recordRejection({
          runId,
          round: roundNumber,
          reason: 'structural',
          proposalRaw: proposal.raw,
          edits: proposal.edits,
          diagnostics: combinedDiagnostics,
          retained,
          baseline,
          fingerprint,
          traces,
          startedAt: roundStarted,
        });
        rejections.push(record);
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          outcome: 'rejected-structural',
          baselineMean: baseline?.meanScore ?? null,
          candidateMean: null,
          diagnostics: combinedDiagnostics,
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: record.recordedAt,
        });
        rounds.push(round);
        await this.backing.appendRound(opts.graphId, round);
        continue;
      }

      const candidate = prepared.candidate;

      if (paperOnetime) {
        const dummy = unevaluatedReport(fingerprint, candidate.digest);
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          candidateRevisionId: candidate.snapshot.revisionId,
          outcome: 'accepted',
          baselineMean: null,
          candidateMean: null,
          diagnostics: combinedDiagnostics,
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: new Date().toISOString(),
        });
        const publication = await this.backing.commitRetainedRevision({
          expectedHeadVersion,
          revision: candidate.snapshot,
          validation: dummy,
          round,
        });
        if (publication.status === 'committed') {
          retained = candidate;
          expectedHeadVersion = publication.head.headVersion;
          rounds.push(round);
          return finish('batches-exhausted', null);
        }
        const conflictRound = { ...round, outcome: 'conflict' as const, finishedAt: new Date().toISOString() };
        rounds.push(conflictRound);
        await this.backing.appendRound(opts.graphId, conflictRound);
        return finish('conflict', null);
      }

      if (!baseline) {
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          candidateRevisionId: candidate.snapshot.revisionId,
          outcome: 'evaluation-error',
          baselineMean: null,
          candidateMean: null,
          diagnostics: [...combinedDiagnostics, evalErrorDiagnostic('no valid baseline; refusing promotion')],
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: new Date().toISOString(),
        });
        rounds.push(round);
        await this.backing.appendRound(opts.graphId, round);
        continue;
      }

      const report = await this.evaluateValidationSet(candidate.snapshot, resolved, fingerprint);
      if (!isPromotableReport(report)) {
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          candidateRevisionId: candidate.snapshot.revisionId,
          outcome: 'evaluation-error',
          baselineMean: baseline.meanScore,
          candidateMean: null,
          diagnostics: [...combinedDiagnostics, evalErrorDiagnostic('candidate evaluation is incomplete or invalid')],
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: new Date().toISOString(),
        });
        rounds.push(round);
        await this.backing.appendRound(opts.graphId, round);
        continue;
      }

      if (report.meanScore >= baseline.meanScore) {
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          candidateRevisionId: candidate.snapshot.revisionId,
          outcome: 'accepted',
          baselineMean: baseline.meanScore,
          candidateMean: report.meanScore,
          diagnostics: combinedDiagnostics,
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: new Date().toISOString(),
        });
        const publication = await this.backing.commitRetainedRevision({
          expectedHeadVersion,
          revision: candidate.snapshot,
          validation: report,
          round,
        });
        if (publication.status === 'committed') {
          retained = candidate;
          baseline = report;
          expectedHeadVersion = publication.head.headVersion;
          rounds.push(round);
        } else {
          const conflictRound = { ...round, outcome: 'conflict' as const, finishedAt: new Date().toISOString() };
          rounds.push(conflictRound);
          await this.backing.appendRound(opts.graphId, conflictRound);
          return finish('conflict');
        }
      } else {
        const record = await this.recordRejection({
          runId,
          round: roundNumber,
          reason: 'validation',
          proposalRaw: proposal.raw,
          edits: proposal.edits,
          diagnostics: combinedDiagnostics,
          retained,
          baseline,
          fingerprint,
          traces,
          startedAt: roundStarted,
          candidate,
          candidateMean: report.meanScore,
        });
        rejections.push(record);
        const round = makeRound({
          runId,
          round: roundNumber,
          retainedRevisionId: retained.snapshot.revisionId,
          candidateRevisionId: candidate.snapshot.revisionId,
          outcome: 'rejected-validation',
          baselineMean: baseline.meanScore,
          candidateMean: report.meanScore,
          diagnostics: combinedDiagnostics,
          repairs: prepared.repairs,
          startedAt: roundStarted,
          finishedAt: record.recordedAt,
        });
        rounds.push(round);
        await this.backing.appendRound(opts.graphId, round);
      }
    }

    return finish('batches-exhausted');
  }

  private async evaluateValidationSet(
    snapshot: PGSnapshot,
    resolved: ResolvedOptions,
    fingerprint: string,
  ): Promise<PGEvaluationReport> {
    const tasks = resolved.validationTasks;
    const results = await mapInChunks(tasks, resolved.concurrency, async (task) => {
      try {
        const score = await this.deps.evaluate(task, snapshot, resolved.signal);
        return { taskId: task.id, score, error: undefined as string | undefined, threw: false };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { taskId: task.id, score: Number.NaN, error: message, threw: true };
      }
    });

    const scores: PGEvaluationReport['scores'] = [];
    let completed = 0;
    let sum = 0;
    let invalid = false;

    for (const item of results) {
      if (item.threw) {
        if (resolved.taskFailurePolicy === 'score-zero') {
          scores.push({ taskId: item.taskId, score: 0, error: 'score-zero' });
          completed += 1;
        } else {
          scores.push({ taskId: item.taskId, score: null, error: item.error });
        }
        continue;
      }
      if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
        const error = !Number.isFinite(item.score) ? 'non-finite' : 'out-of-range';
        scores.push({ taskId: item.taskId, score: null, error });
        invalid = true;
        continue;
      }
      scores.push({ taskId: item.taskId, score: item.score });
      completed += 1;
      sum += item.score;
    }

    const taskCount = tasks.length;
    const incomplete = invalid || completed < taskCount;
    const meanScore = completed > 0 ? sum / completed : 0;
    return {
      fingerprint,
      graphDigest: graphDigest(snapshot),
      taskCount,
      completed,
      meanScore,
      scores,
      incomplete,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async recordRejection(input: {
    runId: string;
    round: number;
    reason: PGRejectionRecord['reason'];
    proposalRaw?: string;
    edits: PGEditSet;
    diagnostics: PGDiagnostic[];
    retained: ProceduralGraph;
    baseline: PGEvaluationReport | null;
    fingerprint: string;
    traces: readonly PGTrajectory[];
    startedAt: string;
    candidate?: ProceduralGraph;
    candidateMean?: number;
  }): Promise<PGRejectionRecord> {
    const record: PGRejectionRecord = {
      runId: input.runId,
      round: input.round,
      proposalDigest: sha256Hex(input.proposalRaw ?? ''),
      edits: input.edits,
      reason: input.reason,
      diagnostics: input.diagnostics,
      retainedMean: input.baseline?.meanScore ?? null,
      retainedRevisionId: input.retained.snapshot.revisionId,
      trajectoryRefs: input.traces.map((t) => t.taskId),
      fingerprint: input.fingerprint,
      recordedAt: new Date().toISOString(),
    };
    if (input.candidate) {
      record.candidateDigest = input.candidate.digest;
      record.candidateRevisionId = input.candidate.snapshot.revisionId;
    }
    if (input.candidateMean !== undefined) {
      record.candidateMean = input.candidateMean;
    }
    await this.backing.appendRejection(record);
    return record;
  }
}

interface ResolvedOptions {
  graphId: string;
  mode: PGConstructionMode;
  trainingTasks: readonly PGTask[];
  validationTasks: readonly PGTask[];
  batchSize: number;
  maxRounds: number;
  maxTokens: number;
  cyclePolicy: PGCyclePolicy;
  paperCompatible: boolean;
  enforceToolCatalog: boolean;
  successThreshold: number;
  toolCatalog: readonly string[];
  taskDescription: string;
  concurrency: number;
  taskFailurePolicy: 'fail-round' | 'score-zero';
  rejectionMemory: { maxRecords: number; maxChars: number };
  hopLimit: number;
  trajectoryWindow: number;
  serializerStyle: PGSerializerStyle;
  refinerIdentity: string;
  guidanceIdentity: string;
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
  manifestExtras: Record<string, unknown>;
}

function resolveOptions(opts: PGEvolutionOptions, deps: PGEvolutionDependencies): ResolvedOptions {
  const session = opts.sessionOptions ?? {};
  const paperCompatible = opts.paperCompatible;
  return {
    graphId: opts.graphId,
    mode: opts.mode,
    trainingTasks: opts.trainingTasks,
    validationTasks: opts.validationTasks,
    batchSize: opts.batchSize,
    maxRounds: opts.maxRounds,
    maxTokens: opts.maxTokens,
    cyclePolicy: opts.cyclePolicy,
    paperCompatible,
    enforceToolCatalog: paperCompatible ? false : (opts.enforceToolCatalog ?? true),
    successThreshold: opts.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD,
    toolCatalog: opts.toolCatalog,
    taskDescription: opts.taskDescription,
    concurrency: Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY),
    taskFailurePolicy: opts.taskFailurePolicy,
    rejectionMemory: {
      maxRecords: opts.rejectionMemory?.maxRecords ?? DEFAULT_REJECTION_MAX_RECORDS,
      maxChars: opts.rejectionMemory?.maxChars ?? DEFAULT_REJECTION_MAX_CHARS,
    },
    hopLimit: session.hopLimit ?? DEFAULT_HOP_LIMIT,
    trajectoryWindow: session.trajectoryWindow ?? DEFAULT_TRAJECTORY_WINDOW,
    serializerStyle:
      session.serializerStyle
      ?? (paperCompatible ? 'paper-compatible' : 'memoryjs'),
    refinerIdentity: deps.refiner.identity ?? '',
    guidanceIdentity: session.provider?.identity ?? '',
    timeoutMs: session.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputChars: session.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
    signal: opts.signal,
    manifestExtras: opts.manifestExtras ?? {},
  };
}

function buildManifest(runId: string, startedAt: string, resolved: ResolvedOptions): Record<string, unknown> {
  const extras: Record<string, unknown> = { ...resolved.manifestExtras };
  delete extras.runId;
  delete extras.startedAt;
  return {
    runId,
    graphId: resolved.graphId,
    mode: resolved.mode,
    paperCompatible: resolved.paperCompatible,
    enforceToolCatalog: resolved.enforceToolCatalog,
    cyclePolicy: resolved.cyclePolicy,
    hopLimit: resolved.hopLimit,
    trajectoryWindow: resolved.trajectoryWindow,
    maxTokens: resolved.maxTokens,
    batchSize: resolved.batchSize,
    successThreshold: resolved.successThreshold,
    taskFailurePolicy: resolved.taskFailurePolicy,
    toolCatalogHash: toolCatalogHash(resolved.toolCatalog),
    trainingFingerprint: taskFingerprint(resolved.trainingTasks),
    validationFingerprint: taskFingerprint(resolved.validationTasks),
    refinerIdentity: resolved.refinerIdentity,
    guidanceIdentity: resolved.guidanceIdentity,
    promptsVersion: PROMPTS_VERSION,
    serializerStyle: resolved.serializerStyle,
    startedAt,
    ...extras,
  };
}

function fingerprintParts(manifest: Record<string, unknown>): Record<string, unknown> {
  const parts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === 'runId' || key === 'startedAt') {
      continue;
    }
    parts[key] = value;
  }
  return parts;
}

function taskFingerprint(tasks: readonly PGTask[]): string {
  return sha256Hex(canonicalJson([...tasks.map((t) => t.id)].sort()));
}

function isOnetime(mode: PGConstructionMode): boolean {
  return mode === 'static_onetime' || mode === 'scratch_onetime';
}

function refinementModeOf(mode: PGConstructionMode): PGRefinementMode {
  if (mode === 'fixed_expert') {
    return 'scratch_incremental';
  }
  return mode;
}

function nextRevisionId(runId: string, round: number): string {
  return sha256Hex(`${runId}:${round}`);
}

function trainingBatches(
  tasks: readonly PGTask[],
  batchSize: number,
  mode: PGConstructionMode,
): PGTask[][] {
  if (tasks.length === 0) {
    return [];
  }
  if (isOnetime(mode)) {
    return [[...tasks]];
  }
  const size = Math.max(1, batchSize);
  const batches: PGTask[][] = [];
  for (let i = 0; i < tasks.length; i += size) {
    batches.push(tasks.slice(i, i + size));
  }
  return batches;
}

function restoreDeterministicBatchOrder(
  rolled: Array<{ index: number; trajectory: PGTrajectory }>,
): PGTrajectory[] {
  return [...rolled].sort((a, b) => a.index - b.index).map((r) => r.trajectory);
}

async function mapInChunks<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const collected: Array<{ index: number; value: R }> = [];
  for (let offset = 0; offset < items.length; offset += limit) {
    const chunk = items.slice(offset, offset + limit);
    const chunkResults = await Promise.all(
      chunk.map((item, local) => {
        const index = offset + local;
        return fn(item, index).then((value) => ({ index, value }));
      }),
    );
    collected.push(...chunkResults);
  }
  collected.sort((a, b) => a.index - b.index);
  return collected.map((r) => r.value);
}

function isPromotableReport(report: PGEvaluationReport): boolean {
  if (report.incomplete) {
    return false;
  }
  if (!Number.isFinite(report.meanScore) || report.meanScore < 0 || report.meanScore > 1) {
    return false;
  }
  for (const row of report.scores) {
    if (row.score === null) {
      return false;
    }
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 1) {
      return false;
    }
  }
  return true;
}

function unevaluatedReport(fingerprint: string, digest: string): PGEvaluationReport {
  return {
    fingerprint,
    graphDigest: digest,
    taskCount: 0,
    completed: 0,
    meanScore: 0,
    scores: [],
    incomplete: false,
    evaluatedAt: new Date().toISOString(),
  };
}

function emptyRetained(): PGEvolutionResult['retained'] {
  return { revisionId: '', graphDigest: '', validationMean: null };
}

function evalErrorDiagnostic(message: string): PGDiagnostic {
  return { severity: 'error', code: 'evaluation-error', message };
}

function makeRound(partial: PGRoundRecord): PGRoundRecord {
  return {
    runId: partial.runId,
    round: partial.round,
    retainedRevisionId: partial.retainedRevisionId,
    outcome: partial.outcome,
    baselineMean: partial.baselineMean,
    candidateMean: partial.candidateMean,
    diagnostics: partial.diagnostics,
    repairs: partial.repairs,
    startedAt: partial.startedAt,
    finishedAt: partial.finishedAt,
    ...(partial.candidateRevisionId !== undefined
      ? { candidateRevisionId: partial.candidateRevisionId }
      : {}),
  };
}

function recordToRound(
  record: PGRejectionRecord,
  outcome: PGRoundRecord['outcome'],
): PGRoundRecord {
  return makeRound({
    runId: record.runId,
    round: record.round,
    retainedRevisionId: record.retainedRevisionId,
    candidateRevisionId: record.candidateRevisionId,
    outcome,
    baselineMean: record.retainedMean,
    candidateMean: record.candidateMean ?? null,
    diagnostics: record.diagnostics,
    repairs: [],
    startedAt: record.recordedAt,
    finishedAt: record.recordedAt,
  });
}
