/**
 * Unit tests for TemporalQueryParser
 *
 * Feature 3 (Must-Have): Temporal Range Queries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TemporalQueryParser } from '../../../src/search/TemporalQueryParser.js';

/**
 * Fixed reference date used throughout tests: 2024-06-15 14:30:00 UTC (Saturday)
 * Using a fixed date eliminates flakiness from real-time dependencies.
 */
const REF = new Date('2024-06-15T14:30:00.000Z');

// Helper: create a Date offset by minutes from REF
const minutesBefore = (n: number) => new Date(REF.getTime() - n * 60_000);
const hoursBefore = (n: number) => new Date(REF.getTime() - n * 3_600_000);

describe('TemporalQueryParser', () => {
  let parser: TemporalQueryParser;

  beforeEach(() => {
    parser = new TemporalQueryParser();
  });

  // ==================== "N minutes ago" ====================

  describe('"N minutes ago" pattern', () => {
    it('should parse "10 minutes ago" as [ref-10min, ref]', () => {
      const range = parser.parseTemporalExpression('10 minutes ago', REF);
      expect(range).not.toBeNull();
      const expectedStart = minutesBefore(10);
      expect(range!.start.getTime()).toBeCloseTo(expectedStart.getTime(), -2);
      expect(range!.end.getTime()).toBeCloseTo(REF.getTime(), -2);
      expect(range!.originalExpression).toBe('10 minutes ago');
    });

    it('should parse "1 minute ago" as [ref-1min, ref]', () => {
      const range = parser.parseTemporalExpression('1 minute ago', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeCloseTo(minutesBefore(1).getTime(), -2);
    });

    it('should parse "30 seconds ago" as [ref-30s, ref]', () => {
      const range = parser.parseTemporalExpression('30 seconds ago', REF);
      expect(range).not.toBeNull();
      const expectedStart = new Date(REF.getTime() - 30_000);
      expect(range!.start.getTime()).toBeCloseTo(expectedStart.getTime(), -2);
    });
  });

  // ==================== "last hour" ====================

  describe('"last hour" pattern', () => {
    it('should parse "last hour" as [ref-1h, ref]', () => {
      const range = parser.parseTemporalExpression('last hour', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeCloseTo(hoursBefore(1).getTime(), -2);
      expect(range!.end.getTime()).toBeCloseTo(REF.getTime(), -2);
    });

    it('should parse "past hour" as [ref-1h, ref]', () => {
      const range = parser.parseTemporalExpression('past hour', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeCloseTo(hoursBefore(1).getTime(), -2);
    });

    it('should parse "last 2 hours" as [ref-2h, ref]', () => {
      const range = parser.parseTemporalExpression('last 2 hours', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeCloseTo(hoursBefore(2).getTime(), -2);
    });
  });

  // ==================== "since yesterday" ====================

  describe('"since yesterday" pattern', () => {
    it('should parse "since yesterday" with start before ref', () => {
      const range = parser.parseTemporalExpression('since yesterday', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeLessThan(REF.getTime());
      expect(range!.end.getTime()).toBeCloseTo(REF.getTime(), -2);
    });

    it('start should be approximately 24 hours before ref', () => {
      const range = parser.parseTemporalExpression('since yesterday', REF);
      expect(range).not.toBeNull();
      // Should be roughly 1 day before
      const diffMs = REF.getTime() - range!.start.getTime();
      const diffHours = diffMs / 3_600_000;
      expect(diffHours).toBeGreaterThan(12);
      expect(diffHours).toBeLessThan(36);
    });
  });

  // ==================== "between X and Y" ====================

  describe('"between X and Y" pattern', () => {
    it('should parse "between 2024-06-01 and 2024-06-10"', () => {
      const range = parser.parseTemporalExpression(
        'between 2024-06-01 and 2024-06-10',
        REF
      );
      expect(range).not.toBeNull();
      expect(range!.start.getFullYear()).toBe(2024);
      expect(range!.start.getMonth()).toBe(5); // June = 5
      expect(range!.start.getDate()).toBe(1);
      expect(range!.end.getDate()).toBe(10);
    });

    it('start should be before end', () => {
      const range = parser.parseTemporalExpression(
        'between 2024-01-01 and 2024-12-31',
        REF
      );
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeLessThan(range!.end.getTime());
    });
  });

  // ==================== "in the past week" ====================

  describe('"in the past week" pattern', () => {
    it('should parse "in the past week" as [ref-7d, ref]', () => {
      const range = parser.parseTemporalExpression('in the past week', REF);
      expect(range).not.toBeNull();
      const sevenDaysAgo = new Date(REF.getTime() - 7 * 24 * 3_600_000);
      expect(range!.start.getTime()).toBeCloseTo(sevenDaysAgo.getTime(), -2);
      expect(range!.end.getTime()).toBeCloseTo(REF.getTime(), -2);
    });

    it('should parse "last week" as [ref-7d, ref]', () => {
      const range = parser.parseTemporalExpression('last week', REF);
      expect(range).not.toBeNull();
      const sevenDaysAgo = new Date(REF.getTime() - 7 * 24 * 3_600_000);
      expect(range!.start.getTime()).toBeCloseTo(sevenDaysAgo.getTime(), -2);
    });

    it('should parse "last month" with start approximately 30 days before', () => {
      const range = parser.parseTemporalExpression('last month', REF);
      expect(range).not.toBeNull();
      const diffDays = (REF.getTime() - range!.start.getTime()) / (24 * 3_600_000);
      expect(diffDays).toBeGreaterThan(25);
      expect(diffDays).toBeLessThan(32);
    });
  });

  // ==================== Invalid inputs ====================

  describe('invalid inputs', () => {
    it('should return null for empty string', () => {
      expect(parser.parseTemporalExpression('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(parser.parseTemporalExpression('   ')).toBeNull();
    });

    it('should return null for non-temporal text', () => {
      expect(parser.parseTemporalExpression('hello world')).toBeNull();
    });

    it('should return null for pure numbers', () => {
      expect(parser.parseTemporalExpression('12345')).toBeNull();
    });

    it('should return null for random words', () => {
      expect(parser.parseTemporalExpression('foo bar baz qux')).toBeNull();
    });
  });

  // ==================== Edge cases ====================

  describe('edge cases', () => {
    it('should preserve originalExpression', () => {
      const expr = 'last hour';
      const range = parser.parseTemporalExpression(expr, REF);
      expect(range!.originalExpression).toBe(expr);
    });

    it('should handle "today" as full-day range', () => {
      const range = parser.parseTemporalExpression('today', REF);
      expect(range).not.toBeNull();
      expect(range!.start <= range!.end).toBe(true);
      // start should be midnight of the ref date (local time)
      expect(range!.start.getHours()).toBe(0);
      expect(range!.start.getMinutes()).toBe(0);
    });

    it('should handle "yesterday" as full-day range', () => {
      const range = parser.parseTemporalExpression('yesterday', REF);
      expect(range).not.toBeNull();
      expect(range!.start <= range!.end).toBe(true);
      expect(range!.start.getHours()).toBe(0);
      expect(range!.end.getHours()).toBe(23);
    });

    it('should accept a custom referenceDate', () => {
      const customRef = new Date('2020-01-15T12:00:00.000Z');
      const range = parser.parseTemporalExpression('last hour', customRef);
      expect(range).not.toBeNull();
      expect(range!.end.getTime()).toBeCloseTo(customRef.getTime(), -2);
    });

    it('should use current time when no referenceDate given', () => {
      const before = Date.now();
      const range = parser.parseTemporalExpression('last hour');
      const after = Date.now();
      expect(range).not.toBeNull();
      // end should be approximately now
      expect(range!.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(range!.end.getTime()).toBeLessThanOrEqual(after + 100);
    });

    it('should always return start <= end', () => {
      const expressions = [
        'last hour',
        'last week',
        'last month',
        'today',
        'yesterday',
        'in the past 3 days',
      ];
      for (const expr of expressions) {
        const range = parser.parseTemporalExpression(expr, REF);
        if (range) {
          expect(range.start.getTime()).toBeLessThanOrEqual(range.end.getTime());
        }
      }
    });

    it('should handle "this week" as a range', () => {
      const range = parser.parseTemporalExpression('this week', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getTime()).toBeLessThanOrEqual(range!.end.getTime());
      // Start should be Sunday (day 0)
      expect(range!.start.getDay()).toBe(0);
    });

    it('should handle "this month" as a range', () => {
      const range = parser.parseTemporalExpression('this month', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getDate()).toBe(1);
    });

    it('should handle "this year" as a range', () => {
      const range = parser.parseTemporalExpression('this year', REF);
      expect(range).not.toBeNull();
      expect(range!.start.getFullYear()).toBe(REF.getFullYear());
      expect(range!.end.getFullYear()).toBe(REF.getFullYear());
    });

    it('should handle "in the past 30 days"', () => {
      const range = parser.parseTemporalExpression('in the past 30 days', REF);
      expect(range).not.toBeNull();
      const diffDays = (REF.getTime() - range!.start.getTime()) / (24 * 3_600_000);
      expect(diffDays).toBeCloseTo(30, 0);
    });

    it('should handle "last 5 minutes"', () => {
      const range = parser.parseTemporalExpression('last 5 minutes', REF);
      expect(range).not.toBeNull();
      const diffMs = REF.getTime() - range!.start.getTime();
      expect(diffMs).toBeCloseTo(5 * 60_000, -2);
    });

    it('should handle "last year"', () => {
      const range = parser.parseTemporalExpression('last year', REF);
      expect(range).not.toBeNull();
      const diffDays = (REF.getTime() - range!.start.getTime()) / (24 * 3_600_000);
      expect(diffDays).toBeGreaterThan(360);
      expect(diffDays).toBeLessThan(370);
    });
  });
});
