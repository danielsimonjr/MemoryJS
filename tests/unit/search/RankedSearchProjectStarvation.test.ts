/**
 * RankedSearch project-scoped result starvation.
 *
 * A project-scoped query must not lose eligible results because a larger
 * competing project fills the internal scoring window first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RankedSearch } from '../../../src/search/RankedSearch.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SEARCH_LIMITS } from '../../../src/utils/constants.js';
import type { Entity } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('RankedSearch project isolation under a large competing corpus', () => {
  let storage: GraphStorage;
  let rankedSearch: RankedSearch;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ranked-starvation-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'test-graph.jsonl'));
    rankedSearch = new RankedSearch(storage);

    const entityManager = new EntityManager(storage);
    const competitors: Entity[] = [];
    for (let i = 0; i < SEARCH_LIMITS.MAX + 1; i++) {
      competitors.push({
        name: `AlphaDoc${i}`,
        entityType: 'note',
        observations: ['kubernetes kubernetes kubernetes'],
        projectId: 'project-a',
      } as Entity);
    }
    // Weaker signal for the same term, so every project-a document outranks it.
    competitors.push({
      name: 'BetaDoc',
      entityType: 'note',
      observations: ['kubernetes appears once among many unrelated filler words here'],
      projectId: 'project-b',
    } as Entity);
    // Unrelated documents keep the corpus IDF for 'kubernetes' above zero;
    // a term present in every document scores zero by definition.
    for (let i = 0; i < 50; i++) {
      competitors.push({
        name: `FillerDoc${i}`,
        entityType: 'note',
        observations: ['unrelated filler text about gardening'],
        projectId: 'project-c',
      } as Entity);
    }
    await entityManager.createEntities(competitors);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('returns the project-b match despite 201 higher-scoring project-a matches', async () => {
    const results = await rankedSearch.searchNodesRanked(
      'kubernetes', undefined, undefined, undefined, 10, 'project-b',
    );
    expect(results.map(r => r.entity.name)).toEqual(['BetaDoc']);
  });
});
