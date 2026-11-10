/**
 * InteractionLog: an append-only JSONL sidecar of model turns, tool calls,
 * tool outputs, notes and feedback, addressed as `e<n>`.
 *
 * Content larger than `maxInlineBytes` is written to a blob file next to the
 * log, and the record keeps only the first `maxInlineBytes` bytes plus a
 * `spill` pointer. `select` returns only the excerpt the caller asks for, so a
 * caller can pull evidence into context one line or match at a time.
 *
 * Files:
 * - log: `sidecarPath(storageFilePath, '-interactions')` (`<basename>-interactions.jsonl`)
 * - blobs: `<dir>/<basename>-interactions-blobs/e<n>`
 *
 * The log file is read in full on the first operation (one scan recovers the
 * next address). A torn trailing line (no final newline) and any line that
 * does not decode to a valid record are skipped. The next append starts on a
 * fresh line, so a torn tail is never merged with a new record.
 *
 * Every public method runs under one mutex, so concurrent appends receive
 * distinct, consecutive addresses. The log is single-process (like
 * `graphMutex`): instances on one path share a mutex, before each append
 * the file size is re-checked and records another instance appended are picked
 * up from the tail, and blobs are created with `wx` (EEXIST throws), so two
 * instances in one process do not collide; separate processes are not coordinated. The log holds no open handle between
 * calls; `close()` marks the instance closed and drops the loaded index.
 *
 * @module agent/harness/InteractionLog
 * @experimental The API and on-disk layout may change in minor releases.
 *   Blob naming and the `select` output shape are the parts most likely to move.
 */

import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import { join, basename, resolve } from 'path';
import type { RunExclusiveMutex } from '../../utils/RunExclusiveMutex.js';
import { sidecarPath } from '../../utils/sidecarPath.js';
import { durableAppendFile } from '../../utils/durableWriteFile.js';
import { compileSelectRegex, matchSelectLines } from './InteractionLogRegex.js';
import { fileSize, readBlobHead, readRange, sharedMutex, readLogFile, writeBlobExclusive } from './InteractionLogBlobs.js';
import { validateFilePath } from '../../utils/entityUtils.js';
import { tokenizeUnicodeToSet, jaccard } from '../../utils/textSimilarity.js';
import { readEnvStrictInt } from '../../utils/envConfig.js';
import { ErrorCode } from '../../utils/errors.js';
import {
  InteractionLogError,
  checkLimit,
  decodeLine,
  encodeInteractionLine,
  formatAddr,
  parseAddr,
  scanInteractionLog,
  truncateToBytes,
  SELECTABLE_FIELDS,
  validateAppendInput,
  type InteractionAppendInput,
  type InteractionRecord,
  type InteractionSpill,
  type InteractionLogOptions,
  type RangeOptions,
  type SearchOptions,
  type SearchHit,
  type SelectOptions,
  type SelectResult,
  type SemanticSimilarityProvider,
} from './InteractionLogFormat.js';

export { InteractionLogError } from './InteractionLogFormat.js';
export type {
  InteractionAppendInput,
  InteractionKind,
  InteractionRecord,
  InteractionSpill,
  InteractionLogOptions,
  RangeOptions,
  SearchOptions,
  SearchHit,
  SelectOptions,
  SelectResult,
  SemanticSimilarityProvider,
} from './InteractionLogFormat.js';

/** Default inline budget in bytes when neither the option nor the env var is set. */
const DEFAULT_MAX_INLINE_BYTES = 16384;

/** Default number of records returned by `range` and `search`. */
const DEFAULT_RANGE_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 10;

/** Index entry for one record on disk. */
interface IndexEntry {
  offset: number;
  length: number;
  spilled: boolean;
}

/** In-memory state loaded from the log file. */
interface LoadedState {
  size: number;
  index: Map<number, IndexEntry>;
  maxN: number;
  spilled: number;
  needsNewline: boolean;
}

/**
 * Append-only interaction log with addressed records, spill to blobs, and
 * excerpt-only selection.
 *
 * @example
 * const log = new InteractionLog('/data/memory.jsonl');
 * const addr = await log.append({ sessionId: 's1', kind: 'tool_output', content: out });
 * const { lines } = await log.select(addr, { regex: 'error', lines: [1, 50] });
 * await log.close();
 */
export class InteractionLog {
  /** Path of the JSONL log file. */
  readonly logPath: string;
  /** Directory that holds blob files. Created on the first spill. */
  readonly blobDir: string;
  /** Largest inline content size in bytes. */
  readonly maxInlineBytes: number;

  private readonly mutex: RunExclusiveMutex;
  private state: LoadedState | undefined;
  private closed = false;
  private semantic: SemanticSimilarityProvider | undefined;

  /**
   * @param storageFilePath - Path of the primary storage file. The log and
   *   blob directory are derived from it with `sidecarPath`. No file is
   *   touched until the first operation.
   * @param options - Inline budget override.
   * @throws InteractionLogError When `maxInlineBytes` is not a positive integer.
   */
  constructor(storageFilePath: string, options: InteractionLogOptions = {}) {
    const absolute = resolve(storageFilePath);
    this.logPath = sidecarPath(absolute, '-interactions');
    this.blobDir = sidecarPath(absolute, '-interactions-blobs', '');
    this.mutex = sharedMutex(this.logPath);
    const configured =
      options.maxInlineBytes ??
      readEnvStrictInt('MEMORY_INTERACTION_LOG_INLINE_BYTES', { min: 1 }) ??
      DEFAULT_MAX_INLINE_BYTES;
    if (!Number.isInteger(configured) || configured < 1) {
      throw new InteractionLogError('maxInlineBytes must be a positive integer', ErrorCode.INVALID_CONFIG);
    }
    this.maxInlineBytes = configured;
  }

  /**
   * Set or clear the semantic provider used by `search`. With a provider,
   * each hit is scored as the mean of its Jaccard and similarity scores. If
   * the provider throws or rejects, that call falls back to Jaccard alone.
   *
   * @param provider - Provider with `calculateSimilarity`, or `undefined` to clear.
   */
  setSemanticSearch(provider?: SemanticSimilarityProvider): void {
    this.semantic = provider;
  }

  /**
   * Append one record.
   *
   * Content over `maxInlineBytes` is first written to a blob at
   * `<blobDir>/e<n>`. The record line then keeps only the inline prefix and a
   * `spill` pointer, so a line never refers to a missing blob.
   *
   * @param input - Session, kind, optional tag and timestamp, and content.
   * @returns The new record's address, `e<n>`.
   * @throws InteractionLogError On invalid input, a closed log, or a failed write.
   */
  append(input: InteractionAppendInput): Promise<string> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      validateAppendInput(input);
      const st = await this.refresh();
      const n = st.maxN + 1;
      const addr = formatAddr(n);
      const bytes = Buffer.byteLength(input.content, 'utf8');

      let inline = input.content;
      let spill: InteractionSpill | undefined;
      if (bytes > this.maxInlineBytes) {
        inline = truncateToBytes(input.content, this.maxInlineBytes);
        await writeBlobExclusive(this.blobPath(addr), input.content);
        spill = { path: `${basename(this.blobDir)}/${addr}`, originalBytes: bytes };
      }

      const record: InteractionRecord = {
        addr,
        ts: input.ts ?? new Date().toISOString(),
        sessionId: input.sessionId,
        kind: input.kind,
        tag: input.tag,
        content: inline,
        bytes,
        spill,
      };
      const line = encodeInteractionLine(record);
      const prefix = st.needsNewline ? '\n' : '';
      const body = prefix + line;
      const offset = st.size + prefix.length;
      try {
        await durableAppendFile(this.logPath, body);
      } catch (err) {
        // The file may hold a partial line now. Rescan on the next operation.
        this.state = undefined;
        throw new InteractionLogError(
          `Failed to append to InteractionLog: ${(err as Error).message}`,
          ErrorCode.STORAGE_WRITE_FAILED,
        );
      }
      st.size += Buffer.byteLength(body);
      st.needsNewline = false;
      st.index.set(n, { offset, length: Buffer.byteLength(line) - 1, spilled: spill !== undefined });
      st.maxN = n;
      if (spill) st.spilled++;
      return addr;
    });
  }

  /**
   * Read one record as stored. For a spilled record this is the inline
   * prefix plus `spill`; use {@link select} to read the blob.
   *
   * @param addr - Address `e<n>`.
   * @returns The stored record.
   * @throws InteractionLogError On a bad address, an unknown address, or a closed log.
   */
  read(addr: string): Promise<InteractionRecord> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      const n = parseAddr(addr);
      const st = await this.refresh();
      const entry = st.index.get(n);
      if (!entry) throw new InteractionLogError(`No InteractionLog record at ${addr}`, ErrorCode.ENTITY_NOT_FOUND);
      const handle = await fs.open(this.logPath, 'r');
      try {
        return this.decodeEntry(handle, addr, entry);
      } finally {
        await handle.close();
      }
    });
  }

  /**
   * Records with addresses from `from` to `to` inclusive, in address order.
   *
   * @param from - First address, `e<n>`.
   * @param to - Last address, `e<n>`. Returns an empty list when `to` is before `from`.
   * @param options - `limit` caps the count (default 100, max 1000).
   * @returns Stored records, at most `limit`.
   * @throws InteractionLogError On a bad address, bad limit, or a closed log.
   */
  range(from: string, to: string, options: RangeOptions = {}): Promise<InteractionRecord[]> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      const limit = checkLimit(options.limit, DEFAULT_RANGE_LIMIT);
      const lo = parseAddr(from);
      const hi = parseAddr(to);
      if (lo > hi) return [];
      const st = await this.refresh();
      const keys = [...st.index.keys()].filter((n) => n >= lo && n <= hi).sort((a, b) => a - b).slice(0, limit);
      if (keys.length === 0) return [];
      const handle = await fs.open(this.logPath, 'r');
      try {
        const out: InteractionRecord[] = [];
        for (const n of keys) out.push(await this.decodeEntry(handle, formatAddr(n), st.index.get(n)!));
        return out;
      } finally {
        await handle.close();
      }
    });
  }

  /**
   * Lexical search over inline content: Jaccard similarity of token sets. With a
   * semantic provider (see {@link setSemanticSearch}) each score is the mean
   * `(jaccard + similarity) / 2`. Only records with a positive
   * score are returned, ordered by score, then by newer address first.
   *
   * Spilled records are matched on their inline prefix only. An empty query
   * returns no hits.
   *
   * @param query - Free text.
   * @param options - Kind and session filters, and `limit` (default 10, max 1000).
   * @returns Ranked hits.
   * @throws InteractionLogError On a bad limit or a closed log.
   */
  search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      const limit = checkLimit(options.limit, DEFAULT_SEARCH_LIMIT);
      const qTokens = tokenizeUnicodeToSet(query ?? '');
      if (qTokens.size === 0) return [];
      await this.load();
      const buf = await readLogFile(this.logPath);
      const candidates = scanInteractionLog(buf).records
        .map((s) => s.record)
        .filter((r) => (!options.kinds || options.kinds.includes(r.kind)) && (!options.sessionId || r.sessionId === options.sessionId));

      const lexical = candidates.map((r) => jaccard(qTokens, tokenizeUnicodeToSet(r.content)));
      let scores = lexical;
      if (this.semantic) {
        try {
          const provider = this.semantic;
          const sims = await Promise.all(candidates.map((r) => provider.calculateSimilarity(query, r.content)));
          scores = lexical.map((lex, i) => (lex + sims[i]) / 2);
        } catch {
          scores = lexical;
        }
      }

      const hits: SearchHit[] = [];
      candidates.forEach((record, i) => {
        if (scores[i] > 0) hits.push({ record, score: scores[i] });
      });
      hits.sort((a, b) => b.score - a.score || parseAddr(b.record.addr) - parseAddr(a.record.addr));
      return hits.slice(0, limit);
    });
  }

  /**
   * Return only the excerpt of one record that the options select.
   *
   * Line numbers are 1-based and count lines of the bounded text. Lines split
   * on `\n` (a trailing `\r` is kept in the text). For a spilled record the
   * bounded text is the first `maxInlineBytes` of its blob, so a regex never
   * scans the whole blob.
   *
   * @param addr - Address `e<n>`.
   * @param options - See {@link SelectOptions}. `fields` cannot be combined with `lines` or `regex`.
   * @returns The excerpt.
   * @throws InteractionLogError On a bad address, a bad regex (length, nested
   *   quantifiers, or compile failure), an invalid `lines` range, an unknown
   *   field, a combination of `fields` with `lines` or `regex`, or a closed log.
   */
  select(addr: string, options: SelectOptions = {}): Promise<SelectResult> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      const n = parseAddr(addr);
      if (options.fields && (options.lines || options.regex !== undefined)) {
        throw new InteractionLogError('select: fields cannot be combined with lines or regex');
      }
      const compiled = options.regex !== undefined ? compileSelectRegex(options.regex) : undefined;
      if (options.lines) {
        const [from, to] = options.lines;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
          throw new InteractionLogError('select: lines must be [from, to] with 1 <= from <= to');
        }
      }
      if (options.fields) {
        for (const f of options.fields) {
          if (!SELECTABLE_FIELDS.has(f)) throw new InteractionLogError(`select: unknown field "${f}"`);
        }
      }

      const st = await this.refresh();
      const entry = st.index.get(n);
      if (!entry) throw new InteractionLogError(`No InteractionLog record at ${addr}`, ErrorCode.ENTITY_NOT_FOUND);
      const handle = await fs.open(this.logPath, 'r');
      let record: InteractionRecord;
      try {
        record = await this.decodeEntry(handle, addr, entry);
      } finally {
        await handle.close();
      }
      const text = record.spill ? await readBlobHead(this.blobPath(record.addr), this.maxInlineBytes) : record.content;

      if (options.fields) {
        const picked: Record<string, unknown> = {};
        for (const f of options.fields) {
          picked[f] = f === 'content' ? text : (record as unknown as Record<string, unknown>)[f];
        }
        return { addr, kind: record.kind, lines: [], fields: picked, totalLines: text.split('\n').length, bounded: entry.spilled };
      }

      const all = text.split('\n');
      const [from, to] = options.lines ?? [1, all.length];
      const out = matchSelectLines(all, from, to, compiled);
      return { addr, kind: record.kind, lines: out, totalLines: all.length, bounded: entry.spilled };
    });
  }

  /**
   * Record count, log file size in bytes, and spilled record count.
   *
   * @returns Current totals.
   * @throws InteractionLogError On a closed log.
   */
  stats(): Promise<{ records: number; bytes: number; spilled: number }> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen();
      const st = await this.refresh();
      return { records: st.index.size, bytes: st.size, spilled: st.spilled };
    });
  }

  /**
   * Release loaded state. Idempotent. After `close`, every other method
   * rejects. No file handle is held between calls, so this only drops the
   * in-memory index.
   */
  close(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.closed = true;
      this.state = undefined;
    });
  }

  /** Throw if the log has been closed. */
  private assertOpen(): void {
    if (this.closed) throw new InteractionLogError('InteractionLog is closed');
  }

  /**
   * Load the index on first use. Caller must hold the mutex.
   *
   * @returns The loaded state, scanned from the log file.
   */
  private async load(): Promise<LoadedState> {
    if (this.state) return this.state;
    const buf = await readLogFile(this.logPath);
    const scan = scanInteractionLog(buf);
    const index = new Map<number, IndexEntry>();
    for (const s of scan.records) {
      index.set(parseAddr(s.record.addr), { offset: s.offset, length: s.length, spilled: s.record.spill !== undefined });
    }
    this.state = {
      size: buf.length,
      index,
      maxN: scan.maxN,
      spilled: scan.spilled,
      needsNewline: scan.tornTail,
    };
    return this.state;
  }

  /**
   * Load the index, then pick up records another instance appended since the
   * last known size by scanning only the new tail. Caller must hold the mutex.
   *
   * @returns The up-to-date state.
   */
  private async refresh(): Promise<LoadedState> {
    const st = await this.load();
    const size = await fileSize(this.logPath);
    if (size === st.size) return st;
    if (size < st.size || st.needsNewline) {
      this.state = undefined;
      return this.load();
    }
    const scan = scanInteractionLog(await readRange(this.logPath, st.size, size));
    for (const r of scan.records) {
      const spilled = r.record.spill !== undefined;
      st.index.set(parseAddr(r.record.addr), { offset: st.size + r.offset, length: r.length, spilled });
      if (spilled) st.spilled++;
    }
    st.maxN = Math.max(st.maxN, scan.maxN);
    st.size = size;
    st.needsNewline = scan.tornTail;
    return st;
  }

  /**
   * Read and decode the record at an index entry.
   *
   * @param handle - Open read handle on the log file.
   * @param addr - Address, used in the error message.
   * @param entry - Index entry to read.
   * @returns The decoded record.
   */
  private async decodeEntry(handle: FileHandle, addr: string, entry: IndexEntry): Promise<InteractionRecord> {
    const buf = Buffer.alloc(entry.length);
    await handle.read(buf, 0, entry.length, entry.offset);
    const record = decodeLine(buf);
    if (!record || record.addr !== addr) {
      throw new InteractionLogError(`InteractionLog record ${addr} is unreadable`, ErrorCode.STORAGE_CORRUPTED);
    }
    return record;
  }

  /**
   * Blob path for an address. The address is validated by regex before the
   * path is built, and the result is confined to the blob directory.
   *
   * @param addr - Address `e<n>`.
   * @returns Absolute blob path.
   */
  private blobPath(addr: string): string {
    parseAddr(addr);
    return validateFilePath(join(this.blobDir, addr), this.blobDir, true);
  }
}
