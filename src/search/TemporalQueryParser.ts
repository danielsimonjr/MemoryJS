/**
 * Temporal Query Parser
 *
 * Feature 3 (Must-Have): Parses natural language temporal expressions into
 * concrete date ranges using chrono-node.
 *
 * @module search/TemporalQueryParser
 */

import { createRequire } from 'node:module';

/**
 * Namespace type of chrono-node. Type-only — erased at runtime, so this
 * declaration does NOT trigger a module load.
 */
type ChronoModule = typeof import('chrono-node');

/**
 * Memoized chrono-node module. chrono-node is the heaviest external
 * dependency on the default import path (~hundreds of ms cold), so it is
 * loaded lazily on first use instead of at module scope (S8).
 */
let chronoModule: ChronoModule | undefined;
let chronoLoadPromise: Promise<ChronoModule> | undefined;

/**
 * Normalize ESM/CJS interop shapes: `import('chrono-node')` may surface the
 * API either as named exports on the namespace or under `default`.
 */
function resolveChronoNamespace(mod: unknown): ChronoModule {
  const candidate = mod as { parse?: unknown; default?: { parse?: unknown } };
  if (typeof candidate.parse === 'function') return mod as ChronoModule;
  if (candidate.default && typeof candidate.default.parse === 'function') {
    return candidate.default as ChronoModule;
  }
  throw new Error('chrono-node module loaded but no parse() export was found');
}

/**
 * Asynchronously load chrono-node (memoized). Preferred loading path —
 * bundler-friendly (code-splittable) and non-blocking.
 */
function loadChrono(): Promise<ChronoModule> {
  if (chronoModule) return Promise.resolve(chronoModule);
  if (!chronoLoadPromise) {
    chronoLoadPromise = import('chrono-node').then((mod) => {
      chronoModule = resolveChronoNamespace(mod);
      return chronoModule;
    });
  }
  return chronoLoadPromise;
}

/**
 * Synchronously load chrono-node (memoized). Fallback for the public sync
 * `parseTemporalExpression()` API — uses `createRequire`, which works in
 * both the ESM and CJS builds under Node. Callers that can go async should
 * prefer `parseTemporalExpressionAsync()`, which uses dynamic `import()`.
 */
function requireChronoSync(): ChronoModule {
  if (!chronoModule) {
    const requireModule = createRequire(import.meta.url);
    chronoModule = resolveChronoNamespace(requireModule('chrono-node'));
  }
  return chronoModule;
}

/**
 * A resolved temporal range with concrete Date boundaries.
 *
 * This is distinct from the existing `TemporalRange` in `types/types.ts`
 * (which stores ISO strings for query analysis). This type carries
 * actual Date objects ready for comparison against entity timestamps.
 *
 * @example
 * ```typescript
 * const parser = new TemporalQueryParser();
 * const range = parser.parseTemporalExpression('last hour');
 * // range.start => ~60 minutes ago
 * // range.end   => now
 * ```
 */
export interface ParsedTemporalRange {
  /** Inclusive start of the temporal range */
  start: Date;
  /** Inclusive end of the temporal range */
  end: Date;
  /** Original expression that produced this range */
  originalExpression: string;
}

/**
 * Parses natural language temporal expressions into concrete date ranges.
 *
 * Uses chrono-node for robust natural language date parsing with a set
 * of custom patterns for common relative expressions.
 *
 * Supported expressions (examples):
 * - "10 minutes ago"
 * - "last hour" / "past hour"
 * - "since yesterday"
 * - "last week" / "past week"
 * - "last month"
 * - "this week" / "this month" / "this year"
 * - "between Monday and Wednesday"
 * - "in the past 3 days"
 * - Any expression parseable by chrono-node
 *
 * @example
 * ```typescript
 * const parser = new TemporalQueryParser();
 *
 * // Relative range
 * const r1 = parser.parseTemporalExpression('last hour');
 * console.log(r1?.start, r1?.end);
 *
 * // Between expression
 * const r2 = parser.parseTemporalExpression('between Monday and Wednesday');
 *
 * // Single point → range [parsed, now]
 * const r3 = parser.parseTemporalExpression('since yesterday');
 * ```
 */
export class TemporalQueryParser {
  /**
   * Parse a natural language temporal expression into a date range.
   *
   * @param text - Natural language temporal expression
   * @param referenceDate - Reference date for relative calculations (default: now)
   * @returns Resolved date range or undefined if text cannot be parsed
   */
  parseTemporalExpression(text: string, referenceDate?: Date): ParsedTemporalRange | undefined {
    if (!text || text.trim().length === 0) return undefined;

    const ref = referenceDate ?? new Date();
    const trimmed = text.trim();

    // Try custom pattern matching first for commonly-used relative ranges.
    // These never need chrono-node, so the common relative-range case stays
    // dependency-free.
    const custom = this.parseCustomPattern(trimmed, ref);
    if (custom) return custom;

    // Fall back to chrono-node for everything else (lazy sync load)
    return this.parseWithChrono(trimmed, ref);
  }

  /**
   * Async variant of {@link parseTemporalExpression}.
   *
   * Ensures chrono-node is loaded via dynamic `import()` before parsing,
   * so the load never blocks the event loop with a synchronous `require`.
   * Prefer this from async call sites (e.g. `TemporalSearch.searchByTimeQuery`).
   *
   * @param text - Natural language temporal expression
   * @param referenceDate - Reference date for relative calculations (default: now)
   * @returns Resolved date range or undefined if text cannot be parsed
   */
  async parseTemporalExpressionAsync(
    text: string,
    referenceDate?: Date
  ): Promise<ParsedTemporalRange | undefined> {
    if (!text || text.trim().length === 0) return undefined;

    const ref = referenceDate ?? new Date();
    const trimmed = text.trim();

    // The "since X" custom pattern consults chrono-node; every other custom
    // pattern is chrono-free. Preload via dynamic import() so the sync
    // fallback inside parseCustomPattern hits the memoized module.
    if (/^since\s/i.test(trimmed)) await loadChrono();

    const custom = this.parseCustomPattern(trimmed, ref);
    if (custom) return custom;

    await loadChrono();
    return this.parseWithChrono(trimmed, ref);
  }

  /**
   * Handle common relative range patterns not covered well by chrono-node.
   * @internal
   */
  private parseCustomPattern(text: string, ref: Date): ParsedTemporalRange | undefined {
    const lower = text.toLowerCase();

    // "in the past N unit(s)" or "past N unit(s)" or "last N unit(s)"
    // \d{1,6} bounds the digit run to avoid ReDoS on pathological input
    const pastNMatch = lower.match(
      /^(?:in\s+the\s+)?(?:past|last)\s+(\d{1,6})\s+(second|minute|hour|day|week|month|year)s?$/
    );
    if (pastNMatch) {
      const n = parseInt(pastNMatch[1], 10);
      if (n > 1_000_000) return undefined; // reject absurd values
      const unit = pastNMatch[2];
      const start = this.subtractUnit(ref, n, unit);
      return { start, end: new Date(ref), originalExpression: text };
    }

    // "last hour" / "past hour"
    if (/^(?:the\s+)?(?:past|last)\s+hour$/.test(lower)) {
      return {
        start: this.subtractUnit(ref, 1, 'hour'),
        end: new Date(ref),
        originalExpression: text,
      };
    }

    // "last week" / "past week"
    if (/^(?:the\s+)?(?:past|last)\s+week$/.test(lower)) {
      return {
        start: this.subtractUnit(ref, 7, 'day'),
        end: new Date(ref),
        originalExpression: text,
      };
    }

    // "last month" / "past month"
    if (/^(?:the\s+)?(?:past|last)\s+month$/.test(lower)) {
      return {
        start: this.subtractUnit(ref, 1, 'month'),
        end: new Date(ref),
        originalExpression: text,
      };
    }

    // "last year" / "past year"
    if (/^(?:the\s+)?(?:past|last)\s+year$/.test(lower)) {
      return {
        start: this.subtractUnit(ref, 1, 'year'),
        end: new Date(ref),
        originalExpression: text,
      };
    }

    // "this week" → start of week to end of week
    if (/^this\s+week$/.test(lower)) {
      const start = this.startOfWeek(ref);
      const end = this.endOfWeek(ref);
      return { start, end, originalExpression: text };
    }

    // "this month" → start of month to end of month (UTC)
    if (/^this\s+month$/.test(lower)) {
      const y = ref.getUTCFullYear();
      const m = ref.getUTCMonth();
      const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      return { start, end, originalExpression: text };
    }

    // "this year" → start of year to end of year (UTC)
    if (/^this\s+year$/.test(lower)) {
      const y = ref.getUTCFullYear();
      const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
      return { start, end, originalExpression: text };
    }

    // "today" → start of today to end of today (UTC)
    if (/^today$/.test(lower)) {
      const y = ref.getUTCFullYear();
      const m = ref.getUTCMonth();
      const d = ref.getUTCDate();
      const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
      return { start, end, originalExpression: text };
    }

    // "yesterday" → start of yesterday to end of yesterday (UTC)
    if (/^yesterday$/.test(lower)) {
      const y = ref.getUTCFullYear();
      const m = ref.getUTCMonth();
      const d = ref.getUTCDate() - 1;
      const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
      return { start, end, originalExpression: text };
    }

    // "since X" → parse X as start, use ref as end
    const sinceMatch = lower.match(/^since\s+(.+)$/);
    if (sinceMatch) {
      const parsed = requireChronoSync().parseDate(sinceMatch[1], ref, { forwardDate: false });
      if (parsed) {
        return { start: parsed, end: new Date(ref), originalExpression: text };
      }
    }

    // "N minutes/hours/days ago" → [parsedDate, now]
    // \d{1,6} bounds the digit run to avoid ReDoS on pathological input
    const agoMatch = lower.match(
      /^(\d{1,6})\s+(second|minute|hour|day|week|month|year)s?\s+ago$/
    );
    if (agoMatch) {
      const n = parseInt(agoMatch[1], 10);
      if (n > 1_000_000) return undefined; // reject absurd values
      const unit = agoMatch[2];
      const start = this.subtractUnit(ref, n, unit);
      return { start, end: new Date(ref), originalExpression: text };
    }

    return undefined;
  }

  /**
   * Use chrono-node to parse expressions not handled by custom patterns.
   * @internal
   */
  private parseWithChrono(text: string, ref: Date): ParsedTemporalRange | undefined {
    const chrono = requireChronoSync();
    // Try to parse as a range (e.g. "between Monday and Wednesday", "Jan 1 to Jan 7")
    const results = chrono.parse(text, ref, { forwardDate: false });

    if (results.length === 0) {
      // Try with forwardDate: true as fallback
      const forwardResults = chrono.parse(text, ref, { forwardDate: true });
      if (forwardResults.length === 0) return undefined;

      const first = forwardResults[0];
      const start = first.start.date();
      const end = first.end ? first.end.date() : new Date(ref);
      if (!this.isValidRange(start, end)) return undefined;
      return { start, end, originalExpression: text };
    }

    const first = results[0];
    const start = first.start.date();

    // If the parsed result has an explicit end date, use it
    if (first.end) {
      const end = first.end.date();
      if (!this.isValidRange(start, end)) return undefined;
      return { start, end, originalExpression: text };
    }

    // If we have multiple parsed dates, use first and last as range
    if (results.length >= 2) {
      const end = results[results.length - 1].start.date();
      if (!this.isValidRange(start, end)) {
        // Swap if needed
        return { start: end, end: start, originalExpression: text };
      }
      return { start, end, originalExpression: text };
    }

    // Single point: treat as [parsedDate, ref] (i.e. "since that time")
    // If it's in the past, range is [parsed, ref]; if in future, [ref, parsed]
    if (start <= ref) {
      return { start, end: new Date(ref), originalExpression: text };
    } else {
      return { start: new Date(ref), end: start, originalExpression: text };
    }
  }

  /**
   * Subtract N units from a reference date.
   * @internal
   */
  private subtractUnit(ref: Date, n: number, unit: string): Date {
    const d = new Date(ref);
    switch (unit) {
      case 'second':
        d.setSeconds(d.getSeconds() - n);
        break;
      case 'minute':
        d.setMinutes(d.getMinutes() - n);
        break;
      case 'hour':
        d.setHours(d.getHours() - n);
        break;
      case 'day':
        d.setDate(d.getDate() - n);
        break;
      case 'week':
        d.setDate(d.getDate() - n * 7);
        break;
      case 'month':
        d.setMonth(d.getMonth() - n);
        break;
      case 'year':
        d.setFullYear(d.getFullYear() - n);
        break;
    }
    return d;
  }

  /**
   * Get the start of the week (Sunday at midnight UTC) for a given date.
   * @internal
   */
  private startOfWeek(d: Date): Date {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate() - d.getUTCDay(); // back to Sunday
    return new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  }

  /**
   * Get the end of the week (Saturday at 23:59:59.999 UTC) for a given date.
   * @internal
   */
  private endOfWeek(d: Date): Date {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate() + (6 - d.getUTCDay()); // forward to Saturday
    return new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
  }

  /**
   * Validate that start <= end (a non-empty range).
   * @internal
   */
  private isValidRange(start: Date, end: Date): boolean {
    return start.getTime() <= end.getTime();
  }
}
