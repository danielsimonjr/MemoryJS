# Approximate vector search and semantic entity lookup

Exact cosine search remains the default. For large in-memory vector collections,
opt into deterministic multi-probe random-hyperplane locality-sensitive hashing:

```ts
import { LSHVectorStore, SemanticSearch } from '@danielsimonjr/memoryjs/search';

const vectors = new LSHVectorStore({
  tables: 12,
  bits: 8,
  multiProbe: true,
  exactThreshold: 256,
  seed: 42,
});
const search = new SemanticSearch(embeddingService, vectors);
await search.indexAll(graph);
const hits = await search.search(graph, 'related concepts', 10);
```

The store probes the matching bucket and (by default) each one-bit neighboring
bucket in every independent table. It reranks the union with exact cosine scores.
Corpora at or below `exactThreshold`, and queries producing fewer than k candidates,
fall back to an exact scan. Dimension-mismatched vectors are skipped. Stored vectors
must be nonempty and finite; zero vectors are supported. Input/output vector arrays
are copied to keep bucket keys valid. Replacement, removal and content hashes are
supported; this backend is in-memory and does not persist its index.

Approximate retrieval can miss true nearest neighbors. Measure recall@k against
`InMemoryVectorStore` using representative queries before choosing parameters. More
tables and multi-probing tend to improve recall at additional memory/query cost;
more bits tend to reduce candidate counts. `getLastCandidateCount()` reports exact
cosine evaluations for the last search. No universal speedup or recall is promised.

## Reusing an authoritative entity lookup

Default semantic search rebuilds a fresh name map on each call because supplied
graph objects may change in place. Applications that already maintain a correct
lookup can avoid that pass through `SemanticSearchOptions.resolveEntity`:

```ts
const entitiesByName = new Map(graph.entities.map(entity => [entity.name, entity]));
const search = new SemanticSearch(embeddingService, vectors, {
  resolveEntity(name, suppliedGraph) {
    // This example accepts one graph whose lookup the application maintains.
    if (suppliedGraph !== graph) throw new Error('Unexpected graph');
    return entitiesByName.get(name);
  },
});
```

The resolver is called only for returned vector candidates (and for an unindexed
`findSimilar` target). Keep it current after additions, replacements and deletions,
and ensure it reflects the supplied graph's visibility and ownership guarantees.
Do not return an unguarded storage-cache entity for a different or filtered graph.
Without a resolver, existing mutable-graph behavior is unchanged.
