/**
 * durableWriteFile unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  durableWriteFile,
  durableAppendFile,
  restrictSensitiveFilePermissions,
} from '../../../src/utils/durableWriteFile.js';

describe('durableWriteFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `durable-write-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes string content atomically', async () => {
    const target = join(dir, 'nested', 'file.txt');
    await durableWriteFile(target, 'hello world');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello world');
  });

  it('writes Buffer content', async () => {
    const target = join(dir, 'bin.dat');
    const buf = Buffer.from([0x00, 0xff, 0x42]);
    await durableWriteFile(target, buf);
    const read = await fs.readFile(target);
    expect(read.equals(buf)).toBe(true);
  });

  it('replaces existing file', async () => {
    const target = join(dir, 'replace.txt');
    await durableWriteFile(target, 'v1');
    await durableWriteFile(target, 'v2');
    expect(await fs.readFile(target, 'utf8')).toBe('v2');
  });

  for (const write of [durableWriteFile, durableAppendFile]) {
    it(`${write.name} completes partial writes without losing UTF-8 bytes`, async () => {
      const target = join(dir, 'short-write.txt');
      const content = 'α🙂—complete'.repeat(10);
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
        const handle = await open(...args);
        const realWrite = handle.write.bind(handle);
        vi.spyOn(handle, 'write').mockImplementation(async (input: any, offset = 0, length?: number) => {
          const bytes = typeof input === 'string' ? Buffer.from(input) : input;
          return realWrite(bytes, offset, Math.min(3, length ?? bytes.length), null);
        });
        return handle;
      });
      await write(target, content);
      expect(await fs.readFile(target, 'utf8')).toBe(content);
    });
  }

  it('rejects zero-progress writes without replacing the old file', async () => {
    const target = join(dir, 'no-progress.txt');
    await fs.writeFile(target, 'original');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      vi.spyOn(handle, 'write').mockResolvedValue({ bytesWritten: 0, buffer: Buffer.alloc(0) });
      return handle;
    });
    await expect(durableWriteFile(target, 'replacement')).rejects.toThrow(/no progress/);
    expect(await fs.readFile(target, 'utf8')).toBe('original');
  });

  describe('Windows rename interference', () => {
    const realPlatform = process.platform;
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: realPlatform });
    });

    it('never truncates the live file when the rename keeps failing', async () => {
      const target = join(dir, 'live.jsonl');
      await fs.writeFile(target, 'previous generation');
      const eperm = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      vi.spyOn(fs, 'rename').mockRejectedValue(eperm);
      const realOpen = fs.open.bind(fs);
      const opens: string[] = [];
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        opens.push(`${String(args[0])}|${String(args[1])}`);
        return realOpen(...args);
      });

      await expect(durableWriteFile(target, 'next generation')).rejects.toThrow(/EPERM|replace/);

      expect(await fs.readFile(target, 'utf8')).toBe('previous generation');
      expect(opens.some(o => o.startsWith(`${target}|w`))).toBe(false);
      const leftovers = (await fs.readdir(dir)).filter(n => n.startsWith('live.jsonl.tmp.'));
      expect(leftovers).toHaveLength(1);
      expect(await fs.readFile(join(dir, leftovers[0]), 'utf8')).toBe('next generation');
    });

    it('keeps only the newest synced tmp after repeated failed replaces', async () => {
      const target = join(dir, 'locked.jsonl');
      await fs.writeFile(target, 'previous');
      vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
      await expect(durableWriteFile(target, 'first')).rejects.toThrow();
      await expect(durableWriteFile(target, 'second')).rejects.toThrow();

      const leftovers = (await fs.readdir(dir)).filter(n => n.startsWith('locked.jsonl.tmp.'));
      expect(leftovers).toHaveLength(1);
      expect(await fs.readFile(join(dir, leftovers[0]), 'utf8')).toBe('second');
      expect(await fs.readFile(target, 'utf8')).toBe('previous');
    });

    it('retries a transient rename failure and then replaces the file', async () => {
      const target = join(dir, 'transient.jsonl');
      await fs.writeFile(target, 'old');
      const rename = fs.rename.bind(fs);
      const eperm = Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      vi.spyOn(fs, 'rename').mockRejectedValueOnce(eperm).mockRejectedValueOnce(eperm)
        .mockImplementation((a, b) => rename(a, b));

      await durableWriteFile(target, 'new');
      expect(await fs.readFile(target, 'utf8')).toBe('new');
    });
  });

  describe('directory fsync', () => {
    it('syncs the parent directory after the rename', async () => {
      const target = join(dir, 'dirsync.txt');
      const realOpen = fs.open.bind(fs);
      const opened: string[] = [];
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        opened.push(String(args[0]));
        return realOpen(...args);
      });
      await durableWriteFile(target, 'x');
      expect(opened).toContain(dir);
    });

    for (const code of ['EISDIR', 'EPERM', 'EINVAL']) {
      it(`tolerates ${code} from a platform without directory fsync`, async () => {
        const target = join(dir, `tolerate-${code}.txt`);
        const realOpen = fs.open.bind(fs);
        vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
          if (String(args[0]) === dir) throw Object.assign(new Error(code), { code });
          return realOpen(...args);
        });
        await durableWriteFile(target, 'ok');
        expect(await fs.readFile(target, 'utf8')).toBe('ok');
      });
    }

    it('propagates an unexpected directory fsync error', async () => {
      const target = join(dir, 'dir-eio.txt');
      const realOpen = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]) === dir) throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return realOpen(...args);
      });
      await expect(durableWriteFile(target, 'x')).rejects.toThrow(/EIO/);
    });
  });

  it('restrictSensitiveFilePermissions tightens mode', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply
    const target = join(dir, 'secret.txt');
    await durableWriteFile(target, 'secret');
    await fs.chmod(target, 0o644);
    await restrictSensitiveFilePermissions(target);
    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('restrictSensitiveFilePermissions preserves tighter mode', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply
    const target = join(dir, 'locked.txt');
    await durableWriteFile(target, 'x');
    await fs.chmod(target, 0o400);
    await restrictSensitiveFilePermissions(target);
    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o400);
  });
});
