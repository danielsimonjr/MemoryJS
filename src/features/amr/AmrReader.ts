/**
 * Read-only reader for an Agent Memory Repo (AMR): link checks, confined file reads, the context
 * loader and the repository checker. The module never writes, renames, makes directories or deletes.
 *
 * @module features/amr/AmrReader
 * @experimental
 */
import { randomBytes } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import { ValidationError } from '../../utils/errors.js';
import { foldPathCase, strictlyInside } from '../../utils/confinedPath.js';
import { parseAmrDocument } from './AmrCodec.js';
import { loadSecretPatterns, scanForSecrets, validateSecretPatterns, type SecretPattern } from './SecretScanner.js';

/** Limits for the reader. Every function takes a partial object over these defaults. */
export interface AmrReaderOptions {
  /** Largest file the reader reads, in bytes. */
  maxFileBytes: number;
  /** Largest total of file text in one context load, in UTF-8 bytes. */
  maxTotalBytes: number;
  /** Largest number of files in one context load, `MEMORY.md` included. */
  maxFiles: number;
  /** Deepest link level that the loader follows. `MEMORY.md` is level 0. */
  maxDepth: number;
  /** Largest `MEMORY.md` that `checkAmr` accepts, in bytes. */
  maxIndexBytes: number;
  /** Longest link text that {@link checkAmrLink} accepts, in UTF-16 code units. */
  maxLinkChars: number;
  /** Names that the reader refuses and the walk skips, in any case. */
  ignore: string[];
}

/** The one place for every reader default. */
export const AMR_READER_DEFAULTS: AmrReaderOptions = {
  maxFileBytes: 1_048_576,
  maxTotalBytes: 262_144,
  maxFiles: 50,
  maxDepth: 2,
  maxIndexBytes: 16_384,
  maxLinkChars: 1024,
  ignore: ['.git', 'node_modules'],
};

/** Why a link or a path is refused. */
export type AmrLinkReason =
  | 'empty'
  | 'too-long'
  | 'absolute'
  | 'backslash'
  | 'traversal'
  | 'dot-segment'
  | 'empty-segment'
  | 'control'
  | 'colon'
  | 'windows-char'
  | 'edge-space-or-dot'
  | 'reserved-name'
  | 'git-dir'
  | 'hidden';

/** Result of {@link checkAmrLink}. */
export type AmrLinkCheck =
  | { ok: true; candidates: string[] }
  | { ok: false; reason: AmrLinkReason };

/** Result of {@link readAmrFile}. `code` is a short error code (for example `EBUSY`), never a path. */
export type AmrReadResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'invalid-path' | 'missing' | 'not-regular' | 'symlink' | 'outside-root' | 'excluded' | 'too-large';
    }
  | { ok: false; reason: 'unreadable'; code: string };

/** Result of {@link loadAmrContext}. */
export interface AmrContext {
  /** One labelled data block with every admitted file. */
  text: string;
  /** Repo-relative paths with `/`, in read order. `MEMORY.md` is first. */
  files: string[];
  /** True when a budget cut `MEMORY.md` or skipped a file. */
  truncated: boolean;
  /** Unsafe, refused and dangling links. */
  warnings: string[];
}

/** Code of one {@link AmrIssue}. */
export type AmrIssueCode =
  | 'missing-memory-md'
  | 'unsafe-link'
  | 'unsafe-target'
  | 'dangling-link'
  | 'bad-date'
  | 'malformed-metadata'
  | 'case-duplicate'
  | 'unparseable'
  | 'index-too-large'
  | 'unreadable'
  | 'secret'
  | 'bad-patterns';

/** One problem that {@link checkAmr} found. */
export interface AmrIssue {
  /** Repo-relative path with `/`. */
  file: string;
  /**
   * Physical line where the bullet starts, starting at 1. Absent when the issue has no line.
   * A `bad-patterns` issue has no file and uses line 0.
   */
  line?: number;
  /** Issue code. */
  code: AmrIssueCode;
  /** Short reason or value. */
  detail: string;
}

/** Options of {@link checkAmr}: the reader options plus the secret patterns. */
export interface AmrCheckOptions extends Partial<AmrReaderOptions> {
  /**
   * Secret patterns to scan with. Without it, `checkAmr` loads them from the environment
   * (see `loadSecretPatterns`). A list that is not valid gives one `bad-patterns` issue.
   */
  patterns?: readonly SecretPattern[];
}

/** Result of {@link checkAmr}. */
export interface AmrCheckReport {
  /** Number of walked `.md` files. */
  files: number;
  /** Issues, sorted by file and then by line. */
  issues: AmrIssue[];
}

type ReadFailure = Exclude<AmrReadResult, { ok: true }>;
type Resolved = { ok: true; abs: string; real: string; size: number };

/** Per-call state: the real root (computed once) and the resolver cache. */
interface RunContext {
  root: string;
  o: AmrReaderOptions;
  ignore: Set<string>;
  realRoot: Promise<string | null>;
  cache: Map<string, Promise<Resolved | ReadFailure>>;
}

const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  ...Array.from({ length: 10 }, (_, i) => `COM${i}`),
  ...Array.from({ length: 10 }, (_, i) => `LPT${i}`),
  ...['\u00b9', '\u00b2', '\u00b3'].flatMap((d) => [`COM${d}`, `LPT${d}`]),
]);

/** C0, DEL, C1, line and paragraph separators, and bidi controls. */
// oxlint-disable-next-line no-control-regex -- the rule is to find control characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** The suffix of a Markdown file, in any case. */
export const MARKDOWN_SUFFIX = /\.md$/i;

const MEMORY_FILE = 'MEMORY.md';
const TRUNCATED_LINE = '[truncated]\n';

/**
 * Merge the caller's partial options over the defaults. A number that is not finite or is
 * negative gives the default. An `ignore` value that is not a string array gives the default.
 * @param opts - Partial options.
 * @returns Full options.
 */
function resolveOptions(opts: Partial<AmrReaderOptions> = {}): AmrReaderOptions {
  const o: AmrReaderOptions = { ...AMR_READER_DEFAULTS, ignore: [...AMR_READER_DEFAULTS.ignore] };
  const numericKeys = ['maxFileBytes', 'maxTotalBytes', 'maxFiles', 'maxDepth', 'maxIndexBytes', 'maxLinkChars'] as const;
  for (const k of numericKeys) {
    const v: unknown = opts[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) o[k] = v;
  }
  const ig: unknown = opts.ignore;
  if (Array.isArray(ig) && ig.every((n) => typeof n === 'string')) o.ignore = [...(ig as string[])];
  return o;
}

/**
 * Make raw text safe for a warning or an issue detail: escape controls and cut at 120 characters.
 * @param s - Raw text.
 * @returns The escaped text.
 */
function quote(s: string): string {
  const cut = s.length > 120 ? `${s.slice(0, 120)}...` : s;
  return JSON.stringify(cut)
    .slice(1, -1)
    .replace(/[\u2028\u2029\u202a-\u202e\u2066-\u2069\u0080-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Tell whether a string is a real `YYYY-MM-DD` calendar date.
 * @param value - Metadata value.
 * @returns True for a real date.
 */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Tell whether a path segment is a Windows device name: its stem before the first `.` is a reserved
 * name, in any case.
 * @param segment - One path segment.
 * @returns True for a reserved device name.
 */
export function isReservedName(segment: string): boolean {
  return RESERVED_NAMES.has(segment.split('.')[0].toUpperCase());
}

/**
 * Check the segment rules of one repo-relative path. The first failing rule gives the reason.
 * The length rule is not here: {@link checkAmrLink} applies it to the raw link only.
 * @param path - Path text with `/`.
 * @returns The refusal reason, or null when the path is safe.
 */
function checkAmrPath(path: string): AmrLinkReason | null {
  if (path === '') return 'empty';
  if (CONTROL.test(path)) return 'control';
  if (/^[/\\]/.test(path) || /^[A-Za-z]:/.test(path)) return 'absolute';
  if (path.includes('\\')) return 'backslash';
  if (path.includes(':')) return 'colon';
  // Windows cannot create a file with these characters, so a repo that holds one breaks a checkout there.
  if (/["<>|?*]/.test(path)) return 'windows-char';
  const segments = path.split('/');
  if (segments.includes('..')) return 'traversal';
  if (segments.includes('.')) return 'dot-segment';
  if (segments.includes('')) return 'empty-segment';
  for (const s of segments) {
    if (s.startsWith(' ') || s.endsWith(' ') || s.endsWith('.')) return 'edge-space-or-dot';
  }
  for (const s of segments) {
    if (isReservedName(s)) return 'reserved-name';
  }
  for (const s of segments) {
    const lower = s.toLowerCase();
    if (lower === '.git' || /^git~\d+$/.test(lower)) return 'git-dir';
  }
  if (segments.some((s) => s.startsWith('.'))) return 'hidden';
  return null;
}

/**
 * Check one raw link before any path work. The first failing rule gives the reason.
 * @param link - Link text as `extractLinks` returns it.
 * @param opts - Partial reader options; `maxLinkChars` applies.
 * @returns The candidate paths, or the refusal reason.
 */
export function checkAmrLink(link: string, opts: Partial<AmrReaderOptions> = {}): AmrLinkCheck {
  if (link === '') return { ok: false, reason: 'empty' };
  if (link.length > resolveOptions(opts).maxLinkChars) return { ok: false, reason: 'too-long' };
  const reason = checkAmrPath(link);
  if (reason) return { ok: false, reason };
  const last = link.slice(link.lastIndexOf('/') + 1);
  return { ok: true, candidates: last.includes('.') ? [link] : [`${link}.md`, link] };
}

/**
 * Map a thrown fs error to a read failure. The result never holds the error message or a path.
 * @param e - Thrown value.
 * @returns The failure.
 */
function fsFailure(e: unknown): ReadFailure {
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'EUNKNOWN';
  if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing' };
  if (code === 'EISDIR') return { ok: false, reason: 'not-regular' };
  if (code === 'ELOOP') return { ok: false, reason: 'symlink' };
  return { ok: false, reason: 'unreadable', code };
}

/**
 * Make the per-call state.
 * @param root - Memory root (absolute).
 * @param o - Full options.
 * @returns The run context.
 */
function makeContext(root: string, o: AmrReaderOptions): RunContext {
  return {
    root,
    o,
    ignore: new Set(['.git', ...o.ignore.map((n) => n.toLowerCase())]),
    realRoot: fs.realpath(root).catch(() => null),
    cache: new Map(),
  };
}

/**
 * Check a real path against the root: it must be strictly inside, and no segment below the root
 * may be `.git` or an `ignore` name (any case).
 * @param ctx - Run context.
 * @param realRoot - Real path of the root.
 * @param real - Real path of the file.
 * @returns The failure, or null when the path is allowed.
 */
function confine(ctx: RunContext, realRoot: string, real: string): ReadFailure | null {
  if (!strictlyInside(foldPathCase(realRoot), foldPathCase(real))) return { ok: false, reason: 'outside-root' };
  const below = relative(realRoot, real).split(sep);
  if (below.some((s) => ctx.ignore.has(s.toLowerCase()))) return { ok: false, reason: 'excluded' };
  return null;
}

/**
 * Resolve one path below the root without a read: lstat, realpath, confinement and size.
 * The result is cached per call.
 * @param ctx - Run context.
 * @param rel - Safe path below the root, with `/`.
 * @returns The absolute path, the real path and the size, or why it was refused.
 */
function resolveFile(ctx: RunContext, rel: string): Promise<Resolved | ReadFailure> {
  let hit = ctx.cache.get(rel);
  if (!hit) {
    hit = resolveUncached(ctx, rel);
    ctx.cache.set(rel, hit);
  }
  return hit;
}

/**
 * Body of {@link resolveFile}.
 * @param ctx - Run context.
 * @param rel - Safe path below the root, with `/`.
 * @returns The resolution.
 */
async function resolveUncached(ctx: RunContext, rel: string): Promise<Resolved | ReadFailure> {
  const abs = join(ctx.root, rel);
  try {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) return { ok: false, reason: 'symlink' };
    if (!st.isFile()) return { ok: false, reason: 'not-regular' };
    const realRoot = await ctx.realRoot;
    if (realRoot === null) return { ok: false, reason: 'missing' };
    const real = await fs.realpath(abs);
    const refused = confine(ctx, realRoot, real);
    if (refused) return refused;
    if (st.size > ctx.o.maxFileBytes) return { ok: false, reason: 'too-large' };
    return { ok: true, abs, real, size: st.size };
  } catch (e) {
    return fsFailure(e);
  }
}

/**
 * Read one resolved file through a handle. The checks run again on the open handle: fstat
 * (regular file, size), realpath after the open, confinement, and the identity (dev, ino) of the
 * real path (lstat, no follow) against the handle. The read is capped at `maxFileBytes + 1` bytes.
 * Remaining window: a hard link inside the root to an outside file has the same identity and is
 * read. Text that changes after the open is read as it is.
 * @param ctx - Run context.
 * @param rel - Safe path below the root, with `/`.
 * @returns The text, or why it was refused.
 */
async function readResolved(ctx: RunContext, rel: string): Promise<AmrReadResult> {
  const pre = await resolveFile(ctx, rel);
  if (!pre.ok) return pre;
  const realRoot = await ctx.realRoot;
  if (realRoot === null) return { ok: false, reason: 'missing' };
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(pre.abs, flags);
    const hs = await fh.stat({ bigint: true });
    if (!hs.isFile()) return { ok: false, reason: 'not-regular' };
    if (hs.size > BigInt(ctx.o.maxFileBytes)) return { ok: false, reason: 'too-large' };
    const real = await fs.realpath(pre.abs);
    const refused = confine(ctx, realRoot, real);
    if (refused) return refused;
    const rs = await fs.lstat(real, { bigint: true }); // lstat: a symlink swapped in at `real` must not match.
    // Node 22 on Windows reports a bigint lstat dev of 0n; compare dev only when both stats report one.
    const devDiffers = rs.dev !== 0n && hs.dev !== 0n && rs.dev !== hs.dev;
    if (!rs.isFile() || devDiffers || rs.ino !== hs.ino) return { ok: false, reason: 'outside-root' };
    const cap = ctx.o.maxFileBytes + 1;
    const buf = Buffer.alloc(Math.min(cap, Number(hs.size) + 1));
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > ctx.o.maxFileBytes) return { ok: false, reason: 'too-large' };
    return { ok: true, text: buf.subarray(0, n).toString('utf8') };
  } catch (e) {
    return fsFailure(e);
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/**
 * Read one file below `root`. The path must pass the segment rules of {@link checkAmrLink}.
 * A symlink or junction never leaves the root, and no path below `.git` or an `ignore` name is read.
 * No fs error escapes: it becomes a reason.
 * @param root - Memory root (absolute).
 * @param relPath - Path below the root, with `/`.
 * @param opts - Partial reader options; `maxFileBytes` and `ignore` apply.
 * @returns The file text, or why it was refused.
 */
export async function readAmrFile(
  root: string,
  relPath: string,
  opts: Partial<AmrReaderOptions> = {}
): Promise<AmrReadResult> {
  if (checkAmrPath(relPath) !== null) return { ok: false, reason: 'invalid-path' };
  return readResolved(makeContext(root, resolveOptions(opts)), relPath);
}

/**
 * Pick the outcome of a link from the outcomes of its candidates. An unsafe candidate wins, then
 * an unreadable one; a link is dangling only when every candidate is missing.
 * @param fails - Failures of the candidates.
 * @returns The code and the detail reason.
 */
function linkOutcome(fails: ReadFailure[]): { code: 'unsafe-target' | 'unreadable' | 'dangling-link'; detail: string } {
  const unsafe = fails.find((f) => f.reason === 'symlink' || f.reason === 'outside-root' || f.reason === 'excluded');
  if (unsafe) return { code: 'unsafe-target', detail: unsafe.reason };
  const bad = fails.find((f) => f.reason !== 'missing');
  if (bad) return { code: 'unreadable', detail: bad.reason === 'unreadable' ? bad.code : bad.reason };
  return { code: 'dangling-link', detail: 'missing' };
}

/**
 * Cut text at a byte budget on a UTF-8 boundary.
 * @param text - Text to cut.
 * @param budget - Largest number of bytes.
 * @returns The cut text.
 */
function cutUtf8(text: string, budget: number): string {
  const buf = Buffer.from(text, 'utf8');
  let n = Math.max(0, Math.min(budget, buf.length));
  while (n > 0 && n < buf.length && (buf[n] & 0xc0) === 0x80) n--;
  return buf.subarray(0, n).toString('utf8');
}

/**
 * Load `MEMORY.md` and the files that its bullet links reach, breadth first, into one labelled block.
 * A `MEMORY.md` above `maxTotalBytes` is cut on a UTF-8 boundary and ends with the line `[truncated]`.
 * When a budget is full, the loader reads no more files but still reports the unsafe links it sees.
 * @param root - Memory root (absolute).
 * @param opts - Partial reader options.
 * @returns The data block, the file list, the truncation flag and the warnings.
 * @throws ValidationError when `MEMORY.md` is missing or cannot be read.
 */
export async function loadAmrContext(root: string, opts: Partial<AmrReaderOptions> = {}): Promise<AmrContext> {
  const o = resolveOptions(opts);
  const ctx = makeContext(root, o);
  const memory = await readResolved(ctx, MEMORY_FILE);
  if (!memory.ok) {
    const message =
      memory.reason === 'missing' ? `${MEMORY_FILE} is missing at the memory root` : `${MEMORY_FILE} cannot be read`;
    throw new ValidationError(message, [`memory-md:${memory.reason}`]);
  }

  let truncated = false;
  let memoryText = memory.text;
  if (Buffer.byteLength(memoryText, 'utf8') > o.maxTotalBytes) {
    memoryText = cutUtf8(memoryText, o.maxTotalBytes);
    if (memoryText !== '' && !memoryText.endsWith('\n')) memoryText += '\n';
    memoryText += TRUNCATED_LINE;
    truncated = true;
  }

  const warnings: string[] = [];
  const memoryReal = await resolveFile(ctx, MEMORY_FILE);
  const visited = new Set<string>(memoryReal.ok ? [foldPathCase(memoryReal.real)] : []);
  const seenLinks = new Set<string>([MEMORY_FILE]);
  const admitted: Array<{ path: string; text: string }> = [{ path: MEMORY_FILE, text: memoryText }];
  const queue: Array<{ path: string; depth: number; text: string }> = [{ path: MEMORY_FILE, depth: 0, text: memoryText }];
  let total = Buffer.byteLength(memoryText, 'utf8');
  const full = (): boolean => admitted.length >= o.maxFiles || total >= o.maxTotalBytes;

  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi];
    if (node.depth >= o.maxDepth) continue;
    const doc = parseAmrDocument(node.text);
    for (const line of doc.lines) {
      if (line.kind !== 'bullet' || !line.entry) continue;
      for (const link of line.entry.links) {
        const check = checkAmrLink(link, o);
        if (!check.ok) {
          warnings.push(`Unsafe link [[${quote(link)}]] in ${node.path}: ${check.reason}`);
          continue;
        }
        if (check.candidates.some((c) => seenLinks.has(c))) continue;
        check.candidates.forEach((c) => seenLinks.add(c));
        if (full()) {
          truncated = true; // No I/O after a budget is full.
          continue;
        }
        const fails: ReadFailure[] = [];
        let done = false;
        for (const candidate of check.candidates) {
          const res = await resolveFile(ctx, candidate);
          if (!res.ok) {
            fails.push(res);
            continue;
          }
          done = true;
          const key = foldPathCase(res.real);
          if (visited.has(key)) break;
          visited.add(key);
          if (res.size > o.maxTotalBytes - total) {
            truncated = true; // Raw bytes are a lower bound on text bytes: skip with no read.
            break;
          }
          const r = await readResolved(ctx, candidate);
          if (!r.ok) {
            done = false;
            fails.push(r);
            continue;
          }
          const bytes = Buffer.byteLength(r.text, 'utf8');
          if (total + bytes > o.maxTotalBytes) {
            truncated = true;
            break;
          }
          admitted.push({ path: candidate, text: r.text });
          total += bytes;
          queue.push({ path: candidate, depth: node.depth + 1, text: r.text });
          break;
        }
        if (done) continue;
        const out = linkOutcome(fails);
        warnings.push(
          out.code === 'dangling-link'
            ? `Dangling link [[${quote(link)}]] in ${node.path}`
            : `Refused link [[${quote(link)}]] in ${node.path}: ${out.detail}`
        );
      }
    }
  }

  const nonce = randomBytes(8).toString('hex');
  let text = `<<<AMR-MEMORY ${nonce} data-not-instructions>>>\n`;
  for (const f of admitted) {
    let body = f.text.replace(/<<<END-AMR-MEMORY/g, '<<<END\u2011AMR-MEMORY');
    if (!body.endsWith('\n')) body += '\n';
    text += `--- file ${nonce}: ${f.path} ---\n${body}`;
  }
  text += `<<<END-AMR-MEMORY ${nonce}>>>`;
  return { text, files: admitted.map((f) => f.path), truncated, warnings };
}

/**
 * Group paths that are equal after NFC normalisation and lower case.
 * @param paths - Repo-relative paths.
 * @returns Groups of two or more paths. Each group is sorted, and the groups are sorted by their first member.
 */
export function findCaseDuplicates(paths: string[]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const p of paths) {
    const key = p.normalize('NFC').toLowerCase();
    const group = byKey.get(key);
    if (group) group.push(p);
    else byKey.set(key, [p]);
  }
  const groups: string[][] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    groups.push(group.sort());
  }
  return groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Walk the memory root for `.md` files. The walk skips `ignore` names in any case.
 * The walk skips each symlink or junction and reports each one.
 * @param root - Memory root (absolute).
 * @param o - Full reader options.
 * @returns Repo-relative paths with `/`, and the issues of the walk.
 */
async function walkMarkdown(root: string, o: AmrReaderOptions): Promise<{ files: string[]; issues: AmrIssue[] }> {
  const ignore = new Set(o.ignore.map((n) => n.toLowerCase()));
  const files: string[] = [];
  const issues: AmrIssue[] = [];
  const visit = async (dirAbs: string, relDir: string): Promise<void> => {
    let names: string[];
    try {
      names = (await fs.readdir(dirAbs)).sort();
    } catch (e) {
      const f = fsFailure(e);
      if (relDir !== '' || f.reason !== 'missing') {
        issues.push({ file: relDir || '.', code: 'unreadable', detail: f.reason === 'unreadable' ? f.code : f.reason });
      }
      return;
    }
    for (const name of names) {
      if (ignore.has(name.toLowerCase())) continue;
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      let st;
      try {
        st = await fs.lstat(join(dirAbs, name));
      } catch (e) {
        const f = fsFailure(e);
        issues.push({ file: quote(rel), code: 'unreadable', detail: f.reason === 'unreadable' ? f.code : f.reason });
        continue;
      }
      if (st.isSymbolicLink()) issues.push({ file: quote(rel), code: 'unsafe-target', detail: 'symlink' });
      else if (st.isDirectory()) await visit(join(dirAbs, name), rel);
      else if (st.isFile() && MARKDOWN_SUFFIX.test(name)) files.push(rel);
    }
  };
  await visit(root, '');
  return { files, issues };
}

/**
 * Check a whole memory repo and report every problem with its file and line.
 * `checkAmr` reads each walked file once. `checkAmr` resolves link targets without a read.
 * It scans each walked file for secret patterns and reports the pattern id only.
 * @param root - Memory root (absolute).
 * @param opts - Partial reader options and the optional secret patterns.
 * @returns The walked file count and the sorted issues.
 */
export async function checkAmr(root: string, opts: AmrCheckOptions = {}): Promise<AmrCheckReport> {
  const o = resolveOptions(opts);
  const ctx = makeContext(root, o);
  const walk = await walkMarkdown(root, o);
  const walked = walk.files;
  const issues: AmrIssue[] = [...walk.issues];
  let patterns: readonly SecretPattern[] | null = null;
  try {
    patterns = opts.patterns !== undefined ? validateSecretPatterns(opts.patterns) : loadSecretPatterns();
  } catch (e) {
    const code = (e as { errors?: unknown }).errors;
    const detail = Array.isArray(code) && typeof code[0] === 'string' ? code[0] : 'patterns:invalid';
    issues.push({ file: '', line: 0, code: 'bad-patterns', detail });
  }
  const memory = await resolveFile(ctx, MEMORY_FILE);
  if (!memory.ok && memory.reason === 'missing') {
    issues.push({ file: MEMORY_FILE, code: 'missing-memory-md', detail: `${MEMORY_FILE} is missing` });
  }
  const memoryKey = memory.ok ? foldPathCase(memory.real) : null;

  for (const rel of walked) {
    const r = await readResolved(ctx, rel);
    if (!r.ok) {
      const unsafe = r.reason === 'symlink' || r.reason === 'outside-root' || r.reason === 'excluded';
      issues.push({
        file: rel,
        code: unsafe ? 'unsafe-target' : 'unreadable',
        detail: r.reason === 'unreadable' ? r.code : r.reason,
      });
      continue;
    }
    const self = await resolveFile(ctx, rel);
    if (memoryKey !== null && self.ok && foldPathCase(self.real) === memoryKey) {
      const bytes = Buffer.byteLength(r.text, 'utf8');
      if (bytes > o.maxIndexBytes) issues.push({ file: rel, code: 'index-too-large', detail: `${bytes} bytes` });
    }
    if (patterns !== null) {
      for (const hit of scanForSecrets(r.text, patterns)) {
        issues.push({ file: rel, line: hit.line, code: 'secret', detail: hit.patternId });
      }
    }
    const doc = parseAmrDocument(r.text);
    if (!doc.parseable) {
      issues.push({ file: rel, code: 'unparseable', detail: doc.warnings.join('; ') || 'document cannot be edited safely' });
    }
    for (let index = 0; index < doc.lines.length; index++) {
      const line = doc.lines[index];
      if (line.kind !== 'bullet' || !line.entry) continue;
      const at = { file: rel, line: index + 1 };
      for (const w of line.entry.warnings) issues.push({ ...at, code: 'malformed-metadata', detail: quote(w) });
      for (const value of line.entry.meta.added ?? []) {
        if (!isRealDate(value)) issues.push({ ...at, code: 'bad-date', detail: `added: ${quote(value)}` });
      }
      for (const link of line.entry.links) {
        const check = checkAmrLink(link, o);
        if (!check.ok) {
          issues.push({ ...at, code: 'unsafe-link', detail: check.reason });
          continue;
        }
        const fails: ReadFailure[] = [];
        for (const candidate of check.candidates) {
          const res = await resolveFile(ctx, candidate);
          if (res.ok) break;
          fails.push(res);
        }
        if (fails.length < check.candidates.length) continue;
        const out = linkOutcome(fails);
        issues.push({ ...at, code: out.code, detail: out.code === 'dangling-link' ? `[[${quote(link)}]]` : out.detail });
      }
    }
  }

  for (const group of findCaseDuplicates(walked)) {
    issues.push({ file: group[0], code: 'case-duplicate', detail: group.join(', ') });
  }

  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const k = JSON.stringify([i.file, i.line ?? 0, i.code, i.detail]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });
  return { files: walked.length, issues: unique };
}

/**
 * List every Markdown file below a memory root, with no file budget. The walk skips the ignored
 * names and symbolic links, and reports each path that the reader refuses and each folder that it
 * cannot list to `onSkip`. The `.md` suffix matches in any case. It never reads file text.
 * @param root - Memory root (absolute).
 * @param opts - Partial reader options; only `ignore` applies.
 * @param onSkip - Optional; receives each skipped path and the reason.
 * @returns Repo-relative paths with `/`, sorted by code point.
 * @throws Error when the root itself cannot be listed.
 */
export async function walkAmrMarkdown(
  root: string,
  opts: Partial<AmrReaderOptions> = {},
  onSkip?: (path: string, reason: string) => void,
): Promise<string[]> {
  const ignored = new Set(resolveOptions(opts).ignore.map((n) => n.toLowerCase()));
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(join(root, ...dir.split('/').filter((s) => s !== '')), { withFileTypes: true });
    } catch (e) {
      if (dir === '') throw e;
      const f = fsFailure(e);
      onSkip?.(dir, f.reason === 'unreadable' ? f.code : f.reason);
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink() || ignored.has(ent.name.toLowerCase())) continue;
      const rel = dir === '' ? ent.name : `${dir}/${ent.name}`;
      if (ent.isDirectory()) await visit(rel);
      else if (ent.isFile() && MARKDOWN_SUFFIX.test(ent.name)) {
        const reason = checkAmrPath(rel);
        if (reason === null) out.push(rel);
        else onSkip?.(rel, reason);
      }
    }
  };
  await visit('');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
