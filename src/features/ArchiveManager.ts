/**
 * Archive Manager
 *
 * Handles archiving (removal) of entities based on criteria.
 * Archives are stored as compressed files for space-efficient long-term storage.
 * Extracted from EntityManager (Phase 4: Consolidate God Objects).
 * Enhanced with brotli compression in Phase 3 Sprint 5.
 *
 * @module features/ArchiveManager
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { Entity, LongRunningOperationOptions } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import {
  compress,
  COMPRESSION_CONFIG,
  checkCancellation,
  createProgressReporter,
  createProgress,
} from '../utils/index.js';

/**
 * Criteria for archiving entities.
 */
export interface ArchiveCriteria {
  /** Entities older than this date (ISO 8601) */
  olderThan?: string;
  /** Entities with importance less than this value */
  importanceLessThan?: number;
  /** Entities with any of these tags */
  tags?: string[];
}

/**
 * Options for archive operations.
 * Phase 9B: Extended with LongRunningOperationOptions.
 */
export interface ArchiveOptions extends LongRunningOperationOptions {
  /** Dry run mode - preview without making changes */
  dryRun?: boolean;
  /** Whether to save archived entities to a compressed file (default: true) */
  saveToFile?: boolean;
}

/**
 * Result of archive operation.
 * Extends ArchiveResultExtended with compression statistics.
 */
export interface ArchiveResult {
  /** Number of entities archived */
  archived: number;
  /** Names of archived entities */
  entityNames: string[];
  /** Path to the archive file (if created) */
  archivePath?: string;
  /** Original size of archive data in bytes */
  originalSize?: number;
  /** Compressed size in bytes */
  compressedSize?: number;
  /** Compression ratio (compressedSize / originalSize). Lower is better. */
  compressionRatio?: number;
}

/**
 * Manages archive operations for the knowledge graph.
 *
 * Archives are stored as brotli-compressed files in the `.archives` directory.
 * Maximum compression quality is used for optimal long-term storage.
 */
export class ArchiveManager {
  private readonly archiveDir: string;

  constructor(private storage: GraphStorage) {
    const filePath = this.storage.getFilePath();
    const dir = dirname(filePath);
    this.archiveDir = join(dir, '.archives');
  }

  /**
   * Archive old or low-importance entities.
   *
   * Entities matching ANY of the criteria are archived:
   * - lastModified older than olderThan date
   * - importance less than importanceLessThan
   * - has at least one tag from tags array
   *
   * By default, archived entities are saved to a compressed file before
   * being removed from the active graph. Use `saveToFile: false` to
   * skip creating the archive file.
   *
   * Phase 9B: Supports progress tracking and cancellation via options.
   *
   * @param criteria - Archiving criteria
   * @param options - Archive options (dryRun, saveToFile, onProgress, signal)
   * @returns Archive result with count, entity names, and compression stats
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   *
   * @example
   * ```typescript
   * // Archive old entities with compression
   * const result = await manager.archiveEntities({
   *   olderThan: '2023-01-01T00:00:00Z',
   *   importanceLessThan: 3
   * });
   * console.log(`Archived ${result.archived} entities`);
   * console.log(`Compressed from ${result.originalSize} to ${result.compressedSize} bytes`);
   *
   * // Preview without making changes
   * const preview = await manager.archiveEntities(criteria, { dryRun: true });
   *
   * // With progress tracking and cancellation (Phase 9B)
   * const controller = new AbortController();
   * const result = await manager.archiveEntities(criteria, {
   *   signal: controller.signal,
   *   onProgress: (p) => console.log(`${p.percentage}% complete`),
   * });
   * ```
   */
  async archiveEntities(
    criteria: ArchiveCriteria,
    options: ArchiveOptions | boolean = {}
  ): Promise<ArchiveResult> {
    // Handle legacy boolean argument (backward compatibility)
    const opts: ArchiveOptions = typeof options === 'boolean'
      ? { dryRun: options, saveToFile: true }
      : { saveToFile: true, ...options };

    // Check for early cancellation
    checkCancellation(opts.signal, 'archiveEntities');

    // Setup progress reporter
    const reportProgress = createProgressReporter(opts.onProgress);
    reportProgress?.(createProgress(0, 100, 'archiveEntities'));

    // Use read-only graph for analysis
    const readGraph = await this.storage.loadGraph();
    const toArchive: Entity[] = [];
    const totalEntities = readGraph.entities.length;
    let processedEntities = 0;

    // Phase 1: Identify entities to archive (0-40% progress)
    reportProgress?.(createProgress(5, 100, 'analyzing entities'));

    for (const entity of readGraph.entities) {
      // Check for cancellation periodically
      checkCancellation(opts.signal, 'archiveEntities');

      let shouldArchive = false;

      // Check age criteria
      if (criteria.olderThan && entity.lastModified) {
        const entityDate = new Date(entity.lastModified);
        const cutoffDate = new Date(criteria.olderThan);
        if (entityDate < cutoffDate) {
          shouldArchive = true;
        }
      }

      // Check importance criteria
      if (criteria.importanceLessThan !== undefined) {
        if (entity.importance === undefined || entity.importance < criteria.importanceLessThan) {
          shouldArchive = true;
        }
      }

      // Check tag criteria (must have at least one matching tag)
      if (criteria.tags && criteria.tags.length > 0) {
        const normalizedCriteriaTags = criteria.tags.map(t => t.toLowerCase());
        const entityTags = (entity.tags || []).map(t => t.toLowerCase());
        const hasMatchingTag = normalizedCriteriaTags.some(tag => entityTags.includes(tag));
        if (hasMatchingTag) {
          shouldArchive = true;
        }
      }

      if (shouldArchive) {
        toArchive.push(entity);
      }

      processedEntities++;
      // Map analysis progress (0-100%) to overall progress (0-40%)
      const analysisProgress = totalEntities > 0 ? Math.round((processedEntities / totalEntities) * 40) : 40;
      reportProgress?.(createProgress(analysisProgress, 100, 'analyzing entities'));
    }

    reportProgress?.(createProgress(40, 100, 'analysis complete'));

    // Dry run - return preview without changes
    if (opts.dryRun) {
      reportProgress?.(createProgress(100, 100, 'archiveEntities'));
      return {
        archived: toArchive.length,
        entityNames: toArchive.map(e => e.name),
      };
    }

    // No entities to archive
    if (toArchive.length === 0) {
      reportProgress?.(createProgress(100, 100, 'archiveEntities'));
      return {
        archived: 0,
        entityNames: [],
      };
    }

    // Check for cancellation before archiving
    checkCancellation(opts.signal, 'archiveEntities');

    // Phase 2: Save to compressed archive file (40-80% progress)
    let archivePath: string | undefined;
    let originalSize: number | undefined;
    let compressedSize: number | undefined;
    let compressionRatio: number | undefined;

    if (opts.saveToFile) {
      reportProgress?.(createProgress(50, 100, 'compressing archive'));
      const archiveResult = await this.saveToArchive(toArchive);
      archivePath = archiveResult.archivePath;
      originalSize = archiveResult.originalSize;
      compressedSize = archiveResult.compressedSize;
      compressionRatio = archiveResult.compressionRatio;
      reportProgress?.(createProgress(80, 100, 'archive saved'));
    } else {
      reportProgress?.(createProgress(80, 100, 'skipped archive file'));
    }

    // Check for cancellation before graph modification
    checkCancellation(opts.signal, 'archiveEntities');

    // Phase 3: Remove from main graph (80-100% progress)
    reportProgress?.(createProgress(85, 100, 'updating graph'));

    // Get mutable copy for write operation
    const graph = await this.storage.getGraphForMutation();

    // Remove archived entities from main graph
    const archiveNames = new Set(toArchive.map(e => e.name));
    graph.entities = graph.entities.filter(e => !archiveNames.has(e.name));
    graph.relations = graph.relations.filter(
      r => !archiveNames.has(r.from) && !archiveNames.has(r.to)
    );
    await this.storage.saveGraph(graph);

    // Report completion
    reportProgress?.(createProgress(100, 100, 'archiveEntities'));

    return {
      archived: toArchive.length,
      entityNames: toArchive.map(e => e.name),
      archivePath,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  }

  /**
   * Save entities to a compressed archive file.
   *
   * Creates a brotli-compressed file in the `.archives` directory
   * with maximum compression quality for space efficiency.
   *
   * @param entities - Entities to archive
   * @returns Archive file path and compression statistics
   */
  private async saveToArchive(entities: Entity[]): Promise<{
    archivePath: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  }> {
    // Ensure archive directory exists
    await fs.mkdir(this.archiveDir, { recursive: true });

    // Generate timestamp-based filename
    const timestamp = new Date().toISOString()
      .replace(/:/g, '-')
      .replace(/\./g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const archivePath = join(this.archiveDir, `archive_${timestamp}.jsonl.br`);

    // Serialize entities to JSONL format
    const content = entities.map(e => JSON.stringify(e)).join('\n');

    // Compress with maximum quality for archives
    const compressionResult = await compress(content, {
      quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
      mode: 'text',
    });

    // Write compressed archive
    await fs.writeFile(archivePath, compressionResult.compressed);

    // Write metadata file
    const metadataPath = `${archivePath}.meta.json`;
    const metadata = {
      timestamp: new Date().toISOString(),
      entityCount: entities.length,
      entityNames: entities.map(e => e.name),
      compressed: true,
      compressionFormat: 'brotli',
      originalSize: compressionResult.originalSize,
      compressedSize: compressionResult.compressedSize,
      compressionRatio: compressionResult.ratio,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      archivePath,
      originalSize: compressionResult.originalSize,
      compressedSize: compressionResult.compressedSize,
      compressionRatio: compressionResult.ratio,
    };
  }

  /**
   * List all available archives.
   *
   * @returns Array of archive information with compression details
   */
  async listArchives(): Promise<Array<{
    fileName: string;
    filePath: string;
    timestamp: string;
    entityCount: number;
    compressed: boolean;
    originalSize?: number;
    compressedSize?: number;
    compressionRatio?: number;
  }>> {
    try {
      try {
        await fs.access(this.archiveDir);
      } catch {
        return [];
      }

      const files = await fs.readdir(this.archiveDir);
      const archiveFiles = files.filter(f =>
        f.startsWith('archive_') &&
        (f.endsWith('.jsonl') || f.endsWith('.jsonl.br')) &&
        !f.endsWith('.meta.json')
      );

      const archives: Array<{
        fileName: string;
        filePath: string;
        timestamp: string;
        entityCount: number;
        compressed: boolean;
        originalSize?: number;
        compressedSize?: number;
        compressionRatio?: number;
      }> = [];

      for (const fileName of archiveFiles) {
        const filePath = join(this.archiveDir, fileName);
        const metadataPath = `${filePath}.meta.json`;

        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);

          archives.push({
            fileName,
            filePath,
            timestamp: metadata.timestamp,
            entityCount: metadata.entityCount,
            compressed: metadata.compressed ?? fileName.endsWith('.br'),
            originalSize: metadata.originalSize,
            compressedSize: metadata.compressedSize,
            compressionRatio: metadata.compressionRatio,
          });
        } catch {
          // Skip archives without valid metadata
          continue;
        }
      }

      // Sort by timestamp (newest first)
      archives.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return archives;
    } catch {
      return [];
    }
  }

  /**
   * Get the path to the archives directory.
   */
  getArchiveDir(): string {
    return this.archiveDir;
  }
}
