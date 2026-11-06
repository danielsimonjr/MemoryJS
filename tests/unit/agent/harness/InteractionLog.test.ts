/**
 * InteractionLog (RS-7) unit tests.
 *
 * Covers append / read / range / search / select / stats / close, spill to
 * blobs, torn trailing lines, address monotonicity across reopen, regex
 * limits, and concurrent appends.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InteractionLog, InteractionLogError } from '../../../../src/agent/harness/InteractionLog.js';
import { compileSelectRegex, MAX_REGEX_SOURCE_LENGTH } from '../../../../src/agent/harness/InteractionLogRegex.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

const open: InteractionLog[] = [];

function track(log: InteractionLog): InteractionLog {
  open.push(log);
  return log;
}

async function closeAll(): Promise<void> {
  while (open.length > 0) {
    await open.pop()!.close();
  }
}

afterEach(async () => {
  await closeAll();
  cleanupTempDirs();
});

describe('InteractionLog: append, read, range', () => {
  it('appends records with consecutive addresses and reads them back', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath(), { maxInlineBytes: 1024 }));
    const a = await log.append({ sessionId: 's1', kind: 'model', content: 'hello' });
    const b = await log.append({ sessionId: 's1', kind: 'note', tag: 'later', content: 'world' });
    expect([a, b]).toEqual(['e1', 'e2']);

    const rec = await log.read('e2');
    expect(rec).toMatchObject({ addr: 'e2', sessionId: 's1', kind: 'note', tag: 'later', content: 'world', bytes: 5 });
    expect(rec.spill).toBeUndefined();
    expect(typeof rec.ts).toBe('string');
  });

  it('rejects unknown addresses, malformed addresses and invalid input', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await expect(log.read('e1')).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.read('../e1')).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.read('e01')).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.append({ sessionId: '', kind: 'note', content: 'x' })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(
      log.append({ sessionId: 's', kind: 'bogus' as 'note', content: 'x' }),
    ).rejects.toBeInstanceOf(InteractionLogError);
  });

  it('returns a bounded, ordered range', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    for (let i = 1; i <= 5; i++) {
      await log.append({ sessionId: 's', kind: 'model', content: `turn ${i}` });
    }
    const all = await log.range('e2', 'e4');
    expect(all.map((r) => r.addr)).toEqual(['e2', 'e3', 'e4']);
    const limited = await log.range('e1', 'e5', { limit: 2 });
    expect(limited.map((r) => r.content)).toEqual(['turn 1', 'turn 2']);
    expect(await log.range('e4', 'e2')).toEqual([]);
  });

  it('rejects an out-of-range limit', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await expect(log.range('e1', 'e2', { limit: 0 })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.search('x', { limit: 1001 })).rejects.toBeInstanceOf(InteractionLogError);
  });
});

describe('InteractionLog: search', () => {
  it('ranks by Jaccard over tokens and applies kind and session filters', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await log.append({ sessionId: 's1', kind: 'model', content: 'database connection pool exhausted' });
    await log.append({ sessionId: 's2', kind: 'model', content: 'database connection pool exhausted' });
    await log.append({ sessionId: 's1', kind: 'tool_output', content: 'unrelated weather report' });

    const hits = await log.search('connection pool', { kinds: ['model'], sessionId: 's1' });
    expect(hits.map((h) => h.record.addr)).toEqual(['e1']);
    expect(hits[0].score).toBeGreaterThan(0);

    const none = await log.search('   ');
    expect(none).toEqual([]);
  });

  it('blends a semantic provider and falls back to lexical scores when it throws', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await log.append({ sessionId: 's', kind: 'note', content: 'alpha beta' });
    const lexicalOnly = await log.search('alpha beta');

    log.setSemanticSearch({ calculateSimilarity: async () => 1 });
    const blended = await log.search('alpha beta');
    expect(blended[0].score).toBeCloseTo((lexicalOnly[0].score + 1) / 2, 10);

    log.setSemanticSearch({
      calculateSimilarity: async () => {
        throw new Error('embedder down');
      },
    });
    const fallback = await log.search('alpha beta');
    expect(fallback[0].score).toBeCloseTo(lexicalOnly[0].score, 10);
  });
});

describe('InteractionLog: select', () => {
  it('returns selected lines, regex matches and field picks', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await log.append({ sessionId: 's', kind: 'tool_output', content: 'ok\nERROR one\nok\nERROR two' });

    const all = await log.select('e1');
    expect(all.lines.map((l) => l.line)).toEqual([1, 2, 3, 4]);
    expect(all.totalLines).toBe(4);
    expect(all.bounded).toBe(false);

    const ranged = await log.select('e1', { lines: [2, 99] });
    expect(ranged.lines.map((l) => l.line)).toEqual([2, 3, 4]);

    const matched = await log.select('e1', { regex: '^ERROR', lines: [1, 3] });
    expect(matched.lines).toEqual([{ line: 2, text: 'ERROR one' }]);

    const fields = await log.select('e1', { fields: ['kind', 'content'] });
    expect(fields.lines).toEqual([]);
    expect(fields.fields).toEqual({ kind: 'tool_output', content: 'ok\nERROR one\nok\nERROR two' });
  });

  it('rejects fields combined with lines or regex, bad ranges and unknown fields', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await log.append({ sessionId: 's', kind: 'note', content: 'x' });
    await expect(log.select('e1', { fields: ['kind'], lines: [1, 1] })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.select('e1', { fields: ['kind'], regex: 'x' })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.select('e1', { lines: [0, 1] })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.select('e1', { lines: [3, 2] })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.select('e1', { fields: ['secret'] })).rejects.toBeInstanceOf(InteractionLogError);
  });
});

describe('InteractionLog: spill over maxInlineBytes', () => {
  it('writes large content to a blob and keeps only the inline prefix on the record', async () => {
    const storage = makeTempJsonlPath();
    const log = track(new InteractionLog(storage, { maxInlineBytes: 10 }));
    const big = 'line-one\nERROR here\nline-three';
    const addr = await log.append({ sessionId: 's', kind: 'tool_output', content: big });

    const rec = await log.read(addr);
    expect(rec.content).toBe('line-one\nE');
    expect(rec.bytes).toBe(Buffer.byteLength(big));
    expect(rec.spill).toEqual({ path: `${log.blobDir.split(/[\\/]/).pop()}/e1`, originalBytes: Buffer.byteLength(big) });

    const blob = await fs.readFile(join(log.blobDir, addr), 'utf8');
    expect(blob).toBe(big);
    expect(await log.stats()).toEqual({ records: 1, bytes: expect.any(Number), spilled: 1 });

    const sel = await log.select(addr, { regex: 'ERROR' });
    expect(sel.lines).toEqual([]);
    expect(sel.bounded).toBe(true);
    const head = await log.select(addr, { lines: [1, 1] });
    expect(head.lines).toEqual([{ line: 1, text: 'line-one' }]);
  });

  it('never splits a multi-byte character when truncating inline', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath(), { maxInlineBytes: 5 }));
    const addr = await log.append({ sessionId: 's', kind: 'note', content: 'ééééé' });
    const rec = await log.read(addr);
    expect(rec.content).toBe('éé');
    expect(Buffer.byteLength(rec.content)).toBeLessThanOrEqual(5);
  });

  it('rejects a non-positive inline budget', () => {
    expect(() => new InteractionLog(makeTempJsonlPath(), { maxInlineBytes: 0 })).toThrow(InteractionLogError);
  });
});

describe('InteractionLog: reopen, torn lines, monotonic addresses', () => {
  it('keeps addresses monotonic across reopen', async () => {
    const storage = makeTempJsonlPath();
    const first = track(new InteractionLog(storage));
    await first.append({ sessionId: 's', kind: 'model', content: 'a' });
    await first.append({ sessionId: 's', kind: 'model', content: 'b' });
    await first.close();

    const second = track(new InteractionLog(storage));
    expect(await second.append({ sessionId: 's', kind: 'model', content: 'c' })).toBe('e3');
    expect((await second.read('e1')).content).toBe('a');
  });

  it('skips a torn trailing line and does not merge the next record into it', async () => {
    const storage = makeTempJsonlPath();
    const log = track(new InteractionLog(storage));
    await log.append({ sessionId: 's', kind: 'model', content: 'complete' });
    await log.close();

    const logFile = log.logPath;
    await fs.appendFile(logFile, '{"addr":"e2","ts":"x","sessionId":"s","kind":"mo');

    const reopened = track(new InteractionLog(storage));
    expect((await reopened.stats()).records).toBe(1);
    const addr = await reopened.append({ sessionId: 's', kind: 'model', content: 'after tear' });
    expect(addr).toBe('e2');
    expect((await reopened.read('e2')).content).toBe('after tear');
    expect((await reopened.range('e1', 'e9')).map((r) => r.content)).toEqual(['complete', 'after tear']);
  });
});

describe('InteractionLog: regex limits', () => {
  it('accepts an ordinary pattern and a non-capturing group', () => {
    expect(compileSelectRegex('ERROR\\s+\\d+').regex.test('ERROR 42')).toBe(true);
    expect(compileSelectRegex('(?:ab)+c').regex.test('ababc')).toBe(true);
    expect(compileSelectRegex('(a|b)c').regex.test('bc')).toBe(true);
  });

  it('rejects sources over 256 characters and 10 KB sources', () => {
    expect(() => compileSelectRegex('a'.repeat(MAX_REGEX_SOURCE_LENGTH + 1))).toThrow(InteractionLogError);
    expect(() => compileSelectRegex('a'.repeat(10 * 1024))).toThrow(InteractionLogError);
    expect(compileSelectRegex('a'.repeat(MAX_REGEX_SOURCE_LENGTH)).regex.source.length).toBe(MAX_REGEX_SOURCE_LENGTH);
  });

  it('rejects nested quantifiers', () => {
    for (const src of ['(a+)+', '(\\w*)*', '(a{2,})+', '((a)+)+', '(?:ab+)*']) {
      expect(() => compileSelectRegex(src), src).toThrow(/nested quantifiers/);
    }
  });

  it('does not treat quantifiers inside character classes or escapes as nested', () => {
    expect(compileSelectRegex('[+*]+').regex.test('++')).toBe(true);
    expect(compileSelectRegex('(a)\\+(b)+').regex.test('a+bb')).toBe(true);
  });

  it('rejects a pattern that does not compile', () => {
    expect(() => compileSelectRegex('(ab')).toThrow(InteractionLogError);
  });

  it('applies the regex cap through select', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    await log.append({ sessionId: 's', kind: 'note', content: 'x' });
    await expect(log.select('e1', { regex: '(a+)+$' })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.select('e1', { regex: 'a'.repeat(300) })).rejects.toBeInstanceOf(InteractionLogError);
  });
});

describe('InteractionLog: concurrency and close', () => {
  it('gives concurrent appends distinct, consecutive addresses', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    const addrs = await Promise.all(
      Array.from({ length: 25 }, (_, i) => log.append({ sessionId: 's', kind: 'model', content: `m${i}` })),
    );
    const nums = addrs.map((a) => Number(a.slice(1))).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await log.stats()).records).toBe(25);
  });

  it('close is idempotent and later calls reject', async () => {
    const log = new InteractionLog(makeTempJsonlPath());
    await log.append({ sessionId: 's', kind: 'note', content: 'x' });
    await log.close();
    await log.close();
    await expect(log.append({ sessionId: 's', kind: 'note', content: 'y' })).rejects.toBeInstanceOf(InteractionLogError);
    await expect(log.read('e1')).rejects.toBeInstanceOf(InteractionLogError);
  });

  it('reports stats for an empty log without creating files', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath()));
    expect(await log.stats()).toEqual({ records: 0, bytes: 0, spilled: 0 });
  });
});
