import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, appendFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';

const entity = (name: string, word: string) => ({ name, entityType: 'test', observations: [word] });

describe('TF-IDF lazy statistics and journal persistence', () => {
  let dir: string;
  let manager: TFIDFIndexManager;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memory-lazy-idf-'));
    manager = new TFIDFIndexManager(dir);
    await manager.buildIndex({ entities: [entity('one', 'rare'), entity('two', 'common')], relations: [] });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('keeps retained map reads, entries, values and forEach current without scanning the vocabulary', () => {
    const idf = manager.getIndex()!.idf;
    const iterator = vi.spyOn(idf, 'entries');
    manager.addDocument(entity('three', 'common'));
    expect(iterator).not.toHaveBeenCalled();
    expect(idf.get('rare')).toBe(Math.log(3));
    expect(new Map(idf).get('rare')).toBe(Math.log(3));
    const visited = new Map<string, number>();
    idf.forEach((value, key) => visited.set(key, value));
    expect(visited.get('rare')).toBe(Math.log(3));
    expect([...idf.values()]).toContain(Math.log(3));
    manager.removeDocument('one');
    expect(idf.has('rare')).toBe(false);
    expect(idf.get('common')).toBe(0);
  });

  it('persists only changed documents after the initial snapshot and reloads updates and deletes', async () => {
    await manager.saveIndex();
    const snapshotPath = join(dir, '.indexes/tfidf-index.json');
    const snapshot = await readFile(snapshotPath, 'utf8');
    manager.updateDocument(entity('one', 'replacement'));
    manager.removeDocument('two');
    manager.addDocument(entity('three', 'additional'));
    await Promise.all([manager.saveIndex(), manager.saveIndex()]);
    expect(await readFile(snapshotPath, 'utf8')).toBe(snapshot);
    const restored = await new TFIDFIndexManager(dir).loadIndex();
    expect([...restored!.documents.keys()]).toEqual(['one', 'three']);
    expect(restored!.idf.has('rare')).toBe(false);
    expect(restored!.idf.get('replacement')).toBe(Math.log(2));
  });

  it('replaces an external snapshot before saving subsequent own deltas', async () => {
    await manager.saveIndex();
    const external = new TFIDFIndexManager(join(dir, 'external'));
    await manager.saveIndex(await external.buildIndex({ entities: [entity('external', 'outside')], relations: [] }));
    manager.addDocument(entity('three', 'additional'));
    await manager.saveIndex();
    expect([...(await new TFIDFIndexManager(dir).loadIndex())!.documents.keys()]).toEqual(['one', 'two', 'three']);
  });

  it('preserves document insertion order through delete/recreate and coalesced saves', async () => {
    await manager.saveIndex();
    manager.removeDocument('one');
    manager.addDocument(entity('three', 'additional'));
    manager.addDocument(entity('one', 'returned'));
    manager.removeDocument('three');
    manager.addDocument(entity('four', 'fourth'));
    manager.addDocument(entity('three', 'returnedtoo'));
    await manager.saveIndex();
    expect([...(await new TFIDFIndexManager(dir).loadIndex())!.documents.keys()])
      .toEqual([...manager.getIndex()!.documents.keys()]);
  });

  it('materializes public Map storage for native cloning after mutations', () => {
    manager.addDocument(entity('three', 'common'));
    const native = structuredClone(manager.getIndex()!);
    expect(native.idf.get('rare')).toBe(Math.log(3));
  });

  it('recovers and repairs an interrupted final journal append', async () => {
    await manager.saveIndex();
    manager.addDocument(entity('three', 'additional'));
    await manager.saveIndex();
    const journal = join(dir, '.indexes/tfidf-index.json.journal');
    await appendFile(journal, '{"interrupted":');
    const restored = new TFIDFIndexManager(dir);
    expect((await restored.loadIndex())!.documents.has('three')).toBe(true);
    restored.addDocument(entity('four', 'final'));
    await restored.saveIndex();
    expect((await new TFIDFIndexManager(dir).loadIndex())!.documents.has('four')).toBe(true);
  });

  it('ignores old journal generations after a snapshot replacement', async () => {
    await manager.saveIndex();
    manager.addDocument(entity('three', 'additional'));
    await manager.saveIndex();
    const journalPath = join(dir, '.indexes/tfidf-index.json.journal');
    const oldJournal = await readFile(journalPath, 'utf8');
    await manager.buildIndex({ entities: [entity('fresh', 'freshword')], relations: [] });
    await manager.saveIndex();
    await writeFile(journalPath, oldJournal);
    expect([...(await new TFIDFIndexManager(dir).loadIndex())!.documents.keys()]).toEqual(['fresh']);
  });
});
