/**
 * Direct tests for `readGraphMlDataValue` (CL-6). The regex semantics
 * (raw text, first match, escaped key) must match the pre-refactor closures.
 */

import { describe, it, expect } from 'vitest';
import { readGraphMlDataValue } from '../../../src/features/IOManager.js';

describe('readGraphMlDataValue (CL-6)', () => {
  const xml = '<data key="d0">person</data><data key="d1">a;b</data>';

  it('returns the raw text of the matching data element', () => {
    expect(readGraphMlDataValue(xml, 'd0')).toBe('person');
    expect(readGraphMlDataValue(xml, 'd1')).toBe('a;b');
  });

  it('returns undefined when the key is absent', () => {
    expect(readGraphMlDataValue(xml, 'd9')).toBeUndefined();
    expect(readGraphMlDataValue('', 'd0')).toBeUndefined();
  });

  it('returns an empty string for an empty element', () => {
    expect(readGraphMlDataValue('<data key="d2"></data>', 'd2')).toBe('');
  });

  it('does not decode XML entities', () => {
    expect(readGraphMlDataValue('<data key="d0">AT&amp;T</data>', 'd0')).toBe('AT&amp;T');
  });

  it('returns the first match when a key repeats', () => {
    const repeated = '<data key="d0">first</data><data key="d0">second</data>';
    expect(readGraphMlDataValue(repeated, 'd0')).toBe('first');
  });

  it('does not match keys that merely share a prefix', () => {
    expect(readGraphMlDataValue('<data key="d10">x</data>', 'd1')).toBeUndefined();
  });

  it('escapes regex metacharacters in the key', () => {
    const xmlWithDot = '<data key="a.b">dot</data><data key="axb">wrong</data>';
    expect(readGraphMlDataValue(xmlWithDot, 'a.b')).toBe('dot');
    expect(readGraphMlDataValue('<data key="a+">plus</data>', 'a+')).toBe('plus');
    expect(readGraphMlDataValue('<data key="aa">x</data>', 'a+')).toBeUndefined();
  });

  it('does not match a value that contains a nested tag', () => {
    expect(readGraphMlDataValue('<data key="d0"><b>x</b></data>', 'd0')).toBeUndefined();
  });
});
