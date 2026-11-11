/**
 * Tests for the Agent Memory Repo (AMR) codec: metadata, escape, links and the line model.
 *
 * Contract (the implementation must follow it exactly):
 *
 * Shared rules.
 * - Line separators are `[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]`.
 * - A key matches `^[A-Za-z][\w-]*$` and is not an `Object.prototype` property name.
 * - A value is not empty, has no edge whitespace, and holds no `[`, `]`, line separator or `;\s`.
 * - The reader and the writer use these same rules, so every parsed meta can be written back.
 *
 * Metadata grammar.
 * - A group is `[` ... `]` at the end of the entry text (after trailing spaces, tabs and CRs).
 *   Groups are read right to left while they are consecutive (separated only by that whitespace).
 * - Only an UNESCAPED `[` can open a group, and `[[` never opens a group.
 * - Split the group body at every `;` followed by one or more spaces (`;\s+`).
 * - Every segment must match `^[A-Za-z][\w-]*:\s+\S` (`key: value`, with whitespace after the
 *   colon). The key is before the first `:`, the value is the rest, trimmed. Key and value must
 *   pass the shared rules. If any segment fails, the whole group is text: stop reading groups and
 *   add one warning, but only when a segment starts with `key:` and whitespace (so `[TODO]`,
 *   `[x]`, `[ ]` and `[https://example.com/doc]` give none).
 * - `meta` is `Record<string, string[]>`; repeats keep document order (left to right).
 *
 * Escape.
 * - formatEntryText escapes only a `[` that can change the reading: the last `[` of a text that
 *   ends in `]` (unless a `[` comes directly before it), and the `[` of a leading `[ ] ` or `[x] `.
 *   A backslash run directly before any `[` is doubled. Every other backslash is written as is
 *   (so `C:\Users\x` does not change).
 * - It writes metadata as ONE trailing group, ` [k: v; k: v]` (no leading space for empty text),
 *   keys in insertion order, repeats as repeated pairs. It throws on a line separator or edge
 *   whitespace in text, and on a key or value that fails the shared rules.
 * - parseEntryText decodes a backslash run of m directly before `[`: odd m gives (m - 1) / 2
 *   backslashes and a literal `[`; even m gives m / 2 backslashes and the `[` stays. Every other
 *   backslash stays as is.
 *
 * Line model.
 * - `doc.lines` holds ONE entry per physical line, front matter lines included, so line indexes
 *   match the file. Each line stores its own terminator (`eolAfter`), so a mixed-EOL file renders
 *   byte for byte. `doc.eol` is the first EOL seen (default `\n`), used only for new lines.
 * - Kinds: frontmatter (both `---` lines and the body), heading, bullet, continuation, fence (both
 *   fence lines and every line between), blank, prose.
 * - Front matter opens on line 1 with `---` and closes at the next `---`. Trailing spaces are
 *   allowed on both lines. Unclosed front matter sets `parseable: false` and adds a warning.
 * - A fence opens with three or more backticks (and no backtick later on the line) or tildes.
 * - A bullet is `^(\s*)([-*+]|\d+[.)])(\s+)(.*)$` with the `s` flag, outside fences and front
 *   matter. A task prefix `[ ] ` or `[x] ` sets `entry.task` and is removed from the text.
 *   `indent` = number of leading whitespace characters.
 * - A continuation is a non-blank, non-bullet line indented deeper than its bullet, directly after
 *   the bullet or another continuation. The entry text joins the non-empty bullet and continuation
 *   contents with one space before metadata is parsed.
 * - An unterminated fence sets `parseable: false` and adds a warning.
 * - setEntry(doc, i, text, meta) returns a NEW doc, parsed again from the new text. It keeps the
 *   indent characters, marker, whitespace after the marker and task prefix of line i, writes
 *   formatEntryText, and removes the continuation lines of that entry. It throws when line i is
 *   not a bullet or the doc is not parseable.
 */
import { describe, it, expect } from 'vitest';
import {
  parseEntryText,
  formatEntryText,
  extractLinks,
  parseAmrDocument,
  renderAmrDocument,
  setEntry,
} from '../../../../src/features/amr/AmrCodec.js';
import { ValidationError } from '../../../../src/utils/errors.js';

const NBSP = '\u00a0';
const LS = '\u2028';
const PS = '\u2029';

/** Seeded 32-bit generator with a full 2^32 cycle. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseEntryText (metadata)', () => {
  it('reads one trailing group with two keys', () => {
    const r = parseEntryText(
      'Payments and website share a deadline [source: https://example.com/sessions/102; added: 2026-09-03]'
    );
    expect(r.text).toBe('Payments and website share a deadline');
    expect(r.meta).toEqual({ source: ['https://example.com/sessions/102'], added: ['2026-09-03'] });
  });

  it('keeps every repeated group of the spec README example, in order', () => {
    const r = parseEntryText(
      'Cause: the pool of 20 runs out [source: https://example.com/sessions/301] [source: https://example.com/sessions/302] [source: https://example.com/sessions/304]'
    );
    expect(r.text).toBe('Cause: the pool of 20 runs out');
    expect(r.meta.source).toEqual([
      'https://example.com/sessions/301',
      'https://example.com/sessions/302',
      'https://example.com/sessions/304',
    ]);
  });

  it('does not split a URL value at a semicolon without a following key', () => {
    const r = parseEntryText('Login flow [source: https://x.test/a;jsessionid=9]');
    expect(r.meta).toEqual({ source: ['https://x.test/a;jsessionid=9'] });
    expect(r.text).toBe('Login flow');
  });

  it.each(['Remember [TODO]', 'Done [x]', 'Open [ ]', 'See [[team_structure]]'])(
    'keeps %s as text with no metadata and no warning',
    (input) => {
      const r = parseEntryText(input);
      expect(r.text).toBe(input);
      expect(r.meta).toEqual({});
      expect(r.warnings).toEqual([]);
    }
  );

  it('keeps a malformed metadata-like group as text and warns', () => {
    const r = parseEntryText('Odd [source: a; : b]');
    expect(r.text).toBe('Odd [source: a; : b]');
    expect(r.meta).toEqual({});
    expect(r.warnings.length).toBe(1);
  });

  it('splits key from value at the first colon only', () => {
    const r = parseEntryText('Time [at: 12:30:00]');
    expect(r.meta).toEqual({ at: ['12:30:00'] });
  });

  it('never reads an escaped bracket as a group start', () => {
    const r = parseEntryText('Deploy flag syntax is \\[env: prod]');
    expect(r.text).toBe('Deploy flag syntax is [env: prod]');
    expect(r.meta).toEqual({});
  });
});

describe('formatEntryText (escape)', () => {
  it('escapes text that looks like metadata so it reads back as text', () => {
    const line = formatEntryText('Deploy flag syntax is [env: prod]', {});
    expect(parseEntryText(line)).toMatchObject({ text: 'Deploy flag syntax is [env: prod]', meta: {} });
  });

  it('keeps [[links]] unescaped', () => {
    expect(formatEntryText('Priya owns pricing; see [[team_structure]]', {})).toBe(
      'Priya owns pricing; see [[team_structure]]'
    );
  });

  it('writes metadata as one trailing group per key order and repeats', () => {
    expect(formatEntryText('Fact', { source: ['u1', 'u2'], added: ['2026-09-03'] })).toBe(
      'Fact [source: u1; source: u2; added: 2026-09-03]'
    );
  });

  it('rejects a newline in text', () => {
    expect(() => formatEntryText('a\nb', {})).toThrow();
  });

  it.each([
    [{ 'bad key': ['v'] }],
    [{ k: ['has ] bracket'] }],
    [{ k: ['has; next: x'] }],
    [{ k: ['line\nbreak'] }],
    [{ k: [''] }],
  ])('rejects invalid metadata %j', (meta) => {
    expect(() => formatEntryText('Fact', meta as Record<string, string[]>)).toThrow();
  });

  it.each([['a\\'], ['\\[k: a]'], ['[[k: a]'], ['x]'], ['C:\\Users\\x'], ['[[a]] and [b: c]']])(
    'round-trips the hard case %j with and without metadata',
    (text) => {
      for (const meta of [{}, { source: ['u'] }]) {
        const back = parseEntryText(formatEntryText(text, meta));
        expect({ text: back.text, meta: back.meta }).toEqual({ text, meta });
      }
    }
  );

  it.each([
    ['C:\\Users\\x', 'C:\\Users\\x'],
    ['\\\\server\\data', '\\\\server\\data'],
    ['use `arr[0]` here', 'use `arr[0]` here'],
    ['[x] foo', '\\[x] foo'],
    ['[ ] foo', '\\[ ] foo'],
    ['x [y]', 'x \\[y]'],
    ['[[a]]', '[[a]]'],
    ['a\\[b]', 'a\\\\\\[b]'],
  ])('escapes only the brackets that change the reading: %j', (text, written) => {
    expect(formatEntryText(text, {})).toBe(written);
    expect(parseEntryText(written).text).toBe(text);
  });

  it('reads human backslashes literally', () => {
    expect(parseEntryText('share \\\\server\\data').text).toBe('share \\\\server\\data');
    expect(parseEntryText('regex \\\\d+').text).toBe('regex \\\\d+');
  });

  it.each([['trailing '], [' leading'], ['tab\t'], [NBSP + 'x']])(
    'rejects text with edge whitespace %j',
    (text) => {
      expect(() => formatEntryText(text, {})).toThrow(ValidationError);
    }
  );

  it.each([['a\rb'], ['a' + LS + 'b'], ['a' + PS + 'b'], ['a\vb'], ['a\fb'], ['a\x85b'], ['a\x1cb']])(
    'rejects a line separator in text %j',
    (text) => {
      expect(() => formatEntryText(text, {})).toThrow(ValidationError);
      expect(() => formatEntryText('ok', { k: [text] })).toThrow(ValidationError);
    }
  );

  it('writes no leading space when the text is empty', () => {
    expect(formatEntryText('', { k: ['v'] })).toBe('[k: v]');
    expect(parseEntryText('[k: v]')).toMatchObject({ text: '', meta: { k: ['v'] } });
  });

  it.each([['constructor'], ['toString'], ['hasOwnProperty'], ['valueOf']])(
    'rejects the Object.prototype key %s on write and keeps it as text on read',
    (key) => {
      expect(() => formatEntryText('x', { [key]: ['v'] })).toThrow(ValidationError);
      const r = parseEntryText(`x [${key}: v]`);
      expect(r.text).toBe(`x [${key}: v]`);
      expect(r.meta).toEqual({});
    }
  );

  it('round-trips random text and metadata (mulberry32, seeded)', () => {
    // The generator avoids edge whitespace by construction: the first and the last character
    // come from `edge`, which has no whitespace. Whitespace appears only inside the string.
    const rand = mulberry32(20261111);
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
    const edge = ['[', ']', '[[', ']]', ':', ';', '\\', '\\\\', 'a', 'k', '|', '#', '`', '-', '1', '.', '*', 'é'];
    const inner = [...edge, ' ', '; ', '\t', NBSP];
    const valueEdge = ['a', 'k', ':', ';', '/', '.', '-', '=', 'é', '(', ')', ',', '#', '|', '`', '\\'];
    const keys = ['source', 'added', 'K-1', 'k', 'x_y'];
    const gen = (n: number, e: readonly string[], i: readonly string[]): string => {
      if (n === 0) return '';
      let s = pick(e);
      for (let j = 1; j < n - 1; j++) s += pick(i);
      return n > 1 ? s + pick(e) : s;
    };
    const genValue = (): string => {
      const n = 1 + Math.floor(rand() * 8);
      let s = pick(valueEdge);
      for (let j = 1; j < n - 1; j++) s += s.endsWith(';') ? pick(valueEdge) : pick([...valueEdge, ' ', '\t']);
      return n > 1 ? s + pick(valueEdge) : s;
    };
    for (let i = 0; i < 20000; i++) {
      const text = gen(Math.floor(rand() * 14), edge, inner);
      const meta: Record<string, string[]> = {};
      for (let k = Math.floor(rand() * 3); k > 0; k--) {
        const key = pick(keys);
        (meta[key] ??= []).push(genValue());
      }
      const line = formatEntryText(text, meta);
      const back = parseEntryText(line);
      const label = JSON.stringify({ text, meta, line });
      expect(back.text, label).toBe(text);
      expect(Object.entries(back.meta), label).toEqual(Object.entries(meta));
      const doc = parseAmrDocument(renderAmrDocument(setEntry(parseAmrDocument('- x\n'), 0, text, meta)));
      expect(doc.lines[0].kind, label).toBe('bullet');
      expect(doc.lines[0].entry!.text, label).toBe(text);
      expect(Object.entries(doc.lines[0].entry!.meta), label).toEqual(Object.entries(meta));
    }
  });

  it('can write back every metadata it reads (reverse property, mulberry32)', () => {
    // A parsed text with edge whitespace or a line separator is readable but not writable by
    // design; the importer normalizes and reports it. Such cases are counted and skipped.
    const rand = mulberry32(777);
    const alphabet = ['[', ']', '[[', ']]', ':', ': ', ';', '; ', 'k', 'a', ' ', '\\', '\\\\', 'k: v', '[k: v]', '|', '#', '`', '\t', '\r', LS, NBSP];
    let written = 0;
    for (let i = 0; i < 30000; i++) {
      let raw = '';
      for (let n = Math.floor(rand() * 12); n > 0; n--) raw += alphabet[Math.floor(rand() * alphabet.length)];
      const r = parseEntryText(raw);
      if (Object.keys(r.meta).length === 0) continue;
      if (r.text !== r.text.trim() || /[\r\n\v\f\x1c-\x1e\x85]/.test(r.text) || r.text.includes(LS)) continue;
      const label = JSON.stringify({ raw, text: r.text, meta: r.meta });
      let line = '';
      expect(() => (line = formatEntryText(r.text, r.meta)), label).not.toThrow();
      const back = parseEntryText(line);
      expect(back.text, label).toBe(r.text);
      expect(Object.entries(back.meta), label).toEqual(Object.entries(r.meta));
      written++;
    }
    expect(written).toBeGreaterThan(500);
  });
});

describe('parseEntryText (value rules and edge cases)', () => {
  it.each([['See [https://example.com/doc]'], ['[mailto:a@b]'], ['Q3:done'], ['Ref [Q3:done]']])(
    'keeps %s as text with no warning (a colon needs whitespace after it)',
    (input) => {
      const r = parseEntryText(input);
      expect(r).toEqual({ text: input, meta: {}, warnings: [] });
    }
  );

  it('keeps a group whose value holds a bracket as text, with one warning', () => {
    const r = parseEntryText('a [k: v]]');
    expect(r.text).toBe('a [k: v]]');
    expect(r.meta).toEqual({});
    expect(r.warnings.length).toBe(1);
  });

  it('keeps a group whose value holds a line separator as text', () => {
    const r = parseEntryText('a [k: v' + LS + 'w]');
    expect(r.meta).toEqual({});
  });

  it.each([['\t'], ['\r'], [' \t ']])('reads metadata before trailing %j', (tail) => {
    expect(parseEntryText('x [k: v]' + tail)).toEqual({ text: 'x', meta: { k: ['v'] }, warnings: [] });
  });

  it('reads a 100k-space line in linear time', () => {
    const t = performance.now();
    expect(parseEntryText('a' + ' '.repeat(100000) + 'b').text.length).toBe(100002);
    parseAmrDocument('- a' + ' '.repeat(100000) + 'b\n');
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('reads 14 285 space-separated groups in linear time', () => {
    const t = performance.now();
    const r = parseEntryText('x ' + '[a: b] '.repeat(14285));
    expect(r.meta.a.length).toBe(14285);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('extractLinks', () => {
  it('normalises alias, heading and spaces, and skips code spans', () => {
    expect(
      extractLinks('see [[a|alias]], [[b#h]], [[ c ]], [[metrics/x.sql]] and `[[not]]`')
    ).toEqual(['a', 'b', 'c', 'metrics/x.sql']);
  });

  it('returns nothing for an empty link', () => {
    expect(extractLinks('[[ ]] and [[]]')).toEqual([]);
  });
});

describe('parseAmrDocument / renderAmrDocument', () => {
  const sample = [
    '---',
    'name: Team Structure',
    'tags: [team]',
    '---',
    '# Team',
    '',
    'Some prose that a human wrote.',
    '',
    '- Priya owns pricing; see [[pricing]] [added: 2026-09-03]',
    '* Star marker entry',
    '+ Plus marker entry',
    '1. Numbered entry',
    '- [ ] Open task',
    '- Human wrapped entry',
    '  that continues here [source: https://e.test/1]',
    '  - Nested child',
    '```sh',
    '- not an entry',
    '* not a star entry',
    '+ not a plus entry',
    '1. not a numbered entry',
    '```',
    '',
  ];

  it('classifies lines and reads entries', () => {
    const doc = parseAmrDocument(sample.join('\n'));
    expect(doc.frontMatter).toBe('name: Team Structure\ntags: [team]');
    expect(doc.parseable).toBe(true);
    const entries = doc.lines.filter((l) => l.kind === 'bullet').map((l) => l.entry!.text);
    expect(entries).toEqual([
      'Priya owns pricing; see [[pricing]]',
      'Star marker entry',
      'Plus marker entry',
      'Numbered entry',
      'Open task',
      'Human wrapped entry that continues here',
      'Nested child',
    ]);
    const wrapped = doc.lines.find((l) => l.entry?.text.startsWith('Human'))!;
    expect(wrapped.entry!.meta).toEqual({ source: ['https://e.test/1'] });
    const first = doc.lines.find((l) => l.kind === 'bullet')!;
    expect(first.entry!.links).toEqual(['pricing']);
    expect(doc.lines.find((l) => l.entry?.text === 'Open task')!.entry!.task).toBe(' ');
    expect(doc.lines.find((l) => l.entry?.text === 'Nested child')!.indent).toBe(2);
    expect(doc.lines.filter((l) => l.kind === 'fence').length).toBe(6);
  });

  it.each([
    ['LF', sample.join('\n')],
    ['CRLF', sample.join('\r\n')],
    ['BOM + CRLF', '\uFEFF' + sample.join('\r\n')],
    ['no final newline', sample.slice(0, -1).join('\n')],
  ])('renders an unedited %s file byte for byte', (_label, text) => {
    expect(renderAmrDocument(parseAmrDocument(text))).toBe(text);
  });

  it('renders a mixed-EOL file byte for byte', () => {
    const text = '# A\r\n- one\n- two\r\nprose';
    const doc = parseAmrDocument(text);
    expect(doc.eol).toBe('\r\n');
    expect(renderAmrDocument(doc)).toBe(text);
  });

  it('keeps one line per physical line, front matter included', () => {
    // A final terminator ends the last line; it does not start an extra empty line.
    const body = sample.slice(0, -1);
    expect(parseAmrDocument(body.join('\n')).lines.length).toBe(body.length);
    expect(parseAmrDocument(body.join('\n') + '\n').lines.length).toBe(body.length);
  });

  it('reads headings and front matter after a BOM', () => {
    const doc = parseAmrDocument('\uFEFF---\r\na: 1\r\n---\r\n# Memory\r\n');
    expect(doc.bom).toBe(true);
    expect(doc.eol).toBe('\r\n');
    expect(doc.frontMatter).toBe('a: 1');
    expect(doc.lines.some((l) => l.kind === 'heading' && l.raw === '# Memory')).toBe(true);
  });

  it('marks a file with an unterminated fence as not parseable', () => {
    const doc = parseAmrDocument('- a\n```\n- b\n');
    expect(doc.parseable).toBe(false);
    expect(doc.warnings.length).toBeGreaterThan(0);
  });

  it('an edited bullet changes exactly one line', () => {
    const text = sample.join('\n');
    const doc = parseAmrDocument(text);
    const idx = doc.lines.findIndex((l) => l.entry?.text === 'Star marker entry');
    const out = renderAmrDocument(setEntry(doc, idx, 'Star marker changed', { added: ['2026-11-11'] }));
    const a = text.split('\n');
    const b = out.split('\n');
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([idx]);
    expect(b[idx]).toBe('* Star marker changed [added: 2026-11-11]');
  });

  it('editing a wrapped entry drops its continuation lines and keeps the rest', () => {
    const doc = parseAmrDocument(sample.join('\n'));
    const idx = doc.lines.findIndex((l) => l.entry?.text.startsWith('Human'));
    const out = renderAmrDocument(setEntry(doc, idx, 'One line now', {})).split('\n');
    expect(out).toContain('- One line now');
    expect(out).not.toContain('  that continues here [source: https://e.test/1]');
    expect(out).toContain('  - Nested child');
  });

  it('setEntry refuses a line that is not a bullet', () => {
    const doc = parseAmrDocument(sample.join('\n'));
    expect(() => setEntry(doc, 4, 'x', {})).toThrow();
  });
});

describe('parseAmrDocument / setEntry edge cases', () => {
  it('reads a bullet that holds U+2028, and a bullet that holds a lone CR', () => {
    const a = parseAmrDocument('- a' + LS + 'b\n');
    expect(a.lines[0].kind).toBe('bullet');
    expect(a.lines[0].entry!.text).toBe('a' + LS + 'b');
    const b = parseAmrDocument('- a\rb\n- c\r');
    expect(b.lines.map((l) => l.kind)).toEqual(['bullet', 'bullet']);
    expect(b.lines[0].entry!.text).toBe('a\rb');
    expect(renderAmrDocument(b)).toBe('- a\rb\n- c\r');
  });

  it('setEntry refuses a text with U+2028', () => {
    expect(() => setEntry(parseAmrDocument('- a\n'), 0, 'z' + LS + 'y', {})).toThrow(ValidationError);
  });

  it.each([
    ['\t- tabbed\n', '\t- x\n'],
    [NBSP + '- nbsp\n', NBSP + '- x\n'],
    ['-\tfoo\n', '-\tx\n'],
    ['  -   wide\n', '  -   x\n'],
    ['- [x]  done\n', '- [x]  x\n'],
  ])('setEntry keeps the indent and marker whitespace of %j', (input, output) => {
    const doc = parseAmrDocument(input);
    expect(renderAmrDocument(setEntry(doc, 0, 'x', {}))).toBe(output);
  });

  it('counts a tab indent as one indent character and reads the child under it', () => {
    const doc = parseAmrDocument('- a\n\t- b\n');
    expect(doc.lines[1].indent).toBe(1);
    expect(doc.lines[1].entry!.text).toBe('b');
  });

  it('setEntry with empty text writes one space after the marker', () => {
    const doc = parseAmrDocument('- old [source: u]\n');
    expect(renderAmrDocument(setEntry(doc, 0, '', { source: ['u'] }))).toBe('- [source: u]\n');
  });

  it('drops an empty bullet part before the continuation join', () => {
    expect(parseAmrDocument('-  \n  text\n').lines[0].entry!.text).toBe('text');
  });

  it('gives a continuation to the nested bullet before it', () => {
    const doc = parseAmrDocument('- a\n  - b\n    more\n');
    expect(doc.lines[0].entry!.text).toBe('a');
    expect(doc.lines[1].entry!.text).toBe('b more');
    expect(doc.lines[2].kind).toBe('continuation');
  });

  it('setEntry recomputes warnings and line numbers', () => {
    const doc = parseAmrDocument('- a\n  b\n  c\n- bad [k: v]]\n');
    expect(doc.warnings).toEqual([expect.stringMatching(/^Line 4: /)]);
    const moved = setEntry(doc, 0, 'a', {});
    expect(moved.warnings).toEqual([expect.stringMatching(/^Line 2: /)]);
    const fixed = setEntry(moved, 1, 'good', { k: ['v'] });
    expect(fixed.warnings).toEqual([]);
  });

  it('setEntry copies the metadata it is given', () => {
    const meta = { k: ['v'] };
    const doc = setEntry(parseAmrDocument('- a\n'), 0, 'z', meta);
    meta.k.push('w');
    expect(doc.lines[0].entry!.meta).toEqual({ k: ['v'] });
  });

  it('setEntry refuses a document that is not parseable', () => {
    expect(() => setEntry(parseAmrDocument('- a\n```\n- b\n'), 0, 'x', {})).toThrow(ValidationError);
  });

  it('marks unterminated front matter as not parseable', () => {
    const doc = parseAmrDocument('---\nname: x\ntags:\n- a\n- b\n');
    expect(doc.parseable).toBe(false);
    expect(doc.frontMatter).toBeUndefined();
    expect(doc.warnings).toEqual([expect.stringMatching(/front matter/)]);
  });

  it('allows trailing spaces on both front matter lines', () => {
    const doc = parseAmrDocument('--- \nname: x\n---  \n- a\n');
    expect(doc.frontMatter).toBe('name: x');
    expect(doc.lines.map((l) => l.kind)).toEqual(['frontmatter', 'frontmatter', 'frontmatter', 'bullet']);
  });

  it('does not open a fence for inline triple backticks', () => {
    const doc = parseAmrDocument('```code``` here\n- a\n');
    expect(doc.parseable).toBe(true);
    expect(doc.lines.map((l) => l.kind)).toEqual(['prose', 'bullet']);
  });

  it.each([
    ['tilde fence', '~~~\n- a\n~~~\n- b\n', true],
    ['backtick fence closed by tildes stays open', '```\n- a\n~~~\n- b\n', false],
    ['four backticks closed by three stays open', '````\n- a\n```\n- b\n', false],
    ['three backticks closed by four', '```\n- a\n````\n- b\n', true],
  ])('%s', (_label, text, parseable) => {
    const doc = parseAmrDocument(text);
    expect(doc.parseable).toBe(parseable);
    expect(doc.lines[1].kind).toBe('fence');
    expect(doc.lines[3].kind).toBe(parseable ? 'bullet' : 'fence');
  });
});
