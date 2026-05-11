/**
 * CompressedMap tests
 *
 * Covers Phase 10 task 76: hot/cold tiering, compression on
 * eviction, promotion on cold-hit, iteration order, custom
 * serialize/deserialize, custom adapter, size accounting.
 */

import { describe, it, expect } from 'vitest';
import { CompressedMap } from '../../../../src/utils/compression/CompressedMap.js';
import {
  IdentityCompressionAdapter,
  ZlibCompressionAdapter,
} from '../../../../src/utils/compression/ICompressionAdapter.js';

describe('CompressedMap — basic Map semantics', () => {
  it('supports set/get/has/delete/clear/size', () => {
    const map = new CompressedMap<string, number>();
    expect(map.size).toBe(0);
    expect(map.has('a')).toBe(false);
    expect(map.get('a')).toBeUndefined();

    map.set('a', 1).set('b', 2).set('c', 3);
    expect(map.size).toBe(3);
    expect(map.has('a')).toBe(true);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);

    expect(map.delete('b')).toBe(true);
    expect(map.delete('b')).toBe(false);
    expect(map.size).toBe(2);

    map.clear();
    expect(map.size).toBe(0);
    expect(map.has('a')).toBe(false);
  });

  it('set on existing key overwrites the value', () => {
    const map = new CompressedMap<string, string>();
    map.set('k', 'v1');
    map.set('k', 'v2');
    expect(map.size).toBe(1);
    expect(map.get('k')).toBe('v2');
  });

  it('returns this from set (chainable)', () => {
    const map = new CompressedMap<string, number>();
    const result = map.set('a', 1);
    expect(result).toBe(map);
  });
});

describe('CompressedMap — hot/cold tiering', () => {
  it('keeps everything hot when below hotThreshold', () => {
    const map = new CompressedMap<string, number>({ hotThreshold: 5 });
    for (let i = 0; i < 5; i++) {
      map.set(`k${i}`, i);
    }
    const s = map.stats();
    expect(s.hotCount).toBe(5);
    expect(s.coldCount).toBe(0);
  });

  it('compression kicks in once hotThreshold is exceeded', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 3,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 'A');
    map.set('b', 'B');
    map.set('c', 'C');
    map.set('d', 'D'); // overflow — 'a' should demote to cold
    const s = map.stats();
    expect(s.hotCount).toBe(3);
    expect(s.coldCount).toBeGreaterThan(0);
    expect(s.coldCount).toBe(1);
  });

  it('get on a cold key returns the original value AND promotes it', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 'alpha');
    map.set('b', 'beta');
    map.set('c', 'gamma'); // 'a' demoted

    const before = map.stats();
    expect(before.coldCount).toBe(1);

    expect(map.get('a')).toBe('alpha');
    const after = map.stats();
    // 'a' is now hot; some other entry got demoted in its place.
    expect(after.coldCount).toBe(1);
    expect(after.hotCount).toBe(2);
  });

  it('promotion may trigger a hot→cold demotion (cold count stays correct)', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // a demoted
    map.set('d', 4); // b demoted
    expect(map.stats().coldCount).toBe(2);

    map.get('a'); // promote a — should demote oldest hot (which is c)
    const s = map.stats();
    expect(s.hotCount).toBe(2);
    expect(s.coldCount).toBe(2);
    expect(map.size).toBe(4);
  });

  it('set on a cold key drops the cold entry before inserting into hot', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 'first');
    map.set('b', 'B');
    map.set('c', 'C'); // a now cold
    expect(map.stats().coldCount).toBe(1);

    map.set('a', 'updated'); // re-set on cold key — should demote oldest hot, end with a hot
    expect(map.get('a')).toBe('updated');
    expect(map.size).toBe(3);
  });

  it('hot map size never exceeds hotThreshold', () => {
    const map = new CompressedMap<number, number>({
      hotThreshold: 10,
      adapter: new IdentityCompressionAdapter(),
    });
    for (let i = 0; i < 100; i++) {
      map.set(i, i * 2);
      expect(map.stats().hotCount).toBeLessThanOrEqual(10);
    }
  });
});

describe('CompressedMap — delete', () => {
  it('delete on a cold key returns true and removes from cold', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // a cold
    expect(map.stats().coldCount).toBe(1);

    expect(map.delete('a')).toBe(true);
    expect(map.stats().coldCount).toBe(0);
    expect(map.has('a')).toBe(false);
    expect(map.size).toBe(2);
  });

  it('delete on missing key returns false', () => {
    const map = new CompressedMap<string, number>();
    expect(map.delete('nope')).toBe(false);
  });

  it('clear drops both tiers', () => {
    const map = new CompressedMap<number, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    for (let i = 0; i < 10; i++) {
      map.set(i, i);
    }
    expect(map.size).toBe(10);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.stats().hotCount).toBe(0);
    expect(map.stats().coldCount).toBe(0);
    expect(map.stats().coldBytes).toBe(0);
  });
});

describe('CompressedMap — iteration', () => {
  it('entries() yields hot first (insertion order), then cold (insertion order)', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // a → cold
    map.set('d', 4); // b → cold

    const seen = [...map.entries()];
    // Hot section (last 2 inserted): c, d (in that order).
    // Cold section: a, b (in that order).
    expect(seen.map(([k]) => k)).toEqual(['c', 'd', 'a', 'b']);
    expect(seen.map(([, v]) => v)).toEqual([3, 4, 1, 2]);
  });

  it('keys() and values() iterate both tiers', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 1,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 'A');
    map.set('b', 'B');
    map.set('c', 'C');

    expect([...map.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect([...map.values()].sort()).toEqual(['A', 'B', 'C']);
  });

  it('Symbol.iterator yields the same as entries()', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    const viaSymbol = [...map];
    const viaEntries = [...map.entries()];
    expect(viaSymbol).toEqual(viaEntries);
  });
});

describe('CompressedMap — generic V types', () => {
  it('handles string values', () => {
    const map = new CompressedMap<string, string>({ hotThreshold: 2 });
    map.set('a', 'hello');
    map.set('b', 'world');
    map.set('c', '!');
    expect(map.get('a')).toBe('hello');
    expect(map.get('b')).toBe('world');
    expect(map.get('c')).toBe('!');
  });

  it('handles number values', () => {
    const map = new CompressedMap<string, number>({ hotThreshold: 2 });
    map.set('a', 1.5);
    map.set('b', -42);
    map.set('c', 0);
    expect(map.get('a')).toBe(1.5);
    expect(map.get('b')).toBe(-42);
    expect(map.get('c')).toBe(0);
  });

  it('handles array values', () => {
    const map = new CompressedMap<string, number[]>({ hotThreshold: 2 });
    map.set('a', [1, 2, 3]);
    map.set('b', [4, 5]);
    map.set('c', []);
    expect(map.get('a')).toEqual([1, 2, 3]);
    expect(map.get('b')).toEqual([4, 5]);
    expect(map.get('c')).toEqual([]);
  });

  it('handles object values', () => {
    type Obj = { name: string; tags: string[] };
    const map = new CompressedMap<string, Obj>({ hotThreshold: 2 });
    map.set('a', { name: 'alpha', tags: ['x', 'y'] });
    map.set('b', { name: 'beta', tags: [] });
    map.set('c', { name: 'gamma', tags: ['z'] });
    expect(map.get('a')).toEqual({ name: 'alpha', tags: ['x', 'y'] });
    expect(map.get('c')).toEqual({ name: 'gamma', tags: ['z'] });
  });

  it('handles number keys', () => {
    const map = new CompressedMap<number, string>({ hotThreshold: 2 });
    map.set(1, 'one');
    map.set(2, 'two');
    map.set(3, 'three');
    expect(map.get(1)).toBe('one');
    expect(map.size).toBe(3);
  });
});

describe('CompressedMap — custom serialize/deserialize', () => {
  it('identity serializer skips JSON round-trip for string V', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 2,
      adapter: new IdentityCompressionAdapter(),
      serialize: (v) => v,
      deserialize: (raw) => raw,
    });
    map.set('a', 'plain text without quotes');
    map.set('b', 'B');
    map.set('c', 'C'); // a demoted
    expect(map.get('a')).toBe('plain text without quotes');
  });

  it('custom serializer is used for compression payload', () => {
    let serializeCalls = 0;
    let deserializeCalls = 0;
    const map = new CompressedMap<string, { n: number }>({
      hotThreshold: 1,
      adapter: new IdentityCompressionAdapter(),
      serialize: (v) => {
        serializeCalls++;
        return `N=${v.n}`;
      },
      deserialize: (raw) => {
        deserializeCalls++;
        return { n: Number(raw.slice(2)) };
      },
    });
    map.set('a', { n: 42 });
    map.set('b', { n: 7 }); // a demoted — serialize called
    expect(serializeCalls).toBeGreaterThan(0);

    const back = map.get('a'); // promote — deserialize called
    expect(deserializeCalls).toBeGreaterThan(0);
    expect(back).toEqual({ n: 42 });
  });
});

describe('CompressedMap — custom adapter', () => {
  it('IdentityCompressionAdapter exercises the data-structure layer alone', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 1,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 'value-a');
    map.set('b', 'value-b'); // a → cold
    expect(map.get('a')).toBe('value-a');
    expect(map.get('b')).toBe('value-b');
  });

  it('works with default zlib adapter', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 1,
      adapter: new ZlibCompressionAdapter(),
    });
    const payload = 'the quick brown fox jumps over the lazy dog '.repeat(10);
    map.set('a', payload);
    map.set('b', 'other');
    // a is cold and zlib-compressed; reading it round-trips.
    expect(map.get('a')).toBe(payload);
  });
});

describe('CompressedMap — stress and bookkeeping', () => {
  it('1000-entry stress with hotThreshold=10 → most entries cold', () => {
    const map = new CompressedMap<number, string>({
      hotThreshold: 10,
      adapter: new IdentityCompressionAdapter(),
    });
    for (let i = 0; i < 1000; i++) {
      map.set(i, `entry-${i}`);
    }
    const s = map.stats();
    expect(s.hotCount).toBe(10);
    expect(s.coldCount).toBe(990);
    expect(map.size).toBe(1000);
    // Spot-check correctness of cold reads (which promote).
    expect(map.get(0)).toBe('entry-0');
    expect(map.get(500)).toBe('entry-500');
    expect(map.get(999)).toBe('entry-999');
  });

  it('size accounting after a series of set/delete/get-promotion cycles', () => {
    const map = new CompressedMap<string, number>({
      hotThreshold: 3,
      adapter: new IdentityCompressionAdapter(),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4);
    map.set('e', 5);
    expect(map.size).toBe(5);

    map.delete('a');
    expect(map.size).toBe(4);

    map.get('b'); // promote
    expect(map.size).toBe(4);

    map.set('f', 6);
    expect(map.size).toBe(5);

    map.delete('z'); // no-op
    expect(map.size).toBe(5);

    map.set('b', 22); // overwrite — size unchanged
    expect(map.size).toBe(5);
    expect(map.get('b')).toBe(22);
  });

  it('coldBytes monotonically reflects the compressed size of currently-cold entries', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 1,
      adapter: new IdentityCompressionAdapter(),
    });
    expect(map.stats().coldBytes).toBe(0);

    map.set('a', 'aaaa');
    expect(map.stats().coldBytes).toBe(0); // a is hot

    map.set('b', 'bbbbbb');
    // a was demoted; under IdentityCompressionAdapter coldBytes ==
    // JSON.stringify('aaaa').length = 6 ('"aaaa"').
    const after1 = map.stats().coldBytes;
    expect(after1).toBeGreaterThan(0);
    expect(after1).toBe(Buffer.byteLength(JSON.stringify('aaaa'), 'utf8'));

    map.set('c', 'cccc');
    // b also demoted; coldBytes accumulates.
    const after2 = map.stats().coldBytes;
    expect(after2).toBe(
      Buffer.byteLength(JSON.stringify('aaaa'), 'utf8') +
        Buffer.byteLength(JSON.stringify('bbbbbb'), 'utf8'),
    );

    // Deleting a cold entry decreases coldBytes.
    map.delete('a');
    expect(map.stats().coldBytes).toBe(
      Buffer.byteLength(JSON.stringify('bbbbbb'), 'utf8'),
    );

    // Getting a cold entry (promotion) also decreases coldBytes.
    map.get('b');
    // b promoted; c demoted in its place.
    expect(map.stats().coldBytes).toBe(
      Buffer.byteLength(JSON.stringify('cccc'), 'utf8'),
    );
  });

  it('stats.uncompressedBytesEstimate is non-negative and reflects hot tier exactly', () => {
    const map = new CompressedMap<string, string>({
      hotThreshold: 10,
      adapter: new IdentityCompressionAdapter(),
    });
    expect(map.stats().uncompressedBytesEstimate).toBe(0);

    map.set('a', 'hello');
    const s = map.stats();
    // Hot-only — estimate == exact serialized size of hot.
    expect(s.uncompressedBytesEstimate).toBe(
      Buffer.byteLength(JSON.stringify('hello'), 'utf8'),
    );
  });
});

describe('CompressedMap — constructor validation', () => {
  it('rejects non-positive hotThreshold', () => {
    expect(() => new CompressedMap({ hotThreshold: 0 })).toThrow();
    expect(() => new CompressedMap({ hotThreshold: -1 })).toThrow();
    expect(() => new CompressedMap({ hotThreshold: 1.5 })).toThrow();
  });

  it('defaults hotThreshold to 1000', () => {
    const map = new CompressedMap<number, number>();
    for (let i = 0; i < 1000; i++) {
      map.set(i, i);
    }
    expect(map.stats().coldCount).toBe(0);
    map.set(1000, 1000);
    expect(map.stats().coldCount).toBe(1);
  });
});
