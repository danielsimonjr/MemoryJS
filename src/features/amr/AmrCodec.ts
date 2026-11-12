/**
 * @module features/amr/AmrCodec
 * @experimental
 *
 * Agent Memory Repo (AMR) codec. The codec reads and writes entry metadata, escapes entry text,
 * extracts wiki links and models a Markdown file as physical lines. All functions are pure.
 */
import { ValidationError } from '../../utils/errors.js';

/** Line terminator that a physical line can store. */
export type AmrEol = '\n' | '\r\n';

/** Kind of one physical line in an AMR document. */
export type AmrLineKind =
  | 'frontmatter'
  | 'heading'
  | 'bullet'
  | 'continuation'
  | 'fence'
  | 'blank'
  | 'prose';

/** Parsed content of a bullet entry. */
export interface AmrEntry {
  /** Entry text without metadata groups and without the task prefix. */
  text: string;
  /** Metadata; repeated keys keep document order. */
  meta: Record<string, string[]>;
  /** Wiki link targets found in `text`. */
  links: string[];
  /** Task state from a `[ ] ` or `[x] ` prefix. */
  task?: ' ' | 'x';
  /** Warnings from the metadata parser. */
  warnings: string[];
}

/** One physical line of an AMR document. */
export interface AmrLine {
  /** Line kind. */
  kind: AmrLineKind;
  /** Line text without its terminator. */
  raw: string;
  /** Terminator of this line; empty for a final line without a newline. */
  eolAfter: '' | AmrEol;
  /** Number of leading whitespace characters, for bullets and continuations. */
  indent?: number;
  /** Bullet marker, for example `-`, `*`, `+` or `1.`. */
  marker?: string;
  /** Parsed entry, for bullets only. */
  entry?: AmrEntry;
}

/** A parsed AMR document. */
export interface AmrDocument {
  /** True when the file starts with a byte order mark. */
  bom: boolean;
  /** First line terminator seen in the file; `\n` when there is none. */
  eol: AmrEol;
  /** Raw front matter body, without the `---` lines. Absent when there is no front matter. */
  frontMatter?: string;
  /** One entry per physical line, front matter included. */
  lines: AmrLine[];
  /** False when the file cannot be edited safely (an unterminated fence or front matter). */
  parseable: boolean;
  /** Warnings found while parsing. */
  warnings: string[];
}

/** Result of reading the metadata and escapes of one entry text. */
export interface ParsedEntryText {
  /** Entry text with escapes decoded and metadata removed. */
  text: string;
  /** Metadata; repeated keys keep document order. */
  meta: Record<string, string[]>;
  /** Warnings, for example a malformed metadata group. */
  warnings: string[];
}

const BOM = '\uFEFF';
/** Characters that end a line for some reader (JavaScript, Python `splitlines`, Unicode). */
// The control characters are the subject of this pattern.
// oxlint-disable-next-line no-control-regex
const SEPARATORS = /[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]/;
const KEY_SOURCE = '[A-Za-z][\\w-]*';
const KEY_PATTERN = new RegExp(`^${KEY_SOURCE}$`);
const SEGMENT_PATTERN = new RegExp(`^${KEY_SOURCE}:\\s+\\S`);
/** A group body with a segment that starts with `key:` and whitespace looks like metadata. */
const METADATA_LIKE_PATTERN = new RegExp(`(?:^|;\\s+)${KEY_SOURCE}:\\s`);
const RESERVED_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
const BULLET_PATTERN = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/s;
const TASK_PATTERN = /^\[([ x])\] +/;
const FENCE_OPEN_PATTERN = /^\s*(`{3,}(?![^`]*`)|~{3,})/;
const FENCE_CLOSE_PATTERN = /^\s*(`{3,}|~{3,})\s*$/;
const HEADING_PATTERN = /^#{1,6}(\s|$)/;

/**
 * Removes trailing spaces, tabs and carriage returns. The scan is linear.
 * @param s - Source string.
 * @returns The string without trailing spaces, tabs and carriage returns.
 */
function trimTrailingBlanks(s: string): string {
  let e = s.length;
  while (e > 0) {
    const c = s.charCodeAt(e - 1);
    if (c !== 32 && c !== 9 && c !== 13) break;
    e--;
  }
  return e === s.length ? s : s.slice(0, e);
}

/**
 * Tells whether a metadata key is valid: the key matches the key pattern and is not an
 * `Object.prototype` property name.
 * @param key - Key to check.
 * @returns True when the key is valid.
 */
function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !RESERVED_KEYS.has(key);
}

/**
 * Tells whether a metadata value is valid. The reader and the writer use this one rule.
 * @param value - Value to check.
 * @returns True when the value is not empty, has no edge whitespace, and holds no `[`, `]`,
 *   line separator or `;` followed by whitespace.
 */
function isValidValue(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.trim() &&
    !/[[\]]/.test(value) &&
    !SEPARATORS.test(value) &&
    !/;\s/.test(value)
  );
}

/**
 * Tells whether the character at `index` is escaped. A character is escaped when an odd run of
 * backslashes comes directly before it.
 * @param s - Source string.
 * @param index - Position to check.
 * @returns True when the character is escaped.
 */
function isEscaped(s: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && s[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

/**
 * Decodes escapes. A backslash is special only in a run directly before `[`. An odd run of m
 * gives (m - 1) / 2 backslashes and a literal `[`. An even run of m gives m / 2 backslashes and
 * the `[` stays. Every other backslash stays as it is.
 * @param s - Escaped text.
 * @returns Decoded text.
 */
function decodeText(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '\\') {
      out += s[i];
      i++;
      continue;
    }
    let j = i;
    while (s[j] === '\\') j++;
    const run = j - i;
    if (s[j] === '[') {
      out += '\\'.repeat(run >> 1);
      if (run % 2 === 1) {
        out += '[';
        j++;
      }
    } else {
      out += '\\'.repeat(run);
    }
    i = j;
  }
  return out;
}

/**
 * Escapes the text. Only two brackets can change the reading, and only they get a backslash.
 * The first is the last `[` of a text that ends in `]`, unless a `[` comes directly before it.
 * The second is the `[` of a leading task prefix (`[ ] ` or `[x] `). A backslash run directly
 * before any `[` is doubled, so the decoder can halve it. Every other character stays as it is.
 * @param text - Entry text without metadata.
 * @returns Escaped text.
 */
function escapeText(text: string): string {
  const escaped = new Set<number>();
  if (text.endsWith(']')) {
    const open = text.lastIndexOf('[', text.length - 2);
    if (open >= 0 && text[open - 1] !== '[') escaped.add(open);
  }
  if (TASK_PATTERN.test(text)) escaped.add(0);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '\\') {
      if (text[i] === '[' && escaped.has(i)) out += '\\';
      out += text[i];
      i++;
      continue;
    }
    let j = i;
    while (text[j] === '\\') j++;
    const run = j - i;
    out += '\\'.repeat(text[j] === '[' ? run * 2 : run);
    i = j;
  }
  return out;
}

/**
 * Reads the metadata groups and escapes of one entry text.
 * Groups are read right to left while they are consecutive. A group is metadata only when every
 * key and value passes the rules that formatEntryText applies. A malformed group stays in the text.
 * @param text - Entry text as stored in the file.
 * @returns Entry text, metadata and warnings.
 */
export function parseEntryText(text: string): ParsedEntryText {
  const warnings: string[] = [];
  const groups: Array<Array<[string, string]>> = [];
  let rest = trimTrailingBlanks(text);
  while (rest.endsWith(']')) {
    const open = rest.lastIndexOf('[', rest.length - 2);
    if (open < 0 || isEscaped(rest, open) || rest[open - 1] === '[') break;
    const body = rest.slice(open + 1, -1);
    const pairs: Array<[string, string]> = [];
    let valid = true;
    for (const segment of body.split(/;\s+/)) {
      if (!SEGMENT_PATTERN.test(segment)) {
        valid = false;
        break;
      }
      const colon = segment.indexOf(':');
      const key = segment.slice(0, colon);
      const value = segment.slice(colon + 1).trim();
      if (!isValidKey(key) || !isValidValue(value)) {
        valid = false;
        break;
      }
      pairs.push([key, value]);
    }
    if (!valid) {
      if (METADATA_LIKE_PATTERN.test(body)) warnings.push(`Malformed metadata group kept as text: [${body}]`);
      break;
    }
    groups.push(pairs);
    rest = trimTrailingBlanks(rest.slice(0, open));
  }

  const meta: Record<string, string[]> = {};
  groups.reverse();
  for (const group of groups) {
    for (const [key, value] of group) {
      if (!Object.prototype.hasOwnProperty.call(meta, key)) meta[key] = [];
      meta[key].push(value);
    }
  }
  return { text: decodeText(rest), meta, warnings };
}

/**
 * Escapes entry text and writes metadata as one trailing group.
 * @param text - Entry text without metadata. It must have no line separator and no edge whitespace.
 * @param meta - Metadata; keys keep insertion order, repeats are written as repeated pairs.
 * @returns The entry text as stored in the file.
 * @throws ValidationError when the text has a line separator or edge whitespace, or a key or
 *   value is invalid.
 */
export function formatEntryText(text: string, meta: Record<string, string[]>): string {
  if (SEPARATORS.test(text)) {
    throw new ValidationError('Entry text must not contain a line separator', [
      'text contains a line separator',
    ]);
  }
  if (text !== text.trim()) {
    throw new ValidationError('Entry text must not have leading or trailing whitespace', [
      'text has edge whitespace',
    ]);
  }
  const pairs: string[] = [];
  for (const key of Object.keys(meta)) {
    if (!isValidKey(key)) {
      throw new ValidationError(`Invalid metadata key: ${key}`, [`key ${key} is invalid`]);
    }
    for (const value of meta[key]) {
      if (!isValidValue(value)) {
        throw new ValidationError(`Invalid metadata value for ${key}`, [
          `value of ${key} is empty, untrimmed or holds a reserved character`,
        ]);
      }
      pairs.push(`${key}: ${value}`);
    }
  }
  const body = escapeText(text);
  if (pairs.length === 0) return body;
  const group = `[${pairs.join('; ')}]`;
  return body === '' ? group : `${body} ${group}`;
}

/**
 * Lists wiki link targets. Code spans are skipped. A link target is the text before `|`
 * and before `#`, trimmed. Empty targets are dropped.
 * @param text - Entry or document text.
 * @returns Link targets in document order.
 */
export function extractLinks(text: string): string[] {
  const outsideCode = text.replace(/`[^`]*`/g, ' ');
  const links: string[] = [];
  for (const match of outsideCode.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
    const target = match[1].split('|')[0].split('#')[0].trim();
    if (target) links.push(target);
  }
  return links;
}

/**
 * Splits text into physical lines. Each line keeps its own terminator.
 * @param s - Text without a byte order mark.
 * @returns Lines with their terminators.
 */
function splitLines(s: string): Array<{ raw: string; eolAfter: '' | AmrEol }> {
  const out: Array<{ raw: string; eolAfter: '' | AmrEol }> = [];
  let start = 0;
  while (start < s.length) {
    const nl = s.indexOf('\n', start);
    if (nl === -1) {
      out.push({ raw: s.slice(start), eolAfter: '' });
      break;
    }
    const crlf = nl > start && s[nl - 1] === '\r';
    out.push({ raw: s.slice(start, crlf ? nl - 1 : nl), eolAfter: crlf ? '\r\n' : '\n' });
    start = nl + 1;
  }
  return out;
}

/**
 * Parses an AMR Markdown file into physical lines.
 * Front matter starts on line 1 with `---` and ends at the next `---` line. Trailing spaces are
 * allowed on both lines. The YAML closer `...` is not supported.
 * @param text - File content.
 * @returns The document model. Unedited lines render back byte for byte.
 */
export function parseAmrDocument(text: string): AmrDocument {
  const bom = text.startsWith(BOM);
  const raws = splitLines(bom ? text.slice(1) : text);
  const firstEol = raws.find((l) => l.eolAfter !== '')?.eolAfter;
  const eol: AmrEol = firstEol === '\r\n' ? '\r\n' : '\n';
  const lines: AmrLine[] = raws.map((r) => ({ kind: 'prose', raw: r.raw, eolAfter: r.eolAfter }));
  const warnings: string[] = [];
  let parseable = true;

  let frontMatter: string | undefined;
  let start = 0;
  if (lines.length > 0 && lines[0].raw.trimEnd() === '---') {
    let close = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].raw.trimEnd() === '---') {
        close = j;
        break;
      }
    }
    if (close > 0) {
      for (let j = 0; j <= close; j++) lines[j].kind = 'frontmatter';
      frontMatter = lines
        .slice(1, close)
        .map((l) => l.raw)
        .join('\n');
      start = close + 1;
    } else {
      parseable = false;
      warnings.push('Unterminated front matter starting at line 1');
    }
  }

  type Pending = { owner: number; parts: string[]; task?: ' ' | 'x' };
  const pending: Pending[] = [];
  let owner: { record: Pending; bulletIndent: number } | null = null;
  let fence: string | null = null;
  let fenceStart = -1;

  for (let j = start; j < lines.length; j++) {
    const line = lines[j];
    const raw = line.raw;

    if (fence !== null) {
      line.kind = 'fence';
      const close = FENCE_CLOSE_PATTERN.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }

    const open = FENCE_OPEN_PATTERN.exec(raw);
    if (open) {
      line.kind = 'fence';
      fence = open[1];
      fenceStart = j;
      owner = null;
      continue;
    }

    if (raw.trim() === '') {
      line.kind = 'blank';
      owner = null;
      continue;
    }

    if (HEADING_PATTERN.test(raw)) {
      line.kind = 'heading';
      owner = null;
      continue;
    }

    const bullet = BULLET_PATTERN.exec(raw);
    if (bullet) {
      line.kind = 'bullet';
      const indent = bullet[1].length;
      line.indent = indent;
      line.marker = bullet[2];
      let content = bullet[4];
      const task = TASK_PATTERN.exec(content);
      let taskMark: ' ' | 'x' | undefined;
      if (task) {
        taskMark = task[1] === 'x' ? 'x' : ' ';
        content = content.slice(task[0].length);
      }
      const record: Pending = { owner: j, parts: [content], task: taskMark };
      pending.push(record);
      owner = { record, bulletIndent: indent };
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    if (owner !== null && indent > owner.bulletIndent) {
      line.kind = 'continuation';
      line.indent = indent;
      owner.record.parts.push(raw.trim());
      continue;
    }

    line.kind = 'prose';
    owner = null;
  }

  if (fence !== null) {
    parseable = false;
    warnings.push(`Unterminated code fence starting at line ${fenceStart + 1}`);
  }

  for (const record of pending) {
    const parsed = parseEntryText(record.parts.filter((p) => p !== '').join(' '));
    const entry: AmrEntry = {
      text: parsed.text,
      meta: parsed.meta,
      links: extractLinks(parsed.text),
      warnings: parsed.warnings,
    };
    if (record.task !== undefined) entry.task = record.task;
    lines[record.owner].entry = entry;
    for (const w of parsed.warnings) warnings.push(`Line ${record.owner + 1}: ${w}`);
  }

  const doc: AmrDocument = { bom, eol, lines, parseable, warnings };
  if (frontMatter !== undefined) doc.frontMatter = frontMatter;
  return doc;
}

/**
 * Renders a document back to file text.
 * @param doc - Document from parseAmrDocument or setEntry.
 * @returns File content with its byte order mark and line terminators.
 */
export function renderAmrDocument(doc: AmrDocument): string {
  return (doc.bom ? BOM : '') + doc.lines.map((l) => l.raw + l.eolAfter).join('');
}

/** One entry edit for {@link setEntries}. */
export interface AmrEntryEdit {
  /** Index of the bullet line in `doc.lines`. */
  index: number;
  /** New entry text without metadata. */
  text: string;
  /** New metadata. The result holds a copy. */
  meta: Record<string, string[]>;
}

/**
 * Replaces the entry on one bullet line. The new entry keeps the indent characters, the marker,
 * the whitespace after the marker and the task prefix. The function removes the continuation
 * lines of that entry. The result is parsed again, so its entries and warnings match the new text.
 * @param doc - Document to change. It is not modified.
 * @param index - Index of the bullet line in `doc.lines`.
 * @param text - New entry text without metadata.
 * @param meta - New metadata. The result holds a copy.
 * @returns A new document.
 * @throws ValidationError when the document is not parseable, line `index` is not a bullet,
 *   or the text or metadata is invalid.
 */
export function setEntry(
  doc: AmrDocument,
  index: number,
  text: string,
  meta: Record<string, string[]>
): AmrDocument {
  return setEntries(doc, [{ index, text, meta }]);
}

/**
 * Replaces the entries of several bullet lines in one pass, with the rules of {@link setEntry}.
 * The result is parsed once, so the cost is linear in the document size.
 * @param doc - Document to change. It is not modified.
 * @param edits - Edits; each index names a bullet line of `doc`. A repeated index uses the last edit.
 * @returns A new document.
 * @throws ValidationError when the document is not parseable, an index is not a bullet,
 *   or a text or metadata is invalid.
 */
export function setEntries(doc: AmrDocument, edits: readonly AmrEntryEdit[]): AmrDocument {
  if (!doc.parseable) {
    throw new ValidationError('Document is not parseable and cannot be edited', [
      'document is not parseable',
    ]);
  }
  const byIndex = new Map<number, AmrEntryEdit>();
  for (const e of edits) {
    const line = doc.lines[e.index];
    if (line?.kind !== 'bullet' || !BULLET_PATTERN.test(line.raw)) {
      throw new ValidationError(`Line ${e.index} is not a bullet`, [`line ${e.index} is not a bullet`]);
    }
    byIndex.set(e.index, e);
  }
  const lines: AmrLine[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const edit = byIndex.get(i);
    const line = doc.lines[i];
    if (edit === undefined) {
      lines.push(line);
      continue;
    }
    const bullet = BULLET_PATTERN.exec(line.raw)!;
    const taskPrefix = TASK_PATTERN.exec(bullet[4])?.[0] ?? '';
    const raw = `${bullet[1]}${bullet[2]}${bullet[3]}${taskPrefix}${formatEntryText(edit.text, edit.meta)}`;
    let end = i + 1;
    while (end < doc.lines.length && doc.lines[end].kind === 'continuation') end++;
    const eolAfter = end >= doc.lines.length ? doc.lines[end - 1].eolAfter : line.eolAfter;
    lines.push({ kind: 'bullet', raw, eolAfter });
    i = end - 1;
  }
  return parseAmrDocument(renderAmrDocument({ ...doc, lines }));
}
