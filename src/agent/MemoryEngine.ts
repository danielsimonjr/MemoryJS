import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { EpisodicMemoryManager } from './EpisodicMemoryManager.js';
import type { WorkingMemoryManager } from './WorkingMemoryManager.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { EmbeddingService } from '../types/index.js';
import type { ImportanceScorer } from './ImportanceScorer.js';

export interface MemoryEngineConfig {
  jaccardThreshold?: number;
  prefixOverlapThreshold?: number;
  dedupScanWindow?: number;
  maxTurnsPerSession?: number;
  semanticDedupEnabled?: boolean;
  semanticThreshold?: number;
  recentTurnsForImportance?: number;
}

export interface AddTurnOptions {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  agentId?: string;
  projectId?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  queryContext?: string;
  recentTurns?: string[];
}

export type DedupTier = 'exact' | 'prefix' | 'jaccard' | 'semantic';

export interface AddTurnResult {
  entity: AgentEntity;
  duplicateDetected: boolean;
  duplicateOf?: string;
  duplicateTier?: DedupTier;
  importanceScore: number;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  match?: AgentEntity;
  tier?: DedupTier;
}

export type MemoryEngineEventName =
  | 'memoryEngine:turnAdded'
  | 'memoryEngine:duplicateDetected'
  | 'memoryEngine:sessionDeleted';

/** Resolved configuration with all defaults applied. Used in T5–T10. */
interface ResolvedConfig {
  jaccardThreshold: number;
  prefixOverlapThreshold: number;
  dedupScanWindow: number;
  maxTurnsPerSession: number;
  semanticDedupEnabled: boolean;
  semanticThreshold: number;
  recentTurnsForImportance: number;
}

/** Injected dependencies bundle. Used in T5–T10. */
interface Deps {
  storage: IGraphStorage;
  entityManager: EntityManager;
  episodicMemory: EpisodicMemoryManager;
  workingMemory: WorkingMemoryManager;
  importanceScorer: ImportanceScorer;
  semanticSearch: SemanticSearch | null | undefined;
  embeddingService: EmbeddingService | null | undefined;
}

export class MemoryEngine {
  public readonly events = new EventEmitter();

  /** Dependencies bundle — populated in constructor, consumed in T5–T10. */
  protected readonly deps: Deps;

  /** Resolved config — populated in constructor, consumed in T5–T10. */
  protected readonly cfg: ResolvedConfig;

  constructor(
    storage: IGraphStorage,
    entityManager: EntityManager,
    episodicMemory: EpisodicMemoryManager,
    workingMemory: WorkingMemoryManager,
    importanceScorer: ImportanceScorer,
    semanticSearch?: SemanticSearch | null,
    embeddingService?: EmbeddingService | null,
    config: MemoryEngineConfig = {},
  ) {
    if (config.semanticDedupEnabled && !semanticSearch) {
      throw new TypeError(
        'MemoryEngine: semanticDedupEnabled=true requires a SemanticSearch instance',
      );
    }
    this.deps = {
      storage,
      entityManager,
      episodicMemory,
      workingMemory,
      importanceScorer,
      semanticSearch,
      embeddingService,
    };
    this.cfg = {
      jaccardThreshold: config.jaccardThreshold ?? 0.72,
      prefixOverlapThreshold: config.prefixOverlapThreshold ?? 0.5,
      dedupScanWindow: config.dedupScanWindow ?? 200,
      maxTurnsPerSession: config.maxTurnsPerSession ?? 1000,
      semanticDedupEnabled: config.semanticDedupEnabled ?? false,
      semanticThreshold: config.semanticThreshold ?? 0.92,
      recentTurnsForImportance: config.recentTurnsForImportance ?? 10,
    };
  }

  async addTurn(_content: string, _options: AddTurnOptions): Promise<AddTurnResult> {
    throw new Error('Not implemented — Task 9');
  }

  async getSessionTurns(
    _sessionId: string,
    _options?: { limit?: number; role?: 'user' | 'assistant' | 'system' },
  ): Promise<AgentEntity[]> {
    throw new Error('Not implemented — Task 10');
  }

  async checkDuplicate(content: string, sessionId: string): Promise<DuplicateCheckResult> {
    const t1 = await this.checkTierExact(content, sessionId);
    if (t1.isDuplicate) return t1;
    return { isDuplicate: false };
  }

  private computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async checkTierExact(content: string, sessionId: string): Promise<DuplicateCheckResult> {
    const hash = this.computeContentHash(content);
    const graph = await this.deps.storage.loadGraph();
    const candidates = graph.entities.filter(
      (e) => (e as AgentEntity).contentHash === hash,
    ) as AgentEntity[];
    const match = candidates.find((e) => e.sessionId === sessionId);
    if (match) return { isDuplicate: true, match, tier: 'exact' };
    return { isDuplicate: false };
  }

  async deleteSession(_sessionId: string): Promise<{ deleted: number }> {
    throw new Error('Not implemented — Task 10');
  }

  async listSessions(): Promise<string[]> {
    throw new Error('Not implemented — Task 10');
  }
}
