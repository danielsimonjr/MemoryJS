/**
 * SQLite procedural-graph backing.
 *
 * Owns dedicated `pg_*` tables (not `entities`/`relations`). Publication of a
 * retained revision is one `db.transaction` whose head predicate is
 * `UPDATE pg_heads ... WHERE graph_id=? AND head_version=?` with `changes === 1`.
 *
 * Driver selection goes through `resolveSQLiteDatabaseCtor()` so both
 * `better-sqlite3` and `node:sqlite` are honored (A4, A12).
 *
 * @module agent/procedural/graph/backing/SqliteProceduralGraphBacking
 * @experimental
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveSQLiteDatabaseCtor, resolveSQLiteSynchronousMode } from '../../../../core/SQLiteStorage.js';
import type {
  PGEvaluationReport,
  PGHead,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../../types/proceduralGraph.js';
import { graphDigest, storageKey } from '../canonical.js';
import type {
  IProceduralGraphBacking,
  PGCommitInput,
  PGCommitResult,
} from './IProceduralGraphBacking.js';
import { graphExistsError } from './ProceduralGraphState.js';

/** better-sqlite3 / node:sqlite statement surface used by this backing. */
interface AdaptedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Subset of the adapted database API this backing is allowed to call. */
interface AdaptedDatabase {
  exec(sql: string): void;
  prepare(sql: string): AdaptedStatement;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

interface HeadRow {
  graph_id: string;
  revision_id: string;
  head_version: number;
  graph_digest: string;
  validation_mean: number | null;
  evaluation_fingerprint: string | null;
  validation_report_ref: string | null;
  updated_at: string;
}

interface RevisionRow {
  revision_id: string;
  parent_revision_id: string | null;
  graph_digest: string;
  created_at: string;
  snapshot_json: string;
}

interface EvaluationRow {
  report_json: string;
}

interface RejectionRow {
  record_json: string;
}

class HeadConflictError extends Error {
  constructor() {
    super('pg-head-conflict');
    this.name = 'HeadConflictError';
  }
}

export class SqliteProceduralGraphBacking implements IProceduralGraphBacking {
  readonly kind = 'sqlite' as const;
  private closed = false;
  private lastTimestamp = '';
  /**
   * Prepared-statement cache keyed by SQL text. Neither driver caches
   * statements itself, and every method here runs a fixed set of queries,
   * so preparing once per connection removes a parse from every call.
   */
  private readonly statements = new Map<string, AdaptedStatement>();

  private constructor(private readonly db: AdaptedDatabase) {}

  static async open(dbPath: string): Promise<SqliteProceduralGraphBacking> {
    await mkdir(dirname(dbPath), { recursive: true });
    const Ctor = resolveSQLiteDatabaseCtor();
    const db = new Ctor(dbPath) as unknown as AdaptedDatabase;
    db.pragma('journal_mode = WAL');
    // Same durability knob as the primary backend (MEMORY_SQLITE_SYNCHRONOUS).
    db.pragma(`synchronous = ${resolveSQLiteSynchronousMode()}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pg_heads (
        graph_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        head_version INTEGER NOT NULL,
        graph_digest TEXT NOT NULL,
        validation_mean REAL,
        evaluation_fingerprint TEXT,
        validation_report_ref TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pg_revisions (
        graph_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        parent_revision_id TEXT,
        graph_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (graph_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS pg_evaluations (
        graph_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        report_json TEXT NOT NULL,
        PRIMARY KEY (graph_id, revision_id, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS pg_rounds (
        id INTEGER PRIMARY KEY,
        graph_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pg_rejections (
        id INTEGER PRIMARY KEY,
        graph_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pg_rejections_graph_recorded
        ON pg_rejections(graph_id, recorded_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_pg_rounds_graph ON pg_rounds(graph_id);
      CREATE INDEX IF NOT EXISTS idx_pg_revisions_graph_created
        ON pg_revisions(graph_id, created_at DESC, revision_id DESC);
    `);
    return new SqliteProceduralGraphBacking(db);
  }

  /** Prepare once per connection; see {@link statements}. */
  private stmt(sql: string): AdaptedStatement {
    let prepared = this.statements.get(sql);
    if (prepared === undefined) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  async createGraph(revision: PGSnapshot): Promise<PGHead> {
    this.assertOpen();
    const graphId = revision.graphId;
    const createdAt = this.nextTimestamp();
    this.db.transaction(() => {
      if (this.readHeadRow(graphId) !== undefined) {
        throw graphExistsError(graphId);
      }
      const snapshotJson = JSON.stringify(revision);
      const digest = graphDigest(revision);
      this.stmt(`
        INSERT INTO pg_revisions (
          graph_id, revision_id, parent_revision_id, graph_digest, created_at, snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        graphId,
        revision.revisionId,
        revision.parentRevisionId ?? null,
        digest,
        createdAt,
        snapshotJson,
      );
      this.stmt(`
        INSERT INTO pg_heads (
          graph_id, revision_id, head_version, graph_digest,
          validation_mean, evaluation_fingerprint, validation_report_ref, updated_at
        ) VALUES (?, ?, 1, ?, NULL, NULL, NULL, ?)
      `).run(graphId, revision.revisionId, digest, createdAt);
    })();
    return this.readHead(graphId)!;
  }

  async loadHead(graphId: string): Promise<PGHead | undefined> {
    this.assertOpen();
    return this.readHead(graphId);
  }

  async loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined> {
    this.assertOpen();
    const row = this.stmt(
      'SELECT snapshot_json FROM pg_revisions WHERE graph_id = ? AND revision_id = ?',
    ).get(graphId, revisionId) as { snapshot_json: string } | undefined;
    if (row === undefined) return undefined;
    return JSON.parse(row.snapshot_json) as PGSnapshot;
  }

  async listRevisions(
    graphId: string,
    page: { offset: number; limit: number },
  ): ReturnType<IProceduralGraphBacking['listRevisions']> {
    this.assertOpen();
    const total = this.count('SELECT COUNT(*) AS total FROM pg_revisions WHERE graph_id = ?', graphId);
    const rows = this.stmt(`
      SELECT revision_id, parent_revision_id, graph_digest, created_at
      FROM pg_revisions
      WHERE graph_id = ?
      ORDER BY created_at DESC, revision_id DESC
      LIMIT ? OFFSET ?
    `).all(graphId, Math.max(0, page.limit), Math.max(0, page.offset)) as RevisionRow[];
    return {
      total,
      items: rows.map((row) => {
        const item: {
          revisionId: string;
          parentRevisionId?: string;
          graphDigest: string;
          createdAt: string;
        } = {
          revisionId: row.revision_id,
          graphDigest: row.graph_digest,
          createdAt: row.created_at,
        };
        if (row.parent_revision_id !== null && row.parent_revision_id !== undefined) {
          item.parentRevisionId = row.parent_revision_id;
        }
        return item;
      }),
    };
  }

  async commitRetainedRevision(input: PGCommitInput): Promise<PGCommitResult> {
    this.assertOpen();
    const graphId = input.revision.graphId;
    const createdAt = this.nextTimestamp();
    try {
      this.db.transaction(() => {
        const snapshotJson = JSON.stringify(input.revision);
        const reportJson = JSON.stringify(input.validation);
        const recordJson = JSON.stringify(input.round);
        const digest = graphDigest(input.revision);
        this.stmt(`
          INSERT INTO pg_revisions (
            graph_id, revision_id, parent_revision_id, graph_digest, created_at, snapshot_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          graphId,
          input.revision.revisionId,
          input.revision.parentRevisionId ?? null,
          digest,
          createdAt,
          snapshotJson,
        );
        this.upsertEvaluation(graphId, input.revision.revisionId, input.validation.fingerprint, reportJson);
        this.insertRound(graphId, input.round, recordJson);
        const reportRef = storageKey('evaluation', [
          graphId,
          input.revision.revisionId,
          input.validation.fingerprint,
        ]);
        this.bumpHead({
          graphId,
          revisionId: input.revision.revisionId,
          expectedHeadVersion: input.expectedHeadVersion,
          graphDigest: digest,
          validationMean: input.validation.meanScore,
          evaluationFingerprint: input.validation.fingerprint,
          validationReportRef: reportRef,
          updatedAt: createdAt,
        });
      })();
    } catch (error) {
      if (error instanceof HeadConflictError) {
        return { status: 'conflict', currentHead: this.readHead(graphId) };
      }
      throw error;
    }
    return { status: 'committed', head: this.readHead(graphId)! };
  }

  async setHead(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
    round: PGRoundRecord,
  ): Promise<PGCommitResult> {
    this.assertOpen();
    const updatedAt = this.nextTimestamp();
    try {
      this.db.transaction(() => {
        const revision = this.stmt(
          'SELECT graph_digest FROM pg_revisions WHERE graph_id = ? AND revision_id = ?',
        ).get(graphId, revisionId) as { graph_digest: string } | undefined;
        if (revision === undefined) {
          throw new HeadConflictError();
        }
        const evaluation = this.latestEvaluation(graphId, revisionId);
        const recordJson = JSON.stringify(round);
        this.insertRound(graphId, round, recordJson);
        this.bumpHead({
          graphId,
          revisionId,
          expectedHeadVersion,
          graphDigest: revision.graph_digest,
          validationMean: evaluation?.meanScore ?? null,
          evaluationFingerprint: evaluation?.fingerprint ?? null,
          validationReportRef: evaluation === undefined
            ? null
            : storageKey('evaluation', [graphId, revisionId, evaluation.fingerprint]),
          updatedAt,
        });
      })();
    } catch (error) {
      if (error instanceof HeadConflictError) {
        return { status: 'conflict', currentHead: this.readHead(graphId) };
      }
      throw error;
    }
    return { status: 'committed', head: this.readHead(graphId)! };
  }

  async saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): Promise<void> {
    this.assertOpen();
    const reportJson = JSON.stringify(report);
    this.upsertEvaluation(graphId, revisionId, report.fingerprint, reportJson);
  }

  async loadEvaluation(
    graphId: string,
    revisionId: string,
    fingerprint: string,
  ): Promise<PGEvaluationReport | undefined> {
    this.assertOpen();
    const row = this.stmt(
      'SELECT report_json FROM pg_evaluations WHERE graph_id = ? AND revision_id = ? AND fingerprint = ?',
    ).get(graphId, revisionId, fingerprint) as EvaluationRow | undefined;
    if (row === undefined) return undefined;
    return JSON.parse(row.report_json) as PGEvaluationReport;
  }

  async appendRejection(record: PGRejectionRecord): Promise<void> {
    this.assertOpen();
    const graphId = record.graphId ?? this.resolveRejectionGraphId(record);
    const recordJson = JSON.stringify(record);
    this.stmt(
      'INSERT INTO pg_rejections (graph_id, record_json, recorded_at) VALUES (?, ?, ?)',
    ).run(graphId, recordJson, record.recordedAt);
  }

  async listRejections(
    graphId: string,
    page: { offset: number; limit: number },
  ): ReturnType<IProceduralGraphBacking['listRejections']> {
    this.assertOpen();
    const total = this.count('SELECT COUNT(*) AS total FROM pg_rejections WHERE graph_id = ?', graphId);
    const rows = this.stmt(`
      SELECT record_json FROM pg_rejections
      WHERE graph_id = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(graphId, Math.max(0, page.limit), Math.max(0, page.offset)) as RejectionRow[];
    return {
      total,
      items: rows.map((row) => JSON.parse(row.record_json) as PGRejectionRecord),
    };
  }

  async appendRound(graphId: string, round: PGRoundRecord): Promise<void> {
    this.assertOpen();
    this.insertRound(graphId, round, JSON.stringify(round));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('SqliteProceduralGraphBacking is closed');
    }
  }

  private readHead(graphId: string): PGHead | undefined {
    const row = this.readHeadRow(graphId);
    if (row === undefined) return undefined;
    return {
      graphId: row.graph_id,
      revisionId: row.revision_id,
      headVersion: Number(row.head_version),
      graphDigest: row.graph_digest,
      validationMean: row.validation_mean ?? null,
      evaluationFingerprint: row.evaluation_fingerprint ?? null,
      validationReportRef: row.validation_report_ref ?? null,
      updatedAt: row.updated_at,
    };
  }

  private readHeadRow(graphId: string): HeadRow | undefined {
    return this.stmt('SELECT * FROM pg_heads WHERE graph_id = ?').get(graphId) as HeadRow | undefined;
  }

  private bumpHead(args: {
    graphId: string;
    revisionId: string;
    expectedHeadVersion: number;
    graphDigest: string;
    validationMean: number | null;
    evaluationFingerprint: string | null;
    validationReportRef: string | null;
    updatedAt: string;
  }): void {
    const info = this.stmt(`
      UPDATE pg_heads SET
        revision_id = ?,
        head_version = ?,
        graph_digest = ?,
        validation_mean = ?,
        evaluation_fingerprint = ?,
        validation_report_ref = ?,
        updated_at = ?
      WHERE graph_id = ? AND head_version = ?
    `).run(
      args.revisionId,
      args.expectedHeadVersion + 1,
      args.graphDigest,
      args.validationMean,
      args.evaluationFingerprint,
      args.validationReportRef,
      args.updatedAt,
      args.graphId,
      args.expectedHeadVersion,
    );
    if (info.changes !== 1) {
      throw new HeadConflictError();
    }
  }

  private upsertEvaluation(
    graphId: string,
    revisionId: string,
    fingerprint: string,
    reportJson: string,
  ): void {
    this.stmt(`
      INSERT INTO pg_evaluations (graph_id, revision_id, fingerprint, report_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(graph_id, revision_id, fingerprint) DO UPDATE SET report_json = excluded.report_json
    `).run(graphId, revisionId, fingerprint, reportJson);
  }

  private insertRound(graphId: string, round: PGRoundRecord, recordJson: string): void {
    this.stmt(
      'INSERT INTO pg_rounds (graph_id, run_id, round, record_json) VALUES (?, ?, ?, ?)',
    ).run(graphId, round.runId, round.round, recordJson);
  }

  private latestEvaluation(graphId: string, revisionId: string): PGEvaluationReport | undefined {
    const row = this.stmt(`
      SELECT report_json FROM pg_evaluations
      WHERE graph_id = ? AND revision_id = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(graphId, revisionId) as EvaluationRow | undefined;
    if (row === undefined) return undefined;
    return JSON.parse(row.report_json) as PGEvaluationReport;
  }

  private resolveRejectionGraphId(record: PGRejectionRecord): string {
    const matches = this.stmt(
      'SELECT DISTINCT graph_id FROM pg_revisions WHERE revision_id = ? ORDER BY graph_id ASC',
    ).all(record.retainedRevisionId) as Array<{ graph_id: string }>;
    if (matches.length === 1) return matches[0]!.graph_id;
    // Legacy records only (new records carry `graphId`); never guess between graphs.
    if (matches.length > 1) {
      throw new Error(
        `Rejection for revision '${record.retainedRevisionId}' matches several graphs; set record.graphId`,
      );
    }
    const heads = this.stmt('SELECT graph_id FROM pg_heads ORDER BY graph_id ASC').all() as Array<{
      graph_id: string;
    }>;
    if (heads.length === 1) return heads[0]!.graph_id;
    throw new Error('Cannot associate rejection with a graph; set record.graphId');
  }

  private count(sql: string, graphId: string): number {
    const row = this.stmt(sql).get(graphId) as { total: number | bigint };
    return typeof row.total === 'bigint' ? Number(row.total) : row.total;
  }

  private nextTimestamp(): string {
    let ts = new Date().toISOString();
    if (this.lastTimestamp !== '' && ts <= this.lastTimestamp) {
      ts = new Date(Date.parse(this.lastTimestamp) + 1).toISOString();
    }
    this.lastTimestamp = ts;
    return ts;
  }
}
