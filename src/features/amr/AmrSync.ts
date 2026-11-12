/**
 * One-way sync between the graph and an Agent Memory Repo (AMR). `exportAmr` writes graph entities to
 * Markdown files. `importAmr` reads those files into the graph. Both work one entity at a time and
 * never delete a file or an entity.
 *
 * @module features/amr/AmrSync
 * @experimental
 */
import { promises as fs } from 'node:fs';
import type { ManagerContext } from '../../core/ManagerContext.js';
import type { Entity, Relation } from '../../types/types.js';
import { ValidationError } from '../../utils/errors.js';
import { CreateEntitySchema, CreateRelationSchema, UpdateEntitySchema } from '../../utils/schemas.js';
import { extractLinks, formatEntryText, parseAmrDocument, renderAmrDocument, setEntries, type AmrDocument, type AmrEntryEdit, type AmrLine } from './AmrCodec.js';
import { parseFrontMatter, renderFrontMatter, type FrontMatterValues } from './AmrFrontMatter.js';
import { checkAmrLink, readAmrFile, walkAmrMarkdown } from './AmrReader.js';
import { checkAmrWritePath, checkFileText, writeAmrFiles, type AmrFileText } from './AmrWriter.js';
import type { GitRunner } from './GitRunner.js';
import { loadSecretPatterns, scanForSecrets, type SecretPattern } from './SecretScanner.js';

/** Export and import mode for observations. */
export type AmrSyncMode = 'add-only' | 'reconcile';

/** Options of the sync. Every field has a default in {@link AMR_SYNC_DEFAULTS}. */
export interface AmrSyncOptions {
  /** Entity types to export, or null for all. */
  types?: string[] | null;
  /** Number of entities in the `MEMORY.md` index, by importance. */
  indexTopN?: number;
  /** Largest size of the `MEMORY.md` index section, in characters. */
  indexMaxChars?: number;
  /** `add-only` keeps graph data; `reconcile` lets the file win. */
  mode?: AmrSyncMode;
  /** True writes nothing. The report is the same as a real run. */
  dryRun?: boolean;
  /** Namespace prefix of entity names, without the trailing slash. */
  namespace?: string;
  /** Clock for validity checks and dates. Defaults to the current time. */
  now?: Date;
  /** Git runner of the repository. The runner is required when `dryRun` is false. */
  runner?: GitRunner;
}

/** Defaults of the sync. One place. */
export interface AmrSyncDefaults {
  types: string[] | null;
  indexTopN: number;
  indexMaxChars: number;
  mode: AmrSyncMode;
  dryRun: boolean;
}

/** The one place for the sync defaults. */
export const AMR_SYNC_DEFAULTS: AmrSyncDefaults = {
  types: null,
  indexTopN: 20,
  indexMaxChars: 4000,
  mode: 'add-only',
  dryRun: true,
};

/** Longest observation that the importer accepts, in characters. */
const MAX_OBSERVATION_CHARS = 5000;
/** Largest number of relations in one `createRelations` or `deleteRelations` call (the schema limit). */
const RELATION_BATCH = 1000;
/** Longest path segment that a slug or a plain name gives. */
const MAX_SEGMENT_CHARS = 100;
/** Segments that a path made from a name may not use: Windows device names and the reader's ignore list. */
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d|node_modules)$/;
// The control characters are the subject of this pattern.
// oxlint-disable-next-line no-control-regex
const SEPARATOR_OR_SPACE = /[\s\x1c-\x1e\x85]+/g;
// oxlint-disable-next-line no-control-regex
const HAS_LINE_BREAK = /[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]/;
const HEADING = /^#{1,2}(\s|$)/;
const RELATIONS_HEADING = /^##\s+relations\s*$/i;
const INDEX_HEADING = /^ {0,3}##\s+index\s*$/i;
/** A relation type that the `## Relations` bullet format can hold: no whitespace, bracket, backslash or control. */
// oxlint-disable-next-line no-control-regex
const RELATION_TYPE = /^[^\s[\]\\\x00-\x1f\x7f]+$/;
const RELATION_BULLET = new RegExp(`^(${RELATION_TYPE.source.slice(1, -1)})\\s+\\[\\[([^[\\]\\n]+)\\]\\]$`);
/** Characters that a link target may not hold. */
const BAD_TARGET = /[[\]|#\r\n]/;

/** Result of a sync: a graph change or an export write. */
export interface AmrFileReport {
  /** Repo-relative path with `/`. */
  path: string;
  /** What the export does with the file. */
  action: 'create' | 'update' | 'unchanged' | 'refused';
  /** Number of lines that the export adds or changes. */
  changedLines: number;
  /** Bullets of the main section that match no observation. */
  stale: number;
  /** Why the file is refused. */
  reason?: string;
}

/** Report of {@link exportAmr}. Dry and real runs return deep-equal reports. */
export interface AmrExportReport {
  /** One entry per entity file that the export handles, then each refused hub or index file. */
  files: AmrFileReport[];
  /** Count of entities and observations that the export skipped, by rule. */
  skipped: { type: number; notLatest: number; archived: number; private: number; invalidObservations: number; secret: number };
  /** Notes, one per dropped or rewritten value. */
  warnings: string[];
  /** Set when the writer failed, or a dry run with a runner finds the tree not ready. */
  writeError?: string;
}

/** One entity entry of {@link importAmr}. */
export interface AmrImportEntity {
  /** Entity name, with the namespace applied. */
  name: string;
  /** Repo-relative path with `/`. */
  file: string;
  /** What the import does with the entity. */
  action: 'create' | 'update' | 'unchanged' | 'error';
  /** Reason of an error. */
  error?: string;
}

/** Report of {@link importAmr}. Dry and real runs return deep-equal reports. */
export interface AmrImportReport {
  /** One entry per Markdown file, in path order. */
  entities: AmrImportEntity[];
  /** Count of relations that the import creates and removes. */
  relations: { created: number; removed: number };
  /** Links with no target file. */
  danglingLinks: { file: string; link: string }[];
  /** Notes, for example a front matter value that is not used. */
  warnings: string[];
}

/** Options of {@link importAmr}. */
export interface AmrImportOptions {
  /** `add-only` (default) or `reconcile`. */
  mode?: AmrSyncMode;
  /** True (default) changes nothing. */
  dryRun?: boolean;
  /** Namespace prefix of entity names. */
  namespace?: string;
  /** Clock for the validity checks of `reconcile`. Defaults to the current time. */
  now?: Date;
}

/** One observation read from a file. */
interface NoteObservation {
  content: string;
  recordedAt?: string;
  meta: Record<string, string[]>;
}

/** One file read for import. */
interface NoteFile {
  file: string;
  name: string;
  type: string;
  tags?: string[];
  importance?: number;
  ttl?: number;
  projectId?: string;
  observations: NoteObservation[];
  inlineLinks: string[];
  relationLinks: Array<{ type: string; link: string }>;
  unparseable: boolean;
  tooLong: boolean;
}

/** One observation prepared for export. */
type ExportObservation = { text: string; recordedAt?: string; meta: Record<string, string[]> };

/** Graph metadata of one observation. */
type ObservationMeta = NonNullable<Entity['observationMeta']>[number];

/**
 * Normalise an observation for matching. Each run of whitespace and line separators becomes one
 * space, and the result is trimmed.
 * @param s - Observation text.
 * @returns The normalised text.
 */
export function normalizeObservation(s: string): string {
  return s.replace(SEPARATOR_OR_SPACE, ' ').trim();
}

/**
 * Compare two strings by code point.
 * @param a - First string.
 * @param b - Second string.
 * @returns A negative, zero or positive number.
 */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Give the name of a file. The front matter `name` wins over the path. The namespace is added in front.
 * @param fmName - Front matter name, or undefined.
 * @param rel - Repo-relative path.
 * @param namespace - Namespace prefix, or undefined.
 * @returns The NFC-normalised entity name.
 */
function nameFor(fmName: string | undefined, rel: string, namespace: string | undefined): string {
  const base = (fmName !== undefined && fmName !== '' ? fmName : rel.replace(/\.md$/i, '')).normalize('NFC');
  return namespace ? `${namespace}/${base}` : base;
}

/**
 * Give the name that the file side computes for a graph name: NFC, with the namespace in front
 * when the namespace is not there yet.
 * @param name - Graph entity name.
 * @param namespace - Namespace prefix, or undefined.
 * @returns The key that `nameFor` gives for the file of this entity.
 */
function exportKey(name: string, namespace: string | undefined): string {
  const n = name.normalize('NFC');
  if (!namespace || n.startsWith(`${namespace}/`)) return n;
  return `${namespace}/${n}`;
}

/**
 * Strip the namespace from a key.
 * @param key - Key from {@link exportKey}.
 * @param namespace - Namespace prefix, or undefined.
 * @returns The name without `<namespace>/`.
 */
function bareName(key: string, namespace: string | undefined): string {
  return namespace && key.startsWith(`${namespace}/`) ? key.slice(namespace.length + 1) : key;
}

/**
 * Normalise a link target for a compare: cut the alias and the anchor, trim, and remove `.md`.
 * @param link - Link text.
 * @returns The target path without `.md`.
 */
function normLink(link: string): string {
  return link.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '');
}

/**
 * Give the slug of a type or a name. The slug is lower case, holds only `[a-z0-9_-]` and has at most
 * 100 characters.
 * @param s - Text to slug.
 * @returns The slug. `entity` when empty, and `<name>-entity` for a reserved name.
 */
function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEGMENT_CHARS)
    .replace(/-+$/, '');
  if (base === '') return 'entity';
  return RESERVED_NAME.test(base) ? `${base}-entity` : base;
}

/**
 * Give the slug of an entity type. `_hubs` is reserved for the hub folder.
 * @param type - Entity type.
 * @returns The folder slug.
 */
function typeSlug(type: string): string {
  const s = slug(type);
  return s === '_hubs' ? '_hubs-entity' : s;
}

/**
 * Tell whether an entity name can be a file path as it is.
 * @param name - Name without the namespace.
 * @returns True when the name is ASCII, passes the reader link rules, has no uppercase letter and no `.md`,
 *   is not `memory`, does not start with `_hubs/`, and has no reserved segment and no segment above 100 characters.
 */
function isPlainName(name: string): boolean {
  if (!/^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/.test(name)) return false;
  if (name === 'memory' || name === '_hubs' || name.startsWith('_hubs/')) return false;
  if (!checkAmrLink(name).ok) return false;
  return name.split('/').every((seg) => seg.length <= MAX_SEGMENT_CHARS && !RESERVED_NAME.test(seg));
}

/**
 * Give the base path of a bare name and a type.
 * @param bare - Name without the namespace.
 * @param type - Entity type.
 * @returns The path with `/` and `.md`.
 */
function pathFor(bare: string, type: string): string {
  if (isPlainName(bare)) return `${bare}.md`;
  return `${typeSlug(type)}/${slug(bare)}.md`;
}

/**
 * Give the base path of an entity that has no file.
 * @param entity - Entity; its name and type are used.
 * @param namespace - Namespace prefix, stripped first when the name starts with it.
 * @returns The path with `/` and `.md`.
 */
export function amrPathForEntity(entity: Entity, namespace?: string): string {
  return pathFor(bareName(entity.name.normalize('NFC'), namespace), entity.entityType);
}

/**
 * Format a timestamp as a UTC date.
 * @param iso - ISO 8601 timestamp, or undefined.
 * @returns `YYYY-MM-DD`, or undefined when the value is missing or not a date.
 */
function utcDate(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/**
 * Pick a positive integer, or the default.
 * @param v - Value to check.
 * @param d - Default.
 * @returns The value when it is a finite integer above 0, else the default.
 */
function positiveInt(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : d;
}

/**
 * Resolve options over the defaults.
 * @param opts - Options of the caller.
 * @returns The merged options.
 */
function resolveOptions(opts: AmrSyncOptions) {
  const d = AMR_SYNC_DEFAULTS;
  return {
    types: Array.isArray(opts.types) ? opts.types : d.types,
    indexTopN: positiveInt(opts.indexTopN, d.indexTopN),
    indexMaxChars: positiveInt(opts.indexMaxChars, d.indexMaxChars),
    mode: opts.mode === 'reconcile' ? ('reconcile' as const) : d.mode,
    dryRun: opts.dryRun ?? d.dryRun,
  };
}

/**
 * Compare two value lists.
 * @param a - First list, or undefined.
 * @param b - Second list.
 * @returns True when both hold the same values in the same order.
 */
function sameList(a: string[] | undefined, b: string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Tell whether the export writes an observation. The import's reconcile uses the same rule, so reconcile
 * never removes what the export would not write.
 * @param raw - Observation text.
 * @param m - Graph metadata of the observation, or undefined.
 * @param now - Clock.
 * @param patterns - Secret patterns.
 * @returns `ok`, `invalid` (outside its validity window, empty or too long) or `secret`.
 */
function exportable(raw: string, m: ObservationMeta | undefined, now: Date, patterns: readonly SecretPattern[]): 'ok' | 'invalid' | 'secret' {
  const until = m?.validUntil !== undefined ? Date.parse(m.validUntil) : NaN;
  const from = m?.validFrom !== undefined ? Date.parse(m.validFrom) : NaN;
  if (until < now.getTime() || from > now.getTime()) return 'invalid';
  if (scanForSecrets(raw, patterns).length > 0) return 'secret';
  const text = normalizeObservation(raw);
  if (text === '' || text.length > MAX_OBSERVATION_CHARS) return 'invalid';
  return 'ok';
}

/**
 * Index the graph metadata of an entity by observation content. The first entry wins.
 * @param e - Entity.
 * @returns The map.
 */
function metaByContent(e: Entity): Map<string, ObservationMeta> {
  const out = new Map<string, ObservationMeta>();
  for (const m of e.observationMeta ?? []) if (!out.has(m.content)) out.set(m.content, m);
  return out;
}

/**
 * Drop the keys and values that the bullet format refuses, with one warning for each.
 * @param meta - Metadata to check.
 * @param warn - Receives one warning per dropped key.
 * @param where - Name used in the warning.
 * @returns The metadata that the format accepts.
 */
function encodableMeta(meta: Record<string, string[]>, warn: (w: string) => void, where: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(meta)) {
    try {
      formatEntryText('x', { [key]: meta[key] });
      out[key] = meta[key];
    } catch {
      warn(`${where}: metadata key ${key} dropped, it cannot be written`);
    }
  }
  return out;
}

/**
 * Render one observation as a bullet line.
 * @param o - Observation with its `observationMeta` fields.
 * @param stamp - Date for the `added` key, or undefined.
 * @param where - Name used in warnings.
 * @param warn - Receives the warnings.
 * @returns The bullet line, without its terminator.
 */
function bulletFor(o: ExportObservation, stamp: string | undefined, where: string, warn: (w: string) => void): string {
  const meta: Record<string, string[]> = {};
  if (stamp !== undefined) meta.added = [stamp];
  Object.assign(meta, encodableMeta(o.meta, warn, where));
  try {
    return `- ${formatEntryText(o.text, meta)}`;
  } catch {
    warn(`${where}: metadata of an observation dropped, it cannot be written`);
    return `- ${formatEntryText(o.text, {})}`;
  }
}

/**
 * Count the lines of `after` that `before` does not hold, as a multiset.
 * @param before - Text before the change.
 * @param after - Text after the change.
 * @returns The number of lines that are new.
 */
function countNewLines(before: string, after: string): number {
  const counts = new Map<string, number>();
  for (const l of before.split('\n')) counts.set(l, (counts.get(l) ?? 0) + 1);
  let n = 0;
  for (const l of after.split('\n')) {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else n++;
  }
  return n;
}

/**
 * Find the line range of the first `## Relations` section (any case).
 * @param doc - Parsed document.
 * @returns The index of the heading (or -1) and the index after the section.
 */
function relationsRange(doc: AmrDocument): { start: number; end: number } {
  const start = doc.lines.findIndex((l) => l.kind === 'heading' && RELATIONS_HEADING.test(l.raw));
  if (start < 0) return { start: -1, end: doc.lines.length };
  let end = start + 1;
  while (end < doc.lines.length && !(doc.lines[end].kind === 'heading' && HEADING.test(doc.lines[end].raw))) end++;
  return { start, end };
}

/**
 * Count the leading whitespace of a line.
 * @param raw - Line text.
 * @returns The indent.
 */
function indentOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

/**
 * Insert raw lines into a line array, in place. The new lines use the document terminator, and the
 * line before them gets one when that line had none.
 * @param lines - Lines to change.
 * @param at - Index before which the lines go.
 * @param raws - Line texts.
 * @param eol - Document terminator.
 */
function spliceRaw(lines: AmrLine[], at: number, raws: string[], eol: AmrDocument['eol']): void {
  if (at > 0 && lines[at - 1].eolAfter === '') lines[at - 1] = { ...lines[at - 1], eolAfter: eol };
  lines.splice(at, 0, ...raws.map((raw) => ({ kind: 'prose' as const, raw, eolAfter: eol })));
}

/**
 * Find where a new main-section bullet goes: after the last top-level bullet and its whole list item
 * (continuations, nested bullets, an indented fence, and blank lines that an indented line follows),
 * or at the end of the main section when it has no bullet.
 * @param lines - Lines of the document.
 * @param mainEnd - Index after the main section.
 * @returns The insert index.
 */
function mainInsertIndex(lines: AmrLine[], mainEnd: number): number {
  let lastTop = -1;
  for (let i = 0; i < mainEnd; i++) {
    const l = lines[i];
    if (l.kind === 'bullet' && l.entry !== undefined && (l.indent ?? 0) === 0) lastTop = i;
  }
  if (lastTop < 0) return mainEnd;
  let at = lastTop + 1;
  while (at < mainEnd) {
    const l = lines[at];
    if (l.kind === 'continuation' || (l.kind === 'bullet' && (l.indent ?? 0) > 0)) {
      at++;
      continue;
    }
    if (l.kind === 'fence' && indentOf(l.raw) > 0) {
      while (at < mainEnd && lines[at].kind === 'fence') at++;
      continue;
    }
    if (l.kind === 'blank') {
      let j = at;
      while (j < mainEnd && lines[j].kind === 'blank') j++;
      if (j < mainEnd && lines[j].kind !== 'heading' && indentOf(lines[j].raw) > 0) {
        at = j;
        continue;
      }
    }
    break;
  }
  return at;
}

/** Result of merging an entity into an existing file. */
type MergeResult = { refused: true } | { refused: false; text: string; stale: number };

/**
 * Merge the entity into an existing file. A matched bullet is rewritten when a graph metadata key is
 * missing from the bullet or has another value, or its date differs; keys that only the file holds stay.
 * Unmatched observations go after the last top-level list item. New relations go at the end of
 * `## Relations`. No bullet is removed.
 * @param doc - Parsed file.
 * @param obs - Observations of the entity, normalised.
 * @param rels - Relations to write, as `{ type, target }` with the target path without `.md`.
 * @param entity - Entity, for the creation date fallback.
 * @param where - Name used in warnings.
 * @param warn - Receives the warnings.
 * @returns The merged text and the stale count, or a refusal.
 */
function mergeExisting(
  doc: AmrDocument,
  obs: ExportObservation[],
  rels: Array<{ type: string; target: string }>,
  entity: Entity,
  where: string,
  warn: (w: string) => void,
): MergeResult {
  if (!doc.parseable) return { refused: true };
  const rel0 = relationsRange(doc);
  const mainEnd0 = rel0.start < 0 ? doc.lines.length : rel0.start;
  const pool = new Map<string, number[]>();
  let mainBullets = 0;
  for (let i = 0; i < mainEnd0; i++) {
    const l = doc.lines[i];
    if (l.kind !== 'bullet' || l.entry === undefined) continue;
    mainBullets++;
    const k = normalizeObservation(l.entry.text);
    const q = pool.get(k);
    if (q === undefined) pool.set(k, [i]);
    else q.push(i);
  }
  let used = 0;
  const rewrites: AmrEntryEdit[] = [];
  const unmatched: ExportObservation[] = [];
  for (const o of obs) {
    const idx = pool.get(o.text)?.shift();
    if (idx === undefined) {
      unmatched.push(o);
      continue;
    }
    used++;
    const existing = doc.lines[idx].entry!.meta;
    const wanted = encodableMeta(o.meta, warn, where);
    delete wanted.added;
    const stampWanted = utcDate(o.recordedAt);
    const held = Object.keys(wanted).every((k) => sameList(existing[k], wanted[k]));
    const sameAdded = stampWanted === undefined || (existing.added?.[0] ?? '') === stampWanted;
    if (held && sameAdded) continue;
    const meta: Record<string, string[]> = { ...existing };
    const stamp = stampWanted ?? existing.added?.[0] ?? utcDate(entity.createdAt);
    if (stamp !== undefined) meta.added = [stamp];
    Object.assign(meta, wanted);
    try {
      formatEntryText(o.text, meta);
      rewrites.push({ index: idx, text: o.text, meta });
    } catch {
      warn(`${where}: a bullet is kept as it is, its metadata cannot be written`);
    }
  }
  const stale = mainBullets - used;

  const cur = rewrites.length > 0 ? setEntries(doc, rewrites) : doc;
  const lines = [...cur.lines];
  const info = relationsRange(cur);
  const mainEnd = info.start < 0 ? lines.length : info.start;

  const inline = new Set<string>();
  const present = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind !== 'bullet' || l.entry === undefined) continue;
    if (info.start >= 0 && i > info.start && i < info.end) {
      const m = RELATION_BULLET.exec(l.entry.text);
      if (m !== null) present.add(`${m[1]}\u0000${normLink(m[2])}`);
    } else {
      for (const link of l.entry.links) inline.add(normLink(link));
    }
  }
  for (const o of unmatched) for (const link of extractLinks(o.text)) inline.add(normLink(link));
  const relRaws: string[] = [];
  for (const r of rels) {
    if (inline.has(r.target) || present.has(`${r.type}\u0000${r.target}`)) continue;
    present.add(`${r.type}\u0000${r.target}`);
    relRaws.push(`- ${r.type} [[${r.target}]]`);
  }

  const inserts: Array<{ at: number; raws: string[] }> = [];
  if (relRaws.length > 0) {
    if (info.start < 0) {
      inserts.push({ at: lines.length, raws: ['', '## Relations', '', ...relRaws] });
    } else {
      let last = info.end - 1;
      while (last > info.start && lines[last].kind === 'blank') last--;
      let at = last + 1;
      if (last === info.start && lines[at]?.kind === 'blank' && at < info.end) at++;
      inserts.push({ at, raws: relRaws });
    }
  }
  if (unmatched.length > 0) {
    const stamp = (o: ExportObservation) => utcDate(o.recordedAt) ?? utcDate(entity.createdAt);
    inserts.push({ at: mainInsertIndex(lines, mainEnd), raws: unmatched.map((o) => bulletFor(o, stamp(o), where, warn)) });
  }
  // Highest index first, so earlier indexes stay valid. On a tie the relations go in first and end up last.
  for (const ins of inserts) spliceRaw(lines, ins.at, ins.raws, cur.eol);
  return { refused: false, text: renderAmrDocument({ ...cur, lines }), stale };
}

/** Result of a guarded text read. Only `missing` means that the file does not exist. */
type TextRead = { ok: true; text: string } | { ok: false; missing: boolean; reason: string };

/**
 * Read one repo file through the confined reader (no symlink, size cap, handle checks). No fs error
 * escapes. A busy or locked file is `unreadable`, never missing.
 * @param root - Memory root.
 * @param rel - Repo-relative path.
 * @returns The text, or why it was not read.
 */
async function readText(root: string, rel: string): Promise<TextRead> {
  const r = await readAmrFile(root, rel);
  if (r.ok) return r;
  return { ok: false, missing: r.reason === 'missing', reason: r.reason === 'unreadable' ? `unreadable ${r.code}` : r.reason };
}

/** An existing entity file of the export. */
type ExistingFile = { path: string; text: string; doc: AmrDocument } | { path: string; unreadable: string };

/**
 * Read every Markdown file of the export, with its name and parsed document. `MEMORY.md` and the
 * `_hubs/` folder is left out in any case. A file that cannot be read keeps its path-derived name,
 * so the entity of that name is neither edited nor given a second file.
 * @param root - Memory root.
 * @param namespace - Namespace prefix.
 * @param warn - Receives one warning per file that is not read.
 * @returns The files by name (first file wins), and the set of all paths in lower case.
 */
async function indexExisting(root: string, namespace: string | undefined, warn: (w: string) => void) {
  const byName = new Map<string, ExistingFile>();
  const taken = new Set<string>();
  const paths = await walkAmrMarkdown(root, {}, (p) => taken.add(p.toLowerCase()));
  for (const path of paths) {
    const lower = path.toLowerCase();
    taken.add(lower);
    if (lower === 'memory.md' || lower.startsWith('_hubs/')) continue;
    const r = await readText(root, path);
    if (!r.ok) {
      warn(`${path}: not read (${r.reason})`);
      const name = nameFor(undefined, path, namespace);
      if (!byName.has(name)) byName.set(name, { path, unreadable: r.reason });
      continue;
    }
    const doc = parseAmrDocument(r.text);
    const fm = doc.frontMatter !== undefined ? parseFrontMatter(doc.frontMatter).values : {};
    const fmName = typeof fm.name === 'string' ? fm.name : undefined;
    const name = nameFor(fmName, path, namespace);
    if (!byName.has(name)) byName.set(name, { path, text: r.text, doc });
  }
  return { byName, taken };
}

/**
 * Find the on-disk spelling of `MEMORY.md` and `_hubs` in the root, in any case.
 * @param root - Memory root.
 * @returns The spellings, or the default ones when absent.
 */
async function rootSpelling(root: string, warn: (w: string) => void): Promise<{ memory: string; hubs: string }> {
  const names = await listNames(root, '.', warn);
  return {
    memory: names.find((n) => n.toLowerCase() === 'memory.md') ?? 'MEMORY.md',
    hubs: names.find((n) => n.toLowerCase() === '_hubs') ?? '_hubs',
  };
}

/**
 * List the names in a folder. A missing folder gives an empty list; any other error gives an empty
 * list and a warning, so the file reads after it decide (they are guarded).
 * @param dir - Absolute folder path.
 * @param rel - Repo-relative name of the folder, for the warning.
 * @param warn - Receives the warning.
 * @returns The names.
 */
async function listNames(dir: string, rel: string, warn: (w: string) => void): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') warn(`${rel}: folder not listed (${code ?? 'error'})`);
    return [];
  }
}

/** One entity the export keeps, with its file key. */
interface KeptEntity {
  entity: Entity;
  key: string;
  bare: string;
  obs: ExportObservation[];
}

/**
 * Export graph entities to the memory repo. The write is one commit, and the commit runs only when `dryRun` is false.
 * Every refusal is decided before any write (the text checks and the read-only path check of the writer
 * run in both modes), so a dry run and a real run return the same report.
 * @param list - Entities to export. Hubs and the index list only the entities in `list`, so pass the full set of each exported type.
 * @param rels - Relations of the graph. Only the outgoing relations of an exported entity are written, and
 *   never one to an entity that the skip rules leave out.
 * @param root - Memory root (the repository top).
 * @param opts - Sync options.
 * @returns The export report.
 * @throws ValidationError when `dryRun` is false and no runner is given.
 */
export async function exportAmr(list: Entity[], rels: Relation[], root: string, opts: AmrSyncOptions = {}): Promise<AmrExportReport> {
  const o = resolveOptions(opts);
  if (!o.dryRun && opts.runner === undefined) {
    throw new ValidationError('A real export needs a git runner', ['runner']);
  }
  const ns = opts.namespace;
  const now = opts.now ?? new Date();
  const warnings: string[] = [];
  const warn = (w: string) => warnings.push(w);
  const skipped = { type: 0, notLatest: 0, archived: 0, private: 0, invalidObservations: 0, secret: 0 };
  const patterns = loadSecretPatterns();

  // One key per entity: the name that the file side computes. The first entity of a key wins.
  const byKey = new Map<string, Entity>();
  for (const e of list) {
    const key = exportKey(e.name, ns);
    if (key !== e.name) warn(`${e.name}: exported as ${key}`);
    if (byKey.has(key)) {
      warn(`${key}: a second entity of this name is not exported`);
      continue;
    }
    byKey.set(key, e);
  }

  type Loose = Entity & { lifecycleStatus?: string; visibility?: string; isLatest?: boolean };
  const hidden = new Set<string>();
  const kept: KeptEntity[] = [];
  for (const key of [...byKey.keys()].sort(byCodePoint)) {
    const e = byKey.get(key)!;
    const le = e as Loose;
    let rule: keyof typeof skipped | null = null;
    if (o.types !== null && !o.types.includes(e.entityType)) rule = 'type';
    else if (le.isLatest === false) rule = 'notLatest';
    else if (le.lifecycleStatus === 'archived') rule = 'archived';
    else if (le.visibility === 'private') rule = 'private';
    if (rule !== null) {
      skipped[rule]++;
      hidden.add(key);
      continue;
    }
    const metas = metaByContent(e);
    const obs: ExportObservation[] = [];
    for (const raw of e.observations ?? []) {
      const m = metas.get(raw);
      const verdict = exportable(raw, m, now, patterns);
      if (verdict === 'secret') {
        skipped.secret++;
        warn(`${key}: observation dropped by the secret scan`);
        continue;
      }
      if (verdict === 'invalid') {
        if (normalizeObservation(raw) !== '') skipped.invalidObservations++;
        continue;
      }
      if (HAS_LINE_BREAK.test(raw)) warn(`${key}: observation written on one line`);
      obs.push({ text: normalizeObservation(raw), recordedAt: m?.recordedAt, meta: m?.meta ?? {} });
    }
    kept.push({ entity: e, key, bare: bareName(key, ns), obs });
  }

  const spelling = await rootSpelling(root, warn);
  const index = await indexExisting(root, ns, warn);
  const taken = new Set(index.taken);
  const assigned = new Map<string, { path: string; existing?: ExistingFile }>();
  for (const k of kept) {
    let base = pathFor(k.bare, k.entity.entityType);
    let nameWritable = true;
    try {
      renderFrontMatter({ name: k.bare });
    } catch {
      nameWritable = false;
    }
    if (!nameWritable && nameFor(undefined, base, ns) !== k.key) {
      // The file cannot carry the key name, so the path names the entity; the next run finds the file by that name.
      const pathKey = nameFor(undefined, base, ns);
      warn(`${k.key}: the name cannot be written, the file is named ${pathKey}`);
      k.key = pathKey;
      k.bare = bareName(pathKey, ns);
      base = pathFor(k.bare, k.entity.entityType);
    }
    const ex = index.byName.get(k.key);
    if (ex !== undefined) {
      assigned.set(k.key, { path: ex.path, existing: ex });
      continue;
    }
    let path = base;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = base.replace(/\.md$/, `-${n}.md`);
    taken.add(path.toLowerCase());
    assigned.set(k.key, { path });
  }

  const targetOf = (key: string): string => {
    const p = assigned.get(key)?.path ?? index.byName.get(key)?.path ?? pathFor(bareName(key, ns), 'note');
    return p.replace(/\.md$/i, '');
  };
  const relsByFrom = new Map<string, Relation[]>();
  for (const r of rels) {
    const from = exportKey(r.from, ns);
    const group = relsByFrom.get(from);
    if (group === undefined) relsByFrom.set(from, [r]);
    else group.push(r);
  }

  const files: AmrFileReport[] = [];
  const writes: AmrFileText[] = [];
  const refuse = (path: string, reason: string) => files.push({ path, action: 'refused', changedLines: 0, stale: 0, reason });
  /** The text and path checks of the writer, run in both modes. */
  const precheck = async (path: string, text: string): Promise<string | null> =>
    checkFileText(path, text, '', patterns)?.reason ?? (await checkAmrWritePath(root, path));
  const hubMembers: Array<{ type: string; name: string; path: string; importance: number }> = [];
  for (const { entity, key, bare, obs } of kept) {
    const a = assigned.get(key)!;
    const outgoing: Array<{ type: string; target: string }> = [];
    const seen = new Set<string>();
    for (const r of relsByFrom.get(key) ?? []) {
      const toKey = exportKey(r.to, ns);
      if (hidden.has(toKey)) {
        warn(`${key}: relation ${r.relationType} dropped, its target is not exported`);
        continue;
      }
      if (!RELATION_TYPE.test(r.relationType) || r.relationType.length > 100) {
        warn(`${key}: relation type ${JSON.stringify(r.relationType)} dropped, it cannot be written`);
        continue;
      }
      const target = targetOf(toKey);
      if (BAD_TARGET.test(target)) {
        warn(`${key}: relation ${r.relationType} dropped, its target path cannot be a link`);
        continue;
      }
      const k = `${r.relationType}\u0000${target}`;
      if (seen.has(k)) continue;
      seen.add(k);
      outgoing.push({ type: r.relationType, target });
    }
    const member = { type: entity.entityType, name: key, path: a.path, importance: entity.importance ?? 0 };

    if (a.existing === undefined) {
      const text = renderNewFile(entity, key, bare, a.path, obs, outgoing, ns, warn);
      const reason = await precheck(a.path, text);
      if (reason !== null) {
        refuse(a.path, reason);
        continue;
      }
      files.push({ path: a.path, action: 'create', changedLines: text.split('\n').length - 1, stale: 0 });
      writes.push({ path: a.path, text });
      hubMembers.push(member);
      continue;
    }
    if ('unreadable' in a.existing) {
      refuse(a.path, a.existing.unreadable);
      continue;
    }
    const merged = mergeExisting(a.existing.doc, obs, outgoing, entity, key, warn);
    if (merged.refused) {
      refuse(a.path, 'unparseable');
      continue;
    }
    const changed = merged.text !== a.existing.text;
    if (changed) {
      const reason = await precheck(a.path, merged.text);
      if (reason !== null) {
        refuse(a.path, reason);
        continue;
      }
      writes.push({ path: a.path, text: merged.text });
    }
    files.push({
      path: a.path,
      action: changed ? 'update' : 'unchanged',
      changedLines: changed ? countNewLines(a.existing.text, merged.text) : 0,
      stale: merged.stale,
    });
    hubMembers.push(member);
  }

  const hubs = await hubFiles(root, spelling.hubs, hubMembers, warn);
  const hubLinks: string[] = [];
  for (const h of hubs) {
    if (h.refused !== undefined) {
      refuse(h.path, h.refused);
      warn(`${h.path}: hub not written (${h.refused})`);
      continue;
    }
    hubLinks.push(h.path.replace(/\.md$/i, ''));
    if (h.text === null) continue;
    const reason = await precheck(h.path, h.text);
    if (reason !== null) {
      hubLinks.pop();
      refuse(h.path, reason);
      warn(`${h.path}: hub not written (${reason})`);
      continue;
    }
    writes.push({ path: h.path, text: h.text });
  }
  const idx = await indexFile(root, spelling.memory, hubLinks, hubMembers, o.indexTopN, o.indexMaxChars);
  if ('refused' in idx) {
    refuse(spelling.memory, idx.refused);
    warn(`${spelling.memory}: index not written (${idx.refused})`);
  } else if (idx.text !== null) {
    const reason = await precheck(spelling.memory, idx.text);
    if (reason !== null) {
      refuse(spelling.memory, reason);
      warn(`${spelling.memory}: index not written (${reason})`);
    } else {
      writes.push({ path: spelling.memory, text: idx.text });
    }
  }

  const report: AmrExportReport = { files, skipped, warnings };
  if (opts.runner !== undefined && writes.length > 0) {
    if (o.dryRun) {
      const clean = await opts.runner.checkClean();
      if (!clean.ok) report.writeError = clean.code;
    } else {
      const res = await writeAmrFiles(root, writes, { runner: opts.runner, message: `export ${writes.length} files`, patterns });
      if (!res.ok) report.writeError = res.path !== undefined ? `${res.reason}: ${res.path}` : res.reason;
    }
  }
  return report;
}

/**
 * Render a new entity file.
 * @param entity - Entity.
 * @param key - Name that the file side computes for the entity.
 * @param bare - That name without the namespace.
 * @param path - Repo-relative path.
 * @param obs - Observations, normalised.
 * @param outgoing - Relations to write, with the target path without `.md`.
 * @param ns - Namespace prefix.
 * @param warn - Receives the warnings.
 * @returns The file text.
 */
function renderNewFile(
  entity: Entity,
  key: string,
  bare: string,
  path: string,
  obs: ExportObservation[],
  outgoing: Array<{ type: string; target: string }>,
  ns: string | undefined,
  warn: (w: string) => void,
): string {
  const fm: FrontMatterValues = {};
  const candidates: Array<[string, string | string[] | undefined]> = [
    ['name', nameFor(undefined, path, ns) === key ? undefined : bare],
    ['type', entity.entityType],
    ['tags', entity.tags !== undefined && entity.tags.length > 0 ? entity.tags : undefined],
    ['importance', entity.importance !== undefined ? String(entity.importance) : undefined],
    ['ttl', entity.ttl !== undefined ? String((entity as Entity & { ttl?: number }).ttl) : undefined],
  ];
  for (const [k, value] of candidates) {
    if (value === undefined) continue;
    try {
      renderFrontMatter({ [k]: value });
      fm[k] = value;
    } catch {
      warn(`${key}: front matter ${k} dropped, it cannot be written`);
    }
  }
  const bullets = obs.map((o) => bulletFor(o, utcDate(o.recordedAt) ?? utcDate(entity.createdAt), key, warn));
  const inline = new Set(obs.flatMap((o) => extractLinks(o.text).map(normLink)));
  const relLines = outgoing.filter((r) => !inline.has(r.target)).map((r) => `- ${r.type} [[${r.target}]]`);
  let text = Object.keys(fm).length > 0 ? `---\n${renderFrontMatter(fm)}---\n\n` : '';
  text += `# ${normalizeObservation(bare)}\n`;
  if (bullets.length > 0) text += `\n${bullets.map((b) => `${b}\n`).join('')}`;
  if (relLines.length > 0) text += `\n## Relations\n\n${relLines.map((l) => `${l}\n`).join('')}`;
  return text;
}

/** One hub of the export: the new text (null when unchanged), or why it is refused. */
type HubWrite = { path: string; text: string | null; refused?: string };

/**
 * Build the hub files, one for each type. A hub lists every exported entity of its type, in name order.
 * The hub text is generated: an entity that is not in this export is not listed.
 * @param root - Memory root.
 * @param hubsDir - On-disk spelling of the hub folder.
 * @param members - Exported entities.
 * @param warn - Receives a warning when the hub folder cannot be listed.
 * @returns One entry per hub.
 */
async function hubFiles(
  root: string,
  hubsDir: string,
  members: Array<{ type: string; name: string; path: string }>,
  warn: (w: string) => void,
): Promise<HubWrite[]> {
  const byHub = new Map<string, { heading: string; items: Array<{ name: string; path: string }> }>();
  for (const m of members) {
    const key = typeSlug(m.type);
    const hub = byHub.get(key) ?? { heading: m.type, items: [] };
    hub.items.push({ name: m.name, path: m.path });
    byHub.set(key, hub);
  }
  const onDisk = new Map<string, string>();
  if (members.length > 0) for (const n of await listNames(`${root}/${hubsDir}`, hubsDir, warn)) onDisk.set(n.toLowerCase(), n);
  const out: HubWrite[] = [];
  for (const key of [...byHub.keys()].sort(byCodePoint)) {
    const hub = byHub.get(key)!;
    hub.items.sort((a, b) => byCodePoint(a.name, b.name));
    const text = `# ${normalizeObservation(hub.heading)}\n\n${hub.items.map((i) => `- [[${i.path.replace(/\.md$/i, '')}]]\n`).join('')}`;
    const rel = `${hubsDir}/${onDisk.get(`${key}.md`) ?? `${key}.md`}`;
    const current = await readText(root, rel);
    if (!current.ok && !current.missing) out.push({ path: rel, text: null, refused: current.reason });
    else out.push({ path: rel, text: current.ok && current.text === text ? null : text });
  }
  return out;
}

/**
 * Build the `MEMORY.md` index. The section holds one bullet per hub, then the top entities by importance.
 * An existing `## Index` heading (outside fences, up to three spaces of indent, any case) is replaced up
 * to the next heading of level 1 or 2; every other line, the BOM and the line ends are kept.
 * @param root - Memory root.
 * @param memoryPath - On-disk spelling of `MEMORY.md`.
 * @param hubLinks - Hub targets without `.md`, in type order.
 * @param members - Exported entities.
 * @param topN - Number of top entities.
 * @param maxChars - Largest size of the section.
 * @returns The new text (null when nothing changes), or why the file is refused.
 */
async function indexFile(
  root: string,
  memoryPath: string,
  hubLinks: string[],
  members: Array<{ type: string; name: string; path: string; importance: number }>,
  topN: number,
  maxChars: number,
): Promise<{ text: string | null } | { refused: string }> {
  const read = await readText(root, memoryPath);
  if (!read.ok && !read.missing) return { refused: read.reason };
  const current = read.ok ? read.text : null;
  const top = [...members]
    .sort((a, b) => b.importance - a.importance || byCodePoint(a.name, b.name))
    .slice(0, topN);
  const bullets = [...hubLinks.map((h) => `- [[${h}]]`), ...top.map((m) => `- [[${m.path.replace(/\.md$/i, '')}]]`)];
  const body: string[] = [];
  let size = '## Index\n\n'.length + 1;
  for (const b of bullets) {
    if (size + b.length + 1 > maxChars) break;
    size += b.length + 1;
    body.push(b);
  }
  const sectionLines = body.length > 0 ? ['## Index', '', ...body, ''] : ['## Index'];
  const doc = parseAmrDocument(current ?? '# Memory\n');
  if (!doc.parseable) return { refused: 'unparseable' };
  const isIndex = (l: AmrLine) => (l.kind === 'heading' || l.kind === 'prose') && INDEX_HEADING.test(l.raw);
  const start = doc.lines.findIndex(isIndex);
  const lines = [...doc.lines];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !(lines[end].kind === 'heading' && HEADING.test(lines[end].raw))) end++;
    const lastEol = lines[end - 1].eolAfter;
    const repl: AmrLine[] = sectionLines.map((raw) => ({ kind: 'prose', raw, eolAfter: doc.eol }));
    if (end >= lines.length && lastEol === '' && body.length === 0) repl[repl.length - 1] = { ...repl[repl.length - 1], eolAfter: '' };
    lines.splice(start, end - start, ...repl);
  } else {
    const nonEmpty = lines.length > 0 && !(lines.length === 1 && lines[0].raw === '');
    if (lines.length > 0 && lines[lines.length - 1].raw === '' && lines[lines.length - 1].eolAfter === '') lines.pop();
    if (nonEmpty) {
      const last = lines[lines.length - 1];
      if (last.eolAfter === '') lines[lines.length - 1] = { ...last, eolAfter: doc.eol };
      if (lines[lines.length - 1].raw.trim() !== '') lines.push({ kind: 'blank', raw: '', eolAfter: doc.eol });
    }
    for (const raw of sectionLines) lines.push({ kind: 'prose', raw, eolAfter: doc.eol });
  }
  const next = renderAmrDocument({ ...doc, lines });
  return { text: next === current ? null : next };
}

/**
 * Read one Markdown file for import.
 * @param file - Repo-relative path.
 * @param text - File text.
 * @param namespace - Namespace prefix.
 * @param warnings - Receives the warnings of the file.
 * @returns The parsed file.
 */
function readNote(file: string, text: string, namespace: string | undefined, warnings: string[]): NoteFile {
  const doc = parseAmrDocument(text);
  const fmParse = doc.frontMatter !== undefined ? parseFrontMatter(doc.frontMatter) : { values: {} as FrontMatterValues, warnings: [] as string[] };
  for (const w of fmParse.warnings) warnings.push(`${file}: ${w}`);
  const fm = fmParse.values;
  const fmName = typeof fm.name === 'string' ? fm.name : undefined;
  const typeValue = typeof fm.type === 'string' && fm.type !== '' ? fm.type : 'note';
  const tags = typeof fm.tags === 'string' ? [fm.tags] : Array.isArray(fm.tags) ? fm.tags : undefined;
  const note: NoteFile = {
    file,
    name: nameFor(fmName, file, namespace),
    type: typeValue,
    tags,
    projectId: namespace,
    observations: [],
    inlineLinks: [],
    relationLinks: [],
    unparseable: !doc.parseable,
    tooLong: false,
  };
  const numberField = (key: 'importance' | 'ttl', min: number, max: number): number | undefined => {
    const raw = fm[key];
    if (raw === undefined) return undefined;
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < min || n > max) {
      warnings.push(`${file}: ${key} ignored, it is not a number in range`);
      return undefined;
    }
    return n;
  };
  note.importance = numberField('importance', 0, 10);
  note.ttl = numberField('ttl', 0, Number.MAX_SAFE_INTEGER);

  // Three regions: main (before the first Relations heading), relations, and after. Once the
  // relations section starts, nothing later is main again.
  let region: 'main' | 'relations' | 'after' = 'main';
  for (const line of doc.lines) {
    if (line.kind === 'heading') {
      if (RELATIONS_HEADING.test(line.raw)) {
        if (region === 'main') region = 'relations';
      } else if (HEADING.test(line.raw) && region === 'relations') {
        region = 'after';
      }
      continue;
    }
    if (line.kind !== 'bullet' || line.entry === undefined) continue;
    const entry = line.entry;
    if (region === 'relations') {
      const m = RELATION_BULLET.exec(entry.text);
      if (m !== null) note.relationLinks.push({ type: m[1], link: m[2].trim() });
      continue;
    }
    if (region === 'after') continue;
    const meta: Record<string, string[]> = {};
    let recordedAt: string | undefined;
    for (const key of Object.keys(entry.meta)) {
      if (key === 'added') {
        const stamp = entry.meta.added[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(stamp) && utcDate(`${stamp}T00:00:00Z`) !== undefined) recordedAt = `${stamp}T00:00:00.000Z`;
        else warnings.push(`${file}: added date ignored, it is not YYYY-MM-DD`);
      } else {
        meta[key] = entry.meta[key];
      }
    }
    const content = normalizeObservation(entry.text);
    if (content !== '') {
      if (content.length > MAX_OBSERVATION_CHARS) note.tooLong = true;
      note.observations.push({ content, recordedAt, meta });
    }
    // A loop, not a spread: a spread of a very long list overflows the call stack.
    for (const l of entry.links) note.inlineLinks.push(l);
  }
  return note;
}

/**
 * Give the message of a failed schema check, the same in a dry run and a real run.
 * @param what - `entity` or `relation`.
 * @param issues - Zod issues.
 * @returns The message.
 */
function invalidMessage(what: string, issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return `Invalid ${what} data: ${issues.map((i) => `${i.path.map(String).join('.') || what}: ${i.message}`).join('; ')}`;
}

/**
 * Import the memory repo into the graph. Each entity runs on its own. Relations are created in a second pass.
 * @param ctx - Manager context of the graph.
 * @param root - Memory root.
 * @param opts - Import options.
 * @returns The import report.
 */
export async function importAmr(ctx: ManagerContext, root: string, opts: AmrImportOptions = {}): Promise<AmrImportReport> {
  const mode: AmrSyncMode = opts.mode === 'reconcile' ? 'reconcile' : 'add-only';
  const dryRun = opts.dryRun ?? AMR_SYNC_DEFAULTS.dryRun;
  const now = opts.now ?? new Date();
  // Only reconcile needs the export rule; an add-only import does not depend on the pattern file.
  const patterns = mode === 'reconcile' ? loadSecretPatterns() : [];
  const warnings: string[] = [];
  // A graph name that is not NFC is matched by the NFC form of that name, so the import never makes a second entity.
  const storedName = new Map<string, string>();
  for (const e of await ctx.entityManager.listEntities()) {
    const nfc = e.name.normalize('NFC');
    if (nfc !== e.name && !storedName.has(nfc)) storedName.set(nfc, e.name);
  }
  const walked = await walkAmrMarkdown(root, {}, (p, reason) => warnings.push(`${p}: skipped (${reason})`));
  const files = walked.filter((f) => {
    const l = f.toLowerCase();
    return l !== 'memory.md' && !l.startsWith('_hubs/');
  });

  const results = new Map<string, AmrImportEntity>();
  const notes: NoteFile[] = [];
  const claimed = new Map<string, string>();
  // Every walked file names an entity, also a file with an error: a link to it is held, not dangling.
  const keyToName = new Map<string, string>();
  for (const file of files) {
    const key = file.replace(/\.md$/i, '');
    const read = await readText(root, file);
    if (!read.ok) {
      const name = nameFor(undefined, file, opts.namespace);
      keyToName.set(key, name);
      results.set(file, { name, file, action: 'error', error: read.reason });
      continue;
    }
    let note: NoteFile;
    try {
      note = readNote(file, read.text, opts.namespace, warnings);
    } catch (e) {
      const name = nameFor(undefined, file, opts.namespace);
      keyToName.set(key, name);
      results.set(file, { name, file, action: 'error', error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    note.name = storedName.get(note.name) ?? note.name;
    keyToName.set(key, note.name);
    if (note.unparseable) {
      results.set(file, { name: note.name, file, action: 'error', error: 'unparseable' });
    } else if (claimed.has(note.name)) {
      results.set(file, { name: note.name, file, action: 'error', error: 'duplicate name' });
    } else {
      claimed.set(note.name, file);
      notes.push(note);
    }
  }

  const danglingLinks: Array<{ file: string; link: string }> = [];
  const resolve = (note: NoteFile, raw: string): string | null => {
    const link = normLink(raw);
    const lower = link.toLowerCase();
    if (lower === 'memory' || lower === '_hubs' || lower.startsWith('_hubs/')) return null;
    const to = keyToName.get(link);
    if (to === undefined) {
      danglingLinks.push({ file: note.file, link: raw });
      return null;
    }
    return to;
  };
  const desired = new Map<string, Map<string, { type: string; to: string }>>();
  for (const n of notes) {
    const want = new Map<string, { type: string; to: string }>();
    const add = (type: string, to: string | null) => {
      if (to !== null) want.set(`${type}\u0000${to}`, { type, to });
    };
    for (const link of n.inlineLinks) add('links_to', resolve(n, link));
    for (const r of n.relationLinks) add(r.type, resolve(n, r.link));
    desired.set(n.name, want);
  }

  for (const n of notes) {
    if (n.tooLong) {
      results.set(n.file, { name: n.name, file: n.file, action: 'error', error: `observation longer than ${MAX_OBSERVATION_CHARS} characters` });
      continue;
    }
    try {
      const action = await syncEntity(ctx, n, mode, dryRun, now, patterns, warnings);
      results.set(n.file, { name: n.name, file: n.file, action });
    } catch (e) {
      results.set(n.file, { name: n.name, file: n.file, action: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // `present`: entities that this run creates or keeps. A relation is created only between them.
  // A relation to a file with an error stays: the file still holds it.
  const present = new Set(notes.filter((n) => results.get(n.file)?.action !== 'error').map((n) => n.name));
  let created = 0;
  let removed = 0;
  const toCreate: Relation[] = [];
  const toDelete: Relation[] = [];
  for (const n of notes) {
    if (!present.has(n.name)) continue;
    const pre = (await ctx.entityManager.getEntity(n.name)) !== null ? await ctx.relationManager.getRelations(n.name) : [];
    const mine = pre.filter((r) => r.from === n.name);
    const want = desired.get(n.name) ?? new Map<string, { type: string; to: string }>();
    for (const d of want.values()) {
      if (!present.has(d.to)) continue;
      if (mine.some((r) => r.relationType === d.type && r.to === d.to)) continue;
      const rel = { from: n.name, to: d.to, relationType: d.type, properties: { method: 'imported', source: `amr:${n.file}` } } as Relation;
      const check = CreateRelationSchema.safeParse({ from: rel.from, to: rel.to, relationType: rel.relationType });
      if (!check.success) {
        warnings.push(`${n.file}: relation ${d.type} to ${d.to} dropped (${invalidMessage('relation', check.error.issues)})`);
        continue;
      }
      created++;
      toCreate.push(rel);
    }
    if (mode === 'reconcile') {
      for (const r of mine) {
        if (r.properties?.source !== `amr:${n.file}`) continue;
        if (want.has(`${r.relationType}\u0000${r.to}`)) continue;
        removed++;
        toDelete.push(r);
      }
    }
  }
  if (!dryRun) {
    await inChunks(toCreate, (c) => ctx.relationManager.createRelations(c), 'created', warnings);
    await inChunks(toDelete, (c) => ctx.relationManager.deleteRelations(c), 'removed', warnings);
  }

  return {
    entities: files.map((f) => results.get(f)!).filter((e) => e !== undefined),
    relations: { created, removed },
    danglingLinks,
    warnings,
  };
}

/**
 * Run a relation call in chunks at the schema limit. A failed chunk is retried one relation at a
 * time; each relation that still fails gives a warning.
 * @param list - Relations.
 * @param call - Manager call for one chunk.
 * @param verb - `created` or `removed`, for the warning.
 * @param warnings - Receives the warnings.
 */
async function inChunks(list: Relation[], call: (chunk: Relation[]) => Promise<unknown>, verb: string, warnings: string[]): Promise<void> {
  for (let i = 0; i < list.length; i += RELATION_BATCH) {
    const chunk = list.slice(i, i + RELATION_BATCH);
    try {
      await call(chunk);
    } catch {
      for (const r of chunk) {
        try {
          await call([r]);
        } catch (e) {
          warnings.push(`relation ${r.relationType} from ${r.from} to ${r.to} not ${verb}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
}

/**
 * Build the graph metadata of file observations.
 * @param list - Observations of the file.
 * @returns One entry per observation that has a date or metadata.
 */
function fileMeta(list: NoteObservation[]): ObservationMeta[] {
  return list
    .filter((o) => o.recordedAt !== undefined || Object.keys(o.meta).length > 0)
    .map((o) => ({ content: o.content, ...(o.recordedAt !== undefined ? { recordedAt: o.recordedAt } : {}), ...(Object.keys(o.meta).length > 0 ? { meta: o.meta } : {}) }));
}

/**
 * Create or update one entity from its file. Writes only when `dryRun` is false. The schema checks
 * run in both modes, so both give the same result.
 * @param ctx - Manager context.
 * @param n - Parsed file.
 * @param mode - Add-only or reconcile.
 * @param dryRun - True writes nothing.
 * @param now - Clock for the export rule of reconcile.
 * @param patterns - Secret patterns for the export rule of reconcile.
 * @param warnings - Receives the warnings.
 * @returns The action.
 * @throws ValidationError when the entity data fails the schema.
 */
async function syncEntity(
  ctx: ManagerContext,
  n: NoteFile,
  mode: AmrSyncMode,
  dryRun: boolean,
  now: Date,
  patterns: readonly SecretPattern[],
  warnings: string[],
): Promise<'create' | 'update' | 'unchanged'> {
  const existing = await ctx.entityManager.getEntity(n.name);
  if (existing === null) {
    const entity: Entity = {
      name: n.name,
      entityType: n.type,
      observations: n.observations.map((o) => o.content),
      ...(fileMeta(n.observations).length > 0 ? { observationMeta: fileMeta(n.observations) } : {}),
      ...(n.tags !== undefined ? { tags: n.tags } : {}),
      ...(n.importance !== undefined ? { importance: n.importance } : {}),
      ...(n.ttl !== undefined ? { ttl: n.ttl } : {}),
      ...(n.projectId !== undefined ? { projectId: n.projectId } : {}),
    } as Entity;
    const check = CreateEntitySchema.safeParse(entity);
    if (!check.success) throw new ValidationError(invalidMessage('entity', check.error.issues), check.error.issues.map((i) => i.message));
    if (!dryRun) await ctx.entityManager.createEntities([entity]);
    return 'create';
  }

  if (mode === 'reconcile') {
    const metas = metaByContent(existing);
    const byNorm = new Map<string, ObservationMeta>();
    for (const m of existing.observationMeta ?? []) {
      const k = normalizeObservation(m.content);
      if (!byNorm.has(k)) byNorm.set(k, m);
    }
    const inFile = new Set(n.observations.map((o) => o.content));
    const observations = n.observations.map((o) => o.content);
    const observationMeta: ObservationMeta[] = [];
    for (const o of n.observations) {
      const base = byNorm.get(o.content);
      const m: ObservationMeta = { ...(base ?? {}), content: o.content };
      delete m.meta;
      // A stored recordedAt on the same UTC date stays, so a time of day is not lost.
      if (o.recordedAt !== undefined && !(base?.recordedAt !== undefined && utcDate(base.recordedAt) === utcDate(o.recordedAt))) m.recordedAt = o.recordedAt;
      if (Object.keys(o.meta).length > 0) m.meta = o.meta;
      if (Object.keys(m).length > 1) observationMeta.push(m);
    }
    // Keep what the export does not write (outside its window, secret-bearing, too long): the file
    // cannot hold it, so its absence from the file is not a removal.
    let removedObs = 0;
    for (const raw of existing.observations) {
      if (inFile.has(normalizeObservation(raw))) continue;
      const m = metas.get(raw);
      if (exportable(raw, m, now, patterns) === 'ok') {
        removedObs++;
        continue;
      }
      observations.push(raw);
      if (m !== undefined) observationMeta.push(m);
    }
    if (removedObs > 0) warnings.push(`${n.file}: reconcile removes ${removedObs} observation${removedObs === 1 ? '' : 's'}`);
    const sameFields =
      existing.entityType === n.type &&
      (n.tags === undefined || JSON.stringify(n.tags) === JSON.stringify(existing.tags ?? [])) &&
      (n.importance === undefined || n.importance === existing.importance) &&
      (n.ttl === undefined || n.ttl === (existing as Entity & { ttl?: number }).ttl) &&
      JSON.stringify(observations) === JSON.stringify(existing.observations) &&
      JSON.stringify(observationMeta) === JSON.stringify(existing.observationMeta ?? []);
    if (sameFields) return 'unchanged';
    const patch = {
      entityType: n.type,
      observations,
      ...(n.tags !== undefined ? { tags: n.tags } : {}),
      ...(n.importance !== undefined ? { importance: n.importance } : {}),
      ...(n.ttl !== undefined ? { ttl: n.ttl } : {}),
    };
    const check = UpdateEntitySchema.safeParse(patch);
    if (!check.success) throw new ValidationError(invalidMessage('entity', check.error.issues), check.error.issues.map((i) => i.message));
    if (!dryRun) await ctx.entityManager.updateEntity(n.name, { ...patch, observationMeta } as Partial<Entity>);
    return 'update';
  }

  const have = new Set(existing.observations.map(normalizeObservation));
  const missing: NoteObservation[] = [];
  for (const o of n.observations) {
    if (have.has(o.content)) continue;
    have.add(o.content);
    missing.push(o);
  }
  if (missing.length === 0) return 'unchanged';
  if (!dryRun) {
    await ctx.observationManager.addObservations([{ entityName: n.name, contents: missing.map((m) => m.content) }]);
    const added = fileMeta(missing);
    if (added.length > 0) {
      // Keep the metadata of the added observations, as the create path does.
      const fresh = await ctx.entityManager.getEntity(n.name);
      const contents = new Set(added.map((m) => m.content));
      const kept = (fresh?.observationMeta ?? []).filter((m) => !contents.has(m.content));
      await ctx.entityManager.updateEntity(n.name, { observationMeta: [...kept, ...added] } as Partial<Entity>);
    }
  }
  return 'update';
}
