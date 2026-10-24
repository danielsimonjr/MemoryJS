/**
 * Full-text candidate lookup shared by the BM25 and ranked search paths.
 *
 * @module search/ftsCandidates
 */

import type { IGraphStorage } from '../types/index.js';

/**
 * An object that holds the graph storage in its `storage` field.
 *
 * A search class runs the lookup with itself as this object.
 */
export interface FtsOwner {
  /** Graph storage that may expose `fullTextSearch`. */
  readonly storage: IGraphStorage;
}

/**
 * Retrieve candidate entity names from the storage full-text index.
 *
 * The function reads `this.storage` at each step, so an error names `this.storage`.
 * It returns null when the storage has no `fullTextSearch` method.
 * It returns an empty Set when the index has no match.
 * It waits until the storage has loaded.
 * The limit is the larger of `corpusSize` and one.
 * When `rank` is false, the options carry `rank: false` and the storage returns names only.
 *
 * @param query - Search query text
 * @param corpusSize - Number of entities in the corpus
 * @param rank - True lets the storage rank the matches. False asks for names only.
 * @returns Set of candidate entity names, or null when full-text search is unavailable
 */
export async function getFtsCandidateNames(
  this: FtsOwner,
  query: string,
  corpusSize: number,
  rank: boolean,
): Promise<Set<string> | null> {
  if (!this.storage.fullTextSearch) return null;
  await this.storage.ensureLoaded();
  // Retrieve every FTS match so tag/importance post-filtering cannot
  // hide a lower-ranked but eligible candidate.
  const matches = await this.storage.fullTextSearch(query, {
    limit: Math.max(corpusSize, 1),
    ...(rank ? {} : { rank: false }),
  });
  return new Set(matches.map(match => match.name));
}
