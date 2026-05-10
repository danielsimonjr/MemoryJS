/**
 * Bloom Filter
 *
 * Probabilistic membership-test data structure. Used as a pre-screen
 * before expensive search ops (fuzzy / semantic) so candidates that
 * definitely don't contain a query term can be skipped without a full
 * scan. False positives possible (an entity may pass the filter and
 * fail downstream), false negatives are not — the filter never says
 * "absent" when the term is actually present.
 *
 * Phase 2 step 27 — pure-TS implementation (no native deps). Uses two
 * mixed FNV-1a hashes plus k-1 linear combinations to derive `k`
 * independent hash positions per insert/lookup.
 *
 * @module search/BloomFilter
 */

/**
 * Recommended parameters for a target capacity and false-positive rate.
 *
 * Standard formulas:
 *   m = -(n * ln(p)) / (ln(2)^2)
 *   k = (m / n) * ln(2)
 */
export function bloomParams(
  capacity: number,
  falsePositiveRate: number,
): { bits: number; hashes: number } {
  if (capacity <= 0) return { bits: 8, hashes: 1 };
  const fpr = Math.min(0.5, Math.max(1e-9, falsePositiveRate));
  const ln2 = Math.LN2;
  const bits = Math.max(8, Math.ceil(-(capacity * Math.log(fpr)) / (ln2 * ln2)));
  const hashes = Math.max(1, Math.round((bits / capacity) * ln2));
  return { bits, hashes };
}

/**
 * A bit-array-backed Bloom filter. Backed by `Uint8Array` so each bit
 * costs 1/8 byte. Supports `add` / `mayContain` / `clear` / `size`.
 *
 * @example
 * ```typescript
 * const bf = new BloomFilter(1000, 0.01); // ~1% FPR, ~10k bits
 * bf.add('alice');
 * bf.mayContain('alice');     // true
 * bf.mayContain('alice2');    // false (probably)
 * ```
 */
export class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashCount: number;
  private inserted = 0;

  constructor(capacity: number, falsePositiveRate: number = 0.01) {
    const { bits, hashes } = bloomParams(capacity, falsePositiveRate);
    this.bitCount = bits;
    this.hashCount = hashes;
    this.bits = new Uint8Array(Math.ceil(bits / 8));
  }

  /** Add an item to the filter. */
  add(item: string): void {
    const [h1, h2] = doubleHash(item);
    for (let i = 0; i < this.hashCount; i++) {
      const idx = (h1 + i * h2) % this.bitCount;
      const byte = idx >>> 3;
      const mask = 1 << (idx & 7);
      this.bits[byte] = (this.bits[byte] ?? 0) | mask;
    }
    this.inserted++;
  }

  /**
   * Test for membership. Returns `true` when the item *may* be in the
   * filter (false positives possible) and `false` when the item is
   * definitely absent.
   */
  mayContain(item: string): boolean {
    const [h1, h2] = doubleHash(item);
    for (let i = 0; i < this.hashCount; i++) {
      const idx = (h1 + i * h2) % this.bitCount;
      const byte = idx >>> 3;
      const mask = 1 << (idx & 7);
      if (((this.bits[byte] ?? 0) & mask) === 0) return false;
    }
    return true;
  }

  /** Reset every bit. */
  clear(): void {
    this.bits.fill(0);
    this.inserted = 0;
  }

  /** Number of items added since the last `clear()`. */
  size(): number {
    return this.inserted;
  }

  /** Filter parameters for diagnostics. */
  parameters(): { bitCount: number; hashCount: number; bytes: number } {
    return { bitCount: this.bitCount, hashCount: this.hashCount, bytes: this.bits.byteLength };
  }
}

/**
 * Two FNV-1a-style hashes mixed from one pass over the string. Returns
 * a `[h1, h2]` tuple suitable for double-hashing — the standard trick
 * for deriving k bloom-filter positions from two base hashes.
 */
function doubleHash(s: string): [number, number] {
  // FNV-1a 32-bit, two seeds for independence.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  // Force `h2` odd so that for any `bitCount`, the sequence
  // `(h1 + i * h2) % bitCount` does not collapse onto a strict subgroup
  // when both are even — the standard Kirsch-Mitzenmacher fix that keeps
  // the filter's measured FPR close to the theoretical curve.
  h2 = (h2 | 1) >>> 0;
  return [h1, h2];
}
