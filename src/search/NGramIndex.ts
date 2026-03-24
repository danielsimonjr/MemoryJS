/**
 * N-gram Index
 *
 * Deterministic n-gram hashing index for fast candidate pre-filtering
 * before expensive Levenshtein distance computation. Uses Jaccard similarity
 * over n-gram sets to score document relevance.
 *
 * All state is in-memory only; it is rebuilt from entities on startup.
 *
 * @module search/NGramIndex
 */

/**
 * Statistics for the NGramIndex.
 */
export interface NGramIndexStats {
  /** Number of documents currently indexed */
  totalDocuments: number;
  /** Total number of unique n-grams stored across all documents */
  totalNgrams: number;
  /** Average number of n-grams per document */
  averageNgramsPerDoc: number;
}

/**
 * In-memory n-gram index for approximate string matching.
 *
 * Implements a trigram (default) index that maps n-gram hashes to sets of
 * document IDs. Given a query string it computes the Jaccard similarity
 * between the query n-gram set and each candidate's n-gram set, returning
 * document IDs that meet or exceed the threshold.
 *
 * Performance characteristics:
 * - `addDocument`: O(|text| * n) per document
 * - `query`: O(Q + C * U) where Q = |query n-grams|, C = candidate count,
 *   U = average n-grams per candidate document
 * - `remove`: O(T) where T = total n-grams in the removed document
 *
 * @example
 * ```typescript
 * const idx = new NGramIndex(3);
 * idx.addDocument('doc1', 'hello world');
 * idx.addDocument('doc2', 'hello earth');
 *
 * const hits = idx.query('hello world', 0.3); // ['doc1', 'doc2']
 * ```
 */
export class NGramIndex {
  /** Size of each n-gram window (default: 3 for trigrams). */
  private readonly n: number;

  /**
   * Inverted index: n-gram string → Set of document IDs that contain it.
   * Using string n-grams (not numeric hashes) preserves simplicity and
   * correctness while still being fast for typical vocabulary sizes.
   */
  private ngramToDocIds: Map<string, Set<string>> = new Map();

  /**
   * Forward index: document ID → Set of n-grams for that document.
   * Needed for Jaccard computation and efficient removal.
   */
  private docToNgrams: Map<string, Set<string>> = new Map();

  /**
   * Create a new NGramIndex.
   *
   * @param n - Size of each n-gram window (default: 3 for trigrams).
   *            Must be a positive integer. Documents shorter than `n`
   *            characters are still indexed using a single n-gram equal
   *            to the padded/raw text.
   */
  constructor(n: number = 3) {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError(`n must be a positive integer, got ${n}`);
    }
    this.n = n;
  }

  // ==================== Public API ====================

  /**
   * Add a document to the index.
   *
   * Tokenises `text` into n-grams and stores the mappings. If a document
   * with the same `id` already exists it is replaced (remove + re-add).
   *
   * @param id   - Unique document identifier (e.g. entity name).
   * @param text - Raw text to index. Will be lowercased internally.
   */
  addDocument(id: string, text: string): void {
    // Replace existing entry if present
    if (this.docToNgrams.has(id)) {
      this.removeFromInvertedIndex(id);
    }

    const ngrams = this.generateNgrams(text);
    const ngramSet = new Set(ngrams);

    // Store forward mapping
    this.docToNgrams.set(id, ngramSet);

    // Update inverted index
    for (const ng of ngramSet) {
      let docs = this.ngramToDocIds.get(ng);
      if (!docs) {
        docs = new Set<string>();
        this.ngramToDocIds.set(ng, docs);
      }
      docs.add(id);
    }
  }

  /**
   * Query the index for documents similar to `text`.
   *
   * Computes Jaccard similarity between the query n-gram set and each
   * candidate document's n-gram set. Only candidates that share at least
   * one n-gram with the query are considered (others have Jaccard = 0).
   *
   * @param text      - Query string. Will be lowercased internally.
   * @param threshold - Minimum Jaccard similarity to include in results
   *                    (0.0–1.0, default: 0.2).
   * @returns Sorted array of document IDs with Jaccard similarity ≥ threshold,
   *          ordered by similarity descending.
   */
  query(text: string, threshold: number = 0.2): string[] {
    if (this.docToNgrams.size === 0) {
      return [];
    }

    const queryNgrams = this.generateNgrams(text);
    if (queryNgrams.length === 0) {
      return [];
    }

    const querySet = new Set(queryNgrams);

    // Collect candidate documents — those sharing at least one n-gram
    const candidateCounts = new Map<string, number>(); // docId → intersection count
    for (const ng of querySet) {
      const docs = this.ngramToDocIds.get(ng);
      if (docs) {
        for (const docId of docs) {
          candidateCounts.set(docId, (candidateCounts.get(docId) ?? 0) + 1);
        }
      }
    }

    if (candidateCounts.size === 0) {
      return [];
    }

    // Score each candidate using Jaccard similarity
    const scored: Array<{ id: string; score: number }> = [];

    for (const [docId, intersectionCount] of candidateCounts) {
      const docNgrams = this.docToNgrams.get(docId)!;
      // |union| = |A| + |B| - |intersection|
      const unionSize = querySet.size + docNgrams.size - intersectionCount;
      const jaccard = unionSize === 0 ? 0 : intersectionCount / unionSize;

      if (jaccard >= threshold) {
        scored.push({ id: docId, score: jaccard });
      }
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.map(s => s.id);
  }

  /**
   * Remove a document from the index.
   *
   * No-op if the document does not exist.
   *
   * @param id - Document identifier to remove.
   */
  remove(id: string): void {
    if (!this.docToNgrams.has(id)) return;
    this.removeFromInvertedIndex(id);
    this.docToNgrams.delete(id);
  }

  /**
   * Clear all documents from the index.
   */
  clear(): void {
    this.ngramToDocIds.clear();
    this.docToNgrams.clear();
  }

  /**
   * Return statistics about the current state of the index.
   */
  stats(): NGramIndexStats {
    const totalDocuments = this.docToNgrams.size;
    const totalNgrams = this.ngramToDocIds.size;
    const totalNgramsAcrossDocs = Array.from(this.docToNgrams.values()).reduce(
      (acc, s) => acc + s.size,
      0
    );
    const averageNgramsPerDoc = totalDocuments === 0 ? 0 : totalNgramsAcrossDocs / totalDocuments;

    return { totalDocuments, totalNgrams, averageNgramsPerDoc };
  }

  // ==================== Internal helpers ====================

  /**
   * Generate all n-grams for `text` using a sliding window.
   *
   * The text is lowercased and leading/trailing whitespace is trimmed before
   * tokenisation. For strings shorter than `n` characters the entire
   * (trimmed, lowercased) string is returned as a single n-gram so that
   * short strings are still indexable.
   *
   * The implementation is Unicode-aware: it iterates over Unicode code points
   * via `Array.from()` rather than raw UTF-16 code units so that emoji and
   * multi-byte characters are handled correctly.
   *
   * @param text - Raw input string.
   * @returns Array of n-gram strings (may contain duplicates for repeated substrings).
   */
  generateNgrams(text: string): string[] {
    // Normalise: lowercase + collapse whitespace runs to single space
    const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalised.length === 0) {
      return [];
    }

    // Use Array.from for correct Unicode code-point iteration
    const chars = Array.from(normalised);

    if (chars.length < this.n) {
      // Strings shorter than n: return the whole string as one "n-gram"
      return [normalised];
    }

    const ngrams: string[] = [];
    for (let i = 0; i <= chars.length - this.n; i++) {
      ngrams.push(chars.slice(i, i + this.n).join(''));
    }

    return ngrams;
  }

  /**
   * Remove a document from the inverted index only (not from docToNgrams).
   * Called by both `remove()` and `addDocument()` when replacing.
   */
  private removeFromInvertedIndex(id: string): void {
    const ngrams = this.docToNgrams.get(id);
    if (!ngrams) return;

    for (const ng of ngrams) {
      const docs = this.ngramToDocIds.get(ng);
      if (docs) {
        docs.delete(id);
        // Clean up empty posting sets to avoid memory leaks
        if (docs.size === 0) {
          this.ngramToDocIds.delete(ng);
        }
      }
    }
  }
}
