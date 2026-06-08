/**
 * Text Similarity Utilities
 *
 * Standalone text similarity computation using TF-IDF cosine similarity.
 * Extracted from SummarizationService for reuse across the codebase.
 *
 * @module utils/textSimilarity
 */

/**
 * Tokenize text into lowercase alphanumeric words.
 *
 * @param text - Input text to tokenize
 * @returns Array of lowercase tokens
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Tokenize text into a set of lowercase alphanumeric words, optionally filtering by minimum length.
 *
 * @param text - Input text to tokenize
 * @param minLength - Minimum length of tokens to include (default: 1)
 * @returns Set of lowercase tokens
 */
export function tokenizeToSet(text: string, minLength: number = 1): Set<string> {
  return new Set(tokenize(text).filter((t) => t.length >= minLength));
}

/**
 * Tokenize text into lowercase alphanumeric words, splitting on all non-alphanumeric characters.
 *
 * @param s - Input text to tokenize
 * @returns Array of lowercase tokens
 */
export function tokenizeAlphanumeric(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/**
 * Build a term frequency vector from tokens.
 *
 * @param tokens - Array of tokens
 * @param vocab - Vocabulary set to build the vector against
 * @returns Array of term frequencies aligned with vocab ordering
 */
export function buildTFVector(tokens: string[], vocab: Set<string>): number[] {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return Array.from(vocab).map((t) => freq.get(t) ?? 0);
}

/**
 * Calculate cosine similarity between two numeric vectors.
 *
 * @param vec1 - First vector
 * @param vec2 - Second vector
 * @returns Cosine similarity score (0-1)
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Calculate text similarity between two strings using TF-IDF cosine similarity.
 *
 * @param text1 - First text
 * @param text2 - Second text
 * @returns Similarity score (0-1)
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0;
  }

  // Build vocabulary from both texts
  const allTokens = new Set([...tokens1, ...tokens2]);

  // Build term frequency vectors
  const vec1 = buildTFVector(tokens1, allTokens);
  const vec2 = buildTFVector(tokens2, allTokens);

  // Calculate cosine similarity
  return cosineSimilarity(vec1, vec2);
}

/**
 * Calculate Jaccard similarity between two sets of strings.
 *
 * Jaccard similarity is defined as the size of the intersection divided by
 * the size of the union of the two sets.
 *
 * @param a - First set of strings
 * @param b - Second set of strings
 * @returns Jaccard similarity score (0-1)
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}
