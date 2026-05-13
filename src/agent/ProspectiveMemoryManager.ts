/**
 * Prospective Memory Manager
 *
 * Memory for intentions to perform actions at specific future times or in
 * specific future contexts. Closes the canonical memory-type taxonomy
 * alongside working / episodic / semantic / procedural.
 *
 * Distinguishes **time-based** (T+5h) from **event-based** (when I see X)
 * prospective memory per Einstein & McDaniel 1990.
 *
 * Design decisions (locked in `docs/roadmap/MEMORY_TYPES_EXPANSION.md` §6):
 *
 * - **D1** `action: 'invoke'` uses a dependency-injection callback
 *   (`procedureInvoker` in config), not a direct `ProcedureManager`
 *   import. Invoker errors surface on `FiredEvent.invocationError` so
 *   the caller can observe partial-success states without unwinding
 *   the fire.
 * - **D2** `cancelOnEvent` uses OR semantics — matches `TriggerCondition`
 *   firing semantics. Cancel beats fire when both match the same
 *   observation.
 * - **D3** Default visibility is `'private'` — matches every other
 *   memory type.
 *
 * @module agent/ProspectiveMemoryManager
 */

import { randomBytes } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  CancelResult,
  FiredEvent,
  IsoDateTime,
  ObservationContext,
  ProspectiveAction,
  ProspectiveEntity,
  ProspectiveLifecycle,
  ProspectiveTrigger,
  TriggerCondition,
} from '../types/agent-memory.js';
import { isProspectiveMemory, toIsoDateTime, toPositiveInt } from '../types/agent-memory.js';
import { logger } from '../utils/logger.js';

// ==================== Configuration ====================

/**
 * Callback fired when a prospective intention with `action.kind === 'invoke'`
 * activates. Dependency-injected per D1 so the manager doesn't import
 * `ProcedureManager` directly.
 *
 * **Contract**: the manager will await this and surface any rejection
 * on `FiredEvent.invocationError` — it will NOT unwind the fire. The
 * intention transitions to `'fired'` either way; the caller observes
 * downstream failure through the returned event.
 */
export type ProcedureInvoker = (
  procedureId: string,
  context: FiredEvent
) => Promise<void>;

/** Configuration for `ProspectiveMemoryManager`. */
export interface ProspectiveMemoryConfig {
  /**
   * Default expiry for un-fired intentions. After `now > expiresAt`,
   * `expireOverdue()` will transition the intention's lifecycle to
   * `'expired'`. Default: 168 hours (1 week).
   */
  defaultExpiryHours?: number;

  /** Maximum pending intentions per session. Default: 100. */
  maxPendingPerSession?: number;

  /**
   * Procedure invoker callback. When `action.kind === 'invoke'` fires,
   * the manager calls this with the procedure id. Absent ⇒ invoke
   * actions still transition the entity to `'fired'` but no downstream
   * procedure runs.
   */
  procedureInvoker?: ProcedureInvoker;
}

// ==================== Schedule Options ====================

/** Options shared across all `schedule*` methods. */
export interface ScheduleOptions {
  /** Session this intention belongs to. */
  sessionId?: string;
  /** Optional agent id (multi-agent). */
  agentId?: string;
  /** Importance 0–10. Default 5. */
  importance?: number;
  /** Confidence 0–1. Default 0.9. */
  confidence?: number;
  /** Override the action. Defaults to inject-context. */
  action?: ProspectiveAction;
  /** Optional cancel-on-event predicate. */
  cancelOnEvent?: TriggerCondition;
  /** Cap on `lifecycle.fireCount` for recurring event-based triggers. */
  maxFireCount?: number;
}

// ==================== Manager ====================

/**
 * Manages prospective memories with time / event / conditional triggers.
 *
 * @example
 * ```typescript
 * const pmm = new ProspectiveMemoryManager(storage, {
 *   procedureInvoker: ctx.procedureManager.invoke.bind(ctx.procedureManager),
 * });
 *
 * await pmm.scheduleAt('Brief on CI failures', new Date(Date.now() + 3_600_000));
 * await pmm.scheduleOnEvent('Remind about deadline', { tags: ['migration'] });
 *
 * const fired = await pmm.tick();
 * for (const event of fired) {
 *   if (event.invocationError) {
 *     // The intention fired but the invoker rejected.
 *   } else if (event.injectionPayload) {
 *     // Surface this to the agent's next wake-up.
 *   }
 * }
 * ```
 */
export class ProspectiveMemoryManager {
  private readonly storage: IGraphStorage;
  private readonly defaultExpiryHours: number;
  private readonly maxPendingPerSession: number;
  private readonly procedureInvoker: ProcedureInvoker | undefined;
  private conditionalWarningEmitted = false;

  constructor(storage: IGraphStorage, config: ProspectiveMemoryConfig = {}) {
    this.storage = storage;
    this.defaultExpiryHours = config.defaultExpiryHours ?? 168;
    this.maxPendingPerSession = config.maxPendingPerSession ?? 100;
    this.procedureInvoker = config.procedureInvoker;
  }

  // ==================== Create ====================

  /** Schedule a time-based reminder. @throws if `at` is in the past. */
  async scheduleAt(
    content: string,
    at: Date,
    options: ScheduleOptions = {}
  ): Promise<ProspectiveEntity> {
    if (at.getTime() <= Date.now()) {
      throw new Error(`scheduleAt: 'at' must be in the future, got ${at.toISOString()}`);
    }
    return this.createProspective(
      content,
      { kind: 'time', at: toIsoDateTime(at) },
      options
    );
  }

  /** Schedule an event-based intention. */
  async scheduleOnEvent(
    content: string,
    condition: TriggerCondition,
    options: ScheduleOptions = {}
  ): Promise<ProspectiveEntity> {
    return this.createProspective(content, { kind: 'event', condition }, options);
  }

  /**
   * Schedule a conditional-predicate intention.
   *
   * ⚠️ **Predicate evaluation is deferred.** This MVP persists the
   * intention but `tick()` does NOT auto-evaluate the predicate; the
   * intention will sit in `'pending'` indefinitely. Use `scheduleOnEvent`
   * if you need runtime evaluation today. Tracked in
   * `docs/roadmap/MEMORY_TYPES_EXPANSION.md` §4.7 as a deferred
   * implementation detail.
   */
  async scheduleConditional(
    content: string,
    predicate: string,
    options: ScheduleOptions & { checkIntervalMs?: number } = {}
  ): Promise<ProspectiveEntity> {
    if (!this.conditionalWarningEmitted) {
      logger.warn(
        'ProspectiveMemoryManager.scheduleConditional: predicate evaluation is not implemented in this version. ' +
          'The intention will persist but will never auto-fire. ' +
          'See docs/roadmap/MEMORY_TYPES_EXPANSION.md §4.7.'
      );
      this.conditionalWarningEmitted = true;
    }
    const { checkIntervalMs, ...rest } = options;
    const checkInterval = checkIntervalMs !== undefined ? toPositiveInt(checkIntervalMs) : undefined;
    return this.createProspective(
      content,
      { kind: 'conditional', predicate, checkIntervalMs: checkInterval },
      rest
    );
  }

  // ==================== Read ====================

  /**
   * Get pending intentions, optionally filtered by session / agent.
   * Sorted by next fire time for time triggers (earliest first); event
   * and conditional triggers sort after.
   */
  async getPending(filter: { sessionId?: string; agentId?: string } = {}): Promise<ProspectiveEntity[]> {
    const all = await this.getAllProspective();
    const pending = all.filter((e) => e.lifecycle.status === 'pending');
    const filtered = pending.filter((e) => {
      if (filter.sessionId !== undefined && e.sessionId !== filter.sessionId) return false;
      if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
      return true;
    });
    return sortByNextFireTime(filtered);
  }

  /** Get fired intentions (audit / history). */
  async getFired(
    filter: { sessionId?: string; agentId?: string; sinceDate?: Date } = {}
  ): Promise<ProspectiveEntity[]> {
    const all = await this.getAllProspective();
    const sinceMs = filter.sinceDate?.getTime();
    return all.filter((e) => {
      if (e.lifecycle.status !== 'fired') return false;
      if (filter.sessionId !== undefined && e.sessionId !== filter.sessionId) return false;
      if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
      if (sinceMs !== undefined) {
        const firedMs = safeIsoToMs(e.lifecycle.firedAt);
        if (firedMs === undefined || firedMs < sinceMs) return false;
      }
      return true;
    });
  }

  // ==================== Lifecycle — fire ====================

  /** Fire any time / time-window triggers whose criteria are met. */
  async tick(now: Date = new Date()): Promise<FiredEvent[]> {
    const pending = await this.getPending();
    const fired: FiredEvent[] = [];
    for (const entity of pending) {
      if (!this.shouldFireOnTick(entity, now)) continue;
      fired.push(await this.fire(entity, now));
    }
    return fired;
  }

  /**
   * Process an incoming observation. `cancelOnEvent` is checked first;
   * if it matches, the entity is cancelled and no fire happens (D2).
   * Otherwise, event-based triggers whose condition matches fire.
   */
  async onObservation(observation: string, context: ObservationContext): Promise<FiredEvent[]> {
    const pending = await this.getPending();
    const fired: FiredEvent[] = [];
    const now = new Date();
    for (const entity of pending) {
      if (entity.cancelOnEvent && matches(entity.cancelOnEvent, observation, context)) {
        await this.cancel(entity.name);
        continue;
      }
      if (entity.trigger.kind === 'event' && matches(entity.trigger.condition, observation, context)) {
        fired.push(await this.fire(entity, now));
      }
    }
    return fired;
  }

  // ==================== Lifecycle — cancel / expire ====================

  /**
   * Cancel an intention. Returns a discriminated status so callers can
   * distinguish typo / already-fired / already-cancelled / actual cancel.
   */
  async cancel(entityName: string): Promise<CancelResult> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity || !isProspectiveMemory(entity)) return 'not-found';
    switch (entity.lifecycle.status) {
      case 'fired':
        return 'already-fired';
      case 'cancelled':
        return 'already-cancelled';
      case 'expired':
        return 'already-expired';
      case 'pending': {
        const now = toIsoDateTime(new Date());
        const newLifecycle: ProspectiveLifecycle = {
          status: 'cancelled',
          cancelledAt: now,
          fireCount: 0,
        };
        await this.storage.updateEntity(entityName, {
          lifecycle: newLifecycle,
          lastModified: now,
        } as unknown as Partial<Entity>);
        return 'cancelled';
      }
    }
  }

  /**
   * Mark intentions past their `expiresAt` as `'expired'`. Returns the
   * count transitioned. Malformed `expiresAt` strings are logged and
   * skipped (defense against bad imported data).
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const pending = await this.getPending();
    let count = 0;
    const nowIso = toIsoDateTime(now);
    for (const entity of pending) {
      if (!entity.expiresAt) continue;
      const expiresMs = safeIsoToMs(entity.expiresAt);
      if (expiresMs === undefined) {
        logger.warn(
          `ProspectiveMemoryManager.expireOverdue: malformed expiresAt on '${entity.name}': ${entity.expiresAt}`
        );
        continue;
      }
      if (expiresMs < now.getTime()) {
        const newLifecycle: ProspectiveLifecycle = {
          status: 'expired',
          fireCount: entity.lifecycle.fireCount,
          expiredAt: nowIso,
        };
        await this.storage.updateEntity(entity.name, {
          lifecycle: newLifecycle,
          lastModified: nowIso,
        } as unknown as Partial<Entity>);
        count++;
      }
    }
    return count;
  }

  // ==================== Internal ====================

  /** Build a `ProspectiveEntity`, validate session caps, persist. */
  private async createProspective(
    content: string,
    trigger: ProspectiveTrigger,
    options: ScheduleOptions
  ): Promise<ProspectiveEntity> {
    if (options.sessionId) {
      const sessionPending = await this.getPending({ sessionId: options.sessionId });
      // Best-effort cap; not strictly serializable under concurrent callers
      // (Node.js single-threaded, but `await` interleaving allows race past
      // the check). For production-grade serialization, wrap in async-mutex.
      if (sessionPending.length >= this.maxPendingPerSession) {
        throw new Error(
          `ProspectiveMemoryManager: session '${options.sessionId}' has reached the max pending cap (${this.maxPendingPerSession})`
        );
      }
    }

    const now = new Date();
    const nowIso = toIsoDateTime(now);
    const name = `prospective_${now.getTime()}_${randomBytes(4).toString('hex')}`;
    const expiresAt = toIsoDateTime(
      new Date(now.getTime() + this.defaultExpiryHours * 3600 * 1000)
    );

    const entity: ProspectiveEntity = {
      name,
      entityType: 'prospective',
      observations: [content],
      createdAt: nowIso,
      lastModified: nowIso,
      importance: options.importance ?? 5,
      memoryType: 'prospective',
      sessionId: options.sessionId,
      agentId: options.agentId,
      visibility: 'private', // D3
      accessCount: 0,
      confidence: options.confidence ?? 0.9,
      confirmationCount: 0,
      expiresAt,
      trigger,
      action: options.action ?? { kind: 'inject-context' },
      lifecycle: { status: 'pending', fireCount: 0 },
      maxFireCount: options.maxFireCount !== undefined ? toPositiveInt(options.maxFireCount) : undefined,
      cancelOnEvent: options.cancelOnEvent,
    };

    await this.storage.appendEntity(entity as unknown as Entity);
    return entity;
  }

  /** Load all entities, filter to prospective. */
  private async getAllProspective(): Promise<ProspectiveEntity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isProspectiveMemory);
  }

  /** Does this entity satisfy its tick-firing criteria as of `now`? */
  private shouldFireOnTick(entity: ProspectiveEntity, now: Date): boolean {
    const nowMs = now.getTime();
    switch (entity.trigger.kind) {
      case 'time': {
        const atMs = safeIsoToMs(entity.trigger.at);
        if (atMs === undefined) {
          logger.warn(`ProspectiveMemoryManager: malformed trigger.at on '${entity.name}'`);
          return false;
        }
        return atMs <= nowMs;
      }
      case 'time-window': {
        const fromMs = safeIsoToMs(entity.trigger.from);
        if (fromMs === undefined) {
          logger.warn(`ProspectiveMemoryManager: malformed trigger.from on '${entity.name}'`);
          return false;
        }
        const untilMs = entity.trigger.until ? safeIsoToMs(entity.trigger.until) : Infinity;
        if (untilMs === undefined) {
          logger.warn(`ProspectiveMemoryManager: malformed trigger.until on '${entity.name}'`);
          return false;
        }
        return nowMs >= fromMs && nowMs < untilMs;
      }
      case 'conditional':
        // Predicate evaluation is deferred (see scheduleConditional JSDoc).
        return false;
      case 'event':
        return false; // Event triggers fire only via onObservation()
    }
  }

  /** Transition entity → fired, build FiredEvent, optionally invoke procedure. */
  private async fire(entity: ProspectiveEntity, now: Date): Promise<FiredEvent> {
    const newFireCount = entity.lifecycle.fireCount + 1;
    const nowIso = toIsoDateTime(now);
    const maxReached = entity.maxFireCount !== undefined && newFireCount >= entity.maxFireCount;

    // Recurring event-based that haven't hit cap stay 'pending' (with
    // `fireCount > 0` and `firedAt` set) so subsequent matching
    // observations can fire them again. Time-based always transition to
    // 'fired' since their trigger.at is a single instant.
    const isRecurring = entity.trigger.kind === 'event' && !maxReached;
    let newLifecycle: ProspectiveLifecycle;
    if (maxReached) {
      newLifecycle = {
        status: 'expired',
        firedAt: nowIso,
        fireCount: newFireCount,
        expiredAt: nowIso,
      };
    } else if (isRecurring) {
      newLifecycle = { status: 'pending', fireCount: newFireCount, firedAt: nowIso };
    } else {
      newLifecycle = { status: 'fired', firedAt: nowIso, fireCount: newFireCount };
    }

    await this.storage.updateEntity(entity.name, {
      lifecycle: newLifecycle,
      lastModified: nowIso,
    } as unknown as Partial<Entity>);

    const updatedEntity: ProspectiveEntity = { ...entity, lifecycle: newLifecycle, lastModified: nowIso };
    const fired: FiredEvent = { entity: updatedEntity, firedAt: now };

    switch (entity.action.kind) {
      case 'inject-context':
        fired.injectionPayload = formatInjectionPayload(entity);
        break;
      case 'invoke':
        fired.invokedProcedureId = entity.action.procedureId;
        if (this.procedureInvoker) {
          try {
            await this.procedureInvoker(entity.action.procedureId, fired);
          } catch (err) {
            fired.invocationError = err instanceof Error ? err : new Error(String(err));
            logger.warn(
              `ProspectiveMemoryManager: procedureInvoker rejected for '${entity.action.procedureId}': ${fired.invocationError.message}`
            );
          }
        }
        break;
      case 'tag-related':
        fired.taggedEntityNames = await this.applyTagRelated(entity.action, observationFromEntity(entity), {
          sessionId: entity.sessionId,
        });
        break;
    }

    return fired;
  }

  /**
   * Apply a `tag-related` action: scan all entities, find those matching
   * `relatedEntityFilter`, append `tagsToAdd` to their tags. Returns the
   * names of entities that received new tags.
   */
  private async applyTagRelated(
    action: Extract<ProspectiveAction, { kind: 'tag-related' }>,
    observationText: string,
    context: ObservationContext
  ): Promise<string[]> {
    const graph = await this.storage.loadGraph();
    const tagged: string[] = [];
    const nowIso = toIsoDateTime(new Date());
    for (const entity of graph.entities) {
      // Only consider entities other than prospective intentions themselves
      if ('memoryType' in entity && (entity as { memoryType?: unknown }).memoryType === 'prospective') {
        continue;
      }
      const entityContext: ObservationContext = {
        tags: entity.tags,
        entityType: entity.entityType,
        sessionId: context.sessionId,
      };
      if (!matches(action.relatedEntityFilter, observationText, entityContext)) continue;
      const existingTags = entity.tags ?? [];
      const newTags = Array.from(new Set([...existingTags, ...action.tagsToAdd]));
      if (newTags.length === existingTags.length) continue; // no change
      await this.storage.updateEntity(entity.name, {
        tags: newTags,
        lastModified: nowIso,
      });
      tagged.push(entity.name);
    }
    return tagged;
  }
}

// ==================== Helpers ====================

/**
 * Match a `TriggerCondition` against an incoming observation using OR
 * (any-of) semantics per D2.
 *
 * Empty conditions never match — the type system already disallows
 * empty `TriggerCondition` (`AtLeastOne<>`), but the guard remains as
 * runtime defense against data that bypassed the type (e.g., raw
 * imports).
 */
function matches(
  condition: TriggerCondition,
  observation: string,
  context: ObservationContext
): boolean {
  const c = condition as Partial<{
    text: string;
    tags: string[];
    entityType: string;
    sessionId: string;
  }>;
  const anyFieldPopulated =
    c.text !== undefined ||
    (c.tags !== undefined && c.tags.length > 0) ||
    c.entityType !== undefined ||
    c.sessionId !== undefined;
  if (!anyFieldPopulated) return false;
  if (c.text !== undefined && observation.includes(c.text)) return true;
  if (c.tags !== undefined && context.tags !== undefined && c.tags.some((t) => context.tags!.includes(t))) {
    return true;
  }
  if (c.entityType !== undefined && context.entityType !== undefined && c.entityType === context.entityType) {
    return true;
  }
  if (c.sessionId !== undefined && context.sessionId !== undefined && c.sessionId === context.sessionId) {
    return true;
  }
  return false;
}

/** Sort prospective entities by next-fire time. */
function sortByNextFireTime(entities: ProspectiveEntity[]): ProspectiveEntity[] {
  return [...entities].sort((a, b) => extractFireTime(a) - extractFireTime(b));
}

/** Pull a comparable "next fire" timestamp out of a trigger. */
function extractFireTime(entity: ProspectiveEntity): number {
  switch (entity.trigger.kind) {
    case 'time':
      return safeIsoToMs(entity.trigger.at) ?? Number.MAX_SAFE_INTEGER;
    case 'time-window':
      return safeIsoToMs(entity.trigger.from) ?? Number.MAX_SAFE_INTEGER;
    case 'event':
    case 'conditional':
      return Number.MAX_SAFE_INTEGER;
  }
}

/** Parse an ISO datetime to ms, returning `undefined` on malformed input. */
function safeIsoToMs(iso: IsoDateTime | string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** Format an inject-context payload from a prospective entity. */
function formatInjectionPayload(entity: ProspectiveEntity): string {
  const content = entity.observations[0] ?? '';
  return `[prospective] ${content}`;
}

/** Extract the original content observation for use in tag-related matching. */
function observationFromEntity(entity: ProspectiveEntity): string {
  return entity.observations[0] ?? '';
}
