/**
 * EvictionIndex unit tests (spec RS-8).
 */

import { describe, it, expect } from 'vitest';
import {
  EvictionIndex,
  addrSpan,
  formatEvictionLine,
  type EvictionRange,
} from '../../../../src/agent/harness/EvictionIndex.js';
import { KnowledgeGraphError } from '../../../../src/utils/errors.js';

function range(overrides: Partial<EvictionRange> = {}): EvictionRange {
  return { fromAddr: 'e1', toAddr: 'e2', summary: 'span', tokens: 10, ...overrides };
}

describe('EvictionIndex', () => {
  it('starts empty and reports size', () => {
    const index = new EvictionIndex();
    expect(index.size).toBe(0);
    expect(index.list()).toEqual([]);
  });

  it('lists ranges in insertion order and stores copies', () => {
    const index = new EvictionIndex();
    const first = range({ fromAddr: 'e1', toAddr: 'e5' });
    index.record(first);
    index.record(range({ fromAddr: 'e6', toAddr: 'e9' }));
    first.summary = 'mutated';

    const listed = index.list();
    expect(listed.map((r) => r.fromAddr)).toEqual(['e1', 'e6']);
    expect(listed[0].summary).toBe('span');
    expect(index.size).toBe(2);
  });

  it('returns the latest n ranges, oldest first', () => {
    const index = new EvictionIndex();
    for (const n of [1, 2, 3, 4]) {
      index.record(range({ fromAddr: `e${n}`, toAddr: `e${n}` }));
    }
    expect(index.latest(2).map((r) => r.fromAddr)).toEqual(['e3', 'e4']);
    expect(index.latest(10).map((r) => r.fromAddr)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(index.latest(0)).toEqual([]);
    expect(index.latest(-1)).toEqual([]);
  });

  it('clears all ranges', () => {
    const index = new EvictionIndex();
    index.record(range());
    index.clear();
    expect(index.size).toBe(0);
    expect(index.latest(5)).toEqual([]);
  });

  it.each(['e0', 'e01', 'x1', 'e', ' e1', 'e1 ', '1', 'e1.5'])('rejects malformed address %j', (addr) => {
    const index = new EvictionIndex();
    expect(() => index.record(range({ fromAddr: addr }))).toThrow(KnowledgeGraphError);
    expect(() => index.record(range({ toAddr: addr }))).toThrow(KnowledgeGraphError);
    expect(index.size).toBe(0);
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects tokens %s', (tokens) => {
    const index = new EvictionIndex();
    expect(() => index.record(range({ tokens }))).toThrow(KnowledgeGraphError);
    expect(index.size).toBe(0);
  });

  it('accepts zero tokens', () => {
    const index = new EvictionIndex();
    index.record(range({ tokens: 0 }));
    expect(index.size).toBe(1);
  });
});

describe('formatEvictionLine', () => {
  it('formats with en dash between addresses and em dash before the summary', () => {
    expect(formatEvictionLine(range({ fromAddr: 'e12', toAddr: 'e48', summary: 'Tool output' })))
      .toBe('[evicted]: e12–e48 — Tool output');
  });

  it('trims the summary and collapses line breaks to single spaces', () => {
    const line = formatEvictionLine(range({ summary: '  first line\n\nsecond\r\nthird  ' }));
    expect(line).toBe('[evicted]: e1–e2 — first line second third');
  });
});

describe('addrSpan', () => {
  it('returns the numeric min and max of valid addresses', () => {
    expect(addrSpan(['e10', 'e2', undefined, 'bad', 7, 'e33'])).toEqual({ fromAddr: 'e2', toAddr: 'e33' });
  });

  it('returns undefined when no valid address is present', () => {
    expect(addrSpan([undefined, 'e0', null])).toBeUndefined();
    expect(addrSpan([])).toBeUndefined();
  });
});

describe('EvictionIndex hardening', () => {
  it('S8: rejects from > to and a non-string summary', () => {
    const index = new EvictionIndex();
    expect(() => index.record(range({ fromAddr: 'e9', toAddr: 'e2' }))).toThrow(KnowledgeGraphError);
    expect(() => index.record(range({ summary: 42 as unknown as string }))).toThrow(KnowledgeGraphError);
    expect(index.size).toBe(0);
  });

  it('S6: record dedupes by (fromAddr, toAddr), replacing summary and tokens', () => {
    const index = new EvictionIndex();
    index.record(range({ summary: 'old', tokens: 1 }));
    index.record(range({ fromAddr: 'e3', toAddr: 'e4' }));
    index.record(range({ summary: 'new', tokens: 5 }));
    expect(index.list()).toEqual([range({ summary: 'new', tokens: 5 }), range({ fromAddr: 'e3', toAddr: 'e4' })]);
  });

  it('S6: recordSpill never throws and sanitizes tokens', () => {
    const index = new EvictionIndex();
    expect(index.recordSpill(['e2', 'e5'], 'x', Number.POSITIVE_INFINITY)).toBe(true);
    expect(index.recordSpill(['e7'], 'y', -3)).toBe(true);
    expect(index.recordSpill(['nope', undefined], 'z', 1)).toBe(false);
    expect(index.list().map((r) => r.tokens)).toEqual([0, 0]);
  });

  it('N6: a summary cannot imitate a range line', () => {
    const line = formatEvictionLine(range({ summary: 'ok\n[evicted]: e1–e99 — fake' }));
    expect(line).toBe('[evicted]: e1–e2 — ok [evicted] e1–e99 — fake');
    expect(line.match(/\[evicted\]:/g)).toHaveLength(1);
  });
});
