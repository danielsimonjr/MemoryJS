/**
 * English date parsers for the in-repo date parser.
 *
 * Each parser scans the input for one family of expressions and proposes
 * components for the slice it matched. The set and order mirror chrono-node's
 * English "casual" configuration (ISO, slash, month-name, weekday, clock
 * time, relative offsets, casual words), and the regular expressions are
 * adapted from chrono-node 2.9.1.
 *
 * See THIRD_PARTY_NOTICES for the chrono-node copyright and MIT license text.
 *
 * @module search/enDate/parsers
 * @internal
 */

import type { Components, ParseContext, ParsedResult } from './types.js';
import { MERIDIEM_AM, MERIDIEM_PM } from './types.js';
import {
  MONTH_DICTIONARY,
  ORDINAL_NUMBER_PATTERN,
  TIME_UNIT_DICTIONARY,
  TIME_UNITS_PATTERN,
  WEEKDAY_DICTIONARY,
  YEAR_PATTERN,
  matchAnyPattern,
  parseDuration,
  parseOrdinalNumberPattern,
  parseYear,
} from './constants.js';
import {
  addDurationAsImplied,
  assign,
  assignSimilarDate,
  assignSimilarTime,
  createComponents,
  createRelativeFromReference,
  getComponent,
  imply,
  implySimilarTime,
  unset,
} from './components.js';
import { daysToWeekday, reverseDuration, yearClosestToRef } from './calendar.js';

// Adapted from chrono-node (https://github.com/wanasit/chrono), MIT License.
// Copyright (c) 2014 Wanasit Ranasinghe and contributors.

/** A parser proposes components for a matched slice of the input. */
export interface EnParser {
  /** Stable name used in tags and diagnostics. */
  readonly name: string;
  /** Pattern used to scan the input. */
  pattern(context: ParseContext): RegExp;
  /**
   * Turn a match into components, a full result, or `null` to skip it.
   *
   * `match` is the unshifted match, so `match[1]` holds the left boundary
   * group for boundary-checking parsers.
   */
  extract(context: ParseContext, match: RegExpExecArray): Components | ParsedResult | null;
}

/** Prefix a pattern with a left word-boundary capture group. */
function withLeftBoundary(source: string): RegExp {
  return new RegExp(`(\\W|^)${source}`, 'i');
}

/**
 * Shift a boundary-checking match so group 1 is the first inner group and
 * `index`/`0` no longer include the boundary character.
 * @param match - Raw match from a `withLeftBoundary` pattern
 */
function stripLeftBoundary(match: RegExpExecArray): void {
  const header = match[1] ?? '';
  match.index += header.length;
  match[0] = match[0].substring(header.length);
  for (let i = 2; i < match.length; i++) {
    match[i - 1] = match[i];
  }
}

/** A parser built from a boundary-checking pattern plus an inner extractor. */
function boundaryParser(
  name: string,
  source: string,
  extract: (context: ParseContext, match: RegExpExecArray) => Components | ParsedResult | null
): EnParser {
  const regex = withLeftBoundary(source);
  return {
    name,
    pattern: () => regex,
    extract(context, match) {
      stripLeftBoundary(match);
      return extract(context, match);
    },
  };
}

/** `(Month D)` result helper: a range end that shares the start's components. */
function withDayEnd(start: Components, endDay: number): ParsedResult {
  return {
    index: 0,
    text: '',
    start,
    end: { known: { ...start.known, day: endDay }, implied: { ...start.implied }, tags: new Set(start.tags) },
  };
}

// ---------------------------------------------------------------------------
// ISO 8601
// ---------------------------------------------------------------------------

const ISO_PATTERN =
  '([0-9]{4})\\-([0-9]{1,2})\\-([0-9]{1,2})' +
  '(?:T' +
  '([0-9]{1,2}):([0-9]{1,2})' +
  '(?:' +
  ':([0-9]{1,2})(?:\\.(\\d{1,4}))?' +
  ')?' +
  '(' +
  'Z|([+-]\\d{2}):?(\\d{2})?' +
  ')?' +
  ')?' +
  '(?=\\W|$)';

const isoParser = boundaryParser('ISOFormatParser', ISO_PATTERN, (context, match) => {
  const components = createComponents(context, {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  });

  if (match[4] != null) {
    assign(components, 'hour', parseInt(match[4], 10));
    assign(components, 'minute', parseInt(match[5], 10));
    if (match[6] != null) assign(components, 'second', parseInt(match[6], 10));
    if (match[7] != null) assign(components, 'millisecond', parseInt(match[7], 10));
    if (match[8] != null) {
      let offset = 0;
      if (match[9]) {
        const hourOffset = parseInt(match[9], 10);
        const minuteOffset = match[10] != null ? parseInt(match[10], 10) : 0;
        offset = hourOffset * 60;
        offset = offset < 0 ? offset - minuteOffset : offset + minuteOffset;
      }
      assign(components, 'timezoneOffset', offset);
    }
  }
  components.tags.add('parser/ISOFormatParser');
  return components;
});

// ---------------------------------------------------------------------------
// Year-month-day (`2024-06-01`, `2024.06.01`, `2024/06/01`, `2024 June 1`)
// ---------------------------------------------------------------------------

const yearMonthDaySource =
  '([0-9]{4})[-\\.\\/\\s]' +
  `(?:(${matchAnyPattern(MONTH_DICTIONARY)})|([0-9]{1,2}))[-.\\/\\s]` +
  '([0-9]{1,2})' +
  '(?=\\W|$)';

const yearMonthDayParser = boundaryParser('ENYearMonthDayParser', yearMonthDaySource, (context, match) => {
  const year = parseInt(match[1], 10);
  let day = parseInt(match[4], 10);
  let month = match[3] ? parseInt(match[3], 10) : MONTH_DICTIONARY[match[2].toLowerCase()];

  if (month < 1 || month > 12) {
    if (day >= 1 && day <= 12) {
      [month, day] = [day, month];
    }
  }
  if (day < 1 || day > 31) return null;
  return createComponents(context, { day, month, year });
});

// ---------------------------------------------------------------------------
// Slash dates (`1/20/2026`, `20/01/2026`)
// ---------------------------------------------------------------------------

const SLASH_PATTERN_STRING = '([^\\d]|^)([0-3]{0,1}[0-9]{1})[\\/\\.\\-]([0-3]{0,1}[0-9]{1})(?:[\\/\\.\\-]([0-9]{4}|[0-9]{2}))?(\\W|$)';

const slashDateParser: EnParser = {
  name: 'SlashDateFormatParser',
  pattern: () => new RegExp(SLASH_PATTERN_STRING, 'i'),
  extract(context, match) {
    const index = match.index + match[1].length;
    const indexEnd = match.index + match[0].length - match[5].length;

    if (index > 0 && /\d\/?$/.test(context.text.substring(0, index))) return null;
    if (indexEnd < context.text.length && /^\/?\d/.test(context.text.substring(indexEnd))) return null;

    const text = context.text.substring(index, indexEnd);
    if (/^\d\.\d$/.test(text) || /^\d\.\d{1,2}\.\d{1,2}\s*$/.test(text)) return null;
    if (!match[4] && text.indexOf('/') < 0) return null;

    let month = parseInt(match[2], 10);
    let day = parseInt(match[3], 10);
    if (month < 1 || month > 12) {
      if (month > 12) {
        if (day >= 1 && day <= 12 && month <= 31) {
          [day, month] = [month, day];
        } else {
          return null;
        }
      }
    }
    if (day < 1 || day > 31) return null;

    const known: Record<string, number> = { day, month };
    if (match[4]) {
      known.year = parseYear(match[4]);
    } else {
      known.year = yearClosestToRef(context.refDate, day, month);
    }
    const components = createComponents(context, {});
    assign(components, 'day', known.day);
    assign(components, 'month', known.month);
    if (match[4]) assign(components, 'year', known.year);
    else imply(components, 'year', known.year);
    components.tags.add('parser/SlashDateFormatParser');
    return { index, text, start: components };
  },
};

// ---------------------------------------------------------------------------
// Month-day forms
// ---------------------------------------------------------------------------

/** `D Month`, `D-D Month`, `D Month YYYY`. */
const monthNameLittleEndianSource =
  '(?:on\\s{0,3})?' +
  `(${ORDINAL_NUMBER_PATTERN})` +
  '(?:' +
  '\\s{0,3}(?:to|\\-|\\–|until|through|till)?\\s{0,3}' +
  `(${ORDINAL_NUMBER_PATTERN})` +
  ')?' +
  '(?:-|/|\\s{0,3}(?:of)?\\s{0,3})' +
  `(${matchAnyPattern(MONTH_DICTIONARY)})` +
  '(?:' +
  '(?:-|/|,?\\s{0,3})' +
  `(${YEAR_PATTERN}(?!\\w))` +
  ')?' +
  '(?=\\W|$)';

const monthNameLittleEndianParser = boundaryParser(
  'ENMonthNameLittleEndianParser',
  monthNameLittleEndianSource,
  (context, match) => {
    const month = MONTH_DICTIONARY[match[3].toLowerCase()];
    const day = parseOrdinalNumberPattern(match[1]);
    if (day > 31) {
      match.index += match[1].length;
      return null;
    }
    const index = match.index;
    const text = match[0];
    const start = createComponents(context, { month, day });
    if (match[4]) {
      assign(start, 'year', parseYear(match[4]));
    } else {
      imply(start, 'year', yearClosestToRef(context.refDate, day, month));
    }
    if (match[2]) {
      const endDay = parseOrdinalNumberPattern(match[2]);
      const end = withDayEnd(start, endDay);
      end.index = index;
      end.text = text;
      return end;
    }
    return { index, text, start };
  }
);
/** `Month D`, `Month D-D`, `Month D, YYYY`. */
const monthNameMiddleEndianSource =
  `(${matchAnyPattern(MONTH_DICTIONARY)})` +
  '(?:-|/|\\s*,?\\s*)' +
  `(${ORDINAL_NUMBER_PATTERN})(?!\\s*(?:am|pm))\\s*` +
  '(?:' +
  '(?:to|\\-)\\s*' +
  `(${ORDINAL_NUMBER_PATTERN})\\s*` +
  ')?' +
  '(?:' +
  '(?:-|/|\\s*,\\s*|\\s+)' +
  `(${YEAR_PATTERN})` +
  ')?' +
  '(?=\\W|$)(?!\\:\\d)';

const monthNameMiddleEndianParser = boundaryParser(
  'ENMonthNameMiddleEndianParser',
  monthNameMiddleEndianSource,
  (context, match) => {
    const month = MONTH_DICTIONARY[match[1].toLowerCase()];
    const day = parseOrdinalNumberPattern(match[2]);
    if (day > 31) return null;

    const index = match.index;
    const text = match[0];
    const start = createComponents(context, { month, day });
    if (match[4]) {
      assign(start, 'year', parseYear(match[4]));
    } else {
      imply(start, 'year', yearClosestToRef(context.refDate, day, month));
    }
    start.tags.add('parser/ENMonthNameMiddleEndianParser');

    if (!match[3]) return { index, text, start };
    const end = withDayEnd(start, parseOrdinalNumberPattern(match[3]));
    end.index = index;
    end.text = text;
    return end;
  }
);

/** A bare month name, optionally followed by a year. */
const monthNameSource =
  '((?:in)\\s*)?' +
  `(${matchAnyPattern(MONTH_DICTIONARY)})` +
  '\\s*' +
  '(?:' +
  `(?:,|-|of)?\\s*(${YEAR_PATTERN})?` +
  ')?' +
  '(?=[^\\s\\w]|\\s+[^0-9]|\\s+$|$)';

const monthNameParser = boundaryParser('ENMonthNameParser', monthNameSource, (context, match) => {
  const monthName = match[2].toLowerCase();
  if (match[0].length <= 3 && !(monthName in FULL_MONTHS)) return null;

  const index = match.index + (match[1] ?? '').length;
  const text = context.text.substring(index, match.index + match[0].length);
  const start = createComponents(context);
  imply(start, 'day', 1);
  start.tags.add('parser/ENMonthNameParser');
  assign(start, 'month', MONTH_DICTIONARY[monthName]);
  if (match[3]) {
    assign(start, 'year', parseYear(match[3]));
  } else {
    imply(start, 'year', yearClosestToRef(context.refDate, 1, MONTH_DICTIONARY[monthName]));
  }
  return { index, text, start };
});

const FULL_MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

const weekdaySource =
  '(?:(?:\\,|\\(|\\（)\\s*)?' +
  '(?:on\\s*?)?' +
  '(?:(this|last|past|next)\\s*)?' +
  `(${matchAnyPattern(WEEKDAY_DICTIONARY)}|weekend|weekday)` +
  '(?:\\s*(?:\\,|\\)|\\）))?' +
  '(?:\\s*(?:of\\s*)?(this|last|past|next)\\s*week)?' +
  '(?=\\W|$)';

const weekdayParser = boundaryParser('ENWeekdayParser', weekdaySource, (context, match) => {
  const modifierWord = (match[1] || match[3] || '').toLowerCase();
  let modifier: 'next' | 'last' | 'this' | undefined;
  if (modifierWord === 'last' || modifierWord === 'past') modifier = 'last';
  else if (modifierWord === 'next') modifier = 'next';
  else if (modifierWord === 'this') modifier = 'this';

  const weekdayWord = match[2].toLowerCase();
  let weekday = WEEKDAY_DICTIONARY[weekdayWord];
  if (weekday === undefined) {
    if (weekdayWord === 'weekend') {
      weekday = modifier === 'last' ? 0 : 6;
    } else if (weekdayWord === 'weekday') {
      const refWeekday = context.refDate.getUTCDay();
      if (refWeekday === 0 || refWeekday === 6) {
        weekday = modifier === 'last' ? 5 : 1;
      } else {
        let adjusted = refWeekday - 1;
        adjusted = modifier === 'last' ? adjusted - 1 : adjusted + 1;
        weekday = (adjusted % 5) + 1;
      }
    } else {
      return null;
    }
  }

  const start = createComponents(context);
  addDurationAsImplied(start, { day: daysToWeekday(context.refDate, weekday, modifier) });
  assign(start, 'weekday', weekday);
  start.tags.add('parser/ENWeekdayParser');
  return start;
});

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

const PRIMARY_TIME_LEFT_BOUNDARY = '(^|\\s|T|\\b)';
const PRIMARY_TIME_PREFIX = '(?:(?:at|from)\\s*)?';
const PRIMARY_TIME_SUFFIX = '(?:\\s*(?:o\\W*clock|at\\s*night|in\\s*the\\s*(?:morning|afternoon)))?(?!/)(?=\\W|$)';

const PRIMARY_TIME_PATTERN = new RegExp(
  `${PRIMARY_TIME_LEFT_BOUNDARY}${PRIMARY_TIME_PREFIX}` +
    '(\\d{1,4})' +
    '(?:' +
    '(?:\\.|:|：)' +
    '(\\d{1,2})' +
    '(?:' +
    '(?::|：)' +
    '(\\d{2})' +
    '(?:\\.(\\d{1,6}))?' +
    ')?' +
    ')?' +
    '(?:\\s*(a\\.m\\.|p\\.m\\.|am?|pm?))?' +
    PRIMARY_TIME_SUFFIX,
  'i'
);

const FOLLOWING_PHASE = '\\s*(?:\\-|\\–|\\~|\\〜|to|until|through|till|\\?)\\s*';
const FOLLOWING_SUFFIX = '(?!/)(?=\\W|$)';

const FOLLOWING_TIME_PATTERN = new RegExp(
  `^(${FOLLOWING_PHASE})` +
    '(\\d{1,4})' +
    '(?:' +
    '(?:\\.|\\:|\\：)' +
    '(\\d{1,2})' +
    '(?:' +
    '(?:\\.|\\:|\\：)' +
    '(\\d{1,2})(?:\\.(\\d{1,6}))?' +
    ')?' +
    ')?' +
    '(?:\\s*(a\\.m\\.|p\\.m\\.|am?|pm?))?' +
    FOLLOWING_SUFFIX,
  'i'
);

const HOUR_GROUP = 2;
const MINUTE_GROUP = 3;
const SECOND_GROUP = 4;
const MILLI_SECOND_GROUP = 5;
const AM_PM_HOUR_GROUP = 6;

/** Read the hour/minute/second groups of a matched clock time. */
function extractPrimaryTimeComponents(context: ParseContext, match: RegExpExecArray): Components | null {
  const components = createComponents(context);
  let minute = 0;
  let meridiem: number | null = null;
  let hour = parseInt(match[HOUR_GROUP], 10);

  if (hour > 100) {
    if (match[HOUR_GROUP].length === 4 && match[MINUTE_GROUP] == null && !match[AM_PM_HOUR_GROUP]) {
      return null;
    }
    if (match[MINUTE_GROUP] != null) return null;
    minute = hour % 100;
    hour = Math.floor(hour / 100);
  }
  if (hour > 24) return null;

  if (match[MINUTE_GROUP] != null) {
    if (match[MINUTE_GROUP].length === 1 && !match[AM_PM_HOUR_GROUP]) return null;
    minute = parseInt(match[MINUTE_GROUP], 10);
  }
  if (minute >= 60) return null;

  if (hour > 12) meridiem = MERIDIEM_PM;

  if (match[AM_PM_HOUR_GROUP] != null) {
    if (hour > 12) return null;
    const ampm = match[AM_PM_HOUR_GROUP][0].toLowerCase();
    if (ampm === 'a') {
      meridiem = MERIDIEM_AM;
      if (hour === 12) hour = 0;
    }
    if (ampm === 'p') {
      meridiem = MERIDIEM_PM;
      if (hour !== 12) hour += 12;
    }
  }

  assign(components, 'hour', hour);
  assign(components, 'minute', minute);
  if (meridiem !== null) {
    assign(components, 'meridiem', meridiem);
  } else {
    imply(components, 'meridiem', hour < 12 ? MERIDIEM_AM : MERIDIEM_PM);
  }

  if (match[MILLI_SECOND_GROUP] != null) {
    const millisecond = parseInt(match[MILLI_SECOND_GROUP].substring(0, 3), 10);
    if (millisecond >= 1000) return null;
    assign(components, 'millisecond', millisecond);
  }
  if (match[SECOND_GROUP] != null) {
    const second = parseInt(match[SECOND_GROUP], 10);
    if (second >= 60) return null;
    assign(components, 'second', second);
  }
  return components;
}

/** Read the trailing clock time of a range such as `10am-2pm`. */
function extractFollowingTimeComponents(
  context: ParseContext,
  match: RegExpExecArray,
  result: ParsedResult
): Components | null {
  const components = createComponents(context);

  if (match[MILLI_SECOND_GROUP] != null) {
    const millisecond = parseInt(match[MILLI_SECOND_GROUP].substring(0, 3), 10);
    if (millisecond >= 1000) return null;
    assign(components, 'millisecond', millisecond);
  }
  if (match[SECOND_GROUP] != null) {
    const second = parseInt(match[SECOND_GROUP], 10);
    if (second >= 60) return null;
    assign(components, 'second', second);
  }

  let hour = parseInt(match[HOUR_GROUP], 10);
  let minute = 0;
  let meridiem = -1;
  if (match[MINUTE_GROUP] != null) {
    minute = parseInt(match[MINUTE_GROUP], 10);
  } else if (hour > 100) {
    minute = hour % 100;
    hour = Math.floor(hour / 100);
  }
  if (minute >= 60 || hour > 24) return null;

  if (hour >= 12) meridiem = MERIDIEM_PM;

  if (match[AM_PM_HOUR_GROUP] != null) {
    if (hour > 12) return null;
    const ampm = match[AM_PM_HOUR_GROUP][0].toLowerCase();
    if (ampm === 'a') {
      meridiem = MERIDIEM_AM;
      if (hour === 12) {
        hour = 0;
        if (!getComponent(components, 'day')) {
          imply(components, 'day', (getComponent(components, 'day') ?? 1) + 1);
        }
      }
    }
    if (ampm === 'p') {
      meridiem = MERIDIEM_PM;
      if (hour !== 12) hour += 12;
    }
    if (!isCertainMeridiem(result.start)) {
      if (meridiem === MERIDIEM_AM) {
        imply(result.start, 'meridiem', MERIDIEM_AM);
        if (getComponent(result.start, 'hour') === 12) assign(result.start, 'hour', 0);
      } else {
        imply(result.start, 'meridiem', MERIDIEM_PM);
        const startHour = getComponent(result.start, 'hour');
        if (startHour !== undefined && startHour !== 12) {
          assign(result.start, 'hour', startHour + 12);
        }
      }
    }
  }

  assign(components, 'hour', hour);
  assign(components, 'minute', minute);
  if (meridiem >= 0) {
    assign(components, 'meridiem', meridiem);
  } else {
    const startHour = getComponent(result.start, 'hour') ?? 0;
    const startAtPm = isCertainMeridiem(result.start) && startHour > 12;
    if (startAtPm) {
      if (startHour - 12 > hour) {
        imply(components, 'meridiem', MERIDIEM_AM);
      } else if (hour <= 12) {
        assign(components, 'hour', hour + 12);
        assign(components, 'meridiem', MERIDIEM_PM);
      }
    } else if (hour > 12) {
      imply(components, 'meridiem', MERIDIEM_PM);
    } else if (hour <= 12) {
      imply(components, 'meridiem', MERIDIEM_AM);
    }
  }

  if (resolveForComparison(components) < resolveForComparison(result.start)) {
    imply(components, 'day', (getComponent(components, 'day') ?? 1) + 1);
  }
  return components;
}

function isCertainMeridiem(components: Components): boolean {
  return components.known.meridiem !== undefined;
}

/** Instant used only for ordering comparisons inside the time parser. */
function resolveForComparison(components: Components): number {
  const day = getComponent(components, 'day') ?? 1;
  const month = getComponent(components, 'month') ?? 1;
  const year = getComponent(components, 'year') ?? 1970;
  let hour = getComponent(components, 'hour') ?? 0;
  if (getComponent(components, 'meridiem') === MERIDIEM_PM && hour < 12) hour += 12;
  return Date.UTC(year, month - 1, day, hour, getComponent(components, 'minute') ?? 0);
}

/**
 * Shared tail of the two time-pattern checkers: reject an ending with a `.` that is not a run of
 * `\.\d{2}` groups, then reject an ending over 24 (and, on the range path, a start over 24).
 *
 * @param result - Candidate result whose `text` is checked
 * @param kind - `'bare'` for a single time, `'range'` for a merged `start-end` text
 * @returns `result` when it is acceptable, `null` when it must be rejected
 */
function checkAndReturnTimePattern(result: ParsedResult, kind: 'bare' | 'range'): ParsedResult | null {
  const endingPattern = kind === 'bare'
    ? /[^\d:.](\d[\d.]+)$/
    : /[^\d:.](\d[\d.]+)\s*-\s*(\d[\d.]+)$/;
  const endingWithNumbers = endingPattern.exec(result.text);
  if (endingWithNumbers) {
    const endingNumbers = endingWithNumbers[kind === 'bare' ? 1 : 2]!;
    if (endingNumbers.includes('.') && !/\d(\.\d{2})+$/.test(endingNumbers)) return null;
    if (parseInt(endingNumbers, 10) > 24) return null;
    if (kind === 'range' && parseInt(endingWithNumbers[1]!, 10) > 24) return null;
  }
  return result;
}

function checkAndReturnWithoutFollowingPattern(result: ParsedResult): ParsedResult | null {
  if (/^\d$/.test(result.text)) return null;
  if (/^\d\d\d+$/.test(result.text)) return null;
  if (/\d[apAP]$/.test(result.text)) return null;
  return checkAndReturnTimePattern(result, 'bare');
}

function checkAndReturnWithFollowingPattern(result: ParsedResult): ParsedResult | null {
  if (/^\d+-\d+$/.test(result.text)) return null;
  return checkAndReturnTimePattern(result, 'range');
}

const timeExpressionParser: EnParser = {
  name: 'ENTimeExpressionParser',
  pattern: () => PRIMARY_TIME_PATTERN,
  extract(context, match) {
    const startComponents = extractPrimaryTimeComponents(context, match);
    if (!startComponents) {
      match.index += /^\d{4}/.test(match[0]) ? 4 : match[0].length;
      return null;
    }

    // `match[0].endsWith(...)` modifiers from ENTimeExpressionParser.
    const lowerText = match[0].toLowerCase();
    if (lowerText.endsWith('night')) {
      const hour = getComponent(startComponents, 'hour') ?? 0;
      if (hour >= 6 && hour < 12) {
        assign(startComponents, 'hour', hour + 12);
        assign(startComponents, 'meridiem', MERIDIEM_PM);
      } else if (hour < 6) {
        assign(startComponents, 'meridiem', MERIDIEM_AM);
      }
    }
    if (lowerText.endsWith('afternoon')) {
      assign(startComponents, 'meridiem', MERIDIEM_PM);
      const hour = getComponent(startComponents, 'hour') ?? 0;
      if (hour >= 0 && hour <= 6) assign(startComponents, 'hour', hour + 12);
    }
    if (lowerText.endsWith('morning')) {
      assign(startComponents, 'meridiem', MERIDIEM_AM);
    }
    startComponents.tags.add('parser/ENTimeExpressionParser');

    const index = match.index + match[1].length;
    const text = match[0].substring(match[1].length);
    const result: ParsedResult = { index, text, start: startComponents };

    match.index += match[0].length;
    const remainingText = context.text.substring(match.index);
    const followingMatch = FOLLOWING_TIME_PATTERN.exec(remainingText);

    if (/^\d{3,4}/.test(text) && followingMatch) {
      if (/^\s*([+-])\s*\d{2,4}$/.test(followingMatch[0])) return null;
      if (/^\s*([+-])\s*\d{2}\W\d{2}/.test(followingMatch[0])) return null;
    }

    if (!followingMatch || /^\s*([+-])\s*\d{3,4}$/.test(followingMatch[0])) {
      return checkAndReturnWithoutFollowingPattern(result);
    }

    const end = extractFollowingTimeComponents(context, followingMatch, result);
    if (end) {
      result.end = end;
      result.text += followingMatch[0];
      end.tags.add('parser/ENTimeExpressionParser');
    }
    return checkAndReturnWithFollowingPattern(result);
  },
};

// ---------------------------------------------------------------------------
// Relative offsets
// ---------------------------------------------------------------------------

const timeUnitAgoParser = boundaryParser(
  'ENTimeUnitAgoFormatParser',
  `(${TIME_UNITS_PATTERN})\\s{0,5}(?:ago|before|earlier)(?=\\W|$)`,
  (context, match) => {
    const duration = parseDuration(match[1]);
    if (!duration) return null;
    return createRelativeFromReference(context, reverseDuration(duration));
  }
);

const timeUnitLaterParser = boundaryParser(
  'ENTimeUnitLaterFormatParser',
  `(${TIME_UNITS_PATTERN})\\s{0,5}(?:later|after|from now|henceforth|forward|out)(?=(?:\\W|$))`,
  (context, match) => {
    const duration = parseDuration(match[1]);
    if (!duration) return null;
    return createRelativeFromReference(context, duration);
  }
);

/**
 * `in N units` / `within N units`. When `forwardDate` is set, a bare
 * `N units` also resolves forward from the reference.
 */
const timeUnitWithinParser: EnParser = {
  name: 'ENTimeUnitWithinFormatParser',
  pattern(context) {
    const prefix = '(?:(?:about|around|roughly|approximately|just)\\s*(?:~\\s*)?)?';
    const source = context.options.forwardDate
      ? `(?:(?:within|in|for)\\s*)?${prefix}(${TIME_UNITS_PATTERN})(?=\\W|$)`
      : `(?:within|in|for)\\s*${prefix}(${TIME_UNITS_PATTERN})(?=\\W|$)`;
    return withLeftBoundary(source);
  },
  extract(context, match) {
    stripLeftBoundary(match);
    if (/^for\s*the\s*\w+/.test(match[0])) return null;
    const duration = parseDuration(match[1]);
    if (!duration) return null;
    return createRelativeFromReference(context, duration);
  },
};

/**
 * `this|last|past|next <unit>` and `+`/`-` prefixes on a duration.
 * Bare `this week` / `this month` / `this year` resolve to period starts.
 */
const casualRelativeParser = boundaryParser(
  'ENTimeUnitCasualRelativeFormatParser',
  `(this|last|past|next|after|\\+|-)\\s*(${TIME_UNITS_PATTERN})(?=\\W|$)`,
  (context, match) => {
    const prefix = match[1].toLowerCase();
    let duration = parseDuration(match[2]);
    if (!duration) return null;
    if (prefix === 'last' || prefix === 'past' || prefix === '-') duration = reverseDuration(duration);
    return createRelativeFromReference(context, duration);
  }
);

/** `this|last|past|next <day|week|month|quarter|year>`. */
const relativeDateParser = boundaryParser(
  'ENRelativeDateFormatParser',
  `(this|last|past|next|after\\s*this)\\s*(${matchAnyPattern(TIME_UNIT_DICTIONARY)})(?=\\s*)(?=\\W|$)`,
  (context, match) => {
    const modifier = match[1].toLowerCase();
    const unitWord = match[2].toLowerCase();
    const unit = TIME_UNIT_DICTIONARY[unitWord] as 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

    if (modifier === 'next' || modifier.startsWith('after')) {
      return createRelativeFromReference(context, { [unit]: 1 });
    }
    if (modifier === 'last' || modifier === 'past') {
      return createRelativeFromReference(context, { [unit]: -1 });
    }

    const components = createComponents(context);
    const date = new Date(context.refDate.getTime());
    if (/week/i.test(unitWord)) {
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
      imply(components, 'day', date.getUTCDate());
      imply(components, 'month', date.getUTCMonth() + 1);
      imply(components, 'year', date.getUTCFullYear());
    } else if (/month/i.test(unitWord)) {
      date.setUTCDate(1);
      imply(components, 'day', date.getUTCDate());
      assign(components, 'year', date.getUTCFullYear());
      assign(components, 'month', date.getUTCMonth() + 1);
    } else if (/year/i.test(unitWord)) {
      date.setUTCDate(1);
      date.setUTCMonth(0);
      imply(components, 'day', date.getUTCDate());
      imply(components, 'month', date.getUTCMonth() + 1);
      assign(components, 'year', date.getUTCFullYear());
    }
    return components;
  }
);

// ---------------------------------------------------------------------------
// Casual words
// ---------------------------------------------------------------------------

const CASUAL_DATE_SOURCE = '(now|today|tonight|tomorrow|overmorrow|tmr|tmrw|yesterday|last\\s*night)(?=\\W|$)';

const casualDateParser = boundaryParser('ENCasualDateParser', CASUAL_DATE_SOURCE, (context, match) => {
  const lowerText = match[0].toLowerCase();
  let components: Components;

  switch (lowerText) {
    case 'now': {
      const target = context.refDate;
      components = createComponents(context);
      assignSimilarDate(components, target);
      assignSimilarTime(components, target);
      assign(components, 'timezoneOffset', 0);
      components.tags.add('casualReference/now');
      break;
    }
    case 'today': {
      components = createComponents(context);
      assignSimilarDate(components, context.refDate);
      implySimilarTime(components, context.refDate);
      unset(components, 'meridiem');
      components.tags.add('casualReference/today');
      break;
    }
    case 'yesterday': {
      components = createComponents(context);
      const target = shiftDays(context.refDate, -1);
      assignSimilarDate(components, target);
      implySimilarTime(components, target);
      unset(components, 'meridiem');
      components.tags.add('casualReference/yesterday');
      break;
    }
    case 'tomorrow':
    case 'tmr':
    case 'tmrw': {
      components = createComponents(context);
      const target = shiftDays(context.refDate, 1);
      assignSimilarDate(components, target);
      implySimilarTime(components, target);
      unset(components, 'meridiem');
      components.tags.add('casualReference/tomorrow');
      break;
    }
    case 'overmorrow': {
      components = createComponents(context);
      const target = shiftDays(context.refDate, 2);
      assignSimilarDate(components, target);
      implySimilarTime(components, target);
      unset(components, 'meridiem');
      break;
    }
    case 'tonight': {
      components = createComponents(context);
      assignSimilarDate(components, context.refDate);
      imply(components, 'hour', 22);
      imply(components, 'meridiem', MERIDIEM_PM);
      components.tags.add('casualReference/tonight');
      break;
    }
    default: {
      let target = context.refDate;
      if (target.getUTCHours() > 6) target = shiftDays(target, -1);
      components = createComponents(context);
      assignSimilarDate(components, target);
      imply(components, 'hour', 0);
      break;
    }
  }

  components.tags.add('parser/ENCasualDateParser');
  return components;
});

/** Shift an instant by whole days, preserving the time of day. */
function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

const CASUAL_TIME_SOURCE = '(?:this)?\\s{0,3}(morning|afternoon|evening|night|midnight|midday|noon)(?=\\W|$)';

const casualTimeParser = boundaryParser('ENCasualTimeParser', CASUAL_TIME_SOURCE, (context, match) => {
  const word = match[1].toLowerCase();
  const components = createComponents(context);

  switch (word) {
    case 'afternoon':
      imply(components, 'meridiem', MERIDIEM_PM);
      imply(components, 'hour', 15);
      break;
    case 'evening':
    case 'night':
      imply(components, 'meridiem', MERIDIEM_PM);
      imply(components, 'hour', 20);
      break;
    case 'midnight':
      if (context.refDate.getUTCHours() > 2) addDurationAsImplied(components, { day: 1 });
      assign(components, 'hour', 0);
      imply(components, 'minute', 0);
      imply(components, 'second', 0);
      imply(components, 'millisecond', 0);
      break;
    case 'morning':
      imply(components, 'meridiem', MERIDIEM_AM);
      imply(components, 'hour', 6);
      imply(components, 'minute', 0);
      imply(components, 'second', 0);
      imply(components, 'millisecond', 0);
      break;
    default:
      // noon / midday
      imply(components, 'meridiem', MERIDIEM_AM);
      assign(components, 'hour', 12);
      imply(components, 'minute', 0);
      imply(components, 'second', 0);
      imply(components, 'millisecond', 0);
      break;
  }

  components.tags.add('parser/ENCasualTimeParser');
  return components;
});

// ---------------------------------------------------------------------------
// Month/year shorthand (`01/2026`)
// ---------------------------------------------------------------------------

const slashMonthParser = boundaryParser(
  'ENSlashMonthFormatParser',
  '([0-9]|0[1-9]|1[012])/([0-9]{4})',
  (context, match) => {
    const components = createComponents(context);
    imply(components, 'day', 1);
    assign(components, 'month', parseInt(match[1], 10));
    assign(components, 'year', parseInt(match[2], 10));
    return components;
  }
);

/**
 * Every parser, in chrono-node's English casual order.
 *
 * Order breaks ties between results at the same index, so it matters: the
 * year-month-day parser runs before the ISO parser (chrono unshifts both, in
 * that sequence), and the casual parsers run last.
 */
export function createParsers(): EnParser[] {
  return [
    yearMonthDayParser,
    isoParser,
    slashDateParser,
    timeUnitWithinParser,
    monthNameLittleEndianParser,
    monthNameMiddleEndianParser,
    weekdayParser,
    slashMonthParser,
    timeExpressionParser,
    timeUnitAgoParser,
    timeUnitLaterParser,
    casualDateParser,
    casualTimeParser,
    monthNameParser,
    relativeDateParser,
    casualRelativeParser,
  ];
}
