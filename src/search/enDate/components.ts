/**
 * Component bookkeeping for the in-repo English date parser.
 *
 * A {@link Components} value tracks which calendar fields the text stated
 * (`known`) and which were filled in (`implied`). Resolution reads `known`
 * first, then `implied`. Every default comes from the reference instant in
 * UTC, and the final instant is built with `Date.UTC`, so the same input
 * yields the same instant on any host timezone.
 *
 * @module search/enDate/components
 * @internal
 */

import type { ComponentKey, Components, Duration, ParseContext } from './types.js';
import { addDuration } from './calendar.js';
import { MERIDIEM_AM, MERIDIEM_PM } from './types.js';

/**
 * Create components seeded with the reference date's calendar fields.
 *
 * Defaults match chrono-node: the reference's UTC day/month/year, noon, and
 * zero minute/second/millisecond.
 *
 * @param context - Parse context holding the reference instant
 * @param known - Fields the text stated explicitly
 */
export function createComponents(
  context: ParseContext,
  known: Partial<Record<ComponentKey, number>> = {}
): Components {
  const ref = context.refDate;
  const components: Components = {
    known: { ...known },
    implied: {
      day: ref.getUTCDate(),
      month: ref.getUTCMonth() + 1,
      year: ref.getUTCFullYear(),
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    tags: new Set<string>(),
  };
  for (const key of Object.keys(known) as ComponentKey[]) {
    delete components.implied[key];
  }
  return components;
}

/**
 * Read a component, preferring a known value over an implied one.
 * @param components - Components to read
 * @param key - Field name
 */
export function getComponent(components: Components, key: ComponentKey): number | undefined {
  const known = components.known[key];
  if (known !== undefined) return known;
  return components.implied[key];
}

/**
 * Record a known value, clearing any implied value for the same field.
 * @param components - Components to mutate
 * @param key - Field name
 * @param value - Field value
 */
export function assign(components: Components, key: ComponentKey, value: number): Components {
  components.known[key] = value;
  delete components.implied[key];
  return components;
}

/**
 * Record an implied value. A known value for the same field is left alone.
 * @param components - Components to mutate
 * @param key - Field name
 * @param value - Field value
 */
export function imply(components: Components, key: ComponentKey, value: number): Components {
  if (components.known[key] !== undefined) return components;
  components.implied[key] = value;
  return components;
}

/**
 * Whether the text stated this field explicitly.
 * @param components - Components to read
 * @param key - Field name
 */
export function isCertain(components: Components, key: ComponentKey): boolean {
  return components.known[key] !== undefined;
}

/**
 * Drop a field from both known and implied values.
 * @param components - Components to mutate
 * @param key - Field name
 */
export function unset(components: Components, key: ComponentKey): Components {
  delete components.known[key];
  delete components.implied[key];
  return components;
}

/**
 * A match that states a time but no date at all.
 * @param components - Components to inspect
 */
export function isOnlyTime(components: Components): boolean {
  return !(
    isCertain(components, 'weekday') ||
    isCertain(components, 'day') ||
    isCertain(components, 'month') ||
    isCertain(components, 'year')
  );
}

/**
 * A match that states a date but no time of day.
 * @param components - Components to inspect
 */
export function isOnlyDate(components: Components): boolean {
  return (
    !isCertain(components, 'hour') &&
    !isCertain(components, 'minute') &&
    !isCertain(components, 'second')
  );
}

/**
 * A match that states a weekday and nothing that pins a calendar day.
 * @param components - Components to inspect
 */
export function isOnlyWeekday(components: Components): boolean {
  return (
    isCertain(components, 'weekday') &&
    !isCertain(components, 'day') &&
    !isCertain(components, 'month')
  );
}

/**
 * A match that states a month but no year.
 * @param components - Components to inspect
 */
export function isDateWithUnknownYear(components: Components): boolean {
  return isCertain(components, 'month') && !isCertain(components, 'year');
}

/**
 * Whether the resolved wall-clock fields name a real calendar day.
 * @param components - Components to inspect
 */
export function isValidDate(components: Components): boolean {
  const year = getComponent(components, 'year');
  const month = getComponent(components, 'month');
  const day = getComponent(components, 'day');
  if (year === undefined || month === undefined || day === undefined) return false;

  const hour = getComponent(components, 'hour') ?? 0;
  const minute = getComponent(components, 'minute') ?? 0;

  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  wall.setUTCFullYear(year);
  if (wall.getUTCFullYear() !== year) return false;
  if (wall.getUTCMonth() !== month - 1) return false;
  if (wall.getUTCDate() !== day) return false;
  if (wall.getUTCHours() !== hour) return false;
  if (wall.getUTCMinutes() !== minute) return false;
  return true;
}

/**
 * Resolve components to an instant.
 *
 * The wall clock is interpreted as UTC, then shifted by the stated timezone
 * offset (if any). Hours are already in 24-hour form by the time they are
 * assigned; `meridiem` is metadata that only the date/time merge consults.
 *
 * @param components - Components to resolve
 */
export function toDate(components: Components): Date {
  const year = getComponent(components, 'year') ?? 1970;
  const month = getComponent(components, 'month') ?? 1;
  const day = getComponent(components, 'day') ?? 1;
  const hour = getComponent(components, 'hour') ?? 0;
  const minute = getComponent(components, 'minute') ?? 0;
  const second = getComponent(components, 'second') ?? 0;
  const millisecond = getComponent(components, 'millisecond') ?? 0;

  // `Date.UTC` maps years 0-99 onto 1900-1999; set the full year afterwards.
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  date.setUTCFullYear(year);

  const offsetMinutes = getComponent(components, 'timezoneOffset');
  if (offsetMinutes !== undefined && offsetMinutes !== 0) {
    return new Date(date.getTime() - offsetMinutes * 60_000);
  }
  return date;
}

/**
 * Start of the week (Sunday, midnight UTC) containing `ref`.
 * @param ref - Reference instant
 */
export function startOfWeekUtc(ref: Date): Date {
  return new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - ref.getUTCDay(), 0, 0, 0, 0)
  );
}

/**
 * Copy the reference's date fields, using `write` for each one.
 *
 * @param components - Components to mutate
 * @param target - Instant whose date fields are used
 * @param write - `imply` (fills implied, never overwrites known) or `assign` (writes known)
 */
function copySimilarDateFields(
  components: Components,
  target: Date,
  write: typeof imply | typeof assign,
): Components {
  write(components, 'day', target.getUTCDate());
  write(components, 'month', target.getUTCMonth() + 1);
  write(components, 'year', target.getUTCFullYear());
  return components;
}

/**
 * Copy the reference's time fields, using `write` for each one.
 *
 * @param components - Components to mutate
 * @param target - Instant whose time fields are used
 * @param write - `imply` (fills implied, never overwrites known) or `assign` (writes known)
 */
function copySimilarTimeFields(
  components: Components,
  target: Date,
  write: typeof imply | typeof assign,
): Components {
  write(components, 'hour', target.getUTCHours());
  write(components, 'minute', target.getUTCMinutes());
  write(components, 'second', target.getUTCSeconds());
  write(components, 'millisecond', target.getUTCMilliseconds());
  write(components, 'meridiem', target.getUTCHours() < 12 ? MERIDIEM_AM : MERIDIEM_PM);
  return components;
}

/**
 * Copy the reference's date fields into implied values.
 * @param components - Components to mutate
 * @param target - Instant whose date fields are used
 */
export function implySimilarDate(components: Components, target: Date): Components {
  return copySimilarDateFields(components, target, imply);
}

/**
 * Copy the reference's date fields into known values.
 * @param components - Components to mutate
 * @param target - Instant whose date fields are used
 */
export function assignSimilarDate(components: Components, target: Date): Components {
  return copySimilarDateFields(components, target, assign);
}

/**
 * Copy the reference's time fields into implied values.
 * @param components - Components to mutate
 * @param target - Instant whose time fields are used
 */
export function implySimilarTime(components: Components, target: Date): Components {
  return copySimilarTimeFields(components, target, imply);
}

/**
 * Copy the reference's time fields into known values.
 * @param components - Components to mutate
 * @param target - Instant whose time fields are used
 */
export function assignSimilarTime(components: Components, target: Date): Components {
  return copySimilarTimeFields(components, target, assign);
}

/**
 * Shift components by a duration, keeping stated fields where the duration
 * does not touch their unit.
 * @param components - Components to mutate
 * @param duration - Duration to add
 */
export function addDurationAsImplied(components: Components, duration: Duration): Components {
  const current = toDate(components);
  const date = addDuration(current, duration);

  if ('day' in duration || 'week' in duration || 'month' in duration || 'year' in duration) {
    unset(components, 'day');
    unset(components, 'weekday');
    unset(components, 'month');
    unset(components, 'year');
    imply(components, 'day', date.getUTCDate());
    imply(components, 'weekday', date.getUTCDay());
    imply(components, 'month', date.getUTCMonth() + 1);
    imply(components, 'year', date.getUTCFullYear());
  }
  if ('second' in duration || 'minute' in duration || 'hour' in duration) {
    unset(components, 'second');
    unset(components, 'minute');
    unset(components, 'hour');
    imply(components, 'second', date.getUTCSeconds());
    imply(components, 'minute', date.getUTCMinutes());
    imply(components, 'hour', date.getUTCHours());
  }
  return components;
}

/**
 * Build components positioned at the reference date shifted by a duration.
 *
 * Time-bearing durations resolve to the exact instant (date and time are both
 * known); date-bearing durations keep the reference's time of day implied.
 *
 * @param context - Parse context holding the reference instant
 * @param duration - Offset from the reference
 */
export function createRelativeFromReference(context: ParseContext, duration: Duration = { day: 0, second: 0, millisecond: 0 }): Components {
  const date = addDuration(context.refDate, duration);
  const components = createComponents(context);
  components.tags.add('result/relativeDate');

  if ('hour' in duration || 'minute' in duration || 'second' in duration || 'millisecond' in duration) {
    components.tags.add('result/relativeDateAndTime');
    assignSimilarTime(components, date);
    assignSimilarDate(components, date);
    assign(components, 'timezoneOffset', 0);
    return components;
  }

  implySimilarTime(components, date);
  imply(components, 'timezoneOffset', 0);
  if ('day' in duration) {
    assign(components, 'day', date.getUTCDate());
    assign(components, 'month', date.getUTCMonth() + 1);
    assign(components, 'year', date.getUTCFullYear());
    assign(components, 'weekday', date.getUTCDay());
  } else if ('week' in duration) {
    assign(components, 'day', date.getUTCDate());
    assign(components, 'month', date.getUTCMonth() + 1);
    assign(components, 'year', date.getUTCFullYear());
    imply(components, 'weekday', date.getUTCDay());
  } else {
    imply(components, 'day', date.getUTCDate());
    if ('month' in duration) {
      assign(components, 'month', date.getUTCMonth() + 1);
      assign(components, 'year', date.getUTCFullYear());
    } else {
      imply(components, 'month', date.getUTCMonth() + 1);
      if ('year' in duration) {
        assign(components, 'year', date.getUTCFullYear());
      } else {
        imply(components, 'year', date.getUTCFullYear());
      }
    }
  }
  return components;
}

/**
 * Clone components, including their tag set.
 * @param components - Components to clone
 */
export function cloneComponents(components: Components): Components {
  return {
    known: { ...components.known },
    implied: { ...components.implied },
    tags: new Set(components.tags),
  };
}
