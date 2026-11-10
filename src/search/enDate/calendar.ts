/**
 * Calendar arithmetic for the in-repo English date parser.
 *
 * All math is done on UTC fields (`Date.UTC`, `getUTC*`) so a parse produces
 * the same instant on every host, independent of the machine's `TZ`. Duration
 * carry rules follow chrono-node's `addDuration`: whole units are applied with
 * the matching `setUTC*` call, and a fractional remainder rolls into the next
 * smaller unit.
 *
 * @module search/enDate/calendar
 * @internal
 */

import type { Duration } from './types.js';

/**
 * Weekday index (0 = Sunday) of an instant in UTC.
 * @param date - Instant to inspect
 */
export function weekdayOf(date: Date): number {
  return date.getUTCDay();
}

/**
 * Days from `ref` forward to `weekday` (0 when they match).
 * @param ref - Reference instant
 * @param weekday - Target weekday index (0 = Sunday)
 */
export function daysForwardToWeekday(ref: Date, weekday: number): number {
  const refWeekday = weekdayOf(ref);
  let forward = weekday - refWeekday;
  if (forward < 0) forward += 7;
  return forward;
}

/**
 * Days from `ref` backward to `weekday` (negative or 0).
 * @param ref - Reference instant
 * @param weekday - Target weekday index (0 = Sunday)
 */
export function daysBackwardToWeekday(ref: Date, weekday: number): number {
  const refWeekday = weekdayOf(ref);
  let backward = weekday - refWeekday;
  if (backward >= 0) backward -= 7;
  return backward;
}

/**
 * Signed day offset for `next`/`last`/`this` + weekday, or the closest
 * occurrence when no modifier is present.
 * @param ref - Reference instant
 * @param weekday - Target weekday index (0 = Sunday)
 * @param modifier - `next`, `last`, `this`, or undefined for the closest day
 */
export function daysToWeekday(
  ref: Date,
  weekday: number,
  modifier: 'next' | 'last' | 'this' | undefined
): number {
  const refWeekday = weekdayOf(ref);
  switch (modifier) {
    case 'this':
      return daysForwardToWeekday(ref, weekday);
    case 'last':
      return daysBackwardToWeekday(ref, weekday);
    case 'next':
      if (refWeekday === 0) return weekday === 0 ? 7 : weekday;
      if (refWeekday === 6) {
        if (weekday === 6) return 7;
        if (weekday === 0) return 8;
        return 1 + weekday;
      }
      if (weekday < refWeekday && weekday !== 0) {
        return daysForwardToWeekday(ref, weekday);
      }
      return daysForwardToWeekday(ref, weekday) + 7;
    default: {
      const backward = daysBackwardToWeekday(ref, weekday);
      const forward = daysForwardToWeekday(ref, weekday);
      return forward < -backward ? forward : backward;
    }
  }
}

/**
 * Add a duration to an instant. The input is never mutated.
 * @param ref - Instant to start from
 * @param duration - Duration fragments to add
 */
export function addDuration(ref: Date, duration: Duration): Date {
  const date = new Date(ref.getTime());

  if ('year' in duration) {
    const whole = Math.floor(duration.year as number);
    date.setUTCFullYear(date.getUTCFullYear() + whole);
    const remainder = (duration.year as number) - whole;
    if (remainder > 0) duration.month = (duration.month ?? 0) + remainder * 12;
  }
  if ('quarter' in duration) {
    date.setUTCMonth(date.getUTCMonth() + Math.floor(duration.quarter as number) * 3);
  }
  if ('month' in duration) {
    const whole = Math.floor(duration.month as number);
    date.setUTCMonth(date.getUTCMonth() + whole);
    const remainder = (duration.month as number) - whole;
    if (remainder > 0) duration.week = (duration.week ?? 0) + remainder * 4;
  }
  if ('week' in duration) {
    const whole = Math.floor(duration.week as number);
    date.setUTCDate(date.getUTCDate() + whole * 7);
    const remainder = (duration.week as number) - whole;
    if (remainder > 0) duration.day = (duration.day ?? 0) + Math.round(remainder * 7);
  }
  if ('day' in duration) {
    const whole = Math.floor(duration.day as number);
    date.setUTCDate(date.getUTCDate() + whole);
    const remainder = (duration.day as number) - whole;
    if (remainder > 0) duration.hour = (duration.hour ?? 0) + Math.round(remainder * 24);
  }
  if ('hour' in duration) {
    const whole = Math.floor(duration.hour as number);
    date.setUTCHours(date.getUTCHours() + whole);
    const remainder = (duration.hour as number) - whole;
    if (remainder > 0) duration.minute = (duration.minute ?? 0) + Math.round(remainder * 60);
  }
  if ('minute' in duration) {
    const whole = Math.floor(duration.minute as number);
    date.setUTCMinutes(date.getUTCMinutes() + whole);
    const remainder = (duration.minute as number) - whole;
    if (remainder > 0) duration.second = (duration.second ?? 0) + Math.round(remainder * 60);
  }
  if ('second' in duration) {
    const whole = Math.floor(duration.second as number);
    date.setUTCSeconds(date.getUTCSeconds() + whole);
    const remainder = (duration.second as number) - whole;
    if (remainder > 0) duration.millisecond = (duration.millisecond ?? 0) + Math.round(remainder * 1000);
  }
  if ('millisecond' in duration) {
    date.setUTCMilliseconds(date.getUTCMilliseconds() + Math.floor(duration.millisecond as number));
  }
  return date;
}

/**
 * Negate every fragment of a duration.
 * @param duration - Duration to negate
 */
export function reverseDuration(duration: Duration): Duration {
  const reversed: Duration = {};
  for (const key of Object.keys(duration) as (keyof Duration)[]) {
    reversed[key] = -(duration[key] as number);
  }
  return reversed;
}

/**
 * Map a two-digit year onto the 1900s or 2000s, and pass larger years through.
 * @param year - Year as written
 */
export function mostLikelyAdYear(year: number): number {
  if (year < 100) return year > 50 ? year + 1900 : year + 2000;
  return year;
}

/**
 * Year nearest to the reference date for a month/day with no stated year.
 *
 * The candidate, next year, and last year are compared by absolute distance
 * to the reference; the nearest wins. Comparison uses UTC fields so the
 * answer does not depend on the host timezone.
 *
 * @param ref - Reference instant
 * @param day - Day of month
 * @param month - Month number (1-12)
 */
export function yearClosestToRef(ref: Date, day: number, month: number): number {
  const candidate = new Date(ref.getTime());
  candidate.setUTCMonth(month - 1);
  candidate.setUTCDate(day);
  const nextYear = new Date(candidate.getTime());
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  const lastYear = new Date(candidate.getTime());
  lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1);

  let best = candidate;
  if (Math.abs(nextYear.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime())) {
    best = nextYear;
  } else if (Math.abs(lastYear.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime())) {
    best = lastYear;
  }
  return best.getUTCFullYear();
}
