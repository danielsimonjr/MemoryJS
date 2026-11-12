/**
 * Tests for AMR phase 3: the git runner, the secret scanner and the confined writer.
 *
 * Contract (the implementation must follow it exactly):
 *
 * Module `src/features/amr/GitRunner.ts` (`@experimental`).
 * - `AMR_GIT_DEFAULTS` is the one place for defaults:
 *   `{ gitBinary: 'git', binaryArgs: [], timeoutMs: 30_000, killGraceMs: 5_000, commitPrefix: 'memory: ', env: {},
 *   maxArgChars: 24_000 }`. `add`, `restore --staged` and `rm --cached` run in chunks whose path lengths
 *   (plus one per path) stay within `maxArgChars`; a value that is not an integer above 0 gives the default.
 *   `new GitRunner(root, config?)` merges a partial config over it. A `timeoutMs` or `killGraceMs` that is
 *   undefined, NaN, not finite, not above 0 or above 2^31-1 gives the default (`runner.config` shows the
 *   values in use). `root` must be a non-empty absolute path, else `ValidationError`. `runner.root` is it.
 * - `run(args)` spawns `gitBinary` with `[...binaryArgs, '--no-replace-objects', '--literal-pathspecs', ...args]`, `cwd: root`,
 *   `shell: false`, and resolves `{ code, stdout, stderr }`. It never rejects for a non-zero exit.
 *   The child environment is `process.env` with every key that matches `/^GIT_/i` removed, then
 *   `config.env` applied on top (the only way a `GIT_*` variable reaches the child).
 * - Exact allow-list. Anything else rejects with `AmrGitError` code `refused` and spawns nothing:
 *   - `status` with options only from `--porcelain`, `-z`;
 *   - `rev-parse` with options only from `--show-toplevel`, `--absolute-git-dir`, `--verify`, `--quiet`, `HEAD`;
 *   - `diff` with options only from `--cached`, `--name-only`, `-z`;
 *   - `commit -m <message>` exactly (three arguments; the message is opaque, never scanned as a flag);
 *   - `add -- <path>...`, `restore --staged -- <path>...` and `rm --cached --quiet -- <path>...` (at least
 *     one path; every argument after `--` is a path).
 *   Grouped short options (`-Af`) and long-option prefixes (`--al`) are therefore refused.
 *   - `ls-files -s -z -- <path>...` (at least one path), `cat-file -s <oid>` and `cat-file blob <oid>`, where
 *     the oid is 40 or 64 lowercase hex digits and nothing else. Any other `cat-file` or `ls-files` form
 *     (`-p`, `--textconv`, `--filters`, a ref, no `--`, an extra flag) is refused.
 * - A child that runs past `timeoutMs` is killed with its whole process tree (win32: `taskkill /pid <pid>
 *   /T /F`, `shell: false`; POSIX: the child is spawned detached and the negative pid is killed). `run`
 *   waits for the exit (at most `killGraceMs`) and rejects with code `timeout`. A spawn failure rejects
 *   with code `spawn`.
 * - `head()` resolves the HEAD sha, or null before the first commit. `unstage(paths)` runs
 *   `restore --staged -- <paths>`, or `rm --cached --quiet -- <paths>` when HEAD names no commit; it never
 *   rejects.
 * - `AmrGitError extends Error` has `code: 'refused' | 'timeout' | 'spawn' | 'not-clean' | 'not-root' |
 *   'stage-mismatch' | 'git-failed'`. Messages hold no absolute path.
 * - `checkClean()` resolves `{ ok: true }` or `{ ok: false, code: 'not-root' | 'not-clean' | 'git-failed' }`.
 *   Order: `not-root` first (realpath of `rev-parse --show-toplevel` vs realpath of root, case-insensitive
 *   on Windows), then `status --porcelain` (its exit code AND its output).
 * - `gitDir()` resolves the realpath of `rev-parse --absolute-git-dir` (a linked worktree has a `.git` FILE).
 * - `stagedFiles(paths)` runs `ls-files -s -z -- <paths>` and returns `{ path, mode, oid, stage }` per entry.
 * - `commitFiles(paths, message, verify?)` runs `add -- <paths>`, then `diff --cached --name-only -z`, then
 *   `stagedFiles`. A staged entry that is not mode `100644`/`100755` at stage 0 (a symlink, a gitlink, an
 *   unmerged path) gives `stage-mismatch`. The optional `verify(staged)` runs next; a throw stops the commit.
 *   Order: an empty staged set resolves `{ committed: false }` (a no-op); then every staged path must be in
 *   `paths` (a SUBSET check, `/`-separated repo-relative, so an unchanged path is allowed), else it rejects
 *   with `stage-mismatch` and commits nothing. Then `commit -m <commitPrefix + message>`; a non-zero exit
 *   rejects with `git-failed`. On success it resolves `{ committed: true, sha }` from `rev-parse HEAD`.
 *   A commit that times out is judged after its tree is dead: HEAD moved and an empty index resolve
 *   `{ committed: true, sha }`; else it rejects with `timeout`.
 *
 * Module `src/features/amr/SecretScanner.ts` (`@experimental`).
 * - `DEFAULT_SECRET_PATTERNS: readonly { id: string; source: string; flags?: string }[]` holds at least the
 *   ids `aws-access-key` (AKIA and ASIA), `github-token`, `github-pat` (`github_pat_`), `anthropic-key`,
 *   `openai-key` (also `sk-proj-`, `sk-svcacct-`, `sk-admin-`; never an `sk-ant-` key), `slack-token`,
 *   `google-api-key`, `npm-token`, `private-key-block` (also the PGP `PRIVATE KEY BLOCK`). Each pattern is
 *   anchored on a fixed prefix and has no nested repeat.
 * - `loadSecretPatterns(env = process.env)` returns the defaults, or, when `MEMORY_AMR_SECRET_PATTERNS_FILE`
 *   is set, the JSON array in that file (same shape). A file that is unreadable, not an array, an empty
 *   array, has an entry
 *   without a non-empty string `id` or `source`, or has a source that does not compile, THROWS
 *   `ValidationError` (fail loudly; never fall back to the defaults). The flags `g` and `y` are removed.
 *   Add the variable to `ENV_VAR_CATALOG` in `src/cli/commands/diag.ts` and to the CLAUDE.md env tables.
 * - `scanForSecrets(text, patterns?)` returns `{ line: number; patternId: string }[]`, lines from 1, in line
 *   order, then pattern order. A hit never holds the matched text.
 *
 * Module `src/features/amr/AmrWriter.ts` (`@experimental`).
 * - `writeAmrFile(root, relPath, text, { runner, message, patterns? })` resolves
 *   `{ ok: true, committed: boolean, sha?: string }` or `{ ok: false, reason, hits? }`, with `reason` in
 *   `invalid-path` | `not-markdown` | `too-large` | `excluded` | `outside-root` | `secret` | `bad-patterns` |
 *   `not-clean` | `not-root` | `stage-mismatch` | `git-failed` | `io-error`. It never throws.
 * - Calls for the same root (realpath, case-folded on win32) run one at a time in this process. A second
 *   process that holds the index lock gives `git-failed` and the restore.
 * - Order: path rules (the reader's `checkAmrLink` segment rules on `relPath`, hidden segments included;
 *   on win32 also no segment that matches `/~\d/`, as `invalid-path`; `.md` suffix, case-insensitive) ->
 *   size (`too-large` above the reader's `maxFileBytes`, or `maxIndexBytes` for the root `MEMORY.md`) ->
 *   patterns (`opts.patterns`, else `loadSecretPatterns()`; a throw gives `bad-patterns`) -> secret scan of
 *   `relPath` and `message` (hits use line 0) and of `text` -> root check (realpath of `root` must equal
 *   realpath of `runner.root`, else `not-root`) -> `runner.checkClean()` -> confinement: every EXISTING
 *   segment must have exactly its on-disk spelling (a case variant or an 8.3 name gives `invalid-path`);
 *   realpath the deepest EXISTING ancestor of the target and require it inside the root realpath and not
 *   under `.git` or an `ignore` name, BEFORE any `mkdir`; then create the missing folders (each must be a
 *   real folder after `mkdir`) -> write a temp file with a random unique name in `runner.gitDir()` ->
 *   re-check that the parent realpath is unchanged and inside the root -> rename over the target with
 *   `renameOver(tmp, target, { prune: false })` from `src/utils/durableWriteFile.ts` (EXDEV and any other
 *   failure gives `io-error`; only this call's temp file is removed) -> realpath the target; outside the
 *   root, remove the written file and return `outside-root` -> `runner.commitFiles([relPath], message)`.
 * - Staged check: `commitFiles` hands the staged entries to a verify hook. An entry whose blob id equals the
 *   hash of the scanned bytes passes with no read. Any other entry is read with `cat-file -s` (refused above the
 *   same size limit as too-large), then `cat-file blob`, and scanned again with the first scan's patterns. A
 *   hit gives `secret` with its hits. A staged refusal unstages the files and restores the tree as before.
 *   The check does not cover a process that writes the index between the check and `git commit`.
 * - A failure before the rename changes no file. A failure after the rename (commit refused, no identity,
 *   a hook, a timeout) restores the previous bytes (or removes a new file and the folders this call
 *   created), runs `runner.unstage([relPath])`, and returns the failure reason. The tree is then as before
 *   the call.
 *
 * Reader change (`src/features/amr/AmrReader.ts`): `checkAmr(root, opts)` gains `opts.patterns`. Without it,
 * `checkAmr` calls `loadSecretPatterns()`; a throw there becomes ONE issue `{ code: 'bad-patterns', file: '',
 * line: 0 }` and no secret scan (`checkAmr` still never throws). Each hit is an issue
 * `{ code: 'secret', file, line }` whose detail is the pattern id only. Add both codes to the contract
 * header of `AmrReader.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync, realpathSync, appendFileSync, symlinkSync, lstatSync, unlinkSync, promises as fsPromises } from 'node:fs';
import nodeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner, AmrGitError, AMR_GIT_DEFAULTS, type GitRunResult, type StagedFile } from '../../../../src/features/amr/GitRunner.js';
import { DEFAULT_SECRET_PATTERNS, loadSecretPatterns, scanForSecrets } from '../../../../src/features/amr/SecretScanner.js';
import { writeAmrFile, writeAmrFiles, commitAmrEdits } from '../../../../src/features/amr/AmrWriter.js';
import { checkAmr, AMR_READER_DEFAULTS } from '../../../../src/features/amr/AmrReader.js';
import { ValidationError } from '../../../../src/utils/errors.js';

// Secret-shaped fixtures are built at runtime so no key-shaped literal is committed.
const fakeAws = () => 'AKIA' + 'Q'.repeat(16);
const fakeGh = () => 'ghp' + '_' + 'a1'.repeat(18);

let dirs: string[] = [];
function tmp(prefix: string): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/** Host env without any GIT_* variable (a git hook exports GIT_DIR and GIT_INDEX_FILE). */
function cleanHostEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) out[k] = v;
  return out;
}

function rawGit(cwd: string, env: Record<string, string>, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...cleanHostEnv(), ...env }, encoding: 'utf8' });
}

/** A repo with an isolated git config: no system file, a global file the test controls. */
function makeRepo(withIdentity = true, initArgs: string[] = []): { root: string; env: Record<string, string> } {
  const root = tmp('amr-w-');
  const cfg = join(tmp('amr-cfg-'), 'gitconfig');
  writeFileSync(
    cfg,
    withIdentity
      ? '[user]\n\tname = Test\n\temail = test@example.invalid\n'
      : '[user]\n\tuseConfigOnly = true\n', // no guessed identity from the host name or EMAIL
  );
  const env = { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  rawGit(root, env, 'init', '-q', ...initArgs);
  writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n');
  if (withIdentity) {
    rawGit(root, env, 'add', 'MEMORY.md');
    rawGit(root, env, 'commit', '-q', '-m', 'init');
  }
  return { root, env };
}

/**
 * Run a probe in a fresh temp folder at collection time and remove the folder.
 * @returns What the probe returns, or false when it throws.
 */
function probeFs(probe: (dir: string) => boolean): boolean {
  const d = mkdtempSync(join(tmpdir(), 'amr-probe-'));
  try {
    return probe(d);
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/** True when this git can make a repository with sha256 object ids. */
const sha256Supported = probeFs((d) => {
  execFileSync('git', ['init', '-q', '--object-format=sha256', d], { env: cleanHostEnv(), stdio: 'ignore' });
  return true;
});

function makeJunction(link: string, target: string): void {
  if (process.platform === 'win32') execFileSync('cmd', ['/c', 'mklink', '/J', link, target]);
  else execFileSync('ln', ['-s', target, link]);
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('GitRunner', () => {
  it('has one place for defaults', () => {
    expect(AMR_GIT_DEFAULTS).toEqual({ gitBinary: 'git', binaryArgs: [], timeoutMs: 30_000, killGraceMs: 5_000, commitPrefix: 'memory: ', env: {}, maxArgChars: 24_000 });
  });

  it('rejects a relative or empty root', () => {
    expect(() => new GitRunner('')).toThrow(ValidationError);
    expect(() => new GitRunner('rel/dir')).toThrow(ValidationError);
  });

  it.each([[0], [NaN], [-5], [Infinity], [undefined], [2 ** 31]])('timeoutMs and killGraceMs %s give the default', (t) => {
    const r = new GitRunner(tmp('amr-t-'), { timeoutMs: t as number, killGraceMs: t as number });
    expect(r.config.timeoutMs).toBe(30_000);
    expect(r.config.killGraceMs).toBe(5_000);
  });

  it('keeps a timeoutMs of 2^31-1', () => {
    expect(new GitRunner(tmp('amr-t2-'), { timeoutMs: 2 ** 31 - 1 }).config.timeoutMs).toBe(2 ** 31 - 1);
  });

  it.each([
    [['reset', '--hard']],
    [['clean', '-fdx']],
    [['push']],
    [['checkout', '.']],
    [['ls-files']],
    [['add', '-A']],
    [['add', '--all']],
    [['add', '--al']],
    [['add', '-Af']],
    [['add', '-f', 'x.md']],
    [['add', 'x.md']],
    [['add', '--']],
    [['status', '--porcelain', '--ignored']],
    [['status', '--git-dir=/elsewhere']],
    [['status', '-c', 'core.pager=evil']],
    [['diff', '--output=x']],
    [['rev-parse', '--git-path', 'x']],
    [['commit', '--no-verify', '-m', 'x']],
    [['commit', '--no-veri', '-m', 'x']],
    [['commit', '-m', 'x', '--amend']],
    [['commit', '-am', 'x']],
    [['restore', '--', 'x.md']],
    [['restore', '--staged', 'x.md']],
    [['rm', 'x.md']],
    [['rm', '--cached', '--', 'x.md']],
    [['rm', '--cached', '--quiet', '-r', 'x.md']],
    [['rev-parse', '--verify', 'HEAD', '--short']],
    [['status', '--porcelain', '--untracked-files=no']],
    [['status', '--porcelain', '--untracked-files']],
    [['status', '--porcelain', '--untracked-files=normal']],
    [['status', '--porcelain', '-z', '--untracked-files=all', '--ignored']],
    [['status', '--porcelain', '--', 'x.md']],
    [['constructor']],
    [['__proto__']],
    [['toString']],
    [['hasOwnProperty', 'x']],
  ])('refuses %j and spawns nothing', async (args) => {
    const { root, env } = makeRepo();
    const r = new GitRunner(root, { env, gitBinary: join(root, 'no-such-binary') });
    await expect(r.run(args)).rejects.toMatchObject({ code: 'refused' });
  });

  it('treats the commit message as opaque', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    const r = new GitRunner(root, { env });
    expect((await r.run(['add', '--', 'a.md'])).code).toBe(0);
    expect((await r.run(['commit', '-m', '--amend -Af'])).code).toBe(0);
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('--amend -Af');
  });

  it('drops GIT_* from the child env: a GIT_DIR decoy is left unchanged', async () => {
    const { root, env } = makeRepo();
    const decoy = makeRepo();
    const before = rawGit(decoy.root, decoy.env, 'rev-parse', 'HEAD');
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy.root, '.git');
    try {
      writeFileSync(join(root, 'a.md'), '- a\n');
      await new GitRunner(root, { env }).commitFiles(['a.md'], 'add a');
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    expect(rawGit(decoy.root, decoy.env, 'rev-parse', 'HEAD')).toBe(before);
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('memory: add a');
  });

  it('kills a hanging child at timeoutMs', async () => {
    const root = tmp('amr-hang-');
    const script = join(root, 'hang.js');
    writeFileSync(script, 'setTimeout(() => {}, 60_000);\n');
    const r = new GitRunner(root, { gitBinary: process.execPath, binaryArgs: [script], timeoutMs: 300 });
    const t0 = Date.now();
    await expect(r.run(['status'])).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('kills the whole process tree at timeoutMs', async () => {
    const root = tmp('amr-tree-');
    const marker = join(root, 'grandchild-ran');
    const grand = join(root, 'grand.js');
    writeFileSync(grand, `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500);\n`);
    const script = join(root, 'parent.js');
    writeFileSync(
      script,
      `require('child_process').spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'ignore' });\nsetTimeout(() => {}, 60_000);\n`,
    );
    const r = new GitRunner(root, { gitBinary: process.execPath, binaryArgs: [script], timeoutMs: 400 });
    await expect(r.run(['status'])).rejects.toMatchObject({ code: 'timeout' });
    await new Promise((res) => setTimeout(res, 2_500));
    expect(existsSync(marker)).toBe(false);
  });

  it('head is null before the first commit; unstage works there with rm --cached', async () => {
    const { root, env } = makeRepo(false);
    const r = new GitRunner(root, { env });
    expect(await r.head()).toBeNull();
    rawGit(root, env, 'add', 'MEMORY.md');
    await r.unstage(['MEMORY.md']);
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(existsSync(join(root, 'MEMORY.md'))).toBe(true);
  });

  it('allows rm --cached --quiet -- <path> exactly', async () => {
    const { root, env } = makeRepo();
    const r = new GitRunner(root, { env });
    expect((await r.run(['rm', '--cached', '--quiet', '--', 'MEMORY.md'])).code).toBe(0);
    expect(r.root).toBe(root);
  });

  it('allows status --porcelain -z --untracked-files=all and lists a file in a new folder', async () => {
    const { root, env } = makeRepo();
    mkdirSync(join(root, 'notes'));
    writeFileSync(join(root, 'notes', 'a.md'), '- a\n');
    const r = new GitRunner(root, { env });
    const out = await r.run(['status', '--porcelain', '-z', '--untracked-files=all']);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('?? notes/a.md\0');
  });

  it('reports a spawn failure as spawn', async () => {
    const root = tmp('amr-sp-');
    const r = new GitRunner(root, { gitBinary: join(root, 'missing-git') });
    await expect(r.run(['status'])).rejects.toMatchObject({ code: 'spawn' });
  });

  it('checkClean: ok, not-clean, then not-root before not-clean', async () => {
    const { root, env } = makeRepo();
    expect(await new GitRunner(root, { env }).checkClean()).toEqual({ ok: true });
    writeFileSync(join(root, 'stray.md'), '- x\n');
    expect(await new GitRunner(root, { env }).checkClean()).toMatchObject({ ok: false, code: 'not-clean' });
    mkdirSync(join(root, 'sub'));
    expect(await new GitRunner(join(root, 'sub'), { env }).checkClean()).toMatchObject({ ok: false, code: 'not-root' });
  });

  it('gitDir follows a linked worktree (.git is a file there)', async () => {
    const { root, env } = makeRepo();
    const wt = join(tmp('amr-wt-'), 'wt');
    rawGit(root, env, 'worktree', 'add', '-q', wt);
    const g = await new GitRunner(wt, { env }).gitDir();
    expect(g).toBe(realpathSync.native(join(root, '.git', 'worktrees', 'wt')));
  });

  it('commitFiles: nothing staged is a no-op', async () => {
    const { root, env } = makeRepo();
    expect(await new GitRunner(root, { env }).commitFiles(['MEMORY.md'], 'noop')).toEqual({ committed: false });
  });

  it('commitFiles: an unchanged path in the set is allowed (subset)', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    const res = await new GitRunner(root, { env }).commitFiles(['a.md', 'MEMORY.md'], 'x');
    expect(res.committed).toBe(true);
  });

  it('commitFiles: a pre-staged extra file is refused', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    writeFileSync(join(root, 'b.md'), '- b\n');
    rawGit(root, env, 'add', 'b.md');
    await expect(new GitRunner(root, { env }).commitFiles(['a.md'], 'x')).rejects.toMatchObject({ code: 'stage-mismatch' });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitFiles: a missing identity fails as git-failed', async () => {
    const { root, env } = makeRepo(false);
    await expect(new GitRunner(root, { env }).commitFiles(['MEMORY.md'], 'x')).rejects.toMatchObject({ code: 'git-failed' });
  });

  it('commitFiles: returns the new sha', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    const res = await new GitRunner(root, { env }).commitFiles(['a.md'], 'add a');
    expect(res.committed).toBe(true);
    expect(res.sha).toBe(rawGit(root, env, 'rev-parse', 'HEAD').trim());
  });

  it('AmrGitError is an Error with a code', () => {
    const e = new AmrGitError('refused', 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('refused');
  });
});

describe('SecretScanner', () => {
  it('ships the default pattern ids', () => {
    const ids = DEFAULT_SECRET_PATTERNS.map((p) => p.id);
    for (const id of ['aws-access-key', 'github-token', 'anthropic-key', 'openai-key', 'slack-token', 'google-api-key', 'npm-token', 'private-key-block']) {
      expect(ids).toContain(id);
    }
  });

  it('reports line and pattern id, never the matched text', () => {
    const text = `- ok\n- key ${fakeAws()}\n- fine\n- token ${fakeGh()}\n`;
    const hits = scanForSecrets(text);
    expect(hits).toEqual([
      { line: 2, patternId: 'aws-access-key' },
      { line: 4, patternId: 'github-token' },
    ]);
    expect(JSON.stringify(hits)).not.toContain(fakeAws());
  });

  it('finds a private key block header', () => {
    const hdr = '-----BEGIN ' + 'RSA PRIVATE KEY' + '-----';
    expect(scanForSecrets(`x\n${hdr}\n`)).toEqual([{ line: 2, patternId: 'private-key-block' }]);
  });

  it('gives nothing for plain prose', () => {
    expect(scanForSecrets('- The user prefers tabs.\n- AKIA is a prefix.\n')).toEqual([]);
  });

  it('loads an override file and drops the g and y flags', () => {
    const f = join(tmp('amr-pat-'), 'p.json');
    writeFileSync(f, JSON.stringify([{ id: 'custom', source: 'zz-[0-9]{4}', flags: 'gy' }]));
    const pats = loadSecretPatterns({ MEMORY_AMR_SECRET_PATTERNS_FILE: f });
    expect(pats.map((p) => p.id)).toEqual(['custom']);
    // With a kept g flag, lastIndex would carry over and miss the hit on line 3.
    expect(scanForSecrets('zz-1111\nx\nzz-2222\n', pats)).toEqual([
      { line: 1, patternId: 'custom' },
      { line: 3, patternId: 'custom' },
    ]);
  });

  it.each([
    ['missing file', null],
    ['not an array', '{"not":"an array"}'],
    ['entry without id', '[{"source":"a"}]'],
    ['entry with empty source', '[{"id":"x","source":""}]'],
    ['source that does not compile', '[{"id":"x","source":"(["}]'],
    ['empty list', '[]'],
  ])('fails loudly on %s', (_name, body) => {
    const f = join(tmp('amr-pat2-'), 'p.json');
    if (body !== null) writeFileSync(f, body);
    expect(() => loadSecretPatterns({ MEMORY_AMR_SECRET_PATTERNS_FILE: f })).toThrow(ValidationError);
  });

  it('finds the newer key formats and keeps one id per key', () => {
    const cases: [string, string][] = [
      ['sk-' + 'proj-' + 'Ab_-'.repeat(25), 'openai-key'],
      ['sk-' + 'svcacct-' + 'x'.repeat(40), 'openai-key'],
      ['github' + '_pat_' + 'A1_'.repeat(28), 'github-pat'],
      ['AS' + 'IA' + 'Q'.repeat(16), 'aws-access-key'],
      ['-----BEGIN ' + 'PGP PRIVATE KEY BLOCK' + '-----', 'private-key-block'],
      ['sk-' + 'ant-' + 'a'.repeat(40), 'anthropic-key'],
    ];
    for (const [line, id] of cases) expect(scanForSecrets(line)).toEqual([{ line: 1, patternId: id }]);
    expect(scanForSecrets('- risk-assessment-for-the-team-this-quarter-2026\n')).toEqual([]);
  });

  it('runs in linear time on a long adversarial line', () => {
    const t0 = Date.now();
    scanForSecrets('sk-'.repeat(300_000) + '-----BEGIN '.repeat(100_000));
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('returns the defaults when the variable is unset', () => {
    expect(loadSecretPatterns({})).toEqual(DEFAULT_SECRET_PATTERNS);
  });
});

describe('writeAmrFile', () => {
  it('writes, commits with the prefix and leaves the tree clean', async () => {
    const { root, env } = makeRepo();
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'add a' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(readFileSync(join(root, 'notes', 'a.md'), 'utf8')).toBe('- a\n');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('memory: add a');
  });

  it('blocks a secret-shaped line and changes no file', async () => {
    const { root, env } = makeRepo();
    const res = await writeAmrFile(root, 'MEMORY.md', `- key ${fakeAws()}\n`, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toEqual({ ok: false, reason: 'secret', hits: [{ line: 1, patternId: 'aws-access-key' }] });
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n- fact\n');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it.each([
    ['a.txt', 'not-markdown'],
    ['../x.md', 'invalid-path'],
    ['a.md:hidden', 'invalid-path'],
    ['C:/x.md', 'invalid-path'],
    ['.git/x.md', 'invalid-path'],
  ])('refuses %s as %s', async (rel, reason) => {
    const { root, env } = makeRepo();
    const res = await writeAmrFile(root, rel, '- x\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason });
  });

  it('refuses a dirty tree before any write', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'stray.md'), '- s\n');
    const res = await writeAmrFile(root, 'a.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'not-clean' });
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });

  it.each([['out/x.md'], ['out/new/x.md']])('refuses %s below a junction out of the root, and creates nothing outside', async (rel) => {
    const { root, env } = makeRepo();
    const outside = tmp('amr-out-');
    makeJunction(join(root, 'out'), outside);
    appendFileSync(join(root, '.git', 'info', 'exclude'), '\nout\n'); // the tree stays clean
    const res = await writeAmrFile(root, rel, '- x\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'outside-root' });
    expect(readdirSync(outside)).toEqual([]);
  });

  it('restores the file and the index when the commit fails after the rename', async () => {
    const { root, env } = makeRepo();
    // Remove the identity after the initial commit; useConfigOnly stops a guessed identity.
    writeFileSync(env.GIT_CONFIG_GLOBAL, '[user]\n\tuseConfigOnly = true\n');
    const runner = new GitRunner(root, { env });
    const edit = await writeAmrFile(root, 'MEMORY.md', '# Memory\n\n- changed\n', { runner, message: 'x' });
    expect(edit).toMatchObject({ ok: false, reason: 'git-failed' });
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n- fact\n');
    const created = await writeAmrFile(root, 'deep/new/a.md', '- a\n', { runner, message: 'x' });
    expect(created).toMatchObject({ ok: false, reason: 'git-failed' });
    expect(existsSync(join(root, 'deep'))).toBe(false);
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('leaves no temp file behind in the git dir', async () => {
    const { root, env } = makeRepo();
    const before = readdirSync(join(root, '.git')).sort();
    await writeAmrFile(root, 'a.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(readdirSync(join(root, '.git')).filter((n) => !before.includes(n) && !['COMMIT_EDITMSG', 'ORIG_HEAD'].includes(n))).toEqual([]);
  });

  it('a hook that outlives the timeout: git-failed, the tree as before, and no late commit', async () => {
    const { root, env } = makeRepo();
    const hook = join(root, '.git', 'hooks', 'commit-msg');
    writeFileSync(hook, '#!/bin/sh\nsleep 4\n', { mode: 0o755 });
    const head = rawGit(root, env, 'rev-parse', 'HEAD');
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner: new GitRunner(root, { env, timeoutMs: 600 }), message: 'slow' });
    expect(res).toMatchObject({ ok: false, reason: 'git-failed' });
    await new Promise((r) => setTimeout(r, 5_000));
    expect(rawGit(root, env, 'rev-parse', 'HEAD')).toBe(head);
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(root, 'notes'))).toBe(false);
  }, 20_000);

  it('serializes concurrent writes to one root', async () => {
    const { root, env } = makeRepo();
    const runner = new GitRunner(root, { env });
    // Each write runs about 8 git processes, and the writes run one at a time. Three writes prove
    // the queue; more only add process-start time, which exceeded the timeout under full-suite load.
    const many = await Promise.all(
      [0, 1, 2].map((i) => writeAmrFile(root, `n${i}.md`, `- ${i}\n`, { runner, message: `w${i}` })),
    );
    expect(many.every((r) => r.ok && r.committed)).toBe(true);
    const same = await Promise.all(['A', 'B'].map((x) => writeAmrFile(root, 'a.md', `- ${x}\n`, { runner, message: x })));
    // Both commit; the order is not part of the contract. HEAD and the disk must agree.
    expect(same.every((r) => r.ok && r.committed)).toBe(true);
    const last = rawGit(root, env, 'show', 'HEAD:a.md');
    expect(['- A\n', '- B\n']).toContain(last);
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe(last);
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  describe('a case variant of an existing segment', () => {
    // `runIf` reads its flag when the tests are collected, before any `beforeAll`, so the probe runs here.
    const caseInsensitive = probeFs((d) => {
      writeFileSync(join(d, 'Probe'), '');
      return existsSync(join(d, 'probe'));
    });

    function notesRepo(): { root: string; env: Record<string, string>; runner: GitRunner } {
      const { root, env } = makeRepo();
      mkdirSync(join(root, 'Notes'));
      writeFileSync(join(root, 'Notes', 'A.md'), '- a\n');
      rawGit(root, env, 'add', '--', 'Notes/A.md');
      rawGit(root, env, 'commit', '-q', '-m', 'a');
      return { root, env, runner: new GitRunner(root, { env }) };
    }

    it.runIf(caseInsensitive)('is refused as invalid-path on a case-insensitive file system', async () => {
      const { root, env, runner } = notesRepo();
      for (const rel of ['Notes/a.md', 'notes/A.md', 'notes/b.md']) {
        const res = await writeAmrFile(root, rel, '- new\n', { runner, message: 'x' });
        expect(res, rel).toMatchObject({ ok: false, reason: 'invalid-path' });
      }
      expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
      expect(readdirSync(join(root, 'Notes'))).toEqual(['A.md']);
    });

    it.runIf(!caseInsensitive)('is a new folder on a case-sensitive file system', async () => {
      const { root, env, runner } = notesRepo();
      const res = await writeAmrFile(root, 'notes/b.md', '- new\n', { runner, message: 'x' });
      expect(res).toMatchObject({ ok: true, committed: true });
      expect(readdirSync(root)).toEqual(expect.arrayContaining(['Notes', 'notes']));
      expect(rawGit(root, env, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('notes/b.md');
      expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
    });
  });

  it.skipIf(process.platform !== 'win32')('refuses an 8.3-shaped segment on win32', async () => {
    const { root, env } = makeRepo();
    const res = await writeAmrFile(root, 'LONGDI~1/b.md', '- b\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-path' });
  });

  it('a failed first commit in a new repo leaves the index empty', async () => {
    const { root, env } = makeRepo(false);
    rmSync(join(root, 'MEMORY.md'));
    const res = await writeAmrFile(root, 'sub/dir/MEMORY.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'git-failed' });
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(root, 'sub'))).toBe(false);
  });

  it('refuses a folder swapped for a junction between the check and the rename', async () => {
    const { root, env } = makeRepo();
    const outside = tmp('amr-swap-');
    const realWrite = fsPromises.writeFile;
    const spy = vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (...args: Parameters<typeof realWrite>) => {
      await realWrite(...args);
      if (String(args[0]).endsWith('.tmp')) {
        rmSync(join(root, 'newdir'), { recursive: true, force: true });
        makeJunction(join(root, 'newdir'), outside);
      }
    });
    try {
      const res = await writeAmrFile(root, 'newdir/a.md', '- payload\n', { runner: new GitRunner(root, { env }), message: 'x' });
      expect(res).toMatchObject({ ok: false, reason: 'outside-root' });
    } finally {
      spy.mockRestore();
    }
    expect(readdirSync(outside)).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')('a failed rename removes only its own temp file', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- old\n');
    writeFileSync(join(root, 'a.md.tmp.keep'), '- keep\n');
    rawGit(root, env, 'add', '--', 'a.md', 'a.md.tmp.keep');
    rawGit(root, env, 'commit', '-q', '-m', 'k');
    const before = readdirSync(join(root, '.git')).sort();
    const spy = vi.spyOn(fsPromises, 'rename').mockRejectedValue(Object.assign(new Error('locked'), { code: 'EPERM' }));
    let res;
    try {
      res = await writeAmrFile(root, 'a.md', '- new\n', { runner: new GitRunner(root, { env }), message: 'x' });
    } finally {
      spy.mockRestore();
    }
    expect(res).toMatchObject({ ok: false, reason: 'io-error' });
    expect(readFileSync(join(root, 'a.md.tmp.keep'), 'utf8')).toBe('- keep\n');
    expect(readdirSync(join(root, '.git')).filter((n) => !before.includes(n))).toEqual([]);
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('scans the commit message and the path (line 0)', async () => {
    const { root, env } = makeRepo();
    const runner = new GitRunner(root, { env });
    expect(await writeAmrFile(root, 'a.md', '- a\n', { runner, message: `rotate ${fakeAws()}` })).toEqual({
      ok: false,
      reason: 'secret',
      hits: [{ line: 0, patternId: 'aws-access-key' }],
    });
    expect(await writeAmrFile(root, `${fakeAws()}.md`, '- a\n', { runner, message: 'x' })).toEqual({
      ok: false,
      reason: 'secret',
      hits: [{ line: 0, patternId: 'aws-access-key' }],
    });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('refuses a root that is not the runner root as not-root', async () => {
    const { root, env } = makeRepo();
    mkdirSync(join(root, 'sub'));
    const res = await writeAmrFile(join(root, 'sub'), 'a.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'not-root' });
    expect(existsSync(join(root, 'sub', 'a.md'))).toBe(false);
  });

  it('refuses text that the reader would not read as too-large', async () => {
    const { root, env } = makeRepo();
    const runner = new GitRunner(root, { env });
    const big = '- x\n'.repeat(AMR_READER_DEFAULTS.maxFileBytes / 4 + 1);
    expect(await writeAmrFile(root, 'big.md', big, { runner, message: 'x' })).toMatchObject({ ok: false, reason: 'too-large' });
    const index = '- x\n'.repeat(AMR_READER_DEFAULTS.maxIndexBytes / 4 + 1);
    expect(await writeAmrFile(root, 'MEMORY.md', index, { runner, message: 'x' })).toMatchObject({ ok: false, reason: 'too-large' });
    expect(await writeAmrFile(root, '.hidden/a.md', '- a\n', { runner, message: 'x' })).toMatchObject({ ok: false, reason: 'invalid-path' });
    expect(await writeAmrFile(root, 'node_modules/a.md', '- a\n', { runner, message: 'x' })).toMatchObject({ ok: false, reason: 'excluded' });
  });

  it('returns bad-patterns for a bad override file and does not throw', async () => {
    const { root, env } = makeRepo();
    const saved = process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
    process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = join(root, 'none.json');
    try {
      const res = await writeAmrFile(root, 'a.md', '- a\n', { runner: new GitRunner(root, { env }), message: 'x' });
      expect(res).toEqual({ ok: false, reason: 'bad-patterns' });
    } finally {
      if (saved === undefined) delete process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
      else process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = saved;
    }
  });
});

describe('checkAmr secret issues', () => {
  it('reports a secret-pattern hit with file and line, never the text', async () => {
    const root = tmp('amr-cs-');
    writeFileSync(join(root, 'MEMORY.md'), `# M\n\n- ok\n- ${fakeGh()}\n`);
    const rep = await checkAmr(root);
    expect(rep.issues).toContainEqual(expect.objectContaining({ code: 'secret', file: 'MEMORY.md', line: 4 }));
    expect(JSON.stringify(rep)).not.toContain(fakeGh());
  });

  it('takes patterns as an option', async () => {
    const root = tmp('amr-cs2-');
    writeFileSync(join(root, 'MEMORY.md'), '# M\n\n- zz-1234\n');
    const rep = await checkAmr(root, { patterns: [{ id: 'custom', source: 'zz-[0-9]{4}' }] });
    expect(rep.issues).toContainEqual(expect.objectContaining({ code: 'secret', file: 'MEMORY.md', line: 3 }));
  });

  it('reports a bad override file as one bad-patterns issue and does not throw', async () => {
    const root = tmp('amr-cs3-');
    writeFileSync(join(root, 'MEMORY.md'), '# M\n\n- ok\n');
    const saved = process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
    process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = join(root, 'none.json');
    try {
      const rep = await checkAmr(root);
      expect(rep.issues.filter((i) => i.code === 'bad-patterns')).toEqual([expect.objectContaining({ code: 'bad-patterns', file: '', line: 0 })]);
    } finally {
      if (saved === undefined) delete process.env.MEMORY_AMR_SECRET_PATTERNS_FILE;
      else process.env.MEMORY_AMR_SECRET_PATTERNS_FILE = saved;
    }
  });
});

describe('commitAmrEdits', () => {
  it('commits a hand-edited .md file with one commit and a clean tree', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'edit memory' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('memory: edit memory');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('commits a new .md file in a new folder', async () => {
    const { root, env } = makeRepo();
    mkdirSync(join(root, 'notes', 'deep'), { recursive: true });
    writeFileSync(join(root, 'notes', 'deep', 'a.md'), '- a\n');
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'add note' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(rawGit(root, env, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('notes/deep/a.md');
  });

  it('refuses a changed .txt and stages nothing', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
    writeFileSync(join(root, 'note.txt'), 'plain\n');
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toEqual({ ok: false, reason: 'not-markdown', path: 'note.txt' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('refuses a file that holds a secret and stages nothing', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), `# Memory\n\n- key ${fakeAws()}\n`);
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'secret', path: 'MEMORY.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('refuses a secret in the commit message', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: `token ${fakeGh()}` });
    expect(res).toMatchObject({ ok: false, reason: 'secret' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('refuses a deletion and stages nothing', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'old.md'), '- old\n');
    rawGit(root, env, 'add', 'old.md');
    rawGit(root, env, 'commit', '-q', '-m', 'add old');
    rmSync(join(root, 'old.md'));
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-path', path: 'old.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('refuses a rename and stages nothing', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'old.md'), '- old\n');
    rawGit(root, env, 'add', 'old.md');
    rawGit(root, env, 'commit', '-q', '-m', 'add old');
    rawGit(root, env, 'mv', 'old.md', 'new.md');
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-path', path: 'new.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-status').trim()).toMatch(/^R\d*\told\.md\tnew\.md$/);
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('add old');
  });

  it('refuses a root that is a subfolder of the repository', async () => {
    const { root, env } = makeRepo();
    const sub = join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'a.md'), '- a\n');
    const res = await commitAmrEdits(sub, { runner: new GitRunner(sub, { env }), message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'not-root' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('is a no-op on a clean tree', async () => {
    const { root, env } = makeRepo();
    const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
    expect(res).toEqual({ ok: true, committed: false });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  /** Install a pre-commit hook that always fails. */
  function failingHook(root: string, env: Record<string, string>): void {
    const hooks = tmp('amr-hooks-');
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    rawGit(root, env, 'config', 'core.hooksPath', hooks);
  }

  const head = (root: string, env: Record<string, string>) => rawGit(root, env, 'rev-parse', 'HEAD').trim();
  const run = (root: string, env: Record<string, string>, message = 'x') =>
    commitAmrEdits(root, { runner: new GitRunner(root, { env }), message });

  it('refuses a staged change that is edited again (MM) and keeps the staged text', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- X staged\n');
    rawGit(root, env, 'add', 'MEMORY.md');
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- Y worktree\n');
    const before = head(root, env);
    const res = await run(root, env);
    expect(res).toEqual({ ok: false, reason: 'not-clean', path: 'MEMORY.md' });
    expect(rawGit(root, env, 'diff', '--cached')).toContain('+- X staged');
    expect(head(root, env)).toBe(before);
  });

  it('refuses a staged new file that is edited again (AM) and keeps it staged', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'new.md'), '- one\n');
    rawGit(root, env, 'add', 'new.md');
    writeFileSync(join(root, 'new.md'), '- two\n');
    const res = await run(root, env);
    expect(res).toEqual({ ok: false, reason: 'not-clean', path: 'new.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('new.md');
  });

  it('still commits a staged .md with no later edit (M )', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- staged only\n');
    rawGit(root, env, 'add', 'MEMORY.md');
    const res = await run(root, env, 'staged');
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('refuses a both-added merge conflict (AA) and commits no conflict markers', async () => {
    const { root, env } = makeRepo();
    const main = rawGit(root, env, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    rawGit(root, env, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(root, 'c.md'), '- side\n');
    rawGit(root, env, 'add', 'c.md');
    rawGit(root, env, 'commit', '-q', '-m', 'side');
    rawGit(root, env, 'checkout', '-q', main);
    writeFileSync(join(root, 'c.md'), '- main\n');
    rawGit(root, env, 'add', 'c.md');
    rawGit(root, env, 'commit', '-q', '-m', 'main');
    expect(() => rawGit(root, env, 'merge', '-q', 'side')).toThrow();
    const before = head(root, env);
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: false, reason: 'not-clean', path: 'c.md' });
    expect(head(root, env)).toBe(before);
  });

  it('a failing commit hook with an unstaged edit gives git-failed and leaves the index at HEAD', async () => {
    const { root, env } = makeRepo();
    failingHook(root, env);
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- edit\n');
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: false, reason: 'git-failed' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('a failing commit hook with a staged-only edit keeps the worktree text (the stage bit is lost)', async () => {
    const { root, env } = makeRepo();
    failingHook(root, env);
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- staged\n');
    rawGit(root, env, 'add', 'MEMORY.md');
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: false, reason: 'git-failed' });
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n- staged\n');
  });

  it('refuses an untracked .md above the file size limit as too-large without reading it', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'big.md'), Buffer.alloc(AMR_READER_DEFAULTS.maxFileBytes + 1, 0x61));
    const spy = vi.spyOn(fsPromises, 'readFile');
    try {
      const res = await run(root, env);
      expect(res).toEqual({ ok: false, reason: 'too-large', path: 'big.md' });
      expect(spy.mock.calls.some((c) => String(c[0]).endsWith('big.md'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a MEMORY.md above the index size limit as too-large', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'MEMORY.md'), Buffer.alloc(AMR_READER_DEFAULTS.maxIndexBytes + 1, 0x61));
    const res = await run(root, env);
    expect(res).toEqual({ ok: false, reason: 'too-large', path: 'MEMORY.md' });
  });

  it.each([['UPPER.MD'], ['with space.md'], ['naïve-é.md']])('commits %s', async (name) => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, name), '- x\n');
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('refuses a symlinked .md as outside-root and stages nothing', async (t) => {
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'true');
    const outside = join(tmp('amr-out-'), 'outside.md');
    writeFileSync(outside, '- outside\n');
    try {
      symlinkSync(outside, join(root, 'link.md'), 'file');
    } catch {
      t.skip();
      return;
    }
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: false, reason: 'outside-root', path: 'link.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it.skipIf(process.platform === 'win32').each([['q"uote.md'], ['new\nline.md']])('refuses %j as invalid-path', async (name) => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, name), '- x\n');
    const res = await run(root, env);
    expect(res).toMatchObject({ ok: false, reason: 'invalid-path' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('refuses a pre-staged non-.md as not-markdown and leaves the index untouched', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.txt'), 'plain\n');
    rawGit(root, env, 'add', 'a.txt');
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- more\n');
    const res = await run(root, env);
    expect(res).toEqual({ ok: false, reason: 'not-markdown', path: 'a.txt' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('a.txt');
  });
});

/** True when this host can create a file symlink. */
function canSymlink(): boolean {
  const dir = tmp('amr-probe-');
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  }
}

/** True when a path exists as a link or a file, without following a link. */
function linkExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Runner that changes the worktree right before its first `add`, the window that the scan cannot see. */
class RacingRunner extends GitRunner {
  /** Subcommand pairs of every call, in order. */
  readonly calls: string[] = [];
  private readonly race: () => void;
  private fired = false;

  constructor(root: string, env: Record<string, string>, race: () => void) {
    super(root, { env });
    this.race = race;
  }

  override run(args: readonly string[]): Promise<GitRunResult> {
    this.calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'add' && !this.fired) {
      this.fired = true;
      this.race();
    }
    return super.run(args);
  }
}

describe('staged-content check: the gap between the scan and git add', () => {
  it('writeAmrFile refuses a secret appended after the scan and before git add', async () => {
    const { root, env } = makeRepo();
    const head = rawGit(root, env, 'rev-parse', 'HEAD');
    const runner = new RacingRunner(root, env, () => appendFileSync(join(root, 'notes', 'a.md'), `- key ${fakeAws()}\n`));
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner, message: 'add a' });
    expect(res).toEqual({ ok: false, reason: 'secret', hits: [{ line: 2, patternId: 'aws-access-key' }] });
    expect(linkExists(join(root, 'notes'))).toBe(false);
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
    expect(rawGit(root, env, 'rev-parse', 'HEAD')).toBe(head);
    expect(runner.calls).toContain('cat-file -s');
  });

  it('writeAmrFile refuses a file that grows past the size limit after the scan as too-large', async () => {
    const { root, env } = makeRepo();
    const head = rawGit(root, env, 'rev-parse', 'HEAD');
    const runner = new RacingRunner(root, env, () =>
      appendFileSync(join(root, 'notes', 'a.md'), 'a'.repeat(AMR_READER_DEFAULTS.maxFileBytes)),
    );
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner, message: 'add a' });
    expect(res).toEqual({ ok: false, reason: 'too-large' });
    expect(runner.calls).toContain('cat-file -s');
    expect(runner.calls).not.toContain('cat-file blob');
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('writeAmrFile reads the real blob, not a replace ref that points at clean bytes', async () => {
    const { root, env } = makeRepo();
    const clean = join(tmp('amr-clean-'), 'clean.md');
    writeFileSync(clean, '- a\n');
    const runner = new RacingRunner(root, env, () => {
      const file = join(root, 'notes', 'a.md');
      appendFileSync(file, `- key ${fakeAws()}\n`);
      const secretOid = rawGit(root, env, 'hash-object', '-w', '--', file).trim();
      const cleanOid = rawGit(root, env, 'hash-object', '-w', '--', clean).trim();
      rawGit(root, env, 'replace', secretOid, cleanOid);
    });
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner, message: 'add a' });
    expect(res).toMatchObject({ ok: false, reason: 'secret' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it.skipIf(!sha256Supported)('a sha256 repository: a match makes no cat-file call', async () => {
    const { root, env } = makeRepo(true, ['--object-format=sha256']);
    const runner = new RacingRunner(root, env, () => undefined);
    const res = await writeAmrFile(root, 'a.md', '- a\n', { runner, message: 'a' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(rawGit(root, env, 'rev-parse', 'HEAD').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(runner.calls.some((c) => c.startsWith('cat-file'))).toBe(false);
  });

  it.skipIf(!sha256Supported)('a sha256 repository: a change after the scan takes the rescan path', async () => {
    const { root, env } = makeRepo(true, ['--object-format=sha256']);
    const runner = new RacingRunner(root, env, () => appendFileSync(join(root, 'a.md'), `- key ${fakeAws()}\n`));
    const res = await writeAmrFile(root, 'a.md', '- a\n', { runner, message: 'a' });
    expect(res).toMatchObject({ ok: false, reason: 'secret' });
    expect(runner.calls).toEqual(expect.arrayContaining(['cat-file -s', 'cat-file blob']));
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('writeAmrFile with core.symlinks=false refuses a new file swapped for a symlink as stage-mismatch', async (t) => {
    if (!canSymlink()) return t.skip();
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'false');
    const outside = join(tmp('amr-out-'), 'outside.md');
    writeFileSync(outside, '- outside\n');
    const runner = new RacingRunner(root, env, () => {
      unlinkSync(join(root, 'notes', 'a.md'));
      symlinkSync(outside, join(root, 'notes', 'a.md'), 'file');
    });
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner, message: 'add a' });
    expect(res).toMatchObject({ ok: false, reason: 'stage-mismatch' });
    expect(readFileSync(outside, 'utf8')).toBe('- outside\n');
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitAmrEdits with core.symlinks=false refuses a file swapped for a symlink as stage-mismatch', async (t) => {
    if (!canSymlink()) return t.skip();
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'false');
    const outside = join(tmp('amr-out-'), 'outside.md');
    writeFileSync(outside, '- outside\n');
    writeFileSync(join(root, 'c.md'), '- c\n');
    const runner = new RacingRunner(root, env, () => {
      unlinkSync(join(root, 'c.md'));
      symlinkSync(outside, join(root, 'c.md'), 'file');
    });
    const res = await commitAmrEdits(root, { runner, message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'stage-mismatch' });
    expect(readFileSync(outside, 'utf8')).toBe('- outside\n');
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitAmrEdits refuses a CRLF file with a secret that core.autocrlf stores as LF', async () => {
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.autocrlf', 'true');
    const runner = new RacingRunner(root, env, () => appendFileSync(join(root, 'crlf.md'), `- key ${fakeAws()}\r\n`));
    writeFileSync(join(root, 'crlf.md'), '- a\r\n- b\r\n');
    const res = await commitAmrEdits(root, { runner, message: 'crlf' });
    expect(res).toMatchObject({ ok: false, reason: 'secret', path: 'crlf.md' });
    expect(runner.calls).toEqual(expect.arrayContaining(['cat-file -s', 'cat-file blob']));
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitAmrEdits loads the secret patterns once per call', async () => {
    const { root, env } = makeRepo();
    const file = join(tmp('amr-pat-'), 'patterns.json');
    writeFileSync(file, JSON.stringify([{ id: 'p', source: 'NEVERMATCH[0-9]{9}' }]));
    vi.stubEnv('MEMORY_AMR_SECRET_PATTERNS_FILE', file);
    writeFileSync(join(root, 'a.md'), '- a\n');
    writeFileSync(join(root, 'b.md'), '- b\n');
    const spy = vi.spyOn(nodeFs, 'readFileSync');
    syncBuiltinESMExports();
    try {
      const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
      expect(res).toMatchObject({ ok: true, committed: true });
      expect(spy.mock.calls.filter((c) => c[0] === file)).toHaveLength(1);
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
      vi.unstubAllEnvs();
    }
  });

  it('writeAmrFiles loads the secret patterns once per call', async () => {
    const { root, env } = makeRepo();
    const file = join(tmp('amr-pat-'), 'patterns.json');
    writeFileSync(file, JSON.stringify([{ id: 'p', source: 'NEVERMATCH[0-9]{9}' }]));
    vi.stubEnv('MEMORY_AMR_SECRET_PATTERNS_FILE', file);
    const spy = vi.spyOn(nodeFs, 'readFileSync');
    syncBuiltinESMExports();
    try {
      const res = await writeAmrFiles(
        root,
        [
          { path: 'a.md', text: '- a\n' },
          { path: 'b.md', text: '- b\n' },
        ],
        { runner: new GitRunner(root, { env }), message: 'x' },
      );
      expect(res).toMatchObject({ ok: true, committed: true });
      expect(spy.mock.calls.filter((c) => c[0] === file)).toHaveLength(1);
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
      vi.unstubAllEnvs();
    }
  });

  it('commitAmrEdits gives bad-patterns with no path for a bad patterns file, and stages nothing', async () => {
    const { root, env } = makeRepo();
    vi.stubEnv('MEMORY_AMR_SECRET_PATTERNS_FILE', join(root, 'none.json'));
    try {
      writeFileSync(join(root, 'a.md'), '- a\n');
      writeFileSync(join(root, 'b.md'), '- b\n');
      const res = await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' });
      expect(res).toEqual({ ok: false, reason: 'bad-patterns' });
      expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
      rmSync(join(root, 'a.md'));
      rmSync(join(root, 'b.md'));
      expect(await commitAmrEdits(root, { runner: new GitRunner(root, { env }), message: 'x' })).toEqual({ ok: true, committed: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('writeAmrFile refuses a new file swapped for a symlink before git add and removes the link', async (t) => {
    if (!canSymlink()) return t.skip();
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'true');
    const outside = join(tmp('amr-out-'), 'outside.md');
    writeFileSync(outside, '- outside\n');
    const runner = new RacingRunner(root, env, () => {
      unlinkSync(join(root, 'notes', 'a.md'));
      symlinkSync(outside, join(root, 'notes', 'a.md'), 'file');
    });
    const res = await writeAmrFile(root, 'notes/a.md', '- a\n', { runner, message: 'add a' });
    expect(res).toMatchObject({ ok: false, reason: 'stage-mismatch' });
    expect(readFileSync(outside, 'utf8')).toBe('- outside\n');
    expect(linkExists(join(root, 'notes', 'a.md'))).toBe(false);
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('writeAmrFile restores the previous bytes of an existing file after a secret is appended before git add', async () => {
    const { root, env } = makeRepo();
    const runner = new RacingRunner(root, env, () => appendFileSync(join(root, 'MEMORY.md'), `- key ${fakeAws()}\n`));
    const res = await writeAmrFile(root, 'MEMORY.md', '# Memory\n\n- fact\n- more\n', { runner, message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'secret' });
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n- fact\n');
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'status', '--porcelain')).toBe('');
  });

  it('writeAmrFile needs no cat-file call when the staged bytes equal the scanned bytes', async () => {
    const { root, env } = makeRepo();
    const runner = new RacingRunner(root, env, () => undefined);
    const res = await writeAmrFile(root, 'a.md', '- a\n', { runner, message: 'a' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(runner.calls.some((c) => c.startsWith('cat-file'))).toBe(false);
  });

  it('commitAmrEdits refuses a secret appended after the scan and stages nothing', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'b.md'), '- b\n');
    const runner = new RacingRunner(root, env, () => appendFileSync(join(root, 'b.md'), `- key ${fakeAws()}\n`));
    const res = await commitAmrEdits(root, { runner, message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'secret', path: 'b.md' });
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitAmrEdits refuses a file swapped for a symlink after the scan and stages nothing', async (t) => {
    if (!canSymlink()) return t.skip();
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'true');
    const outside = join(tmp('amr-out-'), 'outside.md');
    writeFileSync(outside, '- outside\n');
    writeFileSync(join(root, 'c.md'), '- c\n');
    const runner = new RacingRunner(root, env, () => {
      unlinkSync(join(root, 'c.md'));
      symlinkSync(outside, join(root, 'c.md'), 'file');
    });
    const res = await commitAmrEdits(root, { runner, message: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'stage-mismatch' });
    expect(readFileSync(outside, 'utf8')).toBe('- outside\n');
    expect(rawGit(root, env, 'diff', '--cached', '--name-only')).toBe('');
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitAmrEdits commits a CRLF file that core.autocrlf stores as LF, through the blob rescan', async () => {
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.autocrlf', 'true');
    writeFileSync(join(root, 'crlf.md'), '- a\r\n- b\r\n');
    const runner = new RacingRunner(root, env, () => undefined);
    const res = await commitAmrEdits(root, { runner, message: 'crlf' });
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(runner.calls).toEqual(expect.arrayContaining(['cat-file -s', 'cat-file blob']));
    expect(rawGit(root, env, 'show', 'HEAD:crlf.md')).toBe('- a\n- b\n');
  });
});

describe('GitRunner staged-content commands', () => {
  const OID = 'a'.repeat(40);

  it.each([
    ['cat-file -p', ['cat-file', '-p', OID]],
    ['cat-file --textconv', ['cat-file', '--textconv', 'blob', OID]],
    ['cat-file --filters', ['cat-file', '--filters', OID]],
    ['cat-file blob with a ref', ['cat-file', 'blob', 'HEAD:x']],
    ['cat-file -s with a ref', ['cat-file', '-s', 'HEAD']],
    ['cat-file -s with an uppercase oid', ['cat-file', '-s', OID.toUpperCase()]],
    ['cat-file -s with a 41-digit oid', ['cat-file', '-s', 'a'.repeat(41)]],
    ['cat-file blob with an extra argument', ['cat-file', 'blob', OID, OID]],
    ['ls-files without --', ['ls-files', '-s', '-z', 'a.md']],
    ['ls-files without -s', ['ls-files', '-z', '--', 'a.md']],
    ['ls-files without -z', ['ls-files', '-s', '--', 'a.md']],
    ['ls-files with no path', ['ls-files', '-s', '-z', '--']],
    ['ls-files with an extra flag', ['ls-files', '-s', '-z', '--debug', '--', 'a.md']],
    ['ls-files with -o', ['ls-files', '-o', '-s', '-z', '--', 'a.md']],
  ])('refuses %s before any spawn', async (_name, args) => {
    // A missing binary would give `spawn`. The `refused` code shows that nothing was spawned.
    const runner = new GitRunner(tmp('amr-g-'), { gitBinary: join(tmp('amr-nogit-'), 'no-such-git') });
    await expect(runner.run(args)).rejects.toMatchObject({ code: 'refused' });
  });

  it('runs the exact forms: ls-files, cat-file -s and cat-file blob', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    rawGit(root, env, 'add', '--', 'a.md');
    const runner = new GitRunner(root, { env });
    const ls = await runner.run(['ls-files', '-s', '-z', '--', 'a.md']);
    expect(ls.code).toBe(0);
    const oid = ls.stdout.split('\t')[0].split(' ')[1] ?? '';
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(await runner.run(['cat-file', '-s', oid])).toMatchObject({ code: 0, stdout: '4\n' });
    expect(await runner.run(['cat-file', 'blob', oid])).toMatchObject({ code: 0, stdout: '- a\n' });
  });

  it('commitFiles hands the staged entries to the verify hook before the commit', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    const seen: StagedFile[][] = [];
    const res = await new GitRunner(root, { env }).commitFiles(['a.md'], 'x', async (staged) => {
      seen.push(staged);
    });
    expect(res.committed).toBe(true);
    expect(seen).toEqual([[{ path: 'a.md', mode: '100644', stage: 0, oid: expect.stringMatching(/^[0-9a-f]{40}$/) }]]);
  });

  it('a verify hook that throws stops the commit and leaves the paths staged', async () => {
    const { root, env } = makeRepo();
    writeFileSync(join(root, 'a.md'), '- a\n');
    const head = rawGit(root, env, 'rev-parse', 'HEAD');
    await expect(
      new GitRunner(root, { env }).commitFiles(['a.md'], 'x', async () => {
        throw new Error('refused by hook');
      }),
    ).rejects.toThrow('refused by hook');
    expect(rawGit(root, env, 'rev-parse', 'HEAD')).toBe(head);
    expect(rawGit(root, env, 'diff', '--cached', '--name-only').trim()).toBe('a.md');
  });

  it('commitFiles refuses a staged symlink as stage-mismatch and commits nothing', async (t) => {
    if (!canSymlink()) return t.skip();
    const { root, env } = makeRepo();
    rawGit(root, env, 'config', 'core.symlinks', 'true');
    symlinkSync('MEMORY.md', join(root, 'link.md'), 'file');
    await expect(new GitRunner(root, { env }).commitFiles(['link.md'], 'x')).rejects.toMatchObject({ code: 'stage-mismatch' });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });

  it('commitFiles refuses a staged gitlink (nested repository) as stage-mismatch', async () => {
    const { root, env } = makeRepo();
    const sub = join(root, 'sub');
    mkdirSync(sub);
    rawGit(sub, env, 'init', '-q');
    rawGit(sub, env, 'commit', '-q', '--allow-empty', '-m', 'sub');
    await expect(new GitRunner(root, { env }).commitFiles(['sub'], 'x')).rejects.toMatchObject({ code: 'stage-mismatch' });
    expect(rawGit(root, env, 'log', '--format=%s', '-1').trim()).toBe('init');
  });
});
