/**
 * Word tables and duration parsing for the in-repo English date parser.
 *
 * The weekday and month tables, the ordinal/number word tables, and the
 * duration connector grammar are adapted from chrono-node 2.9.1 so that the
 * parser recognises the same vocabulary. See THIRD_PARTY_NOTICES for the
 * chrono-node copyright and MIT license text.
 *
 * @module search/enDate/constants
 * @internal
 */

import type { Duration } from './types.js';

// Adapted from chrono-node (https://github.com/wanasit/chrono), MIT License.
// Copyright (c) 2014 Wanasit Ranasinghe and contributors.

/** Weekday name (lowercase) to index, 0 = Sunday. */
export const WEEKDAY_DICTIONARY: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  'sun.': 0,
  monday: 1,
  mon: 1,
  'mon.': 1,
  tuesday: 2,
  tue: 2,
  'tue.': 2,
  wednesday: 3,
  wed: 3,
  'wed.': 3,
  thursday: 4,
  thurs: 4,
  'thurs.': 4,
  thur: 4,
  'thur.': 4,
  thu: 4,
  'thu.': 4,
  friday: 5,
  fri: 5,
  'fri.': 5,
  saturday: 6,
  sat: 6,
  'sat.': 6,
};

/** Full month names only. */
export const FULL_MONTH_NAME_DICTIONARY: Readonly<Record<string, number>> = {
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

/** Month names and abbreviations (lowercase) to month number. */
export const MONTH_DICTIONARY: Readonly<Record<string, number>> = {
  ...FULL_MONTH_NAME_DICTIONARY,
  jan: 1,
  'jan.': 1,
  feb: 2,
  'feb.': 2,
  mar: 3,
  'mar.': 3,
  apr: 4,
  'apr.': 4,
  jun: 6,
  'jun.': 6,
  jul: 7,
  'jul.': 7,
  aug: 8,
  'aug.': 8,
  sep: 9,
  'sep.': 9,
  sept: 9,
  'sept.': 9,
  oct: 10,
  'oct.': 10,
  nov: 11,
  'nov.': 11,
  dec: 12,
  'dec.': 12,
};

const INTEGER_WORD_DICTIONARY: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const ORDINAL_WORD_DICTIONARY: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  'twenty first': 21,
  'twenty-first': 21,
  'twenty second': 22,
  'twenty-second': 22,
  'twenty third': 23,
  'twenty-third': 23,
  'twenty fourth': 24,
  'twenty-fourth': 24,
  'twenty fifth': 25,
  'twenty-fifth': 25,
  'twenty sixth': 26,
  'twenty-sixth': 26,
  'twenty seventh': 27,
  'twenty-seventh': 27,
  'twenty eighth': 28,
  'twenty-eighth': 28,
  'twenty ninth': 29,
  'twenty-ninth': 29,
  thirtieth: 30,
  'thirty first': 31,
  'thirty-first': 31,
};

/** Time-unit words without abbreviations. */
export const TIME_UNIT_DICTIONARY_NO_ABBR: Readonly<Record<string, string>> = {
  second: 'second',
  seconds: 'second',
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  quarter: 'quarter',
  quarters: 'quarter',
  year: 'year',
  years: 'year',
};

/** Time-unit words including abbreviations. */
export const TIME_UNIT_DICTIONARY: Readonly<Record<string, string>> = {
  s: 'second',
  sec: 'second',
  m: 'minute',
  min: 'minute',
  mins: 'minute',
  h: 'hour',
  hr: 'hour',
  hrs: 'hour',
  d: 'day',
  w: 'week',
  mo: 'month',
  mon: 'month',
  mos: 'month',
  qtr: 'quarter',
  y: 'year',
  yr: 'year',
  ...TIME_UNIT_DICTIONARY_NO_ABBR,
};

/** Escape a table key for use inside a regular expression. */
function escapeTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Alternation of every key in a dictionary, longest first so that
 * `minutes` wins over `min`.
 * @param dictionary - Table whose keys form the alternatives
 */
export function matchAnyPattern(dictionary: Readonly<Record<string, unknown>>): string {
  const joinedTerms = Object.keys(dictionary)
    .sort((a, b) => b.length - a.length)
    .map(escapeTerm)
    .join('|');
  return `(?:${joinedTerms})`;
}

/** Quantifier words accepted in front of a unit, e.g. "a day", "few days". */
export const NUMBER_PATTERN =
  `(?:${matchAnyPattern(INTEGER_WORD_DICTIONARY)}|[0-9]+|[0-9]+\\.[0-9]+|half(?:\\s{0,2}an?)?|an?\\b(?:\\s{0,2}few)?|few|several|the|a?\\s{0,2}couple\\s{0,2}(?:of)?)`;

/**
 * Read a quantity written as a word or a number.
 * @param match - Matched quantity text
 */
export function parseNumberPattern(match: string): number {
  const num = match.toLowerCase();
  if (INTEGER_WORD_DICTIONARY[num] !== undefined) return INTEGER_WORD_DICTIONARY[num];
  if (num === 'a' || num === 'an' || num === 'the') return 1;
  if (num.match(/few/)) return 3;
  if (num.match(/half/)) return 0.5;
  if (num.match(/couple/)) return 2;
  if (num.match(/several/)) return 7;
  return parseFloat(num);
}

/** Day-of-month pattern: ordinal words or `1st`..`31st`. */
export const ORDINAL_NUMBER_PATTERN = `(?:${matchAnyPattern(ORDINAL_WORD_DICTIONARY)}|[0-9]{1,2}(?:st|nd|rd|th)?)`;

/**
 * Read a day-of-month written as an ordinal word or an ordinal number.
 * @param match - Matched ordinal text
 */
export function parseOrdinalNumberPattern(match: string): number {
  const lower = match.toLowerCase();
  const word = ORDINAL_WORD_DICTIONARY[lower];
  if (word !== undefined) return word;
  return parseInt(lower.replace(/(?:st|nd|rd|th)$/i, ''), 10);
}

/** Year pattern: a four-digit year, a two-digit `50`-`99` / `20`-`25`, or a BE/BC/CE suffix form. */
export const YEAR_PATTERN = `(?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3}|[5-9][0-9]|2[0-5])`;

/**
 * Read a year, mapping two-digit years onto 1900s/2000s and handling the
 * BE/BC/CE suffixes.
 * @param match - Matched year text
 */
export function parseYear(match: string): number {
  if (/BE/i.test(match)) {
    return parseInt(match.replace(/BE/i, ''), 10) - 543;
  }
  if (/BCE?/i.test(match)) {
    return -parseInt(match.replace(/BCE?/i, ''), 10);
  }
  if (/(AD|CE)/i.test(match)) {
    return parseInt(match.replace(/(AD|CE)/i, ''), 10);
  }
  const raw = parseInt(match, 10);
  return raw < 100 ? (raw > 50 ? raw + 1900 : raw + 2000) : raw;
}

const SINGLE_TIME_UNIT_PATTERN = `(${NUMBER_PATTERN})\\s{0,3}(${matchAnyPattern(TIME_UNIT_DICTIONARY)})`;
const SINGLE_TIME_UNIT_REGEX = new RegExp(SINGLE_TIME_UNIT_PATTERN, 'i');

const SINGLE_TIME_UNIT_NO_ABBR_PATTERN = `(${NUMBER_PATTERN})\\s{0,3}(${matchAnyPattern(TIME_UNIT_DICTIONARY_NO_ABBR)})`;

const TIME_UNIT_CONNECTOR_PATTERN = `\\s{0,5},?(?:\\s*and)?\\s{0,5}`;

function repeatedTimeUnitPattern(prefix: string, single: string): string {
  const singleNoCapture = single.replace(/\((?!\?)/g, '(?:');
  return `${prefix}${singleNoCapture}(?:${TIME_UNIT_CONNECTOR_PATTERN}${singleNoCapture}){0,10}`;
}

/** One or more durations, e.g. `2 hours and 30 minutes`. */
export const TIME_UNITS_PATTERN = repeatedTimeUnitPattern(
  `(?:(?:about|around)\\s{0,3})?`,
  SINGLE_TIME_UNIT_PATTERN
);

/** One or more durations written without abbreviations. */
export const TIME_UNITS_NO_ABBR_PATTERN = repeatedTimeUnitPattern(
  `(?:(?:about|around)\\s{0,3})?`,
  SINGLE_TIME_UNIT_NO_ABBR_PATTERN
);

/**
 * Parse a duration phrase into fragments, or `null` when it holds no unit.
 * @param timeUnitText - Text such as `2 hours and 30 minutes`
 */
export function parseDuration(timeUnitText: string): Duration | null {
  const fragments: Duration = {};
  let remaining = timeUnitText;

  for (;;) {
    const match = SINGLE_TIME_UNIT_REGEX.exec(remaining);
    if (!match) break;
    if (!/^[a-zA-Z]+$/.test(match[0])) {
      const quantity = parseNumberPattern(match[1]);
      const unit = TIME_UNIT_DICTIONARY[match[2].toLowerCase()] as keyof Duration;
      fragments[unit] = quantity;
    }
    remaining = remaining.substring(match[0].length).trim();
  }

  return Object.keys(fragments).length === 0 ? null : fragments;
}
