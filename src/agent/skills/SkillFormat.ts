/**
 * SKILL.md front-matter codec for Recursa skills (spec RS-3).
 *
 * Two parse paths produce the same {@link ParsedSkillDocument}:
 *
 * - **Subset path (always available).** Front matter is a fixed set of keys.
 *   Each key is either `key: <JSON value>` on one line, or `key:` followed by
 *   `  - <JSON value>` list items. Values are read with `JSON.parse`. Any other
 *   YAML construct (comments, block scalars, anchors, nested mappings, unknown
 *   keys) is rejected with the first offending line.
 * - **Full-YAML path (optional).** When the `yaml` package is installed, the
 *   front matter is parsed with it and unknown harness keys (for example
 *   `allowed-tools`) are kept in `extra`. `yaml` is an optional peer
 *   dependency, loaded with a dynamic import, never required.
 *
 * Export always emits the subset, so a file written on one path reads on the other.
 *
 * Body escaping: a body line that matches `^\\*---$` gains one leading backslash
 * on write and loses one on parse, so the body round-trips byte for byte.
 *
 * @module agent/skills/SkillFormat
 * @experimental Part of the Recursa skill format (spec RS-3). The subset grammar may grow.
 */

import { createHash } from 'crypto';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import type { SkillKind, SkillRecord, SkillResource, SkillSource } from '../../types/skills.js';

/** Keys the subset grammar accepts in front matter, in write order. */
export const SKILL_FRONT_MATTER_KEYS = [
  'name',
  'description',
  'kind',
  'scope.domains',
  'scope.tasks',
  'scope.tools',
  'uncertainty',
  'sources',
  'resources',
  'lineage',
] as const;

const SKILL_KINDS: readonly SkillKind[] = ['navigation', 'procedure', 'judgment', 'convention', 'tool'];
const MAX_NAME_LENGTH = 80;

/** Fields a SKILL.md file carries. Identifiers, stats and timestamps stay on the entity. */
export interface ParsedSkillDocument {
  /** Agent Skills `name`. */
  name: string;
  /** When to apply the skill. */
  description: string;
  /** Kind of knowledge. */
  kind: SkillKind;
  /** Applicable scope. */
  scope: { domains: string[]; tasks?: string[]; tools?: string[] };
  /** Self-assessed uncertainty in [0, 1]. */
  uncertainty: number;
  /** Provenance links. */
  sources: SkillSource[];
  /** Bundled resources. */
  resources: SkillResource[];
  /** Lineage links (only the fields a file may carry). */
  lineage: SkillRecord['lineage'];
  /** Markdown body after the closing `---`. */
  body: string;
  /** Unknown front-matter keys, kept only on the full-YAML path. */
  extra?: Record<string, unknown>;
}

/** Failed parse: the first construct the parser cannot accept. */
export interface SkillParseFailure {
  ok: false;
  /** 1-based line number in the source text. */
  line: number;
  /** Plain-language reason naming the unsupported construct. */
  reason: string;
}

/** Result of {@link parseSkillMarkdown}. */
export type SkillParseResult = { ok: true; value: ParsedSkillDocument } | SkillParseFailure;

/** Minimal surface of the optional `yaml` package this module uses. */
export interface YamlModuleLike {
  /** Parse a YAML document into plain values. */
  parse(text: string): unknown;
}

/** Options for {@link parseSkillMarkdown}. */
export interface ParseSkillOptions {
  /** Full-YAML parser. Omit to use the subset grammar. */
  yaml?: YamlModuleLike;
}

/**
 * Load the optional `yaml` package. Resolves to `undefined` when it is not installed.
 * The specifier is a variable so bundlers do not try to resolve it at build time.
 *
 * @returns The `yaml` module, or `undefined` when absent.
 */
export async function loadOptionalYaml(): Promise<YamlModuleLike | undefined> {
  const specifier = 'yaml';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Partial<YamlModuleLike> & {
      default?: Partial<YamlModuleLike>;
    };
    const parse = mod.parse ?? mod.default?.parse;
    return typeof parse === 'function' ? { parse: parse.bind(mod.parse ? mod : mod.default) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serialize a skill to SKILL.md text using the subset grammar.
 * Empty optional lists and absent lineage are omitted. `extra` is not written.
 *
 * @param skill - Skill fields to write (identifiers and stats are ignored).
 * @returns Complete file text ending in a newline.
 */
export function serializeSkillMarkdown(
  skill: Pick<SkillRecord, 'name' | 'description' | 'kind' | 'scope' | 'uncertainty' | 'sources' | 'resources' | 'lineage' | 'body'>,
): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${jsonLine(skill.name)}`);
  lines.push(`description: ${jsonLine(skill.description)}`);
  lines.push(`kind: ${jsonLine(skill.kind)}`);
  writeList(lines, 'scope.domains', skill.scope.domains);
  if (skill.scope.tasks !== undefined) writeList(lines, 'scope.tasks', skill.scope.tasks);
  if (skill.scope.tools !== undefined) writeList(lines, 'scope.tools', skill.scope.tools);
  lines.push(`uncertainty: ${jsonLine(skill.uncertainty)}`);
  writeList(lines, 'sources', skill.sources);
  writeList(lines, 'resources', skill.resources);
  if (Object.keys(skill.lineage).length > 0) lines.push(`lineage: ${jsonLine(skill.lineage)}`);
  lines.push('---');
  const body = skill.body.endsWith('\n') ? skill.body : `${skill.body}\n`;
  const escaped = body
    .split('\n')
    .map((line) => (/^\\*---$/.test(line) ? `\\${line}` : line))
    .join('\n');
  return `${lines.join('\n')}\n${escaped}`;
}

/**
 * Parse SKILL.md text. Returns `{ ok: false, line, reason }` for the first
 * construct the active grammar cannot accept; never throws on bad input.
 *
 * @param text - Complete file text.
 * @param options - Pass `yaml` to use the full-YAML path for front matter.
 * @returns The parsed document or the first failure.
 */
export function parseSkillMarkdown(text: string, options: ParseSkillOptions = {}): SkillParseResult {
  const normalized = text.replace(/\r\n/g, '\n');
  const all = normalized.split('\n');
  if (all[0] !== '---') return fail(1, 'file must start with a "---" front-matter line');
  const close = all.indexOf('---', 1);
  if (close === -1) return fail(1, 'front matter is not closed by a "---" line');
  const fmLines = all.slice(1, close);
  const bodyLines = all.slice(close + 1);
  const body = unescapeBody(bodyLines.join('\n'));

  const parsed = options.yaml
    ? readWithYaml(fmLines, options.yaml)
    : readSubset(fmLines);
  if (!parsed.ok) return parsed;
  const fields = parsed.fields;
  return validate(fields, body, parsed.extra);
}

/**
 * Stable SHA-256 of a skill's serialized file text. Used as the publish and
 * import baseline.
 *
 * @param text - Serialized SKILL.md text.
 * @returns Lowercase hex digest.
 */
export function skillContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ==================== Internal ====================

interface RawFields {
  [key: string]: unknown;
}

type ReadResult =
  | { ok: true; fields: RawFields; extra?: Record<string, unknown> }
  | SkillParseFailure;

function fail(line: number, reason: string): SkillParseFailure {
  return { ok: false, line, reason };
}

function writeList(lines: string[], key: string, items: readonly unknown[]): void {
  if (items.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  for (const item of items) lines.push(`  - ${jsonLine(item)}`);
}

function unescapeBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\\+---$/.test(line) ? line.slice(1) : line))
    .join('\n');
}

// `[\s\S]` (not `.`): a JSON value may hold U+2028 / U+2029, which `.` rejects.
const KEY_LINE = /^([a-z][a-z.-]*):(?: ([\s\S]*))?$/;

/** `JSON.stringify` with U+2028 / U+2029 escaped, so a value never spans lines in any reader. */
function jsonLine(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function readSubset(fmLines: string[]): ReadResult {
  const fields: RawFields = {};
  const known = new Set<string>(SKILL_FRONT_MATTER_KEYS);
  let i = 0;
  while (i < fmLines.length) {
    const raw = fmLines[i]!;
    const lineNo = i + 2;
    i++;
    if (raw.trim() === '') continue;
    if (/^\s*#/.test(raw)) return fail(lineNo, 'comments are not supported in front matter (subset grammar)');
    if (/^\s/.test(raw)) {
      return fail(lineNo, 'indented or nested YAML is not supported in front matter (subset grammar)');
    }
    const match = KEY_LINE.exec(raw);
    if (!match) return fail(lineNo, `unsupported front-matter line: ${raw.trim()}`);
    const key = match[1]!;
    const value = match[2];
    if (!known.has(key)) {
      return fail(lineNo, `unknown front-matter key "${key}" (subset grammar accepts only: ${[...known].join(', ')})`);
    }
    if (fields[key] !== undefined) return fail(lineNo, `duplicate front-matter key "${key}"`);
    if (value !== undefined) {
      const decoded = decodeScalar(key, value, lineNo);
      if (!decoded.ok) return decoded;
      fields[key] = decoded.value;
      continue;
    }
    const items: unknown[] = [];
    while (i < fmLines.length && /^ {2}- /.test(fmLines[i]!)) {
      const itemLine = i + 2;
      const decoded = decodeScalar(key, fmLines[i]!.slice(4), itemLine);
      i++;
      if (!decoded.ok) return decoded;
      items.push(decoded.value);
    }
    if (items.length === 0) {
      if (i < fmLines.length && /^\s/.test(fmLines[i]!) && !/^ {2}- /.test(fmLines[i]!)) {
        return fail(i + 2, 'indented or nested YAML is not supported in front matter (subset grammar)');
      }
      return fail(lineNo, `"${key}:" has no list items; write an empty list as "${key}: []"`);
    }
    fields[key] = items;
  }
  return { ok: true, fields };
}

function decodeScalar(key: string, text: string, line: number): { ok: true; value: unknown } | SkillParseFailure {
  if (/^[|>&*!]/.test(text.trim())) {
    return fail(line, `unsupported YAML construct in "${key}" (block scalar, anchor, alias or tag)`);
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return fail(line, `unsupported value for "${key}": ${text.trim()} (only JSON values are accepted without the optional "yaml" package)`);
  }
}

function readWithYaml(fmLines: string[], yaml: YamlModuleLike): ReadResult {
  let doc: unknown;
  try {
    doc = yaml.parse(fmLines.join('\n'));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return fail(2, `front matter is not valid YAML: ${cause}`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return fail(2, 'front matter must be a YAML mapping');
  }
  const fields: RawFields = {};
  const extra: Record<string, unknown> = {};
  const known = new Set<string>(SKILL_FRONT_MATTER_KEYS);
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (key === 'scope' && value && typeof value === 'object') {
      const scope = value as Record<string, unknown>;
      for (const sub of ['domains', 'tasks', 'tools']) {
        if (scope[sub] !== undefined) fields[`scope.${sub}`] = scope[sub];
      }
      continue;
    }
    if (known.has(key)) fields[key] = value;
    else extra[key] = value;
  }
  return { ok: true, fields, extra: Object.keys(extra).length > 0 ? extra : undefined };
}

function validate(fields: RawFields, body: string, extra: Record<string, unknown> | undefined): SkillParseResult {
  const name = fields['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    return fail(2, `"name" must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`);
  }
  const description = fields['description'];
  if (typeof description !== 'string') return fail(2, '"description" must be a string');
  const kind = fields['kind'];
  if (typeof kind !== 'string' || !SKILL_KINDS.includes(kind as SkillKind)) {
    return fail(2, `"kind" must be one of: ${SKILL_KINDS.join(', ')}`);
  }
  const uncertainty = fields['uncertainty'];
  if (typeof uncertainty !== 'number' || !(uncertainty >= 0 && uncertainty <= 1)) {
    return fail(2, '"uncertainty" must be a number in [0, 1]');
  }
  const domains = fields['scope.domains'];
  if (!isStringArray(domains)) return fail(2, '"scope.domains" must be a list of strings');
  const scope: ParsedSkillDocument['scope'] = { domains };
  for (const sub of ['tasks', 'tools'] as const) {
    const v = fields[`scope.${sub}`];
    if (v === undefined) continue;
    if (!isStringArray(v)) return fail(2, `"scope.${sub}" must be a list of strings`);
    scope[sub] = v;
  }
  const sources = (fields['sources'] ?? []) as unknown;
  if (!Array.isArray(sources) || !sources.every(isSource)) {
    return fail(2, '"sources" must be a list of {ref, kind, excerpt?} objects');
  }
  const resources = (fields['resources'] ?? []) as unknown;
  if (!Array.isArray(resources) || !resources.every(isResource)) {
    return fail(2, '"resources" must be a list of {name, ref, kind} objects');
  }
  const lineage = (fields['lineage'] ?? {}) as unknown;
  if (lineage === null || typeof lineage !== 'object' || Array.isArray(lineage)) {
    return fail(2, '"lineage" must be an object');
  }
  return {
    ok: true,
    value: {
      name,
      description,
      kind: kind as SkillKind,
      scope,
      uncertainty,
      sources: sources as SkillSource[],
      resources: resources as SkillResource[],
      lineage: lineage as SkillRecord['lineage'],
      body,
      ...(extra ? { extra } : {}),
    },
  };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isSource(v: unknown): v is SkillSource {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s['ref'] === 'string' && ['document', 'entity', 'url', 'trace'].includes(s['kind'] as string);
}

function isResource(v: unknown): v is SkillResource {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['name'] === 'string' && typeof r['ref'] === 'string'
    && ['script', 'reference', 'template'].includes(r['kind'] as string);
}

/**
 * Render one skill as a `###` heading and a fenced Markdown block.
 *
 * @param skill - Skill whose name, uncertainty and sources form the heading.
 * @param body - Body text to place in the fence.
 * @returns Section text ending in a newline.
 */
export function renderSkillSection(skill: SkillRecord, body: string): string {
  const refs = skill.sources.map((s) => s.ref);
  const header = `### ${skill.name} (uncertainty ${skill.uncertainty}, sources: ${refs.length > 0 ? refs.join(', ') : 'none'})`;
  const fence = fenceFor(body);
  return `${header}\n\n${fence}markdown\n${body.replace(/\n+$/, '')}\n${fence}\n`;
}

/** A fence longer than any backtick run in `body`, so the body cannot close it. */
function fenceFor(body: string): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Largest word prefix of the body whose section fits `remaining`.
 *
 * @param skill - Skill to render.
 * @param remaining - Token budget left.
 * @param multiplier - Tokens per word.
 * @returns The cut section, or `undefined` when even an empty body does not fit.
 */
export function fitSkillSectionToBudget(
  skill: SkillRecord,
  remaining: number,
  multiplier: number,
): string | undefined {
  const words = skill.body.split(/\s+/).filter((w) => w !== '');
  let lo = 0;
  let hi = words.length - 1;
  let best: string | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = renderSkillSection(skill, `${words.slice(0, mid).join(' ')} […truncated]`);
    if (estimateTokensFromText(candidate, multiplier) <= remaining) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
