/**
 * Unit tests for the shared key=value observation codec.
 *
 * Every expected value is a literal. No expected value comes from the
 * code under test.
 */

import { describe, it, expect } from 'vitest';
import { decodeKeyValueBody, encodeKeyValueBody } from '../../../src/agent/keyValueLine.js';

describe('decodeKeyValueBody', () => {
  it.each([
    ['"a"=1', ['a', 1]],
    ['"a\\"b"=2', ['a"b', 2]],
    ['"a=b"="c"', ['a=b', 'c']],
    ['"\\\\"=1', ['\\', 1]],
  ])('decodes %s', (body, expected) => {
    expect(decodeKeyValueBody(body)).toStrictEqual(expected);
  });

  it.each([
    '"a"',
    'a=1',
    '"a"=',
    '"a"=undefined',
    '"a"x1',
  ])('returns null for malformed %s', (body) => {
    expect(decodeKeyValueBody(body)).toBeNull();
  });
});

describe('encodeKeyValueBody', () => {
  it('writes an undefined value as the literal text when onUndefined is literal', () => {
    expect(encodeKeyValueBody('k', undefined, 'literal')).toBe('"k"=undefined');
  });

  it('writes a function value as the literal text when onUndefined is literal', () => {
    expect(encodeKeyValueBody('f', () => 1, 'literal')).toBe('"f"=undefined');
  });

  it('returns null for an undefined value when onUndefined is skip', () => {
    expect(encodeKeyValueBody('k', undefined, 'skip')).toBeNull();
  });

  it('returns null for a function value when onUndefined is skip', () => {
    expect(encodeKeyValueBody('f', () => 1, 'skip')).toBeNull();
  });

  it('encodes key and value as JSON', () => {
    expect(encodeKeyValueBody('a=b', 1, 'literal')).toBe('"a=b"=1');
    expect(encodeKeyValueBody('n', { x: 1 }, 'skip')).toBe('"n"={"x":1}');
  });

  it('round-trips through decodeKeyValueBody', () => {
    const body = encodeKeyValueBody('p"q', 'v=w', 'skip');
    expect(body).not.toBeNull();
    expect(decodeKeyValueBody(body ?? '')).toStrictEqual(['p"q', 'v=w']);
  });
});
