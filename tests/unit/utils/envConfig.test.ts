/**
 * Table-driven tests for the shared env-var parsing helpers (DES-2).
 *
 * Each table pins the accept/reject matrix of one idiom so the migrated call
 * sites (GraphStorage, JsonlProceduralGraphBacking, SQLiteStorage,
 * TFIDFEventSync, CachePressureCoordinator, QueryLogger) keep their previous
 * behaviour.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { logger } from '../../../src/utils/logger.js';
import {
  readEnvStrictFlag,
  readEnvLooseFlag,
  readEnvNumber,
  readEnvNumberOrUndefined,
  readEnvStrictInt,
  parseStrictDecimalInt,
  parseSegmentCount,
  readEnvPositiveIntOrDefault,
  readEnvNonNegativeIntOrDefault,
  MAX_SEGMENT_COUNT,
} from '../../../src/utils/envConfig.js';

const VAR = 'MEMORY_ENVCONFIG_TEST_VAR';

function setVar(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[VAR];
  } else {
    process.env[VAR] = value;
  }
}

describe('envConfig', () => {
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[VAR];
    setVar(undefined);
  });

  afterEach(() => {
    setVar(savedValue);
    vi.restoreAllMocks();
  });

  describe('readEnvStrictFlag (only the literal "true" enables)', () => {
    it.each([
      ['unset', undefined, false],
      ['empty', '', false],
      ['true', 'true', true],
      ['TRUE', 'TRUE', false],
      ['True', 'True', false],
      ['1', '1', false],
      ['yes', 'yes', false],
      ['false', 'false', false],
      ['padded " true"', ' true', false],
    ] as const)('%s -> %s', (_label, value, expected) => {
      setVar(value);
      expect(readEnvStrictFlag(VAR)).toBe(expected);
    });
  });

  describe('readEnvLooseFlag (case-insensitive "true")', () => {
    it.each([
      ['unset, default false', undefined, false, false],
      ['unset, default true', undefined, true, true],
      ['true', 'true', false, true],
      ['TRUE', 'TRUE', false, true],
      ['True', 'True', false, true],
      ['1', '1', false, false],
      ['false', 'false', true, false],
      ['empty', '', true, false],
    ] as const)('%s', (_label, value, defaultValue, expected) => {
      setVar(value);
      expect(readEnvLooseFlag(VAR, defaultValue)).toBe(expected);
    });
  });

  describe('readEnvNumber (bounds + logged fallback)', () => {
    it.each([
      ['unset -> default silently', undefined, undefined, 5],
      ['blank -> default silently', '   ', undefined, 5],
      ['plain value', '0.5', undefined, 0.5],
      ['padded value is trimmed', ' 7 ', undefined, 7],
      ['numeric prefix rejected', '10abc', undefined, 5],
      ['NaN rejected', 'NaN', undefined, 5],
      ['Infinity rejected', 'Infinity', undefined, 5],
      ['integer bound accepts 4', '4', { integer: true }, 4],
      ['integer bound rejects 3.5', '3.5', { integer: true }, 5],
      ['min bound rejects -1', '-1', { min: 0 }, 5],
      ['min bound accepts 0', '0', { min: 0 }, 0],
      ['max bound rejects 2', '2', { max: 1 }, 5],
      ['max bound accepts 1', '1', { max: 1 }, 1],
    ] as const)('%s', (_label, value, bounds, expected) => {
      setVar(value);
      expect(readEnvNumber(VAR, 5, bounds ? { ...bounds } : undefined)).toBe(expected);
    });

    it('logs a warning for malformed, non-integer, and out-of-bounds values', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      setVar('NaN');
      readEnvNumber(VAR, 5);
      setVar('3.5');
      readEnvNumber(VAR, 5, { integer: true });
      setVar('-1');
      readEnvNumber(VAR, 5, { min: 0 });
      setVar('9');
      readEnvNumber(VAR, 5, { max: 1 });
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn.mock.calls[0][0]).toContain(`${VAR}='NaN' is not a finite number; using 5`);
      expect(warn.mock.calls[1][0]).toContain('must be an integer');
      expect(warn.mock.calls[2][0]).toContain('is below the minimum 0');
      expect(warn.mock.calls[3][0]).toContain('is above the maximum 1');
    });

    it('does not warn for unset or blank values', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      readEnvNumber(VAR, 5);
      setVar('  ');
      readEnvNumber(VAR, 5);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('readEnvNumberOrUndefined', () => {
    it.each([
      ['unset', undefined, undefined],
      ['empty', '', undefined],
      ['integer', '12', 12],
      ['exponent', '1e3', 1000],
      ['padded (Number trims)', ' 12 ', 12],
      ['non-numeric', 'abc', undefined],
      ['Infinity', 'Infinity', undefined],
      ['NaN', 'NaN', undefined],
    ] as const)('%s', (_label, value, expected) => {
      setVar(value);
      expect(readEnvNumberOrUndefined(VAR)).toBe(expected);
    });
  });

  describe('parseStrictDecimalInt / readEnvStrictInt (strict decimal grammar)', () => {
    const cases: Array<[string | undefined, number | undefined]> = [
      [undefined, undefined],
      ['', undefined],
      ['0', 0],
      ['7', 7],
      ['007', undefined],
      ['1e3', undefined],
      ['0x10', undefined],
      ['-5', undefined],
      ['+5', undefined],
      [' 5', undefined],
      ['5 ', undefined],
      ['3.7', undefined],
      ['yes', undefined],
    ];

    it.each(cases)('unbounded %s -> %s', (value, expected) => {
      expect(parseStrictDecimalInt(value)).toBe(expected);
    });

    it.each([
      ['1', undefined],
      ['2', 2],
      ['1024', 1024],
      ['1025', undefined],
      ['0', undefined],
      ['007', undefined],
      ['1e3', undefined],
      ['-5', undefined],
      ['3.7', undefined],
    ] as const)('bounded [2,1024] %s -> %s', (value, expected) => {
      expect(parseStrictDecimalInt(value, { min: 2, max: 1024 })).toBe(expected);
    });

    it('readEnvStrictInt reads the variable with the same grammar', () => {
      setVar('16');
      expect(readEnvStrictInt(VAR, { min: 1 })).toBe(16);
      setVar('0');
      expect(readEnvStrictInt(VAR, { min: 1 })).toBeUndefined();
      setVar('0x10');
      expect(readEnvStrictInt(VAR)).toBeUndefined();
      setVar(undefined);
      expect(readEnvStrictInt(VAR)).toBeUndefined();
    });

    it('accepts 0 as a floor for mmap-style thresholds', () => {
      setVar('0');
      expect(readEnvStrictInt(VAR, { min: 0 })).toBe(0);
    });
  });

  describe('parseSegmentCount (MEMORY_STORAGE_SEGMENT_COUNT)', () => {
    it('exposes the 1024 ceiling', () => {
      expect(MAX_SEGMENT_COUNT).toBe(1024);
    });

    it.each([
      [undefined, null],
      ['', null],
      ['1', null],
      ['2', 2],
      ['16', 16],
      ['1024', 1024],
      ['1025', null],
      ['0', null],
      ['007', null],
      ['1e3', null],
      ['0x10', null],
      ['-5', null],
      ['+5', null],
      [' 5', null],
      ['3.7', null],
      ['99999999999999999999', null],
    ] as const)('%s -> %s', (value, expected) => {
      expect(parseSegmentCount(value)).toBe(expected);
    });
  });

  describe('readEnvPositiveIntOrDefault (lenient parseInt, min 1)', () => {
    it.each([
      ['unset', undefined, 4],
      ['empty', '', 4],
      ['8', '8', 8],
      ['10abc (documented leniency)', '10abc', 10],
      ['1e3 (parseInt stops at e)', '1e3', 1],
      ['2.9 truncates', '2.9', 2],
      ['0 -> default', '0', 4],
      ['-3 -> default', '-3', 4],
      ['abc -> default', 'abc', 4],
      ['overflowing digits -> default', '9'.repeat(400), 4],
    ] as const)('%s', (_label, value, expected) => {
      setVar(value);
      expect(readEnvPositiveIntOrDefault(VAR, 4)).toBe(expected);
    });
  });

  describe('readEnvNonNegativeIntOrDefault (lenient parseInt, min 0)', () => {
    it.each([
      ['unset', undefined, 50],
      ['empty', '', 50],
      ['0 is allowed', '0', 0],
      ['250 is allowed', '250', 250],
      ['250ms (documented leniency)', '250ms', 250],
      ['-1 -> default', '-1', 50],
      ['abc -> default', 'abc', 50],
    ] as const)('%s', (_label, value, expected) => {
      setVar(value);
      expect(readEnvNonNegativeIntOrDefault(VAR, 50)).toBe(expected);
    });
  });
});
