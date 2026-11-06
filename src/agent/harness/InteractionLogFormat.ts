/**
 * InteractionLog wire format: record type, line encoding, torn-line tolerant
 * scanning, address and regex validation, and the error class.
 *
 * Each record is one JSON object on one line (JSONL). A line that is not
 * terminated by a newline, or that does not decode to a valid record, is
 * skipped by {@link scanInteractionLog}.
 *
 * @module agent/harness/InteractionLogFormat
 * @experimental Record fields may gain optional members in minor releases.
 *   Existing lines stay readable.
 */

import { KnowledgeGraphError, ErrorCode } from '../../utils/errors.js';

/** Kinds of record an `InteractionLog` accepts. */
export const INTERACTION_KINDS = ['model', 'tool_call', 'tool_output', 'note', 'feedback'] as const;

/** One of the record kinds in {@link INTERACTION_KINDS}. */
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Pointer to content that was written out of line to a blob file. */
export interface InteractionSpill {
  /** Blob path relative to the directory that holds the log file. */
  path: string;
  /** Full UTF-8 byte length of the content before truncation. */
  originalBytes: number;
}

/**
 * One stored interaction. `content` holds at most `maxInlineBytes` bytes when
 * `spill` is set; the full text lives in the blob at `spill.path`.
 */
export interface InteractionRecord {
  /** Address `e<n>`, where `n` is a positive integer. */
  addr: string;
  /** ISO-8601 timestamp of the append. */
  ts: string;
  /** Session the record belongs to. */
  sessionId: string;
  /** Record kind. */
  kind: InteractionKind;
  /** Optional free-form label. */
  tag?: string;
  /** Inline text (the full text when not spilled). */
  content: string;
  /** Full UTF-8 byte length of the original content. */
  bytes: number;
  /** Present only when the content was written to a blob. */
  spill?: InteractionSpill;
}

/** Caller input for `InteractionLog.append`. `addr`, `bytes` and `spill` are computed. */
export interface InteractionAppendInput {
  /** Session the record belongs to. Must be a non-empty string. */
  sessionId: string;
  /** Record kind. */
  kind: InteractionKind;
  /** Optional free-form label. */
  tag?: string;
  /** Full text of the interaction. */
  content: string;
  /** Optional timestamp; defaults to the current time. */
  ts?: string;
}

/**
 * Error thrown by the InteractionLog for invalid input, a bad regex, a closed
 * log, or an unsafe blob path.
 */
export class InteractionLogError extends KnowledgeGraphError {
  /**
   * Create an InteractionLog error.
   *
   * @param message - Human-readable description.
   * @param code - Error code; defaults to `INVALID_QUERY`.
   */
  constructor(message: string, code: string = ErrorCode.INVALID_QUERY) {
    super(message, code);
    this.name = 'InteractionLogError';
  }
}

const ADDR_PATTERN = /^e([1-9][0-9]*)$/;

/**
 * Parse an address of the form `e<n>` into its number.
 *
 * @param addr - Candidate address.
 * @returns The positive integer `n`.
 * @throws InteractionLogError When `addr` does not match `^e[1-9][0-9]*$`.
 */
export function parseAddr(addr: unknown): number {
  if (typeof addr !== 'string') {
    throw new InteractionLogError('InteractionLog address must be a string', ErrorCode.INVALID_FIELD_VALUE);
  }
  const match = ADDR_PATTERN.exec(addr);
  if (!match) {
    throw new InteractionLogError(`Invalid InteractionLog address: ${addr}`, ErrorCode.INVALID_FIELD_VALUE);
  }
  return Number(match[1]);
}

/**
 * Format a record number as an address.
 *
 * @param n - Positive integer record number.
 * @returns `e<n>`.
 */
export function formatAddr(n: number): string {
  return `e${n}`;
}

/**
 * Check that a value has the shape of a stored record.
 *
 * @param value - Decoded JSON value.
 * @returns True when the value is a well-formed record.
 */
export function isInteractionRecord(value: unknown): value is InteractionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.addr === 'string' &&
    ADDR_PATTERN.test(r.addr) &&
    typeof r.ts === 'string' &&
    typeof r.sessionId === 'string' &&
    typeof r.kind === 'string' &&
    (INTERACTION_KINDS as readonly string[]).includes(r.kind) &&
    (r.tag === undefined || typeof r.tag === 'string') &&
    typeof r.content === 'string' &&
    typeof r.bytes === 'number' &&
    (r.spill === undefined ||
      (typeof r.spill === 'object' &&
        r.spill !== null &&
        typeof (r.spill as InteractionSpill).path === 'string' &&
        typeof (r.spill as InteractionSpill).originalBytes === 'number'))
  );
}

/**
 * Encode a record as one JSONL line, including the trailing newline.
 *
 * @param record - Record to encode.
 * @returns The line as UTF-8 text ending in `\n`.
 */
export function encodeInteractionLine(record: InteractionRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/** One record located in a log buffer. */
export interface ScannedRecord {
  /** Decoded record. */
  record: InteractionRecord;
  /** Byte offset of the line start in the file. */
  offset: number;
  /** Byte length of the line, without its newline. */
  length: number;
}

/** Result of {@link scanInteractionLog}. */
export interface ScanResult {
  /** Valid records in file order. */
  records: ScannedRecord[];
  /** True when the buffer does not end in a newline (a torn tail is present). */
  tornTail: boolean;
  /** Highest record number seen among valid records (0 when none). */
  maxN: number;
  /** Number of spilled records. */
  spilled: number;
}

/**
 * Scan a log buffer. Complete lines that decode to valid records are kept;
 * invalid complete lines and a torn trailing line (no final newline) are
 * skipped.
 *
 * @param buf - Full contents of the log file.
 * @returns The valid records with their byte locations.
 */
export function scanInteractionLog(buf: Buffer): ScanResult {
  const records: ScannedRecord[] = [];
  let maxN = 0;
  let spilled = 0;
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    if (nl === -1) break; // torn trailing line: no newline, skipped
    const length = nl - start;
    if (length > 0) {
      const decoded = decodeLine(buf.subarray(start, nl));
      if (decoded) {
        records.push({ record: decoded, offset: start, length });
        maxN = Math.max(maxN, Number(decoded.addr.slice(1)));
        if (decoded.spill) spilled++;
      }
    }
    start = nl + 1;
  }
  return { records, tornTail: buf.length > 0 && buf[buf.length - 1] !== 0x0a, maxN, spilled };
}

/**
 * Decode one line of bytes into a record.
 *
 * @param bytes - Line bytes without the newline.
 * @returns The record, or `undefined` when the line is not a valid record.
 */
export function decodeLine(bytes: Buffer): InteractionRecord | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isInteractionRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Truncate text to at most `maxBytes` UTF-8 bytes without splitting a
 * character.
 *
 * @param text - Input text.
 * @param maxBytes - Byte budget.
 * @returns The longest prefix of `text` whose encoding fits in `maxBytes`.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 0;
  let end = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (used + size > maxBytes) break;
    used += size;
    end += ch.length;
  }
  return text.slice(0, end);
}

/** Construction options for {@link InteractionLog}. */
export interface InteractionLogOptions {
  /**
   * Largest content kept inline, in UTF-8 bytes. Larger content spills to a
   * blob. Must be a positive integer. Defaults to the
   * `MEMORY_INTERACTION_LOG_INLINE_BYTES` env var, else 16384. An env value that
   * is not a strict positive decimal integer (`'0'`, `'-5'`, `'abc'`, `'1e3'`)
   * is ignored and the 16384 default applies; an invalid option value throws.
   */
  maxInlineBytes?: number;
}

/** Options for {@link InteractionLog.range}. */
export interface RangeOptions {
  /** Maximum records returned, 1 to 1000. Defaults to 100. */
  limit?: number;
}

/** Options for {@link InteractionLog.search}. */
export interface SearchOptions {
  /** Only records of these kinds. Omit for all kinds. */
  kinds?: InteractionKind[];
  /** Only records with this session id. */
  sessionId?: string;
  /** Maximum hits returned, 1 to 1000. Defaults to 10. */
  limit?: number;
}

/** One ranked search result. */
export interface SearchHit {
  /** The matching record, with its inline content. */
  record: InteractionRecord;
  /**
   * Relevance in [0, 1]. Lexical only: Jaccard similarity of token sets.
   * With a semantic provider: the mean of Jaccard and the similarity from
   * `calculateSimilarity`.
   */
  score: number;
}

/**
 * Options for {@link InteractionLog.select}.
 *
 * `fields` cannot be combined with `lines` or `regex`. Matching works on the
 * record's bounded text: the inline content, read from the blob head for a
 * spilled record, capped at `maxInlineBytes`.
 */
export interface SelectOptions {
  /**
   * Regex source (no flags). Keeps only the lines that match. Max 256
   * characters, must compile, and must pass the shape checks in
   * `InteractionLogRegex` (no nested quantifiers, no alternation inside a
   * quantified group, at most two unbounded quantifiers in total).
   * Each line is matched on its first 4 KiB (256 bytes when the pattern has two
   * unbounded quantifiers), and the whole pass has a 200 ms budget.
   */
  regex?: string;
  /**
   * 1-based inclusive line range `[from, to]` of the bounded text. `to` is
   * clamped to the last line. Applied before `regex`.
   */
  lines?: [number, number];
  /**
   * Record fields to return instead of lines. Any of the keys of
   * {@link InteractionRecord}. `content` returns the bounded text.
   */
  fields?: string[];
}

/**
 * Excerpt returned by {@link InteractionLog.select}.
 *
 * - With no options, `lines` holds every line of the bounded text.
 * - With `lines`, only lines in the range. With `regex`, only matching lines.
 *   With both, lines in the range that also match.
 * - With `fields`, `lines` is empty and `fields` holds the picked values.
 */
export interface SelectResult {
  /** Address of the selected record. */
  addr: string;
  /** Kind of the selected record. */
  kind: InteractionKind;
  /** Selected lines with 1-based numbers. Empty when `fields` was given. */
  lines: Array<{ line: number; text: string }>;
  /** Picked record fields, present only when `fields` was given. */
  fields?: Record<string, unknown>;
  /** Number of lines in the bounded text, before any filtering. */
  totalLines: number;
  /** True when the record is spilled, so only its first `maxInlineBytes` were matched. */
  bounded: boolean;
}

/**
 * Structural view of `SemanticSearch` used for the optional blended search.
 * Only `calculateSimilarity` is needed.
 */
export interface SemanticSimilarityProvider {
  /** Similarity of two texts in [0, 1]. May reject. */
  calculateSimilarity(a: string, b: string): Promise<number>;
}

/** Record fields that `select` may return. */
export const SELECTABLE_FIELDS: ReadonlySet<string> = new Set([
  'addr',
  'ts',
  'sessionId',
  'kind',
  'tag',
  'content',
  'bytes',
  'spill',
]);

/** Maximum value of a `range` or `search` limit. */
export const MAX_RESULT_LIMIT = 1000;

/**
 * Validate a result limit.
 *
 * @param value - Caller value, or undefined.
 * @param fallback - Default when undefined.
 * @returns The limit, an integer in [1, 1000].
 */
export function checkLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new InteractionLogError(`limit must be an integer in [1, ${MAX_RESULT_LIMIT}]`, ErrorCode.INVALID_FIELD_VALUE);
  }
  return value;
}

/**
 * Validate caller input for `append`.
 *
 * @param input - Input to check.
 * @throws InteractionLogError When a field is missing or has the wrong type.
 */
export function validateAppendInput(input: InteractionAppendInput): void {
  if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) {
    throw new InteractionLogError('append: sessionId must be a non-empty string', ErrorCode.INVALID_FIELD_VALUE);
  }
  if (!(INTERACTION_KINDS as readonly string[]).includes(input.kind)) {
    throw new InteractionLogError(`append: unknown kind "${String(input.kind)}"`, ErrorCode.INVALID_FIELD_VALUE);
  }
  if (typeof input.content !== 'string') {
    throw new InteractionLogError('append: content must be a string', ErrorCode.INVALID_FIELD_VALUE);
  }
  if (input.tag !== undefined && typeof input.tag !== 'string') {
    throw new InteractionLogError('append: tag must be a string', ErrorCode.INVALID_FIELD_VALUE);
  }
}
