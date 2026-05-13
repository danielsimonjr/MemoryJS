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
 *   successfully). The tmp file is best-effort cleaned up.
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
  await fs.mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const fd = await fs.open(tmpPath, 'w');
  try {
    await writeAll(fd, content);
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await fs.rename(tmpPath, target);
  } catch {
    // Windows EPERM fallback — Dropbox / antivirus / open-file-locks
    // can refuse the rename; direct-write keeps the operation
    // recoverable. POSIX should never hit this branch.
    const fallbackFd = await fs.open(target, 'w');
    try {
      await writeAll(fallbackFd, content);
      await fallbackFd.sync();
    } finally {
      await fallbackFd.close();
    }
    try { await fs.unlink(tmpPath); } catch { /* best-effort */ }
  }
}

/**
 * Narrow `string | Buffer` to one of the two overloads of
 * `FileHandle.write` so TypeScript can pick a single signature.
 * Buffer/string union doesn't satisfy either overload directly.
 */
async function writeAll(
  fd: import('fs/promises').FileHandle,
  content: string | Buffer,
): Promise<void> {
  if (typeof content === 'string') {
    await fd.write(content);
  } else {
    await fd.write(content);
  }
}
