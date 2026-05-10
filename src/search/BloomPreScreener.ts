/**
 * Bloom Pre-Screener
 *
 * Three Bloom filters keyed by (entity-name terms, type, tags). Before
 * running an expensive search (fuzzy / semantic), the screener returns
 * a candidate list — entities whose filters indicate every query term
 * MIGHT be present. Entities whose filters definitively miss a query
 * term are skipped without a downstream scan.
 *
 * The screener is lazy — `build()` populates the filters from the
 * current graph; `intersectCandidates(query)` returns the candidate
 * names. Re-build after large mutations.
 *
 * @module search/BloomPreScreener
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import { BloomFilter } from './BloomFilter.js';

/** Pre-screen options. */
export interface BloomPreScreenerOptions {
  /** Expected entity count for filter sizing (default: 10_000). */
  capacity?: number;
  /** Target false-positive rate (default: 0.01). */
  falsePositiveRate?: number;
  /** Skip terms shorter than this when querying (default: 3). */
  minQueryTerm?: number;
}

/** A per-entity bloom filter triple. */
interface EntityBloom {
  name: string;
  /** Lowercase tokens drawn from name + observations. */
  terms: BloomFilter;
}

/**
 * Pre-screener that maintains a per-entity term filter plus per-type
 * and per-tag global filters. The intent is to make `mayContainQuery`
 * cheap enough to call before any fuzzy or semantic search.
 */
export class BloomPreScreener {
  private readonly capacity: number;
  private readonly fpr: number;
  private readonly minQueryTerm: number;

  private entities: EntityBloom[] = [];
  private typeFilter: BloomFilter | null = null;
  private tagFilter: BloomFilter | null = null;

  constructor(private storage: GraphStorage, options: BloomPreScreenerOptions = {}) {
    this.capacity = options.capacity ?? 10_000;
    this.fpr = options.falsePositiveRate ?? 0.01;
    this.minQueryTerm = options.minQueryTerm ?? 3;
  }

  /** Whether `build()` has been called. */
  isBuilt(): boolean {
    return this.entities.length > 0 || this.typeFilter !== null;
  }

  /**
   * Materialise filters against the current graph. Cost is O(n * k)
   * where n = entity count and k = average tokens per entity. Cheap
   * relative to running fuzzy/semantic on every query.
   */
  async build(): Promise<void> {
    const graph = await this.storage.loadGraph();

    this.typeFilter = new BloomFilter(this.capacity, this.fpr);
    this.tagFilter = new BloomFilter(this.capacity, this.fpr);
    this.entities = [];

    for (const entity of graph.entities) {
      this.typeFilter.add(entity.entityType.toLowerCase());
      for (const tag of entity.tags ?? []) this.tagFilter.add(tag.toLowerCase());

      // Pre-tokenise so we can size the per-entity filter against the
      // actual token count. A fixed 64-capacity filter would saturate
      // (FPR → ~100%) for entities with long observations.
      const tokens = new Set<string>();
      for (const tok of tokenize(entity.name)) tokens.add(tok);
      for (const obs of entity.observations) {
        for (const tok of tokenize(obs)) tokens.add(tok);
      }
      const capacity = Math.max(64, tokens.size * 2);
      const terms = new BloomFilter(capacity, this.fpr);
      for (const tok of tokens) terms.add(tok);
      this.entities.push({ name: entity.name, terms });
    }
  }

  /**
   * Return the candidate entity names whose per-entity filter says all
   * query terms MIGHT be present. Throws if `build()` hasn't run yet.
   */
  intersectCandidates(query: string): string[] {
    if (this.entities.length === 0) {
      throw new Error('BloomPreScreener.build() must run before intersectCandidates()');
    }

    const queryTerms = tokenize(query).filter((t) => t.length >= this.minQueryTerm);
    if (queryTerms.length === 0) {
      // No usable terms — return every name. The caller will scan
      // everything, exactly as it would without a screener.
      return this.entities.map((e) => e.name);
    }

    const out: string[] = [];
    for (const entry of this.entities) {
      let allPresent = true;
      for (const term of queryTerms) {
        if (!entry.terms.mayContain(term)) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) out.push(entry.name);
    }
    return out;
  }

  /** Test whether a type appears in the global type filter. */
  mayHaveType(entityType: string): boolean {
    return this.typeFilter ? this.typeFilter.mayContain(entityType.toLowerCase()) : true;
  }

  /** Test whether a tag appears in the global tag filter. */
  mayHaveTag(tag: string): boolean {
    return this.tagFilter ? this.tagFilter.mayContain(tag.toLowerCase()) : true;
  }

  /** Drop every filter; next query throws unless `build()` runs again. */
  clear(): void {
    this.entities = [];
    this.typeFilter = null;
    this.tagFilter = null;
  }

  /** Internal-state snapshot for diagnostics and tests. */
  snapshot(): {
    entityCount: number;
    typeFilterParams: ReturnType<BloomFilter['parameters']> | null;
    tagFilterParams: ReturnType<BloomFilter['parameters']> | null;
  } {
    return {
      entityCount: this.entities.length,
      typeFilterParams: this.typeFilter?.parameters() ?? null,
      tagFilterParams: this.tagFilter?.parameters() ?? null,
    };
  }
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}
