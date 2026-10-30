import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TagManager } from '../../../src/features/TagManager.js';
import { SavedSearchManager } from '../../../src/search/SavedSearchManager.js';
import type { BasicSearch } from '../../../src/search/BasicSearch.js';

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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('keeps tag sidecar bytes when durable replace fails and nulls alias cache', async () => {
    await tagManager.addTagAlias('js', 'javascript');
    const before = await fs.readFile(tagPath);
    await tagManager.listTagAliases();

    // A persistent rejection: on Windows durableWriteFile retries a failed rename, so a single
    // rejection would be retried and the write would succeed.
    vi.spyOn(fs, 'rename').mockRejectedValue(
      Object.assign(new Error('EPERM'), { code: 'EPERM' }),
    );

    await expect(tagManager.addTagAlias('py', 'python')).rejects.toThrow(/EPERM|replace/);
    expect(await fs.readFile(tagPath)).toEqual(before);
    expect(tagManager['aliasCache']).toBeNull();
  });

  it('keeps saved-search sidecar bytes when durable replace fails and nulls caches', async () => {
    await searchManager.saveSearch({ name: 'q', query: 'x' });
    const before = await fs.readFile(searchPath);
    await searchManager.listSavedSearches();

    // A persistent rejection: on Windows durableWriteFile retries a failed rename, so a single
    // rejection would be retried and the write would succeed.
    vi.spyOn(fs, 'rename').mockRejectedValue(
      Object.assign(new Error('EPERM'), { code: 'EPERM' }),
    );

    await expect(searchManager.saveSearch({ name: 'q2', query: 'y' })).rejects.toThrow(/EPERM|replace/);
    expect(await fs.readFile(searchPath)).toEqual(before);
    expect(searchManager['searchCache']).toBeNull();
    expect(searchManager['searchIndex']).toBeNull();
  });
});
