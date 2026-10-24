/**
 * Full-text candidate lookup shared by the BM25 and ranked search paths.
 *
 * @module search/ftsCandidates
 */

import type { IGraphStorage } from '../types/index.js';

/**
 * Retrieve candidate entity names from the storage full-text index.
 *
 * A null result means the storage has no full-text capability. An empty Set
 * is a valid indexed no-match result.
 *
 * @param storage - Graph storage that may expose `fullTextSearch`
 * @param query - Search query text
 * @param corpusSize - Number of entities in the corpus. The limit is this value, at least 1.
 * @param rank - True lets the storage rank matches. False asks for names only.
 * @returns Set of candidate entity names, or null when full-text search is unavailable
 */
export async function getFtsCandidateNames(
  storage: IGraphStorage,
  query: string,
  corpusSize: number,
  rank: boolean,
): Promise<Set<string> | null> {
  if (!storage.fullTextSearch) return null;
  await storage.ensureLoaded();
  // Retrieve every FTS match so tag/importance post-filtering cannot
  // hide a lower-ranked but eligible candidate.
  const limit = Math.max(corpusSize, 1);
  const matches = await storage.fullTextSearch(query, rank ? { limit } : { limit, rank: false });
  return new Set(matches.map(match => match.name));
}
