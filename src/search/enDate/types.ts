/**
 * Internal value types for the in-repo English date parser.
 *
 * The shapes mirror chrono-node's parsing model: a parser proposes components
 * for a matched slice of text, refiners fill in implied fields and merge
 * neighbouring results, and a final {@link EnDateResult} is produced when the
 * components are resolved to an instant.
 *
 * @module search/enDate/types
 * @internal
 */

/** Component names a parser can know or imply. */
export type ComponentKey =
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'millisecond'
  | 'weekday'
  | 'meridiem'
  | 'timezoneOffset';

/** 0 = AM, 1 = PM (matches chrono-node's `Meridiem` enum). */
export const MERIDIEM_AM = 0;
export const MERIDIEM_PM = 1;

/** A resolved date range slice of the input text. */
export interface EnDateResult {
  /** Start instant of the match. */
  start: Date;
  /** End instant when the match describes an explicit range. */
  end?: Date;
  /** Offset of the match in the input string. */
  index: number;
  /** Matched text. */
  text: string;
}

/** Options accepted by {@link parseEnDate}. */
export interface EnDateOptions {
  /**
   * Prefer the next occurrence of a time or weekday that has already passed
   * relative to the reference date.
   */
  forwardDate?: boolean;
}

/**
 * A set of known and implied calendar components.
 *
 * `known` holds values the text stated explicitly; `implied` holds values
 * filled in from the reference date or from a neighbouring result. Resolution
 * to an instant reads `known` first, then `implied`.
 */
export interface Components {
  known: Partial<Record<ComponentKey, number>>;
  implied: Partial<Record<ComponentKey, number>>;
  tags: Set<string>;
}

/** A matched slice of text plus its start (and optional end) components. */
export interface ParsedResult {
  index: number;
  text: string;
  start: Components;
  end?: Components;
}

/** Duration fragments, e.g. `{ hour: 2 }` for "2 hours". */
export type Duration = Partial<Record<'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond', number>>;

/** Parsing context shared by the parsers and refiners of one parse call. */
export interface ParseContext {
  /** Input text. */
  text: string;
  /** Reference instant. */
  refDate: Date;
  /** Caller options. */
  options: EnDateOptions;
}
