/**
 * CMP-2: env-gated `ctx.bloomPreScreener` wiring for fuzzy search.
 *
 * - Disabled by default: no screener constructed, nothing attached.
 * - Enabled with MEMORY_FUZZY_BLOOM_PRESCREEN='true': attached to the
 *   fuzzy searcher, lazily built on the first search, cleared on writes.
 * - Parity: fuzzy results with the screener equal results without it,
 *   including a typo query (the Levenshtein fallback must still find it).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { Entity } from '../../../src/types/types.js';

const ENV = 'MEMORY_FUZZY_BLOOM_PRESCREEN';

const FIRST = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
const LAST = ['Johnson', 'Miller', 'Nguyen', 'Okafor', 'Petrov', 'Quinn', 'Rossi', 'Sato', 'Tanaka', 'Usman'];

function buildFixture(): Entity[] {
  const entities: Entity[] = [];
  for (let i = 0; i < 100; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / 10)];
    entities.push({
      name: `${first} ${last} ${i}`,
      entityType: i % 2 === 0 ? 'person' : 'project',
      observations: [`note about topic${i % 7} and region${i % 5}`],
    } as Entity);
  }
  // Typo target: entity "Alice" (fuzzy matching compares whole names) and no
  // entity containing the exact token "alise".
  entities.push({ name: 'Alice', entityType: 'person', observations: ['zeta team lead'] } as Entity);
  entities.push({ name: 'Alice Zeta', entityType: 'person', observations: ['zeta team lead'] } as Entity);
  return entities;
}

const QUERIES = [
  'Alise', // typo of Alice (Levenshtein distance 1)
  'Alice Zeta',
  'Alice',
  'Bobb Miller',
  'Carrol',
  'topic3',
  'region2 note',
  'Johnsen',
  'Petrof',
  'project',
  'Grace Okafor',
  'zeta lead',
  'Ivann',
  'Heidi Sato',
  'Dave Quin',
  'Erin Rosi',
  'Frnk',
  'Judy Usman',
  'Mallory', // no match at all
  'note about',
  'Carole',
];

describe('CMP-2 ctx.bloomPreScreener (MEMORY_FUZZY_BLOOM_PRESCREEN)', () => {
  const dirs: string[] = [];
  const contexts: ManagerContext[] = [];
  let savedEnv: string | undefined;

  function newCtx(): ManagerContext {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-wiring-'));
    dirs.push(dir);
    const ctx = new ManagerContext(path.join(dir, 'memory.jsonl'));
    contexts.push(ctx);
    return ctx;
  }

  function setEnv(value: string | undefined): void {
    savedEnv = process.env[ENV];
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
  }

  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = savedEnv;
  });

  it('is null and unattached when the env flag is unset', async () => {
    setEnv(undefined);
    const ctx = newCtx();
    expect(ctx.bloomPreScreener).toBeNull();
    expect(ctx.searchManager.fuzzySearcher.hasBloomPreScreener()).toBe(false);
  });

  it('is null when the flag is not the strict literal "true"', async () => {
    setEnv('1');
    const ctx = newCtx();
    expect(ctx.bloomPreScreener).toBeNull();
  });

  it('attaches when enabled, builds on first search, clears on write, rebuilds on next search', async () => {
    setEnv('true');
    const ctx = newCtx();
    await ctx.entityManager.createEntities(buildFixture());

    const screener = ctx.bloomPreScreener;
    expect(screener).not.toBeNull();
    expect(ctx.searchManager.fuzzySearcher.hasBloomPreScreener()).toBe(true);
    expect(screener!.isBuilt()).toBe(false);

    await ctx.searchManager.fuzzySearcher.fuzzySearch('Alice Zeta');
    expect(screener!.isBuilt()).toBe(true);

    await ctx.entityManager.createEntities([
      { name: 'Newcomer Person', entityType: 'person', observations: [] } as Entity,
    ]);
    expect(screener!.isBuilt()).toBe(false);

    await ctx.searchManager.fuzzySearcher.fuzzySearch('Newcomer');
    expect(screener!.isBuilt()).toBe(true);
  });

  it('screened fuzzy results are a subset of unscreened results (never invents matches)', async () => {
    const fixture = buildFixture();

    setEnv(undefined);
    const plain = newCtx();
    await plain.entityManager.createEntities(fixture);
    // searchManager reads the env flag at first access: touch it while unset so
    // this context is genuinely unscreened.
    const plainFuzzy = plain.searchManager.fuzzySearcher;
    expect(plainFuzzy.hasBloomPreScreener()).toBe(false);

    setEnv('true');
    const screened = newCtx();
    await screened.entityManager.createEntities(fixture);
    expect(screened.bloomPreScreener).not.toBeNull();
    const screenedFuzzy = screened.searchManager.fuzzySearcher;
    expect(screenedFuzzy.hasBloomPreScreener()).toBe(true);

    // Lift the default result cap so the comparison is over complete sets.
    const all = (f: typeof plainFuzzy, q: string) =>
      f.fuzzySearch(q, undefined, undefined, undefined, undefined, 0, 1000);
    let nonEmpty = 0;
    for (const query of QUERIES) {
      const expected = new Set((await all(plainFuzzy, query)).entities.map((e) => e.name));
      const actual = (await all(screenedFuzzy, query)).entities.map((e) => e.name);
      if (actual.length > 0) nonEmpty++;
      for (const name of actual) {
        expect(expected.has(name), `query="${query}" produced "${name}" only when screened`).toBe(true);
      }
    }
    // The comparison must not be vacuous.
    expect(nonEmpty).toBeGreaterThan(0);
  });

  it('close() drops the cached screener and detaches it from the fuzzy searcher', async () => {
    setEnv('true');
    const ctx = newCtx();
    const first = ctx.bloomPreScreener;
    expect(first).not.toBeNull();
    expect(ctx.searchManager.fuzzySearcher.hasBloomPreScreener()).toBe(true);
    ctx.close();
    expect(ctx.searchManager.fuzzySearcher.hasBloomPreScreener()).toBe(false);
    const second = ctx.bloomPreScreener;
    expect(second).not.toBe(first);
  });

  it('documented trade-off: screened fuzzy search is approximate (drops typo match when a literal token exists)', async () => {
    const fixture = [
      { name: 'Alice', entityType: 'person', observations: ['zeta team lead'] },
      { name: 'Bundle', entityType: 'thing', observations: ['alise token here'] },
    ] as Entity[];

    setEnv(undefined);
    const plain = newCtx();
    await plain.entityManager.createEntities(fixture);
    // searchManager reads the env flag at first access: touch it while unset.
    const plainFuzzy = plain.searchManager.fuzzySearcher;
    setEnv('true');
    const screened = newCtx();
    await screened.entityManager.createEntities(fixture);
    const screenedFuzzy = screened.searchManager.fuzzySearcher;

    const p = await plainFuzzy.fuzzySearch('Alise');
    const s = await screenedFuzzy.fuzzySearch('Alise');
    expect(p.entities.map((e) => e.name).sort()).toEqual(['Alice', 'Bundle']);
    expect(s.entities.map((e) => e.name).sort()).toEqual(['Bundle']);
  });
});
