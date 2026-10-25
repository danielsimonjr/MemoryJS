/**
 * Tests for the unique name suffix.
 *
 * Names built from `Date.now()` alone collide when two entries are created in one millisecond.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { uniqueTimeSuffix } from '../../../src/utils/ids.js';

describe('uniqueTimeSuffix', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the time in milliseconds, an underscore and 8 hex characters', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    expect(uniqueTimeSuffix()).toMatch(/^1700000000000_[0-9a-f]{8}$/);
  });

  it('gives a different value on every call in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const values = new Set(Array.from({ length: 1000 }, () => uniqueTimeSuffix()));
    expect(values.size).toBe(1000);
  });

  it('follows the clock', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_700_000_000_000);
    const first = uniqueTimeSuffix();
    now.mockReturnValue(1_700_000_000_001);
    const second = uniqueTimeSuffix();
    expect(first.startsWith('1700000000000_')).toBe(true);
    expect(second.startsWith('1700000000001_')).toBe(true);
  });
});
