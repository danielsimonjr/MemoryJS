/**
 * English date refiners for the in-repo date parser.
 *
 * Refiners run after the parsers, in a fixed order: they remove overlapping
 * matches, fill in an implied year/time-suffix, merge a date with a clock time
 * and merge two dates into a range. The order and behaviour mirror chrono-node
 * 2.9.1's English configuration.
 *
 * See THIRD_PARTY_NOTICES for the chrono-node copyright and MIT license text.
 *
 * @module search/enDate/refiners
 * @internal
 */

import type { ComponentKey, Components, ParseContext, ParsedResult } from './types.js';
import { MERIDIEM_PM } from './types.js';
import {
  assign,
  assignSimilarDate,
  cloneComponents,
  createRelativeFromReference,
  getComponent,
  imply,
  implySimilarDate,
  isCertain,
  isDateWithUnknownYear,
  isOnlyDate,
  isOnlyTime,
  isOnlyWeekday,
  isValidDate,
  toDate,
} from './components.js';
import { addDuration, daysForwardToWeekday, reverseDuration } from './calendar.js';
import { parseDuration, parseYear } from './constants.js';
import { timezoneOffsetFor } from './timezones.js';

/** A refiner transforms the result list. */
export interface EnRefiner {
  /** Stable name used in diagnostics. */
  readonly name: string;
  /** Order the list is passed through. */
  refine(context: ParseContext, results: ParsedResult[]): ParsedResult[];
}

/** Remove a result that overlaps the previous, longer match. */
const overlapRemovalRefiner: EnRefiner = {
  name: 'OverlapRemovalRefiner',
  refine(_context, results) {
    if (results.length < 2) return results;

    const filtered: ParsedResult[] = [];
    let prevResult = results[0];
    for (let i = 1; i < results.length; i++) {
      const result = results[i];
      if (result.index >= prevResult.index + prevResult.text.length) {
        filtered.push(prevResult);
        prevResult = result;
        continue;
      }
      prevResult = result.text.length > prevResult.text.length ? result : prevResult;
    }
    if (prevResult != null) filtered.push(prevResult);
    return filtered;
  },
};

/** Pull a trailing `UTC+2`-style offset into the result. */const TIMEZONE_OFFSET_SUFFIX = /^\s*(?:\(?(?:GMT|UTC)\s?)?([+-])(\d{1,2})(?::?(\d{2}))?\)?/i;

const extractTimezoneOffsetRefiner: EnRefiner = {
  name: 'ExtractTimezoneOffsetRefiner',
  refine(context, results) {
    for (const result of results) {
      if (isCertain(result.start, 'timezoneOffset')) continue;

      const suffix = context.text.substring(result.index + result.text.length);
      const match = TIMEZONE_OFFSET_SUFFIX.exec(suffix);
      if (!match) continue;

      const hourOffset = parseInt(match[2], 10);
      const minuteOffset = parseInt(match[3] ?? '0', 10);
      let timezoneOffset = hourOffset * 60 + minuteOffset;
      if (timezoneOffset > 14 * 60) continue;
      if (match[1] === '-') timezoneOffset = -timezoneOffset;

      if (result.end) assign(result.end, 'timezoneOffset', timezoneOffset);
      assign(result.start, 'timezoneOffset', timezoneOffset);
      result.text += match[0];
    }
    return results;
  },
};

/** Pull a trailing zone abbreviation (`5pm EST`) into the result. */
const TIMEZONE_NAME_SUFFIX = /^\s*,?\s*\(?([A-Z]{2,4})\)?(?=\W|$)/i;

const extractTimezoneAbbrRefiner: EnRefiner = {
  name: 'ExtractTimezoneAbbrRefiner',
  refine(context, results) {
    for (const result of results) {
      const suffix = context.text.substring(result.index + result.text.length);
      const match = TIMEZONE_NAME_SUFFIX.exec(suffix);
      if (!match) continue;

      const timezoneAbbr = match[1].toUpperCase();
      const offset = timezoneOffsetFor(timezoneAbbr, toDate(result.start));
      if (offset == null) continue;

      const currentOffset = getComponent(result.start, 'timezoneOffset');
      if (currentOffset !== null && currentOffset !== undefined && offset !== currentOffset) {
        if (isCertain(result.start, 'timezoneOffset')) continue;
        if (timezoneAbbr !== match[1]) continue;
      }
      if (isOnlyDate(result.start) && timezoneAbbr !== match[1]) continue;

      result.text += match[0];
      if (!isCertain(result.start, 'timezoneOffset')) {
        assign(result.start, 'timezoneOffset', offset);
      }
      if (result.end && !isCertain(result.end, 'timezoneOffset')) {
        assign(result.end, 'timezoneOffset', offset);
      }
    }
    return results;
  },
};

/** Merge a bare weekday with a following date that states a day. */
const mergeWeekdayComponentRefiner: EnRefiner = {
  name: 'MergeWeekdayComponentRefiner',
  refine(context, results) {
    if (results.length < 2) return results;

    const merged: ParsedResult[] = [];
    let current = results[0];
    for (let i = 1; i < results.length; i++) {
      const next = results[i];
      const textBetween = context.text.substring(current.index + current.text.length, next.index);
      const weekdayThenDate =
        isOnlyWeekday(current.start) && !isCertain(current.start, 'hour') && isCertain(next.start, 'day');
      if (!weekdayThenDate || !/^,?\s*$/.test(textBetween)) {
        merged.push(current);
        current = next;
        continue;
      }
      const newResult: ParsedResult = {
        index: current.index,
        text: current.text + textBetween + next.text,
        start: cloneComponents(next.start),
      };
      if (next.end) newResult.end = cloneComponents(next.end);
      assign(newResult.start, 'weekday', getComponent(current.start, 'weekday') as number);
      if (newResult.end) assign(newResult.end, 'weekday', getComponent(current.start, 'weekday') as number);
      current = newResult;
    }
    merged.push(current);
    return merged;
  },
};

/** Shift a result forward when `forwardDate` is set and it already passed. */
const forwardDateRefiner: EnRefiner = {
  name: 'ForwardDateRefiner',
  refine(context, results) {
    if (!context.options.forwardDate) return results;

    for (const result of results) {
      const refDate = context.refDate;

      if (isOnlyTime(result.start) && refDate > toDate(result.start)) {
        const refFollowingDay = new Date(refDate.getTime());
        refFollowingDay.setUTCDate(refFollowingDay.getUTCDate() + 1);
        implySimilarDate(result.start, refFollowingDay);

        if (result.end && isOnlyTime(result.end)) {
          implySimilarDate(result.end, refFollowingDay);
          if (toDate(result.start) > toDate(result.end)) {
            refFollowingDay.setUTCDate(refFollowingDay.getUTCDate() + 1);
            implySimilarDate(result.end, refFollowingDay);
          }
        }
      }

      if (isOnlyWeekday(result.start) && refDate > toDate(result.start)) {
        const weekday = getComponent(result.start, 'weekday') as number;
        const daysToAdd = daysForwardToWeekday(refDate, weekday) || 7;
        implySimilarDate(result.start, addDuration(refDate, { day: daysToAdd }));

        if (result.end && toDate(result.start) > toDate(result.end)) {
          const endDaysToAdd = daysForwardToWeekday(refDate, weekday) || 7;
          implySimilarDate(result.end, addDuration(refDate, { day: endDaysToAdd }));
        }
      }

      if (isDateWithUnknownYear(result.start) && refDate > toDate(result.start)) {
        for (let i = 0; i < 3 && refDate > toDate(result.start); i++) {
          imply(result.start, 'year', (getComponent(result.start, 'year') as number) + 1);
          if (result.end && !isCertain(result.end, 'year')) {
            imply(result.end, 'year', (getComponent(result.end, 'year') as number) + 1);
          }
        }
      }
    }
    return results;
  },
};

/** Merge a result that names a date with a following `+2 days` / `-1 week`. */
const mergeRelativeAfterDateRefiner: EnRefiner = {
  name: 'MergeRelativeAfterDateRefiner',
  refine(context, results) {
    return mergeAdjacent(
      context,
      results,
      (textBetween, _current, next) => /^\s*$/i.test(textBetween) && /^[+-]/.test(next.text),
      (textBetween, current, next) => {
        let duration = parseDuration(next.text);
        if (!duration) return current;
        if (/^-/.test(next.text)) duration = reverseDuration(duration);
        const start = createRelativeFromReference(
          { ...context, refDate: toDate(current.start) },
          duration
        );
        return {
          index: current.index,
          text: current.text + textBetween + next.text,
          start,
        };
      }
    );
  },
};

/** Merge `3 days after` / `2 weeks before` with the date that follows it. */
const mergeRelativeFollowByDateRefiner: EnRefiner = {
  name: 'MergeRelativeFollowByDateRefiner',
  refine(context, results) {
    return mergeAdjacent(
      context,
      results,
      (textBetween, current, next) =>
        /^\s*$/i.test(textBetween) &&
        /(\s+(before|from)|\s+(after|since))$/i.test(current.text) &&
        getComponent(next.start, 'day') !== undefined &&
        getComponent(next.start, 'month') !== undefined &&
        getComponent(next.start, 'year') !== undefined,
      (textBetween, current, next) => {
        let duration = parseDuration(current.text);
        if (!duration) return current;
        if (/\s+(before|from)$/i.test(current.text)) duration = reverseDuration(duration);
        const start = createRelativeFromReference(
          { ...context, refDate: toDate(next.start) },
          duration
        );
        return {
          index: current.index,
          text: current.text + textBetween + next.text,
          start,
        };
      }
    );
  },
};

/** Merge a date and a neighbouring clock time into one result. */
const mergeDateTimeRefiner: EnRefiner = {
  name: 'ENMergeDateTimeRefiner',
  refine(context, results) {
    return mergeAdjacent(context, results, (textBetween, current, next) => {
      const mergeable =
        (isOnlyDate(current.start) && isOnlyTime(next.start)) ||
        (isOnlyDate(next.start) && isOnlyTime(current.start));
      return mergeable && /^\s*(T|at|after|before|on|of|,|-|\.|∙|:)?\s*$/.test(textBetween);
    }, (textBetween, current, next) => {
      const [dateResult, timeResult] = isOnlyDate(current.start)
        ? [current, next]
        : [next, current];
      const result = mergeDateTimeResult(dateResult, timeResult);
      result.index = current.index;
      result.text = current.text + textBetween + next.text;
      return result;
    });
  },
};

/** Merge two dates joined by `to`, `-`, `until`, `through`, or `till`. */
const mergeDateRangeRefiner: EnRefiner = {
  name: 'ENMergeDateRangeRefiner',
  refine(context, results) {
    return mergeAdjacent(
      context,
      results,
      (textBetween, current, next) =>
        !current.end && !next.end && /^\s*(to|-|–|until|through|till)\s*$/i.test(textBetween),
      (textBetween, fromResult, toResult) => mergeDateRange(fromResult, toResult, textBetween)
    );
  },
};

/** Merge a trailing year onto a result that states a month but no year. */
const YEAR_SUFFIX_PATTERN = new RegExp(`^\\s*([1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3}|[5-9][0-9]|2[0-5])`, 'i');

const extractYearSuffixRefiner: EnRefiner = {
  name: 'ENExtractYearSuffixRefiner',
  refine(context, results) {
    for (const result of results) {
      if (!isDateWithUnknownYear(result.start)) continue;

      const suffix = context.text.substring(result.index + result.text.length);
      const match = YEAR_SUFFIX_PATTERN.exec(suffix);
      if (!match) continue;
      if (match[0].trim().length <= 3) continue;

      const year = parseYear(match[1]);
      if (result.end) assign(result.end, 'year', year);
      assign(result.start, 'year', year);
      result.text += match[0];
    }
    return results;
  },
};

/**
 * Drop matches that are not a real calendar date, are just a number, or are
 * the common English word `may` outside an `in May` phrase.
 */
const unlikelyFormatFilter: EnRefiner = {
  name: 'UnlikelyFormatFilter',
  refine(context, results) {
    return results.filter((result) => {
      const text = result.text.trim();
      if (/^\d*(\.\d*)?$/.test(result.text.replace(' ', ''))) return false;
      if (!isValidDate(result.start)) return false;
      if (result.end && !isValidDate(result.end)) return false;

      if (text === context.text.trim()) return true;
      if (text.toLowerCase() === 'may') {
        const textBefore = context.text.substring(0, result.index).trim();
        return /\b(in)$/i.test(textBefore);
      }
      if (text.toLowerCase().endsWith('the second')) return false;
      return true;
    });
  },
};

/** Walk adjacent results, merging while `shouldMerge` holds. */
function mergeAdjacent(
  _context: ParseContext,
  results: ParsedResult[],
  shouldMerge: (textBetween: string, current: ParsedResult, next: ParsedResult) => boolean,
  merge: (textBetween: string, current: ParsedResult, next: ParsedResult) => ParsedResult
): ParsedResult[] {
  if (results.length < 2) return results;

  const merged: ParsedResult[] = [];
  let current = results[0];
  for (let i = 1; i < results.length; i++) {
    const next = results[i];
    const textBetween = _context.text.substring(current.index + current.text.length, next.index);
    if (!shouldMerge(textBetween, current, next)) {
      merged.push(current);
      current = next;
      continue;
    }
    current = merge(textBetween, current, next);
  }
  merged.push(current);
  return merged;
}

/** Combine two date results into a range. */
function mergeDateRange(fromResult: ParsedResult, toResult: ParsedResult, textBetween: string): ParsedResult {
  const from = cloneResult(fromResult);
  const to = cloneResult(toResult);

  if (!isOnlyWeekday(from.start) && !isOnlyWeekday(to.start)) {
    for (const key of Object.keys(to.start.known) as ComponentKey[]) {
      if (!isCertain(from.start, key)) imply(from.start, key, getComponent(to.start, key) as number);
    }
    for (const key of Object.keys(from.start.known) as ComponentKey[]) {
      if (!isCertain(to.start, key)) imply(to.start, key, getComponent(from.start, key) as number);
    }
  }

  if (toDate(from.start) > toDate(to.start)) {
    let toDateValue = toDate(to.start);
    if (isOnlyWeekday(to.start) && addDuration(toDateValue, { day: 7 }) > toDate(from.start)) {
      toDateValue = addDuration(toDateValue, { day: 7 });
      imply(to.start, 'day', toDateValue.getUTCDate());
      imply(to.start, 'month', toDateValue.getUTCMonth() + 1);
      imply(to.start, 'year', toDateValue.getUTCFullYear());
    } else if (isOnlyWeekday(from.start) && addDuration(toDate(from.start), { day: -7 }) < toDate(to.start)) {
      const newFrom = addDuration(toDate(from.start), { day: -7 });
      imply(from.start, 'day', newFrom.getUTCDate());
      imply(from.start, 'month', newFrom.getUTCMonth() + 1);
      imply(from.start, 'year', newFrom.getUTCFullYear());
    } else if (isDateWithUnknownYear(to.start) && addDuration(toDateValue, { year: 1 }) > toDate(from.start)) {
      toDateValue = addDuration(toDateValue, { year: 1 });
      imply(to.start, 'year', toDateValue.getUTCFullYear());
    } else if (
      isDateWithUnknownYear(from.start) &&
      addDuration(toDate(from.start), { year: -1 }) < toDate(to.start)
    ) {
      const newFrom = addDuration(toDate(from.start), { year: -1 });
      imply(from.start, 'year', newFrom.getUTCFullYear());
    } else {
      [from.start, to.start] = [to.start, from.start];
    }
  }

  const result: ParsedResult = {
    index: Math.min(fromResult.index, toResult.index),
    text:
      fromResult.index < toResult.index
        ? fromResult.text + textBetween + toResult.text
        : toResult.text + textBetween + fromResult.text,
    start: from.start,
    end: to.start,
  };
  return result;
}

/** Merge a date result with a time result. */
function mergeDateTimeResult(dateResult: ParsedResult, timeResult: ParsedResult): ParsedResult {
  const beginDate = dateResult.start;
  const beginTime = timeResult.start;
  const start = mergeDateTimeComponent(beginDate, beginTime);
  const result: ParsedResult = { index: dateResult.index, text: dateResult.text, start };

  if (dateResult.end != null || timeResult.end != null) {
    const endDate = dateResult.end ?? dateResult.start;
    const endTime = timeResult.end ?? timeResult.start;
    const endDateTime = mergeDateTimeComponent(endDate, endTime);

    if (dateResult.end == null && toDate(endDateTime) < toDate(start)) {
      const nextDay = new Date(toDate(endDateTime).getTime());
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      if (isCertain(endDateTime, 'day')) assignSimilarDate(endDateTime, nextDay);
      else implySimilarDate(endDateTime, nextDay);
    }
    result.end = endDateTime;
  }
  return result;
}

/** Overlay a time's fields onto a date's fields. */
function mergeDateTimeComponent(dateComponent: Components, timeComponent: Components): Components {
  const dateTime = cloneComponents(dateComponent);

  if (isCertain(timeComponent, 'hour')) {
    assign(dateTime, 'hour', getComponent(timeComponent, 'hour') as number);
    assign(dateTime, 'minute', getComponent(timeComponent, 'minute') as number);
    if (isCertain(timeComponent, 'second')) {
      assign(dateTime, 'second', getComponent(timeComponent, 'second') as number);
      if (isCertain(timeComponent, 'millisecond')) {
        assign(dateTime, 'millisecond', getComponent(timeComponent, 'millisecond') as number);
      } else {
        imply(dateTime, 'millisecond', getComponent(timeComponent, 'millisecond') as number);
      }
    } else {
      imply(dateTime, 'second', getComponent(timeComponent, 'second') as number);
      imply(dateTime, 'millisecond', getComponent(timeComponent, 'millisecond') as number);
    }
  } else {
    imply(dateTime, 'hour', getComponent(timeComponent, 'hour') as number);
    imply(dateTime, 'minute', getComponent(timeComponent, 'minute') as number);
    imply(dateTime, 'second', getComponent(timeComponent, 'second') as number);
    imply(dateTime, 'millisecond', getComponent(timeComponent, 'millisecond') as number);
  }

  if (isCertain(timeComponent, 'timezoneOffset')) {
    assign(dateTime, 'timezoneOffset', getComponent(timeComponent, 'timezoneOffset') as number);
  }

  const dateMeridiem = getComponent(dateComponent, 'meridiem');
  const dateHasMeaningfulMeridiem =
    dateMeridiem != null &&
    (isCertain(dateComponent, 'meridiem') ||
      Array.from(dateComponent.tags).some((tag) => tag.startsWith('casualReference/')));

  if (isCertain(timeComponent, 'meridiem')) {
    assign(dateTime, 'meridiem', getComponent(timeComponent, 'meridiem') as number);
  } else if (getComponent(timeComponent, 'meridiem') != null && !dateHasMeaningfulMeridiem) {
    imply(dateTime, 'meridiem', getComponent(timeComponent, 'meridiem') as number);
  }

  if (getComponent(dateTime, 'meridiem') === MERIDIEM_PM && (getComponent(dateTime, 'hour') as number) < 12) {
    const hour = getComponent(dateTime, 'hour') as number;
    if (isCertain(timeComponent, 'hour')) assign(dateTime, 'hour', hour + 12);
    else imply(dateTime, 'hour', hour + 12);
  }

  for (const tag of dateComponent.tags) dateTime.tags.add(tag);
  for (const tag of timeComponent.tags) dateTime.tags.add(tag);
  return dateTime;
}

/** Clone one result so refiners never mutate their inputs. */
function cloneResult(result: ParsedResult): ParsedResult {
  return {
    index: result.index,
    text: result.text,
    start: cloneComponents(result.start),
    end: result.end ? cloneComponents(result.end) : undefined,
  };
}

/**
 * Refiners, in chrono-node's English casual order.
 *
 * The order is load-bearing: the leading overlap pass removes a shorter
 * neighbouring match before the relative merges see it, and the trailing
 * range merge runs after the date/time merge.
 */
export function createRefiners(): EnRefiner[] {
  return [
    overlapRemovalRefiner,
    mergeRelativeAfterDateRefiner,
    mergeRelativeFollowByDateRefiner,
    overlapRemovalRefiner,
    extractTimezoneOffsetRefiner,
    mergeWeekdayComponentRefiner,
    mergeDateTimeRefiner,
    extractTimezoneAbbrRefiner,
    overlapRemovalRefiner,
    forwardDateRefiner,
    unlikelyFormatFilter,
    mergeDateTimeRefiner,
    extractYearSuffixRefiner,
    mergeDateRangeRefiner,
  ];
}
