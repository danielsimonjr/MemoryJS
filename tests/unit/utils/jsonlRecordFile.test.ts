import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TagManager } from '../../../src/features/TagManager.js';
import { SavedSearchManager } from '../../../src/search/SavedSearchManager.js';
import type { BasicSearch } from '../../../src/search/BasicSearch.js';

vi.mock('fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const writeFileSpy = vi.mocked(fsPromises.writeFile);

describe('jsonlRecordFile helpers (clone pins)', () => {
  let testDir: string;
  let tagPath: string;
  let searchPath: string;
  let tagManager: TagManager;
  let searchManager: SavedSearchManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `jsonl-records-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    tagPath = join(testDir, 'tags.jsonl');
    searchPath = join(testDir, 'searches.jsonl');
    tagManager = new TagManager(tagPath);
    searchManager = new SavedSearchManager(searchPath, {} as BasicSearch);
    writeFileSpy.mockClear();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('removeTagAlias JS removes alias js but deleteSavedSearch JS does not remove name js', async () => {
    await tagManager.addTagAlias('js', 'javascript');
    await searchManager.saveSearch({ name: 'js', query: 'needle' });

    expect(await tagManager.removeTagAlias('JS')).toBe(true);
    expect(await searchManager.deleteSavedSearch('JS')).toBe(false);
    expect(await searchManager.getSavedSearch('js')).not.toBeNull();
  });

  it('deleteRecordsByKey returns false without changing file bytes', async () => {
    await tagManager.addTagAlias('js', 'javascript');
    const before = await fs.readFile(tagPath, 'utf-8');
    expect(await tagManager.removeTagAlias('missing')).toBe(false);
    expect(await fs.readFile(tagPath, 'utf-8')).toBe(before);
  });

  it('writeJsonlRecordsUpdatingCache writes no trailing newline', async () => {
    await tagManager.addTagAlias('js', 'javascript');
    const content = await fs.readFile(tagPath, 'utf-8');
    expect(content.endsWith('\n')).toBe(false);
  });

  it('nulls tag cache and both saved-search caches when writeFile throws', async () => {
    await tagManager.addTagAlias('js', 'javascript');
    await searchManager.saveSearch({ name: 'q', query: 'x' });
    await tagManager.listTagAliases();
    await searchManager.listSavedSearches();

    writeFileSpy.mockRejectedValueOnce(new Error('EPERM'));

    await expect(tagManager.addTagAlias('py', 'python')).rejects.toThrow('EPERM');
    expect(tagManager['aliasCache']).toBeNull();

    writeFileSpy.mockRejectedValueOnce(new Error('EPERM'));
    await expect(searchManager.saveSearch({ name: 'q2', query: 'y' })).rejects.toThrow('EPERM');
    expect(searchManager['searchCache']).toBeNull();
    expect(searchManager['searchIndex']).toBeNull();
  });
});
