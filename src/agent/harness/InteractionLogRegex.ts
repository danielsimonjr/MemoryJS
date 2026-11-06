/**
 * Bounded regex matching for `InteractionLog.select`.
 *
 * A JavaScript regex cannot be interrupted mid-match, so matching is bounded in three ways:
 *
 * 1. Static rejection of the shapes that backtrack exponentially or with a high polynomial
 *    degree: a quantified group that contains a quantifier (`(a+)+`) or an alternation
 *    (`(a|aa)+`), and more than two unbounded quantifiers (`*`, `+`, `{n,}`) in total,
 *    which also rules out more than two in direct sequence (`a*a*a*b`).
 * 2. A cap on the text one match sees: each line is matched on its first
 *    {@link MAX_MATCH_LINE_BYTES} bytes, or on its first {@link MAX_MATCH_LINE_BYTES_TWO_UNBOUNDED}
 *    bytes when the pattern has two unbounded quantifiers. Text past the cap is never matched.
 * 3. A wall-clock budget of {@link SELECT_TIME_BUDGET_MS} per call, checked between lines.
 *
 * @module agent/harness/InteractionLogRegex
 * @experimental The exact limits may change in minor releases.
 */

import { InteractionLogError } from './InteractionLogFormat.js';

/** Maximum length of a `select` regex source, in characters. */
export const MAX_REGEX_SOURCE_LENGTH = 256;

/** Bytes of each line a `select` regex is matched against (lines longer than this match on their prefix). */
export const MAX_MATCH_LINE_BYTES = 4096;

/** Line prefix length used instead when the pattern holds two unbounded quantifiers. */
export const MAX_MATCH_LINE_BYTES_TWO_UNBOUNDED = 256;

/** Wall-clock budget for the regex pass of one `select` call, in milliseconds. */
export const SELECT_TIME_BUDGET_MS = 200;

/** A compiled select regex plus the line cap that applies to it. */
export interface CompiledSelectRegex {
  /** Compiled, non-global RegExp. */
  regex: RegExp;
  /** Bytes of each line that are matched. */
  lineCap: number;
}

/** InteractionLogError with the default INVALID_QUERY code. */
function invalid(message: string): InteractionLogError {
  return new InteractionLogError(message);
}

/** Length of the quantifier starting at `i` (`*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`), 0 when none. */
function quantifierAt(src: string, i: number): { len: number; unbounded: boolean } {
  const c = src[i];
  if (c === '*' || c === '+') return { len: src[i + 1] === '?' ? 2 : 1, unbounded: true };
  if (c === '?') return { len: src[i + 1] === '?' ? 2 : 1, unbounded: false };
  if (c === '{') {
    const m = /^\{\d+(,\d*)?\}\??/.exec(src.slice(i));
    if (m) return { len: m[0].length, unbounded: m[1] === ',' };
  }
  return { len: 0, unbounded: false };
}

/**
 * Check a regex source for the rejected shapes.
 *
 * @param src - Regex source
 * @returns Reason for rejection, or undefined when accepted; plus the unbounded quantifier count
 */
export function analyzeSelectRegex(src: string): { reason?: string; unbounded: number } {
  interface Frame { quant: boolean; alt: boolean }
  const stack: Frame[] = [];
  let top: Frame = { quant: false, alt: false };
  let unbounded = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    let atomEnd = i;
    let isGroupClose = false;
    let closed: Frame | undefined;
    if (c === '\\') {
      atomEnd = i + 1;
    } else if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1;
      atomEnd = j;
    } else if (c === '(') {
      stack.push(top);
      top = { quant: false, alt: false };
      if (src[i + 1] === '?') i += src[i + 2] === '<' && (src[i + 3] === '=' || src[i + 3] === '!') ? 3 : 2;
      continue;
    } else if (c === ')') {
      closed = top;
      top = stack.pop() ?? { quant: false, alt: false };
      isGroupClose = true;
    } else if (c === '|') {
      top.alt = true;
      continue;
    }
    const q = quantifierAt(src, atomEnd + 1);
    if (isGroupClose && closed) {
      if (q.len > 0 && closed.quant) return { reason: 'nested quantifiers are not allowed', unbounded };
      if (q.len > 0 && closed.alt) return { reason: 'alternation inside a quantified group is not allowed', unbounded };
      if (closed.quant) top.quant = true;
    }
    if (q.len > 0) {
      top.quant = true;
      if (q.unbounded) {
        unbounded++;
        if (unbounded > 2) return { reason: 'more than 2 unbounded quantifiers are not allowed', unbounded };
      }
    }
    i = atomEnd + q.len;
  }
  return { unbounded };
}

/**
 * Compile a `select` regex source after checking its limits.
 *
 * Rejects sources longer than {@link MAX_REGEX_SOURCE_LENGTH} characters, sources that do
 * not compile, and the shapes listed in the module notes. Character classes and escaped
 * characters are not treated as quantifiers or group delimiters.
 *
 * @param source - Regex source text (no flags)
 * @returns The compiled regex and the per-line byte cap that applies to it
 * @throws InteractionLogError with code INVALID_QUERY when a check fails
 */
export function compileSelectRegex(source: string): CompiledSelectRegex {
  if (typeof source !== 'string') throw invalid('select regex must be a string');
  if (source.length > MAX_REGEX_SOURCE_LENGTH) {
    throw invalid(`select regex exceeds ${MAX_REGEX_SOURCE_LENGTH} characters (got ${source.length})`);
  }
  const { reason, unbounded } = analyzeSelectRegex(source);
  if (reason) throw invalid(`select regex rejected: ${reason}`);
  let regex: RegExp;
  try {
    regex = new RegExp(source);
  } catch (err) {
    throw invalid(`select regex does not compile: ${(err as Error).message}`);
  }
  return { regex, lineCap: unbounded >= 2 ? MAX_MATCH_LINE_BYTES_TWO_UNBOUNDED : MAX_MATCH_LINE_BYTES };
}

/**
 * Lines (1-based, within `[from, to]`) whose capped prefix matches, under the time budget.
 *
 * @param all - Lines of the bounded text
 * @param from - First line number
 * @param to - Last line number (clamped to the line count)
 * @param compiled - Regex from {@link compileSelectRegex}, or undefined to keep every line
 * @param budgetMs - Wall-clock budget; defaults to {@link SELECT_TIME_BUDGET_MS}
 * @returns Selected lines with their numbers; `text` is always the full line
 * @throws InteractionLogError with code INVALID_QUERY when the budget runs out
 */
export function matchSelectLines(
  all: string[],
  from: number,
  to: number,
  compiled: CompiledSelectRegex | undefined,
  budgetMs: number = SELECT_TIME_BUDGET_MS,
): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const last = Math.min(to, all.length);
  const deadline = Date.now() + budgetMs;
  for (let i = from; i <= last; i++) {
    const line = all[i - 1];
    if (compiled) {
      if (Date.now() > deadline) throw invalid(`select regex exceeded its ${budgetMs} ms budget`);
      const probe = Buffer.byteLength(line, 'utf8') > compiled.lineCap ? capBytes(line, compiled.lineCap) : line;
      if (!compiled.regex.test(probe)) continue;
    }
    out.push({ line: i, text: line });
  }
  return out;
}

/** Prefix of `text` within `maxBytes` UTF-8 bytes, cut at a character boundary. */
function capBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  let s = buf.toString('utf8');
  if (s.endsWith('�')) s = s.slice(0, -1);
  return s;
}
