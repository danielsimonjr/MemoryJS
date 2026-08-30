/**
 * durableWriteFile unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  durableWriteFile,
  restrictSensitiveFilePermissions,
} from '../../../src/utils/durableWriteFile.js';

describe('durableWriteFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `durable-write-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
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
