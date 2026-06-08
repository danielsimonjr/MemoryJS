/**
 * IMmapBackend + streamLines tests
 *
 * Covers Phase 11 task 80: interface contract + streamLines helper.
 *
 * Uses a tiny in-test backend (`FakeBackend`) so the interface
 * tests don't depend on either of the two real backends (tasks 81
 * + 83 land in parallel commits).
 */

import { describe, it, expect } from 'vitest';
import {
  streamLines,
  type IMmapBackend,
  type MmapHandle,
} from '../../../../src/core/mmap/IMmapBackend.js';

/**
 * Minimal in-test backend backed by a single Buffer. Distinct from
 * BufferMmapBackend (task 81) — that's a file-backed reference. This
 * is a "you-give-me-bytes" mock that proves the interface + helpers
 * work without filesystem I/O.
 */
class FakeBackend implements IMmapBackend {
  readonly name = 'fake';
  private store: Map<string, Buffer> = new Map();
  private nextId = 0;

  put(content: Buffer): { path: string } {
    const path = `fake://${this.nextId++}`;
    this.store.set(path, content);
    return { path };
  }

  async open(filePath: string): Promise<MmapHandle> {
    const buf = this.store.get(filePath);
    if (!buf) throw new Error(`FakeBackend: no file at ${filePath}`);
    return { id: filePath, size: buf.length };
  }

  async close(_handle: MmapHandle): Promise<void> {
    /* idempotent no-op */
  }

  async readRange(handle: MmapHandle, offset: number, length: number): Promise<Buffer> {
    const buf = this.store.get(handle.id)!;
    if (offset + length > buf.length) {
      throw new Error(`FakeBackend: read past EOF (offset=${offset}, length=${length}, size=${buf.length})`);
    }
    // Return a copy — backend contract says no aliasing.
    return Buffer.from(buf.subarray(offset, offset + length));
  }

  async size(handle: MmapHandle): Promise<number> {
    return handle.size;
  }
}

describe('IMmapBackend (FakeBackend reference)', () => {
  it('open returns a handle with the file size', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('hello world'));
    const handle = await backend.open(path);
    expect(handle.size).toBe(11);
  });

  it('open throws for an absent file', async () => {
    const backend = new FakeBackend();
    await expect(backend.open('fake://missing')).rejects.toThrow();
  });

  it('readRange returns the right slice', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('hello world'));
    const handle = await backend.open(path);
    const slice = await backend.readRange(handle, 6, 5);
    expect(slice.toString()).toBe('world');
  });

  it('readRange of length 0 returns an empty buffer', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('abc'));
    const handle = await backend.open(path);
    const slice = await backend.readRange(handle, 3, 0);
    expect(slice.length).toBe(0);
  });

  it('readRange past EOF throws', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('abc'));
    const handle = await backend.open(path);
    await expect(backend.readRange(handle, 0, 10)).rejects.toThrow(/EOF/);
  });

  it('readRange returns a copy (mutation does not affect backend)', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('abc'));
    const handle = await backend.open(path);
    const slice = await backend.readRange(handle, 0, 3);
    slice[0] = 0xff;
    const reread = await backend.readRange(handle, 0, 3);
    expect(reread[0]).toBe(0x61); // 'a' — original
  });

  it('size returns the handle size', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('hello'));
    const handle = await backend.open(path);
    expect(await backend.size(handle)).toBe(5);
  });

  it('close is idempotent', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('x'));
    const handle = await backend.open(path);
    await backend.close(handle);
    await backend.close(handle); // no throw
  });
});

describe('streamLines', () => {
  async function collect(backend: FakeBackend, path: string, options: { chunkSize?: number } = {}): Promise<string[]> {
    const handle = await backend.open(path);
    const lines: string[] = [];
    for await (const line of streamLines(backend, handle, options)) {
      lines.push(line.toString('utf-8'));
    }
    await backend.close(handle);
    return lines;
  }

  it('yields each line of a trailing-newline-terminated file', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('alpha\nbeta\ngamma\n'));
    expect(await collect(backend, path)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('yields the final partial line when no trailing newline', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('alpha\nbeta\ngamma'));
    expect(await collect(backend, path)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles an empty file', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.alloc(0));
    expect(await collect(backend, path)).toEqual([]);
  });

  it('handles a file with only newlines', async () => {
    const backend = new FakeBackend();
    const { path } = backend.put(Buffer.from('\n\n\n'));
    expect(await collect(backend, path)).toEqual(['', '', '']);
  });

  it('respects a small chunkSize (lines spanning chunks reassembled)', async () => {
    const backend = new FakeBackend();
    const content = Buffer.from('this is a much longer line\nand another\nthird\n');
    const { path } = backend.put(content);
    expect(await collect(backend, path, { chunkSize: 7 })).toEqual([
      'this is a much longer line',
      'and another',
      'third',
    ]);
  });

  it('handles lines longer than chunkSize', async () => {
    const backend = new FakeBackend();
    const longLine = 'x'.repeat(500);
    const content = Buffer.from(`${longLine}\nshort\n`);
    const { path } = backend.put(content);
    const lines = await collect(backend, path, { chunkSize: 64 });
    expect(lines[0]).toBe(longLine);
    expect(lines[1]).toBe('short');
  });

  it('preserves binary bytes within lines (no UTF-8 mangling at chunk boundaries)', async () => {
    const backend = new FakeBackend();
    // Build a file with a non-newline 0xff byte in the middle of a
    // line, crossing a chunk boundary. streamLines yields Buffers,
    // not strings, so the bytes survive.
    const content = Buffer.concat([
      Buffer.from('alpha\n'),
      Buffer.from([0xff, 0xfe, 0xfd]),
      Buffer.from('\nbeta\n'),
    ]);
    const { path } = backend.put(content);
    const handle = await backend.open(path);
    const lines: Buffer[] = [];
    for await (const line of streamLines(backend, handle, { chunkSize: 4 })) {
      lines.push(line);
    }
    expect(lines[1]!.length).toBe(3);
    expect(lines[1]![0]).toBe(0xff);
    expect(lines[2]!.toString()).toBe('beta');
  });
});
