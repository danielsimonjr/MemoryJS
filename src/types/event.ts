/**
 * Event Reification Types (R1)
 *
 * Type definitions for the n-ary "triangle" event model: every action is
 * reified as a first-class `entityType: 'event'` hub entity instead of a
 * flat triple, so "who did what, to whom, where, when" becomes a single
 * queryable unit. Role-typed relations wire the hub to its endpoints:
 *
 * - `<actor> —actor_of→ <event>`
 * - `<event> —targeted→ <target>`
 * - `<event> —occurred_in→ <context/location entity>`
 * - `<participant> —participant_in→ <event>` (participants beyond actor/target)
 *
 * The event entity carries an `[action]: <verb>` observation line, optional
 * `[occurred-at]: <ISO>` scalar line, free-text detail lines, and an
 * optional `flow:<key>` tag grouping related events into an ordered flow.
 *
 * Pure convention layer over existing storage — no schema changes. See
 * `agent/events/EventManager` for the implementation and
 * `docs/roadmap/ROADMAP.md` § R1 for design intent.
 *
 * @module types/event
 * @experimental
 */

/** Accepted forms for a point in time: ISO 8601 string or `Date`. */
export type EventTimeInput = string | Date;

/**
 * Inclusive time range filter. Either bound may be omitted for an
 * open-ended range. Events are matched on `occurredAt` when present,
 * falling back to `createdAt`.
 */
export interface EventTimeRange {
  /** Inclusive lower bound. */
  start?: EventTimeInput;
  /** Inclusive upper bound. */
  end?: EventTimeInput;
}

/** Input to `EventManager.recordEvent()`. */
export interface RecordEventInput {
  /** The verb — what happened (e.g. `"deployed"`, `"approved"`). Required. */
  action: string;
  /** Entity name of who performed the action. Required. */
  actor: string;
  /** Entity name of what/who the action was directed at. */
  target?: string;
  /** Entity name of the context/location the event occurred in. */
  context?: string;
  /** Additional participant entity names beyond actor/target. */
  participants?: string[];
  /** When the event occurred (ISO 8601 string or Date). */
  occurredAt?: EventTimeInput;
  /**
   * Flow key grouping related events (stored as a `flow:<key>` tag).
   * Case-insensitive — tag normalization lowercases stored keys.
   */
  flowKey?: string;
  /** Free-text detail line(s) stored as additional observations. */
  detail?: string | string[];
  /** Importance score in [0, 10] on the event entity. */
  importance?: number;
}

/**
 * Decoded view of a reified event — the hub entity plus its role-typed
 * relation endpoints joined into one record.
 */
export interface EventRecord {
  /** Auto-generated event entity name: `event-<action>-<shortId>`. */
  name: string;
  /** The action verb (from the `[action]:` observation line). */
  action: string;
  /**
   * Actor entity name (via the incoming `actor_of` relation). Always set
   * for events written by `recordEvent`; may be undefined for a decoded
   * event whose actor entity/relation was later deleted.
   */
  actor?: string;
  /** Target entity name (via the outgoing `targeted` relation). */
  target?: string;
  /** Context entity name (via the outgoing `occurred_in` relation). */
  context?: string;
  /** Participant entity names (via incoming `participant_in` relations). */
  participants: string[];
  /** ISO 8601 occurrence time (from the `[occurred-at]:` line). */
  occurredAt?: string;
  /** Flow key (from the `flow:<key>` tag), lowercased. */
  flowKey?: string;
  /** Free-text detail observation lines. */
  detail: string[];
  /** Importance score on the event entity. */
  importance?: number;
  /** ISO 8601 creation timestamp of the event entity. */
  createdAt?: string;
}

/** Filter for `EventManager.queryEvents()`. All criteria are ANDed. */
export interface EventQueryFilter {
  /** Only events performed by this actor. */
  actor?: string;
  /** Only events directed at this target. */
  target?: string;
  /** Only events with exactly this action verb. */
  action?: string;
  /** Only events in this flow (case-insensitive). */
  flowKey?: string;
  /** Only events whose time (`occurredAt` ?? `createdAt`) is in range. */
  timeRange?: EventTimeRange;
  /** Maximum number of events returned (applied after chronological sort). */
  limit?: number;
}

/** Filter for `EventManager.whoDidWhat()`. All criteria are ANDed. */
export interface WhoDidWhatFilter {
  /** Only events directed at this target. */
  target?: string;
  /** Only events that occurred in this context. */
  context?: string;
  /** Only events whose time (`occurredAt` ?? `createdAt`) is in range. */
  timeRange?: EventTimeRange;
  /** Maximum number of entries returned (applied after chronological sort). */
  limit?: number;
}

/** One row of the `whoDidWhat()` convenience join. */
export interface WhoDidWhatEntry {
  /** Who performed the action. */
  actor: string;
  /** What they did. */
  action: string;
  /** The full decoded event record. */
  event: EventRecord;
  /** When it occurred (ISO 8601), when known. */
  occurredAt?: string;
}
