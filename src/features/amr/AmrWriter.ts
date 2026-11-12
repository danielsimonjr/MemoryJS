/**
 * Confined writer for the Agent Memory Repo (AMR). It writes one `.md` file, checks it for secrets,
 * and commits only that file. A failure after the write restores the previous state.
 *
 * Order: path rules, size, secret scan, root check, clean tree, confinement, folders, temp file,
 * rename, commit. One call at a time runs for each repository root in this process.
 *
 * @module features/amr/AmrWriter
 * @experimental
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { strictlyInside } from '../../utils/confinedPath.js';
import { renameOver } from '../../utils/durableWriteFile.js';
import { AMR_READER_DEFAULTS, checkAmrLink } from './AmrReader.js';
import { AmrGitError, type GitRunner } from './GitRunner.js';
import { loadSecretPatterns, scanForSecrets, type SecretHit, type SecretPattern } from './SecretScanner.js';

/** Why a write is refused or fails. */
export type AmrWriteReason =
  | 'invalid-path'
  | 'not-markdown'
  | 'too-large'
  | 'excluded'
  | 'outside-root'
  | 'secret'
  | 'bad-patterns'
  | 'not-clean'
  | 'not-root'
  | 'stage-mismatch'
  | 'git-failed'
  | 'io-error';

/** Result of {@link writeAmrFile}. */
export type AmrWriteResult =
  | { ok: true; committed: boolean; sha?: string }
  | { ok: false; reason: AmrWriteReason; hits?: SecretHit[] };

/** Options of {@link writeAmrFile}. */
export interface AmrWriteOptions {
  /** Runner for the repository that holds the root. Its root must be the same folder. */
  runner: GitRunner;
  /** Commit message. The runner adds its prefix. */
  message: string;
  /** Secret patterns. Without it, the patterns come from {@link loadSecretPatterns}. */
  patterns?: readonly SecretPattern[];
}

/** Ignored names in lower case, as the reader uses them. */
const IGNORED = new Set(['.git', ...AMR_READER_DEFAULTS.ignore.map((n) => n.toLowerCase())]);

/** Tail of the write queue of each repository root, keyed by the folded root realpath. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Compare two real paths. The compare folds case on win32 only.
 * @param a - First path.
 * @param b - Second path.
 * @returns True when both are the same path.
 */
function samePath(a: string, b: string): boolean {
  return foldCase(a) === foldCase(b);
}

/**
 * Fold case on win32 only, for a containment compare.
 * @param p - Path.
 * @returns The path, lower case on win32.
 */
function foldCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Tell whether a real path is the real root or inside it.
 * @param realRoot - Real path of the root.
 * @param real - Real path to test.
 * @returns True when the path is confined.
 */
function confined(realRoot: string, real: string): boolean {
  return samePath(real, realRoot) || strictlyInside(foldCase(realRoot), foldCase(real));
}

/**
 * Lstat a path. A missing path gives null. Other errors are thrown.
 * @param p - Path to read.
 * @returns The stats, or null when the path does not exist.
 */
async function lstatOrNull(p: string) {
  try {
    return await fs.lstat(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw e;
  }
}

/** Where a write goes, after the confinement check. */
interface Plan {
  /** Absolute path of the target file. */
  target: string;
  /** Folders that the write must create, from the top down. */
  missing: string[];
  /** Real path of the root. */
  realRoot: string;
}

/**
 * Confine the target before any folder is made. Each existing segment must have exactly the
 * on-disk spelling (no case variant, no 8.3 short name). The deepest existing ancestor must be
 * inside the real root, and no segment may be an ignored name.
 * @param root - Memory root.
 * @param relPath - Checked path with `/`.
 * @returns The plan, or the refusal reason.
 */
async function planTarget(root: string, relPath: string): Promise<Plan | { reason: AmrWriteReason }> {
  const top = resolve(root);
  const realRoot = await fs.realpath(top);
  const segments = relPath.split('/');
  if (segments.some((s) => IGNORED.has(s.toLowerCase()))) return { reason: 'excluded' };
  let parent = top;
  for (const s of segments) {
    const here = join(parent, s);
    if ((await lstatOrNull(here)) === null) break;
    if (!(await fs.readdir(parent)).includes(s)) return { reason: 'invalid-path' };
    parent = here;
  }
  const target = join(top, ...segments);
  const own = await lstatOrNull(target);
  if (own !== null) {
    if (own.isSymbolicLink()) return { reason: 'outside-root' };
    if (!own.isFile()) return { reason: 'io-error' };
  }
  const missing: string[] = [];
  let cur = dirname(target);
  while (cur !== top && (await lstatOrNull(cur)) === null) {
    missing.unshift(cur);
    cur = dirname(cur);
  }
  if ((await lstatOrNull(cur)) === null) return { reason: 'io-error' };
  const real = await fs.realpath(cur);
  if (!confined(realRoot, real)) return { reason: 'outside-root' };
  if (relative(realRoot, real).split(sep).some((s) => IGNORED.has(s.toLowerCase()))) return { reason: 'excluded' };
  return { target, missing, realRoot };
}

/** Thrown when the parent folder of the target moved out of the root during the write. */
class EscapeError extends Error {}

/**
 * Write bytes to a temp file in the git directory and rename it over the target. Only the exact
 * temp file of this call is removed on failure. When `realParent` is set, the parent folder must
 * still have that real path right before the rename.
 * @param gitDir - Git directory that holds the temp file.
 * @param target - Final file.
 * @param bytes - Bytes to write.
 * @param realParent - Expected real path of the target folder, or null for no check.
 * @returns Nothing. It throws when the write or the rename fails, or {@link EscapeError}.
 */
async function replaceWith(gitDir: string, target: string, bytes: string | Buffer, realParent: string | null): Promise<void> {
  const tmp = join(gitDir, `amr-write-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 });
    if (realParent !== null && !samePath(await fs.realpath(dirname(target)), realParent)) throw new EscapeError();
    await renameOver(tmp, target, { prune: false });
  } catch (e) {
    await fs.unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/**
 * Remove the folders that this call created, deepest first. Errors are ignored.
 * @param created - Folders from the top down.
 */
async function removeCreated(created: string[]): Promise<void> {
  for (const dir of [...created].reverse()) await fs.rmdir(dir).catch(() => undefined);
}

/**
 * Restore the previous state after a failed commit: the bytes, or the removal of a new file,
 * then the folders this call created, then the index.
 * @param runner - Git runner.
 * @param gitDir - Git directory.
 * @param target - Target file.
 * @param relPath - Repo-relative path that was staged.
 * @param prev - Previous bytes, or null when the file is new.
 * @param created - Folders that this call created, from the top down.
 * @returns Nothing. It never throws.
 */
async function restoreState(
  runner: GitRunner,
  gitDir: string,
  target: string,
  relPath: string,
  prev: Buffer | null,
  created: string[],
): Promise<void> {
  try {
    if (prev !== null) await replaceWith(gitDir, target, prev, null);
    else await fs.unlink(target).catch(() => undefined);
  } catch {
    // The index is still restored below; the caller reports the failure.
  }
  await removeCreated(created);
  await runner.unstage([relPath]);
}

/**
 * Run one write for a root after the earlier writes for the same root.
 * @param key - Folded real path of the root.
 * @param job - The write.
 * @returns The result of the write.
 */
async function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prior = queues.get(key) ?? Promise.resolve();
  const run = prior.then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

/**
 * Write one AMR file, check it for secrets, and commit it alone.
 * The tree must be clean. A failure before the rename changes no file. A failure after the rename
 * restores the previous state and the index. Calls for the same root run one at a time in this
 * process; a second process that holds the index lock gives `git-failed` and the restore.
 * @param root - Memory root (the repository top). It must be the runner root.
 * @param relPath - Repo-relative path with `/`. It must end in `.md`.
 * @param text - New file text (UTF-8).
 * @param opts - Runner, commit message and optional secret patterns.
 * @returns The commit result, or the refusal or failure reason with the secret hits.
 */
export async function writeAmrFile(
  root: string,
  relPath: string,
  text: string,
  opts: AmrWriteOptions,
): Promise<AmrWriteResult> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(resolve(root));
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  return serialized(foldCase(realRoot), () => writeLocked(root, realRoot, relPath, text, opts));
}

/**
 * Body of {@link writeAmrFile}. The caller holds the queue of the root.
 * @param root - Memory root.
 * @param realRoot - Real path of the root.
 * @param relPath - Repo-relative path with `/`.
 * @param text - New file text.
 * @param opts - Options of the write.
 * @returns The write result.
 */
async function writeLocked(
  root: string,
  realRoot: string,
  relPath: string,
  text: string,
  opts: AmrWriteOptions,
): Promise<AmrWriteResult> {
  if (!checkAmrLink(relPath).ok) return { ok: false, reason: 'invalid-path' };
  if (process.platform === 'win32' && relPath.split('/').some((s) => /~\d/.test(s))) return { ok: false, reason: 'invalid-path' };
  if (!/\.md$/i.test(relPath)) return { ok: false, reason: 'not-markdown' };
  const bytes = Buffer.byteLength(text, 'utf8');
  const limit = relPath.toLowerCase() === 'memory.md' ? AMR_READER_DEFAULTS.maxIndexBytes : AMR_READER_DEFAULTS.maxFileBytes;
  if (bytes > limit) return { ok: false, reason: 'too-large' };
  let patterns: readonly SecretPattern[];
  try {
    patterns = opts.patterns ?? loadSecretPatterns();
  } catch {
    return { ok: false, reason: 'bad-patterns' };
  }
  const hits = [
    ...scanForSecrets(relPath, patterns).map((h) => ({ ...h, line: 0 })),
    ...scanForSecrets(opts.message, patterns).map((h) => ({ ...h, line: 0 })),
    ...scanForSecrets(text, patterns),
  ];
  if (hits.length > 0) return { ok: false, reason: 'secret', hits };
  const runnerReal = await fs.realpath(opts.runner.root).catch(() => null);
  if (runnerReal === null || !samePath(runnerReal, realRoot)) return { ok: false, reason: 'not-root' };
  const clean = await opts.runner.checkClean();
  if (!clean.ok) return { ok: false, reason: clean.code };
  const gitDir = await opts.runner.gitDir().catch(() => null);
  if (gitDir === null) return { ok: false, reason: 'git-failed' };
  let plan: Plan | { reason: AmrWriteReason };
  try {
    plan = await planTarget(root, relPath);
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  if ('reason' in plan) return { ok: false, reason: plan.reason };
  const { target, missing } = plan;

  const created: string[] = [];
  let prev: Buffer | null = null;
  let realParent: string;
  try {
    for (const dir of missing) {
      await fs.mkdir(dir);
      created.push(dir);
      const st = await fs.lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new EscapeError();
    }
    realParent = await fs.realpath(dirname(target));
    if (!confined(plan.realRoot, realParent)) throw new EscapeError();
    if ((await lstatOrNull(target)) !== null) prev = await fs.readFile(target);
    await replaceWith(gitDir, target, text, realParent);
  } catch (e) {
    await removeCreated(created);
    if (e instanceof EscapeError) return { ok: false, reason: 'outside-root' };
    return { ok: false, reason: e instanceof AmrGitError ? 'git-failed' : 'io-error' };
  }

  // The parent folder may have moved between the check and the rename. Check where the file is.
  const realTarget = await fs.realpath(target).catch(() => null);
  if (realTarget === null || !samePath(realTarget, join(realParent, basename(target)))) {
    if (realTarget !== null && !confined(plan.realRoot, realTarget)) {
      // Remove only the file this call wrote. Never write the old bytes through the moved folder.
      await fs.unlink(realTarget).catch(() => undefined);
      await removeCreated(created);
    } else {
      await restoreState(opts.runner, gitDir, target, relPath, prev, created);
    }
    return { ok: false, reason: 'outside-root' };
  }

  try {
    const res = await opts.runner.commitFiles([relPath], opts.message);
    return res.committed ? { ok: true, committed: true, sha: res.sha } : { ok: true, committed: false };
  } catch (e) {
    await restoreState(opts.runner, gitDir, target, relPath, prev, created);
    const reason: AmrWriteReason = e instanceof AmrGitError && e.code === 'stage-mismatch' ? 'stage-mismatch' : 'git-failed';
    return { ok: false, reason };
  }
}
