/**
 * In-memory procedural-graph state shared by the memory and JSONL backings.
 *
 * Mutations are synchronous; callers serialize them with `AsyncMutex`.
 *
 * @module agent/procedural/graph/backing/ProceduralGraphState
 * @internal
 */

import type {
  PGEvaluationReport,
  PGHead,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../../types/proceduralGraph.js';
import { graphDigest, storageKey } from '../canonical.js';
import type { PGCommitInput, PGCommitResult } from './IProceduralGraphBacking.js';

export interface PGRevisionListItem {
  revisionId: string;
  parentRevisionId?: string;
  graphDigest: string;
  createdAt: string;
}

interface StoredRevision {
  snapshot: PGSnapshot;
  graphDigest: string;
  createdAt: string;
}

interface StoredEvaluation {
  graphId: string;
  revisionId: string;
  fingerprint: string;
  report: PGEvaluationReport;
}

interface StoredRound {
  graphId: string;
  record: PGRoundRecord;
}

interface StoredRejection {
  graphId: string;
  record: PGRejectionRecord;
}

const GRAPH_EXISTS = 'graph-exists';

export function graphExistsError(graphId: string): Error {
  return new Error(`${GRAPH_EXISTS}: graph '${graphId}' already exists`);
}

export class ProceduralGraphState {
  private readonly heads = new Map<string, PGHead>();
  private readonly headLog: PGHead[] = [];
  private readonly revisions = new Map<string, StoredRevision>();
  private readonly revisionOrder: string[] = [];
  private readonly evaluations = new Map<string, StoredEvaluation>();
  private readonly evaluationOrder: string[] = [];
  private readonly rounds: StoredRound[] = [];
  private readonly rejections: StoredRejection[] = [];
  private lastTimestamp = '';

  createGraph(revision: PGSnapshot): PGHead {
    const graphId = revision.graphId;
    if (this.heads.has(graphId)) {
      throw graphExistsError(graphId);
    }
    const stored = this.insertRevision(revision);
    const head = this.buildHead({
      graphId,
      revisionId: revision.revisionId,
      headVersion: 1,
      graphDigest: stored.graphDigest,
      validationMean: null,
      evaluationFingerprint: null,
      validationReportRef: null,
    });
    this.publishHead(head);
    return clone(head);
  }

  loadHead(graphId: string): PGHead | undefined {
    const head = this.heads.get(graphId);
    return head === undefined ? undefined : clone(head);
  }

  loadRevision(graphId: string, revisionId: string): PGSnapshot | undefined {
    const stored = this.revisions.get(revisionKey(graphId, revisionId));
    return stored === undefined ? undefined : clone(stored.snapshot);
  }

  listRevisions(
    graphId: string,
    page: { offset: number; limit: number },
  ): { items: PGRevisionListItem[]; total: number } {
    const items: PGRevisionListItem[] = [];
    for (const key of this.revisionOrder) {
      const stored = this.revisions.get(key);
      if (stored === undefined || stored.snapshot.graphId !== graphId) continue;
      items.push(toRevisionListItem(stored));
    }
    items.sort(compareRevisionNewestFirst);
    return paginate(items, page);
  }

  commitRetainedRevision(input: PGCommitInput): PGCommitResult {
    const graphId = input.revision.graphId;
    const current = this.heads.get(graphId);
    if (current === undefined || current.headVersion !== input.expectedHeadVersion) {
      return { status: 'conflict', currentHead: current === undefined ? undefined : clone(current) };
    }
    const stored = this.insertRevision(input.revision);
    this.upsertEvaluation(graphId, input.revision.revisionId, input.validation);
    this.rounds.push({ graphId, record: clone(input.round) });
    const head = this.buildHead({
      graphId,
      revisionId: input.revision.revisionId,
      headVersion: input.expectedHeadVersion + 1,
      graphDigest: stored.graphDigest,
      validationMean: input.validation.meanScore,
      evaluationFingerprint: input.validation.fingerprint,
      validationReportRef: storageKey('evaluation', [
        graphId,
        input.revision.revisionId,
        input.validation.fingerprint,
      ]),
    });
    this.publishHead(head);
    return { status: 'committed', head: clone(head) };
  }

  setHead(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
    round: PGRoundRecord,
  ): PGCommitResult {
    const current = this.heads.get(graphId);
    const stored = this.revisions.get(revisionKey(graphId, revisionId));
    if (stored === undefined) {
      return { status: 'conflict', currentHead: current === undefined ? undefined : clone(current) };
    }
    if (current === undefined || current.headVersion !== expectedHeadVersion) {
      return { status: 'conflict', currentHead: current === undefined ? undefined : clone(current) };
    }
    const evaluation = this.latestEvaluation(graphId, revisionId);
    this.rounds.push({ graphId, record: clone(round) });
    const head = this.buildHead({
      graphId,
      revisionId,
      headVersion: expectedHeadVersion + 1,
      graphDigest: stored.graphDigest,
      validationMean: evaluation?.meanScore ?? null,
      evaluationFingerprint: evaluation?.fingerprint ?? null,
      validationReportRef: evaluation === undefined
        ? null
        : storageKey('evaluation', [graphId, revisionId, evaluation.fingerprint]),
    });
    this.publishHead(head);
    return { status: 'committed', head: clone(head) };
  }

  saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): void {
    this.upsertEvaluation(graphId, revisionId, report);
  }

  loadEvaluation(
    graphId: string,
    revisionId: string,
    fingerprint: string,
  ): PGEvaluationReport | undefined {
    const stored = this.evaluations.get(evaluationKey(graphId, revisionId, fingerprint));
    return stored === undefined ? undefined : clone(stored.report);
  }

  appendRejection(record: PGRejectionRecord): void {
    const graphId = this.resolveRejectionGraphId(record);
    this.rejections.push({ graphId, record: clone(record) });
    this.noteTimestamp(record.recordedAt);
  }

  listRejections(
    graphId: string,
    page: { offset: number; limit: number },
  ): { items: PGRejectionRecord[]; total: number } {
    const indexed = this.rejections
      .map((entry, index) => ({ entry, index }))
      .filter((row) => row.entry.graphId === graphId);
    indexed.sort((a, b) => {
      if (a.entry.record.recordedAt !== b.entry.record.recordedAt) {
        return a.entry.record.recordedAt < b.entry.record.recordedAt ? 1 : -1;
      }
      return b.index - a.index;
    });
    const items = indexed.map((row) => clone(row.entry.record));
    return paginate(items, page);
  }

  appendRound(graphId: string, round: PGRoundRecord): void {
    this.rounds.push({ graphId, record: clone(round) });
  }

  applyRecord(record: unknown): void {
    if (!isPlainObject(record)) {
      throw new Error('PG JSONL record must be an object');
    }
    const kind = record.kind;
    if (kind === 'head') {
      this.applyHead(record);
      return;
    }
    if (kind === 'revision') {
      this.applyRevision(record);
      return;
    }
    if (kind === 'evaluation') {
      this.applyEvaluation(record);
      return;
    }
    if (kind === 'round') {
      this.applyRound(record);
      return;
    }
    if (kind === 'rejection') {
      this.applyRejection(record);
      return;
    }
    throw new Error(`Unknown PG JSONL record kind: ${String(kind)}`);
  }

  toJsonl(): string {
    const lines: unknown[] = [];
    for (const key of this.revisionOrder) {
      const stored = this.revisions.get(key);
      if (stored === undefined) continue;
      const line: Record<string, unknown> = {
        kind: 'revision',
        graphId: stored.snapshot.graphId,
        revisionId: stored.snapshot.revisionId,
        graphDigest: stored.graphDigest,
        createdAt: stored.createdAt,
        snapshot: stored.snapshot,
      };
      if (stored.snapshot.parentRevisionId !== undefined) {
        line.parentRevisionId = stored.snapshot.parentRevisionId;
      }
      lines.push(line);
    }
    for (const key of this.evaluationOrder) {
      const stored = this.evaluations.get(key);
      if (stored === undefined) continue;
      lines.push({
        kind: 'evaluation',
        graphId: stored.graphId,
        revisionId: stored.revisionId,
        fingerprint: stored.fingerprint,
        report: stored.report,
      });
    }
    for (const stored of this.rounds) {
      lines.push({
        kind: 'round',
        graphId: stored.graphId,
        runId: stored.record.runId,
        round: stored.record.round,
        record: stored.record,
      });
    }
    for (const stored of this.rejections) {
      lines.push({
        kind: 'rejection',
        graphId: stored.graphId,
        record: stored.record,
      });
    }
    for (const head of this.headLog) {
      lines.push({
        kind: 'head',
        graphId: head.graphId,
        revisionId: head.revisionId,
        headVersion: head.headVersion,
        graphDigest: head.graphDigest,
        validationMean: head.validationMean,
        evaluationFingerprint: head.evaluationFingerprint,
        validationReportRef: head.validationReportRef,
        updatedAt: head.updatedAt,
      });
    }
    if (lines.length === 0) return '';
    return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
  }

  private insertRevision(revision: PGSnapshot): StoredRevision {
    const key = revisionKey(revision.graphId, revision.revisionId);
    if (this.revisions.has(key)) {
      throw new Error(`revision already exists: ${revision.graphId}/${revision.revisionId}`);
    }
    const stored: StoredRevision = {
      snapshot: clone(revision),
      graphDigest: graphDigest(revision),
      createdAt: this.nextTimestamp(),
    };
    this.revisions.set(key, stored);
    this.revisionOrder.push(key);
    return stored;
  }

  private upsertEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): void {
    const key = evaluationKey(graphId, revisionId, report.fingerprint);
    const stored: StoredEvaluation = {
      graphId,
      revisionId,
      fingerprint: report.fingerprint,
      report: clone(report),
    };
    if (!this.evaluations.has(key)) {
      this.evaluationOrder.push(key);
    }
    this.evaluations.set(key, stored);
  }

  private latestEvaluation(graphId: string, revisionId: string): PGEvaluationReport | undefined {
    for (let i = this.evaluationOrder.length - 1; i >= 0; i -= 1) {
      const stored = this.evaluations.get(this.evaluationOrder[i]!);
      if (stored !== undefined && stored.graphId === graphId && stored.revisionId === revisionId) {
        return stored.report;
      }
    }
    return undefined;
  }

  private publishHead(head: PGHead): void {
    this.headLog.push(head);
    this.heads.set(head.graphId, head);
  }

  private buildHead(fields: Omit<PGHead, 'updatedAt'>): PGHead {
    return { ...fields, updatedAt: this.nextTimestamp() };
  }

  private resolveRejectionGraphId(record: PGRejectionRecord): string {
    const matches = new Set<string>();
    for (const stored of this.revisions.values()) {
      if (stored.snapshot.revisionId === record.retainedRevisionId) {
        matches.add(stored.snapshot.graphId);
      }
    }
    if (matches.size === 1) {
      return [...matches][0]!;
    }
    if (matches.size > 1) {
      return [...matches].sort()[0]!;
    }
    if (this.heads.size >= 1) {
      return [...this.heads.keys()].sort()[0]!;
    }
    throw new Error('Cannot associate rejection with a graph');
  }

  private applyHead(record: Record<string, unknown>): void {
    const head: PGHead = {
      graphId: readString(record, 'graphId'),
      revisionId: readString(record, 'revisionId'),
      headVersion: readNumber(record, 'headVersion'),
      graphDigest: readString(record, 'graphDigest'),
      validationMean: readNullableNumber(record, 'validationMean'),
      evaluationFingerprint: readNullableString(record, 'evaluationFingerprint'),
      validationReportRef: readNullableString(record, 'validationReportRef'),
      updatedAt: readString(record, 'updatedAt'),
    };
    this.noteTimestamp(head.updatedAt);
    this.headLog.push(head);
    const current = this.heads.get(head.graphId);
    if (current === undefined || head.headVersion >= current.headVersion) {
      this.heads.set(head.graphId, head);
    }
  }

  private applyRevision(record: Record<string, unknown>): void {
    const snapshot = record.snapshot as PGSnapshot;
    const graphId = readString(record, 'graphId');
    const revisionId = readString(record, 'revisionId');
    const key = revisionKey(graphId, revisionId);
    const stored: StoredRevision = {
      snapshot: clone(snapshot),
      graphDigest: typeof record.graphDigest === 'string' ? record.graphDigest : graphDigest(snapshot),
      createdAt: readString(record, 'createdAt'),
    };
    if (!this.revisions.has(key)) {
      this.revisionOrder.push(key);
    }
    this.revisions.set(key, stored);
    this.noteTimestamp(stored.createdAt);
  }

  private applyEvaluation(record: Record<string, unknown>): void {
    const graphId = readString(record, 'graphId');
    const revisionId = readString(record, 'revisionId');
    const fingerprint = readString(record, 'fingerprint');
    const report = record.report as PGEvaluationReport;
    this.upsertEvaluation(graphId, revisionId, report);
  }

  private applyRound(record: Record<string, unknown>): void {
    const graphId = readString(record, 'graphId');
    const round = record.record as PGRoundRecord;
    this.rounds.push({ graphId, record: clone(round) });
  }

  private applyRejection(record: Record<string, unknown>): void {
    const graphId = readString(record, 'graphId');
    const rejection = record.record as PGRejectionRecord;
    this.rejections.push({ graphId, record: clone(rejection) });
    this.noteTimestamp(rejection.recordedAt);
  }

  private nextTimestamp(): string {
    let ts = new Date().toISOString();
    if (this.lastTimestamp !== '' && ts <= this.lastTimestamp) {
      ts = new Date(Date.parse(this.lastTimestamp) + 1).toISOString();
    }
    this.lastTimestamp = ts;
    return ts;
  }

  private noteTimestamp(ts: string): void {
    if (ts > this.lastTimestamp) {
      this.lastTimestamp = ts;
    }
  }
}

function revisionKey(graphId: string, revisionId: string): string {
  return `${graphId}\u0000${revisionId}`;
}

function evaluationKey(graphId: string, revisionId: string, fingerprint: string): string {
  return `${graphId}\u0000${revisionId}\u0000${fingerprint}`;
}

function toRevisionListItem(stored: StoredRevision): PGRevisionListItem {
  const item: PGRevisionListItem = {
    revisionId: stored.snapshot.revisionId,
    graphDigest: stored.graphDigest,
    createdAt: stored.createdAt,
  };
  if (stored.snapshot.parentRevisionId !== undefined) {
    item.parentRevisionId = stored.snapshot.parentRevisionId;
  }
  return item;
}

function compareRevisionNewestFirst(a: PGRevisionListItem, b: PGRevisionListItem): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.revisionId < b.revisionId ? 1 : a.revisionId > b.revisionId ? -1 : 0;
}

function paginate<T>(items: T[], page: { offset: number; limit: number }): { items: T[]; total: number } {
  const offset = Math.max(0, page.offset);
  const limit = Math.max(0, page.limit);
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`PG JSONL record missing string field '${key}'`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`PG JSONL record missing number field '${key}'`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`PG JSONL record field '${key}' must be string or null`);
  }
  return value;
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`PG JSONL record field '${key}' must be number or null`);
  }
  return value;
}
