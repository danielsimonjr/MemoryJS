/**
 * TagManager alias loader pins
 *
 * Pins how the alias loader reads its JSONL sidecar: a missing file, the
 * cache, malformed lines, blank lines, CRLF line ends, a BOM, non-object
 * values, an empty file and a non-ENOENT read error. Each expected value is
 * the output of the loader before the shared JSONL reader existed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TagManager } from '../../../src/features/TagManager.js';
import { logger } from '../../../src/utils/logger.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const readFileSpy = vi.mocked(fsPromises.readFile);

const ALIAS_JS = '{"alias":"js","canonical":"javascript","createdAt":"2026-01-01T00:00:00.000Z"}';
const ALIAS_PY = '{"alias":"py","canonical":"python"}';
const ALIAS_TS = '{"alias":"ts","canonical":"typescript"}';

describe('TagManager alias loader (pins)', () => {
  let testDir: string;
  let filePath: string;
  let manager: TagManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tag-loader-pins-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    filePath = join(testDir, 'tag-aliases.jsonl');
    manager = new TagManager(filePath);
    readFileSpy.mockClear();
    vi.spyOn(logger, 'warn');
  });

  afterEach(async () => {
    vi.mocked(logger.warn).mockRestore();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('gives an empty list for a missing file and caches it', async () => {
    expect(JSON.stringify(await manager.listTagAliases())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenNthCalledWith(1, filePath, 'utf-8');

    await fs.writeFile(filePath, `${ALIAS_JS}\n`);

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it('does not read the file again on a second call', async () => {
    await fs.writeFile(filePath, `${ALIAS_JS}\n`);

    const first = JSON.stringify(await manager.listTagAliases());
    const second = JSON.stringify(await manager.listTagAliases());

    expect(first).toBe(`[${ALIAS_JS}]`);
    expect(second).toBe(`[${ALIAS_JS}]`);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenNthCalledWith(1, filePath, 'utf-8');
  });

  it('skips a malformed line silently and keeps the others in order', async () => {
    await fs.writeFile(filePath, `${ALIAS_JS}\n{"alias":"py",\n${ALIAS_TS}\n`);

    expect(JSON.stringify(await manager.listTagAliases())).toBe(`[${ALIAS_JS},${ALIAS_TS}]`);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips blank and whitespace-only lines and accepts CRLF line ends', async () => {
    await fs.writeFile(filePath, `${ALIAS_JS}\r\n\r\n   \r\n${ALIAS_PY}\r\n`);

    expect(JSON.stringify(await manager.listTagAliases())).toBe(`[${ALIAS_JS},${ALIAS_PY}]`);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips a first line that starts with a byte order mark', async () => {
    await fs.writeFile(filePath, `﻿${ALIAS_JS}\n${ALIAS_PY}\n`);

    expect(JSON.stringify(await manager.listTagAliases())).toBe(`[${ALIAS_PY}]`);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps lines that parse to a non-object value as parsed', async () => {
    await fs.writeFile(filePath, 'null\n5\n"text"\n{"foo":1}\n');

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[null,5,"text",{"foo":1}]');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives an empty list for an empty file', async () => {
    await fs.writeFile(filePath, '');

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[]');
  });

  it('rethrows a non-ENOENT read error and does not cache it', async () => {
    const readError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    readFileSpy.mockRejectedValueOnce(readError);

    await expect(manager.listTagAliases()).rejects.toBe(readError);
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it('rethrows the TypeError of a non-string read result and does not cache it', async () => {
    readFileSpy.mockResolvedValueOnce(Buffer.from(`${ALIAS_JS}
`) as unknown as string);

    await expect(manager.listTagAliases()).rejects.toMatchObject({
      name: 'TypeError',
      message: 'data.split is not a function',
    });
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it('parses each non-blank line once, untrimmed and with one argument', async () => {
    const lines = [ALIAS_JS, '', '   ', '{"broken":', ALIAS_PY];
    await fs.writeFile(filePath, `${lines.join('\r\n')}\r\n`);
    const candidates = new Set([...lines.map((line) => `${line}\r`), '']);
    const parseSpy = vi.spyOn(JSON, 'parse');

    try {
      await manager.listTagAliases();

      const mine = parseSpy.mock.calls.filter(([text]) => candidates.has(text as string));
      expect(mine).toEqual([[`${ALIAS_JS}\r`], ['{"broken":\r'], [`${ALIAS_PY}\r`]]);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('keeps the last line of a file that has no final newline', async () => {
    await fs.writeFile(filePath, `${ALIAS_JS}\n${ALIAS_PY}`);

    expect(JSON.stringify(await manager.listTagAliases())).toBe(`[${ALIAS_JS},${ALIAS_PY}]`);
  });

  it('does not split a line at a lone carriage return inside it', async () => {
    await fs.writeFile(filePath, '{"alias":"js"\r,"canonical":"javascript"}\n');

    expect(JSON.stringify(await manager.listTagAliases())).toBe('[{"alias":"js","canonical":"javascript"}]');
  });

  it('keeps duplicate lines and every line of a long file', async () => {
    const rows: string[] = [];
    for (let i = 0; i < 3000; i++) {
      rows.push(`{"alias":"k${i % 1500}","n":${i}}`);
    }
    await fs.writeFile(filePath, `${rows.join('\n')}\n`);

    const records = (await manager.listTagAliases()) as unknown as { n: number }[];

    expect(records.length).toBe(3000);
    expect(records[0].n).toBe(0);
    expect(records[1500].n).toBe(1500);
    expect(records[2999].n).toBe(2999);
  });

  // The read is mocked to resolve at once, so each turn count is a microtask count.
  it('settles a cache miss in a fixed number of microtask turns', async () => {
    readFileSpy.mockResolvedValueOnce(`${ALIAS_JS}\n`);

    expect(await microtaskTicks(manager.listTagAliases())).toBe(3);
  });

  it('settles an ENOENT miss in a fixed number of microtask turns', async () => {
    readFileSpy.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    expect(await microtaskTicks(manager.listTagAliases())).toBe(3);
  });

  it('settles a cache hit in a fixed number of microtask turns', async () => {
    readFileSpy.mockResolvedValueOnce(`${ALIAS_JS}\n`);
    await manager.listTagAliases();

    expect(await microtaskTicks(manager.listTagAliases())).toBe(2);
  });
});
