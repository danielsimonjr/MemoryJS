/**
 * Unit tests for walkParents, the parent walk shared by path reconstruction.
 */
import { describe, it, expect } from 'vitest';
import { walkParents } from '../../../src/utils/relationHelpers.js';

type Link = { parent: string; relation: string };

describe('walkParents', () => {
  it('returns nodes from the root to the target and one relation per link', () => {
    const parents = new Map<string, Link | null>([
      ['A', null],
      ['B', { parent: 'A', relation: 'ab' }],
      ['C', { parent: 'B', relation: 'bc' }],
      ['D', { parent: 'C', relation: 'cd' }],
    ]);

    expect(walkParents('D', parents)).toStrictEqual({
      nodes: ['A', 'B', 'C', 'D'],
      relations: ['ab', 'bc', 'cd'],
    });
  });

  it('returns the target alone when it has no parent entry', () => {
    const parents = new Map<string, Link | null>();

    expect(walkParents('X', parents)).toStrictEqual({ nodes: ['X'], relations: [] });
  });

  it('stops at a root whose entry is null', () => {
    const parents = new Map<string, Link | null>([
      ['A', null],
      ['B', { parent: 'A', relation: 'ab' }],
    ]);

    expect(walkParents('B', parents)).toStrictEqual({ nodes: ['A', 'B'], relations: ['ab'] });
    expect(walkParents('A', parents)).toStrictEqual({ nodes: ['A'], relations: [] });
  });

  it('keeps the relation object by reference', () => {
    const relation = { type: 'knows' };
    const parents = new Map<string, { parent: string; relation: typeof relation } | null>([
      ['A', null],
      ['B', { parent: 'A', relation }],
    ]);

    expect(walkParents('B', parents).relations[0]).toBe(relation);
  });

  it('does not stop on a cycle: the walk reads the map until the caller stops it', () => {
    const parents = new Map<string, Link | null>([
      ['A', { parent: 'B', relation: 'ab' }],
      ['B', { parent: 'A', relation: 'ba' }],
    ]);
    let reads = 0;
    const guarded = {
      get: (key: string) => {
        if (++reads > 20) throw new Error('GUARD');
        return parents.get(key);
      },
    } as unknown as Map<string, Link | null>;

    expect(() => walkParents('A', guarded)).toThrow('GUARD');
    expect(reads).toBe(21);
  });
});
