/**
 * 02 - Search: ranked, fuzzy, boolean, temporal and hybrid retrieval.
 *
 * Run: bun run examples/02-search.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(
  storagePath: string,
  options: { storageType?: 'jsonl' | 'sqlite' } = {},
): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext({ storagePath, storageType: options.storageType });
  try {
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['Senior engineer on the runtime team'], tags: ['backend'], importance: 9 },
      { name: 'Bob', entityType: 'person', observations: ['Frontend developer who writes TypeScript'], tags: ['frontend'], importance: 4 },
      { name: 'Typescript', entityType: 'language', observations: ['Static typing for JavaScript programs'], tags: ['programming'], importance: 8 },
      { name: 'Acme Corp', entityType: 'organization', observations: ['Maintains the runtime platform'], tags: ['company'], importance: 6 },
    ]);

    // Ranked (TF-IDF / BM25) — positional form returns SearchResult[] with a score.
    const ranked = await ctx.rankedSearch.searchNodesRanked('runtime platform', undefined, undefined, undefined, 5);

    // Fuzzy — positional threshold (0–1, higher is stricter) or an options object.
    const fuzzyPositional = await ctx.searchManager.fuzzySearch('Typscript', 0.7);
    const fuzzyOptions = await ctx.searchManager.fuzzySearch('Typscript', { tags: ['programming'], minImportance: 5 });

    // Boolean — AND / OR / NOT with parentheses.
    const boolean = await ctx.searchManager.booleanSearch('person AND (frontend OR backend)');

    // Substring search with tag and importance filters.
    const filtered = await ctx.searchManager.searchNodes('engineer', { tags: ['backend'], minImportance: 5 });

    // Temporal — natural-language time range (entities created just now match "last hour").
    const recent = await ctx.searchManager.searchByTime('last hour');

    // Hybrid — semantic weight 0 keeps the embedding provider out of this example.
    const graph = await ctx.storage.loadGraph();
    const hybrid = await ctx.hybridSearchManager.search(graph, 'runtime', {
      semanticWeight: 0,
      lexicalWeight: 0.7,
      symbolicWeight: 0.3,
      symbolic: { tags: ['backend', 'company'], importance: { min: 5 } },
      limit: 5,
    });

    // SemanticSearch is null when no embedding provider is configured (MEMORY_EMBEDDING_PROVIDER=none).
    const semantic = ctx.semanticSearch;

    return {
      semanticAvailable: semantic !== null,
      rankedTop: ranked[0]?.entity.name ?? null,
      rankedScoresPositive: ranked.every((r) => r.score > 0),
      fuzzyPositional: fuzzyPositional.entities.map((e) => e.name),
      fuzzyOptions: fuzzyOptions.entities.map((e) => e.name),
      booleanHits: boolean.entities.map((e) => e.name).sort(),
      filteredHits: filtered.entities.map((e) => e.name),
      recentCount: recent.length,
      hybridTop: hybrid[0]?.entity.name ?? null,
      hybridLayers: hybrid[0]?.matchedLayers ?? [],
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-02-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
