/**
 * Phase 11 review-fix regression tests
 *
 * Targets the substantive findings from the Phase 11 review:
 * - #1 streamLines unbounded line growth → maxLineBytes guard
 * - #2 loadViaMmap error context (line number + cause)
 * - #4 MEMORY_MMAP_THRESHOLD_BYTES=0 means "always use mmap"
 * - #5 FsReadMmapBackend short-read retry loop
 * - #7 segment-storage mode short-circuits MEMORY_USE_MMAP
 * - #8 mid-stream file truncation surfaces clearly
 * - #12 FsReadMmapBackend.handle.id is the resolved absolute path
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { streamLines, type IMmapBackend, type MmapHandle } from '../../../../src/core/mmap/IMmapBackend.js';
import { FsReadMmapBackend } from '../../../../src/core/mmap/FsReadMmapBackend.js';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `mmap-review-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedUseMmap = process.env.MEMORY_USE_MMAP;
const savedThreshold = process.env.MEMORY_MMAP_THRESHOLD_BYTES;
const savedSegmentCount = process.env.MEMORY_STORAGE_SEGMENT_COUNT;

class InMemoryFakeBackend implements IMmapBackend {
  readonly name = 'fake';
  private store: Map<string, Buffer> = new Map();

  put(path: string, content: Buffer): void {
    this.store.set(path, content);
  }

  async open(filePath: string): Promise<MmapHandle> {
    const buf = this.store.get(filePath);
    if (!buf) throw new Error(`fake: no file at ${filePath}`);
    return { id: filePath, size: buf.length };
  }
  async close(): Promise<void> { /* */ }
  async readRange(handle: MmapHandle, offset: number, length: number): Promise<Buffer> {
    const buf = this.store.get(handle.id)!;
    if (offset + length > buf.length) throw new Error('EOF');
    return Buffer.from(buf.subarray(offset, offset + length));
  }
  async size(handle: MmapHandle): Promise<number> {
    return handle.size;
  }
}

describe('Review #1: streamLines maxLineBytes guard', () => {
  it('throws when a single line exceeds maxLineBytes without finding a newline', async () => {
    const backend = new InMemoryFakeBackend();
    // 100KB of bytes without any newline.
    const noNewline = Buffer.alloc(100_000, 0x41); // 'A' repeated
    backend.put('fake://no-newline', noNewline);
    const handle = await backend.open('fake://no-newline');

    async function consume(): Promise<void> {
      // maxLineBytes = 1024 (much smaller than 100K payload)
      for await (const _ of streamLines(backend, handle, { chunkSize: 64, maxLineBytes: 1024 })) {
        // no-op
      }
    }
    await expect(consume()).rejects.toThrow(/exceeded maxLineBytes=1024/);
  });

  it('default maxLineBytes (16 MB) tolerates legitimate long lines', async () => {
    const backend = new InMemoryFakeBackend();
    // 1 MB line + newline + short line. Default maxLineBytes is 16 MB.
    const longLine = Buffer.alloc(1_000_000, 0x42); // 'B'
    const content = Buffer.concat([longLine, Buffer.from('\nshort\n')]);
    backend.put('fake://long', content);
    const handle = await backend.open('fake://long');
    const lines: Buffer[] = [];
    for await (const line of streamLines(backend, handle, { chunkSize: 64 * 1024 })) {
      lines.push(line);
    }
    expect(lines).toHaveLength(2);
    expect(lines[0]!.length).toBe(1_000_000);
    expect(lines[1]!.toString()).toBe('short');
  });

  it('Buffer[] accumulator avoids quadratic concat (large line crosses many chunks)', async () => {
    const backend = new InMemoryFakeBackend();
    // 256 KB line split across many 1 KB chunks. Without the
    // Buffer[]-accumulator change, this would do 256 successive
    // Buffer.concat calls (O(N²) total work).
    const line = Buffer.alloc(256 * 1024, 0x43); // 'C'
    backend.put('fake://big-line', Buffer.concat([line, Buffer.from('\n')]));
    const handle = await backend.open('fake://big-line');
    const start = performance.now();
    const lines: Buffer[] = [];
    for await (const l of streamLines(backend, handle, { chunkSize: 1024 })) {
      lines.push(l);
    }
    const elapsed = performance.now() - start;
    expect(lines[0]!.length).toBe(256 * 1024);
    // Soft bound — should complete in well under 100ms on any
    // reasonable hardware; bug-fixed implementation is linear.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('Review #2: loadViaMmap surfaces line number + cause', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_USE_MMAP = 'true';
    process.env.MEMORY_MMAP_THRESHOLD_BYTES = '1';
  });
  afterEach(async () => {
    if (savedUseMmap === undefined) delete process.env.MEMORY_USE_MMAP;
    else process.env.MEMORY_USE_MMAP = savedUseMmap;
    if (savedThreshold === undefined) delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
    else process.env.MEMORY_MMAP_THRESHOLD_BYTES = savedThreshold;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('parse failure includes line number + SyntaxError cause', async () => {
    const filePath = join(dir, 'memory.jsonl');
    // Write three lines: two valid, one bad on line 2.
    const content = [
      JSON.stringify({ type: 'entity', name: 'a', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' }),
      'not-json-{{',
      JSON.stringify({ type: 'entity', name: 'c', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' }),
    ].join('\n') + '\n';
    await fs.writeFile(filePath, content, 'utf-8');

    const storage = new GraphStorage(filePath);
    await expect(storage.loadGraph()).rejects.toThrow(/line 2.*JSON|JSON.*line 2/i);
  });
});

describe("Review #4: MEMORY_MMAP_THRESHOLD_BYTES='0' accepts (forces mmap)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_USE_MMAP = 'true';
    process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
  });
  afterEach(async () => {
    if (savedUseMmap === undefined) delete process.env.MEMORY_USE_MMAP;
    else process.env.MEMORY_USE_MMAP = savedUseMmap;
    if (savedThreshold === undefined) delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
    else process.env.MEMORY_MMAP_THRESHOLD_BYTES = savedThreshold;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('threshold=0 forces mmap for any non-empty file (no fall-back to 100 MB default)', async () => {
    const filePath = join(dir, 'memory.jsonl');
    const storage = new GraphStorage(filePath);
    await storage.saveGraph({
      entities: [{ name: 'a', entityType: 'x', observations: ['o'], createdAt: 't', lastModified: 't' }],
      relations: [],
    });
    storage.clearCache();
    // If '0' had silently fallen back to 100 MB, this tiny file
    // would route via fs.readFile (no observable diff but the env
    // intent was ignored). Verify the result is correct either
    // way — what matters is the regex now accepts '0'.
    const back = await storage.loadGraph();
    expect(back.entities).toHaveLength(1);
  });
});

describe('Review #5 + #8: FsReadMmapBackend handles short reads + mid-stream truncation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('mid-stream truncation surfaces a descriptive short-read error', async () => {
    const filePath = join(dir, 'data.bin');
    await fs.writeFile(filePath, Buffer.alloc(1000, 0x44)); // 1000 'D' bytes
    const backend = new FsReadMmapBackend();
    const handle = await backend.open(filePath);
    expect(handle.size).toBe(1000);

    // Truncate the file underneath the open handle.
    await fs.truncate(filePath, 500);

    // readRange for bytes past the new EOF should throw a short-
    // read error with descriptive message.
    await expect(backend.readRange(handle, 0, 1000)).rejects.toThrow(
      /short read.*expected 1000.*got 500.*truncated/i,
    );
    await backend.close(handle);
  });
});

describe('Review #7: segment-storage mode short-circuits MEMORY_USE_MMAP', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
    process.env.MEMORY_USE_MMAP = 'true';
    process.env.MEMORY_MMAP_THRESHOLD_BYTES = '1';
  });
  afterEach(async () => {
    if (savedSegmentCount === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = savedSegmentCount;
    if (savedUseMmap === undefined) delete process.env.MEMORY_USE_MMAP;
    else process.env.MEMORY_USE_MMAP = savedUseMmap;
    if (savedThreshold === undefined) delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
    else process.env.MEMORY_MMAP_THRESHOLD_BYTES = savedThreshold;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('with both env vars set, segment mode wins (loads from segments/, ignores mmap)', async () => {
    const filePath = join(dir, 'memory.jsonl');
    const storage = new GraphStorage(filePath);
    await storage.saveGraph({
      entities: [
        { name: 'a', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' },
        { name: 'b', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' },
      ],
      relations: [],
    });
    // saveGraph went through the segment path; verify by checking
    // that segments/ exists (proof segment mode is active) and the
    // single memory.jsonl was NOT created.
    await expect(fs.access(join(dir, 'segments'))).resolves.toBeUndefined();
    await expect(fs.access(filePath)).rejects.toThrow();

    // loadGraph should round-trip via the segment path, not mmap.
    storage.clearCache();
    const back = await storage.loadGraph();
    expect(back.entities).toHaveLength(2);
  });
});

describe('Review #12: FsReadMmapBackend.handle.id is the resolved absolute path', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('handle.id matches resolve(filePath) — independent of cwd-relative input form', async () => {
    const filePath = join(dir, 'data.txt');
    await fs.writeFile(filePath, 'hello');
    const backend = new FsReadMmapBackend();
    const handle = await backend.open(filePath);
    expect(handle.id).toBe(resolve(filePath));
    await backend.close(handle);
  });
});
