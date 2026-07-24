/**
 * S8 — verifies chrono-node is loaded lazily.
 *
 * chrono-node is the heaviest external dependency on the default import
 * path. TemporalQueryParser must not load it at module scope: importing the
 * search barrel (and therefore the library root) should never evaluate
 * chrono-node; it should only load on the first parse that actually needs it.
 *
 * Mechanism: `vi.mock('chrono-node', factory)` — the factory only executes
 * when some module under test actually imports chrono-node. The hoisted flag
 * therefore records whether the dependency was evaluated.
 *
 * NOTE on ordering: tests in this file are order-dependent (module caches are
 * shared within the file). The "does not load" assertions must run before the
 * test that intentionally triggers the load. The sync `createRequire`
 * fallback path inside TemporalQueryParser bypasses vitest's mock registry,
 * so this file only asserts the dynamic-import path; sync behaviour is
 * covered by TemporalQueryParser.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({ chronoEvaluated: false }));

vi.mock('chrono-node', async (importOriginal) => {
  state.chronoEvaluated = true;
  return await importOriginal<typeof import('chrono-node')>();
});

const REF = new Date('2024-06-15T14:30:00.000Z');

describe('TemporalQueryParser lazy chrono-node loading (S8)', () => {
  it('importing the search barrel does not load chrono-node', async () => {
    await import('../../../src/search/index.js');
    expect(state.chronoEvaluated).toBe(false);
  });

  it('constructing the parser and parsing chrono-free custom patterns does not load chrono-node', async () => {
    const { TemporalQueryParser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new TemporalQueryParser();

    for (const expr of ['last hour', '10 minutes ago', 'today', 'yesterday', 'this week']) {
      const range = await parser.parseTemporalExpressionAsync(expr, REF);
      expect(range, expr).toBeDefined();
    }

    expect(state.chronoEvaluated).toBe(false);
  });

  it('async parse of a chrono-requiring expression loads chrono-node on demand', async () => {
    const { TemporalQueryParser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new TemporalQueryParser();

    const range = await parser.parseTemporalExpressionAsync(
      'between 2024-06-01 and 2024-06-10',
      REF
    );

    expect(range).toBeDefined();
    expect(range!.start.getFullYear()).toBe(2024);
    expect(state.chronoEvaluated).toBe(true);
  });
});
