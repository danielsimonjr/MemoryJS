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
import { randomUUID } from 'node:crypto';
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
  snapshotId?: string;
}

/** Map-compatible IDF values evaluated against current N and document frequencies. */
class LazyIDFMap extends Map<string, number> {
  constructor(private readonly frequencies: Map<string, number>, private readonly count: () => number) {
    super();
    for (const term of frequencies.keys()) super.set(term, 0);
  }

  override get(term: string): number | undefined {
    if (!super.has(term)) return undefined;
    const frequency = this.frequencies.get(term) ?? 0;
    return frequency > 0 ? Math.log(this.count() / frequency) : super.get(term);
  }

  override *entries(): MapIterator<[string, number]> {
    for (const term of super.keys()) yield [term, this.get(term)!];
  }

  override *values(): MapIterator<number> {
    for (const term of super.keys()) yield this.get(term)!;
  }

  override [Symbol.iterator](): MapIterator<[string, number]> { return this.entries(); }

  override forEach(callback: (value: number, key: string, map: Map<string, number>) => void, thisArg?: unknown): void {
    for (const [term, value] of this.entries()) callback.call(thisArg, value, term, this);
  }
}

interface IndexDelta {
  snapshotId: string;
  lastUpdated: string;
  documents: Array<[string, DocumentVector | null]>;
}

/**
 * Manages TF-IDF index lifecycle: building, updating, and persistence.
 */
export class TFIDFIndexManager implements IIndexHealth {
  private indexPath: string;
  private index: TFIDFIndex | undefined = undefined;
  /** Number of indexed documents containing each term. */
  private documentFrequency: Map<string, number> = new Map();

  /** Nesting-safe batching defers removal of obsolete IDF keys; values are lazy. */
  private idfBatchDepth = 0;
  /** True when a batch has changed document statistics. */
  private deferredIdfDirty = false;
  private dirtyNames = new Set<string>();
  private snapshotId: string | undefined;
  private needsSnapshot = true;
  private journalRecords = 0;
  private saveQueue: Promise<void> = Promise.resolve();
  private changedTerms = new Set<string>();
  private generation = 0;
  private removedSinceSave = new Set<string>();
  private documentOrder = new Map<string, number>();
  private nextDocumentOrder = 0;

  constructor(storageDir: string) {
    this.indexPath = path.join(storageDir, '.indexes', INDEX_FILENAME);
  }

  /** Open a batch of document mutations; pair with endIdfBatch in finally. */
  beginIdfBatch(): void {
    this.idfBatchDepth++;
  }

  /** Close a batch, pruning obsolete keys once without a vocabulary-wide pass. */
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
    this.generation++;
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
    this.documentFrequency = documentFrequency;
    const idf = new LazyIDFMap(documentFrequency, () => documents.size);
    this.needsSnapshot = true;
    this.dirtyNames.clear();
    this.changedTerms.clear();
    this.resetDocumentOrder(documents);

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents,
      idf,
    };

    return this.getIndex()!;
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

    this.generation++;
    const updatedDocuments = this.index.documents;
    const changedEntities = new Map<string, (typeof graph.entities)[number]>();
    for (const entity of graph.entities) {
      if (changedEntityNames.has(entity.name)) {
        changedEntities.set(entity.name, entity);
      }
    }

    for (const entityName of changedEntityNames) {
      this.dirtyNames.add(entityName);
      const oldDocument = updatedDocuments.get(entityName);
      if (oldDocument) this.decrementDocumentFrequency(oldDocument);

      const entity = changedEntities.get(entityName);
      if (entity) {
        const document = this.buildDocumentVector(entity);
        updatedDocuments.set(entityName, document);
        if (!oldDocument) this.documentOrder.set(entityName, this.nextDocumentOrder++);
        this.incrementDocumentFrequency(document);
      } else {
        updatedDocuments.delete(entityName);
        this.removedSinceSave.add(entityName);
        this.documentOrder.delete(entityName);
      }
    }

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents: updatedDocuments,
      idf: this.index.idf,
    };
    this.recalculateAllIDF();

    return this.getIndex()!;
  }

  /**
   * Load index from disk.
   *
   * @returns Loaded index or undefined if not found
   */
  async loadIndex(): Promise<TFIDFIndex | undefined> {
    const operation = this.saveQueue.then(() => this.readIndex());
    this.saveQueue = operation.then(() => {}, () => {});
    return operation;
  }

  private async readIndex(): Promise<TFIDFIndex | undefined> {
    const generation = this.generation;
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const serialized: SerializedTFIDFIndex = JSON.parse(data);

      const documents = new Map(serialized.documents);
      const snapshotId = serialized.snapshotId;
      let journalRecords = 0;
      if (snapshotId) {
        let journal = '';
        try { journal = await fs.readFile(`${this.indexPath}.journal`, 'utf-8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        // An interrupted append can leave a partial final line. Only complete records commit.
        const lines = journal.split('\n');
        lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const delta: IndexDelta = JSON.parse(line);
          if (delta.snapshotId !== snapshotId) continue;
          for (const [name, document] of delta.documents) {
            if (document) documents.set(name, document);
            else documents.delete(name);
          }
          serialized.lastUpdated = delta.lastUpdated;
          journalRecords++;
        }
        // Repair an incomplete tail before another append can concatenate onto it.
        if (journal && !journal.endsWith('\n')) {
          await fs.truncate(`${this.indexPath}.journal`, Buffer.byteLength(journal.slice(0, journal.lastIndexOf('\n') + 1)));
        }
      }
      if (generation !== this.generation) return this.index;
      this.snapshotId = snapshotId;
      this.journalRecords = journalRecords;
      this.documentFrequency = this.calculateDocumentFrequency(documents);
      this.index = {
        version: serialized.version,
        lastUpdated: serialized.lastUpdated,
        documents,
        idf: new LazyIDFMap(this.documentFrequency, () => documents.size),
      };
      this.dirtyNames.clear();
      this.resetDocumentOrder(documents);
      this.needsSnapshot = !this.snapshotId;

      return this.getIndex();
    } catch {
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
    const operation = this.saveQueue.then(() => this.persistIndex(index));
    this.saveQueue = operation.catch(() => {});
    return operation;
  }

  private async persistIndex(index?: TFIDFIndex): Promise<void> {
    if (!index && !this.index) throw new Error('No index to save');
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const indexToSave = index ?? this.index;
    if (!indexToSave) throw new Error('No index to save');
    const ownIndex = indexToSave === this.index;
    const dirty = this.dirtyNames;
    const removed = this.removedSinceSave;
    this.dirtyNames = new Set();
    this.removedSinceSave = new Set();
    const mustSnapshot = index !== undefined || !ownIndex || this.needsSnapshot || !this.snapshotId || this.journalRecords >= 256;
    try {
      if (mustSnapshot) {
        const snapshotId = randomUUID();
        const serialized: SerializedTFIDFIndex = {
          version: indexToSave.version,
          lastUpdated: indexToSave.lastUpdated,
          documents: Array.from(indexToSave.documents.entries()),
          idf: Array.from(indexToSave.idf.entries()),
          documentFrequency: Array.from((ownIndex ? this.documentFrequency : this.calculateDocumentFrequency(indexToSave.documents)).entries()),
          snapshotId,
        };
        const temporary = `${this.indexPath}.${snapshotId}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(serialized), 'utf-8');
          await fs.rename(temporary, this.indexPath);
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
        // Old journal records carry the old snapshot ID, so crash replay cannot overwrite this snapshot.
        await fs.writeFile(`${this.indexPath}.journal`, '', 'utf-8');
        if (ownIndex && this.index === indexToSave) {
          this.snapshotId = snapshotId;
          this.needsSnapshot = false;
          this.journalRecords = 0;
        } else {
          this.needsSnapshot = true;
        }
      } else if (dirty.size > 0) {
        const delta: IndexDelta = {
          snapshotId: this.snapshotId!,
          lastUpdated: indexToSave.lastUpdated,
          documents: [
            ...Array.from(removed, name => [name, null] as [string, null]),
            ...Array.from(dirty)
              .filter(name => indexToSave.documents.has(name))
              .sort((a, b) => (this.documentOrder.get(a) ?? 0) - (this.documentOrder.get(b) ?? 0))
              .map(name => [name, indexToSave.documents.get(name)!] as [string, DocumentVector]),
          ],
        };
        await fs.appendFile(`${this.indexPath}.journal`, `${JSON.stringify(delta)}\n`, 'utf-8');
        this.journalRecords++;
      }
    } catch (error) {
      for (const name of dirty) this.dirtyNames.add(name);
      for (const name of removed) this.removedSinceSave.add(name);
      this.needsSnapshot = true;
      throw error;
    }
  }

  /**
   * Get the current cached index.
   *
   * @returns Cached index or undefined if not loaded
   */
  getIndex(): TFIDFIndex | undefined {
    // Materialize native Map storage for consumers using structuredClone.
    // Retained references still provide fresh lazy get/iteration after mutations;
    // call getIndex again before native cloning to refresh its stored values.
    if (this.index) {
      for (const [term, value] of this.index.idf) this.index.idf.set(term, value);
    }
    return this.index;
  }

  /** Internal search accessor: query-term reads do not materialize the vocabulary. */
  getIndexForSearch(): TFIDFIndex | undefined {
    return this.index;
  }

  /**
   * Clear the cached index and delete from disk.
   */
  async clearIndex(): Promise<void> {
    const operation = this.saveQueue.then(() => this.clearPersistedIndex());
    this.saveQueue = operation.catch(() => {});
    return operation;
  }

  private async clearPersistedIndex(): Promise<void> {
    this.generation++;
    this.needsSnapshot = true;
    this.snapshotId = undefined;
    this.dirtyNames.clear();
    this.removedSinceSave.clear();
    this.documentOrder.clear();
    this.index = undefined;
    this.documentFrequency = new Map();
    this.changedTerms.clear();
    await fs.unlink(`${this.indexPath}.journal`).catch(() => {});
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

    this.generation++;
    this.dirtyNames.add(entity.name);
    const oldDocument = this.index.documents.get(entity.name);
    if (oldDocument) this.decrementDocumentFrequency(oldDocument);
    const document = this.buildDocumentVector(entity);
    this.index.documents.set(entity.name, document);
    if (!oldDocument) this.documentOrder.set(entity.name, this.nextDocumentOrder++);
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

    this.generation++;
    this.dirtyNames.add(entityName);
    // Remove from documents map
    this.index.documents.delete(entityName);
    this.removedSinceSave.add(entityName);
    this.documentOrder.delete(entityName);
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

    this.generation++;
    this.dirtyNames.add(entity.name);
    const oldDocument = this.index.documents.get(entity.name);
    const oldTerms = oldDocument ? new Set(Object.keys(oldDocument.terms)) : new Set<string>();

    // Build new document
    const document = this.buildDocumentVector(entity);
    const newTerms = new Set(Object.keys(document.terms));

    // Update documents map
    if (oldDocument) this.decrementDocumentFrequency(oldDocument);
    this.index.documents.set(entity.name, document);
    if (!oldDocument) this.documentOrder.set(entity.name, this.nextDocumentOrder++);
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

  private resetDocumentOrder(documents: Map<string, DocumentVector>): void {
    this.documentOrder.clear();
    this.nextDocumentOrder = 0;
    for (const name of documents.keys()) this.documentOrder.set(name, this.nextDocumentOrder++);
    this.removedSinceSave.clear();
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
      this.index?.idf.set(term, 0);
      this.changedTerms.add(term);
    }
  }

  private decrementDocumentFrequency(document: DocumentVector): void {
    for (const term of Object.keys(document.terms)) {
      const next = (this.documentFrequency.get(term) ?? 0) - 1;
      if (next > 0) this.documentFrequency.set(term, next);
      else {
        this.documentFrequency.delete(term);
        this.changedTerms.add(term);
      }
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
    // Prune only the affected keys; values themselves are evaluated lazily.
    for (const term of terms) {
      if (!this.documentFrequency.has(term)) this.index?.idf.delete(term);
      this.changedTerms.delete(term);
    }
  }

  /** Retained as the batch boundary hook; lazy IDF needs no vocabulary pass. */
  private recalculateAllIDF(): void {
    this.recalculateIDFForTerms(this.changedTerms);
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
