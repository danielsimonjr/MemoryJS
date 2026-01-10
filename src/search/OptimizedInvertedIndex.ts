/**
 * Optimized Inverted Index
 *
 * Memory-efficient inverted index using integer IDs and Uint32Array
 * for fast multi-term intersection queries.
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 *
 * @module search/OptimizedInvertedIndex
 */

/**
 * Statistics about memory usage.
 */
export interface IndexMemoryUsage {
  /** Total bytes used by posting lists */
  postingListBytes: number;
  /** Total bytes used by ID map */
  idMapBytes: number;
  /** Total bytes used by term index */
  termIndexBytes: number;
  /** Total estimated memory usage in bytes */
  totalBytes: number;
  /** Number of unique terms */
  termCount: number;
  /** Number of documents indexed */
  documentCount: number;
}

/**
 * Result from a posting list lookup.
 */
export interface PostingListResult {
  /** Term that was looked up */
  term: string;
  /** Document IDs containing the term (sorted) */
  docIds: Uint32Array;
}

/**
 * Optimized Inverted Index using integer document IDs.
 *
 * Memory Optimizations:
 * 1. Uses integer IDs instead of string entity names
 * 2. Stores posting lists as Uint32Array (4 bytes per ID vs ~20+ bytes per string)
 * 3. Maintains sorted posting lists for efficient intersection
 *
 * Performance Optimizations:
 * 1. Sorted array intersection is O(n+m) where n,m are posting list lengths
 * 2. Early termination when one list is exhausted
 * 3. Binary search available for unbalanced list sizes
 *
 * @example
 * ```typescript
 * const index = new OptimizedInvertedIndex();
 * index.addDocument('entity1', ['machine', 'learning', 'ai']);
 * index.addDocument('entity2', ['deep', 'learning', 'neural']);
 *
 * // Find documents containing both 'machine' AND 'learning'
 * const results = index.intersect(['machine', 'learning']);
 * console.log(results); // ['entity1']
 * ```
 */
export class OptimizedInvertedIndex {
  /** Map from entity name to integer ID */
  private entityToId: Map<string, number> = new Map();

  /** Map from integer ID to entity name */
  private idToEntity: Map<number, string> = new Map();

  /** Next available ID */
  private nextId: number = 0;

  /** Inverted index: term -> sorted array of document IDs */
  private postingLists: Map<string, Uint32Array> = new Map();

  /** Temporary posting lists (before finalization) */
  private tempPostingLists: Map<string, number[]> = new Map();

  /** Whether the index is finalized (posting lists converted to Uint32Array) */
  private finalized: boolean = false;

  /**
   * Add a document to the index.
   *
   * @param entityName - Unique document identifier
   * @param terms - Array of terms in the document (should be lowercase)
   */
  addDocument(entityName: string, terms: string[]): void {
    // Unfinalize if already finalized (allows incremental updates)
    if (this.finalized) {
      this.unfinalize();
    }

    // Get or assign document ID
    let docId = this.entityToId.get(entityName);
    if (docId === undefined) {
      docId = this.nextId++;
      this.entityToId.set(entityName, docId);
      this.idToEntity.set(docId, entityName);
    }

    // Add unique terms to posting lists
    const seenTerms = new Set<string>();
    for (const term of terms) {
      if (seenTerms.has(term)) continue;
      seenTerms.add(term);

      let postingList = this.tempPostingLists.get(term);
      if (!postingList) {
        postingList = [];
        this.tempPostingLists.set(term, postingList);
      }

      // Only add if not already present (maintains sorted order if added in order)
      if (postingList.length === 0 || postingList[postingList.length - 1] !== docId) {
        postingList.push(docId);
      }
    }
  }

  /**
   * Remove a document from the index.
   *
   * @param entityName - Document to remove
   * @returns True if document was found and removed
   */
  removeDocument(entityName: string): boolean {
    const docId = this.entityToId.get(entityName);
    if (docId === undefined) {
      return false;
    }

    // Unfinalize if needed
    if (this.finalized) {
      this.unfinalize();
    }

    // Remove from all posting lists
    for (const [term, postingList] of this.tempPostingLists) {
      const idx = postingList.indexOf(docId);
      if (idx !== -1) {
        postingList.splice(idx, 1);
        if (postingList.length === 0) {
          this.tempPostingLists.delete(term);
        }
      }
    }

    // Remove ID mappings
    this.entityToId.delete(entityName);
    this.idToEntity.delete(docId);

    return true;
  }

  /**
   * Finalize the index by converting posting lists to Uint32Array.
   *
   * This should be called after bulk indexing for optimal memory usage.
   * The index can still be updated after finalization, but it will
   * temporarily use more memory during updates.
   */
  finalize(): void {
    if (this.finalized) return;

    // Convert temp posting lists to Uint32Array and sort
    this.postingLists.clear();
    for (const [term, list] of this.tempPostingLists) {
      // Sort and convert to Uint32Array
      list.sort((a, b) => a - b);
      const arr = new Uint32Array(list);
      this.postingLists.set(term, arr);
    }

    // Clear temp posting lists to save memory
    this.tempPostingLists.clear();
    this.finalized = true;
  }

  /**
   * Convert finalized index back to mutable format.
   */
  private unfinalize(): void {
    if (!this.finalized) return;

    // Convert Uint32Array back to regular arrays
    this.tempPostingLists.clear();
    for (const [term, arr] of this.postingLists) {
      this.tempPostingLists.set(term, Array.from(arr));
    }

    this.postingLists.clear();
    this.finalized = false;
  }

  /**
   * Get posting list for a term.
   *
   * @param term - Term to look up
   * @returns Posting list result or null if term not found
   */
  getPostingList(term: string): PostingListResult | null {
    if (this.finalized) {
      const arr = this.postingLists.get(term);
      if (!arr) return null;
      return { term, docIds: arr };
    } else {
      const list = this.tempPostingLists.get(term);
      if (!list) return null;
      // Sort and return as Uint32Array
      const sorted = list.slice().sort((a, b) => a - b);
      return { term, docIds: new Uint32Array(sorted) };
    }
  }

  /**
   * Perform intersection of posting lists for multiple terms.
   *
   * Returns entity names that contain ALL specified terms.
   *
   * @param terms - Array of terms to intersect
   * @returns Array of entity names containing all terms
   */
  intersect(terms: string[]): string[] {
    if (terms.length === 0) {
      return [];
    }

    // Ensure finalized for optimal performance
    if (!this.finalized) {
      this.finalize();
    }

    // Get posting lists for all terms
    const postingLists: Uint32Array[] = [];
    for (const term of terms) {
      const list = this.postingLists.get(term);
      if (!list || list.length === 0) {
        // If any term has no posting list, intersection is empty
        return [];
      }
      postingLists.push(list);
    }

    // Sort by length (smallest first for early termination)
    postingLists.sort((a, b) => a.length - b.length);

    // Perform multi-way sorted intersection
    let result = postingLists[0];
    for (let i = 1; i < postingLists.length; i++) {
      result = this.intersectTwo(result, postingLists[i]);
      if (result.length === 0) {
        return [];
      }
    }

    // Convert IDs back to entity names
    return Array.from(result).map(id => this.idToEntity.get(id)!);
  }

  /**
   * Perform union of posting lists for multiple terms.
   *
   * Returns entity names that contain ANY of the specified terms.
   *
   * @param terms - Array of terms to union
   * @returns Array of entity names containing any term
   */
  union(terms: string[]): string[] {
    if (terms.length === 0) {
      return [];
    }

    // Ensure finalized for optimal performance
    if (!this.finalized) {
      this.finalize();
    }

    // Collect all unique document IDs
    const allIds = new Set<number>();
    for (const term of terms) {
      const list = this.postingLists.get(term);
      if (list) {
        for (const id of list) {
          allIds.add(id);
        }
      }
    }

    // Convert IDs back to entity names
    return Array.from(allIds).map(id => this.idToEntity.get(id)!);
  }

  /**
   * Get entities containing a single term.
   *
   * @param term - Term to search for
   * @returns Array of entity names containing the term
   */
  search(term: string): string[] {
    if (!this.finalized) {
      const list = this.tempPostingLists.get(term);
      if (!list) return [];
      return list.map(id => this.idToEntity.get(id)!);
    }

    const list = this.postingLists.get(term);
    if (!list) return [];
    return Array.from(list).map(id => this.idToEntity.get(id)!);
  }

  /**
   * Intersect two sorted Uint32Arrays.
   *
   * Uses merge-style intersection which is O(n+m).
   */
  private intersectTwo(a: Uint32Array, b: Uint32Array): Uint32Array {
    const result: number[] = [];
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        result.push(a[i]);
        i++;
        j++;
      } else if (a[i] < b[j]) {
        i++;
      } else {
        j++;
      }
    }

    return new Uint32Array(result);
  }

  /**
   * Get memory usage statistics.
   */
  getMemoryUsage(): IndexMemoryUsage {
    let postingListBytes = 0;
    let termCount = 0;

    if (this.finalized) {
      for (const arr of this.postingLists.values()) {
        // Uint32Array uses 4 bytes per element
        postingListBytes += arr.byteLength;
        termCount++;
      }
    } else {
      for (const list of this.tempPostingLists.values()) {
        // Regular array uses 8 bytes per element (64-bit numbers in V8)
        // Plus array overhead
        postingListBytes += list.length * 8 + 32; // Approximate overhead
        termCount++;
      }
    }

    // Estimate ID map overhead
    // Map has ~100 bytes overhead + ~50 bytes per entry for string keys
    const idMapBytes =
      100 +
      this.entityToId.size * 50 +
      this.idToEntity.size * 8; // number key is ~8 bytes

    // Estimate term index overhead
    // ~50 bytes per term entry (key + pointer)
    const termIndexBytes = termCount * 50;

    return {
      postingListBytes,
      idMapBytes,
      termIndexBytes,
      totalBytes: postingListBytes + idMapBytes + termIndexBytes,
      termCount,
      documentCount: this.entityToId.size,
    };
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.entityToId.clear();
    this.idToEntity.clear();
    this.postingLists.clear();
    this.tempPostingLists.clear();
    this.nextId = 0;
    this.finalized = false;
  }

  /**
   * Get the number of documents in the index.
   */
  get documentCount(): number {
    return this.entityToId.size;
  }

  /**
   * Get the number of unique terms in the index.
   */
  get termCount(): number {
    return this.finalized
      ? this.postingLists.size
      : this.tempPostingLists.size;
  }

  /**
   * Check if an entity is indexed.
   */
  hasDocument(entityName: string): boolean {
    return this.entityToId.has(entityName);
  }

  /**
   * Check if a term exists in the index.
   */
  hasTerm(term: string): boolean {
    return this.finalized
      ? this.postingLists.has(term)
      : this.tempPostingLists.has(term);
  }
}
