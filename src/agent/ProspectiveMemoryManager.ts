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
 *   import. Same pattern as `LLMQueryPlanner` + `LLMProvider`.
 * - **D2** `cancelOnEvent` uses OR semantics — matches `TriggerCondition`
 *   firing semantics.
 * - **D3** Default visibility is `'private'` — matches every other
 *   memory type.
 * - **D4** N/A in library code (CLI ships alongside; MCP follow-up).
 *
 * @module agent/ProspectiveMemoryManager
 */

import { randomBytes } from 'crypto';
import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  ProspectiveEntity,
  ProspectiveTrigger,
  ProspectiveAction,
  TriggerCondition,
  FiredEvent,
  ObservationContext,
} from '../types/agent-memory.js';
import { isProspectiveMemory } from '../types/agent-memory.js';

// ==================== Configuration ====================

/**
 * Callback fired when a prospective intention with `action.kind === 'invoke'`
 * activates. Dependency-injected per D1 so the manager doesn't import
 * `ProcedureManager` directly.
 *
 * @param procedureId - The procedure id from the action definition.
 * @param context     - The fired event (entity + firedAt timestamp).
 */
export type ProcedureInvoker = (
  procedureId: string,
  context: FiredEvent
) => Promise<void>;

/**
 * Configuration for ProspectiveMemoryManager.
 */
export interface ProspectiveMemoryConfig {
  /**
   * Default expiry for un-fired intentions. After `now > expiresAt`,
   * `expireOverdue()` will transition the intention's status to
   * `'expired'`. Default: 168 hours (1 week).
   */
  defaultExpiryHours?: number;

  /** Maximum pending intentions per session. Default: 100. */
  maxPendingPerSession?: number;

  /**
   * Procedure invoker callback. When `action.kind === 'invoke'` fires,
   * the manager calls this with the procedure id. Absent ⇒ invoke
   * actions still fire (entity transitions to 'fired') but no
   * downstream procedure is dispatched.
   *
   * Wire `ctx.procedureManager.invoke.bind(ctx.procedureManager)` here
   * via `ManagerContext`.
   */
  procedureInvoker?: ProcedureInvoker;
}

// ==================== Schedule Options ====================

/**
 * Options shared across all `schedule*` methods.
 */
export interface ScheduleOptions {
  /** Session this intention belongs to. */
  sessionId?: string;
  /** Optional agent id (multi-agent). */
  agentId?: string;
  /** Importance 0–10. Default 5. */
  importance?: number;
  /** Override the action. Defaults to inject-context. */
  action?: ProspectiveAction;
  /** Optional cancel-on-event predicate. */
  cancelOnEvent?: TriggerCondition;
  /** Cap on fireCount for recurring event-based triggers. */
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
 * // Time-based reminder
 * await pmm.scheduleAt(
 *   'Brief on overnight CI failures',
 *   new Date(Date.now() + 8 * 3600 * 1000),
 *   { sessionId: 'daily-standup', importance: 8 }
 * );
 *
 * // Event-based intention
 * await pmm.scheduleOnEvent(
 *   'Remind about migration deadline',
 *   { tags: ['migration', 'plan'] },
 *   { sessionId: 'project_x', maxFireCount: 1 }
 * );
 *
 * // Run the tick loop manually (or via TaskQueue from ManagerContext)
 * const fired = await pmm.tick();
 * for (const event of fired) {
 *   if (event.injectionPayload) {
 *     // Surface event.injectionPayload to the agent's next wake-up
 *   }
 * }
 * ```
 */
export class ProspectiveMemoryManager {
  private readonly storage: IGraphStorage;
  private readonly config: Required<Omit<ProspectiveMemoryConfig, 'procedureInvoker'>> &
    Pick<ProspectiveMemoryConfig, 'procedureInvoker'>;

  constructor(storage: IGraphStorage, config: ProspectiveMemoryConfig = {}) {
    this.storage = storage;
    this.config = {
      defaultExpiryHours: config.defaultExpiryHours ?? 168,
      maxPendingPerSession: config.maxPendingPerSession ?? 100,
      procedureInvoker: config.procedureInvoker,
    };
  }

  // ==================== Create ====================

  /**
   * Schedule a time-based reminder.
   *
   * @throws {Error} if `at` is in the past
   */
  async scheduleAt(
    content: string,
    at: Date,
    options: ScheduleOptions = {}
  ): Promise<ProspectiveEntity> {
    if (at.getTime() <= Date.now()) {
      throw new Error(`scheduleAt: 'at' must be in the future, got ${at.toISOString()}`);
    }
    return this.createProspective(content, { kind: 'time', at: at.toISOString() }, options);
  }

  /**
   * Schedule an event-based intention.
   */
  async scheduleOnEvent(
    content: string,
    condition: TriggerCondition,
    options: ScheduleOptions = {}
  ): Promise<ProspectiveEntity> {
    return this.createProspective(content, { kind: 'event', condition }, options);
  }

  /**
   * Schedule a conditional-predicate intention.
   */
  async scheduleConditional(
    content: string,
    predicate: string,
    options: ScheduleOptions & { checkIntervalMs?: number } = {}
  ): Promise<ProspectiveEntity> {
    const { checkIntervalMs, ...rest } = options;
    return this.createProspective(
      content,
      { kind: 'conditional', predicate, checkIntervalMs },
      rest
    );
  }

  // ==================== Read ====================

  /**
   * Get pending intentions, optionally filtered by session / agent.
   *
   * Sorted by next fire time for time-based triggers (earliest first),
   * with event/conditional triggers appended after.
   */
  async getPending(filter: { sessionId?: string; agentId?: string } = {}): Promise<ProspectiveEntity[]> {
    const all = await this.getAllProspective();
    const pending = all.filter((e) => e.status === 'pending');
    const filtered = pending.filter((e) => {
      if (filter.sessionId !== undefined && e.sessionId !== filter.sessionId) return false;
      if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
      return true;
    });
    return sortByNextFireTime(filtered);
  }

  /**
   * Get fired intentions (audit / history).
   */
  async getFired(
    filter: { sessionId?: string; agentId?: string; sinceDate?: Date } = {}
  ): Promise<ProspectiveEntity[]> {
    const all = await this.getAllProspective();
    return all.filter((e) => {
      if (e.status !== 'fired') return false;
      if (filter.sessionId !== undefined && e.sessionId !== filter.sessionId) return false;
      if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
      if (filter.sinceDate && (!e.firedAt || new Date(e.firedAt) < filter.sinceDate)) return false;
      return true;
    });
  }

  // ==================== Lifecycle — fire ====================

  /**
   * Check and fire any time / time-window / conditional triggers whose
   * fire criteria are met as of `now`. Returns the events that fired.
   */
  async tick(now: Date = new Date()): Promise<FiredEvent[]> {
    const pending = await this.getPending();
    const fired: FiredEvent[] = [];

    for (const entity of pending) {
      if (!this.shouldFireOnTick(entity, now)) continue;
      const event = await this.fire(entity, now);
      if (event) fired.push(event);
    }

    return fired;
  }

  /**
   * Process an incoming observation. Cancels any pending intention
   * whose `cancelOnEvent` matches; otherwise fires any pending
   * event-based intention whose `trigger.condition` matches.
   *
   * Cancellation takes precedence over firing when both match the same
   * observation (deterministic — avoids fire-then-cancel races).
   */
  async onObservation(observation: string, context: ObservationContext): Promise<FiredEvent[]> {
    const pending = await this.getPending();
    const fired: FiredEvent[] = [];
    const now = new Date();

    for (const entity of pending) {
      // D2: cancelOnEvent is checked first; cancel wins over fire.
      if (entity.cancelOnEvent && matches(entity.cancelOnEvent, observation, context)) {
        await this.cancel(entity.name, 'cancelOnEvent matched');
        continue;
      }
      if (entity.trigger.kind === 'event' && matches(entity.trigger.condition, observation, context)) {
        const event = await this.fire(entity, now);
        if (event) fired.push(event);
      }
    }

    return fired;
  }

  // ==================== Lifecycle — cancel / expire ====================

  /**
   * Cancel a pending intention. No-op on already-fired or
   * already-cancelled intentions.
   */
  async cancel(entityName: string, _reason?: string): Promise<void> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity || !isProspectiveMemory(entity)) return;
    if (entity.status !== 'pending') return;
    await this.storage.updateEntity(entityName, {
      status: 'cancelled',
      lastModified: new Date().toISOString(),
    } as Partial<Entity>);
  }

  /**
   * Mark intentions past their `expiresAt` as `'expired'`. Returns the
   * count of intentions transitioned.
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const pending = await this.getPending();
    let count = 0;
    for (const entity of pending) {
      if (entity.expiresAt && new Date(entity.expiresAt).getTime() < now.getTime()) {
        await this.storage.updateEntity(entity.name, {
          status: 'expired',
          lastModified: now.toISOString(),
        } as Partial<Entity>);
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
    // Session-cap check
    if (options.sessionId) {
      const sessionPending = await this.getPending({ sessionId: options.sessionId });
      if (sessionPending.length >= this.config.maxPendingPerSession) {
        throw new Error(
          `ProspectiveMemoryManager: session '${options.sessionId}' has reached the max pending cap (${this.config.maxPendingPerSession})`
        );
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const name = `prospective_${now.getTime()}_${randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(now.getTime() + this.config.defaultExpiryHours * 3600 * 1000).toISOString();

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
      confidence: 0.9,
      confirmationCount: 0,
      expiresAt,

      // Prospective-specific
      trigger,
      action: options.action ?? { kind: 'inject-context' },
      status: 'pending',
      fireCount: 0,
      maxFireCount: options.maxFireCount,
      cancelOnEvent: options.cancelOnEvent,
    };

    await this.storage.appendEntity(entity as Entity);
    return entity;
  }

  /** Load all entities, filter to prospective. */
  private async getAllProspective(): Promise<ProspectiveEntity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isProspectiveMemory);
  }

  /** Does this entity satisfy its tick-firing criteria as of `now`? */
  private shouldFireOnTick(entity: ProspectiveEntity, now: Date): boolean {
    switch (entity.trigger.kind) {
      case 'time':
        return new Date(entity.trigger.at).getTime() <= now.getTime();
      case 'time-window': {
        const fromMs = new Date(entity.trigger.from).getTime();
        const untilMs = entity.trigger.until ? new Date(entity.trigger.until).getTime() : Infinity;
        const nowMs = now.getTime();
        return nowMs >= fromMs && nowMs < untilMs;
      }
      case 'conditional':
        // Conditional predicates are not evaluated here in the MVP — the
        // predicate language is reserved for a follow-up sprint. For now,
        // the manager honours scheduling and lifecycle but does not auto-fire.
        return false;
      case 'event':
        return false; // Event triggers fire only via onObservation()
    }
  }

  /** Transition entity → fired, build FiredEvent, optionally invoke procedure. */
  private async fire(entity: ProspectiveEntity, now: Date): Promise<FiredEvent | undefined> {
    const newFireCount = (entity.fireCount ?? 0) + 1;
    const shouldExpire =
      entity.maxFireCount !== undefined && newFireCount >= entity.maxFireCount;

    const update: Partial<Entity> = {
      lastModified: now.toISOString(),
    };
    // For recurring event-based that haven't hit cap, stay pending.
    // Time-based always go to 'fired' since they only fire once anyway.
    const isRecurring = entity.trigger.kind === 'event' && !shouldExpire;
    Object.assign(update, {
      status: shouldExpire ? 'expired' : isRecurring ? 'pending' : 'fired',
      firedAt: now.toISOString(),
      fireCount: newFireCount,
    });

    await this.storage.updateEntity(entity.name, update);

    // Build the FiredEvent
    const fired: FiredEvent = {
      entity: { ...entity, ...update } as ProspectiveEntity,
      firedAt: now,
    };

    if (entity.action.kind === 'inject-context') {
      fired.injectionPayload = formatInjectionPayload(entity);
    } else if (entity.action.kind === 'invoke') {
      fired.invokedProcedureId = entity.action.procedureId;
      // D1: optional invocation via injected callback
      if (this.config.procedureInvoker) {
        try {
          await this.config.procedureInvoker(entity.action.procedureId, fired);
        } catch (err) {
          // Swallow invoker errors — fire is recorded; downstream failure
          // is a separate concern. Future: add to AuditLog.
          // eslint-disable-next-line no-console
          console.warn(
            `ProspectiveMemoryManager: procedureInvoker threw for '${entity.action.procedureId}':`,
            err
          );
        }
      }
    }

    return fired;
  }
}

// ==================== Helpers ====================

/**
 * Match a `TriggerCondition` against an incoming observation using OR
 * (any-of) semantics per D2. Empty conditions never match.
 */
function matches(
  condition: TriggerCondition,
  observation: string,
  context: ObservationContext
): boolean {
  const anyFieldPopulated =
    condition.text !== undefined ||
    (condition.tags !== undefined && condition.tags.length > 0) ||
    condition.entityType !== undefined ||
    condition.sessionId !== undefined;
  if (!anyFieldPopulated) return false;

  if (condition.text !== undefined && observation.includes(condition.text)) return true;
  if (
    condition.tags !== undefined &&
    context.tags !== undefined &&
    condition.tags.some((t) => context.tags!.includes(t))
  ) {
    return true;
  }
  if (
    condition.entityType !== undefined &&
    context.entityType !== undefined &&
    condition.entityType === context.entityType
  ) {
    return true;
  }
  if (
    condition.sessionId !== undefined &&
    context.sessionId !== undefined &&
    condition.sessionId === context.sessionId
  ) {
    return true;
  }
  return false;
}

/** Sort prospective entities by next-fire time (time triggers first, earliest first). */
function sortByNextFireTime(entities: ProspectiveEntity[]): ProspectiveEntity[] {
  return [...entities].sort((a, b) => {
    const aTime = extractFireTime(a);
    const bTime = extractFireTime(b);
    return aTime - bTime;
  });
}

/** Pull a comparable "next fire" timestamp out of a trigger. */
function extractFireTime(entity: ProspectiveEntity): number {
  switch (entity.trigger.kind) {
    case 'time':
      return new Date(entity.trigger.at).getTime();
    case 'time-window':
      return new Date(entity.trigger.from).getTime();
    case 'event':
    case 'conditional':
      return Number.MAX_SAFE_INTEGER; // sort after all time-based triggers
  }
}

/** Format an inject-context payload from a prospective entity. */
function formatInjectionPayload(entity: ProspectiveEntity): string {
  const content = entity.observations[0] ?? '';
  return `[prospective] ${content}`;
}
