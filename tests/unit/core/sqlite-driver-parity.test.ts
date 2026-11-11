/**
 * Driver parity: `node:sqlite` behind `src/core/nodeSqliteAdapter.ts` must
 * behave like the `better-sqlite3` 13.0.3 package it replaced.
 *
 * The expectation file, `fixtures/sqliteDriverParity.json`, was recorded once
 * from the real package by `helpers/captureSqliteDriverParity.ts` (see that
 * file's header for the command). This test replays the identical corpus
 * through `createNodeSqliteDatabaseCtor()` and compares every captured field.
 * Each mismatch names the operation, so a regression says which behaviour moved
 * rather than "the fixtures differ".
 *
 * The corpus covers the whole surface `src/` uses: CRUD with `changes` and
 * `lastInsertRowid`, pragma readers and setters, FTS5 result order and `bm25()`
 * scores, transactions with rollback and savepoint nesting, WAL visibility from
 * a second read-only connection, 256 KiB BLOBs, integers above 2^53,
 * `NULL`/`undefined` binding, Unicode text, every error shape a caller can meet,
 * the stale-posting `SQLITE_CORRUPT_VTAB` path, and the on-disk schema.
 *
 * `node:sqlite` needs a real Node: it is absent in Bun. The file therefore skips
 * when Vitest is hosted by Bun (`typeof Bun !== 'undefined'`) and never skips on
 * the Node lane, which is `bun run test:ci`.
 *
 * @module tests/unit/core/sqlite-driver-parity.test
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeSqliteDatabaseCtor } from '../../../src/core/nodeSqliteAdapter.js';
import { runCorpus, type CorpusCtor } from './helpers/sqliteDriverCases.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'sqliteDriverParity.json'), 'utf-8'),
) as { betterSqlite3: string; record: Record<string, unknown> };

/** One sentence naming why this file can be skipped, used as the skip reason. */
const NODE_LANE_ONLY =
  'node:sqlite does not exist in Bun-hosted Vitest; the Node lane is `bun run test:ci`';

/**
 * Fields where `node:sqlite` is known to differ from `better-sqlite3`.
 *
 * `nulTextRead`: `node:sqlite` truncates a TEXT value at the first NUL when it
 * converts the column to a JS string. The bytes stored are identical (the corpus
 * pins that separately as `nulTextStoredHex`), so this is a read-side difference
 * only, and it cannot be reached through MemoryJS's own writes: entity names are
 * validated, and observations/tags/metadata are stored with `JSON.stringify`,
 * which escapes NUL as `\u0000` before it reaches SQLite. Pinned by the
 * `documented deviation` test below rather than hidden.
 */
const KNOWN_DEVIATIONS: ReadonlySet<string> = new Set(['nulTextRead']);

describe.skipIf(typeof Bun !== 'undefined')('node:sqlite driver parity (better-sqlite3 13.0.3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memoryjs-parity-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const corpus = (): Record<string, unknown> =>
    runCorpus(createNodeSqliteDatabaseCtor() as unknown as CorpusCtor, (name) => join(dir, name));

  it('records from better-sqlite3 13.0.3', () => {
    expect(fixture.betterSqlite3).toBe('13.0.3');
    expect(Object.keys(fixture.record).length).toBeGreaterThan(80);
  });

  it('matches every recorded field', () => {
    const actual = corpus();

    // Compare field by field so a failure names the behaviour that moved.
    const differing: string[] = [];
    for (const [key, expected] of Object.entries(fixture.record)) {
      if (KNOWN_DEVIATIONS.has(key)) continue;
      const got = actual[key];
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        differing.push(
          `${key}\n  better-sqlite3: ${JSON.stringify(expected)}\n  node:sqlite:     ${JSON.stringify(got)}`,
        );
      }
    }
    expect(differing, `${differing.length} behaviour difference(s)`).toEqual([]);
  });

  it('captures every operation the corpus defines', () => {
    expect(Object.keys(corpus()).sort()).toEqual(Object.keys(fixture.record).sort());
  });

  it('documents the one known deviation: a NUL byte truncates a TEXT read', () => {
    const actual = corpus();
    // The stored bytes are identical on both drivers...
    expect(actual.nulTextStoredHex).toEqual(fixture.record.nulTextStoredHex);
    // ...but node:sqlite's TEXT-to-string conversion stops at the NUL.
    expect(actual.nulTextRead).toEqual({
      $type: 'object',
      proto: 'Object',
      value: { v: 'nul-in-' },
    });
    expect(fixture.record.nulTextRead).toEqual({
      $type: 'object',
      proto: 'Object',
      value: { v: 'nul-in-\u0000-middle' },
    });
    // The path MemoryJS writes through escapes the NUL, so it round-trips.
    expect(actual.nulJsonEncodedRoundTrip).toEqual(fixture.record.nulJsonEncodedRoundTrip);
  });

  it(`${NODE_LANE_ONLY}`, () => {
    // The skip above is conditional on the runtime, never on an environment
    // variable. This test documents the reason and pins that the Node lane sees
    // the module.
    if (typeof Bun !== 'undefined') return;
    expect(createNodeSqliteDatabaseCtor()).toBeTypeOf('function');
  });
});
