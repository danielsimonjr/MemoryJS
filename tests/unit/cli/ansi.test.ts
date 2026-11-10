/**
 * Tests for the CLI color helpers.
 *
 * The forced-color expectations are the strings chalk 6.0.0 produced at level 1,
 * recorded from a green run of the parity test before chalk was removed.
 *
 * @module tests/unit/cli/ansi.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ansi } from '../../../src/cli/ansi.js';

const ENV_KEYS = ['NO_COLOR', 'FORCE_COLOR'] as const;

function withStdoutTTY(value: boolean, run: () => void): void {
  const previous = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: previous, configurable: true });
  }
}

const FORCED: Array<[keyof typeof ansi, string]> = [
  ['bold', '\u001b[1mName\u001b[22m'],
  ['red', '\u001b[31mName\u001b[39m'],
  ['green', '\u001b[32mName\u001b[39m'],
  ['yellow', '\u001b[33mName\u001b[39m'],
  ['cyan', '\u001b[36mName\u001b[39m'],
  ['gray', '\u001b[90mName\u001b[39m'],
];

describe('ansi', () => {
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) previous[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('emits the recorded chalk codes when color is forced', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    for (const [style, expected] of FORCED) {
      expect(ansi[style]('Name')).toBe(expected);
    }
  });

  it('matches chalk for empty text, newlines, CRLF, and embedded close codes', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    expect(ansi.red('')).toBe('');
    expect(ansi.red('a\nb')).toBe('\u001b[31ma\u001b[39m\n\u001b[31mb\u001b[39m');
    expect(ansi.red('a\n')).toBe('\u001b[31ma\u001b[39m\n\u001b[31m\u001b[39m');
    expect(ansi.gray('a\r\nb')).toBe('\u001b[90ma\u001b[39m\r\n\u001b[90mb\u001b[39m');
    expect(ansi.red('a\u001b[39mb')).toBe('\u001b[31ma\u001b[39m\u001b[31mb\u001b[39m');
    expect(ansi.bold('a\u001b[39mb')).toBe('\u001b[1ma\u001b[39mb\u001b[22m');
  });

  it('returns plain text when NO_COLOR is non-empty, even with FORCE_COLOR set', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    expect(ansi.red('x')).toBe('x');
    expect(ansi.bold('a\nb')).toBe('a\nb');
  });

  it('treats an empty NO_COLOR as unset and honors FORCE_COLOR true and false', () => {
    process.env.NO_COLOR = '';
    process.env.FORCE_COLOR = 'true';
    expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');

    process.env.FORCE_COLOR = 'false';
    expect(ansi.red('x')).toBe('x');
  });

  it('honors FORCE_COLOR levels 0 through 3', () => {
    delete process.env.NO_COLOR;
    for (const force of ['1', '2', '3', 'true', '']) {
      process.env.FORCE_COLOR = force;
      expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
    }
    for (const force of ['0', 'false']) {
      process.env.FORCE_COLOR = force;
      expect(ansi.red('x')).toBe('x');
    }
  });

  it('falls back to TTY detection for non-numeric FORCE_COLOR', () => {
    delete process.env.NO_COLOR;
    for (const force of ['bogus', ' 1', '1 ', '\t1', '1,2,0', '0.5', '-1', ' ']) {
      process.env.FORCE_COLOR = force;
      withStdoutTTY(false, () => {
        expect(ansi.red('x')).toBe('x');
      });
      withStdoutTTY(true, () => {
        expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
      });
    }
  });

  it('matches chalk for FORCE_COLOR values above 3, which chalk clamps to level 3', () => {
    delete process.env.NO_COLOR;
    for (const force of ['4', '9', '999']) {
      process.env.FORCE_COLOR = force;
      expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
    }
  });

  it('matches chalk for zero-padded FORCE_COLOR, which chalk treats as numeric', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '01';
    expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
    process.env.FORCE_COLOR = '00';
    expect(ansi.red('x')).toBe('x');
  });

  it('disables color for any non-empty NO_COLOR value', () => {
    for (const value of ['1', '0', 'true', 'false', 'no', ' ']) {
      process.env.NO_COLOR = value;
      process.env.FORCE_COLOR = '3';
      expect(ansi.red('x')).toBe('x');
    }
  });

  it('keeps empty NO_COLOR neutral across FORCE_COLOR true, false, and levels', () => {
    process.env.NO_COLOR = '';
    process.env.FORCE_COLOR = '0';
    expect(ansi.red('x')).toBe('x');
    process.env.FORCE_COLOR = 'false';
    expect(ansi.red('x')).toBe('x');
    process.env.FORCE_COLOR = '2';
    expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
  });

  it('wraps nested styles the way chalk composes open and close sequences', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    expect(ansi.red(ansi.bold('x'))).toBe('\u001b[31m\u001b[1mx\u001b[22m\u001b[39m');
    expect(ansi.bold(ansi.red('x'))).toBe('\u001b[1m\u001b[31mx\u001b[39m\u001b[22m');
    expect(ansi.red(ansi.gray('x'))).toBe('\u001b[31m\u001b[90mx\u001b[39m\u001b[31m\u001b[39m');
    expect(ansi.red(ansi.bold(ansi.green('x')))).toBe('\u001b[31m\u001b[1m\u001b[32mx\u001b[39m\u001b[31m\u001b[22m\u001b[39m');
  });

  it('disables color for nested styles when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '3';
    expect(ansi.red(ansi.bold('x'))).toBe('x');
  });

  it('enables color with no FORCE_COLOR only when stdout is a TTY', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    withStdoutTTY(true, () => {
      expect(ansi.red('x')).toBe('\u001b[31mx\u001b[39m');
    });
    withStdoutTTY(false, () => {
      expect(ansi.red('x')).toBe('x');
    });
  });
});
