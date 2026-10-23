/**
 * jsonlMapFile codec tests
 *
 * Covers the text conversion shared by the tiered stores and the column store.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJsonlMapLines, serializeJsonlMap } from '../../../src/utils/jsonlMapFile.js';

const TIER = { keyField: 'k', valueField: 'v' };

describe('jsonlMapFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('serializeJsonlMap', () => {
    it('returns an empty string for an empty map', () => {
      expect(serializeJsonlMap(new Map<string, number>(), TIER)).toBe('');
    });

    it('writes one line per entry, with the key and value fields and a trailing newline', () => {
      const map = new Map<string, unknown>([
        ['a', 1],
        ['b', { x: 2 }],
      ]);
      expect(serializeJsonlMap(map, TIER)).toBe('{"k":"a","v":1}\n{"k":"b","v":{"x":2}}\n');
    });

    it('uses the field names it is given', () => {
      const map = new Map<string, number>([['alice', 3]]);
      expect(serializeJsonlMap(map, { keyField: 'name', valueField: 'value' })).toBe(
        '{"name":"alice","value":3}\n',
      );
    });
  });

  describe('parseJsonlMapLines', () => {
    const options = {
      ...TIER,
      warnPrefix: 'Test',
      keyLabel: 'key',
      filePath: '/tmp/test.jsonl',
    };

    it('returns an empty map for empty text', () => {
      expect(parseJsonlMapLines('', options).size).toBe(0);
    });

    it('skips blank lines', () => {
      const map = parseJsonlMapLines<number>('\n{"k":"a","v":1}\n   \n', options);
      expect([...map.entries()]).toEqual([['a', 1]]);
    });

    it('keeps the last value of a repeated key', () => {
      const map = parseJsonlMapLines<number>('{"k":"a","v":1}\n{"k":"a","v":2}\n', options);
      expect(map.get('a')).toBe(2);
      expect(map.size).toBe(1);
    });

    it('warns with the exact texts for a malformed line and for a non-string key', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const map = parseJsonlMapLines<number>('{"k":"a","v":1}\n{not json\n{"k":5,"v":2}\n', options);

      expect([...map.entries()]).toEqual([['a', 1]]);
      const warnText = warnSpy.mock.calls.flat().join('\n');
      expect(warnText).toContain('Test: skipping malformed line in /tmp/test.jsonl');
      expect(warnText).toContain('Test: skipping line with non-string key in /tmp/test.jsonl');
    });

    it('does not warn for blank, whitespace-only and CRLF lines', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const map = parseJsonlMapLines<number>('{"k":"a","v":1}\r\n   \r\n\r\n{"k":"b","v":2}\r\n', options);

      expect([...map.entries()]).toEqual([['a', 1], ['b', 2]]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns once per line that is the value null or has no string key', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const map = parseJsonlMapLines<number>('null\n5\n"str"\n[]\ntrue\n{"k":"a","v":1}\n', options);

      expect([...map.entries()]).toEqual([['a', 1]]);
      expect(warnSpy.mock.calls.map(call => call.join(' '))).toEqual([
        '[WARN] Test: skipping malformed line in /tmp/test.jsonl',
        '[WARN] Test: skipping line with non-string key in /tmp/test.jsonl',
        '[WARN] Test: skipping line with non-string key in /tmp/test.jsonl',
        '[WARN] Test: skipping line with non-string key in /tmp/test.jsonl',
        '[WARN] Test: skipping line with non-string key in /tmp/test.jsonl',
      ]);
    });

    it('accepts an empty-string key', () => {
      const map = parseJsonlMapLines<number>('{"k":"","v":1}\n', options);

      expect([...map.entries()]).toEqual([['', 1]]);
    });

    it('writes no value field for an undefined value and parses the key back', () => {
      const text = serializeJsonlMap(new Map<string, number | undefined>([['a', undefined]]), TIER);

      expect(text).toBe('{"k":"a"}\n');
      const map = parseJsonlMapLines<number | undefined>(text, options);
      expect(map.has('a')).toBe(true);
      expect(map.get('a')).toBeUndefined();
    });

    it('round-trips a map through serialize and parse', () => {
      const original = new Map<string, unknown>([
        ['a', [1, 2]],
        ['b', 'text'],
        ['c', null],
      ]);
      const parsed = parseJsonlMapLines<unknown>(serializeJsonlMap(original, TIER), options);
      expect(parsed).toEqual(original);
    });
  });
});
