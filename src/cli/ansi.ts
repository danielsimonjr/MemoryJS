/**
 * ANSI colors for the CLI.
 *
 * In-repo replacement for `chalk`, covering only the six styles the CLI prints.
 * A non-empty `NO_COLOR` disables color and wins over `FORCE_COLOR`. Otherwise
 * `FORCE_COLOR=0`/`false` disables; `1`–`3`, any higher numeric (clamped), `true`,
 * and empty enable. With
 * neither variable set, color is enabled only when stdout is a TTY.
 *
 * @module cli/ansi
 */

const OPEN = {
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
} as const;

const CLOSE = {
  bold: '\u001b[22m',
  red: '\u001b[39m',
  green: '\u001b[39m',
  yellow: '\u001b[39m',
  cyan: '\u001b[39m',
  gray: '\u001b[39m',
} as const;

type Style = keyof typeof OPEN;

/**
 * Whether the environment asks for color.
 *
 * Mirrors the `NO_COLOR`, `FORCE_COLOR`, and TTY rules chalk 6 documents.
 */
function colorEnabled(): boolean {
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') return false;

  if (!Object.prototype.hasOwnProperty.call(process.env, 'FORCE_COLOR')) {
    return Boolean(process.stdout.isTTY);
  }

  const force = process.env.FORCE_COLOR ?? '';
  if (force === 'false' || force === '0') return false;
  if (force === '' || force === 'true') return true;

  // chalk 6's vendored supports-color: only pure digit strings count as numeric.
  if (/^\d+$/.test(force)) {
    const level = Math.min(Number.parseInt(force, 10), 3);
    if (level === 0) return false;
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

/**
 * Wrap `text` in one style's open and close sequences.
 *
 * Matches chalk for the inputs the CLI produces: empty text yields an empty
 * string, a close code already inside the text is reopened, and each line is
 * closed before its newline and reopened after it.
 */
function paint(style: Style, text: string): string {
  const value = String(text);
  if (value === '' || !colorEnabled()) return value;

  const open = OPEN[style];
  const close = CLOSE[style];

  let body = value;
  if (body.includes('\u001b')) body = body.split(close).join(close + open);
  if (body.includes('\n')) body = body.replace(/\r?\n/g, (newline) => close + newline + open);

  return open + body + close;
}

/**
 * The six CLI styles. Each returns styled text, or the plain text when color is
 * disabled.
 */
export const ansi = {
  bold: (text: string): string => paint('bold', text),
  red: (text: string): string => paint('red', text),
  green: (text: string): string => paint('green', text),
  yellow: (text: string): string => paint('yellow', text),
  cyan: (text: string): string => paint('cyan', text),
  gray: (text: string): string => paint('gray', text),
};
