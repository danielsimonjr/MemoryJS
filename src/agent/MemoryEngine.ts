import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { IGraphStorage, ReadonlyKnowledgeGraph } from '../types/types.js';
import type { AgentEntity } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { EpisodicMemoryManager } from './EpisodicMemoryManager.js';
import type { WorkingMemoryManager } from './WorkingMemoryManager.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { EmbeddingService } from '../types/index.js';
import type { ImportanceScorer } from './ImportanceScorer.js';
import type { ExclusionManager } from './ExclusionManager.js';

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
  /**
   * Optional `ExclusionManager` (Phase 3 `do_not_remember`). When
   * supplied, `addTurn` consults `exclusionManager.check(content)` and
   * returns a `blocked` result instead of writing if a rule matches.
   * Omit to disable the write-block path entirely (preserves prior
   * v2.0.x behavior).
   */
  exclusionManager?: ExclusionManager;
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

/**
 * Result of `addTurn`. `entity` is `undefined` when `blocked === true`
 * (the write never happened); narrow on `!blocked` before accessing it.
 *
 * **v2.0.x change**: `entity` became optional in v2.0.x to support the
 * Phase 3 `do_not_remember` write-block path. Callers should narrow on
 * `result.blocked` (or `result.entity != null`) before dereferencing
 * fields that only exist on the success path.
 */
export interface AddTurnResult {
  /** Created or matched entity. Absent when `blocked === true`. */
  entity?: AgentEntity;
  duplicateDetected: boolean;
  duplicateOf?: string;
  duplicateTier?: DedupTier;
  importanceScore: number;
  /** Set to `true` when an `ExclusionRule` matched the write attempt. */
  blocked?: boolean;
  /** Id of the matching rule (when `blocked === true`). */
  blockedByRuleId?: string;
  /** Free-text reason copied from the rule. */
  blockedReason?: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  match?: AgentEntity;
  tier?: DedupTier;
}

export type MemoryEngineEventName =
  | 'memoryEngine:turnAdded'
  | 'memoryEngine:duplicateDetected'
  | 'memoryEngine:writeBlocked'
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
  exclusionManager: ExclusionManager | undefined;
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
      exclusionManager: config.exclusionManager,
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
    // Exclusion check runs BEFORE dedup: don't waste cycles on content
    // the user said never to write. Skips entirely when no
    // ExclusionManager is wired (preserves v2.0.x behavior).
    if (this.deps.exclusionManager) {
      const verdict = await this.deps.exclusionManager.check(content);
      if (verdict.blocked) {
        this.events.emit('memoryEngine:writeBlocked', {
          attemptedContent: content,
          sessionId: options.sessionId,
          role: options.role,
          ruleId: verdict.ruleId,
          reason: verdict.reason,
        });
        return {
          duplicateDetected: false,
          importanceScore: 0,
          blocked: true,
          blockedByRuleId: verdict.ruleId,
          blockedReason: verdict.reason,
        };
      }
    }

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
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- contentHash decorates an entity created microtasks earlier; the returned `enriched` value still carries the hash
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
    sessionId: string,
    options: { limit?: number; role?: 'user' | 'assistant' | 'system' } = {},
  ): Promise<AgentEntity[]> {
    const graph = await this.deps.storage.loadGraph();
    let turns = graph.entities.filter(
      (e) => (e as AgentEntity).sessionId === sessionId,
    ) as AgentEntity[];

    // Chronological order (oldest first) — natural transcript order, and
    // makes `limit` deterministic across storage backends.
    turns.sort((a, b) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aT - bT;
    });

    if (options.role) {
      const prefix = `[role=${options.role}]`;
      turns = turns.filter((e) => (e.observations[0] ?? '').startsWith(prefix));
    }

    if (typeof options.limit === 'number') {
      turns = turns.slice(0, options.limit);
    }

    return turns;
  }

  async checkDuplicate(content: string, sessionId: string): Promise<DuplicateCheckResult> {
    // Load the graph snapshot once and share it across every tier check.
    const graph = await this.deps.storage.loadGraph();
    if (this.cfg.semanticDedupEnabled && this.deps.semanticSearch) {
      const ts = await this.checkTierSemantic(content, sessionId, graph);
      if (ts.isDuplicate) return ts;
    }
    const t1 = await this.checkTierExact(content, sessionId, graph);
    if (t1.isDuplicate) return t1;
    const recent = await this.getRecentSessionEntities(sessionId, this.cfg.dedupScanWindow, graph);
    const t2 = this.checkTierPrefix(content, recent);
    if (t2.isDuplicate) return t2;
    const t3 = this.checkTierJaccard(content, recent);
    if (t3.isDuplicate) return t3;
    return { isDuplicate: false };
  }

  private async checkTierSemantic(
    content: string,
    sessionId: string,
    graph?: ReadonlyKnowledgeGraph,
  ): Promise<DuplicateCheckResult> {
    if (!this.deps.semanticSearch) return { isDuplicate: false };
    graph ??= await this.deps.storage.loadGraph();
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

  private async checkTierExact(
    content: string,
    sessionId: string,
    graph?: ReadonlyKnowledgeGraph,
  ): Promise<DuplicateCheckResult> {
    const hash = this.computeContentHash(content);
    graph ??= await this.deps.storage.loadGraph();
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
    graph?: ReadonlyKnowledgeGraph,
  ): Promise<AgentEntity[]> {
    graph ??= await this.deps.storage.loadGraph();
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

  async deleteSession(sessionId: string): Promise<{ deleted: number }> {
    const turns = await this.getSessionTurns(sessionId);
    if (turns.length === 0) return { deleted: 0 };

    const names = turns.map((t) => t.name);
    await this.deps.entityManager.deleteEntities(names);
    this.events.emit('memoryEngine:sessionDeleted', {
      sessionId,
      deletedCount: names.length,
    });
    return { deleted: names.length };
  }

  async listSessions(): Promise<string[]> {
    const graph = await this.deps.storage.loadGraph();
    const sessions = new Set<string>();
    for (const e of graph.entities) {
      const s = (e as AgentEntity).sessionId;
      if (s) sessions.add(s);
    }
    return Array.from(sessions);
  }
}

interface HasStoreEmbedding {
  storeEmbedding: (entityName: string, vector: number[], model: string) => void;
}

function hasStoreEmbedding(storage: unknown): storage is HasStoreEmbedding {
  return typeof (storage as HasStoreEmbedding | null)?.storeEmbedding === 'function';
}
