/**
 * Durable file write helper
 *
 * Atomic write: temp file → fsync → rename over target, with a
 * fallback that bypasses rename on Windows EPERM (Dropbox /
 * antivirus / file-locking interference, documented in CLAUDE.md
 * gotchas).
 *
 * Centralizes the pattern that was duplicated across
 * `GraphStorage`, `JsonlColumnStore`, `DiskWarmTier`,
 * `BrotliColdTier`, and `FileSegmentStorage`. Future bug fixes
 * (e.g. POSIX directory fsync for first-write durability —
 * already in `WriteAheadLog` but not propagated here) land in one
 * place.
 *
 * **Contract:**
 * - On success: `target` contains exactly the bytes/chars of
 *   `content`. Any pre-existing file at `target` is replaced.
 * - On failure: `target` is either still the prior file (if rename
 *   never happened) or contains `content` (if the fallback ran
 *   successfully). Unexpected rename failures preserve the tmp file
 *   for diagnosis.
 * - Caller-supplied `content` may be a string (written as UTF-8)
 *   or a `Buffer` (written as raw bytes — used by
 *   `BrotliColdTier`'s compressed shard).
 *
 * @module utils/durableWriteFile
 * @internal Implementation helper — not part of the public API.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { dirname } from 'path';

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
  try {
    await fs.rename(tmpPath, target);
  } catch (error) {
    if (!isWindowsRenameInterference(error)) {
      // Keep the fsynced temp file: it is useful for recovery/debugging and
      // the original target remains untouched.
      throw error;
    }
    // Windows EPERM fallback — Dropbox / antivirus / open-file-locks
    // can refuse the rename; direct-write keeps the operation
    // recoverable. Other errors must not silently lose atomicity.
    try {
      const targetStat = await fs.lstat(target);
      if (targetStat.isSymbolicLink()) throw error;
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
    }
    const fallbackFd = await fs.open(target, 'w', targetMode);
    try {
      await writeAll(fallbackFd, content);
      await fallbackFd.sync();
      await fallbackFd.chmod(targetMode);
    } finally {
      await fallbackFd.close();
    }
    try { await fs.unlink(tmpPath); } catch { /* best-effort */ }
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
 * Windows can report these codes when antivirus/sync software temporarily
 * locks the destination. They are the only failures for which the historical
 * direct-write fallback is safe enough to retain.
 */
function isWindowsRenameInterference(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
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
