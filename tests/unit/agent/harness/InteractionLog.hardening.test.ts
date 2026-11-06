/**
 * InteractionLog hardening regressions (Recursa Phase 2 check): bounded select regex (B1),
 * two instances on one file (B2), relative storage paths (S1), missing blobs (N1) and the
 * inline-bytes env fallback (N2).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { InteractionLog, InteractionLogError } from '../../../../src/agent/harness/InteractionLog.js';
import { compileSelectRegex, matchSelectLines } from '../../../../src/agent/harness/InteractionLogRegex.js';
import { ErrorCode } from '../../../../src/utils/errors.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

const logs: InteractionLog[] = [];
function track(log: InteractionLog): InteractionLog {
  logs.push(log);
  return log;
}

afterEach(async () => {
  while (logs.length > 0) await logs.pop()!.close();
  delete process.env.MEMORY_INTERACTION_LOG_INLINE_BYTES;
  cleanupTempDirs();
});

describe('B1: bounded select regex', () => {
  it.each(['(a|aa)+$', '(a|a)*b', 'a*a*a*a*a*a*b', 'a*a*b', '(a+)+$', 'a+.*b+.*c'])(
    'rejects or returns under 300 ms for %s on a 16 KB line',
    async (src) => {
      const log = track(new InteractionLog(makeTempJsonlPath(), { maxInlineBytes: 32 * 1024 }));
      const addr = await log.append({ sessionId: 's', kind: 'note', content: `${'a'.repeat(16 * 1024)}!` });
      const t0 = Date.now();
      await log.select(addr, { regex: src }).catch((err: unknown) => {
        expect(err).toBeInstanceOf(InteractionLogError);
      });
      expect(Date.now() - t0).toBeLessThan(300);
    },
  );

  it('rejects alternation in a quantified group and more than 2 unbounded quantifiers', () => {
    expect(() => compileSelectRegex('(foo|bar)+')).toThrow(/alternation/);
    expect(() => compileSelectRegex('a*a*a*b')).toThrow(/more than 2/);
    expect(() => compileSelectRegex('a+x{2,}yb*')).toThrow(/more than 2/);
    expect(compileSelectRegex('\\w*\\s+x').lineCap).toBe(256);
    expect(compileSelectRegex('(foo|bar)x').regex.test('barx')).toBe(true);
    expect(compileSelectRegex('a{1,3}b*').lineCap).toBe(4096);
    expect(compileSelectRegex('.*x.*y').lineCap).toBe(256);
  });

  it('matches long lines on their 4 KiB prefix but returns the full line', () => {
    const line = `${'z'.repeat(5000)}TAIL`;
    const compiled = compileSelectRegex('TAIL');
    expect(matchSelectLines([line], 1, 1, compiled)).toEqual([]);
    expect(matchSelectLines([line], 1, 1, compileSelectRegex('^z'))).toEqual([{ line: 1, text: line }]);
  });

  it('throws INVALID_QUERY when the per-call budget runs out', () => {
    const lines = Array.from({ length: 50 }, () => 'x'.repeat(256));
    try {
      matchSelectLines(lines, 1, 50, compileSelectRegex('.*x.*y'), -1);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InteractionLogError);
      expect((err as InteractionLogError).code).toBe(ErrorCode.INVALID_QUERY);
    }
  });
});

describe('B2: two instances on one file', () => {
  it('interleaved appends get distinct consecutive addresses and blobs', async () => {
    const path = makeTempJsonlPath();
    const a = track(new InteractionLog(path, { maxInlineBytes: 8 }));
    const b = track(new InteractionLog(path, { maxInlineBytes: 8 }));
    const addrs = [
      await a.append({ sessionId: 's', kind: 'note', content: 'A'.repeat(40) }),
      await b.append({ sessionId: 's', kind: 'note', content: 'B'.repeat(40) }),
      await a.append({ sessionId: 's', kind: 'note', content: 'short' }),
      ...(await Promise.all([
        a.append({ sessionId: 's', kind: 'note', content: 'C' }),
        b.append({ sessionId: 's', kind: 'note', content: 'D' }),
      ])),
    ];
    expect([...addrs].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    const c = track(new InteractionLog(path, { maxInlineBytes: 8 }));
    expect((await c.stats()).records).toBe(5);
    expect((await c.select('e1')).lines[0].text).toBe('A'.repeat(8));
    expect((await c.select('e2')).lines[0].text).toBe('B'.repeat(8));
    expect((await a.read('e2')).content).toBe('B'.repeat(8));
  });

  it('refuses to overwrite an existing blob', async () => {
    const path = makeTempJsonlPath();
    const log = track(new InteractionLog(path, { maxInlineBytes: 4 }));
    await fs.mkdir(log.blobDir, { recursive: true });
    await fs.writeFile(join(log.blobDir, 'e1'), 'squatter');
    await expect(log.append({ sessionId: 's', kind: 'note', content: 'x'.repeat(20) })).rejects.toBeInstanceOf(
      InteractionLogError,
    );
    expect(await fs.readFile(join(log.blobDir, 'e1'), 'utf8')).toBe('squatter');
  });
});

describe('S1 / N1 / N2', () => {
  it('S1: spills with a relative storage path containing ..', async () => {
    const abs = makeTempJsonlPath();
    const rel = join('..', basename(dirname(abs)), basename(abs));
    const cwd = process.cwd();
    process.chdir(join(dirname(abs), '..', basename(dirname(abs))));
    try {
      expect(relative(process.cwd(), dirname(abs))).toBe('');
      const log = track(new InteractionLog(rel, { maxInlineBytes: 4 }));
      const addr = await log.append({ sessionId: 's', kind: 'note', content: 'y'.repeat(30) });
      process.chdir(cwd);
      expect((await log.select(addr)).lines[0].text).toBe('yyyy');
      expect(log.logPath.startsWith(dirname(abs))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('N1: a missing blob is STORAGE_CORRUPTED for select and fields', async () => {
    const log = track(new InteractionLog(makeTempJsonlPath(), { maxInlineBytes: 4 }));
    const addr = await log.append({ sessionId: 's', kind: 'note', content: 'z'.repeat(30) });
    await fs.rm(join(log.blobDir, addr));
    for (const opts of [{}, { fields: ['content'] }]) {
      const err = await log.select(addr, opts).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InteractionLogError);
      expect((err as InteractionLogError).code).toBe(ErrorCode.STORAGE_CORRUPTED);
    }
  });

  it.each(['0', '-5', 'abc', '1e3'])('N2: invalid env value %s falls back to 16384', (value) => {
    process.env.MEMORY_INTERACTION_LOG_INLINE_BYTES = value;
    expect(new InteractionLog(makeTempJsonlPath()).maxInlineBytes).toBe(16384);
  });

  it('N2: a valid env value applies', () => {
    process.env.MEMORY_INTERACTION_LOG_INLINE_BYTES = '64';
    expect(new InteractionLog(makeTempJsonlPath()).maxInlineBytes).toBe(64);
  });
});
