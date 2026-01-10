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
import { calculateIDFFromTokenSets, tokenize } from '../utils/index.js';

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
}

/**
 * Manages TF-IDF index lifecycle: building, updating, and persistence.
 */
export class TFIDFIndexManager {
  private indexPath: string;
  private index: TFIDFIndex | null = null;

  constructor(storageDir: string) {
    this.indexPath = path.join(storageDir, '.indexes', INDEX_FILENAME);
  }

  /**
   * Build a complete TF-IDF index from a knowledge graph.
   *
   * @param graph - Knowledge graph to index
   * @returns Newly built TF-IDF index
   */
  async buildIndex(graph: ReadonlyKnowledgeGraph): Promise<TFIDFIndex> {
    const documents = new Map<string, DocumentVector>();
    const allTokenSets: Set<string>[] = [];

    // Build document vectors - tokenize once per document
    for (const entity of graph.entities) {
      const documentText = [
        entity.name,
        entity.entityType,
        ...entity.observations,
      ].join(' ');

      const tokens = tokenize(documentText);
      const tokenSet = new Set(tokens);
      allTokenSets.push(tokenSet);

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

    // Calculate IDF for all terms using pre-tokenized sets (O(1) lookup per document)
    const idf = new Map<string, number>();
    const allTerms = new Set(allTokenSets.flatMap(s => Array.from(s)));

    for (const term of allTerms) {
      const idfScore = calculateIDFFromTokenSets(term, allTokenSets);
      idf.set(term, idfScore);
    }

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

    // Rebuild document vectors for changed entities
    const allTokenSets: Set<string>[] = [];
    const updatedDocuments = new Map(this.index.documents);

    // Remove deleted entities
    for (const entityName of changedEntityNames) {
      const entity = graph.entities.find(e => e.name === entityName);
      if (!entity) {
        updatedDocuments.delete(entityName);
      }
    }

    // Update/add changed entities - tokenize once per document
    for (const entity of graph.entities) {
      const documentText = [
        entity.name,
        entity.entityType,
        ...entity.observations,
      ].join(' ');

      const tokens = tokenize(documentText);
      const tokenSet = new Set(tokens);
      allTokenSets.push(tokenSet);

      if (changedEntityNames.has(entity.name)) {
        // Calculate term frequencies for changed entity
        const termFreq: Record<string, number> = {};
        for (const term of tokens) {
          termFreq[term] = (termFreq[term] || 0) + 1;
        }

        updatedDocuments.set(entity.name, {
          entityName: entity.name,
          terms: termFreq,
          documentText,
        });
      }
    }

    // Recalculate IDF using pre-tokenized sets (O(1) lookup per document)
    const idf = new Map<string, number>();
    const allTerms = new Set(allTokenSets.flatMap(s => Array.from(s)));

    for (const term of allTerms) {
      const idfScore = calculateIDFFromTokenSets(term, allTokenSets);
      idf.set(term, idfScore);
    }

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents: updatedDocuments,
      idf,
    };

    return this.index;
  }

  /**
   * Load index from disk.
   *
   * @returns Loaded index or null if not found
   */
  async loadIndex(): Promise<TFIDFIndex | null> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const serialized: SerializedTFIDFIndex = JSON.parse(data);

      this.index = {
        version: serialized.version,
        lastUpdated: serialized.lastUpdated,
        documents: new Map(serialized.documents),
        idf: new Map(serialized.idf),
      };

      return this.index;
    } catch (error) {
      // Index doesn't exist or is invalid
      return null;
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
    const serialized: SerializedTFIDFIndex = {
      version: indexToSave.version,
      lastUpdated: indexToSave.lastUpdated,
      documents: Array.from(indexToSave.documents.entries()),
      idf: Array.from(indexToSave.idf.entries()),
    };

    await fs.writeFile(this.indexPath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  /**
   * Get the current cached index.
   *
   * @returns Cached index or null if not loaded
   */
  getIndex(): TFIDFIndex | null {
    return this.index;
  }

  /**
   * Clear the cached index and delete from disk.
   */
  async clearIndex(): Promise<void> {
    this.index = null;
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

    // Build document text and tokens
    const documentText = [entity.name, entity.entityType, ...entity.observations].join(' ');
    const tokens = tokenize(documentText);

    // Calculate term frequencies
    const termFreq: Record<string, number> = {};
    for (const term of tokens) {
      termFreq[term] = (termFreq[term] || 0) + 1;
    }

    // Add to documents map
    this.index.documents.set(entity.name, {
      entityName: entity.name,
      terms: termFreq,
      documentText,
    });

    // Update IDF for ALL terms because N changed (total document count)
    // IDF = log(N/df), and N has increased
    this.recalculateAllIDF();

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

    // Update IDF for ALL terms because N changed (total document count)
    // IDF = log(N/df), and N has decreased
    this.recalculateAllIDF();

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
    const documentText = [entity.name, entity.entityType, ...entity.observations].join(' ');
    const tokens = tokenize(documentText);
    const newTerms = new Set(tokens);

    // Calculate term frequencies
    const termFreq: Record<string, number> = {};
    for (const term of tokens) {
      termFreq[term] = (termFreq[term] || 0) + 1;
    }

    // Update documents map
    this.index.documents.set(entity.name, {
      entityName: entity.name,
      terms: termFreq,
      documentText,
    });

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

    // Recalculate IDF for changed terms
    if (changedTerms.size > 0) {
      this.recalculateIDFForTerms(changedTerms);
    }

    // Update timestamp
    this.index.lastUpdated = new Date().toISOString();
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

    // Count documents containing each term
    for (const term of terms) {
      let docCount = 0;
      for (const doc of this.index.documents.values()) {
        if (term in doc.terms) {
          docCount++;
        }
      }

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

    // Build term -> document count map
    const termDocCounts = new Map<string, number>();
    for (const doc of this.index.documents.values()) {
      for (const term of Object.keys(doc.terms)) {
        termDocCounts.set(term, (termDocCounts.get(term) ?? 0) + 1);
      }
    }

    // Clear old IDF and recalculate
    this.index.idf.clear();
    for (const [term, docCount] of termDocCounts) {
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
    return this.index !== null;
  }

  /**
   * Phase 10 Sprint 3: Get the number of documents in the index.
   *
   * @returns Document count or 0 if not initialized
   */
  getDocumentCount(): number {
    return this.index?.documents.size ?? 0;
  }
}
