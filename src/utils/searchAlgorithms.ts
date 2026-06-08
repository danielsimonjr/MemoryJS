/**
 * Search Algorithms
 *
 * Algorithms for search operations: Levenshtein distance for fuzzy matching
 * and TF-IDF for relevance scoring.
 *
 * @module utils/searchAlgorithms
 */

// ==================== Levenshtein Distance ====================

/**
 * Calculate Levenshtein distance between two strings.
 *
 * Returns the minimum number of single-character edits needed to change
 * one word into another.
 *
 * **Algorithm**: Space-optimized dynamic programming using only two rows.
 * Time complexity: O(m*n), Space complexity: O(min(m,n)).
 *
 * This optimization reduces memory usage from O(m*n) to O(min(m,n)) by
 * observing that each row only depends on the previous row.
 *
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns Minimum number of edits required (0 = identical strings)
 *
 * @example
 * ```typescript
 * levenshteinDistance("kitten", "sitting"); // Returns 3
 * levenshteinDistance("hello", "hello");    // Returns 0
 * levenshteinDistance("abc", "");           // Returns 3
 * ```
 */
export function levenshteinDistance(str1: string, str2: string): number {
  // Ensure str1 is the shorter string for optimal space usage
  if (str1.length > str2.length) {
    [str1, str2] = [str2, str1];
  }

  const m = str1.length;
  const n = str2.length;

  // Use two rows instead of full matrix - O(min(m,n)) space
  let prev: number[] = Array.from({ length: m + 1 }, (_, i) => i);
  let curr: number[] = new Array(m + 1);

  for (let j = 1; j <= n; j++) {
    curr[0] = j; // Distance from empty string

    for (let i = 1; i <= m; i++) {
      if (str1[i - 1] === str2[j - 1]) {
        // Characters match, no edit needed
        curr[i] = prev[i - 1];
      } else {
        // Take minimum of three operations
        curr[i] = 1 + Math.min(
          prev[i - 1],  // substitution
          prev[i],      // deletion
          curr[i - 1]   // insertion
        );
      }
    }

    // Swap rows for next iteration
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}

// ==================== TF-IDF ====================

/**
 * Calculate Term Frequency (TF) for a term in a document.
 *
 * TF = (Number of times term appears in document) / (Total terms in document)
 *
 * @param term - The search term
 * @param document - The document text
 * @returns Term frequency (0.0 to 1.0)
 */
export function calculateTF(term: string, document: string): number {
  const termLower = term.toLowerCase();
  const tokens = tokenize(document);

  if (tokens.length === 0) return 0;

  const termCount = tokens.filter(t => t === termLower).length;
  return termCount / tokens.length;
}

/**
 * Calculate Inverse Document Frequency (IDF) for a term across documents.
 *
 * IDF = log(Total documents / Documents containing term)
 *
 * Note: For bulk IDF calculation, prefer calculateIDFFromTokenSets which
 * avoids re-tokenizing documents for each term.
 *
 * @param term - The search term
 * @param documents - Array of document texts
 * @returns Inverse document frequency
 */
export function calculateIDF(term: string, documents: string[]): number {
  if (documents.length === 0) return 0;

  const termLower = term.toLowerCase();
  const docsWithTerm = documents.filter(doc =>
    tokenize(doc).includes(termLower)
  ).length;

  if (docsWithTerm === 0) return 0;

  return Math.log(documents.length / docsWithTerm);
}

/**
 * Calculate Inverse Document Frequency (IDF) from pre-tokenized documents.
 *
 * IDF = log(Total documents / Documents containing term)
 *
 * **Optimized**: Avoids re-tokenizing documents for each term. Pre-tokenize
 * documents once and convert to Sets for O(1) lookup per document.
 *
 * @param term - The search term (should already be lowercase)
 * @param tokenSets - Array of Sets, each containing unique tokens for a document
 * @returns Inverse document frequency
 *
 * @example
 * ```typescript
 * const docs = ["hello world", "hello there"];
 * const tokenSets = docs.map(d => new Set(tokenize(d)));
 * calculateIDFFromTokenSets("hello", tokenSets); // Low IDF (common term)
 * calculateIDFFromTokenSets("world", tokenSets); // Higher IDF (less common)
 * ```
 */
export function calculateIDFFromTokenSets(term: string, tokenSets: Set<string>[]): number {
  if (tokenSets.length === 0) return 0;

  const termLower = term.toLowerCase();
  let docsWithTerm = 0;

  for (const tokenSet of tokenSets) {
    if (tokenSet.has(termLower)) {
      docsWithTerm++;
    }
  }

  if (docsWithTerm === 0) return 0;

  return Math.log(tokenSets.length / docsWithTerm);
}

/**
 * Calculate TF-IDF score for a term in a document.
 *
 * TF-IDF = TF * IDF
 *
 * Higher scores indicate more important/relevant terms.
 *
 * @param term - The search term
 * @param document - The document text
 * @param documents - Array of all documents
 * @returns TF-IDF score
 */
export function calculateTFIDF(
  term: string,
  document: string,
  documents: string[]
): number {
  const tf = calculateTF(term, document);
  const idf = calculateIDF(term, documents);
  return tf * idf;
}

/**
 * Tokenize text into lowercase words.
 *
 * Splits on whitespace and removes punctuation.
 *
 * @param text - Text to tokenize
 * @returns Array of lowercase tokens
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0);
}
