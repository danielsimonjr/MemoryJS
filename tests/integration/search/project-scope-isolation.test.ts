import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Project scope isolates search across all search methods', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-proj-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));

    await ctx.entityManager.createEntities([
      { name: 'alpha', entityType: 'thing', observations: ['foo bar'], projectId: 'p1' },
      { name: 'beta', entityType: 'thing', observations: ['foo bar'], projectId: 'p2' },
      { name: 'gamma', entityType: 'thing', observations: ['foo bar'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searchNodes respects projectId filter', async () => {
    const results = await ctx.searchManager.searchNodes('foo', { projectId: 'p1' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
    expect(names).not.toContain('gamma');
  });

  it('searchNodes without projectId returns all', async () => {
    const results = await ctx.searchManager.searchNodes('foo');
    expect(results.entities.length).toBe(3);
  });

  it('fuzzySearch respects projectId filter', async () => {
    const results = await ctx.searchManager.fuzzySearch('foo', { projectId: 'p2' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('beta');
    expect(names).not.toContain('alpha');
  });

  it('booleanSearch respects projectId filter', async () => {
    const results = await ctx.searchManager.booleanSearch('foo AND bar', { projectId: 'p1' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
  });

});

// Ranked search requires a discriminating corpus so TF-IDF produces non-zero scores.
// (IDF = log(N/df); if every entity contains the query term, IDF = 0 and no results
// are returned — which is correct TF-IDF behaviour but unhelpful for an isolation test.)
// We therefore use a separate describe with dedicated test data.
describe('searchNodesRanked respects projectId filter', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-ranked-proj-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));

    // Only alpha (p1) contains 'foo', so IDF('foo') > 0 and TF-IDF scoring works.
    await ctx.entityManager.createEntities([
      { name: 'alpha', entityType: 'thing', observations: ['foo bar'], projectId: 'p1' },
      { name: 'beta', entityType: 'thing', observations: ['baz qux'], projectId: 'p2' },
      { name: 'gamma', entityType: 'thing', observations: ['quux corge'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searchNodesRanked respects projectId filter', async () => {
    const results = await ctx.searchManager.searchNodesRanked('foo', { projectId: 'p1' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
    expect(names).not.toContain('gamma');
  });
});
