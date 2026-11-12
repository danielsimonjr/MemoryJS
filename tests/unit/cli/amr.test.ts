/**
 * `memory amr` CLI group tests: the subcommands, their JSON output and their exit codes.
 *
 * Each action prints one JSON object and exits 1 only when its exit rule says so. An exit rule sets
 * `process.exitCode = 1` and never calls `process.exit`, so a large report is not cut on a POSIX pipe.
 * A bad flag value throws; the harness mocks `process.exit` to throw, so that path rejects the parse
 * with `process.exit called`.
 */

import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from '../../../src/cli/parseArgs.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAmrCommands } from '../../../src/cli/commands/amr.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { exportAmr } from '../../../src/features/amr/AmrSync.js';
import { AMR_COMMIT_MESSAGE_MAX_CHARS } from '../../../src/features/amr/AmrWriter.js';
import { AMR_READER_DEFAULTS } from '../../../src/features/amr/AmrReader.js';
import { GitRunner } from '../../../src/features/amr/GitRunner.js';

/** Host env without any GIT_* variable (a git hook exports GIT_DIR and GIT_INDEX_FILE). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) out[k] = v;
  return out;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8' });
}

/** A git repository with a repo-local identity, no hooks and no signing, and one commit of MEMORY.md. */
function makeRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'amr-cli-')));
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

describe('memory amr CLI group', () => {
  let h: CliHarness;
  let roots: string[];

  beforeEach(async () => {
    h = await createCliHarness(registerAmrCommands);
    roots = [];
  });

  afterEach(async () => {
    // A leaked exit code would make the test process exit 1.
    process.exitCode = undefined;
    await cleanupCliHarness(h);
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  function repo(): string {
    const r = makeRepo();
    roots.push(r);
    return r;
  }

  /** Parse and expect a clean exit (no process.exit call and no exit code). */
  async function ok(args: string[]): Promise<void> {
    process.exitCode = undefined;
    await h.parse(args);
    expect(h.processExitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  }

  /** Parse and expect exit code 1 set by an exit rule, with no process.exit call. */
  async function exitsCode1(args: string[]): Promise<void> {
    process.exitCode = undefined;
    await h.parse(args);
    expect(h.processExitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  }

  /** Parse and expect exit 1 through process.exit (a thrown ValidationError). */
  async function exits1(args: string[]): Promise<void> {
    await expect(h.parse(args)).rejects.toThrow('process.exit called');
    expect(h.processExitSpy).toHaveBeenCalledWith(1);
  }

  describe('context', () => {
    it('prints the AMR context as JSON and exits 0', async () => {
      const root = repo();
      mkdirSync(join(root, 'notes'));
      writeFileSync(join(root, 'notes', 'a.md'), '- a\n');
      // The reader follows the links of MEMORY.md, so the note is linked from there.
      writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- [[notes/a]]\n');
      await ok(['amr', 'context', root]);
      const out = h.lastJson<{ files: string[]; truncated: boolean; text: string }>();
      expect(out.files).toContain('MEMORY.md');
      expect(out.files).toContain('notes/a.md');
      expect(typeof out.text).toBe('string');
      expect(out.truncated).toBe(false);
    });

    it('refuses a --max-files value that is not a safe integer', async () => {
      const root = repo();
      await exits1(['amr', 'context', root, '--max-files', '9'.repeat(400)]);
      expect(h.logSpy).not.toHaveBeenCalled();
    });

    it('accepts --max-files at the reader default', async () => {
      const root = repo();
      await ok(['amr', 'context', root, '--max-files', String(AMR_READER_DEFAULTS.maxFiles)]);
    });

    it('refuses --max-files 0 with exit 1 and no JSON', async () => {
      const root = repo();
      await exits1(['amr', 'context', root, '--max-files', '0']);
      expect(h.errorSpy).toHaveBeenCalled();
      expect(h.logSpy).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('exits 0 with no issues on a clean root', async () => {
      const root = repo();
      await ok(['amr', 'check', root]);
      expect(h.lastJson<{ issues: unknown[] }>().issues).toEqual([]);
    });

    it('prints the issue and exits 1 when MEMORY.md is missing', async () => {
      const root = repo();
      rmSync(join(root, 'MEMORY.md'));
      await exitsCode1(['amr', 'check', root]);
      const out = h.lastJson<{ issues: Array<{ code: string }> }>();
      expect(out.issues.map((i) => i.code)).toContain('missing-memory-md');
    });
  });

  describe('cwd and storage', () => {
    it('context and check create no storage file and no file in the working folder', async () => {
      const root = repo();
      const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'amr-cwd-')));
      roots.push(cwd);
      const before = process.cwd();
      process.chdir(cwd);
      try {
        await ok(['amr', 'context', root]);
        await ok(['amr', 'check', root]);
      } finally {
        process.chdir(before);
      }
      expect(readdirSync(cwd)).toEqual([]);
      expect(existsSync(h.storagePath)).toBe(false);
    });

    it('context and check with the default ./memory.jsonl storage create no file in the cwd', async () => {
      const root = repo();
      const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'amr-cwd-')));
      roots.push(cwd);
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
      program
        .option('-s, --storage <path>', 'Storage path', './memory.jsonl')
        .option('--output-format <type>', 'Output format', 'json');
      registerAmrCommands(program);
      const before = process.cwd();
      process.chdir(cwd);
      try {
        await program.parseAsync(['node', 'memory', 'amr', 'context', root]);
        await program.parseAsync(['node', 'memory', 'amr', 'check', root]);
      } finally {
        process.chdir(before);
      }
      expect(h.processExitSpy).not.toHaveBeenCalled();
      expect(readdirSync(cwd)).toEqual([]);
    });
  });

  describe('export', () => {
    async function seed(): Promise<void> {
      const ctx = new ManagerContext(h.storagePath);
      await ctx.entityManager.createEntities([
        { name: 'Alpha', entityType: 'project', observations: ['first fact'] },
        { name: 'Beta', entityType: 'person', observations: ['second fact'] },
      ]);
      await ctx.relationManager.createRelations([{ from: 'Alpha', to: 'Beta', relationType: 'uses' }]);
    }

    it('dry run writes nothing and exits 0', async () => {
      await seed();
      const root = repo();
      const before = git(root, 'rev-parse', 'HEAD');
      await ok(['amr', 'export', root]);
      const out = h.lastJson<{ files: Array<{ action: string }>; writeError?: string }>();
      expect(out.files.length).toBeGreaterThan(0);
      expect(out.writeError).toBeUndefined();
      expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
      expect(git(root, 'status', '--porcelain')).toBe('');
    });

    it('--apply commits once with the export message', async () => {
      await seed();
      const root = repo();
      const count = Number(git(root, 'rev-list', '--count', 'HEAD').trim());
      await ok(['amr', 'export', root, '--apply']);
      expect(Number(git(root, 'rev-list', '--count', 'HEAD').trim())).toBe(count + 1);
      expect(git(root, 'log', '--format=%s', '-1').trim()).toMatch(/^memory: export \d+ files$/);
    });

    it('passes the whole graph and filters only through types (F17)', async () => {
      await seed();
      const root = repo();
      await ok(['amr', 'export', root, '--types', 'project']);
      const actual = h.lastJson();
      const ctx = new ManagerContext(h.storagePath);
      const g = await ctx.storage.loadGraph();
      const expected = await exportAmr(g.entities, g.relations, root, { types: ['project'], dryRun: true });
      expect(actual).toEqual(expected);
    });

    it('exits 1 with the refusal code for a folder that is not a repository, and writes no file', async () => {
      await seed();
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'amr-norepo-')));
      roots.push(dir);
      await exitsCode1(['amr', 'export', dir, '--apply']);
      expect(h.lastJson<{ writeError?: string }>().writeError).toBe('not-root');
      expect(readdirSync(dir)).toEqual([]);
    });

    it('exits 1 for --mode bogus and writes no file', async () => {
      await seed();
      const root = repo();
      await exits1(['amr', 'export', root, '--mode', 'bogus']);
      expect(git(root, 'status', '--porcelain')).toBe('');
    });
  });

  describe('import', () => {
    it('dry run exits 0 with the entity list', async () => {
      const root = repo();
      await ok(['amr', 'import', root]);
      expect(Array.isArray(h.lastJson<{ entities: unknown[] }>().entities)).toBe(true);
      expect(git(root, 'status', '--porcelain')).toBe('');
    });

    it('--apply adds the entity of a memory file to the graph and exits 0', async () => {
      const root = repo();
      const exported = await exportAmr(
        [{ name: 'Gamma', entityType: 'project', observations: ['g fact'] }],
        [],
        root,
        { dryRun: false, runner: new GitRunner(root, { env: cleanEnv() }) },
      );
      expect(exported.writeError).toBeUndefined();
      await ok(['amr', 'import', root, '--apply']);
      const ctx = new ManagerContext(h.storagePath);
      expect((await ctx.storage.loadGraph()).entities.map((e) => e.name)).toContain('Gamma');
    });

    it('--mode bogus exits 1', async () => {
      const root = repo();
      await exits1(['amr', 'import', root, '--mode', 'bogus']);
    });
  });

  describe('commit', () => {
    it('--message is required and exits 1 without it', async () => {
      const root = repo();
      await exits1(['amr', 'commit', root]);
    });

    it('commits a hand-edited .md file and prints ok', async () => {
      const root = repo();
      writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
      await ok(['amr', 'commit', root, '--message', 'edit memory']);
      expect(h.lastJson<{ ok: boolean; committed: boolean }>()).toMatchObject({ ok: true, committed: true });
      expect(git(root, 'log', '--format=%s', '-1').trim()).toBe('memory: edit memory');
    });

    it('refuses a file with a secret with exit 1 and stages nothing', async () => {
      const root = repo();
      writeFileSync(join(root, 'MEMORY.md'), `# Memory\n\n- key ${'AKIA' + 'Q'.repeat(16)}\n`);
      await exitsCode1(['amr', 'commit', root, '--message', 'x']);
      expect(h.lastJson<{ ok: boolean; reason: string }>()).toMatchObject({ ok: false, reason: 'secret' });
      expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
    });

    it('refuses a message longer than the limit and accepts one at the limit', async () => {
      const root = repo();
      writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- fact\n- more\n');
      await exits1(['amr', 'commit', root, '--message', 'm'.repeat(AMR_COMMIT_MESSAGE_MAX_CHARS + 1)]);
      expect(git(root, 'log', '--format=%s', '-1').trim()).toBe('init');
      h.processExitSpy.mockClear();
      await ok(['amr', 'commit', root, '--message', 'm'.repeat(AMR_COMMIT_MESSAGE_MAX_CHARS)]);
      expect(h.lastJson<{ ok: boolean }>()).toMatchObject({ ok: true });
    });

    it('refuses a changed .txt with exit 1 and commits nothing', async () => {
      const root = repo();
      writeFileSync(join(root, 'note.txt'), 'plain\n');
      await exitsCode1(['amr', 'commit', root, '--message', 'x']);
      expect(h.lastJson<{ ok: boolean; reason: string }>()).toMatchObject({ ok: false, reason: 'not-markdown' });
      expect(git(root, 'log', '--format=%s', '-1').trim()).toBe('init');
    });
  });
});
