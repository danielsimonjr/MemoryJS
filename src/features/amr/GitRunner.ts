/**
 * Git runner for the Agent Memory Repo (AMR) writer. It runs only an exact allow-list of git
 * commands, with `shell: false`, a timeout, and no `GIT_*` variable from the host environment.
 * Every call adds `--literal-pathspecs`. A refused command spawns nothing.
 *
 * @module features/amr/GitRunner
 * @experimental
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ValidationError } from '../../utils/errors.js';

/** Settings of a {@link GitRunner}. Every field has one default in {@link AMR_GIT_DEFAULTS}. */
export interface GitRunnerConfig {
  /** Git executable. */
  gitBinary: string;
  /** Arguments placed before every git call. */
  binaryArgs: string[];
  /** Kill time for one child, in milliseconds. A value above 2^31-1 gives the default. */
  timeoutMs: number;
  /** Longest wait for a killed process tree to exit, in milliseconds. */
  killGraceMs: number;
  /** Prefix added to every commit message. */
  commitPrefix: string;
  /** Environment variables added to the child after the `GIT_*` filter. */
  env: Record<string, string>;
}

/** The one place for every git runner default. */
export const AMR_GIT_DEFAULTS: GitRunnerConfig = {
  gitBinary: 'git',
  binaryArgs: [],
  timeoutMs: 30_000,
  killGraceMs: 5_000,
  commitPrefix: 'memory: ',
  env: {},
};

/** Largest delay that a Node timer accepts. A larger delay fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** Code of an {@link AmrGitError}. */
export type AmrGitErrorCode =
  | 'refused'
  | 'timeout'
  | 'spawn'
  | 'not-clean'
  | 'not-root'
  | 'stage-mismatch'
  | 'git-failed';

/** Error of the git runner. The message never holds an absolute path. */
export class AmrGitError extends Error {
  /** Short code that tells the failure apart. */
  readonly code: AmrGitErrorCode;

  /**
   * Make a runner error with a code.
   * @param code - Error code.
   * @param message - Short message without a path.
   */
  constructor(code: AmrGitErrorCode, message: string) {
    super(message);
    this.name = 'AmrGitError';
    this.code = code;
  }
}

/** Result of one git child. */
export interface GitRunResult {
  /** Exit code. `-1` when the child ends by a signal. */
  code: number;
  /** Standard output, UTF-8. */
  stdout: string;
  /** Standard error, UTF-8. */
  stderr: string;
}

/** Result of {@link GitRunner.checkClean}. */
export type GitCleanCheck =
  | { ok: true }
  | { ok: false; code: 'not-root' | 'not-clean' | 'git-failed' };

/** Result of {@link GitRunner.commitFiles}. */
export type GitCommitResult = { committed: false } | { committed: true; sha: string };

/** Allowed options of each allow-listed subcommand. */
const ALLOWED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  status: ['--porcelain', '-z'],
  'rev-parse': ['--show-toplevel', '--absolute-git-dir', '--verify', '--quiet', 'HEAD'],
  diff: ['--cached', '--name-only', '-z'],
};

/**
 * Tell whether a git argument list is on the allow-list.
 * @param args - Arguments after `--literal-pathspecs`.
 * @returns True when the list is allowed.
 */
function isAllowed(args: readonly string[]): boolean {
  const [sub, ...rest] = args;
  if (typeof sub !== 'string') return false;
  const options = ALLOWED_OPTIONS[sub];
  if (options) return rest.every((a) => options.includes(a));
  if (sub === 'commit') return rest.length === 2 && rest[0] === '-m' && typeof rest[1] === 'string';
  if (sub === 'add') return rest.length >= 2 && rest[0] === '--';
  if (sub === 'restore') return rest.length >= 3 && rest[0] === '--staged' && rest[1] === '--';
  if (sub === 'rm') return rest.length >= 4 && rest[0] === '--cached' && rest[1] === '--quiet' && rest[2] === '--';
  return false;
}

/**
 * Make the child environment: the host environment without `GIT_*`, then the configured variables.
 * @param extra - Variables from the config.
 * @returns The environment for one child.
 */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^GIT_/i.test(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

/**
 * Compare two real paths. The compare folds case on win32 only.
 * @param a - First real path.
 * @param b - Second real path.
 * @returns True when both name the same place.
 */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Pick a timer option. A value that is not finite, not above 0, or above 2^31-1 gives the default.
 * @param v - Value from the caller.
 * @param fallback - Default value.
 * @returns The number to use.
 */
function timerOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_TIMER_MS ? v : fallback;
}

/**
 * Kill a child and every process below it. On win32 this runs `taskkill /T /F`, because a git
 * launcher starts the real git as its own child. On POSIX the child leads its own process group,
 * so a signal to the negative pid reaches the whole group.
 * @param child - Child that `spawn` started.
 * @returns A promise that settles when the kill command is done. It never rejects.
 */
function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise<void>((done) => {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
      tk.once('error', () => {
        child.kill('SIGKILL');
        done();
      });
      tk.once('close', () => done());
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  return Promise.resolve();
}

/** Runs the allow-listed git commands of one repository root. */
export class GitRunner {
  /** Settings in use, after the defaults are merged. */
  readonly config: GitRunnerConfig;
  /** Absolute path that every git call uses as its working folder. */
  readonly root: string;

  /**
   * Make a runner for one repository root. It spawns nothing.
   * @param root - Absolute path of the repository root or of a folder below it.
   * @param config - Partial settings. Missing or invalid values take the default.
   * @throws ValidationError when `root` is empty or not absolute.
   */
  constructor(root: string, config: Partial<GitRunnerConfig> = {}) {
    if (typeof root !== 'string' || root === '' || !isAbsolute(root)) {
      throw new ValidationError('git root must be an absolute path', ['root']);
    }
    this.root = root;
    this.config = {
      gitBinary: typeof config.gitBinary === 'string' && config.gitBinary !== '' ? config.gitBinary : AMR_GIT_DEFAULTS.gitBinary,
      binaryArgs: Array.isArray(config.binaryArgs) ? [...config.binaryArgs] : [...AMR_GIT_DEFAULTS.binaryArgs],
      timeoutMs: timerOr(config.timeoutMs, AMR_GIT_DEFAULTS.timeoutMs),
      killGraceMs: timerOr(config.killGraceMs, AMR_GIT_DEFAULTS.killGraceMs),
      commitPrefix: typeof config.commitPrefix === 'string' ? config.commitPrefix : AMR_GIT_DEFAULTS.commitPrefix,
      env: { ...AMR_GIT_DEFAULTS.env, ...(config.env ?? {}) },
    };
  }

  /**
   * Run one allow-listed git command. It never rejects for a non-zero exit code.
   * @param args - Git arguments, for example `['status', '--porcelain']`.
   * @returns The exit code and the output.
   * @throws AmrGitError with code `refused` for a command off the allow-list, `timeout` or `spawn`.
   */
  run(args: readonly string[]): Promise<GitRunResult> {
    if (!isAllowed(args)) return Promise.reject(new AmrGitError('refused', 'git command is not allowed'));
    const argv = [...this.config.binaryArgs, '--literal-pathspecs', ...args];
    return new Promise<GitRunResult>((resolve, reject) => {
      let settled = false;
      const child = spawn(this.config.gitBinary, argv, {
        cwd: this.root,
        shell: false,
        env: childEnv(this.config.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Reject once the child has exited, so no process keeps its working folder open.
        // A bounded wait keeps a child that will not die from hanging the caller.
        const fail = (): void => reject(new AmrGitError('timeout', 'git command timed out'));
        const grace = setTimeout(fail, this.config.killGraceMs);
        const exited = new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) done();
          else child.once('exit', () => done());
        });
        void Promise.all([exited, killTree(child)]).then(() => {
          clearTimeout(grace);
          fail();
        });
      }, this.config.timeoutMs);
      child.once('error', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new AmrGitError('spawn', 'git command could not start'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  /**
   * Check that the root is the top of its repository and that the tree is clean.
   * The root check runs first. A run error becomes `git-failed`; this method never rejects.
   * @returns `{ ok: true }`, or the code of the first failing check.
   */
  async checkClean(): Promise<GitCleanCheck> {
    try {
      const top = await this.run(['rev-parse', '--show-toplevel']);
      if (top.code !== 0) return { ok: false, code: 'not-root' };
      const realTop = await fs.realpath(top.stdout.trim());
      const realRoot = await fs.realpath(this.root);
      if (!samePath(realTop, realRoot)) return { ok: false, code: 'not-root' };
      const status = await this.run(['status', '--porcelain']);
      if (status.code !== 0) return { ok: false, code: 'git-failed' };
      if (status.stdout.trim() !== '') return { ok: false, code: 'not-clean' };
      return { ok: true };
    } catch {
      return { ok: false, code: 'git-failed' };
    }
  }

  /**
   * Resolve the git directory. A linked worktree has a `.git` file, so this asks git.
   * @returns The real path of the git directory.
   * @throws AmrGitError with code `git-failed` when git cannot answer.
   */
  async gitDir(): Promise<string> {
    const res = await this.run(['rev-parse', '--absolute-git-dir']);
    if (res.code !== 0) throw new AmrGitError('git-failed', 'git directory is not available');
    return fs.realpath(res.stdout.trim());
  }

  /**
   * Read the commit that HEAD names.
   * @returns The sha, or null when HEAD names no commit (a new repository).
   * @throws AmrGitError with code `timeout` or `spawn` when git does not run.
   */
  async head(): Promise<string | null> {
    const res = await this.run(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return res.code === 0 ? res.stdout.trim() : null;
  }

  /**
   * Remove paths from the index and keep the files. Before the first commit `restore --staged`
   * cannot run, so this uses `rm --cached` then.
   * @param paths - Repo-relative paths with `/`.
   * @returns Nothing. It never rejects.
   */
  async unstage(paths: string[]): Promise<void> {
    try {
      const unborn = (await this.head()) === null;
      await this.run(unborn ? ['rm', '--cached', '--quiet', '--', ...paths] : ['restore', '--staged', '--', ...paths]);
    } catch {
      // The caller checks the tree after this call.
    }
  }

  /**
   * Stage the paths, check the staged set, and commit it.
   * An empty staged set is a no-op. Every staged path must be in `paths`. A staged path outside
   * `paths` refuses the commit. A failed commit leaves the paths staged: the caller unstages them.
   * A commit that times out is checked after its process tree is dead. When HEAD moved and the
   * index is empty, the commit landed and this resolves with it.
   * @param paths - Repo-relative paths with `/`.
   * @param message - Commit message. The configured prefix is added in front.
   * @returns `{ committed: false }` for a no-op, or `{ committed: true, sha }`.
   * @throws AmrGitError with code `stage-mismatch`, `timeout` or `git-failed`.
   */
  async commitFiles(paths: string[], message: string): Promise<GitCommitResult> {
    const add = await this.run(['add', '--', ...paths]);
    if (add.code !== 0) throw new AmrGitError('git-failed', 'git add failed');
    const names = await this.stagedNames();
    if (names.length === 0) return { committed: false };
    const allowed = new Set(paths);
    if (names.some((n) => !allowed.has(n))) throw new AmrGitError('stage-mismatch', 'staged set holds an unexpected path');
    const before = await this.head();
    let commit: GitRunResult;
    try {
      commit = await this.run(['commit', '-m', `${this.config.commitPrefix}${message}`]);
    } catch (e) {
      if (!(e instanceof AmrGitError) || e.code !== 'timeout') throw e;
      const after = await this.head();
      if (after !== null && after !== before && (await this.stagedNames()).length === 0) return { committed: true, sha: after };
      throw e;
    }
    if (commit.code !== 0) throw new AmrGitError('git-failed', 'git commit failed');
    const sha = await this.head();
    if (sha === null) throw new AmrGitError('git-failed', 'git rev-parse failed');
    return { committed: true, sha };
  }

  /**
   * List the staged paths.
   * @returns Repo-relative paths with `/`.
   * @throws AmrGitError with code `git-failed` when git cannot answer.
   */
  private async stagedNames(): Promise<string[]> {
    const staged = await this.run(['diff', '--cached', '--name-only', '-z']);
    if (staged.code !== 0) throw new AmrGitError('git-failed', 'git diff failed');
    return staged.stdout.split('\0').filter((n) => n !== '');
  }
}
