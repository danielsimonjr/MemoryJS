/**
 * BufferMmapBackend — slurp-the-whole-file reference impl
 *
 * Phase 11 task 81 (§5.4). Simplest of the three `IMmapBackend`
 * implementations: at `open` time, reads the entire file into a
 * single `Buffer` and serves `readRange` from in-memory slices.
 *
 * **Why ship a slurp-everything backend?** It's a known-good
 * reference for the other (more interesting) backends. Tests that
 * want a real on-disk file but don't care about the memory savings
 * of `FsReadMmapBackend` (task 83) or native mmap (task 82) get a
 * predictable Buffer-backed path. Small JSONL files (≤ a few hundred
 * MB) also have nothing to gain from incremental range-reads, so
 * this is a sane default for them too.
 *
 * @module core/mmap/BufferMmapBackend
 * @experimental Tracks `IMmapBackend`'s contract — same stability tier.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import type { IMmapBackend, MmapHandle } from './IMmapBackend.js';

export interface BufferMmapBackendOptions {
  /** Stable name for diagnostics. Default: `'buffer'`. */
  name?: string;
}

export class BufferMmapBackend implements IMmapBackend {
  readonly name: string;

  // Keyed by the handle reference itself, not by path. A caller could
  // open the same path twice and expect two independent handles —
  // close()ing one shouldn't invalidate the other.
  private readonly buffers: Map<MmapHandle, Buffer> = new Map();

  constructor(options: BufferMmapBackendOptions = {}) {
    this.name = options.name ?? 'buffer';
  }

  async open(filePath: string): Promise<MmapHandle> {
    const absolutePath = resolve(filePath);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolutePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`BufferMmapBackend: failed to open ${filePath}: ${message}`);
    }
    const handle: MmapHandle = { id: absolutePath, size: buffer.length };
    this.buffers.set(handle, buffer);
    return handle;
  }

  async close(handle: MmapHandle): Promise<void> {
    // Idempotent — Map.delete returns false for absent keys, which is fine.
    this.buffers.delete(handle);
  }

  async readRange(handle: MmapHandle, offset: number, length: number): Promise<Buffer> {
    const buffer = this.buffers.get(handle);
    if (!buffer) {
      throw new Error(`BufferMmapBackend: handle ${handle.id} is not open`);
    }
    if (offset < 0 || length < 0) {
      throw new Error(
        `BufferMmapBackend: negative offset/length (offset=${offset}, length=${length})`,
      );
    }
    if (offset + length > handle.size) {
      throw new Error(
        `BufferMmapBackend: read past EOF (offset=${offset}, length=${length}, size=${handle.size})`,
      );
    }
    // Defensive copy — IMmapBackend contract says no aliasing.
    return Buffer.from(buffer.subarray(offset, offset + length));
  }

  async size(handle: MmapHandle): Promise<number> {
    return handle.size;
  }

  /** Total number of open handles — useful for tests verifying `close()` actually runs. */
  openHandleCount(): number {
    return this.buffers.size;
  }
}
