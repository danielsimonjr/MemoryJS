/**
 * Rule-based rubric judge and its pure text helpers.
 *
 * Judges each criterion by kind without any model call:
 * - `fact`: normalized whole-word match against `expected` (`art` does not match `start`).
 * - `number`: first number in the answer within `tolerance` of `expected`. A negative or
 *   non-finite tolerance is replaced by 0 and noted (`invalid tolerance; using 0`).
 * - `set-exact` / `set-precision`: list extraction, case-insensitive, duplicates collapsed.
 * - `document`: the answer mentions the expected reference (string or any of string[]),
 *   matched on whole words like `fact`.
 * - `free`: never passes; reported with `note: 'needs judge'`.
 *
 * The judge is synchronous in effect and ignores the abort signal.
 *
 * @module agent/evaluation/DeterministicJudge
 * @experimental Part of the Recursa evaluation layer (spec RS-25).
 */

import type { CriterionResult, Criterion, TaskRecord } from '../../types/learning.js';

/**
 * Judge of one answer against a task's rubric.
 *
 * Implementations return one result per criterion they could judge. Missing criteria are
 * treated as failing by the {@link Evaluator}.
 */
export interface RubricJudge {
  /**
   * Judge an answer against every criterion of the task.
   *
   * @param task - Task whose rubric is applied
   * @param answer - Solver answer text
   * @param signal - Optional abort signal
   * @returns One result per criterion
   */
  judge(task: TaskRecord, answer: string, signal?: AbortSignal): Promise<CriterionResult[]>;
}

/** Dotted initialisms (`U.S.A.`, `e.g.`): single letters each followed by a period. */
const INITIALISM = /(?<![\p{L}\p{N}])(?:\p{L}\.)+\p{L}?(?![\p{L}\p{N}])/gu;

/**
 * Normalize text for comparison: NFKD with combining marks removed (`café` → `cafe`),
 * periods inside dotted initialisms removed (`U.S.A.` → `usa`), lowercase, other
 * punctuation replaced by spaces, whitespace collapsed and trimmed.
 *
 * @param text - Input text
 * @returns Normalized text
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(INITIALISM, (m) => m.replace(/\./g, ''))
    .toLowerCase()
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A sign counts only at the start, after whitespace or `(`, and directly before the number. */
const SIGN = '(?:(?<=^|[\\s(])[-+])?';
const NUMBER_PATTERN = new RegExp(`${SIGN}(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)`);

/**
 * Extract the first number in a text. Accepts thousands separators (`1,234.5`),
 * a trailing unit (`12 km`), a sign, and a unicode minus. A sign attached to a word
 * is not a sign (`COVID-19` → 19). The first number is taken literally: `1e3` → 1
 * and `3/4` → 3 (no exponent or fraction parsing).
 *
 * @param text - Input text
 * @returns The first finite number, or undefined when none is present
 */
export function extractFirstNumber(text: string): number | undefined {
  const normalized = text.normalize('NFKC').replace(/−/g, '-');
  const match = NUMBER_PATTERN.exec(normalized);
  if (!match) {
    return undefined;
  }
  const value = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Extract a set of normalized list items from text. Items are separated by semicolons,
 * newlines, or the word "and"; commas also separate items unless the text contains a
 * semicolon or newline. Leading list markers are removed.
 *
 * So an expected array member that contains a comma (`Washington, D.C.`) cannot match
 * an answer that lists items with commas; it matches when the answer separates items
 * with semicolons or newlines.
 *
 * @param text - Input text
 * @returns Set of normalized, non-empty items (duplicates collapsed)
 */
export function extractSet(text: string): Set<string> {
  const items = new Set<string>();
  const normalized = text.normalize('NFKC');
  const separators = /[;\n\r]/.test(normalized) ? /[;\n\r]+|\s+and\s+/i : /[,;\n\r]+|\s+and\s+/i;
  for (const part of normalized.split(separators)) {
    const item = normalizeText(part.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
    if (item.length > 0) {
      items.add(item);
    }
  }
  return items;
}

/** Returns the expected reference(s) as a list of normalized, non-empty strings. */
function expectedRefs(expected: Criterion['expected']): string[] {
  const list = Array.isArray(expected) ? expected : [expected];
  return list
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeText)
    .filter((value) => value.length > 0);
}

/** Judge a `fact` or `document` criterion: any normalized expected reference appears in the answer. */
function judgeMention(criterion: Criterion, answer: string): CriterionResult {
  const refs = expectedRefs(criterion.expected);
  if (refs.length === 0) {
    return { criterionId: criterion.id, pass: false, note: 'no expected value' };
  }
  const haystack = ` ${normalizeText(answer)} `;
  const pass = refs.some((ref) => haystack.includes(` ${ref} `));
  return { criterionId: criterion.id, pass };
}

/** Judge a `number` criterion. */
function judgeNumber(criterion: Criterion, answer: string): CriterionResult {
  const expected =
    typeof criterion.expected === 'number'
      ? criterion.expected
      : typeof criterion.expected === 'string'
        ? Number(criterion.expected)
        : Number.NaN;
  if (!Number.isFinite(expected)) {
    return { criterionId: criterion.id, pass: false, note: 'expected is not numeric' };
  }
  const value = extractFirstNumber(answer);
  if (value === undefined) {
    return { criterionId: criterion.id, pass: false, note: 'no number found in answer' };
  }
  const declared = criterion.tolerance ?? 0;
  const valid = Number.isFinite(declared) && declared >= 0;
  const pass = Math.abs(value - expected) <= (valid ? declared : 0);
  return valid
    ? { criterionId: criterion.id, pass }
    : { criterionId: criterion.id, pass, note: 'invalid tolerance; using 0' };
}

/** Normalized expected set for set criteria: a string is split as a list, an array is taken item by item. */
function expectedSet(expected: Criterion['expected']): Set<string> {
  if (Array.isArray(expected)) {
    const items = new Set<string>();
    for (const item of expected) {
      if (typeof item === 'string') {
        const normalized = normalizeText(item);
        if (normalized.length > 0) {
          items.add(normalized);
        }
      }
    }
    return items;
  }
  if (typeof expected === 'string') {
    return extractSet(expected);
  }
  return new Set<string>();
}

/** Judge a `set-exact` or `set-precision` criterion. */
function judgeSet(criterion: Criterion, answer: string): CriterionResult {
  const expected = expectedSet(criterion.expected);
  if (expected.size === 0) {
    return { criterionId: criterion.id, pass: false, note: 'no expected set' };
  }
  const actual = extractSet(answer);
  const allExpected = [...actual].every((item) => expected.has(item));
  if (criterion.kind === 'set-precision') {
    return { criterionId: criterion.id, pass: actual.size > 0 && allExpected };
  }
  const pass = actual.size === expected.size && allExpected;
  return { criterionId: criterion.id, pass };
}

/**
 * Judge one criterion by its kind.
 *
 * @param criterion - Criterion to judge
 * @param answer - Solver answer text
 * @returns Criterion result
 */
export function judgeCriterion(criterion: Criterion, answer: string): CriterionResult {
  switch (criterion.kind) {
    case 'fact':
    case 'document':
      return judgeMention(criterion, answer);
    case 'number':
      return judgeNumber(criterion, answer);
    case 'set-exact':
    case 'set-precision':
      return judgeSet(criterion, answer);
    case 'free':
      return { criterionId: criterion.id, pass: false, note: 'needs judge' };
    default:
      return { criterionId: criterion.id, pass: false, note: 'unknown criterion kind' };
  }
}

/**
 * Rule-based {@link RubricJudge}. Never passes `free` criteria.
 */
export class DeterministicJudge implements RubricJudge {
  /**
   * Judge every criterion of the task with the deterministic rules.
   *
   * @param task - Task whose rubric is applied
   * @param answer - Solver answer text
   * @param _signal - Accepted for interface compatibility; not used
   * @returns One result per rubric criterion, in rubric order
   */
  async judge(task: TaskRecord, answer: string, _signal?: AbortSignal): Promise<CriterionResult[]> {
    return task.rubric.map((criterion) => judgeCriterion(criterion, answer));
  }
}
