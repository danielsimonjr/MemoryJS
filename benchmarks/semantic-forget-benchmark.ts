import { SemanticForget } from '../src/features/SemanticForget.js';
import { GraphStorage } from '../src/core/GraphStorage.js';
import { SemanticSearch } from '../src/search/SemanticSearch.js';
import { Entity } from '../src/types/types.js';
import { performance } from 'perf_hooks';

// Mock implementations
class MockGraphStorage {
  entities: Entity[] = [];
  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.entities.push({
        name: `entity_${i}`,
        entityType: 'test',
        observations: [`observation for entity ${i}`]
      });
    }
  }
  async loadGraph() {
    return { entities: this.entities, relations: [] };
  }
}

class MockSemanticSearch {
  async search(graph: any, query: string, limit: number, threshold: number) {
    // Return random results to simulate the search results
    const results = [];
    // Increased results limit to exacerbate the issue
    const numResults = 50;
    for(let i=0; i<numResults; i++) {
      // Pick random entities, mostly from the end of the array to make .find() slower
      const index = Math.floor(graph.entities.length * 0.8 + Math.random() * (graph.entities.length * 0.2));
      results.push({
        entity: graph.entities[index],
        score: 0.9
      });
    }
    return results;
  }

  async calculateSimilarity(a: string, b: string) {
    return 0.9;
  }
}

async function runBenchmark() {
  const GRAPH_SIZE = 100000; // 100k entities
  console.log(`Setting up benchmark with graph size: ${GRAPH_SIZE}`);

  const storage = new MockGraphStorage(GRAPH_SIZE) as unknown as GraphStorage;
  const semanticSearch = new MockSemanticSearch() as unknown as SemanticSearch;

  const semanticForget = new SemanticForget(
    storage,
    {} as any, // observationManager
    {} as any, // entityManager
    semanticSearch
  );

  // Override executeDelete to prevent actually doing anything
  (semanticForget as any).executeDelete = async () => ({ method: 'semantic', deletedObservations: [], deletedEntities: [] });

  console.log('Running benchmark...');
  const start = performance.now();

  // Run multiple times
  const ITERATIONS = 100;
  for (let i = 0; i < ITERATIONS; i++) {
    await (semanticForget as any).semanticFallback('test query that will use semantic search', {});
  }

  const end = performance.now();
  console.log(`Total time for ${ITERATIONS} iterations: ${(end - start).toFixed(2)}ms`);
  console.log(`Average time per iteration: ${((end - start) / ITERATIONS).toFixed(2)}ms`);
}

runBenchmark().catch(console.error);
