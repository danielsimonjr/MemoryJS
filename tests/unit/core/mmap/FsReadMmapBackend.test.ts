/**
 * FsReadMmapBackend tests
 *
 * Phase 11 task 83. Exercises the `IMmapBackend` contract end-to-end
 * against a real filesystem (not a mocked-out `fs`). Each test gets
 * a fresh temp directory created in `beforeEach` and torn down in
 * `afterEach` so we never leak files into the OS temp dir between
 * runs. Tests also verify the leak-protection contract by checking
 * `openHandleCount()` after every open/close cycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FsReadMmapBackend,
} from '../../../../src/core/mmap/FsReadMmapBackend.js';
import { streamLines } from '../../../../src/core/mmap/IMmapBackend.js';

describe('FsReadMmapBackend', () => {
  let tempDir: string;
  let backend: FsReadMmapBackend;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'fs-read-mmap-test-'));
    backend = new FsReadMmapBackend();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: Buffer | string): Promise<string> {
    const fullPath = join(tempDir, name);
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  describe('basic open / close / readRange', () => {
    it('round-trips: write a file, open, read, close', async () => {
      const path = await writeFile('hello.txt', 'hello world');
      const handle = await backend.open(path);
      const slice = await backend.readRange(handle, 0, 11);
      expect(slice.toString()).toBe('hello world');
      await backend.close(handle);
    });

    it('handle.size matches the file size', async () => {
      const content = Buffer.from('the quick brown fox');
      const path = await writeFile('fox.txt', content);
      const handle = await backend.open(path);
      expect(handle.size).toBe(content.length);
      expect(await backend.size(handle)).toBe(content.length);
      await backend.close(handle);
    });

    it('readRange returns the exact bytes from the source file', async () => {
      const content = Buffer.from('abcdefghijklmnopqrstuvwxyz');
      const path = await writeFile('alpha.txt', content);
      const handle = await backend.open(path);

      // Read several non-overlapping ranges and verify byte-for-byte
      // against the source content.
      const r1 = await backend.readRange(handle, 0, 5);
      expect(Buffer.compare(r1, content.subarray(0, 5))).toBe(0);

      const r2 = await backend.readRange(handle, 10, 6);
      expect(Buffer.compare(r2, content.subarray(10, 16))).toBe(0);

      const r3 = await backend.readRange(handle, 20, 6);
      expect(Buffer.compare(r3, content.subarray(20, 26))).toBe(0);

      await backend.close(handle);
    });

    it('readRange of length 0 returns an empty buffer', async () => {
      const path = await writeFile('three.txt', 'abc');
      const handle = await backend.open(path);
      const empty = await backend.readRange(handle, 0, 0);
      expect(empty.length).toBe(0);
      // Length-0 read at EOF (offset === size) also returns empty.
      const emptyAtEof = await backend.readRange(handle, 3, 0);
      expect(emptyAtEof.length).toBe(0);
      await backend.close(handle);
    });

    it('readRange past EOF throws', async () => {
      const path = await writeFile('short.txt', 'abc');
      const handle = await backend.open(path);
      await expect(backend.readRange(handle, 0, 10)).rejects.toThrow(/EOF/);
      // Just past the end also throws.
      await expect(backend.readRange(handle, 2, 2)).rejects.toThrow(/EOF/);
      await backend.close(handle);
    });

    it('supports multiple readRange calls on the same handle', async () => {
      const content = Buffer.from('0123456789');
      const path = await writeFile('digits.txt', content);
      const handle = await backend.open(path);

      // Same handle, repeated reads at varying offsets/lengths.
      for (let i = 0; i < 10; i++) {
        const slice = await backend.readRange(handle, i, 1);
        expect(slice.toString()).toBe(String(i));
      }

      // And an out-of-order read at the same handle.
      const middle = await backend.readRange(handle, 3, 4);
      expect(middle.toString()).toBe('3456');

      await backend.close(handle);
    });
  });

  describe('error handling', () => {
    it('open of a missing file throws with a descriptive error', async () => {
      const missing = join(tempDir, 'does-not-exist.jsonl');
      await expect(backend.open(missing)).rejects.toThrow(/FsReadMmapBackend/);
      await expect(backend.open(missing)).rejects.toThrow(/does-not-exist/);
    });

    it('readRange on a closed handle throws', async () => {
      const path = await writeFile('x.txt', 'xyz');
      const handle = await backend.open(path);
      await backend.close(handle);
      await expect(backend.readRange(handle, 0, 1)).rejects.toThrow(
        /closed\/unknown handle/,
      );
    });
  });

  describe('idempotent close', () => {
    it('close() is idempotent — second close is a no-op', async () => {
      const path = await writeFile('idem.txt', 'hi');
      const handle = await backend.open(path);
      await backend.close(handle);
      // Second close must not throw.
      await expect(backend.close(handle)).resolves.toBeUndefined();
      // Third close also fine.
      await expect(backend.close(handle)).resolves.toBeUndefined();
    });
  });

  describe('openHandleCount', () => {
    it('tracks open + close transitions', async () => {
      expect(backend.openHandleCount()).toBe(0);

      const path1 = await writeFile('a.txt', 'aaa');
      const h1 = await backend.open(path1);
      expect(backend.openHandleCount()).toBe(1);

      const path2 = await writeFile('b.txt', 'bbb');
      const h2 = await backend.open(path2);
      expect(backend.openHandleCount()).toBe(2);

      await backend.close(h1);
      expect(backend.openHandleCount()).toBe(1);

      await backend.close(h2);
      expect(backend.openHandleCount()).toBe(0);

      // A redundant close should not flip the count below zero.
      await backend.close(h2);
      expect(backend.openHandleCount()).toBe(0);
    });
  });

  describe('streamLines end-to-end integration', () => {
    it('iterates every line of a multi-line file', async () => {
      const lines = ['alpha', 'beta', 'gamma', 'delta'];
      const path = await writeFile('multi.jsonl', lines.join('\n') + '\n');
      const handle = await backend.open(path);

      const collected: string[] = [];
      for await (const line of streamLines(backend, handle)) {
        collected.push(line.toString('utf-8'));
      }
      expect(collected).toEqual(lines);
      await backend.close(handle);
    });

    it('iterates a file with no trailing newline', async () => {
      const path = await writeFile('no-trailing.txt', 'one\ntwo\nthree');
      const handle = await backend.open(path);

      const collected: string[] = [];
      for await (const line of streamLines(backend, handle)) {
        collected.push(line.toString('utf-8'));
      }
      expect(collected).toEqual(['one', 'two', 'three']);
      await backend.close(handle);
    });

    it('iterates a large multi-line file with a small chunkSize', async () => {
      // 200 lines, each 50 bytes. Forces many chunk transitions
      // at a tiny chunkSize so we exercise the cross-chunk
      // line-reassembly path in streamLines.
      const lines: string[] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`line-${i.toString().padStart(3, '0')}-${'x'.repeat(40)}`);
      }
      const path = await writeFile('big.txt', lines.join('\n') + '\n');
      const handle = await backend.open(path);

      const collected: string[] = [];
      for await (const line of streamLines(backend, handle, { chunkSize: 17 })) {
        collected.push(line.toString('utf-8'));
      }
      expect(collected).toEqual(lines);
      await backend.close(handle);
    });
  });

  describe('resource leak protection', () => {
    it('open 10 handles, close all 10, openHandleCount returns 0', async () => {
      const handles = [];
      for (let i = 0; i < 10; i++) {
        const path = await writeFile(`leak-${i}.txt`, `data-${i}`);
        handles.push(await backend.open(path));
      }
      expect(backend.openHandleCount()).toBe(10);

      for (const h of handles) {
        await backend.close(h);
      }
      expect(backend.openHandleCount()).toBe(0);
    });
  });

  describe('concurrent reads', () => {
    it('multiple concurrent readRange calls on the same handle do not interfere', async () => {
      // Content where each 10-byte chunk has a distinct fingerprint
      // — lets us verify each read returned the bytes for its
      // requested offset and not somebody else's offset.
      const chunks: Buffer[] = [];
      for (let i = 0; i < 100; i++) {
        chunks.push(Buffer.from(i.toString().padStart(10, '0')));
      }
      const content = Buffer.concat(chunks);
      const path = await writeFile('concurrent.bin', content);
      const handle = await backend.open(path);

      // Fire 100 concurrent reads — one per chunk — and verify
      // each returns the right slice. `fileHandle.read` is
      // expected to be safe under concurrent invocation (Node
      // serialises the underlying pread internally).
      const reads = chunks.map((_, i) =>
        backend.readRange(handle, i * 10, 10).then((buf) => ({
          i,
          got: buf.toString('utf-8'),
        })),
      );
      const results = await Promise.all(reads);

      for (const { i, got } of results) {
        expect(got).toBe(i.toString().padStart(10, '0'));
      }
      await backend.close(handle);
    });
  });

  describe('configuration', () => {
    it('uses the default name when no options are passed', () => {
      const b = new FsReadMmapBackend();
      expect(b.name).toBe('fs-read');
    });

    it('honours a custom name', () => {
      const b = new FsReadMmapBackend({ name: 'custom-fs' });
      expect(b.name).toBe('custom-fs');
    });
  });
});
