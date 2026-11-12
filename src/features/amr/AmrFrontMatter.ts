/**
 * Front matter reader and writer for the Agent Memory Repo (AMR). It handles a small subset of YAML:
 * `key: value` scalars and `key: [a, b]` flow lists. It has no YAML dependency.
 *
 * @module features/amr/AmrFrontMatter
 * @experimental
 */
import { ValidationError } from '../../utils/errors.js';
import { isValidKey } from './AmrCodec.js';

/** Values of a front matter block: scalars or lists of strings. */
export type FrontMatterValues = Record<string, string | string[]>;

/** Result of {@link parseFrontMatter}. */
export interface FrontMatterParse {
  /** Parsed values, in document order. A repeated key keeps its last value. */
  values: FrontMatterValues;
  /** One warning per skipped line or repeated key. Each warning names its line number. */
  warnings: string[];
}

/** Characters that force double quotes when they appear in a value. */
const QUOTE_TRIGGER = /[:#,[\]"'\\]/;
/** C0 and C1 control characters, and the Unicode line and paragraph separators. */
// The control characters are the subject of this pattern.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

/**
 * Split a flow list body on commas that are outside double quotes.
 * @param body - Text between the brackets.
 * @returns The raw items, not trimmed.
 */
function splitItems(body: string): string[] {
  const items: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && quoted && i + 1 < body.length) {
      cur += c + body[i + 1];
      i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) {
      items.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (body.trim() !== '') items.push(cur);
  return items;
}

/**
 * Read one scalar token: a double-quoted value (with `\"` and `\\` decoded), a single-quoted value
 * (taken as is), or a plain value.
 * @param token - Raw token, trimmed.
 * @returns The decoded value, or null when the token is a malformed quoted value.
 */
function readScalar(token: string): string | null {
  if (token.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(token);
    return m ? m[1].replace(/\\(["\\])/g, '$1') : null;
  }
  if (token.startsWith("'")) {
    const m = /^'(.*)'$/.exec(token);
    return m ? m[1] : null;
  }
  return token;
}

/**
 * Parse the raw front matter body of an AMR document.
 * A line `key: value` gives a scalar. A line `key: [a, b, "c, d"]` gives a list. Blank lines and
 * lines that start with `#` are skipped. Any other line gives one warning and is skipped.
 * @param raw - Raw front matter, without the `---` lines. Lines are joined with `\n`.
 * @returns The values and the warnings.
 */
export function parseFrontMatter(raw: string): FrontMatterParse {
  const values: FrontMatterValues = {};
  const warnings: string[] = [];
  const lines = raw.split('\n');
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`;
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const colon = line.indexOf(':');
    const key = colon < 0 ? '' : line.slice(0, colon);
    if (colon < 0 || !isValidKey(key)) {
      warnings.push(`${at}: unsupported line skipped`);
      return;
    }
    const rest = line.slice(colon + 1).trim();
    let value: string | string[] | null;
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const items = splitItems(rest.slice(1, -1)).map((t) => readScalar(t.trim()));
      value = items.every((v) => v !== null) ? (items as string[]) : null;
    } else {
      value = readScalar(rest);
    }
    if (value === null) {
      warnings.push(`${at}: malformed value skipped`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) warnings.push(`${at}: repeated key ${key}, last value kept`);
    values[key] = value;
  });
  return { values, warnings };
}

/**
 * Tell whether a scalar must be written in double quotes.
 * @param v - Scalar value.
 * @returns True when the value is empty, has edge whitespace or holds a reserved character.
 */
function needsQuotes(v: string): boolean {
  return v === '' || v !== v.trim() || QUOTE_TRIGGER.test(v);
}

/**
 * Write one scalar in its file form.
 * @param v - Scalar value without control characters.
 * @returns The value, in double quotes when needed.
 */
function writeScalar(v: string): string {
  if (!needsQuotes(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Write a front matter block. Keys keep insertion order, one per line.
 * @param values - Scalars or lists of strings.
 * @returns The lines, each ending with `\n`.
 * @throws ValidationError when a key is invalid, or a value holds a line separator or a control character.
 */
export function renderFrontMatter(values: FrontMatterValues): string {
  let out = '';
  for (const key of Object.keys(values)) {
    if (!isValidKey(key)) throw new ValidationError(`Invalid front matter key: ${key}`, [`key ${key} is invalid`]);
    const v = values[key];
    const parts = Array.isArray(v) ? v : [v];
    for (const p of parts) {
      if (CONTROL.test(p)) {
        throw new ValidationError(`Front matter value of ${key} holds a control character`, [
          `value of ${key} holds a line separator or a control character`,
        ]);
      }
    }
    const text = Array.isArray(v) ? `[${v.map(writeScalar).join(', ')}]` : writeScalar(v);
    out += `${key}: ${text}\n`;
  }
  return out;
}
