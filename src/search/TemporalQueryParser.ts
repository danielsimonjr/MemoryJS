/**
 * Temporal Query Parser
 *
 * Feature 3 (Must-Have): Parses natural language temporal expressions into
 * concrete date ranges using chrono-node.
 *
 * @module search/TemporalQueryParser
 */

import * as chrono from 'chrono-node';

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
   * @returns Resolved date range or null if text cannot be parsed
   */
  parseTemporalExpression(text: string, referenceDate?: Date): ParsedTemporalRange | null {
    if (!text || text.trim().length === 0) return null;

    const ref = referenceDate ?? new Date();
    const trimmed = text.trim();

    // Try custom pattern matching first for commonly-used relative ranges
    const custom = this.parseCustomPattern(trimmed, ref);
    if (custom) return custom;

    // Fall back to chrono-node for everything else
    return this.parseWithChrono(trimmed, ref);
  }

  /**
   * Handle common relative range patterns not covered well by chrono-node.
   * @internal
   */
  private parseCustomPattern(text: string, ref: Date): ParsedTemporalRange | null {
    const lower = text.toLowerCase();

    // "in the past N unit(s)" or "past N unit(s)" or "last N unit(s)"
    const pastNMatch = lower.match(
      /^(?:in\s+the\s+)?(?:past|last)\s+(\d+)\s+(second|minute|hour|day|week|month|year)s?$/
    );
    if (pastNMatch) {
      const n = parseInt(pastNMatch[1], 10);
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

    // "this month" → start of month to end of month
    if (/^this\s+month$/.test(lower)) {
      const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end, originalExpression: text };
    }

    // "this year" → start of year to end of year
    if (/^this\s+year$/.test(lower)) {
      const start = new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);
      const end = new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { start, end, originalExpression: text };
    }

    // "today" → start of today to end of today
    if (/^today$/.test(lower)) {
      const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
      const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
      return { start, end, originalExpression: text };
    }

    // "yesterday" → start of yesterday to end of yesterday
    if (/^yesterday$/.test(lower)) {
      const yesterday = new Date(ref);
      yesterday.setDate(yesterday.getDate() - 1);
      const start = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        0, 0, 0, 0
      );
      const end = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        23, 59, 59, 999
      );
      return { start, end, originalExpression: text };
    }

    // "since X" → parse X as start, use ref as end
    const sinceMatch = lower.match(/^since\s+(.+)$/);
    if (sinceMatch) {
      const parsed = chrono.parseDate(sinceMatch[1], ref, { forwardDate: false });
      if (parsed) {
        return { start: parsed, end: new Date(ref), originalExpression: text };
      }
    }

    // "N minutes/hours/days ago" → [parsedDate, now]
    const agoMatch = lower.match(
      /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/
    );
    if (agoMatch) {
      const n = parseInt(agoMatch[1], 10);
      const unit = agoMatch[2];
      const start = this.subtractUnit(ref, n, unit);
      return { start, end: new Date(ref), originalExpression: text };
    }

    return null;
  }

  /**
   * Use chrono-node to parse expressions not handled by custom patterns.
   * @internal
   */
  private parseWithChrono(text: string, ref: Date): ParsedTemporalRange | null {
    // Try to parse as a range (e.g. "between Monday and Wednesday", "Jan 1 to Jan 7")
    const results = chrono.parse(text, ref, { forwardDate: false });

    if (results.length === 0) {
      // Try with forwardDate: true as fallback
      const forwardResults = chrono.parse(text, ref, { forwardDate: true });
      if (forwardResults.length === 0) return null;

      const first = forwardResults[0];
      const start = first.start.date();
      const end = first.end ? first.end.date() : new Date(ref);
      if (!this.isValidRange(start, end)) return null;
      return { start, end, originalExpression: text };
    }

    const first = results[0];
    const start = first.start.date();

    // If the parsed result has an explicit end date, use it
    if (first.end) {
      const end = first.end.date();
      if (!this.isValidRange(start, end)) return null;
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
   * Get the start of the week (Sunday at midnight) for a given date.
   * @internal
   */
  private startOfWeek(d: Date): Date {
    const result = new Date(d);
    result.setDate(result.getDate() - result.getDay());
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get the end of the week (Saturday at 23:59:59.999) for a given date.
   * @internal
   */
  private endOfWeek(d: Date): Date {
    const result = new Date(d);
    result.setDate(result.getDate() + (6 - result.getDay()));
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Validate that start <= end (a non-empty range).
   * @internal
   */
  private isValidRange(start: Date, end: Date): boolean {
    return start.getTime() <= end.getTime();
  }
}
