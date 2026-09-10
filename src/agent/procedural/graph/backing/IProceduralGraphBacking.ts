/**
 * Procedural Graph backing contract and factory (Section 4.7).
 *
 * `createProceduralGraphBacking` constructs the requested backend directly
 * and never consults `MEMORY_STORAGE_TYPE` (A2).
 *
 * @module agent/procedural/graph/backing/IProceduralGraphBacking
 * @experimental
 */

import type {
  PGEvaluationReport,
  PGHead,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../../types/proceduralGraph.js';
import { InMemoryProceduralGraphBacking } from './InMemoryProceduralGraphBacking.js';
import { JsonlProceduralGraphBacking } from './JsonlProceduralGraphBacking.js';
import { SqliteProceduralGraphBacking } from './SqliteProceduralGraphBacking.js';

export interface PGCommitInput {
  expectedHeadVersion: number;
  revision: PGSnapshot;
  validation: PGEvaluationReport;
  round: PGRoundRecord;
}

export type PGCommitResult =
  | { status: 'committed'; head: PGHead }
  | { status: 'conflict'; currentHead: PGHead | undefined };

export interface IProceduralGraphBacking {
  readonly kind: 'jsonl' | 'sqlite' | 'memory';
  createGraph(revision: PGSnapshot): Promise<PGHead>;
  loadHead(graphId: string): Promise<PGHead | undefined>;
  loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined>;
  listRevisions(graphId: string, page: { offset: number; limit: number }): Promise<{
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
  listRejections(graphId: string, page: { offset: number; limit: number }): Promise<{
    items: PGRejectionRecord[];
    total: number;
  }>;
  appendRound(graphId: string, round: PGRoundRecord): Promise<void>;
  close(): Promise<void>;
}

/**
 * Construct the requested PG backing. The `type` field is authoritative —
 * this function does not read `MEMORY_STORAGE_TYPE`.
 */
export async function createProceduralGraphBacking(
  config: { type: 'jsonl' | 'sqlite' | 'memory'; path?: string },
): Promise<IProceduralGraphBacking> {
  switch (config.type) {
    case 'memory':
      return new InMemoryProceduralGraphBacking();
    case 'jsonl': {
      if (config.path === undefined || config.path === '') {
        throw new Error('path is required for jsonl procedural graph backing');
      }
      return JsonlProceduralGraphBacking.open(config.path);
    }
    case 'sqlite': {
      if (config.path === undefined || config.path === '') {
        throw new Error('path is required for sqlite procedural graph backing');
      }
      return SqliteProceduralGraphBacking.open(config.path);
    }
    default: {
      const _never: never = config.type;
      throw new Error(`unsupported procedural graph backing type: ${String(_never)}`);
    }
  }
}
