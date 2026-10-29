import { describe, it, expect } from 'vitest';
import { fillDefaults } from '../../../src/utils/fillDefaults.js';

describe('fillDefaults', () => {
  it('uses defaults for null and undefined', () => {
    expect(fillDefaults({ a: null, b: undefined }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('keeps 0 and false from source', () => {
    expect(fillDefaults({ a: 0, b: false }, { a: 1, b: true })).toEqual({ a: 0, b: false });
  });

  it('drops keys absent from defaults', () => {
    expect(fillDefaults({ extra: 99 } as { extra: number }, { a: 1 })).toEqual({ a: 1 });
  });

  it('follows Object.keys(defaults) order', () => {
    const defaults = { z: 1, a: 2 };
    expect(Object.keys(fillDefaults({}, defaults))).toEqual(['z', 'a']);
  });
});
