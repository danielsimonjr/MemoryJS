import { describe, expect, it } from 'vitest';
import { nextMonotonicIsoTimestamp } from '../../../src/utils/nextMonotonicIsoTimestamp.js';

describe('nextMonotonicIsoTimestamp', () => {
  it('returns ISO strings that strictly increase when the clock does not advance', () => {
    const first = nextMonotonicIsoTimestamp('');
    expect(first.timestamp).toBe(first.lastTimestamp);

    const second = nextMonotonicIsoTimestamp(first.lastTimestamp);
    expect(second.timestamp > first.timestamp).toBe(true);
    expect(second.lastTimestamp).toBe(second.timestamp);

    const third = nextMonotonicIsoTimestamp(second.lastTimestamp);
    expect(third.timestamp > second.timestamp).toBe(true);
  });
});
