/**
 * ExclusionManager — `do_not_remember` content-pattern exclusions
 * (Phase 3, v2.0.x).
 *
 * Distinct from `PiiRedactor`:
 * - `PiiRedactor` does structural pattern redaction (credit-card, SSN
 *   shapes) on export.
 * - `ExclusionManager` is user-supplied free-form content filtering
 *   with hard-delete-existing + write-block-future semantics.
 *
 * **v1 scope cut from `MEMORY_TYPES_EXPANSION_PHASE_3.md`**: substring
 * matching only. `'regex'` mode is deferred — the ReDoS attack surface
 * needs careful design (`vm.runInNewContext` timeout, max regex length
 * cap, governance integration). The `mode` field is preserved on the
 * type so the union can widen additively in a follow-up.
 *
 * Architectural note: `check()` is async (one `loadGraph` per call)
 * rather than the synchronous cache the plan sketched. For the
 * low-rule-count case (most users will have < 10 rules) the simpler
 * correct path is preferable; a cache can be added as an optimization
 * once usage data motivates it.
 *
 * @module agent/ExclusionManager
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  ExclusionEntity,
  ExclusionMode,
  ExclusionRule,
  ExclusionScope,
} from '../types/agent-memory.js';
import { isExclusionMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';

/** Input shape for `add`. */
export interface AddExclusionRuleInput {
  /** Non-empty substring pattern (case-insensitive). */
  pattern: string;
  /** Reserved for future expansion. Default and only supported value: `'substring'`. */
  mode?: ExclusionMode;
  /** When the rule applies. Default `'both'`. */
  scope?: ExclusionScope;
  /** Optional restriction by `entityType`. */
  entityType?: string;
  /** Optional free-text justification (e.g. "GDPR request 2026-05-15"). */
  reason?: string;
}

/** Result of `check()`. */
export interface ExclusionCheckResult {
  blocked: boolean;
  /** Id of the rule that matched (when `blocked === true`). */
  ruleId?: string;
  /** Free-text reason copied from the rule (when supplied). */
  reason?: string;
}

export class ExclusionManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;

  constructor(storage: IGraphStorage, entityManager: EntityManager) {
    this.storage = storage;
    this.entityManager = entityManager;
  }

  /**
   * Register a new exclusion rule. When `scope` includes `'past-only'`
   * or `'both'`, runs the past-scan and hard-deletes matching entities
   * before returning the rule (with `deletedCount` populated).
   */
  async add(input: AddExclusionRuleInput): Promise<ExclusionRule> {
    const pattern = input.pattern;
    if (typeof pattern !== 'string' || pattern.trim().length === 0) {
      throw new Error(`ExclusionManager.add: pattern must be a non-empty string; received ${JSON.stringify(pattern)}`);
    }
    const mode: ExclusionMode = input.mode ?? 'substring';
    const scope: ExclusionScope = input.scope ?? 'both';
    const id = `exclusion-${randomUUID()}`;
    const now = toIsoDateTime(new Date());

    // Past-scan: hard-delete matching entities before persisting the
    // rule, so the deletedCount on the rule reflects what actually
    // happened and the rule is durable proof of the deletion event.
    let deletedCount = 0;
    if (scope === 'past-only' || scope === 'both') {
      const matches = await this.matchEntities(pattern, input.entityType);
      if (matches.length > 0) {
        await this.entityManager.deleteEntities(matches.map((e) => e.name));
        deletedCount = matches.length;
      }
    }

    const rule: ExclusionRule = {
      id,
      timestamp: now,
      pattern,
      mode,
      scope,
      entityType: input.entityType,
      reason: input.reason,
      deletedCount,
      blockedCount: 0,
    };

    const entity: ExclusionEntity = {
      name: id,
      entityType: 'exclusion',
      observations: [
        `[exclusion:${scope}] ${pattern}${input.reason ? ` — ${input.reason}` : ''}`,
      ],
      createdAt: now,
      lastModified: now,
      importance: 6,
      memoryType: 'exclusion',
      visibility: 'private',
      accessCount: 0,
      confidence: 1.0,
      confirmationCount: 0,
      exclusionRule: rule,
    };
    await this.storage.appendEntity(entity as unknown as Entity);
    return rule;
  }

  /**
   * Check whether the supplied `content` matches any active rule with
   * a forward-blocking scope (`'future-only'` or `'both'`). Past-only
   * rules are intentionally skipped — they record a hard-deletion
   * event but don't block future writes.
   *
   * Optional `entityType` narrows the rule set: a rule with an
   * `entityType` restriction applies only when the candidate write's
   * `entityType` matches.
   */
  async check(content: string, entityType?: string): Promise<ExclusionCheckResult> {
    if (typeof content !== 'string' || content.length === 0) {
      return { blocked: false };
    }
    const rules = await this.loadActiveBlockingRules();
    const haystack = content.toLowerCase();
    for (const rule of rules) {
      if (rule.entityType !== undefined && rule.entityType !== entityType) continue;
      if (haystack.includes(rule.pattern.toLowerCase())) {
        return { blocked: true, ruleId: rule.id, reason: rule.reason };
      }
    }
    return { blocked: false };
  }

  /** Dry-run: return matching memories for a candidate rule without persisting it. */
  async findMatchingMemories(input: AddExclusionRuleInput): Promise<Entity[]> {
    return this.matchEntities(input.pattern, input.entityType);
  }

  /** All registered rules. */
  async list(): Promise<ExclusionRule[]> {
    const ents = await this.loadAllRuleEntities();
    return ents.map((e) => e.exclusionRule);
  }

  /**
   * Drop a rule. Does NOT restore memories previously deleted by the
   * rule — that contract is intentional, matching the catalog's
   * "user said forget" semantics.
   */
  async remove(id: string): Promise<boolean> {
    if (!isExclusionMemory(this.storage.getEntityByName(id))) return false;
    await this.entityManager.deleteEntities([id]);
    return true;
  }

  // ==================== Internal ====================

  private async matchEntities(pattern: string, entityType?: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    const needle = pattern.toLowerCase();
    return graph.entities.filter((e) => {
      // Skip the exclusion rules themselves so adding a rule against
      // "exclusion" wouldn't recursively delete the rule corpus.
      if (e.entityType === 'exclusion') return false;
      if (entityType !== undefined && e.entityType !== entityType) return false;
      for (const obs of e.observations ?? []) {
        if (typeof obs !== 'string') continue;
        if (obs.toLowerCase().includes(needle)) return true;
      }
      return false;
    });
  }

  private async loadAllRuleEntities(): Promise<ExclusionEntity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isExclusionMemory);
  }

  private async loadActiveBlockingRules(): Promise<ExclusionRule[]> {
    const ents = await this.loadAllRuleEntities();
    return ents
      .map((e) => e.exclusionRule)
      .filter((r) => r.scope === 'future-only' || r.scope === 'both');
  }
}
