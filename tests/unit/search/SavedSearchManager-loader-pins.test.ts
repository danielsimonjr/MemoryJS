/**
 * SavedSearchManager loader pins
 *
 * Pins how the saved-search loader reads its JSONL sidecar: a missing file,
 * the cache, the name index, malformed lines, blank lines, CRLF line ends, a
 * BOM, non-object values, a null line, an empty file and a non-ENOENT read
 * error. Each expected value is the output of the loader before the shared
 * JSONL reader existed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SavedSearchManager } from '../../../src/search/SavedSearchManager.js';
import type { BasicSearch } from '../../../src/search/BasicSearch.js';
import { logger } from '../../../src/utils/logger.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const readFileSpy = vi.mocked(fsPromises.readFile);

const SEARCH_URGENT = '{"name":"urgent","query":"bug","createdAt":"2026-01-01T00:00:00.000Z","useCount":0}';
const SEARCH_REVIEW = '{"name":"review","query":"todo","createdAt":"2026-01-02T00:00:00.000Z","useCount":0}';

describe('SavedSearchManager loader (pins)', () => {
  let testDir: string;
  let filePath: string;
  let manager: SavedSearchManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `search-loader-pins-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    filePath = join(testDir, 'saved-searches.jsonl');
    // The loader never calls the basic search, so an empty stand-in is enough.
    manager = new SavedSearchManager(filePath, {} as BasicSearch);
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
    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[]');
    expect(await manager.getSavedSearch('urgent')).toBeNull();
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenNthCalledWith(1, filePath, 'utf-8');

    await fs.writeFile(filePath, `${SEARCH_URGENT}\n`);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it('does not read the file again on a second call', async () => {
    await fs.writeFile(filePath, `${SEARCH_URGENT}\n`);

    const first = JSON.stringify(await manager.listSavedSearches());
    const second = JSON.stringify(await manager.listSavedSearches());

    expect(first).toBe(`[${SEARCH_URGENT}]`);
    expect(second).toBe(`[${SEARCH_URGENT}]`);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenNthCalledWith(1, filePath, 'utf-8');
  });

  it('skips a malformed line silently and finds the others by name', async () => {
    await fs.writeFile(filePath, `${SEARCH_URGENT}\n{"name":"broken",\n${SEARCH_REVIEW}\n`);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[${SEARCH_URGENT},${SEARCH_REVIEW}]`);
    expect(JSON.stringify(await manager.getSavedSearch('review'))).toBe(SEARCH_REVIEW);
    expect(await manager.getSavedSearch('broken')).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips blank and whitespace-only lines and accepts CRLF line ends', async () => {
    await fs.writeFile(filePath, `${SEARCH_URGENT}\r\n\r\n   \r\n${SEARCH_REVIEW}\r\n`);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[${SEARCH_URGENT},${SEARCH_REVIEW}]`);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips a first line that starts with a byte order mark', async () => {
    await fs.writeFile(filePath, `﻿${SEARCH_URGENT}\n${SEARCH_REVIEW}\n`);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[${SEARCH_REVIEW}]`);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps lines that parse to a non-object value as parsed', async () => {
    await fs.writeFile(filePath, '5\n"text"\n{"foo":1}\n');

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[5,"text",{"foo":1}]');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws a TypeError for a null line and keeps the list cached', async () => {
    await fs.writeFile(filePath, `null\n${SEARCH_URGENT}\n`);

    await expect(manager.listSavedSearches()).rejects.toThrow(TypeError);

    // The list is cached before the name index is built, so the second call
    // returns it without a read and without the throw.
    expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[null,${SEARCH_URGENT}]`);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it('gives an empty list for an empty file', async () => {
    await fs.writeFile(filePath, '');

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[]');
  });

  it('rethrows a non-ENOENT read error and does not cache it', async () => {
    const readError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    readFileSpy.mockRejectedValueOnce(readError);

    await expect(manager.listSavedSearches()).rejects.toBe(readError);
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it('rethrows the TypeError of a non-string read result and does not cache it', async () => {
    readFileSpy.mockResolvedValueOnce(Buffer.from(`${SEARCH_URGENT}
`) as unknown as string);

    await expect(manager.listSavedSearches()).rejects.toMatchObject({
      name: 'TypeError',
      message: 'data.split is not a function',
    });
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[]');
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it('parses each non-blank line once, untrimmed and with one argument', async () => {
    const lines = [SEARCH_URGENT, '', '   ', '{"broken":', SEARCH_REVIEW];
    await fs.writeFile(filePath, `${lines.join('\r\n')}\r\n`);
    const candidates = new Set([...lines.map((line) => `${line}\r`), '']);
    const parseSpy = vi.spyOn(JSON, 'parse');

    try {
      await manager.listSavedSearches();

      const mine = parseSpy.mock.calls.filter(([text]) => candidates.has(text as string));
      expect(mine).toEqual([[`${SEARCH_URGENT}\r`], ['{"broken":\r'], [`${SEARCH_REVIEW}\r`]]);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('keeps the last line of a file that has no final newline', async () => {
    await fs.writeFile(filePath, `${SEARCH_URGENT}\n${SEARCH_REVIEW}`);

    expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[${SEARCH_URGENT},${SEARCH_REVIEW}]`);
  });

  it('does not split a line at a lone carriage return inside it', async () => {
    await fs.writeFile(filePath, '{"name":"urgent"\r,"query":"bug"}\n');

    expect(JSON.stringify(await manager.listSavedSearches())).toBe('[{"name":"urgent","query":"bug"}]');
  });

  it('keeps duplicate lines and every line of a long file', async () => {
    const rows: string[] = [];
    for (let i = 0; i < 3000; i++) {
      rows.push(`{"name":"k${i % 1500}","n":${i}}`);
    }
    await fs.writeFile(filePath, `${rows.join('\n')}\n`);

    const records = (await manager.listSavedSearches()) as unknown as { n: number }[];

    expect(records.length).toBe(3000);
    expect(records[0].n).toBe(0);
    expect(records[1500].n).toBe(1500);
    expect(records[2999].n).toBe(2999);
  });

  it('skips only the line for which JSON.parse throws, whatever the error class', async () => {
    const third = '{"name":"third","query":"todo","createdAt":"2026-01-03T00:00:00.000Z","useCount":0}';
    await fs.writeFile(filePath, `${SEARCH_URGENT}\n${SEARCH_REVIEW}\n${third}\n`);
    const realParse = JSON.parse.bind(JSON);
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      if (text === SEARCH_REVIEW) throw new RangeError('stand-in');
      return realParse(text, reviver);
    });

    try {
      expect(JSON.stringify(await manager.listSavedSearches())).toBe(`[${SEARCH_URGENT},${third}]`);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('logs nothing for a missing file', async () => {
    await manager.listSavedSearches();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  // The read is mocked to resolve at once, so each turn count is a microtask count.
  it('settles a cache miss in a fixed number of microtask turns', async () => {
    readFileSpy.mockResolvedValueOnce(`${SEARCH_URGENT}\n`);

    expect(await microtaskTicks(manager.listSavedSearches())).toBe(3);
  });

  it('settles an ENOENT miss in a fixed number of microtask turns', async () => {
    readFileSpy.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    expect(await microtaskTicks(manager.listSavedSearches())).toBe(3);
  });

  it('settles a cache hit in a fixed number of microtask turns', async () => {
    readFileSpy.mockResolvedValueOnce(`${SEARCH_URGENT}\n`);
    await manager.listSavedSearches();

    expect(await microtaskTicks(manager.listSavedSearches())).toBe(2);
  });
});
