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

const ROLE_PREFIX_RE = /^\[role=[a-z]+\]\s*/i;

function stripRolePrefix(text: string): string {
  return text.replace(ROLE_PREFIX_RE, '');
}

function longestCommonPrefix(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return a.slice(0, i);
}

function tokeniseForDedup(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

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

  async addTurn(content: string, options: AddTurnOptions): Promise<AddTurnResult> {
    const dup = await this.checkDuplicate(content, options.sessionId);
    if (dup.isDuplicate && dup.match) {
      this.events.emit('memoryEngine:duplicateDetected', {
        existingEntity: dup.match,
        attemptedContent: content,
        sessionId: options.sessionId,
        tier: dup.tier,
      });
      return {
        entity: dup.match,
        duplicateDetected: true,
        duplicateOf: dup.match.name,
        duplicateTier: dup.tier,
        importanceScore: dup.match.importance ?? 0,
      };
    }

    let importance: number;
    if (typeof options.importance === 'number') {
      importance = options.importance;
    } else {
      const recentTurns =
        options.recentTurns ??
        (await this.loadRecentTurnsForImportance(options.sessionId));
      importance = this.deps.importanceScorer.score(content, {
        queryContext: options.queryContext,
        recentTurns,
      });
    }

    const observation = `[role=${options.role}] ${content}`;
    const entity = await this.deps.episodicMemory.createEpisode(observation, {
      sessionId: options.sessionId,
      agentId: options.agentId,
      importance,
    });

    const hash = this.computeContentHash(content);
    await this.deps.storage.updateEntity(entity.name, { contentHash: hash });
    const enriched: AgentEntity = { ...entity, contentHash: hash };

    if (this.deps.embeddingService && hasStoreEmbedding(this.deps.storage)) {
      try {
        const vector = await this.deps.embeddingService.embed(content);
        const model =
          (this.deps.embeddingService as { getModelName?: () => string }).getModelName?.() ??
          'unknown';
        this.deps.storage.storeEmbedding(entity.name, vector, model);
      } catch {
        // Embedding is best-effort; failure does not abort the write.
      }
    }

    this.events.emit('memoryEngine:turnAdded', {
      entity: enriched,
      sessionId: options.sessionId,
      role: options.role,
      importance,
    });

    return { entity: enriched, duplicateDetected: false, importanceScore: importance };
  }

  private async loadRecentTurnsForImportance(sessionId: string): Promise<string[]> {
    const recent = await this.getRecentSessionEntities(
      sessionId,
      this.cfg.recentTurnsForImportance,
    );
    return recent.map((e) => stripRolePrefix(e.observations[0] ?? ''));
  }

  async getSessionTurns(
    _sessionId: string,
    _options?: { limit?: number; role?: 'user' | 'assistant' | 'system' },
  ): Promise<AgentEntity[]> {
    throw new Error('Not implemented — Task 10');
  }

  async checkDuplicate(content: string, sessionId: string): Promise<DuplicateCheckResult> {
    if (this.cfg.semanticDedupEnabled && this.deps.semanticSearch) {
      const ts = await this.checkTierSemantic(content, sessionId);
      if (ts.isDuplicate) return ts;
    }
    const t1 = await this.checkTierExact(content, sessionId);
    if (t1.isDuplicate) return t1;
    const recent = await this.getRecentSessionEntities(sessionId, this.cfg.dedupScanWindow);
    const t2 = this.checkTierPrefix(content, recent);
    if (t2.isDuplicate) return t2;
    const t3 = this.checkTierJaccard(content, recent);
    if (t3.isDuplicate) return t3;
    return { isDuplicate: false };
  }

  private async checkTierSemantic(content: string, sessionId: string): Promise<DuplicateCheckResult> {
    if (!this.deps.semanticSearch) return { isDuplicate: false };
    const graph = await this.deps.storage.loadGraph();
    const results = await this.deps.semanticSearch.search(graph, content, 5, this.cfg.semanticThreshold);
    for (const hit of results) {
      if (hit.similarity < this.cfg.semanticThreshold) continue;
      const candidate = hit.entity as AgentEntity;
      if (candidate.sessionId === sessionId) {
        return { isDuplicate: true, match: candidate, tier: 'semantic' };
      }
    }
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

  private async getRecentSessionEntities(
    sessionId: string,
    windowSize: number,
  ): Promise<AgentEntity[]> {
    const graph = await this.deps.storage.loadGraph();
    const sessionEntities = graph.entities.filter(
      (e) => (e as AgentEntity).sessionId === sessionId,
    ) as AgentEntity[];
    sessionEntities.sort((a, b) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bT - aT;
    });
    return sessionEntities.slice(0, windowSize);
  }

  private checkTierPrefix(content: string, candidates: AgentEntity[]): DuplicateCheckResult {
    for (const candidate of candidates) {
      const candidateContent = stripRolePrefix(candidate.observations[0] ?? '');
      const shared = longestCommonPrefix(content, candidateContent);
      const ratio = shared.length / Math.max(content.length, candidateContent.length);
      if (ratio >= this.cfg.prefixOverlapThreshold) {
        return { isDuplicate: true, match: candidate, tier: 'prefix' };
      }
    }
    return { isDuplicate: false };
  }

  private checkTierJaccard(content: string, candidates: AgentEntity[]): DuplicateCheckResult {
    const contentTokens = tokeniseForDedup(content);
    if (contentTokens.size === 0) return { isDuplicate: false };

    for (const candidate of candidates) {
      const candidateContent = stripRolePrefix(candidate.observations[0] ?? '');
      const candidateTokens = tokeniseForDedup(candidateContent);
      if (candidateTokens.size === 0) continue;

      let intersection = 0;
      for (const token of contentTokens) {
        if (candidateTokens.has(token)) intersection += 1;
      }
      const union = contentTokens.size + candidateTokens.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;
      if (jaccard >= this.cfg.jaccardThreshold) {
        return { isDuplicate: true, match: candidate, tier: 'jaccard' };
      }
    }
    return { isDuplicate: false };
  }

  async deleteSession(_sessionId: string): Promise<{ deleted: number }> {
    throw new Error('Not implemented — Task 10');
  }

  async listSessions(): Promise<string[]> {
    throw new Error('Not implemented — Task 10');
  }
}

interface HasStoreEmbedding {
  storeEmbedding: (entityName: string, vector: number[], model: string) => void;
}

function hasStoreEmbedding(storage: unknown): storage is HasStoreEmbedding {
  return typeof (storage as HasStoreEmbedding | null)?.storeEmbedding === 'function';
}
