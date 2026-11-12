/**
 * boundResult tests: a bounded result never exceeds the byte budget.
 */

import { describe, it, expect } from 'vitest';
import { boundResult, byteSize } from '../../../src/adapters/recursaToolBounds.js';

describe('boundResult', () => {
  it('returns a small value unchanged', () => {
    const v = { a: 1, b: ['x'] };
    expect(boundResult(v, 1024)).toBe(v);
  });

  it('shrinks many small array items to fit the budget and keeps the array', () => {
    const v = { files: Array.from({ length: 1200 }, (_, i) => ({ path: `p/e${i}.md`, action: 'create' })), n: 3 };
    const out = boundResult(v, 8192) as { files: unknown[]; n: number; truncated: boolean };
    expect(byteSize(out)).toBeLessThanOrEqual(8192);
    expect(out.truncated).toBe(true);
    expect(Array.isArray(out.files)).toBe(true);
    expect(out.files.length).toBeGreaterThan(0);
    expect(out.n).toBe(3);
  });

  it('keeps an object with many keys within the budget', () => {
    const v = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`key_number_${i}`, i]));
    expect(byteSize(boundResult(v, 1024))).toBeLessThanOrEqual(1024);
  });

  it('keeps a quote-heavy string preview within the budget', () => {
    const v = ['"'.repeat(5000)];
    expect(byteSize(boundResult(v, 300))).toBeLessThanOrEqual(300);
  });

  it('keeps multi-byte text within the budget', () => {
    const v = { text: 'é€😀'.repeat(3000) };
    expect(byteSize(boundResult(v, 1000))).toBeLessThanOrEqual(1000);
  });
});
