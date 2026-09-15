/**
 * Durable file write helper
 *
 * Atomic write: temp file → fsync → rename over target → fsync of the
 * parent directory.
 *
 * Centralizes the pattern that was duplicated across
 * `GraphStorage`, `JsonlColumnStore`, `DiskWarmTier`,
 * `BrotliColdTier`, and `FileSegmentStorage`.
 *
 * **Contract:**
 * - On success: `target` contains exactly the bytes/chars of
 *   `content`. Any pre-existing file at `target` is replaced.
 * - On failure: `target` is still the previous generation. The helper
 *   never opens the live target for writing, so it never truncates it.
 *   When the fsynced temp file was written but the rename failed, the
 *   temp file is kept next to the target for recovery and diagnosis.
 * - Windows rename interference (`EPERM` / `EBUSY` / `EACCES` from
 *   antivirus, sync clients or open handles) is retried with a short
 *   backoff. If the rename still fails, the helper throws a
 *   {@link DurableReplaceError}. It does not fall back to an in-place
 *   rewrite: a crash during such a rewrite destroys the previous good
 *   generation.
 * - Directory fsync after the rename makes the new directory entry
 *   durable where the platform supports it. Platforms that cannot open or
 *   sync a directory (Windows reports `EISDIR`; some file systems report
 *   `EPERM` or `EINVAL`) skip this step.
 * - Caller-supplied `content` may be a string (written as UTF-8)
 *   or a `Buffer` (written as raw bytes — used by
 *   `BrotliColdTier`'s compressed shard).
 *
 * @module utils/durableWriteFile
 * @internal Implementation helper — not part of the public API.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { basename, dirname, join } from 'path';

/** Backoff (ms) between rename attempts after Windows interference. */
const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];

/** Directory-fsync error codes that mean "not supported on this platform". */
const UNSUPPORTED_DIR_SYNC_CODES = new Set(['EISDIR', 'EPERM', 'EINVAL']);

/**
 * Thrown when a durable replace cannot rename the synced temp file over
 * the target. The target still holds the previous generation; `tmpPath`
 * holds the synced new generation.
 */
export class DurableReplaceError extends Error {
  readonly code: string | undefined;

  constructor(
    readonly target: string,
    readonly tmpPath: string,
    override readonly cause: unknown,
  ) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    super(
      `Cannot replace ${target} (${code ?? String(cause)}). The previous file is unchanged; ` +
        `the new content is kept at ${tmpPath}.`,
    );
    this.name = 'DurableReplaceError';
    this.code = code;
  }
}

/**
 * Atomically write `content` to `target`. See module JSDoc for the
 * full contract.
 */
export async function durableWriteFile(
  target: string,
  content: string | Buffer,
): Promise<void> {
  // Ensure the parent dir exists. Cheap no-op when it does; saves
  // every caller from having to check + mkdir themselves (the
  // FileSegmentStorage case needs this for the `segments/` subdir).
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const tmpPath = `${target}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const targetMode = await restrictedModeForReplacement(target);
  const fd = await fs.open(tmpPath, 'wx', targetMode);
  try {
    await writeAll(fd, content);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await renameOver(tmpPath, target);
  await syncParentDirectory(target);
}

/**
 * Rename a synced temp file over `target`. Retries Windows rename
 * interference with backoff, refuses to replace a symbolic link after
 * interference, and otherwise throws with the temp file left in place.
 * Never writes into `target`.
 */
export async function renameOver(tmpPath: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmpPath, target);
      return;
    } catch (error) {
      if (!isWindowsRenameInterference(error)) throw error;
      await refuseSymlinkTarget(target, error);
      if (attempt >= RENAME_RETRY_DELAYS_MS.length) {
        await pruneEarlierFailedTmps(tmpPath, target);
        throw new DurableReplaceError(target, tmpPath, error);
      }
      await delay(RENAME_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/**
 * Fsync the directory that contains `target` so a completed rename survives
 * power loss. Skips platforms that do not support directory fsync.
 */
export async function syncParentDirectory(target: string): Promise<void> {
  let dirFd: import('fs/promises').FileHandle;
  try {
    dirFd = await fs.open(dirname(target), 'r');
  } catch (error) {
    if (isUnsupportedDirSync(error)) return;
    throw error;
  }
  try {
    await dirFd.sync();
  } catch (error) {
    if (!isUnsupportedDirSync(error)) throw error;
  } finally {
    await dirFd.close();
  }
}

/**
 * Durably append `content` to `target`: open in append mode (creating the
 * file with mode 0600 and its parent directory when missing), write, fsync,
 * close. Not atomic across a crash — a torn tail is possible — so callers
 * must use a line-oriented format whose loader tolerates a truncated final
 * record, and should re-publish the whole file (see {@link durableWriteFile})
 * after a failed append.
 */
export async function durableAppendFile(
  target: string,
  content: string | Buffer,
): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const fd = await fs.open(target, 'a', 0o600);
  try {
    await writeAll(fd, content);
    await fd.sync();
  } finally {
    await fd.close();
  }
}

/**
 * Restrict an existing sensitive file to owner read/write while preserving
 * tighter owner permissions (for example, an existing `0400` file).
 */
export async function restrictSensitiveFilePermissions(target: string): Promise<void> {
  const stat = await fs.stat(target);
  const current = stat.mode & 0o777;
  const restricted = current & 0o600;
  if (restricted !== current) {
    await fs.chmod(target, restricted);
  }
}

/** Mode for a replacement: preserve tighter existing permissions. */
async function restrictedModeForReplacement(target: string): Promise<number> {
  try {
    const stat = await fs.stat(target);
    return (stat.mode & 0o777) & 0o600;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return 0o600;
  }
}

/**
 * After a failed replace, keep only the newest synced tmp for `target`.
 * Without this, a lock that outlasts the retry budget leaves one
 * whole-file tmp per save. Best-effort: cleanup errors are ignored.
 */
async function pruneEarlierFailedTmps(keepTmpPath: string, target: string): Promise<void> {
  const prefix = `${basename(target)}.tmp.`;
  const keep = basename(keepTmpPath);
  try {
    for (const name of await fs.readdir(dirname(target))) {
      if (name.startsWith(prefix) && name !== keep) {
        await fs.unlink(join(dirname(target), name)).catch(() => undefined);
      }
    }
  } catch {
    // Diagnostics only; the replace failure is the error that matters.
  }
}

/** Throw `renameError` when `target` is a symbolic link. */
async function refuseSymlinkTarget(target: string, renameError: unknown): Promise<void> {
  try {
    if ((await fs.lstat(target)).isSymbolicLink()) throw renameError;
  } catch (statError) {
    if (statError === renameError) throw statError;
    if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
  }
}

/**
 * Windows can report these codes when antivirus/sync software temporarily
 * locks the destination. They are the only rename failures worth retrying.
 */
function isWindowsRenameInterference(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

function isUnsupportedDirSync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && UNSUPPORTED_DIR_SYNC_CODES.has(code);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Write every byte, including when the OS completes only part of a write. */
async function writeAll(
  fd: import('fs/promises').FileHandle,
  content: string | Buffer,
): Promise<void> {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await fd.write(buffer, offset, buffer.length - offset, null);
    if (bytesWritten <= 0) {
      throw new Error('File write made no progress');
    }
    offset += bytesWritten;
  }
}
