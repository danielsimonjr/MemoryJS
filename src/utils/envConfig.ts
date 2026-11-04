/**
 * Shared environment-variable parsing helpers.
 *
 * Each helper encodes one of the parsing idioms the codebase already uses,
 * so call sites share a single implementation instead of re-deriving the
 * rules. Behaviour is deliberately preserved per idiom: a helper accepts and
 * rejects exactly the inputs its previous inline copy did.
 *
 * Idioms:
 * - Strict flag: only the literal `'true'` enables (`readEnvStrictFlag`).
 * - Loose flag: case-insensitive `'true'` (`readEnvLooseFlag`).
 * - Number with bounds and logged fallback (`readEnvNumber`).
 * - Finite number or `undefined` (`readEnvNumberOrUndefined`).
 * - Strict decimal integer: `^(0|[1-9][0-9]*)$` plus optional bounds
 *   (`readEnvStrictInt`, `parseStrictDecimalInt`, `parseSegmentCount`).
 * - Lenient `parseInt` with fallback (`readEnvPositiveIntOrDefault`,
 *   `readEnvNonNegativeIntOrDefault`). Lenient on purpose: `'10abc'` -> 10.
 *
 * @module utils/envConfig
 * @public
 */

import { logger } from './logger.js';

/** Bounds accepted by {@link readEnvNumber}. */
export interface EnvNumberBounds {
  /** Reject non-integers (logged, falls back to the default). */
  integer?: boolean;
  /** Inclusive lower bound. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
}

/** Inclusive bounds accepted by {@link readEnvStrictInt}. */
export interface EnvStrictIntBounds {
  min?: number;
  max?: number;
}

/** Maximum segment count accepted for segment-mode JSONL storage. */
export const MAX_SEGMENT_COUNT = 1024;

/**
 * Plain non-negative decimal integer literal. Rejects floats, exponents,
 * hex, leading zeros (except a lone `0`), signs, and whitespace.
 */
const STRICT_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Strict flag: enabled only when the variable is exactly `'true'`.
 * Unset, empty, `'TRUE'`, `'1'`, and `'yes'` all read as disabled.
 *
 * @public
 */
export function readEnvStrictFlag(name: string): boolean {
  return process.env[name] === 'true';
}

/**
 * Loose flag: enabled when the variable equals `'true'` ignoring case.
 * Returns `defaultValue` when the variable is unset.
 *
 * @public
 */
export function readEnvLooseFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Read a finite number with optional bounds. Unset or blank values return
 * `defaultValue` silently. Malformed, non-finite, or out-of-bounds values log
 * a warning and return `defaultValue`.
 *
 * @public
 */
export function readEnvNumber(
  name: string,
  defaultValue: number,
  bounds?: EnvNumberBounds,
): number {
  const value = process.env[name];
  if (value === undefined) return defaultValue;

  const raw = value.trim();
  if (raw === '') return defaultValue;

  // `Number` rejects a numeric prefix ('10abc') that `parseFloat` accepts,
  // and the finite check rejects 'Infinity' and 'NaN'.
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    logger.warn(`${name}='${value}' is not a finite number; using ${defaultValue}`);
    return defaultValue;
  }
  if (bounds?.integer && !Number.isInteger(parsed)) {
    logger.warn(`${name}='${value}' must be an integer; using ${defaultValue}`);
    return defaultValue;
  }
  if (bounds?.min !== undefined && parsed < bounds.min) {
    logger.warn(`${name}='${value}' is below the minimum ${bounds.min}; using ${defaultValue}`);
    return defaultValue;
  }
  if (bounds?.max !== undefined && parsed > bounds.max) {
    logger.warn(`${name}='${value}' is above the maximum ${bounds.max}; using ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Read a finite number, or `undefined` when the variable is unset, empty,
 * or not a finite number. Does not trim and does not log.
 *
 * @public
 */
export function readEnvNumberOrUndefined(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a raw string as a strict decimal integer with optional inclusive
 * bounds. Returns `undefined` for `undefined`, `''`, any non-matching
 * literal, or an out-of-bounds value. Never throws and never logs.
 *
 * @public
 */
export function parseStrictDecimalInt(
  raw: string | undefined,
  bounds: EnvStrictIntBounds = {},
): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!STRICT_DECIMAL_PATTERN.test(raw)) return undefined;
  const n = Number(raw);
  if (bounds.min !== undefined && n < bounds.min) return undefined;
  if (bounds.max !== undefined && n > bounds.max) return undefined;
  return n;
}

/**
 * Read an environment variable as a strict decimal integer. See
 * {@link parseStrictDecimalInt} for the accepted grammar.
 *
 * @public
 */
export function readEnvStrictInt(name: string, bounds: EnvStrictIntBounds = {}): number | undefined {
  return parseStrictDecimalInt(process.env[name], bounds);
}

/**
 * Resolve a raw `MEMORY_STORAGE_SEGMENT_COUNT` value. Returns the segment
 * count when it is a strict decimal integer in `[2, MAX_SEGMENT_COUNT]`, and
 * `null` otherwise (segment mode stays off). Floats (`3.7`), exponents
 * (`1e3`), hex (`0x10`), leading zeros (`007`), signs, and whitespace fail
 * closed so the misconfiguration is visible.
 *
 * @public
 */
export function parseSegmentCount(raw: string | undefined): number | null {
  return parseStrictDecimalInt(raw, { min: 2, max: MAX_SEGMENT_COUNT }) ?? null;
}

/**
 * Shared `parseInt` core. Unset, non-numeric, non-finite, or below-minimum
 * values return `defaultValue`. Lenient: a numeric prefix is accepted
 * (`'10abc'` -> 10).
 */
function parseLenientIntOrDefault(raw: string | undefined, defaultValue: number, min: number): number {
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : defaultValue;
}

/**
 * Lenient `parseInt` for a value that must be at least 1. `'10abc'` -> 10,
 * `'0'`, `'-5'`, `'abc'`, and unset fall back to `defaultValue`.
 *
 * @public
 */
export function readEnvPositiveIntOrDefault(name: string, defaultValue: number): number {
  return parseLenientIntOrDefault(process.env[name], defaultValue, 1);
}

/**
 * Lenient `parseInt` for a value that must be at least 0. `'10abc'` -> 10,
 * `'0'` -> 0, `'-5'`, `'abc'`, and unset fall back to `defaultValue`.
 *
 * @public
 */
export function readEnvNonNegativeIntOrDefault(name: string, defaultValue: number): number {
  return parseLenientIntOrDefault(process.env[name], defaultValue, 0);
}
