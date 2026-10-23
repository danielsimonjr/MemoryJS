/**
 * Tests for the dot-path field getter
 *
 * @module tests/unit/utils/fieldPath.test
 */

import { describe, it, expect } from 'vitest';
import { getFieldByDotPath } from '../../../src/utils/fieldPath.js';

const target = {
  name: 'root',
  a: { b: { c: 'deep' } },
  tags: ['t0', 't1'],
  '0b': 'key',
  nested: { '0b': 'inner' },
  nil: null,
  count: 0,
  digits: { '0': 'zero' },
};

describe('getFieldByDotPath', () => {
  it.each([
    ['name', 'root'],
    ['a.b.c', 'deep'],
    ['tags.0', 't0'],
    ['tags.1', 't1'],
    ['0b', 'key'],
    ['nested.0b', 'inner'],
    ['digits.0', 'zero'],
  ])('reads %s', (path, expected) => {
    expect(getFieldByDotPath(target, path)).toBe(expected);
  });

  it('returns the object at an intermediate path', () => {
    expect(getFieldByDotPath(target, 'a.b')).toBe(target.a.b);
  });

  it.each(['tags.2', 'tags.10', 'tags.-1', 'missing', 'missing.deep', 'name.length', 'nil.x', 'count.x', ''])(
    'returns undefined for %s',
    (path) => {
      expect(getFieldByDotPath(target, path)).toBeUndefined();
    }
  );

  it('returns undefined when the target is a primitive', () => {
    expect(getFieldByDotPath('text', 'length')).toBeUndefined();
    expect(getFieldByDotPath(null, 'name')).toBeUndefined();
  });
});
