/**
 * Event Manager (R1 — event reification)
 *
 * Reifies actions as first-class `entityType: 'event'` hub entities — the
 * brainapi2-style n-ary "triangle" model — instead of flat triples, so
 * "who did what, to whom, where, when" is one queryable unit:
 *
 * - Event hub entity named `event-<action>-<shortId>` (ArtifactManager-style
 *   sanitized-name + random hex shortId convention, minus the date segment —
 *   `createdAt` / `[occurred-at]:` carry the temporal dimension instead).
 * - Observations: `[action]: <verb>` line, optional `[occurred-at]: <ISO>`
 *   scalar line, plus free-text detail lines.
 * - Tags: `event`, plus optional `flow:<key>` grouping tag (lowercased by
 *   tag normalization — flow keys are case-insensitive).
 * - Role-typed relations (constants exported):
 *   `<actor> —actor_of→ <event>`, `<event> —targeted→ <target>`,
 *   `<event> —occurred_in→ <context>`, `<participant> —participant_in→ <event>`.
 *
 * **Endpoint handling**: by default (`autoCreateEndpoints: true`) missing
 * endpoint entities are created as lightweight `entityType: 'concept'`
 * stubs — `'concept'` is the established lightweight/abstract type in this
 * codebase (see `ContextProfileManager` presets) rather than a new
 * `'entity-stub'` type, so stubs participate in search/salience like any
 * other entity and can be enriched later. With `autoCreateEndpoints: false`
 * `recordEvent` throws before writing anything when an endpoint is missing
 * (`RelationManager.createRelations` would reject dangling endpoints anyway;
 * the pre-check keeps the failure atomic — no orphan event entity).
 *
 * Pure convention layer over existing storage — no schema changes. Queries
 * use the storage TypeIndex (`listEntities({ entityType: 'event' })`, O(k))
 * and the RelationIndex (`getRelations`, O(1) lookup) — no full-graph scans.
 *
 * @module agent/events/EventManager
 * @experimental
 */

import { randomBytes } from 'crypto';
import type { Entity, Relation } from '../../types/index.js';
import type { EntityManager } from '../../core/EntityManager.js';
import type { RelationManager } from '../../core/RelationManager.js';
import type {
  EventQueryFilter,
  EventRecord,
  EventTimeInput,
  EventTimeRange,
  RecordEventInput,
  WhoDidWhatEntry,
  WhoDidWhatFilter,
} from '../../types/event.js';

// ============================================================
// Conventions (exported constants)
// ============================================================

/** Entity type of reified event hub entities. */
export const EVENT_ENTITY_TYPE = 'event';

/**
 * Entity type used for auto-created endpoint stubs. Reuses the established
 * lightweight `'concept'` type (see module doc) instead of a bespoke stub type.
 */
export const EVENT_STUB_ENTITY_TYPE = 'concept';

/** `<actor> —actor_of→ <event>`. */
export const ACTOR_OF_RELATION = 'actor_of';

/** `<event> —targeted→ <target>`. */
export const TARGETED_RELATION = 'targeted';

/** `<event> —occurred_in→ <context/location entity>`. */
export const OCCURRED_IN_RELATION = 'occurred_in';

/** `<participant> —participant_in→ <event>`. */
export const PARTICIPANT_IN_RELATION = 'participant_in';

/** Tag present on every event entity. */
export const EVENT_TAG = 'event';

/** Tag prefix carrying the flow key: `flow:<key>`. */
export const FLOW_TAG_PREFIX = 'flow:';

/** Observation prefix for the action verb line. */
const ACTION_PREFIX = '[action]: ';

/** Observation prefix for the occurrence-time scalar line. */
const OCCURRED_AT_PREFIX = '[occurred-at]: ';

/**
 * Build an event entity name from the naming convention
 * `event-<action>-<shortId>`. Sanitizes `action` the same way
 * `ArtifactManager` sanitizes tool names (alphanumerics + hyphens,
 * lowercased) so the name is safe as a JSONL key / URL segment.
 */
export function eventEntityName(action: string, shortId: string): string {
  const sanitized = action.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `event-${sanitized}-${shortId}`;
}

// ============================================================
// Config
// ============================================================

export interface EventManagerConfig {
  /**
   * When true (default), endpoint entities (actor/target/context/
   * participants) that don't exist yet are auto-created as
   * `entityType: 'concept'` stubs. When false, `recordEvent` throws
   * (before writing anything) if any endpoint is missing.
   */
  autoCreateEndpoints?: boolean;
}

// ============================================================
// EventManager
// ============================================================

/**
 * Records and queries reified events. Constructor-injected
 * `EntityManager` / `RelationManager` (ProcedureManager house style).
 *
 * @example
 * ```typescript
 * const events = new EventManager(ctx.entityManager, ctx.relationManager);
 * await events.recordEvent({
 *   action: 'deployed',
 *   actor: 'alice',
 *   target: 'api-service',
 *   context: 'production',
 *   occurredAt: '2026-07-24T12:00:00Z',
 *   flowKey: 'release-42',
 * });
 * const flow = await events.getFlow('release-42');
 * const who = await events.whoDidWhat({ target: 'api-service' });
 * ```
 */
export class EventManager {
  private readonly autoCreateEndpoints: boolean;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly relationManager: RelationManager,
    config: EventManagerConfig = {},
  ) {
    this.autoCreateEndpoints = config.autoCreateEndpoints ?? true;
  }

  // ----------------------------------------------------------
  // Write path
  // ----------------------------------------------------------

  /**
   * Reify one action as an event hub entity + role-typed relations.
   *
   * Missing endpoints are auto-created as `'concept'` stubs (default) or
   * rejected up front — see `EventManagerConfig.autoCreateEndpoints`.
   *
   * @throws {Error} on empty `action`/`actor`, unparseable `occurredAt`,
   *   missing endpoints (when `autoCreateEndpoints` is false), or shortId
   *   exhaustion (10 collision retries).
   */
  async recordEvent(input: RecordEventInput): Promise<EventRecord> {
    const action = input.action?.trim();
    const actor = input.actor?.trim();
    if (!action) throw new Error('recordEvent: action is required');
    if (!actor) throw new Error('recordEvent: actor is required');

    const occurredAt =
      input.occurredAt !== undefined ? normalizeTime(input.occurredAt, 'occurredAt') : undefined;
    const flowKey = input.flowKey?.trim().toLowerCase() || undefined;
    const detail = (Array.isArray(input.detail)
      ? input.detail
      : input.detail !== undefined
        ? [input.detail]
        : []
    ).filter(line => line.trim() !== '');
    const participants = dedupe(
      (input.participants ?? []).map(p => p.trim()).filter(p => p !== ''),
    );

    // Every distinct endpoint the event will link to.
    const endpoints = dedupe([
      actor,
      ...(input.target !== undefined ? [input.target] : []),
      ...(input.context !== undefined ? [input.context] : []),
      ...participants,
    ]);

    await this.ensureEndpoints(endpoints);

    // Find a collision-free name (extremely rare to need > 1 attempt).
    const MAX_ATTEMPTS = 10;
    let name: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && name === undefined; attempt++) {
      const candidate = eventEntityName(action, randomBytes(2).toString('hex'));
      if ((await this.entityManager.getEntity(candidate)) === null) {
        name = candidate;
      }
    }
    if (name === undefined) {
      throw new Error(
        `EventManager: could not generate a unique event name for action="${action}" after ${MAX_ATTEMPTS} attempts`,
      );
    }

    const observations = [
      `${ACTION_PREFIX}${action}`,
      ...(occurredAt !== undefined ? [`${OCCURRED_AT_PREFIX}${occurredAt}`] : []),
      ...detail,
    ];
    const tags = [EVENT_TAG, ...(flowKey !== undefined ? [`${FLOW_TAG_PREFIX}${flowKey}`] : [])];

    const [created] = await this.entityManager.createEntities([
      {
        name,
        entityType: EVENT_ENTITY_TYPE,
        observations,
        tags,
        ...(input.importance !== undefined ? { importance: input.importance } : {}),
      },
    ]);

    const relations: Relation[] = [
      { from: actor, to: name, relationType: ACTOR_OF_RELATION },
    ];
    if (input.target !== undefined) {
      relations.push({ from: name, to: input.target, relationType: TARGETED_RELATION });
    }
    if (input.context !== undefined) {
      relations.push({ from: name, to: input.context, relationType: OCCURRED_IN_RELATION });
    }
    for (const participant of participants) {
      relations.push({ from: participant, to: name, relationType: PARTICIPANT_IN_RELATION });
    }
    await this.relationManager.createRelations(relations);

    return {
      name,
      action,
      actor,
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
      participants,
      ...(occurredAt !== undefined ? { occurredAt } : {}),
      ...(flowKey !== undefined ? { flowKey } : {}),
      detail,
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(created?.createdAt !== undefined ? { createdAt: created.createdAt } : {}),
    };
  }

  // ----------------------------------------------------------
  // Read path
  // ----------------------------------------------------------

  /**
   * Load one event by name, joining the hub entity with its role-typed
   * relation endpoints. Returns null for unknown names or non-event
   * entities.
   */
  async getEvent(name: string): Promise<EventRecord | null> {
    const entity = await this.entityManager.getEntity(name);
    if (!entity || entity.entityType !== EVENT_ENTITY_TYPE) return null;
    return this.decodeEvent(entity);
  }

  /**
   * Query events by any combination of actor, target, action, flowKey,
   * and time range. Results are chronologically ordered (by
   * `occurredAt` ?? `createdAt`, unknown times last) and truncated to
   * `limit` when given.
   *
   * Candidate selection uses the RelationIndex when an `actor` or
   * `target` filter is present (O(degree)), otherwise the TypeIndex for
   * `'event'` (O(k)) — never a full-graph scan.
   */
  async queryEvents(filter: EventQueryFilter = {}): Promise<EventRecord[]> {
    let candidates: string[];
    if (filter.actor !== undefined) {
      const rels = await this.relationManager.getRelations(filter.actor);
      candidates = rels
        .filter(r => r.from === filter.actor && r.relationType === ACTOR_OF_RELATION)
        .map(r => r.to);
    } else if (filter.target !== undefined) {
      const rels = await this.relationManager.getRelations(filter.target);
      candidates = rels
        .filter(r => r.to === filter.target && r.relationType === TARGETED_RELATION)
        .map(r => r.from);
    } else {
      const entities = await this.entityManager.listEntities({ entityType: EVENT_ENTITY_TYPE });
      candidates = entities.map(e => e.name);
    }

    const range = filter.timeRange !== undefined ? resolveRange(filter.timeRange) : undefined;
    const flowTag =
      filter.flowKey !== undefined
        ? `${FLOW_TAG_PREFIX}${filter.flowKey.trim().toLowerCase()}`
        : undefined;

    const events: EventRecord[] = [];
    for (const name of dedupe(candidates)) {
      const event = await this.getEvent(name);
      if (!event) continue;
      if (filter.actor !== undefined && event.actor !== filter.actor) continue;
      if (filter.target !== undefined && event.target !== filter.target) continue;
      if (filter.action !== undefined && event.action !== filter.action) continue;
      if (flowTag !== undefined && `${FLOW_TAG_PREFIX}${event.flowKey ?? ''}` !== flowTag) continue;
      if (range !== undefined && !inRange(eventTimeMs(event), range)) continue;
      events.push(event);
    }

    sortChronologically(events);
    return filter.limit !== undefined ? events.slice(0, filter.limit) : events;
  }

  /**
   * All events sharing the `flow:<flowKey>` tag, chronologically ordered.
   * Flow keys are case-insensitive (tag normalization lowercases them).
   */
  async getFlow(flowKey: string): Promise<EventRecord[]> {
    return this.queryEvents({ flowKey });
  }

  /**
   * Convenience join answering "who did what (to `target` / in
   * `context` / within `timeRange`)?". Events without a resolvable actor
   * (actor entity or relation deleted) are omitted. Chronologically
   * ordered.
   */
  async whoDidWhat(filter: WhoDidWhatFilter = {}): Promise<WhoDidWhatEntry[]> {
    let candidates: string[];
    if (filter.target !== undefined) {
      const rels = await this.relationManager.getRelations(filter.target);
      candidates = rels
        .filter(r => r.to === filter.target && r.relationType === TARGETED_RELATION)
        .map(r => r.from);
    } else if (filter.context !== undefined) {
      const rels = await this.relationManager.getRelations(filter.context);
      candidates = rels
        .filter(r => r.to === filter.context && r.relationType === OCCURRED_IN_RELATION)
        .map(r => r.from);
    } else {
      const entities = await this.entityManager.listEntities({ entityType: EVENT_ENTITY_TYPE });
      candidates = entities.map(e => e.name);
    }

    const range = filter.timeRange !== undefined ? resolveRange(filter.timeRange) : undefined;

    const events: EventRecord[] = [];
    for (const name of dedupe(candidates)) {
      const event = await this.getEvent(name);
      if (!event || event.actor === undefined) continue;
      if (filter.target !== undefined && event.target !== filter.target) continue;
      if (filter.context !== undefined && event.context !== filter.context) continue;
      if (range !== undefined && !inRange(eventTimeMs(event), range)) continue;
      events.push(event);
    }

    sortChronologically(events);
    const limited = filter.limit !== undefined ? events.slice(0, filter.limit) : events;
    return limited.map(event => ({
      actor: event.actor as string,
      action: event.action,
      event,
      ...(event.occurredAt !== undefined ? { occurredAt: event.occurredAt } : {}),
    }));
  }

  // ----------------------------------------------------------
  // Internals
  // ----------------------------------------------------------

  /**
   * Ensure every endpoint entity exists. With `autoCreateEndpoints`,
   * missing ones are created as `'concept'` stubs in one batch
   * (`createEntities` skips names that already exist); otherwise a
   * single Error lists every missing endpoint — thrown before any write.
   */
  private async ensureEndpoints(names: string[]): Promise<void> {
    if (names.length === 0) return;
    if (this.autoCreateEndpoints) {
      await this.entityManager.createEntities(
        names.map(name => ({
          name,
          entityType: EVENT_STUB_ENTITY_TYPE,
          observations: [],
        })),
      );
      return;
    }
    const missing: string[] = [];
    for (const name of names) {
      if ((await this.entityManager.getEntity(name)) === null) missing.push(name);
    }
    if (missing.length > 0) {
      throw new Error(
        `recordEvent: endpoint entities do not exist (autoCreateEndpoints is off): ${missing.join(', ')}`,
      );
    }
  }

  /** Join an event hub entity with its role-typed relations. */
  private async decodeEvent(entity: Entity): Promise<EventRecord> {
    let action = '';
    let occurredAt: string | undefined;
    const detail: string[] = [];
    for (const obs of entity.observations) {
      if (obs.startsWith(ACTION_PREFIX)) {
        action = obs.slice(ACTION_PREFIX.length);
      } else if (obs.startsWith(OCCURRED_AT_PREFIX)) {
        occurredAt = obs.slice(OCCURRED_AT_PREFIX.length);
      } else {
        detail.push(obs);
      }
    }

    const flowTag = (entity.tags ?? []).find(t => t.startsWith(FLOW_TAG_PREFIX));
    const flowKey = flowTag?.slice(FLOW_TAG_PREFIX.length);

    const relations = await this.relationManager.getRelations(entity.name);
    let actor: string | undefined;
    let target: string | undefined;
    let context: string | undefined;
    const participants: string[] = [];
    for (const rel of relations) {
      if (rel.to === entity.name && rel.relationType === ACTOR_OF_RELATION) {
        actor ??= rel.from;
      } else if (rel.from === entity.name && rel.relationType === TARGETED_RELATION) {
        target ??= rel.to;
      } else if (rel.from === entity.name && rel.relationType === OCCURRED_IN_RELATION) {
        context ??= rel.to;
      } else if (rel.to === entity.name && rel.relationType === PARTICIPANT_IN_RELATION) {
        participants.push(rel.from);
      }
    }

    return {
      name: entity.name,
      action,
      ...(actor !== undefined ? { actor } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(context !== undefined ? { context } : {}),
      participants,
      ...(occurredAt !== undefined ? { occurredAt } : {}),
      ...(flowKey !== undefined && flowKey !== '' ? { flowKey } : {}),
      detail,
      ...(entity.importance !== undefined ? { importance: entity.importance } : {}),
      ...(entity.createdAt !== undefined ? { createdAt: entity.createdAt } : {}),
    };
  }
}

// -------- module-level helpers --------

/** Normalize a time input to an ISO 8601 string; throws on unparseable input. */
function normalizeTime(input: EventTimeInput, field: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`recordEvent: ${field} is not a valid date: ${String(input)}`);
  }
  return date.toISOString();
}

/** Resolve a time range to epoch-ms bounds; unparseable bounds throw. */
function resolveRange(range: EventTimeRange): { start: number; end: number } {
  const start =
    range.start !== undefined ? new Date(normalizeTime(range.start, 'timeRange.start')).getTime() : -Infinity;
  const end =
    range.end !== undefined ? new Date(normalizeTime(range.end, 'timeRange.end')).getTime() : Infinity;
  return { start, end };
}

/** Event timestamp for ordering/filtering: occurredAt ?? createdAt, else NaN. */
function eventTimeMs(event: EventRecord): number {
  const iso = event.occurredAt ?? event.createdAt;
  return iso !== undefined ? new Date(iso).getTime() : NaN;
}

/** Inclusive range check; events with unknown time never match a range. */
function inRange(ms: number, range: { start: number; end: number }): boolean {
  return !Number.isNaN(ms) && ms >= range.start && ms <= range.end;
}

/** Chronological ascending sort, unknown times last; name tie-break. */
function sortChronologically(events: EventRecord[]): void {
  events.sort((a, b) => {
    const ta = eventTimeMs(a);
    const tb = eventTimeMs(b);
    const na = Number.isNaN(ta) ? Infinity : ta;
    const nb = Number.isNaN(tb) ? Infinity : tb;
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name);
  });
}

/** Order-preserving dedupe. */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
