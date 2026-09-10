/**
 * Mutex-serialized wrapper over {@link ProceduralGraphState} used by the
 * in-memory and JSONL backings.
 *
 * @module agent/procedural/graph/backing/LockedProceduralGraphBacking
 * @internal
 */

import type {
  PGEvaluationReport,
  PGHead,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../../types/proceduralGraph.js';
import { AsyncMutex } from '../../../../utils/AsyncMutex.js';
import type {
  IProceduralGraphBacking,
  PGCommitInput,
  PGCommitResult,
} from './IProceduralGraphBacking.js';
import type { ProceduralGraphState } from './ProceduralGraphState.js';

export abstract class LockedProceduralGraphBacking implements IProceduralGraphBacking {
  abstract readonly kind: 'jsonl' | 'memory';
  private readonly mutex = new AsyncMutex();

  protected constructor(protected readonly state: ProceduralGraphState) {}

  /** Persist after a mutating operation. Memory backing is a no-op. */
  protected abstract afterWrite(): Promise<void>;

  async createGraph(revision: PGSnapshot): Promise<PGHead> {
    return this.withLock(async () => {
      const head = this.state.createGraph(revision);
      await this.afterWrite();
      return head;
    });
  }

  async loadHead(graphId: string): Promise<PGHead | undefined> {
    return this.withLock(() => this.state.loadHead(graphId));
  }

  async loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined> {
    return this.withLock(() => this.state.loadRevision(graphId, revisionId));
  }

  async listRevisions(
    graphId: string,
    page: { offset: number; limit: number },
  ): ReturnType<IProceduralGraphBacking['listRevisions']> {
    return this.withLock(() => this.state.listRevisions(graphId, page));
  }

  async commitRetainedRevision(input: PGCommitInput): Promise<PGCommitResult> {
    return this.withLock(async () => {
      const result = this.state.commitRetainedRevision(input);
      if (result.status === 'committed') {
        await this.afterWrite();
      }
      return result;
    });
  }

  async setHead(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
    round: PGRoundRecord,
  ): Promise<PGCommitResult> {
    return this.withLock(async () => {
      const result = this.state.setHead(graphId, revisionId, expectedHeadVersion, round);
      if (result.status === 'committed') {
        await this.afterWrite();
      }
      return result;
    });
  }

  async saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): Promise<void> {
    return this.withLock(async () => {
      this.state.saveEvaluation(graphId, revisionId, report);
      await this.afterWrite();
    });
  }

  async loadEvaluation(
    graphId: string,
    revisionId: string,
    fingerprint: string,
  ): Promise<PGEvaluationReport | undefined> {
    return this.withLock(() => this.state.loadEvaluation(graphId, revisionId, fingerprint));
  }

  async appendRejection(record: PGRejectionRecord): Promise<void> {
    return this.withLock(async () => {
      this.state.appendRejection(record);
      await this.afterWrite();
    });
  }

  async listRejections(
    graphId: string,
    page: { offset: number; limit: number },
  ): ReturnType<IProceduralGraphBacking['listRejections']> {
    return this.withLock(() => this.state.listRejections(graphId, page));
  }

  async appendRound(graphId: string, round: PGRoundRecord): Promise<void> {
    return this.withLock(async () => {
      this.state.appendRound(graphId, round);
      await this.afterWrite();
    });
  }

  async close(): Promise<void> {
    // State lives in memory; durable backings already flushed on write.
  }

  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.mutex.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
