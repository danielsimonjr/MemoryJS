/**
 * BufferMmapBackend tests
 *
 * Covers Phase 11 task 81 — the slurp-everything reference impl of
 * `IMmapBackend`. Mirrors the FakeBackend tests in
 * `IMmapBackend.test.ts` but against a real on-disk file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BufferMmapBackend } from '../../../../src/core/mmap/BufferMmapBackend.js';
import { streamLines } from '../../../../src/core/mmap/IMmapBackend.js';

describe('BufferMmapBackend', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `buffer-mmap-backend-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  async function writeFile(name: string, content: Buffer | string): Promise<string> {
    const filePath = join(testDir, name);
    await fs.writeFile(filePath, content);
    return filePath;
  }

  it('has a default name of "buffer"', () => {
    const backend = new BufferMmapBackend();
    expect(backend.name).toBe('buffer');
  });

  it('respects a custom name', () => {
    const backend = new BufferMmapBackend({ name: 'custom' });
    expect(backend.name).toBe('custom');
  });

  it('round-trip: open → readRange → close', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('hello.txt', 'hello world');
    const handle = await backend.open(filePath);
    const slice = await backend.readRange(handle, 6, 5);
    expect(slice.toString()).toBe('world');
    await backend.close(handle);
  });

  it('handle.size matches file size', async () => {
    const backend = new BufferMmapBackend();
    const content = Buffer.from('abcdefghij'); // 10 bytes
    const filePath = await writeFile('size.bin', content);
    const handle = await backend.open(filePath);
    expect(handle.size).toBe(10);
    expect(await backend.size(handle)).toBe(10);
  });

  it('handle.id is the absolute path', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('id.txt', 'x');
    const handle = await backend.open(filePath);
    // testDir is constructed under tmpdir() which is already absolute,
    // so filePath itself should already match the resolved form.
    expect(handle.id).toBe(filePath);
  });

  it('readRange of length 0 returns an empty buffer', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('empty-read.txt', 'abc');
    const handle = await backend.open(filePath);
    const slice = await backend.readRange(handle, 3, 0);
    expect(slice.length).toBe(0);
  });

  it('readRange at offset 0 of an empty file returns an empty buffer', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('empty.bin', Buffer.alloc(0));
    const handle = await backend.open(filePath);
    expect(handle.size).toBe(0);
    const slice = await backend.readRange(handle, 0, 0);
    expect(slice.length).toBe(0);
  });

  it('readRange past EOF throws', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('short.txt', 'abc');
    const handle = await backend.open(filePath);
    await expect(backend.readRange(handle, 0, 10)).rejects.toThrow(/EOF/);
  });

  it('readRange with negative offset/length throws', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('neg.txt', 'abc');
    const handle = await backend.open(filePath);
    await expect(backend.readRange(handle, -1, 1)).rejects.toThrow(/negative/);
    await expect(backend.readRange(handle, 0, -1)).rejects.toThrow(/negative/);
  });

  it('readRange returns a defensive copy (mutating the slice does not affect re-reads)', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('copy.txt', 'abc');
    const handle = await backend.open(filePath);
    const slice = await backend.readRange(handle, 0, 3);
    slice[0] = 0xff;
    const reread = await backend.readRange(handle, 0, 3);
    expect(reread[0]).toBe(0x61); // 'a'
  });

  it('open on a missing file throws with a descriptive error', async () => {
    const backend = new BufferMmapBackend();
    const missing = join(testDir, 'does-not-exist.txt');
    await expect(backend.open(missing)).rejects.toThrow(/BufferMmapBackend: failed to open/);
  });

  it('close is idempotent', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('idem.txt', 'x');
    const handle = await backend.open(filePath);
    await backend.close(handle);
    await backend.close(handle); // no throw
  });

  it('readRange on a closed handle throws', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('closed.txt', 'abc');
    const handle = await backend.open(filePath);
    await backend.close(handle);
    await expect(backend.readRange(handle, 0, 3)).rejects.toThrow(/not open/);
  });

  it('openHandleCount tracks open + closed handles', async () => {
    const backend = new BufferMmapBackend();
    expect(backend.openHandleCount()).toBe(0);
    const filePath = await writeFile('count.txt', 'x');
    const h1 = await backend.open(filePath);
    expect(backend.openHandleCount()).toBe(1);
    const h2 = await backend.open(filePath);
    expect(backend.openHandleCount()).toBe(2);
    await backend.close(h1);
    expect(backend.openHandleCount()).toBe(1);
    await backend.close(h2);
    expect(backend.openHandleCount()).toBe(0);
    // Double-close keeps the count at 0 (idempotent).
    await backend.close(h2);
    expect(backend.openHandleCount()).toBe(0);
  });

  it('two open() calls for the same path return independent handles', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('shared.txt', 'abc');
    const h1 = await backend.open(filePath);
    const h2 = await backend.open(filePath);
    await backend.close(h1);
    // h2 is still alive even though h1 was closed.
    const slice = await backend.readRange(h2, 0, 3);
    expect(slice.toString()).toBe('abc');
    await backend.close(h2);
  });

  it('streamLines integration: yields lines from a JSONL-shaped file', async () => {
    const backend = new BufferMmapBackend();
    const filePath = await writeFile('stream.txt', 'alpha\nbeta\ngamma\n');
    const handle = await backend.open(filePath);
    const lines: string[] = [];
    for await (const line of streamLines(backend, handle, { chunkSize: 4 })) {
      lines.push(line.toString('utf-8'));
    }
    await backend.close(handle);
    expect(lines).toEqual(['alpha', 'beta', 'gamma']);
  });
});
