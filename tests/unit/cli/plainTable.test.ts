/**
 * Tests for the in-repo CLI table renderer.
 *
 * `colWidths` keep cli-table3's meaning: each value is the full column width,
 * including one space of padding on each side, so the content width is
 * `max(1, colWidth - 2)`.
 *
 * @module tests/unit/cli/plainTable.test
 */

import { describe, expect, it } from 'vitest';
import { PlainTable } from '../../../src/cli/plainTable.js';

describe('PlainTable', () => {
  it('renders a border, a header, and a row', () => {
    const table = new PlainTable({
      head: ['A', 'B'],
      colWidths: [5, 5],
    });
    table.push(['1', '2']);
    const text = table.toString();
    expect(text).toContain('| A');
    expect(text).toContain('| 1');
    expect(text.split('\n')[0].startsWith('+')).toBe(true);
  });

  it('renders the exact border and padded cells for colWidths [6]', () => {
    const table = new PlainTable({ head: ['H'], colWidths: [6] });
    table.push(['ab']);
    expect(table.toString()).toBe(['+------+', '| H    |', '+------+', '| ab   |', '+------+'].join('\n'));
  });

  it('counts each column as its full colWidth, padding inside the pipes', () => {
    const table = new PlainTable({ head: ['A', 'BB'], colWidths: [4, 7] });
    table.push(['1', '2']);
    const lines = table.toString().split('\n');
    expect(lines[0]).toBe('+----+-------+');
    expect(lines[1]).toBe('| A  | BB    |');
    expect(lines[3]).toBe('| 1  | 2     |');
  });

  it('wraps on whitespace when wordWrap is true and ignores ANSI in the width', () => {
    const table = new PlainTable({
      head: ['\u001b[36mH\u001b[39m'],
      colWidths: [6],
      wordWrap: true,
    });
    table.push(['one two']);
    const text = table.toString();
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text.split('\n')[0]).toBe('+------+');
  });

  it('gives a colored header the same border as an uncolored one', () => {
    const plain = new PlainTable({ head: ['Name'], colWidths: [10] });
    const colored = new PlainTable({ head: ['\u001b[36mName\u001b[39m'], colWidths: [10] });
    expect(colored.toString().split('\n')[0]).toBe(plain.toString().split('\n')[0]);
    expect(colored.toString()).toContain('\u001b[36mName\u001b[39m');
  });

  it('counts a fullwidth character as two columns and hard-breaks a long token', () => {
    const table = new PlainTable({
      head: ['H'],
      colWidths: [6],
      wordWrap: true,
    });
    table.push(['你ab']);
    const text = table.toString();
    expect(text.split('\n')[3]).toBe('| 你ab |');
  });

  it('hard-breaks a single token wider than the content width', () => {
    const table = new PlainTable({
      head: ['H'],
      colWidths: [6],
      wordWrap: true,
    });
    table.push(['你abcd']);
    const lines = table.toString().split('\n');
    expect(lines[3]).toBe('| 你ab |');
    expect(lines[4]).toBe('| cd   |');
  });

  it('does not wrap when wordWrap is omitted', () => {
    const table = new PlainTable({ head: ['H'], colWidths: [6] });
    table.push(['one two']);
    const lines = table.toString().split('\n');
    expect(lines.length).toBe(5);
    expect(lines[3]).toBe('| one two |');
  });

  it('pads short cells to the column width and handles extra columns', () => {
    const table = new PlainTable({ head: ['A', 'B', 'C'], colWidths: [4, 5, 6] });
    table.push(['x', '', 'zz']);
    const lines = table.toString().split('\n');
    expect(lines[3]).toBe('| x  |     | zz   |');
  });

  it('wraps multiple cells to the tallest cell height', () => {
    const table = new PlainTable({ head: ['A', 'B'], colWidths: [6, 6], wordWrap: true });
    table.push(['one two three', 'x']);
    const lines = table.toString().split('\n');
    expect(lines[3]).toBe('| one  | x    |');
    expect(lines[4]).toBe('| two  |      |');
    expect(lines[5]).toBe('| thre |      |');
    expect(lines[6]).toBe('| e    |      |');
  });
});
