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
  if (!(await fs.stat(cur)).isDirectory()) return { reason: 'io-error' };
  const real = await fs.realpath(cur);
  if (!confined(realRoot, real)) return { reason: 'outside-root' };
  if (relative(realRoot, real).split(sep).some((s) => IGNORED.has(s.toLowerCase()))) return { reason: 'excluded' };
  return { target, missing, realRoot };
}

/**
 * Check where one file would go, without a write: the segment spelling, the confinement of the
 * deepest existing ancestor, the ignored names and the type of the existing target. The check reads the
 * file system and never changes the file system.
 * @param root - Memory root.
 * @param relPath - Repo-relative path with `/`.
 * @returns The refusal reason, or null when the writer accepts the place.
 */
export async function checkAmrWritePath(root: string, relPath: string): Promise<AmrWriteReason | null> {
  try {
    const plan = await planTarget(root, relPath);
    return 'reason' in plan ? plan.reason : null;
  } catch {
    return 'io-error';
  }
}

/** Thrown when the parent folder of the target moved out of the root during the write. */
class EscapeError extends Error {}

/**
 * Write bytes to a temp file in the git directory and rename it over the target. Only the exact
 * temp file of this call is removed on failure. The parent folder must still have the real path
 * `realParent` right before the rename.
 * @param gitDir - Git directory that holds the temp file.
 * @param target - Final file.
 * @param bytes - Bytes to write.
 * @param realParent - Expected real path of the target folder.
 * @returns Nothing. It throws when the write or the rename fails, or {@link EscapeError}.
 */
async function replaceWith(gitDir: string, target: string, bytes: string | Buffer, realParent: string): Promise<void> {
  const tmp = join(gitDir, `amr-write-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 });
    if (!samePath(await fs.realpath(dirname(target)), realParent)) throw new EscapeError();
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

/** One file after its rename, with what the restore needs. */
interface Touched {
  /** Repo-relative path. */
  relPath: string;
  /** Absolute target path. */
  target: string;
  /** Previous bytes, or null when the file is new. */
  prev: Buffer | null;
  /** Folders that this file created, from the top down. */
  created: string[];
  /** Real path of the target folder at the time of the rename. */
  realParent: string;
}

/**
 * Apply one plan: make the missing folders, confine the target folder, keep the previous bytes and
 * rename the new bytes over the target. On a failure the folders of this file are removed again.
 * @param plan - Plan of the file.
 * @param relPath - Repo-relative path.
 * @param text - New file text.
 * @param gitDir - Git directory for the temp file.
 * @returns What the restore needs. It throws {@link EscapeError} or an fs error.
 */
async function applyPlan(plan: Plan, relPath: string, text: string, gitDir: string): Promise<Touched> {
  const created: string[] = [];
  try {
    for (const dir of plan.missing) {
      if ((await lstatOrNull(dir)) !== null) continue; // Made by an earlier file of this batch.
      await fs.mkdir(dir);
      created.push(dir);
      const st = await fs.lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new EscapeError();
    }
    const realParent = await fs.realpath(dirname(plan.target));
    if (!confined(plan.realRoot, realParent)) throw new EscapeError();
    const prev = (await lstatOrNull(plan.target)) !== null ? await fs.readFile(plan.target) : null;
    await replaceWith(gitDir, plan.target, text, realParent);
    return { relPath, target: plan.target, prev, created, realParent };
  } catch (e) {
    await removeCreated(created);
    throw e;
  }
}

/**
 * Restore the files of a failed write, last first: the previous bytes, or the removal of a new file,
 * then the folders. Before each write or unlink, the target folder must still have its recorded real
 * path. When it moved, nothing is written for that file and its path is returned. Then one unstage
 * call runs for every touched path.
 * @param runner - Git runner.
 * @param gitDir - Git directory.
 * @param touched - Files after their rename.
 * @returns The paths that could not be restored. It never throws.
 */
async function restoreTouched(runner: GitRunner, gitDir: string, touched: Touched[]): Promise<string[]> {
  const left: string[] = [];
  for (const t of [...touched].reverse()) {
    try {
      const now = await fs.realpath(dirname(t.target)).catch(() => null);
      if (now === null || !samePath(now, t.realParent)) {
        left.push(t.relPath);
        continue;
      }
      if (t.prev !== null) {
        await replaceWith(gitDir, t.target, t.prev, t.realParent);
      } else {
        const st = await lstatOrNull(t.target);
        if (st !== null && st.isFile() && samePath(await fs.realpath(dirname(t.target)), t.realParent)) await fs.unlink(t.target);
      }
      await removeCreated(t.created);
    } catch {
      left.push(t.relPath);
    }
  }
  if (touched.length > 0) await runner.unstage(touched.map((t) => t.relPath));
  return left.reverse();
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
 * Write one AMR file, check it for secrets, and commit it alone. It is a batch of one file
 * through {@link writeAmrFiles}, so both writers share one write and restore path.
 * The tree must be clean. A failure before the rename changes no file. A failure after the rename
 * restores the previous state and the index. Calls for the same root run one at a time in this
 * process; a second process that holds the index lock gives `git-failed` and the restore.
 * @param root - Memory root (the repository top). The root must be the runner root.
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
  const res = await writeAmrFiles(root, [{ path: relPath, text }], opts);
  if (res.ok) return res;
  return res.hits !== undefined ? { ok: false, reason: res.reason, hits: res.hits } : { ok: false, reason: res.reason };
}

/** A refusal of one file, before any write. */
export type AmrFileRefusal = { ok: false; reason: AmrWriteReason; hits?: SecretHit[] };

/**
 * Check one file and its commit message: path rules, size and secret scan. It writes nothing and
 * reads nothing. The writers and the export use it.
 * @param relPath - Repo-relative path with `/`.
 * @param text - New file text.
 * @param message - Commit message, scanned for secrets too.
 * @param patternsOpt - Secret patterns, or undefined to load the configured ones.
 * @returns The refusal, or null when the file may be written.
 */
export function checkFileText(
  relPath: string,
  text: string,
  message: string,
  patternsOpt: readonly SecretPattern[] | undefined,
): AmrFileRefusal | null {
  if (!checkAmrLink(relPath).ok) return { ok: false, reason: 'invalid-path' };
  if (process.platform === 'win32' && relPath.split('/').some((s) => /~\d/.test(s))) return { ok: false, reason: 'invalid-path' };
  if (!/\.md$/i.test(relPath)) return { ok: false, reason: 'not-markdown' };
  const bytes = Buffer.byteLength(text, 'utf8');
  const limit = relPath.toLowerCase() === 'memory.md' ? AMR_READER_DEFAULTS.maxIndexBytes : AMR_READER_DEFAULTS.maxFileBytes;
  if (bytes > limit) return { ok: false, reason: 'too-large' };
  let patterns: readonly SecretPattern[];
  try {
    patterns = patternsOpt ?? loadSecretPatterns();
  } catch {
    return { ok: false, reason: 'bad-patterns' };
  }
  const hits = [
    ...scanForSecrets(relPath, patterns).map((h) => ({ ...h, line: 0 })),
    ...scanForSecrets(message, patterns).map((h) => ({ ...h, line: 0 })),
    ...scanForSecrets(text, patterns),
  ];
  if (hits.length > 0) return { ok: false, reason: 'secret', hits };
  return null;
}

/** One file of a batch write. */
export interface AmrFileText {
  /** Repo-relative path with `/`. It must end in `.md`. */
  path: string;
  /** New file text (UTF-8). */
  text: string;
}

/**
 * Result of {@link writeAmrFiles}. A refusal of one file names that file in `path`. A refusal of the
 * repository (root, clean tree, git) has no `path`. `left` lists the files that a restore could not
 * put back, because their folder moved.
 */
export type AmrBatchResult =
  | { ok: true; committed: boolean; sha?: string }
  | { ok: false; reason: AmrWriteReason; path?: string; hits?: SecretHit[]; left?: string[] };

/**
 * Write several AMR files and commit them together, with one commit. The guards are those of
 * {@link writeAmrFile}. Every file is checked and planned before the first rename. A failure after a
 * rename restores every file this call touched and unstages them. The restore checks the folder of
 * each file again before the restore writes or removes anything.
 * @param root - Memory root (the repository top). The root must be the runner root.
 * @param files - Files to write. An empty list writes nothing and commits nothing.
 * @param opts - Runner, commit message and optional secret patterns.
 * @returns The commit result, or the refusal or failure reason with the path of the file.
 */
export async function writeAmrFiles(root: string, files: AmrFileText[], opts: AmrWriteOptions): Promise<AmrBatchResult> {
  if (files.length === 0) return { ok: true, committed: false };
  let realRoot: string;
  try {
    realRoot = await fs.realpath(resolve(root));
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  return serialized(foldCase(realRoot), () => writeBatchLocked(root, realRoot, files, opts));
}

/**
 * Body of {@link writeAmrFiles}. The caller holds the queue of the root.
 * @param root - Memory root.
 * @param realRoot - Real path of the root.
 * @param files - Files to write.
 * @param opts - Options of the write.
 * @returns The batch result.
 */
async function writeBatchLocked(
  root: string,
  realRoot: string,
  files: AmrFileText[],
  opts: AmrWriteOptions,
): Promise<AmrBatchResult> {
  for (const f of files) {
    const refused = checkFileText(f.path, f.text, opts.message, opts.patterns);
    if (refused !== null) return { ...refused, path: f.path };
  }
  const seen = new Set<string>();
  for (const f of files) {
    const k = foldCase(f.path);
    if (seen.has(k)) return { ok: false, reason: 'invalid-path', path: f.path };
    seen.add(k);
  }
  const runnerReal = await fs.realpath(opts.runner.root).catch(() => null);
  if (runnerReal === null || !samePath(runnerReal, realRoot)) return { ok: false, reason: 'not-root' };
  const clean = await opts.runner.checkClean();
  if (!clean.ok) return { ok: false, reason: clean.code };
  const gitDir = await opts.runner.gitDir().catch(() => null);
  if (gitDir === null) return { ok: false, reason: 'git-failed' };

  const plans: Array<{ file: AmrFileText; plan: Plan }> = [];
  for (const file of files) {
    let plan: Plan | { reason: AmrWriteReason };
    try {
      plan = await planTarget(root, file.path);
    } catch {
      return { ok: false, reason: 'io-error', path: file.path };
    }
    if ('reason' in plan) return { ok: false, reason: plan.reason, path: file.path };
    plans.push({ file, plan });
  }

  const touched: Touched[] = [];
  const fail = async (reason: AmrWriteReason, path?: string): Promise<AmrBatchResult> => {
    const left = await restoreTouched(opts.runner, gitDir, touched);
    const res: AmrBatchResult = { ok: false, reason };
    if (path !== undefined) res.path = path;
    if (left.length > 0) {
      res.reason = 'outside-root';
      res.left = left;
    }
    return res;
  };
  for (const { file, plan } of plans) {
    try {
      touched.push(await applyPlan(plan, file.path, file.text, gitDir));
    } catch (e) {
      return fail(e instanceof EscapeError ? 'outside-root' : 'io-error', file.path);
    }
  }

  // A folder may have moved between the check and the rename. Check where each file is.
  for (const t of touched) {
    const real = await fs.realpath(t.target).catch(() => null);
    if (real === null || !confined(realRoot, real) || !samePath(real, join(t.realParent, basename(t.target)))) {
      return fail('outside-root', t.relPath);
    }
  }

  try {
    const res = await opts.runner.commitFiles(
      files.map((f) => f.path),
      opts.message,
    );
    return res.committed ? { ok: true, committed: true, sha: res.sha } : { ok: true, committed: false };
  } catch (e) {
    return fail(e instanceof AmrGitError && e.code === 'stage-mismatch' ? 'stage-mismatch' : 'git-failed');
  }
}
