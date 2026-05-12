/**
 * FsReadMmapBackend — Range-Read Over a Pinned File Descriptor
 *
 * Phase 11 task 83 (§5.4). Portable no-deps `IMmapBackend`
 * implementation. Keeps a `FileHandle` open across reads and services
 * each `readRange` via `fileHandle.read(buffer, 0, length, offset)`.
 *
 * **Why this exists.** Task 82 (native mmap binding choice — between
 * `mmap-io`, a custom node addon, or `node-mmap`) is a deferred
 * decision gate pending user approval of an external native
 * dependency. This backend delivers most of the practical benefit of
 * mmap (no full-file load; random-access reads at any offset;
 * constant-memory iteration of huge files) without platform-specific
 * native-binding complexity. The OS page cache still does the heavy
 * lifting under the hood — `fs.read` on a pinned fd is the
 * pure-JavaScript equivalent of `mmap`-style range access for the
 * read-only iteration use case.
 *
 * **Portable no-deps backend.** A native mmap binding (task 82,
 * deferred) would land as a third `IMmapBackend` impl alongside this
 * and `BufferMmapBackend` once user approves the dep. All three
 * share the same `IMmapBackend` interface so callers (e.g.
 * `GraphStorage.loadGraph` via `streamLines` in task 84) are
 * back-end-agnostic.
 *
 * **Resource discipline.** Every open file is tracked in an internal
 * `Map<MmapHandle, FileHandle>`. `close` is idempotent and
 * leak-resistant: even if the bookkeeping `delete` throws, the
 * underlying `FileHandle.close()` is attempted first so the kernel
 * fd is released. `openHandleCount()` exposes the current open
 * tally for tests and diagnostics.
 *
 * @module core/mmap/FsReadMmapBackend
 * @experimental Like `IMmapBackend` itself, this is first-cut.
 *   Signatures may evolve once the task 82 native binding lands and
 *   we learn what extra fields callers want on `MmapHandle`.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import type { FileHandle } from 'fs/promises';
import type { IMmapBackend, MmapHandle } from './IMmapBackend.js';

/**
 * Constructor options for `FsReadMmapBackend`. All optional — the
 * default name suffices for nearly every caller.
 */
export interface FsReadMmapBackendOptions {
  /** Stable name for diagnostics. Default: `'fs-read'`. */
  name?: string;
}

/**
 * `IMmapBackend` implementation that pins a `FileHandle` per opened
 * file and answers range reads via `fileHandle.read`. Constant-
 * memory iteration of arbitrarily large files; no native deps.
 */
export class FsReadMmapBackend implements IMmapBackend {
  readonly name: string;

  /**
   * Tracks live handles. The map key IS the public `MmapHandle`
   * object — referential identity, not value identity, so two opens
   * of the same path get distinct entries (matches the "open
   * returns a fresh handle" contract). The value is the underlying
   * Node `FileHandle`.
   */
  private readonly handles: Map<MmapHandle, FileHandle> = new Map();

  constructor(options: FsReadMmapBackendOptions = {}) {
    this.name = options.name ?? 'fs-read';
  }

  /**
   * Open `filePath` in read-only mode. The returned `MmapHandle`
   * carries the absolute path as its `id` and the file size (from
   * `fs.stat`) as its `size`. The underlying `FileHandle` stays
   * open until `close(handle)` is called.
   *
   * Wraps ENOENT and other open-time errors in a descriptive error
   * so callers don't have to interpret raw Node error codes.
   */
  async open(filePath: string): Promise<MmapHandle> {
    // Resolve to absolute path (Phase 11 review #12) so handle.id is
    // a canonical identifier independent of cwd — matches
    // BufferMmapBackend's behavior and lets callers compare ids
    // across instances meaningfully.
    const absolutePath = resolve(filePath);
    let fileHandle: FileHandle;
    try {
      fileHandle = await fs.open(absolutePath, 'r');
    } catch (err) {
      // ENOENT / EACCES / EISDIR all surface here. Re-throw with
      // a descriptive message that includes the path — saves
      // callers from spelunking through error.code lookups.
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FsReadMmapBackend: failed to open '${absolutePath}': ${cause}`,
      );
    }

    // Stat the open fd (not the path) — closer to mmap semantics
    // and avoids a TOCTOU window where the file gets replaced
    // between fs.open and fs.stat.
    let size: number;
    try {
      const stats = await fileHandle.stat();
      size = stats.size;
    } catch (err) {
      // Stat failed — release the fd we just acquired so we don't
      // leak it on the error path, then rethrow.
      await fileHandle.close().catch(() => {
        /* best-effort cleanup */
      });
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FsReadMmapBackend: failed to stat '${absolutePath}': ${cause}`,
      );
    }

    const handle: MmapHandle = { id: absolutePath, size };
    this.handles.set(handle, fileHandle);
    return handle;
  }

  /**
   * Close the handle. Idempotent — a second close on an already-
   * released handle is a no-op (doesn't throw). Leak-safe — if the
   * underlying `close()` rejects, we still remove the handle from
   * the map; if the `delete` somehow throws, we still attempted
   * `close()` first.
   */
  async close(handle: MmapHandle): Promise<void> {
    const fileHandle = this.handles.get(handle);
    if (fileHandle === undefined) {
      // Already closed (or never registered) — idempotent no-op.
      return;
    }

    // CRITICAL: close the fd FIRST, then drop the map entry. If we
    // dropped from the map first and `close()` threw, the kernel
    // fd would leak with no way to recover it. Doing close first
    // means even a corrupted map removal still releases the fd.
    try {
      await fileHandle.close();
    } finally {
      // Guarantees the map entry is removed even if close threw —
      // a re-close would otherwise try to close an already-closed
      // FileHandle, which Node treats as an error.
      this.handles.delete(handle);
    }
  }

  /**
   * Read `length` bytes starting at `offset`. Returns a freshly
   * allocated `Buffer` — never aliases the backend's internals.
   *
   * Validation:
   * - The handle must still be open. Reads on a closed handle
   *   throw with a descriptive error.
   * - `offset + length > handle.size` throws (read-past-EOF).
   * - `length === 0` is a fast path that returns an empty buffer
   *   without touching the fd (also handles the boundary case
   *   `offset === size, length === 0`).
   */
  async readRange(handle: MmapHandle, offset: number, length: number): Promise<Buffer> {
    if (length === 0) {
      // Zero-length read — short-circuit. Lets callers ask for
      // [size, size, 0] at EOF without tripping the bounds check.
      return Buffer.alloc(0);
    }

    if (offset + length > handle.size) {
      throw new Error(
        `FsReadMmapBackend: read past EOF (offset=${offset}, length=${length}, size=${handle.size}, id='${handle.id}')`,
      );
    }

    const fileHandle = this.handles.get(handle);
    if (fileHandle === undefined) {
      throw new Error(
        `FsReadMmapBackend: readRange on a closed/unknown handle (id='${handle.id}')`,
      );
    }

    // Fresh allocation per call — caller-owned, no aliasing with
    // any internal cache. Matches the interface contract.
    const buf = Buffer.alloc(length);

    // Phase 11 review #5: loop until the request is fully satisfied
    // (or EOF). On most filesystems a single `fileHandle.read` returns
    // the full count, but POSIX permits short reads — NFS / FUSE /
    // signal-interrupted reads on some platforms surface them. Loop
    // until done; only throw if we hit EOF before length.
    let totalRead = 0;
    while (totalRead < length) {
      const { bytesRead } = await fileHandle.read(
        buf,
        totalRead,
        length - totalRead,
        offset + totalRead,
      );
      if (bytesRead === 0) break; // EOF
      totalRead += bytesRead;
    }

    if (totalRead !== length) {
      // File truncated underneath us between open() and readRange().
      // Surface explicitly so callers don't silently get a partial
      // buffer.
      throw new Error(
        `FsReadMmapBackend: short read (expected ${length} bytes, got ${totalRead}, offset=${offset}, id='${handle.id}'). File may have been truncated.`,
      );
    }

    return buf;
  }

  /**
   * Total size of the file backing `handle`. Reflects the size
   * captured at `open` time (not a fresh stat) — matches the
   * `IMmapBackend.size` contract that the size is "set once at
   * open time".
   */
  async size(handle: MmapHandle): Promise<number> {
    return handle.size;
  }

  /**
   * Number of currently-open file descriptors. Useful for tests
   * and resource-leak diagnostics. Counts handles whose `close`
   * has not yet been awaited; does NOT count handles that errored
   * during `open` (those never made it into the map).
   */
  openHandleCount(): number {
    return this.handles.size;
  }
}
