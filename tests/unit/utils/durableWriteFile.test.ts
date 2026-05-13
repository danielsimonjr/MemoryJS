/**
 * Shared durableWriteFile helper tests
 *
 * Locks the contract that GraphStorage / JsonlColumnStore /
 * DiskWarmTier / BrotliColdTier / FileSegmentStorage all rely on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { durableWriteFile } from '../../../src/utils/durableWriteFile.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `dwf-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('durableWriteFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('writes a string and the result is readable', async () => {
    const target = join(dir, 'out.txt');
    await durableWriteFile(target, 'hello world');
    expect(await fs.readFile(target, 'utf-8')).toBe('hello world');
  });

  it('writes a Buffer and the result is byte-identical', async () => {
    const target = join(dir, 'out.bin');
    const payload = Buffer.from([0, 1, 2, 255, 254, 253]);
    await durableWriteFile(target, payload);
    const back = await fs.readFile(target);
    expect(back.equals(payload)).toBe(true);
  });

  it('replaces an existing file atomically', async () => {
    const target = join(dir, 'out.txt');
    await fs.writeFile(target, 'old');
    await durableWriteFile(target, 'new');
    expect(await fs.readFile(target, 'utf-8')).toBe('new');
  });

  it('creates the parent directory if missing (segment-storage use case)', async () => {
    const target = join(dir, 'nested/deep/dir/out.txt');
    await durableWriteFile(target, 'hi');
    expect(await fs.readFile(target, 'utf-8')).toBe('hi');
  });

  it('cleans up the tmp file on success (no .tmp.* siblings remain)', async () => {
    const target = join(dir, 'out.txt');
    await durableWriteFile(target, 'hello');
    const entries = await fs.readdir(dir);
    const tmpFiles = entries.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toEqual([]);
  });

  it('handles empty content (string)', async () => {
    const target = join(dir, 'empty.txt');
    await durableWriteFile(target, '');
    const stat = await fs.stat(target);
    expect(stat.size).toBe(0);
  });

  it('handles empty content (Buffer)', async () => {
    const target = join(dir, 'empty.bin');
    await durableWriteFile(target, Buffer.alloc(0));
    const stat = await fs.stat(target);
    expect(stat.size).toBe(0);
  });
});
