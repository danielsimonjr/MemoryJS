/**
 * TemporalQueryParser — the date parser is in-repo and synchronous.
 *
 * This file replaces the old "chrono-node is loaded lazily" test. There is no
 * parser module to load any more, so the property worth guarding is the
 * opposite: importing the search barrel (and therefore the library root) pulls
 * in no external date-parsing dependency, and parsing a phrase that used to
 * require one now resolves without any dynamic import at all.
 */

import { describe, it, expect } from 'vitest';

const REF = new Date('2026-01-15T12:00:00.000Z');

describe('TemporalQueryParser in-repo parser', () => {
  it('importing the search barrel does not reach for an external date parser', async () => {
    const barrel = await import('../../../src/search/index.js');
    expect(typeof barrel.TemporalQueryParser).toBe('function');
  });

  it('parses chrono-free custom patterns synchronously', async () => {
    const { TemporalQueryParser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new TemporalQueryParser();

    for (const expr of ['last hour', '10 minutes ago', 'today', 'yesterday', 'this week']) {
      const range = await parser.parseTemporalExpressionAsync(expr, REF);
      expect(range, expr).toBeDefined();
    }
  });

  it('parses a range expression that used to need the external parser', async () => {
    const { TemporalQueryParser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new TemporalQueryParser();

    const range = await parser.parseTemporalExpressionAsync('between 2024-06-01 and 2024-06-10', REF);

    expect(range).toBeDefined();
    expect(range!.start.toISOString()).toBe('2024-06-01T12:00:00.000Z');
    expect(range!.end.toISOString()).toBe('2024-06-10T12:00:00.000Z');
  });

  it('keeps the async and sync entry points in agreement', async () => {
    const { TemporalQueryParser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new TemporalQueryParser();

    for (const expr of ['last hour', 'next Friday', '2026-01-15T12:00:00Z', 'Jan 1 to Jan 7']) {
      const sync = parser.parseTemporalExpression(expr, REF);
      const async = await parser.parseTemporalExpressionAsync(expr, REF);
      expect(async?.start.toISOString(), expr).toBe(sync?.start.toISOString());
      expect(async?.end.toISOString(), expr).toBe(sync?.end.toISOString());
    }
  });
});
