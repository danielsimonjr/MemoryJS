/**
 * Tag Manager
 *
 * Manages tag aliases and canonical tag resolution.
 *
 * @module features/TagManager
 */

import * as fs from 'fs/promises';
import type { TagAlias } from '../types/index.js';

/**
 * Manages tag alias system for synonym mapping.
 */
export class TagManager {
  constructor(private tagAliasesFilePath: string) {}

  /**
   * Load all tag aliases from JSONL file.
   *
   * @returns Array of tag aliases
   */
  private async loadTagAliases(): Promise<TagAlias[]> {
    try {
      const data = await fs.readFile(this.tagAliasesFilePath, 'utf-8');
      const lines = data.split('\n').filter((line: string) => line.trim() !== '');
      return lines.map((line: string) => JSON.parse(line) as TagAlias);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Save tag aliases to JSONL file.
   *
   * @param aliases - Array of tag aliases
   */
  private async saveTagAliases(aliases: TagAlias[]): Promise<void> {
    const lines = aliases.map(a => JSON.stringify(a));
    await fs.writeFile(this.tagAliasesFilePath, lines.join('\n'));
  }

  /**
   * Resolve a tag through aliases to get its canonical form.
   *
   * This method follows the alias chain to find the canonical (main) tag name.
   * All tags are normalized to lowercase for consistency.
   * If the tag has no alias, it returns the tag itself as canonical.
   *
   * @param tag - Tag to resolve (can be alias or canonical)
   * @returns Canonical tag name (lowercase)
   *
   * @example
   * ```typescript
   * const manager = new TagManager(tagAliasesPath);
   *
   * // Set up: assume "js" is aliased to "javascript"
   * await manager.addTagAlias('js', 'javascript');
   *
   * // Resolve alias to canonical
   * const canonical = await manager.resolveTag('js');
   * console.log(canonical); // "javascript"
   *
   * // Resolve canonical tag (returns as-is)
   * const unchanged = await manager.resolveTag('javascript');
   * console.log(unchanged); // "javascript"
   *
   * // Resolve unknown tag (returns normalized)
   * const unknown = await manager.resolveTag('PYTHON');
   * console.log(unknown); // "python"
   * ```
   */
  async resolveTag(tag: string): Promise<string> {
    const aliases = await this.loadTagAliases();
    const normalized = tag.toLowerCase();

    // Check if this tag is an alias
    const alias = aliases.find(a => a.alias === normalized);
    if (alias) {
      return alias.canonical;
    }

    // Return as-is (might be canonical or unaliased tag)
    return normalized;
  }

  /**
   * Add a tag alias (synonym mapping).
   *
   * Creates a mapping from an alias (synonym) to a canonical (main) tag.
   * This enables flexible tagging where users can use different terms
   * that all resolve to the same canonical tag.
   *
   * Validation rules:
   * - Prevents duplicate aliases (same alias can't map to different canonicals)
   * - Prevents chained aliases (alias must point to canonical, not another alias)
   * - All tags are normalized to lowercase
   *
   * @param alias - The alias/synonym (will be normalized to lowercase)
   * @param canonical - The canonical (main) tag name (will be normalized to lowercase)
   * @param description - Optional description explaining the alias relationship
   * @returns Newly created TagAlias object with metadata
   * @throws {Error} If alias already exists or would create chained aliases
   *
   * @example
   * ```typescript
   * const manager = new TagManager(tagAliasesPath);
   *
   * // Create simple alias
   * await manager.addTagAlias('js', 'javascript', 'Common abbreviation');
   *
   * // Create multiple aliases for same canonical
   * await manager.addTagAlias('py', 'python');
   * await manager.addTagAlias('py3', 'python', 'Python 3.x');
   *
   * // Error: duplicate alias
   * try {
   *   await manager.addTagAlias('js', 'ecmascript'); // Fails - 'js' already aliased
   * } catch (error) {
   *   console.error('Alias already exists');
   * }
   *
   * // Error: chained alias
   * await manager.addTagAlias('js', 'javascript');
   * try {
   *   await manager.addTagAlias('javascript', 'ecmascript'); // Fails - can't alias canonical
   * } catch (error) {
   *   console.error('Cannot create chained aliases');
   * }
   * ```
   */
  async addTagAlias(alias: string, canonical: string, description?: string): Promise<TagAlias> {
    const aliases = await this.loadTagAliases();
    const normalizedAlias = alias.toLowerCase();
    const normalizedCanonical = canonical.toLowerCase();

    // Check if alias already exists
    if (aliases.some(a => a.alias === normalizedAlias)) {
      throw new Error(`Tag alias "${alias}" already exists`);
    }

    // Prevent aliasing to another alias (aliases should point to canonical tags)
    if (aliases.some(a => a.canonical === normalizedAlias)) {
      throw new Error(
        `Cannot create alias to "${alias}" because it is a canonical tag with existing aliases`
      );
    }

    const newAlias: TagAlias = {
      alias: normalizedAlias,
      canonical: normalizedCanonical,
      description,
      createdAt: new Date().toISOString(),
    };

    aliases.push(newAlias);
    await this.saveTagAliases(aliases);

    return newAlias;
  }

  /**
   * List all tag aliases.
   *
   * @returns Array of all tag aliases
   */
  async listTagAliases(): Promise<TagAlias[]> {
    return await this.loadTagAliases();
  }

  /**
   * Remove a tag alias.
   *
   * @param alias - Alias to remove
   * @returns True if removed, false if not found
   */
  async removeTagAlias(alias: string): Promise<boolean> {
    const aliases = await this.loadTagAliases();
    const normalizedAlias = alias.toLowerCase();
    const initialLength = aliases.length;
    const filtered = aliases.filter(a => a.alias !== normalizedAlias);

    if (filtered.length === initialLength) {
      return false; // Alias not found
    }

    await this.saveTagAliases(filtered);
    return true;
  }

  /**
   * Get all aliases (synonyms) for a canonical tag.
   *
   * Returns all alias names that resolve to the specified canonical tag.
   * Useful for discovering alternative names users might use for a tag.
   * The canonical tag name is normalized to lowercase.
   *
   * @param canonicalTag - Canonical tag name (will be normalized to lowercase)
   * @returns Array of alias names (all lowercase)
   *
   * @example
   * ```typescript
   * const manager = new TagManager(tagAliasesPath);
   *
   * // Set up some aliases
   * await manager.addTagAlias('js', 'javascript');
   * await manager.addTagAlias('ecmascript', 'javascript');
   * await manager.addTagAlias('es6', 'javascript');
   *
   * // Get all aliases for canonical tag
   * const aliases = await manager.getAliasesForTag('javascript');
   * console.log(aliases); // ['js', 'ecmascript', 'es6']
   *
   * // Empty array if no aliases
   * const noAliases = await manager.getAliasesForTag('python');
   * console.log(noAliases); // []
   * ```
   */
  async getAliasesForTag(canonicalTag: string): Promise<string[]> {
    const aliases = await this.loadTagAliases();
    const normalized = canonicalTag.toLowerCase();
    return aliases.filter(a => a.canonical === normalized).map(a => a.alias);
  }
}
