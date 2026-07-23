/**
 * RankedSearch Graph Boost Unit Tests
 *
 * Optional graph-connectivity boost: final score x (1 + boost * normalizedPageRank).
 * Off by default (boost 0) — ordering must change only when enabled.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RankedSearch } from '../../../src/search/RankedSearch.js';
import { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('RankedSearch graph boost', () => {
  let storage: GraphStorage;
  let rankedSearch: RankedSearch;
  let prior: GraphRankPrior;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ranked-graph-boost-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'test-graph.jsonl'));
    rankedSearch = new RankedSearch(storage);

    const entityManager = new EntityManager(storage);
    const relationManager = new RelationManager(storage);

    // DocA and DocB have identical text signals for the query 'python'
    await entityManager.createEntities([
      { name: 'DocA', entityType: 'note', observations: ['python tutorial content'] },
      { name: 'DocB', entityType: 'note', observations: ['python tutorial content'] },
      { name: 'Fan1', entityType: 'reader', observations: ['likes reading'] },
      { name: 'Fan2', entityType: 'reader', observations: ['likes reading'] },
      { name: 'Fan3', entityType: 'reader', observations: ['likes reading'] },
    ]);

    // DocB is well-connected (3 incoming links); DocA is isolated
    await relationManager.createRelations([
      { from: 'Fan1', to: 'DocB', relationType: 'references' },
      { from: 'Fan2', to: 'DocB', relationType: 'references' },
      { from: 'Fan3', to: 'DocB', relationType: 'references' },
    ]);

    prior = new GraphRankPrior(new GraphTraversal(storage));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Cleanup failures are non-fatal
    }
  });

  it('should give DocA and DocB equal scores when the boost is off (default)', async () => {
    const results = await rankedSearch.searchNodesRanked('python');

    const docA = results.find(r => r.entity.name === 'DocA')!;
    const docB = results.find(r => r.entity.name === 'DocB')!;
    expect(docA).toBeDefined();
    expect(docB).toBeDefined();
    expect(docA.score).toBeCloseTo(docB.score, 12);
  });

  it('should boost the well-connected entity when enabled', async () => {
    rankedSearch.setGraphPrior(prior, 1.0);

    const results = await rankedSearch.searchNodesRanked('python');

    const docA = results.find(r => r.entity.name === 'DocA')!;
    const docB = results.find(r => r.entity.name === 'DocB')!;
    expect(docB.score).toBeGreaterThan(docA.score);
    expect(results[0].entity.name).toBe('DocB');
  });

  it('should change ordering only when enabled', async () => {
    const baseline = await rankedSearch.searchNodesRanked('python');

    // Boost of 0 leaves the behavior disabled even with a prior attached
    rankedSearch.setGraphPrior(prior, 0);
    const stillOff = await rankedSearch.searchNodesRanked('python');
    expect(stillOff.map(r => [r.entity.name, r.score])).toEqual(
      baseline.map(r => [r.entity.name, r.score])
    );

    // Enable, then detach again — behavior returns to baseline
    rankedSearch.setGraphPrior(prior, 2.0);
    const boosted = await rankedSearch.searchNodesRanked('python');
    expect(boosted[0].entity.name).toBe('DocB');

    rankedSearch.setGraphPrior(null);
    const detached = await rankedSearch.searchNodesRanked('python');
    expect(detached.map(r => [r.entity.name, r.score])).toEqual(
      baseline.map(r => [r.entity.name, r.score])
    );
  });

  it('should scale scores by (1 + boost * normalizedPageRank)', async () => {
    const baseline = await rankedSearch.searchNodesRanked('python');
    const baselineByName = new Map(baseline.map(r => [r.entity.name, r.score]));

    const boost = 0.5;
    rankedSearch.setGraphPrior(prior, boost);
    const boosted = await rankedSearch.searchNodesRanked('python');

    const priorScores = await prior.getScores(['DocA', 'DocB']);
    for (const result of boosted) {
      const expected =
        baselineByName.get(result.entity.name)! *
        (1 + boost * (priorScores.get(result.entity.name) ?? 0));
      expect(result.score).toBeCloseTo(expected, 12);
    }
  });
});
