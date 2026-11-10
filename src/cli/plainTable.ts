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
 * it renders each cell on a single line and truncates with `…` when needed.
 */
export interface PlainTableOptions {
  head: string[];
  colWidths: number[];
  wordWrap?: boolean;
}

const TRUNCATE_CHAR = '…';
const GRAPHME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Grapheme clusters that count as one emoji column (width 2), per `string-width` 4. */
const EMOJI_GRAPHEME =
  /^(\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\p{Emoji_Modifier}|\uFE0F|\uFE0E|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}))*$/u;

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping SGR sequences is the point
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function isControlCodePoint(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

function isIgnoredCombining(cp: number): boolean {
  return cp >= 0x0300 && cp <= 0x036f;
}

function isZeroWidthCodePoint(cp: number): boolean {
  return cp === 0xfe0e || cp === 0xfe0f || cp === 0x200d;
}

/**
 * East Asian fullwidth width check (same ranges as `is-fullwidth-code-point` 3).
 */
function isFullwidthCodePoint(cp: number): boolean {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x3247 && cp !== 0x303f) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0xa4c6) ||
      (cp >= 0xa960 && cp <= 0xa97c) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6b) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1b000 && cp <= 0x1b001) ||
      (cp >= 0x1f200 && cp <= 0x1f251) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  );
}

/**
 * Display width of one grapheme cluster via `Intl.Segmenter`, aligned with
 * `string-width` 4 for CLI cells (emoji/ZWJ clusters, variation selectors, and
 * fullwidth code points).
 */
function graphemeWidth(grapheme: string): number {
  if (EMOJI_GRAPHEME.test(grapheme)) return 2;
  let width = 0;
  for (const char of grapheme) {
    const cp = char.codePointAt(0) ?? 0;
    if (isControlCodePoint(cp) || isZeroWidthCodePoint(cp) || isIgnoredCombining(cp)) continue;
    width += isFullwidthCodePoint(cp) ? 2 : 1;
  }
  return width;
}

function graphemesOf(value: string): string[] {
  return [...GRAPHME_SEGMENTER.segment(value)].map((part) => part.segment);
}

function visibleWidth(value: string): number {
  const plain = stripAnsi(value);
  let width = 0;
  for (const grapheme of graphemesOf(plain)) width += graphemeWidth(grapheme);
  return width;
}

function truncateToWidth(value: string, maxWidth: number): string {
  if (visibleWidth(value) <= maxWidth) return value;
  const ellipsisWidth = visibleWidth(TRUNCATE_CHAR);
  const target = Math.max(0, maxWidth - ellipsisWidth);
  let built = '';
  let width = 0;
  for (const grapheme of graphemesOf(value)) {
    const gw = graphemeWidth(grapheme);
    if (width + gw > target) break;
    built += grapheme;
    width += gw;
  }
  return built + TRUNCATE_CHAR;
}

function pad(value: string, width: number): string {
  const display = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  const gap = width - visibleWidth(display);
  return gap > 0 ? display + ' '.repeat(gap) : display;
}

function hardBreak(token: string, width: number): string[] {
  const parts: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const grapheme of graphemesOf(token)) {
    const w = graphemeWidth(grapheme);
    if (currentWidth + w > width && current.length > 0) {
      parts.push(current);
      current = grapheme;
      currentWidth = w;
    } else {
      current += grapheme;
      currentWidth += w;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : [''];
}

function wrapSegment(segment: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of segment.split(' ')) {
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
  return lines.length > 0 ? lines : [''];
}

function wrapCell(value: string, width: number, wordWrap: boolean): string[] {
  const plain = stripAnsi(value);
  const hasNewline = /\r\n|\n|\r/.test(plain);
  if (!hasNewline) {
    if (wordWrap && visibleWidth(plain) > width) return wrapSegment(plain, width);
    if (!wordWrap && visibleWidth(plain) > width) return [truncateToWidth(plain, width)];
    return [value];
  }

  const parts = plain.split(/\r\n|\n|\r/);
  return parts.flatMap((segment) => {
    if (wordWrap && visibleWidth(segment) > width) return wrapSegment(segment, width);
    if (!wordWrap && visibleWidth(segment) > width) return [truncateToWidth(segment, width)];
    return [segment];
  });
}

/**
 * A bordered ASCII table with a header row and any number of body rows.
 */
export class PlainTable {
  private readonly rows: string[][] = [];

  constructor(private readonly options: PlainTableOptions) {}

  /**
   * Append one body row. `null` and `undefined` render as empty cells.
   */
  push(cells: Array<string | null | undefined>): void {
    this.rows.push(cells.map((cell) => (cell == null ? '' : String(cell))));
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
      const wrapped = cells.map((cell, i) =>
        wrapCell(cell, contentWidth(widths[i] ?? 10), wordWrap));
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
