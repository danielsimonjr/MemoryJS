/**
 * Eviction index: a record of context ranges that were pushed out of the working window.
 *
 * Each range names the first and last interaction address it covers (`e<n>`), a one-line
 * summary and the token count it freed. `ContextWindowManager` records into it during
 * spillover and appends the latest ranges as `[evicted]` lines so the model can see what
 * was dropped and where to look it up.
 *
 * Entities carry the address they were derived from in `AgentEntity.interactionAddr`;
 * spillover reads that field to name the evicted span and never invents one.
 *
 * @module agent/harness/EvictionIndex
 * @experimental Part of the Recursa harness (spec RS-8).
 */

import { ErrorCode, KnowledgeGraphError } from '../../utils/errors.js';

/** One evicted span of interactions. */
export interface EvictionRange {
  /** First interaction address covered, `e<n>` with n >= 1. */
  fromAddr: string;
  /** Last interaction address covered, `e<n>` with n >= 1. */
  toAddr: string;
  /** One-line description of the evicted content. */
  summary: string;
  /** Tokens freed by the eviction. Non-negative and finite. */
  tokens: number;
}

const ADDR_PATTERN = /^e[1-9][0-9]*$/;

/**
 * Ordered, in-memory list of eviction ranges.
 *
 * Ranges are kept in insertion order. The index stores copies, so callers may reuse their
 * objects after `record`.
 */
export class EvictionIndex {
  private ranges: EvictionRange[] = [];

  /**
   * Append an eviction range. Recording the same `(fromAddr, toAddr)` again replaces the
   * earlier entry's summary and tokens in place instead of adding a duplicate.
   *
   * @param range - Range to record
   * @throws KnowledgeGraphError when an address is malformed, `fromAddr` is after `toAddr`,
   *   the summary is not a string, or tokens is not a non-negative finite number
   */
  record(range: EvictionRange): void {
    if (!ADDR_PATTERN.test(range.fromAddr) || !ADDR_PATTERN.test(range.toAddr)) {
      throw new KnowledgeGraphError(
        `Eviction addresses must match ^e[1-9][0-9]*$ (got '${range.fromAddr}' .. '${range.toAddr}')`,
        ErrorCode.INVALID_FIELD_VALUE,
      );
    }
    if (typeof range.tokens !== 'number' || !Number.isFinite(range.tokens) || range.tokens < 0) {
      throw new KnowledgeGraphError(
        `Eviction tokens must be a non-negative finite number (got ${String(range.tokens)})`,
        ErrorCode.INVALID_FIELD_VALUE,
      );
    }
    if (Number(range.fromAddr.slice(1)) > Number(range.toAddr.slice(1))) {
      throw new KnowledgeGraphError(
        `Eviction fromAddr must not be after toAddr (got '${range.fromAddr}' .. '${range.toAddr}')`,
        ErrorCode.INVALID_FIELD_VALUE,
      );
    }
    if (typeof range.summary !== 'string') {
      throw new KnowledgeGraphError('Eviction summary must be a string', ErrorCode.INVALID_FIELD_VALUE);
    }
    const copy = { fromAddr: range.fromAddr, toAddr: range.toAddr, summary: range.summary, tokens: range.tokens };
    const existing = this.ranges.find((r) => r.fromAddr === copy.fromAddr && r.toAddr === copy.toAddr);
    if (existing) {
      existing.summary = copy.summary;
      existing.tokens = copy.tokens;
    } else {
      this.ranges.push(copy);
    }
  }

  /**
   * Record the span covered by spilled entities' `interactionAddr` values. Total: never
   * throws. Does nothing when no entity carries a valid address. Non-finite or negative
   * `tokens` are recorded as 0.
   *
   * @param addrs - Candidate addresses, typically `AgentEntity.interactionAddr` values
   * @param summary - One-line summary of the spilled content
   * @param tokens - Tokens freed
   * @returns True when a range was recorded
   */
  recordSpill(addrs: unknown[], summary: string, tokens: unknown): boolean {
    try {
      const span = addrSpan(addrs);
      if (!span) return false;
      const t = Number(tokens);
      this.record({ ...span, summary: String(summary), tokens: Number.isFinite(t) && t >= 0 ? t : 0 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * All recorded ranges, oldest first.
   *
   * @returns Copies of the recorded ranges
   */
  list(): EvictionRange[] {
    return this.ranges.map((r) => ({ ...r }));
  }

  /**
   * The most recent `n` ranges, oldest first.
   *
   * @param n - How many ranges to return. Values below 1 return an empty array.
   * @returns Copies of up to `n` ranges
   */
  latest(n: number): EvictionRange[] {
    if (!(n >= 1)) return [];
    return this.ranges.slice(-Math.floor(n)).map((r) => ({ ...r }));
  }

  /** Remove every recorded range. */
  clear(): void {
    this.ranges = [];
  }

  /** Number of recorded ranges. */
  get size(): number {
    return this.ranges.length;
  }
}

/**
 * Format a range as an `[evicted]` line.
 *
 * The summary is trimmed and every run of line breaks (with surrounding spaces) becomes one space.
 * A literal `[evicted]:` in the summary becomes `[evicted]`, so a summary cannot imitate a range line.
 *
 * @param range - Range to format
 * @returns A line such as `[evicted]: e12–e48 — <summary>`
 */
export function formatEvictionLine(range: EvictionRange): string {
  const summary = range.summary
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\[evicted\]\s*:/gi, '[evicted]')
    .trim();
  return `[evicted]: ${range.fromAddr}–${range.toAddr} — ${summary}`;
}

/**
 * Smallest and largest valid `e<n>` address among `values`. Non-string and malformed values are ignored.
 *
 * @param values - Candidate addresses, typically read from entities
 * @returns The covering span, or undefined when no valid address is present
 */
export function addrSpan(values: unknown[]): { fromAddr: string; toAddr: string } | undefined {
  const addrs = values
    .filter((v): v is string => typeof v === 'string' && ADDR_PATTERN.test(v))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return addrs.length > 0 ? { fromAddr: addrs[0], toAddr: addrs[addrs.length - 1] } : undefined;
}
