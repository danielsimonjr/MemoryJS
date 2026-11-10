import { describe, expect, it } from 'vitest';
import { PlainTable } from '../../../src/cli/plainTable.js';

/**
 * Challenger tests for the Sprint 3 PlainTable replacement (PR #299).
 *
 * Failing tests pin real defects found by differential testing against
 * cli-table3 0.6.5 on master. Passing tests pin edge cases the builder
 * already handles so a future refactor cannot regress them.
 */

const borderLines = (text: string): string[] =>
  text.split('\n').filter((line) => line.startsWith('+'));

describe('PlainTable challenger findings', () => {
  describe('F1: overflow without wordWrap breaks the border (relations/centrality sites)', () => {
    it('keeps every rendered row aligned with the border when wordWrap is off', () => {
      const table = new PlainTable({
        head: ['From', 'Relation', 'To'],
        colWidths: [20, 15, 20],
      });
      table.push(['a'.repeat(40), 'knows', 'b']);
      const text = table.toString();
      const widths = new Set(borderLines(text).map((line) => line.length));
      for (const line of text.split('\n')) {
        expect(line.length, `row line "${line}" vs border widths ${[...widths]}`).toBe(
          borderLines(text)[0]?.length
        );
      }
      expect(widths.size).toBe(1);
    });

    it('truncates or wraps over-long cells instead of emitting them raw', () => {
      const table = new PlainTable({
        head: ['From', 'Relation', 'To'],
        colWidths: [20, 15, 20],
      });
      table.push(['a'.repeat(40), 'knows', 'b']);
      const text = table.toString();
      for (const line of text.split('\n')) {
        if (!line.startsWith('|')) continue;
        expect(line.length).toBeLessThanOrEqual(borderLines(text)[0].length);
      }
      expect(text).not.toContain('a'.repeat(40));
      expect(text).toContain('| aaaaaaaaaaaaaaaaa… | knows         | b                  |');
    });
  });

  describe('F2: embedded newline in a cell breaks the table grid', () => {
    it('renders a two-line cell as two padded grid rows (wordWrap off)', () => {
      const table = new PlainTable({ head: ['A'], colWidths: [10] });
      table.push(['line1\nline2']);
      const text = table.toString();
      expect(text).toContain('| line1');
      expect(text).toContain('| line2');
      expect(text).not.toContain('line1\nline2 |');
      for (const line of text.split('\n')) {
        if (line.length > 0) {
          expect(line.startsWith('|') || line.startsWith('+')).toBe(true);
        }
      }
    });

    it('renders a two-line cell as two padded grid rows (wordWrap on)', () => {
      const table = new PlainTable({ head: ['A'], colWidths: [10], wordWrap: true });
      table.push(['line1\nline2']);
      const text = table.toString();
      expect(text).toContain('| line1');
      expect(text).toContain('| line2');
      expect(text).not.toMatch(/line1\nli/);
    });

    it('handles CRLF inside a cell without emitting a bare CR', () => {
      const table = new PlainTable({ head: ['A'], colWidths: [12], wordWrap: true });
      table.push(['a\r\nb']);
      const text = table.toString();
      expect(text).toContain('| a');
      expect(text).toContain('| b');
      expect(text).not.toContain('\r');
    });
  });

  describe('F3: width rules claimed in the JSDoc do not match string-width 4', () => {
    it('counts other emoji as width 2 (rocket)', () => {
      const table = new PlainTable({ head: ['E'], colWidths: [8] });
      table.push(['\u{1F680}']);
      const row = table.toString().split('\n').at(-2) as string;
      expect(row).toBe('| \u{1F680}     |');
    });

    it('counts the pile-of-poo emoji as width 2', () => {
      const table = new PlainTable({ head: ['E'], colWidths: [8] });
      table.push(['\u{1F4A9}']);
      const row = table.toString().split('\n').at(-2) as string;
      expect(row).toBe('| \u{1F4A9}     |');
    });

    it('counts a ZWJ emoji sequence as width 2, not one per code point', () => {
      const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
      const table = new PlainTable({ head: ['E'], colWidths: [12] });
      table.push([family]);
      const row = table.toString().split('\n').at(-2) as string;
      expect(row).toBe(`| ${family}         |`);
    });

    it('ignores variation selector-16 in the width', () => {
      const table = new PlainTable({ head: ['V'], colWidths: [10] });
      table.push(['\u2764\uFE0F']);
      const row = table.toString().split('\n').at(-2) as string;
      expect(row).toBe('| \u2764\uFE0F       |');
    });

    it('counts combining marks outside U+0300-U+036F as string-width does (U+0483)', () => {
      const table = new PlainTable({ head: ['M'], colWidths: [10] });
      table.push(['e\u0483']);
      const row = table.toString().split('\n').at(-2) as string;
      // string-width 4 only ignores combining marks in U+0300–U+036F, so
      // U+0483 (COMBINING CYRILLIC TITLO) counts as width 1 and the cell is 2.
      expect(row).toBe('| e\u0483       |');
    });
  });

  describe('F4: non-string cells leak their JS rendering into the table', () => {
    it('renders null and undefined cells as empty cells, overflowing neither', () => {
      const table = new PlainTable({ head: ['A', 'B'], colWidths: [8, 8] });
      table.push(['5', null as unknown as string]);
      const text = table.toString();
      expect(text).not.toContain('null');
      expect(text).not.toContain('undefined');
      for (const line of text.split('\n')) {
        if (line.startsWith('|')) {
          expect(line.length).toBe(borderLines(text)[0].length);
        }
      }
    });
  });

  describe('F5: head-only table drops the bottom border', () => {
    it('closes a head-only table with the header rule (cli-table3 has no extra bottom)', () => {
      const table = new PlainTable({ head: ['A', 'B'], colWidths: [6, 6] });
      expect(table.toString()).toBe(['+------+------+', '| A    | B    |', '+------+------+'].join('\n'));
    });
  });

  describe('Pinned passing edge cases', () => {
    it('keeps the border width identical for colored and uncolored headers', () => {
      const colored = new PlainTable({ head: ['\u001b[36mH\u001b[39m'], colWidths: [6] });
      const plain = new PlainTable({ head: ['H'], colWidths: [6] });
      expect(borderLines(colored.toString())).toEqual(borderLines(plain.toString()));
    });

    it('hard-breaks a single token wider than the content width', () => {
      const table = new PlainTable({ head: ['H'], colWidths: [8], wordWrap: true });
      table.push(['abcdefghijklm']);
      const text = table.toString();
      expect(text).toContain('| abcdef |');
      expect(text).toContain('| ghijkl |');
      expect(text).toContain('| m      |');
    });

    it('hard-breaks a fullwidth token on width, not on code point count', () => {
      const table = new PlainTable({ head: ['H'], colWidths: [8], wordWrap: true });
      table.push(['你abcd你']);
      const lines = table.toString().split('\n');
      expect(lines).toContain('| 你abcd |');
      expect(lines).toContain('| 你     |');
    });

    it('ignores ANSI codes when measuring width', () => {
      const table = new PlainTable({ head: ['A'], colWidths: [10], wordWrap: true });
      table.push(['\u001b[36mone two three\u001b[39m']);
      const text = table.toString();
      expect(text).toContain('one');
      expect(text).toContain('three');
      for (const line of text.split('\n')) {
        if (line.startsWith('|')) {
          expect(line.length).toBe(borderLines(text)[0].length);
        }
      }
    });

    it('renders empty cells as padding, not overflow', () => {
      const table = new PlainTable({ head: ['A', 'B'], colWidths: [6, 6] });
      table.push(['', '']);
      expect(table.toString()).toContain('|      |      |');
    });

    it('pads short cells to the full content width', () => {
      const table = new PlainTable({ head: ['A', 'B'], colWidths: [5, 5] });
      table.push(['1', '2']);
      expect(table.toString()).toContain('| 1   | 2   |');
    });

    it('counts a fullwidth character as two columns', () => {
      const table = new PlainTable({ head: ['H'], colWidths: [6], wordWrap: true });
      table.push(['你ab']);
      expect(table.toString().split('\n')[3]).toBe('| 你ab |');
    });
  });
});
