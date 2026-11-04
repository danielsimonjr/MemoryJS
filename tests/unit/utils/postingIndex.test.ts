/**
 * Direct unit tests for removeIdFromPostings (CMP-5).
 */

import { describe, it, expect } from 'vitest';
import { removeIdFromPostings } from '../../../src/utils/postingIndex.js';

describe('removeIdFromPostings', () => {
  it('removes the id from every named posting set', () => {
    const postings = new Map<string, Set<string>>([
      ['alpha', new Set(['d1', 'd2'])],
      ['beta', new Set(['d1', 'd3'])],
      ['gamma', new Set(['d4'])],
    ]);
    removeIdFromPostings(postings, ['alpha', 'beta'], 'd1');
    expect([...postings.get('alpha')!]).toEqual(['d2']);
    expect([...postings.get('beta')!]).toEqual(['d3']);
    expect([...postings.get('gamma')!]).toEqual(['d4']);
  });

  it('drops a posting set that becomes empty', () => {
    const postings = new Map<string, Set<string>>([['solo', new Set(['d1'])]]);
    removeIdFromPostings(postings, ['solo'], 'd1');
    expect(postings.has('solo')).toBe(false);
  });

  it('keeps a posting set that still holds other ids', () => {
    const postings = new Map<string, Set<string>>([['t', new Set(['d1', 'd2'])]]);
    removeIdFromPostings(postings, ['t'], 'd2');
    expect(postings.has('t')).toBe(true);
    expect([...postings.get('t')!]).toEqual(['d1']);
  });

  it('ignores unknown terms without creating entries', () => {
    const postings = new Map<string, Set<string>>([['a', new Set(['d1'])]]);
    removeIdFromPostings(postings, ['missing', 'a'], 'zzz');
    expect(postings.has('missing')).toBe(false);
    expect([...postings.get('a')!]).toEqual(['d1']);
    expect(postings.size).toBe(1);
  });

  it('returns without writing when terms is undefined', () => {
    const postings = new Map<string, Set<string>>([['a', new Set(['d1'])]]);
    removeIdFromPostings(postings, undefined, 'd1');
    expect([...postings.get('a')!]).toEqual(['d1']);
  });

  it('accepts any iterable of terms (generator input)', () => {
    const postings = new Map<number, Set<string>>([
      [1, new Set(['x'])],
      [2, new Set(['x', 'y'])],
    ]);
    function* terms(): Generator<number> {
      yield 1;
      yield 2;
    }
    removeIdFromPostings(postings, terms(), 'x');
    expect(postings.has(1)).toBe(false);
    expect([...postings.get(2)!]).toEqual(['y']);
  });

  it('does not touch a forward map the caller keeps separately', () => {
    const forward = new Map<string, string[]>([['d1', ['a', 'b']]]);
    const postings = new Map<string, Set<string>>([
      ['a', new Set(['d1'])],
      ['b', new Set(['d1'])],
    ]);
    removeIdFromPostings(postings, forward.get('d1'), 'd1');
    expect(forward.get('d1')).toEqual(['a', 'b']);
    expect(postings.size).toBe(0);
  });
});
