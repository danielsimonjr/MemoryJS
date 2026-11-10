/**
 * Renders the bordered text tables the CLI formatters print.
 *
 * In-repo replacement for the `cli-table3` subset MemoryJS used: `head`,
 * `colWidths`, `wordWrap`, `push`, and `toString`. `colWidths` keep
 * cli-table3's meaning — each value is the full column width including one
 * space of padding on each side — so the content width is
 * `max(1, colWidth - 2)`.
 *
 * @module cli/plainTable
 */

/**
 * Options for {@link PlainTable}.
 *
 * `wordWrap` wraps on whitespace and hard-breaks an over-long token. Omitting
 * it renders each cell on a single line.
 */
export interface PlainTableOptions {
  head: string[];
  colWidths: number[];
  wordWrap?: boolean;
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping SGR sequences is the point
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Display width of one code point, matching the `string-width` 4 rules the CLI
 * relied on: fullwidth code points and emoji are 2, combining marks are 0, and
 * everything else is 1.
 */
function charWidth(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  if (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff))
  ) {
    return 2;
  }
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  return 1;
}

function visibleWidth(value: string): number {
  const plain = stripAnsi(value);
  let width = 0;
  for (const char of plain) width += charWidth(char);
  return width;
}

function pad(value: string, width: number): string {
  const gap = width - visibleWidth(value);
  return gap > 0 ? value + ' '.repeat(gap) : value;
}

function hardBreak(token: string, width: number): string[] {
  const parts: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const char of token) {
    const w = charWidth(char);
    if (currentWidth + w > width && current.length > 0) {
      parts.push(current);
      current = char;
      currentWidth = w;
    } else {
      current += char;
      currentWidth += w;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : [''];
}

function wrap(value: string, width: number, wordWrap: boolean): string[] {
  const plain = stripAnsi(value);
  if (!wordWrap || visibleWidth(plain) <= width) return [value];
  const lines: string[] = [];
  let current = '';
  for (const word of plain.split(' ')) {
    for (const piece of hardBreak(word, width)) {
      const next = current.length === 0 ? piece : `${current} ${piece}`;
      if (visibleWidth(next) > width && current.length > 0) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * A bordered ASCII table with a header row and any number of body rows.
 */
export class PlainTable {
  private readonly rows: string[][] = [];

  constructor(private readonly options: PlainTableOptions) {}

  /**
   * Append one body row. Cells are stringified.
   */
  push(cells: string[]): void {
    this.rows.push(cells.map((cell) => String(cell)));
  }

  /**
   * Render the table as text: a top border, the header, a header rule, each
   * body row (wrapped to its tallest cell), and a bottom border.
   */
  toString(): string {
    const widths = this.options.colWidths;
    const wordWrap = this.options.wordWrap === true;
    const contentWidth = (colWidth: number) => Math.max(1, colWidth - 2);
    const border = `+${widths.map((w) => '-'.repeat(Math.max(1, w))).join('+')}+`;
    const render = (cells: string[]): string[] => {
      const wrapped = cells.map((cell, i) => wrap(cell, contentWidth(widths[i] ?? 10), wordWrap));
      const height = Math.max(1, ...wrapped.map((lines) => lines.length));
      const out: string[] = [];
      for (let line = 0; line < height; line++) {
        const cols = widths.map((width, i) =>
          pad(wrapped[i]?.[line] ?? '', contentWidth(width)));
        out.push(`| ${cols.join(' | ')} |`);
      }
      return out;
    };
    const lines = [
      border,
      ...render(this.options.head),
      border,
      ...this.rows.flatMap((row) => render(row)),
      ...(this.rows.length > 0 ? [border] : []),
    ];
    return lines.join('\n');
  }
}
