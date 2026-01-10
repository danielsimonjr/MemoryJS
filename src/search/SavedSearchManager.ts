/**
 * Saved Search Manager
 *
 * Manages persistent saved searches with JSONL storage.
 *
 * @module search/SavedSearchManager
 */

import * as fs from 'fs/promises';
import type { SavedSearch, KnowledgeGraph } from '../types/index.js';
import type { BasicSearch } from './BasicSearch.js';
import { sanitizeObject } from '../utils/index.js';

/**
 * Manages saved search queries with usage tracking.
 */
export class SavedSearchManager {
  constructor(
    private savedSearchesFilePath: string,
    private basicSearch: BasicSearch
  ) {}

  /**
   * Load all saved searches from JSONL file.
   *
   * @returns Array of saved searches
   */
  private async loadSavedSearches(): Promise<SavedSearch[]> {
    try {
      const data = await fs.readFile(this.savedSearchesFilePath, 'utf-8');
      const lines = data.split('\n').filter((line: string) => line.trim() !== '');
      return lines.map((line: string) => JSON.parse(line) as SavedSearch);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Save searches to JSONL file.
   *
   * @param searches - Array of saved searches
   */
  private async saveSavedSearches(searches: SavedSearch[]): Promise<void> {
    const lines = searches.map(s => JSON.stringify(s));
    await fs.writeFile(this.savedSearchesFilePath, lines.join('\n'));
  }

  /**
   * Save a search query for later reuse.
   *
   * @param search - Search parameters (without createdAt, useCount, lastUsed)
   * @returns The newly created saved search
   * @throws Error if search name already exists
   */
  async saveSearch(
    search: Omit<SavedSearch, 'createdAt' | 'useCount' | 'lastUsed'>
  ): Promise<SavedSearch> {
    const searches = await this.loadSavedSearches();

    // Check if name already exists
    if (searches.some(s => s.name === search.name)) {
      throw new Error(`Saved search with name "${search.name}" already exists`);
    }

    const newSearch: SavedSearch = {
      ...search,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    searches.push(newSearch);
    await this.saveSavedSearches(searches);

    return newSearch;
  }

  /**
   * List all saved searches.
   *
   * @returns Array of all saved searches
   */
  async listSavedSearches(): Promise<SavedSearch[]> {
    return await this.loadSavedSearches();
  }

  /**
   * Get a specific saved search by name.
   *
   * @param name - Search name
   * @returns Saved search or null if not found
   */
  async getSavedSearch(name: string): Promise<SavedSearch | null> {
    const searches = await this.loadSavedSearches();
    return searches.find(s => s.name === name) || null;
  }

  /**
   * Execute a saved search by name.
   *
   * Updates usage statistics (lastUsed, useCount) before executing.
   *
   * @param name - Search name
   * @returns Search results as knowledge graph
   * @throws Error if search not found
   */
  async executeSavedSearch(name: string): Promise<KnowledgeGraph> {
    const searches = await this.loadSavedSearches();
    const search = searches.find(s => s.name === name);

    if (!search) {
      throw new Error(`Saved search "${name}" not found`);
    }

    // Update usage statistics
    search.lastUsed = new Date().toISOString();
    search.useCount++;
    await this.saveSavedSearches(searches);

    // Execute the search using BasicSearch
    return await this.basicSearch.searchNodes(
      search.query,
      search.tags,
      search.minImportance,
      search.maxImportance
    );
  }

  /**
   * Delete a saved search.
   *
   * @param name - Search name
   * @returns True if deleted, false if not found
   */
  async deleteSavedSearch(name: string): Promise<boolean> {
    const searches = await this.loadSavedSearches();
    const initialLength = searches.length;
    const filtered = searches.filter(s => s.name !== name);

    if (filtered.length === initialLength) {
      return false; // Search not found
    }

    await this.saveSavedSearches(filtered);
    return true;
  }

  /**
   * Update a saved search.
   *
   * Cannot update name, createdAt, useCount, or lastUsed fields.
   *
   * @param name - Search name
   * @param updates - Partial search with fields to update
   * @returns Updated saved search
   * @throws Error if search not found
   */
  async updateSavedSearch(
    name: string,
    updates: Partial<Omit<SavedSearch, 'name' | 'createdAt' | 'useCount' | 'lastUsed'>>
  ): Promise<SavedSearch> {
    const searches = await this.loadSavedSearches();
    const search = searches.find(s => s.name === name);

    if (!search) {
      throw new Error(`Saved search "${name}" not found`);
    }

    // Apply updates (sanitized to prevent prototype pollution)
    Object.assign(search, sanitizeObject(updates as Record<string, unknown>));

    await this.saveSavedSearches(searches);
    return search;
  }
}
