/**
 * Tests for AMR phase 4: the front matter parser, the batch writer, one-way export and one-way import.
 *
 * Contract (the implementation must follow it exactly):
 *
 * Module `src/features/amr/AmrFrontMatter.ts` (`@experimental`, pure, no YAML dependency).
 * - `parseFrontMatter(raw)` reads the raw front matter string of `AmrDocument.frontMatter` (the lines
 *   between the `---` fences, without them). It returns `{ values: Record<string, string | string[]>,
 *   warnings: string[] }`. A line `key: value` gives a scalar; `key: [a, b, "c, d"]` gives a list.
 *   A value in double quotes decodes `\"` and `\\`; a value in single quotes is taken as is. Blank lines
 *   and `#` comment lines are skipped. A key matches `^[A-Za-z][\w-]*$` and is not an `Object.prototype`
 *   name. Any other line (nesting, block lists, anchors, a bad key) gives one warning with its line number
 *   and is skipped. A repeated key: the last wins, with a warning.
 * - `renderFrontMatter(values)` writes keys in insertion order, one per line. A value is written in double
 *   quotes (with `\` and `"` escaped) when it holds `:`, `#`, `,`, `[`, `]`, `"`, `'`, `\`, or edge
 *   whitespace, or is empty. A value with a line separator or a C0/C1 control character THROWS
 *   `ValidationError` (callers drop it with a warning). `parseFrontMatter(renderFrontMatter(v)).values`
 *   deep-equals `v` for every map of strings and string arrays without such characters.
 *
 * Batch writer (`src/features/amr/AmrWriter.ts`):
 * - `writeAmrFiles(root, files: { path, text }[], { runner, message, patterns? })` has the same guards as
 *   `writeAmrFile` (path rules, secret scan, clean tree, runner root, confinement before and after the
 *   rename, per-root mutex) and makes ONE commit for all files with `commitFiles(paths, message)`. Any
 *   refusal before the first rename writes nothing and returns `{ ok: false, reason, path }`; a refusal of
 *   the repository (root, clean tree, git) has no `path`, and a duplicate path names the duplicate. A failure
 *   after a rename restores every file this call touched (one shared apply and restore path; `writeAmrFile`
 *   is a batch of one) and unstages them with one `unstage` call. Before each restore write or unlink the
 *   target folder must still have its recorded real path; otherwise nothing is written for that file, the
 *   result is `outside-root` and `left` lists those paths. An empty list is `{ ok: true, committed: false }`.
 * - `checkFileText(path, text, message, patterns)` (no I/O) and `checkAmrWritePath(root, path)` (read-only)
 *   are the writer checks; the export runs both on every file that it would write.
 *
 * Module `src/features/amr/AmrSync.ts` (`@experimental`).
 * - `AMR_SYNC_DEFAULTS = { types: null, indexTopN: 20, indexMaxChars: 4000, mode: 'add-only', dryRun: true }`.
 *   Options merge over it; a number that is not a finite integer above 0 gives the default.
 * - `normalizeObservation(s)`: collapse each whitespace run (including line separators) to one space, then
 *   trim. Export and import both match a graph observation to a bullet by `normalizeObservation` of the
 *   observation and of the DECODED bullet text (`AmrEntry.text`).
 * - Name of a file: front matter `name`, else the path without `.md` (NFC-normalized); with
 *   `opts.namespace`, `<namespace>/<that>`. Import and export use this same rule. The export key of a
 *   graph entity is the name that this rule gives for its file: the NFC name, with `<namespace>/` put in
 *   front when it is missing (a warning). The front matter `name` is that key without the namespace. A name
 *   that front matter cannot hold (a line or control character) is keyed by the name that its slug path
 *   gives, with a warning, so the next run finds the file again. A repeated key in `list`: the first wins.
 * - `amrPathForEntity(entity, namespace?)` gives the base path of an entity that has no file: strip a
 *   `<namespace>/` prefix first. When the name is ASCII, passes the reader `checkAmrLink` rules, has no
 *   uppercase letter, no `.md`, is not `memory` and does not start with `_hubs/`, and no segment is a Windows
 *   reserved name (`con`, `prn`, `aux`, `nul`, `com0`..`com9`, `lpt0`..`lpt9`, `node_modules`) and no segment
 *   is longer than 100 characters, the path is `<name>.md`. Else it is `<slug(entityType)>/<slug(name)>.md`;
 *   `slug` lowercases, maps each run outside `[a-z0-9_-]` to one `-`, trims `-`, cuts to 100 characters, and
 *   gives `entity` when empty or a reserved name (then `<reserved>-entity`). A type slug `_hubs` is `_hubs-entity`.
 * - Export path choice (`exportAmr`): first index every existing `.md` file (except `MEMORY.md` and `_hubs/`,
 *   in any case) by its name. Every read goes through the confined reader; a file that cannot be read (for
 *   example `EBUSY`) keeps its path-derived name and is `refused` with that reason, never treated as missing. An entity whose name has a file uses that file. Otherwise it gets `amrPathForEntity`; when
 *   that path is taken (case-insensitive) by an existing file or by an earlier entity in name order,
 *   append `-2`, `-3`, ... before `.md`. A file whose name belongs to another entity is never an edit target.
 * - Entity file layout for a NEW file: front matter (`name` only when the path does not give back the name,
 *   then `type`, `tags` (list), `importance`, `ttl`, in that order, each only when set; a value that cannot
 *   be rendered is dropped with a warning), a blank line, `# <name>`, a blank line, one bullet per
 *   observation `- <text> [added: YYYY-MM-DD; <meta keys>]`, then, when the entity has outgoing relations
 *   that no bullet holds inline, a blank line, `## Relations`, a blank line, and one bullet per relation
 *   `- <relationType> [[<target path without .md>]]`. "Held inline": a bullet contains `[[<target path
 *   without .md>]]`. `added` is the UTC date of `observationMeta.recordedAt`, else of `entity.createdAt`,
 *   else omitted. A meta key or value that `formatEntryText` refuses is dropped with a warning. A multi-line
 *   observation is written as `normalizeObservation` of it, with a warning. The document EOL and BOM are kept.
 * - EXISTING file: parsed with `parseAmrDocument`; not parseable gives `refused` (reason `unparseable`).
 *   The "main section" is everything before the first `## Relations` heading; `## Relations` runs to the next
 *   heading of level 2 or above. A matched bullet whose metadata differs (compared without key order) is
 *   rewritten (all rewrites in one `setEntries` pass) only when a graph metadata key is missing from the
 *   bullet or has another value, or the `added` date differs; keys that only the file holds stay. An
 *   unmatched observation goes after the last top-level bullet and its block (continuations, nested bullets,
 *   an indented fence, and blank lines that an indented line follows), or at the end of the main section.
 *   A new relation is appended at the end of `## Relations` (any case), which is created at the end when
 *   missing; a relation bullet counts as present by its parsed type and link (any marker). No bullet is
 *   removed; each file reports `stale` = the count of main-section bullets that match no observation.
 *   Front matter of an existing file is not changed. `changedLines` counts the lines that differ.
 * - Skip rules, checked in this order, each entity counted once: `type` (`opts.types` set and not listed),
 *   `notLatest` (`isLatest === false`), `archived` (`lifecycleStatus === 'archived'`), `private`
 *   (`visibility === 'private'`; an absent visibility is NOT skipped, because a plain graph entity is not an
 *   agent memory). Per observation: `invalidObservations` (`validUntil` before `opts.now`, or `validFrom`
 *   after it; `now` defaults to `new Date()`), `secret` (`scanForSecrets` hits the text; the observation is
 *   dropped with a warning and the rest of the entity is exported). An observation that is empty after
 *   normalising or longer than 5000 characters is not written either.
 * - Relations: a relation to an entity that a skip rule leaves out is not written (a warning). A relation type
 *   with whitespace, `[`, `]`, a backslash or a control character, or longer than 100 characters, and a target
 *   path with `[`, `]`, `|`, `#` or a line break, is dropped with a warning.
 * - Report: `{ files: { path, action: 'create' | 'update' | 'unchanged' | 'refused', changedLines, stale,
 *   reason? }[], skipped: { type, notLatest, archived, private, invalidObservations, secret }, warnings }`.
 *   Every refusal is decided by `exportAmr` itself before any write: `checkFileText` and `checkAmrWritePath`
 *   run on every entity, hub and index file in both modes, so `dryRun: true` (the default, writes nothing)
 *   and `dryRun: false` return deep-equal reports for the same input. A refused entity file is left out of
 *   the hubs and the index; a refused hub or index file is a `refused` entry with a warning. A dry run with
 *   `opts.runner` puts a failed `checkClean` in `writeError`, as the real run does.
 * - `MEMORY.md` (created when missing as `# Memory\n`) gets one `## Index` section, replaced in place when
 *   present (found with `parseAmrDocument`, so fences and the BOM are respected; up to three spaces of indent
 *   and any case; it ends at the next heading of level 2 or above; the rest of the file is kept byte for
 *   byte and the new lines use the file EOL), else appended. `memory.md` and `_hubs/` in another case are
 *   written in their on-disk spelling. It lists one bullet per type hub `- [[_hubs/<slug(type)>]]` in type order, then the top
 *   `indexTopN` entities by importance (ties by name) as `- [[<path without .md>]]`, stopping before the
 *   section passes `indexMaxChars`. Hub `_hubs/<slug(type)>.md` lists every exported entity of the type in
 *   name order; it is generated, so `list` must hold every entity of each exported type. Only files that are
 *   not refused are listed.
 * - `dryRun: false` needs `opts.runner` (else `ValidationError`) and writes every changed file with ONE
 *   `writeAmrFiles` call, message `export <n> files`. A writer failure returns the report with `writeError`.
 *   Delete no file.
 * - `importAmr(ctx, root, opts)` resolves `{ entities: { name, file, action: 'create' | 'update' |
 *   'unchanged' | 'error', error? }[], relations: { created, removed }, danglingLinks: { file, link }[],
 *   warnings }`.
 *   - It walks every `.md` file below root (no file-count budget; the reader path rules and `ignore` apply)
 *     except `MEMORY.md` and `_hubs/`. Type: front matter `type`, else `note`. `tags`, `importance` (number
 *     0..10, else a warning), `ttl` (number, else a warning) come from front matter; `projectId` is the
 *     namespace when set. Two files with one name: the second is an `error` entry. A file that cannot be read
 *     or parsed is an `error` entry and the run goes on. Each file that the walk skips is a warning.
 *     A file name that matches a graph entity name only after NFC normalisation uses the stored graph name.
 *     Only `reconcile` loads the secret patterns (for the export rule).
 *   - Observations: top-level and nested bullets of the main section in document order (fences skipped),
 *     never `## Relations` bullets. `added` gives `recordedAt` (an existing `recordedAt` with the same UTC
 *     date is kept); every other key goes into `meta`. An observation above 5000 characters is an `error`
 *     entry (checked by the importer itself).
 *   - `add-only` (default): create a missing entity; else add only observations that no existing
 *     observation matches by `normalizeObservation` (a text repeated in the file is added once), with their
 *     `recordedAt` and `meta`. `reconcile`: the file wins; observations, `observationMeta` and the front matter
 *     fields are replaced, but an observation that the export would not write (outside its validity window at
 *     `opts.now`, secret-bearing, too long) stays, and graph-only metadata (`validFrom`, `validUntil`) of a
 *     matched observation stays. A removal count is a warning. The schema checks of the entity managers run
 *     in both modes, with the same error.
 *   - Each entity runs in its own try/catch through `ctx.entityManager` / `ctx.observationManager`; one
 *     failure is one `error` entry. `mergeImportedGraph` is not used.
 *   - Relations, in a SECOND pass after all entities: an inline `[[link]]` in a main-section bullet gives
 *     `links_to`; a `## Relations` bullet `- <type> [[link]]` gives `<type>`. Both carry `properties:
 *     { method: 'imported', source: 'amr:<file>' }`. `to` is the NAME of the target file (front matter and
 *     namespace applied). A link to `MEMORY` or `_hubs/...` is ignored. A link with no target file is a
 *     `danglingLinks` entry; `.md`, an alias and an anchor are cut first. A relation that the schema refuses is
 *     dropped with a warning in both modes; the calls run in chunks of 1000. `reconcile` removes only relations
 *     from this entity with `properties.source === 'amr:<file>'` that the file no longer holds; a link to a
 *     file with an error is still held.
 *   - `dryRun: true` (the default) changes nothing and returns the same report as the real run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, existsSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontMatter, renderFrontMatter } from '../../../../src/features/amr/AmrFrontMatter.js';
import { parseEntryText } from '../../../../src/features/amr/AmrCodec.js';
import { AMR_SYNC_DEFAULTS, amrPathForEntity, exportAmr, importAmr, normalizeObservation } from '../../../../src/features/amr/AmrSync.js';
import { writeAmrFiles } from '../../../../src/features/amr/AmrWriter.js';
import { GitRunner } from '../../../../src/features/amr/GitRunner.js';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { ValidationError } from '../../../../src/utils/errors.js';
import type { Entity, Relation } from '../../../../src/types/types.js';

let dirs: string[] = [];
let ctxs: ManagerContext[] = [];
function tmp(prefix: string): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}
function newCtx(): ManagerContext {
  const c = new ManagerContext(join(tmp('amr-g-'), 'memory.jsonl'));
  ctxs.push(c);
  return c;
}
function put(root: string, rel: string, text: string): void {
  const p = join(root, ...rel.split('/'));
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
}
const read = (root: string, rel: string) => readFileSync(join(root, ...rel.split('/')), 'utf8');
const ent = (e: Partial<Entity> & { name: string }): Entity => ({ entityType: 'note', observations: [], ...e }) as Entity;
const NOW = new Date('2026-11-11T12:00:00Z');
const fakeAws = () => 'AKIA' + 'Q'.repeat(16);

/** A real git repo over `root` with an isolated identity; commits whatever is already there. */
function repo(root: string): GitRunner {
  const cfg = join(tmp('amr-cfg-'), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.invalid\n');
  const env = { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const host: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) host[k] = v;
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, env: { ...host, ...env }, encoding: 'utf8' });
  g('init', '-q');
  g('add', '-A', '--', '.');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return new GitRunner(root, { env });
}
function memRepo(files: Record<string, string> = {}): { root: string; runner: GitRunner } {
  const root = tmp('amr-r-');
  put(root, 'MEMORY.md', '# Memory\n');
  for (const [k, v] of Object.entries(files)) put(root, k, v);
  return { root, runner: repo(root) };
}
const fileOf = (rep: { files: { path: string }[] }, p: string) => rep.files.find((f) => f.path === p);

beforeEach(() => {
  dirs = [];
  ctxs = [];
});
afterEach(async () => {
  for (const c of ctxs) await (c as unknown as { close?: () => unknown }).close?.();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('parseFrontMatter / renderFrontMatter', () => {
  it('reads scalars, flow lists, quotes and comments', () => {
    const r = parseFrontMatter('# c\ntype: person\ntags: [a, b, "c, d"]\nname: "A: B"\nq: \'x # y\'\n\n');
    expect(r.values).toEqual({ type: 'person', tags: ['a', 'b', 'c, d'], name: 'A: B', q: 'x # y' });
    expect(r.warnings).toEqual([]);
  });

  it('warns and skips unsupported lines, a bad key and a prototype key', () => {
    const r = parseFrontMatter('a: 1\nb:\n  - x\n__proto__: 2\n9x: 3\n');
    expect(r.values).toEqual({ a: '1', b: '' });
    expect(r.warnings.length).toBe(3);
  });

  it('keeps the last of a repeated key, with a warning', () => {
    const r = parseFrontMatter('a: 1\na: 2\n');
    expect(r.values).toEqual({ a: '2' });
    expect(r.warnings.length).toBe(1);
  });

  it.each([
    [{ type: 'person' }],
    [{ name: 'A: B', tags: ['x', 'y,z', '[w]'], empty: '' }],
    [{ s: ' edge ', h: 'a # b', q: 'say "hi"', b: 'back\\slash', e: 'ends\\' }],
  ])('round-trips %j', (v) => {
    expect(parseFrontMatter(renderFrontMatter(v)).values).toEqual(v);
  });

  it('refuses a value with a line separator', () => {
    expect(() => renderFrontMatter({ a: 'x\ny' })).toThrow(ValidationError);
  });
});

describe('normalizeObservation and amrPathForEntity', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeObservation('  a \n\t b  ')).toBe('a b');
  });

  it.each([
    [{ name: 'alice', entityType: 'person' }, undefined, 'alice.md'],
    [{ name: 'people/alice', entityType: 'person' }, undefined, 'people/alice.md'],
    [{ name: 'Alice Smith', entityType: 'person' }, undefined, 'person/alice-smith.md'],
    [{ name: '???', entityType: 'Some Type' }, undefined, 'some-type/entity.md'],
    [{ name: '../x', entityType: 'note' }, undefined, 'note/x.md'],
    [{ name: 'memory', entityType: 'note' }, undefined, 'note/memory.md'],
    [{ name: 'con', entityType: 'note' }, undefined, 'note/con-entity.md'],
    [{ name: '_hubs/x', entityType: 'note' }, undefined, 'note/_hubs-x.md'],
    [{ name: 'café', entityType: 'note' }, undefined, 'note/caf.md'],
    [{ name: 'proj/alice', entityType: 'note' }, 'proj', 'alice.md'],
  ])('%j (namespace %s) gives %s', (e, ns, p) => {
    expect(amrPathForEntity(ent(e), ns)).toBe(p);
  });
});

describe('writeAmrFiles', () => {
  it('writes several files in one commit', async () => {
    const { root, runner } = memRepo();
    const res = await writeAmrFiles(root, [{ path: 'a.md', text: '- a\n' }, { path: 'b/c.md', text: '- c\n' }], { runner, message: 'two' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(read(root, 'b/c.md')).toBe('- c\n');
  });

  it('writes nothing when one file is refused', async () => {
    const { root, runner } = memRepo();
    const res = await writeAmrFiles(root, [{ path: 'a.md', text: '- a\n' }, { path: 'b.md', text: `- ${fakeAws()}\n` }], { runner, message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'secret', path: 'b.md' });
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });
});

describe('exportAmr', () => {
  it('has one place for defaults', () => {
    expect(AMR_SYNC_DEFAULTS).toEqual({ types: null, indexTopN: 20, indexMaxChars: 4000, mode: 'add-only', dryRun: true });
  });

  it('writes a new entity file with front matter, bullets and relations', async () => {
    const { root, runner } = memRepo();
    const e = ent({
      name: 'Alice Smith', entityType: 'person', tags: ['team'], importance: 7, createdAt: '2026-01-02T03:04:05Z',
      observations: ['Likes tea'],
      observationMeta: [{ content: 'Likes tea', recordedAt: '2026-03-04T10:00:00Z', meta: { source: ['chat'] } }],
    });
    const rel = { from: 'Alice Smith', to: 'bob', relationType: 'knows' } as Relation;
    const rep = await exportAmr([e, ent({ name: 'bob' })], [rel], root, { dryRun: false, runner, now: NOW });
    expect(fileOf(rep, 'person/alice-smith.md')).toMatchObject({ action: 'create' });
    expect(read(root, 'person/alice-smith.md')).toBe(
      '---\nname: Alice Smith\ntype: person\ntags: [team]\nimportance: 7\n---\n\n# Alice Smith\n\n' +
        '- Likes tea [added: 2026-03-04; source: chat]\n\n## Relations\n\n- knows [[bob]]\n',
    );
  });

  it('writes no Relations section for a relation held inline', async () => {
    const { root, runner } = memRepo();
    const e = ent({ name: 'alice', observations: ['met [[bob]]'] });
    await exportAmr([e, ent({ name: 'bob' })], [{ from: 'alice', to: 'bob', relationType: 'links_to' } as Relation], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'alice.md')).not.toContain('## Relations');
  });

  it('rewrites a changed bullet in place and appends a new one: exactly two lines change', async () => {
    const before =
      '# alice\n\nSome prose that stays.\n\n```\n- not a bullet\n```\n\n' +
      '- Likes tea [added: 2026-03-04]\n- Lives in Oslo [added: 2026-03-04]\n\n## Relations\n\n- knows [[bob]]\n';
    const { root, runner } = memRepo({ 'alice.md': before, 'bob.md': '- b\n' });
    const e = ent({
      name: 'alice', observations: ['Likes tea', 'Lives in Oslo', 'Plays chess'],
      observationMeta: [
        { content: 'Likes tea', recordedAt: '2026-03-04T00:00:00Z', meta: { source: ['chat'] } },
        { content: 'Lives in Oslo', recordedAt: '2026-03-04T00:00:00Z' },
        { content: 'Plays chess', recordedAt: '2026-05-01T00:00:00Z' },
      ],
    });
    const rel = { from: 'alice', to: 'bob', relationType: 'knows' } as Relation;
    const rep = await exportAmr([e, ent({ name: 'bob', observations: ['b'] })], [rel], root, { dryRun: false, runner, now: NOW });
    const after = read(root, 'alice.md');
    expect(after).toBe(
      '# alice\n\nSome prose that stays.\n\n```\n- not a bullet\n```\n\n' +
        '- Likes tea [added: 2026-03-04; source: chat]\n- Lives in Oslo [added: 2026-03-04]\n- Plays chess [added: 2026-05-01]\n\n## Relations\n\n- knows [[bob]]\n',
    );
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'update', changedLines: 2, stale: 0 });
  });

  it('keeps a stale bullet and counts it', async () => {
    const { root, runner } = memRepo({ 'alice.md': '- gone\n- kept\n' });
    const rep = await exportAmr([ent({ name: 'alice', observations: ['kept'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'alice.md')).toBe('- gone\n- kept\n');
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'unchanged', stale: 1 });
  });

  it('keeps CRLF and a BOM when appending', async () => {
    const { root, runner } = memRepo({ 'alice.md': '﻿- a\r\n' });
    await exportAmr([ent({ name: 'alice', observations: ['a', 'b'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'alice.md')).toBe('﻿- a\r\n- b\r\n');
  });

  it('does not rewrite an entry whose metadata differs only in key order', async () => {
    const { root } = memRepo({ 'alice.md': '# alice\n\n- x [source: a; added: 2026-03-04]\n' });
    const e = ent({ name: 'alice', observations: ['x'], observationMeta: [{ content: 'x', recordedAt: '2026-03-04T00:00:00Z', meta: { source: ['a'] } }] });
    const rep = await exportAmr([e], [], root, { now: NOW });
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'unchanged', changedLines: 0 });
  });

  it('reuses the file of an imported entity and never edits a file of another entity', async () => {
    const { root, runner } = memRepo({ 'Notes/Alice.md': '- a\n', 'x.md': '---\nname: Other\n---\n\n- o\n' });
    const ctx = newCtx();
    await importAmr(ctx, root, { dryRun: false });
    const g = await ctx.entityManager.getEntity('Notes/Alice');
    const o = await ctx.entityManager.getEntity('Other');
    const rep = await exportAmr([g!, o!, ent({ name: 'x', observations: ['new'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(fileOf(rep, 'Notes/Alice.md')).toMatchObject({ action: 'unchanged' });
    expect(fileOf(rep, 'x.md')).toMatchObject({ action: 'unchanged' });
    expect(fileOf(rep, 'x-2.md')).toMatchObject({ action: 'create' });
    expect(rep.files.filter((f) => f.action === 'create').map((f) => f.path)).toEqual(['x-2.md']);
  });

  it('is idempotent: a second export changes nothing', async () => {
    const { root, runner } = memRepo();
    const list = [ent({ name: 'Alice Smith', entityType: 'person', observations: ['line one\nline two', 'b'] }), ent({ name: 'bob', observations: ['c'] })];
    const rels = [{ from: 'Alice Smith', to: 'bob', relationType: 'knows' } as Relation];
    await exportAmr(list, rels, root, { dryRun: false, runner, now: NOW });
    const snap = ['MEMORY.md', 'person/alice-smith.md', 'bob.md', '_hubs/person.md', '_hubs/note.md'].map((p) => read(root, p));
    const rep2 = await exportAmr(list, rels, root, { dryRun: false, runner, now: NOW });
    expect(rep2.files.every((f) => f.action === 'unchanged' && f.changedLines === 0)).toBe(true);
    expect(['MEMORY.md', 'person/alice-smith.md', 'bob.md', '_hubs/person.md', '_hubs/note.md'].map((p) => read(root, p))).toEqual(snap);
  });

  it('refuses a file that does not parse', async () => {
    const { root, runner } = memRepo({ 'alice.md': '---\ntype: note\n\n- unclosed front matter\n' });
    const rep = await exportAmr([ent({ name: 'alice', observations: ['y'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'refused', reason: 'unparseable' });
    expect(read(root, 'alice.md')).toBe('---\ntype: note\n\n- unclosed front matter\n');
  });

  it('applies the skip rules in order and counts each one', async () => {
    const { root } = memRepo();
    const list = [
      ent({ name: 'keep', entityType: 'person', observations: ['ok', 'old', 'future', `key ${fakeAws()}`], observationMeta: [
        { content: 'old', validUntil: '2026-01-01T00:00:00Z' },
        { content: 'future', validFrom: '2027-01-01T00:00:00Z' },
      ] }),
      ent({ name: 'no-visibility', entityType: 'person' }),
      ent({ name: 'other-type', entityType: 'tool', isLatest: false }),
      ent({ name: 'old-version', entityType: 'person', isLatest: false, lifecycleStatus: 'archived' }),
      ent({ name: 'gone', entityType: 'person', lifecycleStatus: 'archived' }),
      ent({ name: 'secret', entityType: 'person', visibility: 'private' } as Partial<Entity> & { name: string }),
    ];
    const rep = await exportAmr(list, [], root, { types: ['person'], now: NOW });
    expect(rep.skipped).toEqual({ type: 1, notLatest: 1, archived: 1, private: 1, invalidObservations: 2, secret: 1 });
    expect(rep.files.map((f) => f.path)).toEqual(expect.arrayContaining(['keep.md', 'no-visibility.md']));
  });

  it('drops a meta value that cannot be encoded, with a warning, and never throws', async () => {
    const { root } = memRepo();
    const e = ent({ name: 'alice', observations: ['x'], observationMeta: [{ content: 'x', meta: { source: ['a]b'], ok: ['y'] } }] });
    const rep = await exportAmr([e], [], root, { now: NOW });
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'create' });
    expect(rep.warnings.length).toBeGreaterThan(0);
  });

  it('dry run and real run return deep-equal reports and the dry run writes nothing', async () => {
    const fixture = (): { list: Entity[]; files: Record<string, string> } => ({
      list: [
        ent({ name: 'alice', observations: ['a', `key ${fakeAws()}`] }),
        ent({ name: 'broken', observations: ['b'] }),
        ent({ name: 'Alice Smith', entityType: 'person', observations: ['x'.repeat(10)] }),
      ],
      files: { 'broken.md': '---\nunclosed\n' },
    });
    const a = fixture();
    const dry = memRepo(a.files);
    const r1 = await exportAmr(a.list, [], dry.root, { now: NOW });
    expect(existsSync(join(dry.root, 'alice.md'))).toBe(false);
    const b = fixture();
    const real = memRepo(b.files);
    const r2 = await exportAmr(b.list, [], real.root, { dryRun: false, runner: real.runner, now: NOW });
    expect(r2).toEqual(r1);
  });

  it('builds the MEMORY.md index from hubs and the top N by importance, keeping the rest', async () => {
    const { root, runner } = memRepo();
    put(root, 'MEMORY.md', '# Memory\n\n- a top fact\n\n## Index\n\n- [[stale]]\n\n## Later\n\nkept\n');
    execFileSync('git', ['commit', '-qam', 'm'], { cwd: root, env: { ...process.env, ...(runner.config.env as Record<string, string>) } });
    const list = [ent({ name: 'a', importance: 1 }), ent({ name: 'b', importance: 9 }), ent({ name: 'c', importance: 5, entityType: 'person' })];
    await exportAmr(list, [], root, { dryRun: false, runner, indexTopN: 2, now: NOW });
    const m = read(root, 'MEMORY.md');
    expect(m.startsWith('# Memory\n\n- a top fact\n')).toBe(true);
    expect(m.endsWith('## Later\n\nkept\n')).toBe(true);
    expect(m).not.toContain('[[stale]]');
    const idx = m.slice(m.indexOf('## Index'), m.indexOf('## Later'));
    expect(idx.split('\n').filter((l) => l.startsWith('- '))).toEqual(['- [[_hubs/note]]', '- [[_hubs/person]]', '- [[b]]', '- [[c]]']);
    expect(read(root, '_hubs/note.md')).toContain('- [[a]]');
  });

  it('creates MEMORY.md when it is missing', async () => {
    const root = tmp('amr-nm-');
    put(root, 'x.txt', 'x');
    const runner = repo(root);
    await exportAmr([ent({ name: 'a', observations: ['x'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'MEMORY.md').startsWith('# Memory\n')).toBe(true);
  });

  it('requires a runner when dryRun is false', async () => {
    const { root } = memRepo();
    await expect(exportAmr([ent({ name: 'a' })], [], root, { dryRun: false })).rejects.toThrow(ValidationError);
  });
});

describe('importAmr', () => {
  it('creates entities with observations, metadata and front matter fields', async () => {
    const root = tmp('amr-im-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, 'person/alice-smith.md', '---\nname: Alice Smith\ntype: person\ntags: [team]\nimportance: 7\n---\n\n# Alice Smith\n\n- Likes tea [added: 2026-03-04; source: chat]\n  - Green tea\n');
    const ctx = newCtx();
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.entities).toEqual([expect.objectContaining({ name: 'Alice Smith', file: 'person/alice-smith.md', action: 'create' })]);
    const e = await ctx.entityManager.getEntity('Alice Smith');
    expect(e).toMatchObject({ entityType: 'person', tags: ['team'], importance: 7, observations: ['Likes tea', 'Green tea'] });
    const m = e?.observationMeta?.find((x) => x.content === 'Likes tea');
    expect(m).toMatchObject({ meta: { source: ['chat'] } });
    expect(m?.recordedAt?.startsWith('2026-03-04')).toBe(true);
  });

  it('dry run changes nothing and reports the same as the real run', async () => {
    const files = { 'MEMORY.md': '# Memory\n', 'alice.md': '- x\n', 'big.md': `- ${'x'.repeat(5001)}\n` };
    const r1Root = tmp('amr-id1-');
    const r2Root = tmp('amr-id2-');
    for (const [k, v] of Object.entries(files)) {
      put(r1Root, k, v);
      put(r2Root, k, v);
    }
    const c1 = newCtx();
    const r1 = await importAmr(c1, r1Root, {});
    expect(await c1.entityManager.getEntity('alice')).toBeNull();
    const r2 = await importAmr(newCtx(), r2Root, { dryRun: false });
    expect(r2).toEqual(r1);
  });

  it('skips Relations bullets as observations and imports an exported file exactly', async () => {
    const { root, runner } = memRepo();
    const e = ent({ name: 'Alice Smith', entityType: 'person', observations: ['Likes tea'] });
    await exportAmr([e, ent({ name: 'bob', observations: ['b'] })], [{ from: 'Alice Smith', to: 'bob', relationType: 'knows' } as Relation], root, { dryRun: false, runner, now: NOW });
    const ctx = newCtx();
    await importAmr(ctx, root, { dryRun: false });
    expect((await ctx.entityManager.getEntity('Alice Smith'))?.observations).toEqual(['Likes tea']);
    const rels = (await ctx.relationManager.getRelations('Alice Smith')).filter((r) => r.from === 'Alice Smith');
    expect(rels.map((r) => [r.relationType, r.to])).toEqual([['knows', 'bob']]);
  });

  it('export then add-only import leaves the graph unchanged', async () => {
    const ctx = newCtx();
    await ctx.entityManager.createEntities([{ name: 'alice', entityType: 'note', observations: ['line one\nline two', 'b'] }]);
    const { root, runner } = memRepo();
    const graph = await ctx.entityManager.getEntity('alice');
    await exportAmr([graph!], [], root, { dryRun: false, runner, now: NOW });
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.entities).toEqual([expect.objectContaining({ name: 'alice', action: 'unchanged' })]);
    expect((await ctx.entityManager.getEntity('alice'))?.observations).toEqual(['line one\nline two', 'b']);
  });

  it('reconcile lets the file win', async () => {
    const ctx = newCtx();
    await ctx.entityManager.createEntities([{ name: 'alice', entityType: 'note', observations: ['old', 'kept'] }]);
    const root = tmp('amr-ir-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, 'alice.md', '---\ntype: person\n---\n\n- kept\n- fresh\n');
    await importAmr(ctx, root, { dryRun: false, mode: 'reconcile' });
    expect(await ctx.entityManager.getEntity('alice')).toMatchObject({ entityType: 'person', observations: ['kept', 'fresh'] });
  });

  it('resolves link targets to entity names, in a second pass, and ignores MEMORY and hub links', async () => {
    const ctx = newCtx();
    const root = tmp('amr-il-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, '_hubs/note.md', '- [[a-first]]\n');
    put(root, 'a-first.md', '- met [[person/alice-smith]] and [[nobody]], see [[MEMORY]] and [[_hubs/note]]\n');
    put(root, 'person/alice-smith.md', '---\nname: Alice Smith\n---\n\n- x\n');
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.danglingLinks).toEqual([{ file: 'a-first.md', link: 'nobody' }]);
    const rels = (await ctx.relationManager.getRelations('a-first')).filter((r) => r.from === 'a-first');
    expect(rels.map((r) => [r.relationType, r.to, r.properties?.source, r.properties?.method])).toEqual([
      ['links_to', 'Alice Smith', 'amr:a-first.md', 'imported'],
    ]);
  });

  it('reconcile removes only its own imported edges and keeps an AutoLinker edge', async () => {
    const ctx = newCtx();
    const root = tmp('amr-ik-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, 'bob.md', '- bob fact\n');
    put(root, 'alice.md', '- met [[bob]]\n\n## Relations\n\n- works_with [[bob]]\n');
    await importAmr(ctx, root, { dryRun: false });
    await ctx.relationManager.createRelations([{ from: 'alice', to: 'bob', relationType: 'mentions', properties: { method: 'inferred' } } as Relation]);
    put(root, 'alice.md', '- met nobody\n');
    const r2 = await importAmr(ctx, root, { dryRun: false, mode: 'reconcile' });
    expect(r2.relations.removed).toBe(2);
    const left = (await ctx.relationManager.getRelations('alice')).filter((r) => r.from === 'alice');
    expect(left.map((r) => r.relationType)).toEqual(['mentions']);
  });

  it('reports a failing entity and still imports the next one; a duplicate name is an error', async () => {
    const ctx = newCtx();
    const root = tmp('amr-ie-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, 'a-long.md', `- ${'x'.repeat(5001)}\n`);
    put(root, 'b-ok.md', '- fine\n');
    put(root, 'c-dup.md', '---\nname: b-ok\n---\n\n- dup\n');
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.entities.find((e) => e.name === 'a-long')).toMatchObject({ action: 'error' });
    expect(rep.entities.find((e) => e.file === 'b-ok.md')).toMatchObject({ action: 'create' });
    expect(rep.entities.find((e) => e.file === 'c-dup.md')).toMatchObject({ action: 'error' });
  });

  it('walks more than 50 files', async () => {
    const ctx = newCtx();
    const root = tmp('amr-iw-');
    put(root, 'MEMORY.md', '# Memory\n');
    for (let i = 0; i < 60; i++) put(root, `n${i}.md`, `- f${i}\n`);
    const rep = await importAmr(ctx, root, {});
    expect(rep.entities.length).toBe(60);
  });

  it('namespace prefixes names and sets projectId; export strips it again', async () => {
    const ctx = newCtx();
    const { root, runner } = memRepo({ 'alice.md': '- x\n' });
    const rep = await importAmr(ctx, root, { dryRun: false, namespace: 'proj' });
    expect(rep.entities.map((e) => e.name)).toEqual(['proj/alice']);
    const e = await ctx.entityManager.getEntity('proj/alice');
    expect(e).toMatchObject({ projectId: 'proj' });
    const out = await exportAmr([e!], [], root, { dryRun: false, runner, namespace: 'proj', now: NOW });
    expect(fileOf(out, 'alice.md')).toMatchObject({ action: 'unchanged' });
  });

  it('round-trips: export then import into a new graph keeps names, types and observations', async () => {
    const { root, runner } = memRepo();
    const list = [ent({ name: 'Alice Smith', entityType: 'person', observations: ['a', 'b'] }), ent({ name: 'bob', observations: ['c'] })];
    await exportAmr(list, [], root, { dryRun: false, runner, now: NOW });
    const ctx = newCtx();
    await importAmr(ctx, root, { dryRun: false });
    expect(await ctx.entityManager.getEntity('Alice Smith')).toMatchObject({ entityType: 'person', observations: ['a', 'b'] });
    expect(await ctx.entityManager.getEntity('bob')).toMatchObject({ observations: ['c'] });
  });
});

describe('phase 4 review regressions', () => {
  const junction = (link: string, target: string) => symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const exportTimes = async (n: number, list: () => Entity[], rels: Relation[], opts: { namespace?: string } = {}) => {
    const { root, runner } = memRepo();
    const reps = [];
    for (let i = 0; i < n; i++) reps.push(await exportAmr(list(), rels, root, { dryRun: false, runner, now: NOW, ...opts }));
    return { root, reps };
  };
  const creates = (rep: { files: { path: string; action: string }[] }) => rep.files.filter((f) => f.action === 'create').map((f) => f.path);

  it.each([
    ['a namespaced non-plain name', 'proj/Alice Smith', 'proj'],
    ['a name without the prefix while namespace is set', 'alice', 'proj'],
    ['an NFD name', 'Cafe' + String.fromCharCode(0x301), undefined],
    ['a name with a line break', 'Line1' + String.fromCharCode(10) + 'Line2', undefined],
  ])('F1/F2: %s creates one file over three exports', async (_label, name, ns) => {
    const { reps } = await exportTimes(3, () => [ent({ name, observations: ['x'] })], [], { namespace: ns });
    expect(creates(reps[0]).length).toBe(1);
    expect(reps[0].writeError).toBeUndefined();
    expect(creates(reps[1])).toEqual([]);
    expect(creates(reps[2])).toEqual([]);
    expect(reps[2].files.map((f) => f.action)).toEqual(['unchanged']);
  });

  it('F3: a repeated name in the list is exported once and the real run writes', async () => {
    const { root, runner } = memRepo();
    const rep = await exportAmr([ent({ name: 'a', observations: ['1'] }), ent({ name: 'a', observations: ['2'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(rep.writeError).toBeUndefined();
    expect(creates(rep)).toEqual(['a.md']);
    expect(read(root, 'a.md')).toContain('- 1');
  });

  it('F4A: add-only import keeps the metadata of the observations it adds', async () => {
    const ctx = newCtx();
    await ctx.entityManager.createEntities([{ name: 'alice', entityType: 'note', observations: ['likes tea'] }]);
    const root = tmp('amr-f4-');
    put(root, 'alice.md', '- likes tea [added: 2026-01-01; source: chat]\n- owns cat [added: 2026-01-02; confidence: high]\n');
    await importAmr(ctx, root, { dryRun: false });
    const m = (await ctx.entityManager.getEntity('alice'))?.observationMeta?.find((x) => x.content === 'owns cat');
    expect(m).toMatchObject({ meta: { confidence: ['high'] } });
    expect(m?.recordedAt?.startsWith('2026-01-02')).toBe(true);
  });

  it('F4B: export keeps a metadata key that only the file holds', async () => {
    const { root } = memRepo({ 'bob.md': '- likes tea [added: 2026-01-01; confidence: high]\n' });
    const e = ent({ name: 'bob', observations: ['likes tea'], observationMeta: [{ content: 'likes tea', recordedAt: '2026-01-01T09:00:00Z' }] });
    const rep = await exportAmr([e], [], root, { now: NOW });
    expect(fileOf(rep, 'bob.md')).toMatchObject({ action: 'unchanged' });
    const e2 = ent({ name: 'bob', observations: ['likes tea'], observationMeta: [{ content: 'likes tea', recordedAt: '2026-01-01T09:00:00Z', meta: { source: ['chat'] } }] });
    const { root: r2, runner } = memRepo({ 'bob.md': '- likes tea [added: 2026-01-01; confidence: high]\n' });
    await exportAmr([e2], [], r2, { dryRun: false, runner, now: NOW });
    expect(read(r2, 'bob.md')).toBe('- likes tea [added: 2026-01-01; confidence: high; source: chat]\n');
  });

  it('F5: a relation type that the bullet format cannot hold is dropped with a warning', async () => {
    const { root, runner } = memRepo();
    const rels = [
      { from: 'a', to: 'b', relationType: 'knows\n# Injected\n- forged [[b]]' },
      { from: 'a', to: 'b', relationType: 'works with' },
      { from: 'a', to: 'b', relationType: 'likes' },
    ] as Relation[];
    const rep = await exportAmr([ent({ name: 'a', observations: ['x'] }), ent({ name: 'b', observations: ['y'] })], rels, root, { dryRun: false, runner, now: NOW });
    const text = read(root, 'a.md');
    expect(text).not.toContain('Injected');
    expect(text).not.toContain('works with');
    expect(text).toContain('- likes [[b]]');
    expect(rep.warnings.filter((w) => w.includes('cannot be written')).length).toBe(2);
  });

  it('F6: a relation to a skipped entity is not written', async () => {
    const { root, runner } = memRepo();
    const list = [ent({ name: 'a', observations: ['x'] }), ent({ name: 'Secret Project Falcon', visibility: 'private' } as Partial<Entity> & { name: string })];
    const rep = await exportAmr(list, [{ from: 'a', to: 'Secret Project Falcon', relationType: 'works_on' } as Relation], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'a.md')).not.toContain('falcon');
    expect(rep.warnings.some((w) => w.includes('works_on dropped'))).toBe(true);
  });

  it('F7: a new bullet goes after the list item and its indented fence', async () => {
    const before = '# alice\n\n- step one\n  ```sh\n  echo hi\n  ```\n\nafter\n';
    const { root, runner } = memRepo({ 'alice.md': before });
    await exportAmr([ent({ name: 'alice', observations: ['step one', 'new fact'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(read(root, 'alice.md')).toBe('# alice\n\n- step one\n  ```sh\n  echo hi\n  ```\n- new fact\n\nafter\n');
  });

  it('F8: a relation bullet with another marker counts as present; the heading matches in any case', async () => {
    const { root } = memRepo({ 'alice.md': '- a\n\n## relations\n\n* knows [[bob]]\n', 'bob.md': '- b\n' });
    const rep = await exportAmr([ent({ name: 'alice', observations: ['a'] }), ent({ name: 'bob', observations: ['b'] })], [{ from: 'alice', to: 'bob', relationType: 'knows' } as Relation], root, { now: NOW });
    expect(fileOf(rep, 'alice.md')).toMatchObject({ action: 'unchanged', stale: 0 });
  });

  it('F9: a file the writer would refuse is refused in both modes; the other files still go out', async () => {
    const fixture = () => {
      const files: Record<string, string> = { 'MEMORY.md': `# Memory\n\n${'x'.repeat(20_000)}\n`, person: 'a plain file' };
      const list = [
        ent({ name: 'ok', observations: ['fine'] }),
        ent({ name: 'tagged', observations: ['t'], tags: [fakeAws()] }),
        ent({ name: 'com0', observations: ['c'] }),
        ent({ name: 'Al', entityType: 'person', observations: ['p'] }),
        ent({ name: 'n'.repeat(300), observations: ['long'] }),
      ];
      return { files, list };
    };
    const a = fixture();
    const dry = memRepo(a.files);
    const r1 = await exportAmr(a.list, [], dry.root, { now: NOW });
    const b = fixture();
    const real = memRepo(b.files);
    const r2 = await exportAmr(b.list, [], real.root, { dryRun: false, runner: real.runner, now: NOW });
    expect(r2).toEqual(r1);
    expect(r2.writeError).toBeUndefined();
    expect(fileOf(r2, 'tagged.md')).toMatchObject({ action: 'refused', reason: 'secret' });
    expect(fileOf(r2, 'person/al.md')).toMatchObject({ action: 'refused', reason: 'io-error' });
    expect(fileOf(r2, 'MEMORY.md')).toMatchObject({ action: 'refused', reason: 'too-large' });
    expect(fileOf(r2, 'note/com0-entity.md')).toMatchObject({ action: 'create' });
    expect(r2.files.find((f) => f.path.startsWith('note/nnn'))!.path.length).toBeLessThan(120);
    expect(read(real.root, 'ok.md')).toContain('- fine');
  });

  it('F10: a busy file is an error entry on import and a refusal on export; the rest goes on', async () => {
    const root = tmp('amr-busy-');
    put(root, 'MEMORY.md', '# Memory\n');
    put(root, 'busy.md', '- locked\n');
    put(root, 'ok.md', '- fine\n');
    const realOpen = fsPromises.open;
    const spy = vi.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      if (String(args[0]).endsWith('busy.md')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return realOpen(...args);
    });
    try {
      const ctx = newCtx();
      const rep = await importAmr(ctx, root, { dryRun: false });
      expect(rep.entities.find((e) => e.file === 'busy.md')).toMatchObject({ action: 'error', error: 'unreadable EBUSY' });
      expect(rep.entities.find((e) => e.file === 'ok.md')).toMatchObject({ action: 'create' });
      const out = await exportAmr([ent({ name: 'busy', observations: ['new'] }), ent({ name: 'ok', observations: ['fine'] })], [], root, { now: NOW });
      expect(fileOf(out, 'busy.md')).toMatchObject({ action: 'refused', reason: 'unreadable EBUSY' });
      expect(out.files.map((f) => f.path)).not.toContain('busy-2.md');
    } finally {
      spy.mockRestore();
    }
  });

  it('F11: an invalid relation is dropped in both modes and the valid ones are created', async () => {
    const files = { 'a.md': `- self [[a]]\n\n## Relations\n\n- ${'t'.repeat(700)} [[b]]\n`, 'b.md': '- b\n' };
    const r1 = tmp('amr-f11a-');
    const r2 = tmp('amr-f11b-');
    for (const [k, v] of Object.entries(files)) {
      put(r1, k, v);
      put(r2, k, v);
    }
    const dry = await importAmr(newCtx(), r1, {});
    const ctx = newCtx();
    const real = await importAmr(ctx, r2, { dryRun: false });
    expect(real).toEqual(dry);
    expect(real.relations.created).toBe(1);
    expect((await ctx.relationManager.getRelations('a')).filter((r) => r.from === 'a').map((r) => r.relationType)).toEqual(['links_to']);
  });

  it('F11: more than 1000 relations are created in chunks', async () => {
    const root = tmp('amr-f11c-');
    const n = 1001;
    for (let i = 0; i < n; i++) put(root, `t${i}.md`, '- t\n');
    const links = Array.from({ length: n }, (_, i) => `[[t${i}]]`);
    const bullets: string[] = [];
    for (let i = 0; i < n; i += 300) bullets.push(`- ${links.slice(i, i + 300).join(' ')}`);
    put(root, 'a.md', `${bullets.join('\n')}\n`);
    const ctx = newCtx();
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.relations.created).toBe(n);
    expect((await ctx.relationManager.getRelations('a')).filter((r) => r.from === 'a').length).toBe(n);
  }, 60_000);

  it('F12: reconcile keeps a relation whose target file has an error', async () => {
    const ctx = newCtx();
    const root = tmp('amr-f12-');
    put(root, 'a.md', '- knows [[b]]\n');
    put(root, 'b.md', '- b\n');
    await importAmr(ctx, root, { dryRun: false, mode: 'reconcile' });
    put(root, 'b.md', '```\nunterminated\n');
    const rep = await importAmr(ctx, root, { dryRun: false, mode: 'reconcile' });
    expect(rep.relations.removed).toBe(0);
    expect((await ctx.relationManager.getRelations('a')).filter((r) => r.from === 'a').map((r) => r.to)).toEqual(['b']);
  });

  it('F13: a name or type that the schema refuses is the same error in a dry and a real run', async () => {
    const files = { 'a.md': `---\nname: ${'n'.repeat(600)}\n---\n\n- x\n`, 'b.md': `---\ntype: ${'t'.repeat(600)}\n---\n\n- y\n` };
    const r1 = tmp('amr-f13a-');
    const r2 = tmp('amr-f13b-');
    for (const [k, v] of Object.entries(files)) {
      put(r1, k, v);
      put(r2, k, v);
    }
    const dry = await importAmr(newCtx(), r1, {});
    const real = await importAmr(newCtx(), r2, { dryRun: false });
    expect(real).toEqual(dry);
    expect(dry.entities.map((e) => e.action)).toEqual(['error', 'error']);
  });

  it('F14: a folder swapped for a junction after the rename: the restore writes and removes nothing outside', async () => {
    const { root, runner } = memRepo({ 'sub/a.md': 'OLD-A\n' });
    const outside = tmp('amr-out-');
    writeFileSync(join(outside, 'a.md'), 'OUTSIDE-A');
    writeFileSync(join(outside, 'b.md'), 'OUTSIDE-B');
    const realRealpath = fsPromises.realpath;
    let swapped = false;
    const spy = vi.spyOn(fsPromises, 'realpath').mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (!swapped && String(p) === join(root, 'sub', 'a.md')) {
        swapped = true;
        renameSync(join(root, 'sub'), join(root, 'sub_moved'));
        junction(join(root, 'sub'), outside);
      }
      return (realRealpath as (...a: unknown[]) => Promise<string>)(p, ...rest);
    }) as typeof realRealpath);
    let res;
    try {
      res = await writeAmrFiles(root, [{ path: 'sub/a.md', text: 'NEW-A\n' }, { path: 'sub/b.md', text: 'NEW-B\n' }], { runner, message: 'x' });
    } finally {
      spy.mockRestore();
      if (swapped) (process.platform === 'win32' ? rmdirSync : unlinkSync)(join(root, 'sub'));
    }
    expect(swapped).toBe(true);
    expect(res).toMatchObject({ ok: false, reason: 'outside-root', left: ['sub/a.md', 'sub/b.md'] });
    expect(readFileSync(join(outside, 'a.md'), 'utf8')).toBe('OUTSIDE-A');
    expect(readFileSync(join(outside, 'b.md'), 'utf8')).toBe('OUTSIDE-B');
  });

  it('F14: a mid-batch failure restores the earlier files of the batch', async () => {
    const { root, runner } = memRepo({ 'a.md': '- old\n', 'x/y.md': '- y\n' });
    const realRename = fsPromises.rename;
    const spy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof realRename>) => {
      if (String(args[1]).endsWith('y.md')) throw Object.assign(new Error('locked'), { code: 'EACCES' });
      return realRename(...args);
    });
    let res;
    try {
      res = await writeAmrFiles(root, [{ path: 'a.md', text: '- new\n' }, { path: 'x/y.md', text: '- y2\n' }], { runner, message: 'x' });
    } finally {
      spy.mockRestore();
    }
    expect(res).toMatchObject({ ok: false, reason: 'io-error', path: 'x/y.md' });
    expect(read(root, 'a.md')).toBe('- old\n');
    expect(await runner.checkClean()).toEqual({ ok: true });
  });

  const pathCalls = (spy: { mock: { calls: unknown[][] } }, sub: string) =>
    spy.mock.calls.map((c) => c[0] as string[]).filter((a) => a[0] === sub).map((a) => a.slice(a.indexOf('--') + 1));
  const withinBudget = (chunk: string[]) => chunk.reduce((n, p) => n + p.length + 1, 0) <= 200;

  it('F15: the git runner stages a long path list in chunks', async () => {
    const { root, runner } = memRepo();
    const small = new GitRunner(root, { env: runner.config.env, maxArgChars: 200 });
    const spy = vi.spyOn(small, 'run');
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `dir-${i}/file-number-${i}.md`, text: `- ${i}\n` }));
    const res = await writeAmrFiles(root, files, { runner: small, message: 'many' });
    expect(res).toMatchObject({ ok: true, committed: true });
    const adds = pathCalls(spy, 'add');
    expect(adds.length).toBeGreaterThan(1);
    expect(adds.every(withinBudget)).toBe(true);
    expect(adds.flat().length).toBe(30);
    expect(await small.checkClean()).toEqual({ ok: true });
  });

  it('F15: a failed commit unstages a long path list in chunks and restores every file', async () => {
    const { root, runner } = memRepo({ 'dir-0/file-number-0.md': '- old\n' });
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const small = new GitRunner(root, { env: runner.config.env, maxArgChars: 200 });
    const spy = vi.spyOn(small, 'run');
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `dir-${i}/file-number-${i}.md`, text: `- ${i}\n` }));
    const res = await writeAmrFiles(root, files, { runner: small, message: 'many' });
    expect(res).toMatchObject({ ok: false, reason: 'git-failed' });
    const restores = pathCalls(spy, 'restore');
    expect(restores.length).toBeGreaterThan(1);
    expect(restores.every(withinBudget)).toBe(true);
    expect(read(root, 'dir-0/file-number-0.md')).toBe('- old\n');
    expect(existsSync(join(root, 'dir-1'))).toBe(false);
    expect(await small.checkClean()).toEqual({ ok: true });
  });

  it('F2: an NFD graph name exported then imported add-only is the same entity', async () => {
    const ctx = newCtx();
    const nfd = 'Cafe' + String.fromCharCode(0x301);
    await ctx.entityManager.createEntities([{ name: nfd, entityType: 'note', observations: ['x'] }]);
    const { root, runner } = memRepo();
    await exportAmr([(await ctx.entityManager.getEntity(nfd))!], [], root, { dryRun: false, runner, now: NOW });
    const rep = await importAmr(ctx, root, { dryRun: false });
    expect(rep.entities.map((e) => [e.name, e.action])).toEqual([[nfd, 'unchanged']]);
    expect((await ctx.entityManager.listEntities()).length).toBe(1);
  });

  it('an add-only import does not read the secret pattern file', async () => {
    const root = tmp('amr-pat-');
    put(root, 'a.md', '- x\n');
    const before = process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
    process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = join(root, 'missing-patterns.json');
    try {
      const rep = await importAmr(newCtx(), root, {});
      expect(rep.entities.map((e) => e.action)).toEqual(['create']);
      await expect(importAmr(newCtx(), root, { mode: 'reconcile' })).rejects.toThrow();
    } finally {
      if (before === undefined) delete process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
      else process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = before;
    }
  });

  it('F16: an entity type _hubs does not collide with the hub folder', async () => {
    const { root, runner } = memRepo();
    const rep = await exportAmr([ent({ name: 'Note', entityType: '_hubs', observations: ['x'] }), ent({ name: 'Zed', observations: ['z'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(rep.writeError).toBeUndefined();
    expect(creates(rep)).toContain('_hubs-entity/note.md');
  });

  const BOM = String.fromCharCode(0xfeff);
  it.each([
    ['BOM, CRLF and a fence with a heading-like line', `${BOM}# Memory\r\n\r\n## Index\r\n\r\n- [[old]]\r\n\r\n\`\`\`\r\n## not a heading\r\n\`\`\`\r\n\r\n## Notes\r\nkeep me`, `${BOM}# Memory\r\n\r\n## Index\r\n\r\n- [[_hubs/note]]\r\n- [[a]]\r\n\r\n## Notes\r\nkeep me`],
    ['an Index heading inside a fence', '# Memory\n\nExample:\n\n```md\n## Index\n- sample\n```\n\nreal text\n', '# Memory\n\nExample:\n\n```md\n## Index\n- sample\n```\n\nreal text\n\n## Index\n\n- [[_hubs/note]]\n- [[a]]\n\n'],
    ['a BOM before the Index heading', `${BOM}## Index\n\n- [[old]]\n`, `${BOM}## Index\n\n- [[_hubs/note]]\n- [[a]]\n\n`],
    ['an indented Index heading', '# Memory\n\n  ## Index\n\n- [[old]]\n', '# Memory\n\n## Index\n\n- [[_hubs/note]]\n- [[a]]\n\n'],
  ])('F18: MEMORY.md with %s keeps every other line', async (_label, before, after) => {
    const { root, runner } = memRepo({ 'MEMORY.md': before });
    const rep = await exportAmr([ent({ name: 'a', observations: ['x'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(rep.writeError).toBeUndefined();
    expect(read(root, 'MEMORY.md')).toBe(after);
  });

  it('F19: rewriting 2000 bullets runs in linear time', async () => {
    const n = 2000;
    const obs = Array.from({ length: n }, (_, i) => `fact number ${i}`);
    const { root } = memRepo({ 'big.md': obs.map((o) => `- ${o} [added: 2026-01-01]\n`).join('') });
    const e = ent({ name: 'big', observations: obs, observationMeta: obs.map((c) => ({ content: c, recordedAt: '2026-02-02T00:00:00Z' })) });
    const t0 = performance.now();
    const rep = await exportAmr([e], [], root, { now: NOW });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(fileOf(rep, 'big.md')).toMatchObject({ action: 'update', changedLines: n });
  });

  it('F20: reconcile keeps what the export skips and the validity fields', async () => {
    const ctx = newCtx();
    const secret = `key ${fakeAws()}`;
    await ctx.entityManager.createEntities([{
      name: 'alice', entityType: 'note', observations: ['current', 'expiring', 'expired', secret],
      observationMeta: [
        { content: 'expiring', validFrom: '2026-01-01T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' },
        { content: 'expired', validUntil: '2025-01-01T00:00:00Z' },
      ],
    } as Entity]);
    const { root, runner } = memRepo();
    await exportAmr([(await ctx.entityManager.getEntity('alice'))!], [], root, { dryRun: false, runner, now: NOW });
    const rep = await importAmr(ctx, root, { dryRun: false, mode: 'reconcile', now: NOW });
    expect(rep.warnings.some((w) => w.includes('reconcile removes'))).toBe(false);
    const e = await ctx.entityManager.getEntity('alice');
    expect([...e!.observations].sort()).toEqual(['current', 'expired', 'expiring', secret].sort());
    expect(e!.observationMeta?.find((m) => m.content === 'expiring')).toMatchObject({ validUntil: '2030-01-01T00:00:00Z' });
  });

  it('F21: a new relation goes at the end of the section; .md and alias links resolve', async () => {
    const { root: r2, runner } = memRepo({ 'a.md': '- a\n\n## Relations\n\n- knows [[b]]\n- likes [[c]]\n', 'z.md': '- z\n' });
    await exportAmr([ent({ name: 'a', observations: ['a'] })], [{ from: 'a', to: 'z', relationType: 'new' } as Relation], r2, { dryRun: false, runner, now: NOW });
    expect(read(r2, 'a.md')).toBe('- a\n\n## Relations\n\n- knows [[b]]\n- likes [[c]]\n- new [[z]]\n');
    const root = tmp('amr-f21-');
    put(root, 'a.md', '- a\n\n## Relations\n\n- knows [[b.md]]\n- likes [[c|See]]\n');
    put(root, 'b.md', '- b\n');
    put(root, 'c.md', '- c\n');
    const rep = await importAmr(newCtx(), root, {});
    expect(rep.danglingLinks).toEqual([]);
    expect(rep.relations.created).toBe(2);
  });

  it('F22: a file the walk skips is a warning', async () => {
    const root = tmp('amr-f22-');
    put(root, 'ok.md', '- ok\n');
    put(root, '.drafts/x.md', '- x\n');
    const rep = await importAmr(newCtx(), root, {});
    expect(rep.warnings.some((w) => w.startsWith('.drafts/x.md: skipped'))).toBe(true);
  });

  it('F23: a dry run with a runner reports a dirty tree as the real run does', async () => {
    const { root, runner } = memRepo();
    put(root, 'stray.txt', 'x');
    const list = () => [ent({ name: 'a', observations: ['x'] })];
    const dry = await exportAmr(list(), [], root, { runner, now: NOW });
    const real = await exportAmr(list(), [], root, { dryRun: false, runner, now: NOW });
    expect(dry.writeError).toBe('not-clean');
    expect(real).toEqual(dry);
  });

  it('F24: memory.md and _HUBS/ in another case are not entities and do not block the export', async () => {
    const root = tmp('amr-f24-');
    put(root, 'memory.md', '# Memory\n');
    put(root, '_HUBS/note.md', '# note\n');
    put(root, 'a.md', '- x\n');
    const runner = repo(root);
    const rep = await importAmr(newCtx(), root, {});
    expect(rep.entities.map((e) => e.file)).toEqual(['a.md']);
    const out = await exportAmr([ent({ name: 'a', observations: ['x', 'y'] })], [], root, { dryRun: false, runner, now: NOW });
    expect(out.writeError).toBeUndefined();
    expect(read(root, 'memory.md')).toContain('## Index');
  });

  it('F25: add-only import adds a repeated text once', async () => {
    const ctx = newCtx();
    await ctx.entityManager.createEntities([{ name: 'b', entityType: 'note', observations: ['old'] }]);
    const root = tmp('amr-f25-');
    put(root, 'b.md', '- old\n- new\n- new\n');
    await importAmr(ctx, root, { dryRun: false });
    expect((await ctx.entityManager.getEntity('b'))?.observations).toEqual(['old', 'new']);
  });
});

describe('phase 5 declutter', () => {
  const NFD = 'cafe\u0301';
  const NFC = NFD.normalize('NFC');
  const mdFiles = (root: string): string[] => {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
        const r = rel === '' ? d.name : `${rel}/${d.name}`;
        if (d.isDirectory()) {
          if (d.name !== '.git' && d.name !== '_hubs') walk(r);
        } else if (d.name.endsWith('.md') && r !== 'MEMORY.md') out.push(r);
      }
    };
    walk('');
    return out;
  };

  it('an NFD namespace round-trips without a second file (FIX 2)', async () => {
    const { root, runner } = memRepo({ 'alice.md': '- likes tea\n' });
    const ctx = newCtx();
    await importAmr(ctx, root, { dryRun: false, namespace: NFD });
    const rep = await exportAmr(await ctx.entityManager.listEntities(), [], root, { dryRun: false, runner, now: NOW, namespace: NFD });
    expect(rep.files.map((f) => [f.path, f.action])).toEqual([['alice.md', 'unchanged']]);
    expect(mdFiles(root)).toEqual(['alice.md']);
  });

  it('export with an NFD namespace matches an NFC graph name (FIX 2)', async () => {
    const { root, runner } = memRepo({ 'alice.md': '- a\n' });
    const rep = await exportAmr([ent({ name: `${NFC}/alice`, observations: ['a'] })], [], root, { dryRun: false, runner, now: NOW, namespace: NFD });
    expect(fileOf(rep, 'alice.md')?.action).toBe('unchanged');
    expect(mdFiles(root)).toEqual(['alice.md']);
  });

  it('amrPathForEntity normalises the namespace (FIX 2)', () => {
    expect(amrPathForEntity(ent({ name: `${NFC}/alice` }), NFD)).toBe('alice.md');
  });

  it('front matter and entry metadata share one key rule (FIX 4)', () => {
    const keys = ['a', 'A1', 'a-b', 'a_b', '9x', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const want = [true, true, true, true, false, false, false, false, false, false];
    const fm = keys.map((k) => Object.hasOwn(parseFrontMatter(`${k}: v\n`).values, k));
    const meta = keys.map((k) => Object.hasOwn(parseEntryText(`x [${k}: v]`).meta ?? {}, k));
    expect(fm).toEqual(want);
    expect(meta).toEqual(want);
  });

  it('reserved device names and node_modules get the -entity suffix (FIX 5)', () => {
    const reserved = ['con', 'prn', 'aux', 'nul', ...Array.from({ length: 10 }, (_, i) => `com${i}`), ...Array.from({ length: 10 }, (_, i) => `lpt${i}`), 'node_modules'];
    for (const n of reserved) {
      expect(amrPathForEntity(ent({ name: n }))).toBe(`note/${n}-entity.md`);
      expect(amrPathForEntity(ent({ name: n.toUpperCase() }))).toBe(`note/${n}-entity.md`);
    }
    for (const n of ['com10', 'lpt', 'console', 'nulx', 'node_modules2']) expect(amrPathForEntity(ent({ name: n }))).toBe(`${n}.md`);
  });
});
