import { describe, expect, it } from 'vitest';
import { matchesDefined } from '../../../src/agent/recordQuery.js';

describe('matchesDefined', () => {
  it('ignores predicates when wanted is undefined', () => {
    expect(matchesDefined([[undefined, 'open']])).toBe(true);
  });

  it('treats null as a real filter value', () => {
    expect(matchesDefined([[null, 'open']])).toBe(false);
    expect(matchesDefined([[null, null]])).toBe(true);
  });

  it('requires every defined predicate to match', () => {
    expect(
      matchesDefined([
        ['open', 'open'],
        ['sess-1', 'sess-2'],
      ]),
    ).toBe(false);
  });
});
