/**
 * IMmapBackend — Range-Read Interface
 *
 * Phase 11 task 80 (§5.4) — first task in the memory-mapped file
 * support breakdown. Defines a small contract for "open a file,
 * read arbitrary byte ranges out of it, close" so callers can
 * iterate huge JSONL files without slurping the whole thing into
 * memory.
 *
 * **Why not just `fs.createReadStream`?** Streams are great for
 * sequential reads but they don't support cheap random-access by
 * offset. mmap-style APIs let a JSONL line iterator skip past the
 * first 50 % of a file without ever reading those bytes. Range-read
 * is the minimum contract needed; a real OS-level mmap can layer in
 * later behind the same interface.
 *
 * **No external deps.** The interface itself is just types. The two
 * portable backends (`BufferMmapBackend` task 81 and
 * `FsReadMmapBackend` task 83) use only Node built-ins. A native
 * mmap binding (task 82 decision gate) plugs in as a third backend
 * implementing the same interface — gated on user dep approval.
 *
 * @module core/mmap/IMmapBackend
 * @experimental All shapes here are first-cut. The native-mmap
 *   binding (task 82) may add fields to `MmapHandle` in a
 *   non-breaking way once approved.
 */

/**
 * Opaque handle returned by `open`. Backends use it to track per-
 * file state (file descriptor, mmap pointer, buffer slice).
 */
export interface MmapHandle {
  /** Stable identifier for diagnostics. */
  readonly id: string;
  /** Absolute size in bytes — set once at `open` time. */
  readonly size: number;
}

/**
 * Range-read backend. Three shipped impls in Phase 11:
 *
 * - `BufferMmapBackend` (task 81): reads the whole file into a
 *   single `Buffer` at open time. Cheap for files ≤ a few hundred
 *   MB; doesn't beat `fs.readFile` semantically but does provide
 *   the `IMmapBackend` shape for tests and small-file callers.
 * - `FsReadMmapBackend` (task 83): keeps a file descriptor open
 *   and services `readRange` via `fs.read(fd, buffer, offset,
 *   length, position)`. No-deps portable mmap-equivalent — most
 *   of the perf benefit of mmap (no full-file-load) without the
 *   native-binding complexity.
 * - **Native mmap (task 82, deferred)**: would land as a third
 *   impl after user dep approval. Wire-compatible with the other
 *   two through this interface.
 */
export interface IMmapBackend {
  /** Stable name for diagnostics. */
  readonly name: string;

  /** Open a file. Returns an opaque handle the caller passes to subsequent calls. */
  open(filePath: string): Promise<MmapHandle>;

  /** Close a handle. Idempotent — closing an already-closed handle is a no-op. */
  close(handle: MmapHandle): Promise<void>;

  /**
   * Read `length` bytes starting at `offset`. Returns a fresh
   * `Buffer` — callers shouldn't assume any aliasing with the
   * backend's internal buffers (matters for native-mmap when it
   * lands, where range reads CAN alias the kernel page cache).
   *
   * Throws when `offset + length > size`. Reads at the EOF boundary
   * (`offset === size`, `length === 0`) return an empty buffer.
   */
  readRange(handle: MmapHandle, offset: number, length: number): Promise<Buffer>;

  /**
   * Total size in bytes of the file backing `handle`. Convenience —
   * equivalent to `handle.size` but exposed as a method so callers
   * don't have to remember which field carries the size.
   */
  size(handle: MmapHandle): Promise<number>;
}

/**
 * Line iterator helper. Given an `IMmapBackend`, yields each line
 * of the underlying file as a `Buffer` without ever holding more
 * than `chunkSize` bytes in memory. Buffers each chunk, finds
 * newline boundaries, yields complete lines, keeps the unflushed
 * trailing partial line for the next chunk.
 *
 * Used by `GraphStorage.loadGraph` (task 84) to iterate huge JSONL
 * files lazily. Caller decides what to do per line (parse JSON,
 * discard, etc.) — this helper doesn't impose a schema.
 *
 * @example
 * ```typescript
 * const backend = new FsReadMmapBackend();
 * const handle = await backend.open('/data/memory.jsonl');
 * for await (const line of streamLines(backend, handle)) {
 *   const obj = JSON.parse(line.toString('utf-8'));
 *   // ...
 * }
 * await backend.close(handle);
 * ```
 */
export async function* streamLines(
  backend: IMmapBackend,
  handle: MmapHandle,
  options: { chunkSize?: number } = {},
): AsyncIterable<Buffer> {
  const chunkSize = options.chunkSize ?? 64 * 1024; // 64 KB
  const total = await backend.size(handle);
  let offset = 0;
  let remainder: Buffer = Buffer.alloc(0);

  while (offset < total) {
    const readLength = Math.min(chunkSize, total - offset);
    const chunk = await backend.readRange(handle, offset, readLength);
    offset += readLength;

    // Concatenate remainder + chunk into a contiguous buffer so we
    // can scan for newlines. The remainder is at most one line
    // long, so this stays bounded.
    const combined =
      remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk]);
    let lineStart = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] === 0x0a) {
        // 0x0a = '\n'. Yield the line excluding the newline.
        yield combined.subarray(lineStart, i);
        lineStart = i + 1;
      }
    }
    remainder = combined.subarray(lineStart);
  }

  // Final partial line (no trailing newline). Yield only if non-empty.
  if (remainder.length > 0) {
    yield remainder;
  }
}
