/**
 * TF-IDF Index Manager
 *
 * Manages pre-calculated TF-IDF indexes for fast ranked search.
 * Handles index building, incremental updates, and persistence.
 *
 * @module search/TFIDFIndexManager
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TFIDFIndex, DocumentVector, KnowledgeGraph, ReadonlyKnowledgeGraph } from '../types/index.js';
import { tokenize } from '../utils/index.js';
import type { IIndexHealth, IndexHealthSnapshot } from '../utils/IIndexHealth.js';

const INDEX_VERSION = '1.0';
const INDEX_FILENAME = 'tfidf-index.json';

/**
 * Serializable version of TFIDFIndex for JSON storage.
 */
interface SerializedTFIDFIndex {
  version: string;
  lastUpdated: string;
  documents: Array<[string, DocumentVector]>;
  idf: Array<[string, number]>;
  documentFrequency?: Array<[string, number]>;
}

/**
 * Manages TF-IDF index lifecycle: building, updating, and persistence.
 */
export class TFIDFIndexManager implements IIndexHealth {
  private indexPath: string;
  private index: TFIDFIndex | undefined = undefined;
  /** Number of indexed documents containing each term. */
  private documentFrequency: Map<string, number> = new Map();

  /**
   * S5: deferred-IDF batching. While > 0, the incremental document methods
   * (`addDocument` / `removeDocument` / `updateDocument`) skip their IDF
   * recalculation and set {@link deferredIdfDirty} instead; a single
   * vocabulary-sized `recalculateAllIDF()` runs when the outermost
   * {@link endIdfBatch} closes. Nesting-safe (depth counter).
   */
  private idfBatchDepth = 0;
  /** True when at least one batched op skipped an IDF recalculation. */
  private deferredIdfDirty = false;

  constructor(storageDir: string) {
    this.indexPath = path.join(storageDir, '.indexes', INDEX_FILENAME);
  }

  /**
   * S5: open a deferred-IDF batch. Incremental document mutations made
   * before the matching {@link endIdfBatch} update term frequencies
   * and document frequencies immediately but defer the O(vocabulary) IDF
   * recalculation, so a batch of B mutations pays for exactly one IDF pass.
   * Always pair with `endIdfBatch()` in a try/finally.
   *
   * The public single-document methods keep their immediate-recalculation
   * behavior when no batch is open.
   */
  beginIdfBatch(): void {
    this.idfBatchDepth++;
  }

  /**
   * S5: close a deferred-IDF batch. When the outermost batch closes and any
   * batched mutation deferred an IDF recalculation, a single full
   * `recalculateAllIDF()` runs. A full recalculation is a superset of the
   * per-term recalculation `updateDocument` would have done — IDF is
   * `log(N/df)`, a pure function of the final document set — so batched
   * results are identical to sequential unbatched calls.
   */
  endIdfBatch(): void {
    if (this.idfBatchDepth === 0) {
      return;
    }
    this.idfBatchDepth--;
    if (this.idfBatchDepth === 0 && this.deferredIdfDirty) {
      this.deferredIdfDirty = false;
      this.recalculateAllIDF();
    }
  }

  /**
   * Whether a deferred-IDF batch is currently open.
   * @internal exposed for tests
   */
  isIdfBatchOpen(): boolean {
    return this.idfBatchDepth > 0;
  }

  /**
   * Build a complete TF-IDF index from a knowledge graph.
   *
   * @param graph - Knowledge graph to index
   * @returns Newly built TF-IDF index
   */
  async buildIndex(graph: ReadonlyKnowledgeGraph): Promise<TFIDFIndex> {
    const documents = new Map<string, DocumentVector>();
    const documentFrequency = new Map<string, number>();

    // Build document vectors - tokenize once per document
    for (const entity of graph.entities) {
      const documentText = [
        entity.name,
        entity.entityType,
        ...entity.observations,
      ].join(' ');

      const tokens = tokenize(documentText);
      const tokenSet = new Set(tokens);
      for (const term of tokenSet) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }

      // Calculate term frequencies
      const termFreq: Record<string, number> = {};
      for (const term of tokens) {
        termFreq[term] = (termFreq[term] || 0) + 1;
      }

      documents.set(entity.name, {
        entityName: entity.name,
        terms: termFreq,
        documentText,
      });
    }

    // Derive IDF directly from the incrementally maintained document
    // frequencies instead of rescanning every document for every term.
    const idf = new Map<string, number>();
    const totalDocs = documents.size;
    for (const [term, docCount] of documentFrequency) {
      idf.set(term, Math.log(totalDocs / docCount));
    }
    this.documentFrequency = documentFrequency;

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents,
      idf,
    };

    return this.index;
  }

  /**
   * Update the index incrementally when entities change.
   *
   * More efficient than rebuilding the entire index.
   *
   * @param graph - Updated knowledge graph
   * @param changedEntityNames - Names of entities that changed
   */
  async updateIndex(graph: ReadonlyKnowledgeGraph, changedEntityNames: Set<string>): Promise<TFIDFIndex> {
    if (!this.index) {
      // No existing index, build from scratch
      return this.buildIndex(graph);
    }

    const updatedDocuments = new Map(this.index.documents);
    const changedEntities = new Map<string, (typeof graph.entities)[number]>();
    for (const entity of graph.entities) {
      if (changedEntityNames.has(entity.name)) {
        changedEntities.set(entity.name, entity);
      }
    }

    for (const entityName of changedEntityNames) {
      const oldDocument = updatedDocuments.get(entityName);
      if (oldDocument) this.decrementDocumentFrequency(oldDocument);

      const entity = changedEntities.get(entityName);
      if (entity) {
        const document = this.buildDocumentVector(entity);
        updatedDocuments.set(entityName, document);
        this.incrementDocumentFrequency(document);
      } else {
        updatedDocuments.delete(entityName);
      }
    }

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents: updatedDocuments,
      idf: this.index.idf,
    };
    this.recalculateAllIDF();

    return this.index;
  }

  /**
   * Load index from disk.
   *
   * @returns Loaded index or undefined if not found
   */
  async loadIndex(): Promise<TFIDFIndex | undefined> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const serialized: SerializedTFIDFIndex = JSON.parse(data);

      this.index = {
        version: serialized.version,
        lastUpdated: serialized.lastUpdated,
        documents: new Map(serialized.documents),
        idf: new Map(serialized.idf),
      };
      this.documentFrequency =
        serialized.documentFrequency && (
          serialized.documentFrequency.length > 0 || this.index.documents.size === 0
        )
          ? new Map(serialized.documentFrequency)
          : this.calculateDocumentFrequency(this.index.documents);

      return this.index;
    } catch (error) {
      // Index doesn't exist or is invalid
      return undefined;
    }
  }

  /**
   * Save index to disk.
   *
   * @param index - Index to save (uses cached index if not provided)
   */
  async saveIndex(index?: TFIDFIndex): Promise<void> {
    const indexToSave = index || this.index;
    if (!indexToSave) {
      throw new Error('No index to save');
    }

    // Ensure index directory exists
    const indexDir = path.dirname(this.indexPath);
    await fs.mkdir(indexDir, { recursive: true });

    // Serialize Map objects to arrays for JSON
    const frequencies = indexToSave === this.index
      ? this.documentFrequency
      : this.calculateDocumentFrequency(indexToSave.documents);
    const serialized: SerializedTFIDFIndex = {
      version: indexToSave.version,
      lastUpdated: indexToSave.lastUpdated,
      documents: Array.from(indexToSave.documents.entries()),
      idf: Array.from(indexToSave.idf.entries()),
      documentFrequency: Array.from(frequencies.entries()),
    };

    await fs.writeFile(this.indexPath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  /**
   * Get the current cached index.
   *
   * @returns Cached index or undefined if not loaded
   */
  getIndex(): TFIDFIndex | undefined {
    return this.index;
  }

  /**
   * Clear the cached index and delete from disk.
   */
  async clearIndex(): Promise<void> {
    this.index = undefined;
    this.documentFrequency.clear();
    try {
      await fs.unlink(this.indexPath);
    } catch {
      // Index file doesn't exist, nothing to delete
    }
  }

  /**
   * Check if the index needs rebuilding based on graph state.
   *
   * @param graph - Current knowledge graph
   * @returns True if index should be rebuilt
   */
  needsRebuild(graph: KnowledgeGraph): boolean {
    if (!this.index) {
      return true;
    }

    // Check if entity count matches
    if (this.index.documents.size !== graph.entities.length) {
      return true;
    }

    // Check if all entities are in index
    for (const entity of graph.entities) {
      if (!this.index.documents.has(entity.name)) {
        return true;
      }
    }

    return false;
  }

  // ==================== Phase 10 Sprint 3: Incremental Index Updates ====================

  /**
   * Phase 10 Sprint 3: Add a single document to the index incrementally.
   *
   * More efficient than rebuilding the entire index for single entity additions.
   * Updates TF for the new document and recalculates IDF for affected terms.
   *
   * @param entity - The entity to add
   *
   * @example
   * ```typescript
   * const indexManager = new TFIDFIndexManager('/data');
   * await indexManager.loadIndex();
   *
   * // Add new entity
   * indexManager.addDocument({
   *   name: 'NewEntity',
   *   entityType: 'person',
   *   observations: ['Software engineer']
   * });
   * ```
   */
  addDocument(entity: { name: string; entityType: string; observations: string[] }): void {
    if (!this.index) {
      // Can't add to non-existent index
      return;
    }

    const oldDocument = this.index.documents.get(entity.name);
    if (oldDocument) this.decrementDocumentFrequency(oldDocument);
    const document = this.buildDocumentVector(entity);
    this.index.documents.set(entity.name, document);
    this.incrementDocumentFrequency(document);

    // Update IDF for ALL terms because N changed (total document count)
    // IDF = log(N/df), and N has increased. Deferred to a single pass at
    // endIdfBatch() when a batch is open (S5).
    if (this.idfBatchDepth > 0) {
      this.deferredIdfDirty = true;
    } else if (oldDocument) {
      this.recalculateIDFForTerms(
        new Set([...Object.keys(oldDocument.terms), ...Object.keys(document.terms)]),
      );
    } else {
      this.recalculateAllIDF();
    }

    // Update timestamp
    this.index.lastUpdated = new Date().toISOString();
  }

  /**
   * Phase 10 Sprint 3: Remove a single document from the index incrementally.
   *
   * More efficient than rebuilding the entire index for single entity deletions.
   * Recalculates IDF for terms that were in the removed document.
   *
   * @param entityName - Name of the entity to remove
   *
   * @example
   * ```typescript
   * indexManager.removeDocument('DeletedEntity');
   * ```
   */
  removeDocument(entityName: string): void {
    if (!this.index) {
      return;
    }

    const document = this.index.documents.get(entityName);
    if (!document) {
      return;
    }

    // Remove from documents map
    this.index.documents.delete(entityName);
    this.decrementDocumentFrequency(document);

    // Update IDF for ALL terms because N changed (total document count)
    // IDF = log(N/df), and N has decreased. Deferred to a single pass at
    // endIdfBatch() when a batch is open (S5).
    if (this.idfBatchDepth > 0) {
      this.deferredIdfDirty = true;
    } else {
      this.recalculateAllIDF();
    }

    // Update timestamp
    this.index.lastUpdated = new Date().toISOString();
  }

  /**
   * Phase 10 Sprint 3: Update a single document in the index incrementally.
   *
   * More efficient than rebuilding the entire index for single entity updates.
   * Handles both term changes and observation updates.
   *
   * @param entity - The updated entity
   *
   * @example
   * ```typescript
   * indexManager.updateDocument({
   *   name: 'ExistingEntity',
   *   entityType: 'person',
   *   observations: ['Updated observations']
   * });
   * ```
   */
  updateDocument(entity: { name: string; entityType: string; observations: string[] }): void {
    if (!this.index) {
      return;
    }

    const oldDocument = this.index.documents.get(entity.name);
    const oldTerms = oldDocument ? new Set(Object.keys(oldDocument.terms)) : new Set<string>();

    // Build new document
    const document = this.buildDocumentVector(entity);
    const newTerms = new Set(Object.keys(document.terms));

    // Update documents map
    if (oldDocument) this.decrementDocumentFrequency(oldDocument);
    this.index.documents.set(entity.name, document);
    this.incrementDocumentFrequency(document);

    // Find terms that changed (added or removed)
    const changedTerms = new Set<string>();
    for (const term of oldTerms) {
      if (!newTerms.has(term)) {
        changedTerms.add(term);
      }
    }
    for (const term of newTerms) {
      if (!oldTerms.has(term)) {
        changedTerms.add(term);
      }
    }

    // Recalculate IDF for changed terms (deferred to a single full pass at
    // endIdfBatch() when a batch is open — the full pass is a superset and
    // yields identical values, S5)
    if (!oldDocument) {
      if (this.idfBatchDepth > 0) {
        this.deferredIdfDirty = true;
      } else {
        this.recalculateAllIDF();
      }
    } else if (changedTerms.size > 0) {
      if (this.idfBatchDepth > 0) {
        this.deferredIdfDirty = true;
      } else {
        this.recalculateIDFForTerms(changedTerms);
      }
    }

    // Update timestamp
    this.index.lastUpdated = new Date().toISOString();
  }

  private buildDocumentVector(entity: {
    name: string;
    entityType: string;
    observations: readonly string[];
  }): DocumentVector {
    const documentText = [entity.name, entity.entityType, ...entity.observations].join(' ');
    const terms: Record<string, number> = {};
    for (const term of tokenize(documentText)) {
      terms[term] = (terms[term] ?? 0) + 1;
    }
    return { entityName: entity.name, terms, documentText };
  }

  private incrementDocumentFrequency(document: DocumentVector): void {
    for (const term of Object.keys(document.terms)) {
      this.documentFrequency.set(
        term,
        (this.documentFrequency.get(term) ?? 0) + 1,
      );
    }
  }

  private decrementDocumentFrequency(document: DocumentVector): void {
    for (const term of Object.keys(document.terms)) {
      const next = (this.documentFrequency.get(term) ?? 0) - 1;
      if (next > 0) this.documentFrequency.set(term, next);
      else this.documentFrequency.delete(term);
    }
  }

  private calculateDocumentFrequency(
    documents: Map<string, DocumentVector>,
  ): Map<string, number> {
    const frequencies = new Map<string, number>();
    for (const document of documents.values()) {
      for (const term of Object.keys(document.terms)) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
    }
    return frequencies;
  }

  /**
   * Phase 10 Sprint 3: Recalculate IDF scores for a set of terms.
   *
   * @param terms - Set of terms to recalculate IDF for
   * @private
   */
  private recalculateIDFForTerms(terms: Set<string>): void {
    if (!this.index) {
      return;
    }

    const totalDocs = this.index.documents.size;
    if (totalDocs === 0) {
      // No documents, clear all IDF for these terms
      for (const term of terms) {
        this.index.idf.delete(term);
      }
      return;
    }

    for (const term of terms) {
      const docCount = this.documentFrequency.get(term) ?? 0;

      if (docCount > 0) {
        // IDF = log(N / df) where N = total docs, df = doc frequency
        const idfScore = Math.log(totalDocs / docCount);
        this.index.idf.set(term, idfScore);
      } else {
        // Term no longer exists in any document
        this.index.idf.delete(term);
      }
    }
  }

  /**
   * Phase 10 Sprint 3: Recalculate IDF scores for ALL terms in the index.
   *
   * Called when the total document count changes (add/remove document).
   * @private
   */
  private recalculateAllIDF(): void {
    if (!this.index) {
      return;
    }

    const totalDocs = this.index.documents.size;

    if (totalDocs === 0) {
      // No documents, clear all IDF
      this.index.idf.clear();
      return;
    }

    // Clear old IDF and recalculate
    this.index.idf.clear();
    for (const [term, docCount] of this.documentFrequency) {
      // IDF = log(N / df) where N = total docs, df = doc frequency
      const idfScore = Math.log(totalDocs / docCount);
      this.index.idf.set(term, idfScore);
    }
  }

  /**
   * Phase 10 Sprint 3: Check if the index is loaded/initialized.
   *
   * @returns True if index is available
   */
  isInitialized(): boolean {
    return this.index !== undefined;
  }

  /**
   * Phase 10 Sprint 3: Get the number of documents in the index.
   *
   * @returns Document count or 0 if not initialized
   */
  getDocumentCount(): number {
    return this.index?.documents.size ?? 0;
  }

  /**
   * Health snapshot for `IndexHealthMonitor` / `ctx.indexHealth()`.
   *
   * Staleness is `'unknown'` because this manager has no graph reference;
   * callers wanting a fresh/dirty signal should call `needsRebuild(graph)`
   * directly.
   */
  health(): IndexHealthSnapshot {
    return {
      name: 'tfidf',
      initialized: this.isInitialized(),
      documentCount: this.getDocumentCount(),
      staleness: 'unknown',
    };
  }
}
