/**
 * Skill registry for Recursa (spec RS-2): storage-backed skills with lexical
 * and optional semantic matching, outcome counters and budgeted context loading.
 *
 * Each skill is an entity with `memoryType: 'skill'` and a `skillRecord`
 * payload. Writes go through `EntityManager` (`createEntities`, and
 * `updateEntity` with `expectedVersion` OCC, the HeuristicManager pattern) so
 * governance hooks and audit run. `EntityManager` takes `graphMutex` itself,
 * so the version check and the write are atomic inside it. Edits without a
 * caller version (retire, outcome counters) retry on a version conflict until it commits.
 * `add` checks the content hash before `createEntities`; two concurrent adds
 * of identical content can therefore both create (accepted: the mutex is not
 * re-entrant, and duplicates are caught by later consolidation).
 * Committed writes emit `skill:added` / `skill:updated` / `skill:retired`
 * on the storage event emitter.
 *
 * @module agent/skills/SkillManager
 * @experimental Spec RS-2. Matching weights and budget trimming may change.
 */

import { jaccard } from '../../utils/textSimilarity.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import { readEnvNumber } from '../../utils/envConfig.js';
import { ValidationError, VersionConflictError } from '../../utils/errors.js';
import { EntityManager } from '../../core/EntityManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import {
  compareSkillMatches,
  mintSkillId,
  rankSkillsLexically,
  skillDedupHash as contentHash,
  skillObservations as observationsFor,
  skillSearchableText,
  skillTokenSet,
} from './skillRecordUtils.js';
import { fitSkillSectionToBudget, renderSkillSection } from './SkillFormat.js';
import type { Entity, IGraphStorage, SkillEvent } from '../../types/types.js';
import { isSkillEntity, toIsoDateTime } from '../../types/agent-memory.js';
import type {
  SkillEntity,
  SkillId,
  SkillKind,
  SkillRecord,
  SkillResource,
  SkillSource,
} from '../../types/skills.js';

/** Input for {@link SkillManager.add}. */
export interface AddSkillInput {
  /** Human-readable name (1 to 80 characters). */ name: string;
  /** When to apply the skill. */ description: string;
  /** Kind of knowledge. */ kind: SkillKind;
  /** Applicable scope; `domains` must be non-empty. */
  scope: { domains: string[]; tasks?: string[]; tools?: string[] };
  /** Self-assessed uncertainty in [0, 1]. */ uncertainty: number;
  /** Markdown instructions. */ body: string;
  /** Bundled resources. */ resources?: SkillResource[];
  /** Provenance links. */ sources?: SkillSource[];
  /** Lineage links. */ lineage?: SkillRecord['lineage'];
  /** Unknown harness front-matter keys preserved verbatim. */ extra?: Record<string, unknown>;
  /** Owning agent. */ agentId?: string;
  /** Entity importance (default 5). */ importance?: number;
}

/** Mutable fields accepted by {@link SkillManager.update}. */
export type SkillPatch = Partial<
  Pick<SkillRecord, 'name' | 'description' | 'kind' | 'scope' | 'uncertainty' | 'body' | 'resources' | 'sources' | 'extra' | 'lineage'>
>;

/** Filters for {@link SkillManager.list}. */
export interface SkillListOptions {
  /** Only skills of this kind. */ kind?: SkillKind;
  /** Only skills whose `scope.domains` contains this domain (case-insensitive). */ domain?: string;
  /** Include retired skills (default false). */ includeRetired?: boolean;
}

/** Result of {@link SkillManager.match}. */
export interface SkillMatch {
  /** Matched skill. */ skill: SkillRecord;
  /** Score in [0, 1]; higher is better. */ score: number;
  /** Tokens shared by the hint and the skill's searchable text, sorted. */ matched: string[];
}

/** Outcome kinds recorded by {@link SkillManager.recordOutcome}. */
export type SkillOutcome = 'applied' | 'helped' | 'hurt';

/** Result of {@link SkillManager.update}. */
export type SkillUpdateResult = 'updated' | 'not-found' | 'version-conflict';

/** Result of {@link SkillManager.retire}. */
export type SkillRetireResult = 'retired' | 'not-found' | 'already-retired';

/** Result of {@link SkillManager.recordOutcome}. */
export type SkillOutcomeResult = 'updated' | 'not-found';

/** Options for {@link SkillManager.match}. */
export interface SkillMatchOptions {
  /** Maximum results (default 5). */ limit?: number;
  /** Minimum score (default 0.1). */ minScore?: number;
}

/** Options for {@link SkillManager.loadForContext}. */
export interface SkillContextOptions {
  /** Token budget for the whole Markdown block. */ budgetTokens: number;
  /** Tokens per word (default `MEMORY_CONTEXT_TOKEN_MULTIPLIER`, else 1.3). */ multiplier?: number;
}

/**
 * Minimal similarity surface used for the semantic half of `match`.
 * `SemanticSearch.calculateSimilarity` satisfies it.
 */
export interface SkillSimilarityProvider {
  /** Cosine-like similarity of two texts, expected in [0, 1]. */
  calculateSimilarity(a: string, b: string): Promise<number>;
}

/** Skill registry facade over graph storage. */
export class SkillManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private semantic: SkillSimilarityProvider | undefined;

  /**
   * Create a registry over the storage that holds the skill entities.
   *
   * @param storage - Graph storage that holds the skill entities.
   * @param entityManager - Write path (pass `ctx.entityManager` so governance
   *   hooks apply). Defaults to a plain `EntityManager` over `storage`.
   */
  constructor(storage: IGraphStorage, entityManager?: EntityManager) {
    this.storage = storage;
    this.entityManager = entityManager ?? new EntityManager(storage as GraphStorage);
  }

  /**
   * Enable the semantic half of {@link match}. Pass `undefined` to disable it again.
   *
   * @param search - Similarity provider, or `undefined`.
   */
  setSemanticSearch(search: SkillSimilarityProvider | undefined): void {
    this.semantic = search;
  }

  /**
   * Register a skill. A live (non-retired) skill whose
   * `sha256(name + '\0' + body)` matches returns its id without writing.
   *
   * @param input - Skill content.
   * @returns The new or existing skill id.
   * @throws ValidationError when the input breaks the RS-2 rules.
   */
  async add(input: AddSkillInput): Promise<SkillId> {
    const now = toIsoDateTime(new Date());
    const record: SkillRecord = {
      id: '' as SkillId,
      name: input.name,
      description: input.description,
      kind: input.kind,
      scope: normalizeScope(input.scope),
      uncertainty: input.uncertainty,
      body: input.body,
      resources: input.resources ?? [],
      sources: input.sources ?? [],
      lineage: input.lineage ?? {},
      stats: { applied: 0, helped: 0, hurt: 0 },
      ...(input.extra !== undefined ? { extra: input.extra } : {}),
      createdAt: now,
      lastUpdatedAt: now,
    };
    validateRecord(record);
    const hash = contentHash(input.name, input.body);
    const existing = await this.findByContentHash(hash);
    if (existing) return existing.skillRecord.id;
    {
      const id = mintSkillId(input.name);
      const finalRecord: SkillRecord = { ...record, id };
      const entity: SkillEntity = {
        name: id, entityType: 'skill', observations: observationsFor(finalRecord), createdAt: now, lastModified: now,
        importance: input.importance ?? 5, memoryType: 'skill', agentId: input.agentId, visibility: 'private',
        accessCount: 0, confidence: 1, confirmationCount: 0, version: 1, contentHash: hash, skillRecord: finalRecord,
      };
      await this.entityManager.createEntities([entity as unknown as Entity]);
      this.emit('skill:added', id);
      return id;
    }
  }

  /**
   * Look up a skill by id. Synchronous via the storage name index.
   *
   * @param id - Skill id (the entity name).
   * @returns The record, or `undefined` when absent.
   */
  get(id: SkillId | string): SkillRecord | undefined {
    const entity = this.storage.getEntityByName(id);
    return isSkillEntity(entity) ? entity.skillRecord : undefined;
  }

  /**
   * List skills, optionally filtered. Retired skills are excluded unless requested.
   *
   * @param options - Filters.
   * @returns Matching skill records in storage order.
   */
  async list(options: SkillListOptions = {}): Promise<SkillRecord[]> {
    const graph = await this.storage.loadGraph();
    const domain = options.domain?.toLowerCase();
    return graph.entities
      .filter(isSkillEntity)
      .map((e) => e.skillRecord)
      .filter((s) => options.includeRetired === true || s.retired === undefined)
      .filter((s) => options.kind === undefined || s.kind === options.kind)
      .filter((s) => domain === undefined || s.scope.domains.some((d) => d.toLowerCase() === domain));
  }

  /**
   * Apply a patch with optimistic concurrency. `expectedVersion` must equal
   * the live entity version; otherwise nothing is written.
   *
   * @param id - Skill id.
   * @param patch - Fields to overwrite.
   * @param options - Required `expectedVersion` read before the edit.
   * @returns `'updated'`, `'not-found'`, or `'version-conflict'`.
   * @throws ValidationError when the merged record breaks the RS-2 rules.
   */
  async update(
    id: SkillId | string,
    patch: SkillPatch,
    options: { expectedVersion: number },
  ): Promise<SkillUpdateResult> {
    return this.edit(id, options.expectedVersion, (rec) => ({
      ...rec,
      ...definedOnly(patch),
      scope: normalizeScope({ ...rec.scope, ...definedOnly(patch).scope }),
      lastUpdatedAt: toIsoDateTime(new Date()),
    })) as Promise<SkillUpdateResult>;
  }

  /**
   * Retire a skill. Retired skills are kept (never deleted) and skipped by
   * {@link match} and {@link list} unless requested.
   *
   * @param id - Skill id.
   * @param reason - Recorded reason.
   * @returns `'retired'`, `'not-found'`, or `'already-retired'`.
   */
  async retire(id: SkillId | string, reason: string): Promise<SkillRetireResult> {
    const result = await this.edit(id, undefined, (rec) => {
      if (rec.retired) return 'already-retired';
      const now = toIsoDateTime(new Date());
      return { ...rec, retired: { at: now, reason }, lastUpdatedAt: now };
    });
    if (result === 'updated') this.emit('skill:retired', id);
    return result === 'updated' ? 'retired' : (result as SkillRetireResult);
  }

  /**
   * Rank non-retired skills against a task hint. Lexical score is the Jaccard
   * of stopword-free tokens over `description + scope.domains + scope.tasks`.
   * With a semantic provider set, the score is `0.5 × lexical + 0.5 × cosine`.
   * Ties break by `helped − hurt` (descending), then by id.
   *
   * @param taskHint - Free-text description of the task.
   * @param options - `limit` and `minScore`.
   * @returns Matches sorted by score.
   */
  async match(taskHint: string, options: SkillMatchOptions = {}): Promise<SkillMatch[]> {
    const limit = Math.max(0, Math.floor(options.limit ?? 5));
    const minScore = options.minScore ?? 0.1;
    if (Number.isNaN(limit) || !Number.isFinite(minScore)) {
      throw new RangeError('match: limit must be a number and minScore a finite number');
    }
    const candidates = (await this.list()).filter((s) => s.retired === undefined);
    if (!this.semantic) return rankSkillsLexically(taskHint, candidates, { limit, minScore });
    const hintTokens = skillTokenSet(taskHint);
    if (hintTokens.size === 0) return [];
    const scored: SkillMatch[] = [];
    for (const skill of candidates) {
      const skillTokens = skillTokenSet(skillSearchableText(skill));
      const lexical = jaccard(hintTokens, skillTokens);
      // A failing provider degrades to the lexical score for this skill.
      const provider = this.semantic;
      const cosine = await Promise.resolve()
        .then(() => provider.calculateSimilarity(taskHint, skillSearchableText(skill)))
        .catch(() => undefined);
      const score = cosine !== undefined ? 0.5 * lexical + 0.5 * clamp01(cosine) : lexical;
      if (score < minScore) continue;
      const matched = [...hintTokens].filter((t) => skillTokens.has(t)).sort();
      scored.push({ skill, score, matched });
    }
    return scored.sort(compareSkillMatches).slice(0, limit);
  }

  /**
   * Increment one outcome counter. Counters are part of the record, so the
   * entity version advances.
   *
   * @param id - Skill id.
   * @param outcome - `'applied'`, `'helped'` or `'hurt'`.
   * @returns `'updated'` or `'not-found'`.
   */
  async recordOutcome(id: SkillId | string, outcome: SkillOutcome): Promise<SkillOutcomeResult> {
    const result = await this.edit(id, undefined, (rec) => ({
      ...rec,
      stats: { ...rec.stats, [outcome]: rec.stats[outcome] + 1 },
      lastUpdatedAt: toIsoDateTime(new Date()),
    }));
    return result === 'not-found' ? 'not-found' : 'updated';
  }

  /**
   * Render skills as Markdown for a solver prompt. Each skill is a `###` heading
   * plus a fenced block. Skills are added in the given order until the budget
   * is spent. The last one that does not fit is cut at a word boundary.
   * Unknown and retired ids are skipped.
   *
   * @param ids - Skill ids in priority order.
   * @param options - Token budget and multiplier.
   * @returns Markdown text (empty when nothing fits).
   * @throws RangeError when `budgetTokens` is negative or not finite.
   */
  loadForContext(ids: readonly (SkillId | string)[], options: SkillContextOptions): string {
    if (!Number.isFinite(options.budgetTokens) || options.budgetTokens < 0) {
      throw new RangeError('loadForContext: budgetTokens must be a finite number >= 0');
    }
    const multiplier = options.multiplier ?? readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3);
    const sections: string[] = [];
    let used = 0;
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const skill = this.get(id);
      if (!skill || skill.retired) continue;
      const remaining = options.budgetTokens - used;
      const full = renderSkillSection(skill, skill.body);
      const fullCost = estimateTokensFromText(full, multiplier);
      if (fullCost <= remaining) {
        sections.push(full);
        used += fullCost;
        continue;
      }
      const cut = fitSkillSectionToBudget(skill, remaining, multiplier);
      if (cut) sections.push(cut);
      break;
    }
    return sections.join('\n');
  }

  // ==================== Internal ====================

  /**
   * Apply `change` to the live record through `EntityManager.updateEntity`
   * with OCC. With a caller version, a mismatch returns `'version-conflict'`;
   * without one, the edit re-reads and retries until it commits (each conflict means another writer committed).
   */
  private async edit<R extends string>(
    id: string,
    expectedVersion: number | undefined,
    change: (rec: SkillRecord) => SkillRecord | R,
  ): Promise<R | 'updated' | 'not-found' | 'version-conflict'> {
    for (;;) {
      await this.storage.ensureLoaded();
      const entity = this.liveEntity(id);
      if (!entity) return 'not-found';
      const liveVersion = entity.version ?? 1;
      if (expectedVersion !== undefined && expectedVersion !== liveVersion) return 'version-conflict';
      const next = change(entity.skillRecord);
      if (typeof next === 'string') return next;
      validateRecord(next);
      try {
        await this.entityManager.updateEntity(id, {
          skillRecord: next,
          lastModified: next.lastUpdatedAt,
          contentHash: contentHash(next.name, next.body),
          observations: observationsFor(next),
        } as unknown as Partial<Entity>, { expectedVersion: liveVersion });
      } catch (err) {
        if (!(err instanceof VersionConflictError)) throw err;
        if (expectedVersion !== undefined) return 'version-conflict';
        continue;
      }
      if (!next.retired) this.emit('skill:updated', id);
      return 'updated';
    }
  }

  /**
   * Record the SKILL.md hash written by the last publish. Bookkeeping only:
   * a non-OCC `updateEntity`, so neither `version` nor `lastUpdatedAt` moves
   * (the published text and the OCC baseline are unchanged by it).
   *
   * @param id - Skill id.
   * @param hash - `skillContentHash` of the published text.
   * @returns `'updated'` or `'not-found'`.
   */
  async setPublishedHash(id: SkillId | string, hash: string): Promise<'updated' | 'not-found'> {
    await this.storage.ensureLoaded();
    const entity = this.liveEntity(id);
    if (!entity) return 'not-found';
    const skillRecord: SkillRecord = { ...entity.skillRecord, publishedHash: hash };
    await this.entityManager.updateEntity(id, { skillRecord } as unknown as Partial<Entity>);
    return 'updated';
  }

  private emit(type: SkillEvent['type'], skillId: string): void {
    this.storage.events?.emit({ type, skillId, timestamp: new Date().toISOString() });
  }

  private liveEntity(id: string): SkillEntity | undefined {
    const entity = this.storage.getEntityByName(id);
    return isSkillEntity(entity) ? entity : undefined;
  }

  private async findByContentHash(hash: string): Promise<SkillEntity | undefined> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isSkillEntity).find((e) => e.contentHash === hash && !e.skillRecord.retired);
  }

}

// ==================== Helpers ====================

function normalizeScope(scope: SkillRecord['scope']): SkillRecord['scope'] {
  const out: SkillRecord['scope'] = { domains: scope.domains.map((d) => d.trim()).filter((d) => d !== '') };
  if (scope.tasks !== undefined) out.tasks = scope.tasks;
  if (scope.tools !== undefined) out.tools = scope.tools;
  return out;
}

function validateRecord(record: SkillRecord): void {
  const errors: string[] = [];
  const name = record.name.trim();
  if (name === '') errors.push('name must be non-empty');
  if (record.name.length > 80) errors.push('name must be at most 80 characters');
  if (record.scope.domains.length === 0) errors.push('scope.domains must be non-empty');
  if (!Number.isFinite(record.uncertainty) || record.uncertainty < 0 || record.uncertainty > 1) {
    errors.push('uncertainty must be a number in [0, 1]');
  }
  if (errors.length > 0) throw new ValidationError('Invalid skill', errors);
}

function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
