/**
 * 03 - Graph algorithms: shortest path, components, centrality.
 *
 * Run: bun run examples/03-graph-algorithms.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    const names = ['A', 'B', 'C', 'D', 'Z', 'Island'];
    await ctx.entityManager.createEntities(
      names.map((name) => ({ name, entityType: 'node', observations: [`node ${name}`] })),
    );
    await ctx.relationManager.createRelations([
      { from: 'A', to: 'B', relationType: 'links' },
      { from: 'B', to: 'C', relationType: 'links' },
      { from: 'C', to: 'Z', relationType: 'links' },
      { from: 'A', to: 'D', relationType: 'links' },
      { from: 'D', to: 'Z', relationType: 'links' },
    ]);

    // Shortest path resolves to PathResult | null (path, length, relations).
    const shortest = await ctx.graphTraversal.findShortestPath('A', 'Z');
    const unreachable = await ctx.graphTraversal.findShortestPath('A', 'Island');

    // Connected components — ConnectedComponentsResult.
    const components = await ctx.graphTraversal.findConnectedComponents();

    // PageRank — CentralityResult { scores: Map, topEntities, algorithm }.
    const pagerank = await ctx.graphTraversal.calculatePageRank(0.85, 100, 1e-6, 3);
    const degree = await ctx.graphTraversal.calculateDegreeCentrality();

    // Graph statistics: totals and per-type counts.
    const stats = await ctx.analyticsManager.getGraphStats();

    return {
      shortestPath: shortest?.path ?? null,
      shortestLength: shortest?.length ?? null,
      unreachableIsNull: unreachable === null,
      componentCount: components.count,
      largestComponentSize: components.largestComponentSize,
      pagerankAlgorithm: pagerank.algorithm,
      pagerankTopNames: pagerank.topEntities.map((e) => e.name),
      pagerankScoreOfZ: pagerank.scores.get('Z') ?? 0,
      degreeOfA: degree.scores.get('A') ?? 0,
      totalEntities: stats.totalEntities,
      totalRelations: stats.totalRelations,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-03-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
