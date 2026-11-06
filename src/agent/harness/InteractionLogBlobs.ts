/**
 * File helpers for InteractionLog: tolerant log reads, tail reads, exclusive blob writes
 * and bounded blob-head reads.
 *
 * @module agent/harness/InteractionLogBlobs
 * @experimental Internal layout helpers for the Recursa harness (spec RS-7).
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';
import { Mutex } from 'async-mutex';
import { ErrorCode } from '../../utils/errors.js';
import { InteractionLogError, truncateToBytes } from './InteractionLogFormat.js';

const MUTEXES = new Map<string, Mutex>();

/**
 * The mutex for a log path, shared by every InteractionLog instance in this process.
 * Entries are kept for the process lifetime (one small object per distinct path).
 *
 * @param path - Absolute log path
 * @returns The shared mutex
 */
export function sharedMutex(path: string): Mutex {
  let m = MUTEXES.get(path);
  if (!m) MUTEXES.set(path, (m = new Mutex()));
  return m;
}

/**
 * Read a file, treating a missing file as empty.
 *
 * @param path - File to read
 * @returns File contents, or an empty buffer when the file does not exist
 */
export async function readLogFile(path: string): Promise<Buffer> {
  try {
    return await fs.readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
    throw err;
  }
}

/**
 * Current size of a file in bytes, 0 when it does not exist.
 *
 * @param path - File to stat
 * @returns Size in bytes
 */
export async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
}

/**
 * Read bytes `[from, to)` of a file.
 *
 * @param path - File to read
 * @param from - Start offset
 * @param to - End offset (exclusive)
 * @returns The bytes read
 */
export async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, to - from));
    const { bytesRead } = await handle.read(buf, 0, buf.length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Write a blob that must not exist yet (flag `wx`), then fsync it.
 *
 * @param path - Blob path, already confined to the blob directory
 * @param content - Full content
 * @throws InteractionLogError STORAGE_WRITE_FAILED when the blob exists (another writer
 *   took the address) or the write fails
 */
export async function writeBlobExclusive(path: string, content: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    handle = await fs.open(path, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new InteractionLogError(
      code === 'EEXIST'
        ? `InteractionLog blob already exists: ${path} (the log is single-process)`
        : `Failed to write InteractionLog blob: ${(err as Error).message}`,
      ErrorCode.STORAGE_WRITE_FAILED,
    );
  } finally {
    await handle?.close();
  }
}

/**
 * Read the first `maxBytes` of a blob.
 *
 * @param path - Blob path
 * @param maxBytes - Byte budget
 * @returns The blob head, cut at a character boundary
 * @throws InteractionLogError STORAGE_CORRUPTED when the blob is missing
 */
export async function readBlobHead(path: string, maxBytes: number): Promise<string> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new InteractionLogError(`InteractionLog blob is missing: ${path}`, ErrorCode.STORAGE_CORRUPTED);
    }
    throw err;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return truncateToBytes(buf.subarray(0, bytesRead).toString('utf8'), maxBytes);
  } finally {
    await handle.close();
  }
}
