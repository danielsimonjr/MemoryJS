/**
 * AmrToolAdapter: the `amr.*` tool surface over one fixed memory root. The root comes only from
 * `deps.root`; writes need `deps.allowWrite`; budgets above the reader defaults are refused.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { createAmrTools, type AmrToolSet } from '../../../src/adapters/AmrToolAdapter.js';
import { AMR_READER_DEFAULTS, checkAmr } from '../../../src/features/amr/AmrReader.js';

/** Tool names of the surface, in order. */
const EXPECTED_NAMES = ['amr.context', 'amr.check', 'amr.export', 'amr.import', 'amr.commit'];

const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/** Host env without any GIT_* variable. */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) out[k] = v;
  return out;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8' });
}

/** A repository with a repo-local identity, no hooks, no signing, and one commit of MEMORY.md. */
function makeRoot(): string {
  const root = tmp('amr-tool-');
  const hooks = join(root, '.nohooks');
  mkdirSync(hooks);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', hooks);
  writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n');
  git(root, 'add', 'MEMORY.md');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/** A context over a temp JSONL storage file, seeded with two linked entities. */
async function seededContext(): Promise<ManagerContext> {
  const storage = join(tmp('amr-tool-store-'), 'graph.jsonl');
  const ctx = new ManagerContext(storage);
  await ctx.entityManager.createEntities([
    { name: 'Alpha', entityType: 'project', observations: ['first fact'] },
    { name: 'Beta', entityType: 'person', observations: ['second fact'] },
  ]);
  await ctx.relationManager.createRelations([{ from: 'Alpha', to: 'Beta', relationType: 'uses' }]);
  return ctx;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createAmrTools: surface', () => {
  it('lists exactly the five amr tools in order', async () => {
    const tools: AmrToolSet = createAmrTools(new ManagerContext(join(tmp('amr-list-'), 'g.jsonl')), { root: makeRoot() });
    expect(tools.list().map((t) => t.name)).toEqual(EXPECTED_NAMES);
  });

  it('refuses an unknown tool name with unknown_tool', async () => {
    const tools = createAmrTools(new ManagerContext(join(tmp('amr-unk-'), 'g.jsonl')), { root: makeRoot() });
    expect(await tools.call('amr.delete', {})).toMatchObject({ ok: false, error: { code: 'unknown_tool' } });
  });

  it('requires a non-empty deps.root', () => {
    const ctx = new ManagerContext(join(tmp('amr-noroot-'), 'g.jsonl'));
    expect(() => createAmrTools(ctx, { root: '' })).toThrow();
  });
});

describe('createAmrTools: arguments', () => {
  it.each([
    ['amr.check', { root: '/elsewhere' }],
    ['amr.check', { path: 'x' }],
    ['amr.context', { root: '/elsewhere' }],
    ['amr.export', { path: 'x.md' }],
    ['amr.import', { root: '/elsewhere' }],
    ['amr.commit', { message: 'x', root: '/elsewhere' }],
  ])('refuses a root or path argument on %s', async (name, args) => {
    const tools = createAmrTools(await seededContext(), { root: makeRoot() });
    expect(await tools.call(name, args)).toMatchObject({ ok: false, error: { code: 'invalid_args' } });
  });

  it('refuses a budget above the reader default and accepts the default itself', async () => {
    const root = makeRoot();
    const tools = createAmrTools(await seededContext(), { root });
    const over = AMR_READER_DEFAULTS.maxFiles + 1;
    expect(await tools.call('amr.context', { maxFiles: over })).toMatchObject({ ok: false, error: { code: 'invalid_args' } });
    expect(await tools.call('amr.context', { maxFiles: AMR_READER_DEFAULTS.maxFiles })).toMatchObject({ ok: true });
  });

  it('refuses a zero budget with invalid_args', async () => {
    const tools = createAmrTools(await seededContext(), { root: makeRoot() });
    expect(await tools.call('amr.context', { maxDepth: 0 })).toMatchObject({ ok: false, error: { code: 'invalid_args' } });
  });
});

describe('createAmrTools: writes', () => {
  it.each([
    ['amr.export', { apply: true }],
    ['amr.import', { apply: true }],
    ['amr.commit', { message: 'x' }],
  ])('%s without allowWrite gives write_disabled and writes nothing', async (name, args) => {
    const root = makeRoot();
    writeFileSync(join(root, 'hand.md'), '- edit\n');
    const before = git(root, 'rev-parse', 'HEAD');
    const tools = createAmrTools(await seededContext(), { root });
    expect(await tools.call(name, args)).toMatchObject({ ok: false, error: { code: 'write_disabled' } });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
    expect(existsSync(join(root, 'hand.md'))).toBe(true);
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('amr.export with allowWrite commits once', async () => {
    const root = makeRoot();
    const tools = createAmrTools(await seededContext(), { root, allowWrite: true });
    const count = Number(git(root, 'rev-list', '--count', 'HEAD').trim());
    const res = await tools.call('amr.export', { apply: true });
    expect(res).toMatchObject({ ok: true });
    expect(Number(git(root, 'rev-list', '--count', 'HEAD').trim())).toBe(count + 1);
  });

  it('amr.export without apply is a dry run and writes nothing', async () => {
    const root = makeRoot();
    const tools = createAmrTools(await seededContext(), { root, allowWrite: true });
    const before = git(root, 'rev-parse', 'HEAD');
    expect(await tools.call('amr.export', {})).toMatchObject({ ok: true });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
  });
});

describe('createAmrTools: results', () => {
  it('amr.check returns the module report unchanged', async () => {
    const root = makeRoot();
    const tools = createAmrTools(await seededContext(), { root });
    const res = await tools.call('amr.check', {});
    expect(res).toEqual({ ok: true, result: await checkAmr(root) });
  });

  it('amr.commit with allowWrite commits a hand edit', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
    const tools = createAmrTools(await seededContext(), { root, allowWrite: true });
    expect(await tools.call('amr.commit', { message: 'edit' })).toMatchObject({ ok: true, result: { ok: true, committed: true } });
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n- fact\n- more\n');
    expect(git(root, 'log', '--format=%s', '-1').trim()).toBe('memory: edit');
    expect(git(root, 'show', 'HEAD:MEMORY.md')).toBe('# Memory\n\n- fact\n- more\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('bounds an export report above the byte budget and marks it truncated', async () => {
    const root = makeRoot();
    const ctx = await seededContext();
    await ctx.entityManager.createEntities(
      Array.from({ length: 200 }, (_, i) => ({ name: `Entity${i}`, entityType: 'project', observations: [`fact ${i}`] })),
    );
    const budget = 8 * 1024;
    const full = await createAmrTools(ctx, { root, maxBytes: 1024 * 1024 }).call('amr.export', {});
    const fullFiles = (full as { result: { files: unknown[] } }).result.files;
    expect(Buffer.byteLength(JSON.stringify((full as { result: unknown }).result), 'utf8')).toBeGreaterThan(budget);
    const res = await createAmrTools(ctx, { root, maxBytes: budget }).call('amr.export', {});
    expect(res.ok).toBe(true);
    const result = (res as { result: { truncated?: boolean; files: unknown[] } }).result;
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(budget);
    // The documented cut: the files array keeps a prefix of the full report (the last item may be cut).
    expect(result.files.length).toBeGreaterThan(1);
    const whole = result.files.length - 1;
    expect(result.files.slice(0, whole)).toEqual(fullFiles.slice(0, whole));
  });

  it('bounds to deps.maxBytes and leaves a small result unchanged', async () => {
    const root = makeRoot();
    const ctx = await seededContext();
    const small = await createAmrTools(ctx, { root }).call('amr.export', {});
    expect((small as { result: { truncated?: boolean } }).result.truncated).toBeUndefined();
    const cut = await createAmrTools(ctx, { root, maxBytes: 200 }).call('amr.export', {});
    expect((cut as { result: { truncated?: boolean } }).result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify((cut as { result: unknown }).result), 'utf8')).toBeLessThanOrEqual(200);
  });
});
