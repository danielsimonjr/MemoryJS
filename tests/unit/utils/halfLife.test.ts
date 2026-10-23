/**
 * Golden values for the half-life factor. Each literal is the output of
 * `Math.exp(-(Math.LN2 / halfLife) * age)` in Node (V8), the same engine
 * that runs these tests.
 */

import { describe, it, expect } from 'vitest';
import { halfLifeFactor } from '../../../src/utils/halfLife.js';

describe('halfLifeFactor', () => {
  it.each([
    [0, 24, 1],
    [24, 24, 0.5],
    [1, 168, 0.9958826236582974],
    [1000, 24, 2.8647287988289323e-13],
    [-5, 24, 1.155352696872273],
  ])('returns the Node value for age %s hours and half-life %s hours', (age, halfLife, expected) => {
    expect(halfLifeFactor(age, halfLife)).toBe(expected);
  });
});
