/**
 * Confined writer for the Agent Memory Repo (AMR). It writes one `.md` file, checks it for secrets,
 * and commits only that file. A failure after the write restores the previous state.
 *
 * Order: path rules, size, secret scan, root check, clean tree, confinement, folders, temp file,
 * rename, add, staged check, commit. One call at a time runs for each repository root in this process.
 *
 * @module features/amr/AmrWriter
 * @experimental
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { foldPathCase, samePath, strictlyInside } from '../../utils/confinedPath.js';
import { renameOver } from '../../utils/durableWriteFile.js';
import { AMR_READER_DEFAULTS, MARKDOWN_SUFFIX, checkAmrLink } from './AmrReader.js';
import { AmrGitError, type GitRunner, type StagedFile } from './GitRunner.js';
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
 * Tell whether a real path is the real root or inside it.
 * @param realRoot - Real path of the root.
 * @param real - Real path to test.
 * @returns True when the path is confined.
 */
function confined(realRoot: string, real: string): boolean {
  return samePath(real, realRoot) || strictlyInside(foldPathCase(realRoot), foldPathCase(real));
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

/** Exact entry names of each folder that one planning pass has read, keyed by the folder path. */
type DirNames = Map<string, Set<string>>;

/**
 * Tell whether a folder has an entry with this exact name (no case folding). With a cache, the first call
 * for a folder reads it into a set, and later calls of the same pass reuse the set. Without a cache, each
 * call reads the folder.
 * @param dir - Folder path.
 * @param name - Exact entry name.
 * @param cache - Listings of the pass, or undefined for one call.
 * @returns True when the folder has the entry.
 */
async function hasEntry(dir: string, name: string, cache: DirNames | undefined): Promise<boolean> {
  if (cache === undefined) return (await fs.readdir(dir)).includes(name);
  let names = cache.get(dir);
  if (names === undefined) {
    names = new Set(await fs.readdir(dir));
    cache.set(dir, names);
  }
  return names.has(name);
}

/**
 * Confine the target before any folder is made. Each existing segment must have exactly the
 * on-disk spelling (no case variant, no 8.3 short name). The deepest existing ancestor must be
 * inside the real root, and no segment may be an ignored name. The folder listings come from `dirs`.
 * All planning of a batch runs before its first rename, so no rename of this call makes a listing stale.
 * Another process can still change a folder after its listing.
 * @param root - Memory root.
 * @param relPath - Checked path with `/`.
 * @param dirs - Folder listings of the pass, or undefined for one call.
 * @returns The plan, or the refusal reason.
 */
async function planTarget(root: string, relPath: string, dirs: DirNames | undefined): Promise<Plan | { reason: AmrWriteReason }> {
  const top = resolve(root);
  const realRoot = await fs.realpath(top);
  const segments = relPath.split('/');
  if (segments.some((s) => IGNORED.has(s.toLowerCase()))) return { reason: 'excluded' };
  let parent = top;
  for (const s of segments) {
    const here = join(parent, s);
    if ((await lstatOrNull(here)) === null) break;
    if (!(await hasEntry(parent, s, dirs))) return { reason: 'invalid-path' };
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
  return checkWritePathWith(root, relPath, undefined);
}

/**
 * {@link checkAmrWritePath} with the folder listings of one pass.
 * @param root - Memory root.
 * @param relPath - Repo-relative path with `/`.
 * @param dirs - Folder listings of the pass, or undefined for one call.
 * @returns The refusal reason, or null when the writer accepts the place.
 */
async function checkWritePathWith(root: string, relPath: string, dirs: DirNames | undefined): Promise<AmrWriteReason | null> {
  try {
    const plan = await planTarget(root, relPath, dirs);
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
 * A folder that another process makes after planning is accepted here; the staged-name check refuses a case variant.
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
        // A file that was swapped for a symlink before `git add` is removed as a link: unlink does not follow it.
        const st = await lstatOrNull(t.target);
        if (st !== null && (st.isFile() || st.isSymbolicLink()) && samePath(await fs.realpath(dirname(t.target)), t.realParent)) {
          await fs.unlink(t.target);
        }
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

/**
 * Byte limit of one file, the limit that the reader uses.
 * @param relPath - Repo-relative path with `/`.
 * @returns The index limit for `MEMORY.md`, else the file limit.
 */
function sizeLimitOf(relPath: string): number {
  return relPath.toLowerCase() === 'memory.md' ? AMR_READER_DEFAULTS.maxIndexBytes : AMR_READER_DEFAULTS.maxFileBytes;
}

/** Longest commit message of the AMR tool and CLI surfaces, in characters. */
export const AMR_COMMIT_MESSAGE_MAX_CHARS = 500;

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
  if (!MARKDOWN_SUFFIX.test(relPath)) return { ok: false, reason: 'not-markdown' };
  if (Buffer.byteLength(text, 'utf8') > sizeLimitOf(relPath)) return { ok: false, reason: 'too-large' };
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

/** Git blob ids of the bytes that the writer scanned, under both object formats. */
interface ScannedHash {
  /** Blob id under sha1: 40 hex digits. */
  sha1: string;
  /** Blob id under sha256: 64 hex digits. */
  sha256: string;
}

/**
 * Hash bytes the way git hashes a blob, for both object formats.
 * @param bytes - Bytes that the writer scanned.
 * @returns The two blob ids.
 */
function scannedHash(bytes: Buffer): ScannedHash {
  const blob = (algo: 'sha1' | 'sha256'): string => createHash(algo).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return { sha1: blob('sha1'), sha256: blob('sha256') };
}

/** A staged file that the writer refuses after `git add`. The caller unstages it. */
class StagedRefusal extends Error {
  /** Reason of the refusal. */
  readonly reason: AmrWriteReason;
  /** Repo-relative path of the file. */
  readonly path: string;
  /** Secret hits, for a `secret` refusal. */
  readonly hits: SecretHit[] | undefined;

  /**
   * Make a refusal of one staged file.
   * @param reason - Reason of the refusal.
   * @param path - Repo-relative path.
   * @param hits - Secret hits, when there are some.
   */
  constructor(reason: AmrWriteReason, path: string, hits?: SecretHit[]) {
    super(reason);
    this.name = 'StagedRefusal';
    this.reason = reason;
    this.path = path;
    this.hits = hits;
  }
}

/**
 * Check the staged entries of one commit against the bytes that the writer scanned. An entry whose blob
 * id equals the scanned bytes is verified with no read. Any other entry is read by `git cat-file`: its
 * size first (against the same limit as the first scan), then its text, which goes through
 * {@link checkFileText} as the first scan did.
 * @param runner - Git runner that reads the blob.
 * @param scanned - Scanned hashes by repo-relative path.
 * @param message - Commit message, scanned again with the path as the first scan did.
 * @param patternsOpt - Secret patterns of the first scan, or undefined for the configured ones.
 * @param staged - Staged entries of the commit.
 * @returns Nothing. It throws {@link StagedRefusal} for a file that must not be committed.
 */
async function verifyStaged(
  runner: GitRunner,
  scanned: ReadonlyMap<string, ScannedHash>,
  message: string,
  patternsOpt: readonly SecretPattern[] | undefined,
  staged: StagedFile[],
): Promise<void> {
  for (const f of staged) {
    const hash = scanned.get(f.path);
    if (hash === undefined) throw new StagedRefusal('stage-mismatch', f.path);
    if ((f.oid.length === 64 ? hash.sha256 : hash.sha1) === f.oid) continue;
    if ((await runner.blobSize(f.oid)) > sizeLimitOf(f.path)) throw new StagedRefusal('too-large', f.path);
    const refused = checkFileText(f.path, await runner.blobText(f.oid), message, patternsOpt);
    if (refused !== null) throw new StagedRefusal(refused.reason, f.path, refused.hits);
  }
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
 * rename restores every file this call touched and unstages them. After `git add`, each staged entry is
 * checked against the scanned bytes, as {@link commitAmrEdits} does. The restore checks the folder of
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
  return serialized(foldPathCase(realRoot), () => writeBatchLocked(root, realRoot, files, opts));
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
    const k = foldPathCase(f.path);
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
  const dirs: DirNames = new Map();
  for (const file of files) {
    let plan: Plan | { reason: AmrWriteReason };
    try {
      plan = await planTarget(root, file.path, dirs);
    } catch {
      return { ok: false, reason: 'io-error', path: file.path };
    }
    if ('reason' in plan) return { ok: false, reason: plan.reason, path: file.path };
    plans.push({ file, plan });
  }

  const touched: Touched[] = [];
  const fail = async (reason: AmrWriteReason, path?: string, hits?: SecretHit[]): Promise<AmrBatchResult> => {
    const left = await restoreTouched(opts.runner, gitDir, touched);
    const res: AmrBatchResult = { ok: false, reason };
    if (path !== undefined) res.path = path;
    if (hits !== undefined) res.hits = hits;
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

  const scanned = new Map<string, ScannedHash>();
  for (const f of files) scanned.set(f.path, scannedHash(Buffer.from(f.text, 'utf8')));
  try {
    const res = await opts.runner.commitFiles(files.map((f) => f.path), opts.message, (staged) =>
      verifyStaged(opts.runner, scanned, opts.message, opts.patterns, staged),
    );
    return res.committed ? { ok: true, committed: true, sha: res.sha } : { ok: true, committed: false };
  } catch (e) {
    if (e instanceof StagedRefusal) return fail(e.reason, e.path, e.hits);
    return fail(e instanceof AmrGitError && e.code === 'stage-mismatch' ? 'stage-mismatch' : 'git-failed');
  }
}

/** Options of {@link commitAmrEdits}. */
export interface AmrEditOptions {
  /** Runner for the repository. The runner root must be the repository top. */
  runner: GitRunner;
  /** Commit message. The runner adds its prefix. */
  message: string;
}

/** Status letters that refuse a commit of hand edits: deletion, rename, copy and unmerged. */
const UNSAFE_STATUS = new Set(['D', 'R', 'C', 'U']);

/**
 * Commit the hand edits of a repository in one commit. Every changed file (modified, added or
 * untracked) must pass the guards of {@link writeAmrFiles}. One bad path refuses the whole commit and
 * stages nothing. A deletion, a rename, a copy or an unmerged path refuses too. A file with a staged
 * change and a later worktree change refuses with `not-clean`. A failed commit unstages the files, so a
 * change staged before the call is not staged after the call. After `git add`, each staged entry is
 * checked against the bytes that were scanned. An entry with the same blob id passes. Any other entry
 * is read again with `git cat-file`, its size first, and scanned again. A symlink, a gitlink or a secret
 * in the staged text refuses the commit, and the files are unstaged. Not covered: a process that writes
 * the index between that check and `git commit`.
 * An empty changed set is a no-op. The root must be the repository top.
 * @param root - Memory root (the repository top).
 * @param opts - Runner and commit message.
 * @returns The commit result, or the refusal with the path of the first bad file.
 */
export async function commitAmrEdits(root: string, opts: AmrEditOptions): Promise<AmrBatchResult> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(resolve(root));
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  return serialized(foldPathCase(realRoot), () => commitEditsLocked(root, realRoot, opts));
}

/**
 * Parse `git status --porcelain -z`. Each entry is `XY<space>path` and a NUL. A rename or copy has one
 * more field, the old path, which the parser skips.
 * @param out - Porcelain output.
 * @returns The path and the two status letters of each entry.
 */
function parsePorcelain(out: string): Array<{ path: string; x: string; y: string }> {
  const parts = out.split('\0');
  const entries: Array<{ path: string; x: string; y: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i] ?? '';
    if (e.length < 4) continue;
    const x = e[0] ?? ' ';
    const y = e[1] ?? ' ';
    entries.push({ path: e.slice(3), x, y });
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i += 1;
  }
  return entries;
}

/**
 * Check one changed file before any staging. The path rules come first, then the confinement, then
 * the text (size, secrets and the message).
 * @param root - Memory root.
 * @param rel - Repo-relative path with `/`.
 * @param message - Commit message.
 * @param dirs - Folder listings of the pass.
 * @param scanned - Receives the scanned hash of the file.
 * @param patterns - Secret patterns of the call.
 * @returns The refusal, or null when the file may be committed.
 */
async function checkEditedFile(
  root: string,
  rel: string,
  message: string,
  dirs: DirNames,
  scanned: Map<string, ScannedHash>,
  patterns: readonly SecretPattern[],
): Promise<AmrFileRefusal | null> {
  if (!checkAmrLink(rel).ok) return { ok: false, reason: 'invalid-path' };
  if (!MARKDOWN_SUFFIX.test(rel)) return { ok: false, reason: 'not-markdown' };
  const place = await checkWritePathWith(root, rel, dirs);
  if (place !== null) return { ok: false, reason: place };
  const file = join(resolve(root), ...rel.split('/'));
  let bytes: Buffer;
  try {
    // The size check comes before the read, so a huge file is never read into memory.
    if ((await fs.stat(file)).size > sizeLimitOf(rel)) return { ok: false, reason: 'too-large' };
    bytes = await fs.readFile(file);
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  scanned.set(rel, scannedHash(bytes));
  return checkFileText(rel, bytes.toString('utf8'), message, patterns);
}

/**
 * Body of {@link commitAmrEdits}. The caller holds the queue of the root.
 * @param root - Memory root.
 * @param realRoot - Real path of the root.
 * @param opts - Runner and message.
 * @returns The batch result.
 */
async function commitEditsLocked(root: string, realRoot: string, opts: AmrEditOptions): Promise<AmrBatchResult> {
  const runnerReal = await fs.realpath(opts.runner.root).catch(() => null);
  if (runnerReal === null || !samePath(runnerReal, realRoot)) return { ok: false, reason: 'not-root' };
  let entries: Array<{ path: string; x: string; y: string }>;
  try {
    const top = await opts.runner.run(['rev-parse', '--show-toplevel']);
    if (top.code !== 0) return { ok: false, reason: 'not-root' };
    if (!samePath(await fs.realpath(top.stdout.trim()), realRoot)) return { ok: false, reason: 'not-root' };
    const status = await opts.runner.run(['status', '--porcelain', '-z', '--untracked-files=all']);
    if (status.code !== 0) return { ok: false, reason: 'git-failed' };
    entries = parsePorcelain(status.stdout);
  } catch {
    return { ok: false, reason: 'git-failed' };
  }
  if (entries.length === 0) return { ok: true, committed: false };
  let patterns: readonly SecretPattern[];
  try {
    patterns = loadSecretPatterns();
  } catch {
    return { ok: false, reason: 'bad-patterns' };
  }

  for (const e of entries) {
    if (UNSAFE_STATUS.has(e.x) || UNSAFE_STATUS.has(e.y)) return { ok: false, reason: 'invalid-path', path: e.path };
    // A staged side and a changed worktree side (MM, AM, AA): a failed commit unstages the file,
    // and the staged text would be lost.
    if (e.x !== ' ' && e.x !== '?' && e.y !== ' ') return { ok: false, reason: 'not-clean', path: e.path };
  }
  const paths = entries.map((e) => e.path);
  const dirs: DirNames = new Map();
  const scanned = new Map<string, ScannedHash>();
  for (const rel of paths) {
    const refused = await checkEditedFile(root, rel, opts.message, dirs, scanned, patterns);
    if (refused !== null) return { ...refused, path: rel };
  }

  try {
    const res = await opts.runner.commitFiles(paths, opts.message, (staged) =>
      verifyStaged(opts.runner, scanned, opts.message, patterns, staged),
    );
    return res.committed ? { ok: true, committed: true, sha: res.sha } : { ok: true, committed: false };
  } catch (e) {
    await opts.runner.unstage(paths);
    if (e instanceof StagedRefusal) {
      return e.hits !== undefined ? { ok: false, reason: e.reason, path: e.path, hits: e.hits } : { ok: false, reason: e.reason, path: e.path };
    }
    return { ok: false, reason: e instanceof AmrGitError && e.code === 'stage-mismatch' ? 'stage-mismatch' : 'git-failed' };
  }
}
