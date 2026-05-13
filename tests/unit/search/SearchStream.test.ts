/**
 * SearchStream Smoke Tests
 */

import { describe, it, expect } from 'vitest';
import {
  streamArrayInChunks,
  streamMergedByScore,
  collectStream,
  type ScoredItem,
} from '../../../src/search/SearchStream.js';

describe('streamArrayInChunks', () => {
  it('yields every element in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await collectStream(streamArrayInChunks(items, 2));
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles empty source', async () => {
    const out = await collectStream(streamArrayInChunks<number>([], 5));
    expect(out).toEqual([]);
  });

  it('chunkSize <= 0 still produces the full output', async () => {
    const out = await collectStream(streamArrayInChunks([1, 2, 3], 0));
    expect(out).toEqual([1, 2, 3]);
  });

  it('breaking from the consumer stops materialising further items', async () => {
    const items = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    for await (const x of streamArrayInChunks(items, 1)) {
      seen.push(x);
      if (x === 3) break;
    }
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('streamMergedByScore', () => {
  async function* fromArray<T>(items: ScoredItem<T>[]): AsyncIterable<ScoredItem<T>> {
    for (const i of items) yield i;
  }

  it('merges single source unchanged', async () => {
    const src = fromArray([
      { score: 0.9, value: 'a' },
      { score: 0.5, value: 'b' },
    ]);
    const out = await collectStream(streamMergedByScore([src]));
    expect(out.map((x) => x.value)).toEqual(['a', 'b']);
  });

  it('merges two pre-sorted sources, highest score first', async () => {
    const semantic = fromArray([
      { score: 0.9, value: 'sem-a' },
      { score: 0.5, value: 'sem-b' },
    ]);
    const lexical = fromArray([
      { score: 0.8, value: 'lex-a' },
      { score: 0.4, value: 'lex-b' },
    ]);
    const out = await collectStream(streamMergedByScore([semantic, lexical]));
    expect(out.map((x) => x.value)).toEqual(['sem-a', 'lex-a', 'sem-b', 'lex-b']);
  });

  it('exhausting one source still drains the other', async () => {
    const a = fromArray([{ score: 0.9, value: 'a1' }]);
    const b = fromArray([
      { score: 0.7, value: 'b1' },
      { score: 0.5, value: 'b2' },
    ]);
    const out = await collectStream(streamMergedByScore([a, b]));
    expect(out.map((x) => x.value)).toEqual(['a1', 'b1', 'b2']);
  });

  it('limit via collectStream caps the output', async () => {
    const a = fromArray([
      { score: 1.0, value: 'x' },
      { score: 0.9, value: 'y' },
      { score: 0.8, value: 'z' },
    ]);
    const out = await collectStream(streamMergedByScore([a]), 2);
    expect(out.map((x) => x.value)).toEqual(['x', 'y']);
  });
});
