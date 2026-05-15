/**
 * SpellChecker — spell-correction layer over NGramIndex + Levenshtein.
 *
 * Covers:
 * - vocabulary auto-built from entity names + tags
 * - suggest() returns close matches sorted by score
 * - exact match scores higher than near-match
 * - respects minScore filter
 * - respects maxDistance filter
 * - empty graph → empty suggestions
 * - explicit rebuild after entity changes picks up new names
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpellChecker } from '../../../src/search/SpellChecker.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';

function createMockStorage(entities: Entity[]): IGraphStorage & { _entities: Entity[] } {
  const store = [...entities];
  return {
    _entities: store,
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: [...store], relations: [] };
    },
  } as unknown as IGraphStorage & { _entities: Entity[] };
}

function makeEntity(name: string, tags: string[] = []): Entity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'person',
    observations: [],
    createdAt: now,
    lastModified: now,
    importance: 5,
    tags,
  } as Entity;
}

describe('SpellChecker', () => {
  it('returns the closest matches when query is misspelled', async () => {
    const storage = createMockStorage([
      makeEntity('Alice'),
      makeEntity('Bob'),
      makeEntity('Charlie'),
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('Alcie'); // typo for Alice
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.correction).toBe('Alice');
  });

  it('exact matches score higher than near-matches', async () => {
    const storage = createMockStorage([
      makeEntity('Alice'),
      makeEntity('Alicia'),
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('Alice');
    expect(suggestions[0]!.correction).toBe('Alice');
    expect(suggestions[0]!.score).toBeGreaterThan(suggestions[1]?.score ?? 0);
  });

  it('returns empty when graph has no entities', async () => {
    const storage = createMockStorage([]);
    const sc = new SpellChecker(storage);
    expect(await sc.suggest('anything')).toEqual([]);
  });

  it('returns empty for an unrelated query (below minScore)', async () => {
    const storage = createMockStorage([
      makeEntity('Alice'),
      makeEntity('Bob'),
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('xyz', { minScore: 0.5 });
    expect(suggestions).toEqual([]);
  });

  it('respects limit', async () => {
    const storage = createMockStorage([
      makeEntity('Alice'),
      makeEntity('Alicia'),
      makeEntity('Alicent'),
      makeEntity('Alis'),
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('Alic', { limit: 2 });
    expect(suggestions).toHaveLength(2);
  });

  it('respects maxDistance', async () => {
    const storage = createMockStorage([
      makeEntity('Alice'),     // distance 0 from 'Alice'
      makeEntity('Bob'),       // distance 5 from 'Alice'
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('Alice', { maxDistance: 1 });
    expect(suggestions.map((s) => s.correction)).toEqual(['Alice']);
  });

  it('includes tag aliases in the vocabulary', async () => {
    const storage = createMockStorage([
      makeEntity('e1', ['typescript', 'javascript']),
      makeEntity('e2', ['python']),
    ]);
    const sc = new SpellChecker(storage);
    const suggestions = await sc.suggest('typescrpt'); // typo
    expect(suggestions[0]!.correction).toBe('typescript');
  });

  it('rebuild picks up new entity names after the cache was warmed', async () => {
    const storage = createMockStorage([makeEntity('Alice')]);
    const sc = new SpellChecker(storage);
    await sc.suggest('Alice'); // warm cache
    storage._entities.push(makeEntity('Aaron'));
    await sc.rebuild();
    const suggestions = await sc.suggest('Aron');
    expect(suggestions[0]!.correction).toBe('Aaron');
  });

  it('vocabulary respects the includeTags option (off)', async () => {
    const storage = createMockStorage([
      makeEntity('e1', ['typescript']),
    ]);
    const sc = new SpellChecker(storage, { includeTags: false });
    const suggestions = await sc.suggest('typescript');
    expect(suggestions).toEqual([]); // tag is NOT in vocab
  });
});
