/**
 * Backup Manager
 *
 * Extracted from `IOManager` (Phase 2 step 29 — first pass of the
 * god-object split). Owns the `.backups/` sidecar directory and the
 * create / list / restore / delete / clean lifecycle.
 *
 * `IOManager` keeps a private `BackupManager` instance and delegates
 * its public backup methods so existing callers (`ctx.ioManager.createBackup(...)`)
 * keep working unchanged.
 *
 * @module features/BackupManager
 * @public Public API surface matches the pre-extraction `IOManager`
 *   methods 1:1. Callers can opt into the standalone class instead of
 *   going through `IOManager` if they want a smaller dependency.
 */

import { promises as fs } from 'fs';
import { basename, join } from 'path';
import type { GraphStorage } from '../core/GraphStorage.js';
import { FileOperationError } from '../utils/errors.js';
import {
  compress,
  decompress,
  hasBrotliExtension,
  COMPRESSION_CONFIG,
} from '../utils/index.js';
import { validateFilePath } from '../utils/entityUtils.js';
import type {
  BackupOptions,
  BackupResult,
  RestoreResult,
} from '../types/index.js';

/** Persisted alongside each backup as `<backup>.meta.json`. */
export interface BackupMetadata {
  timestamp: string;
  entityCount: number;
  relationCount: number;
  fileSize: number;
  description?: string;
  compressed: boolean;
  originalSize: number;
  compressionRatio?: number;
  compressionFormat: 'brotli' | 'none';
}

/** Returned by `listBackups()`. */
export interface BackupInfo {
  fileName: string;
  filePath: string;
  metadata: BackupMetadata;
  compressed: boolean;
  size: number;
}

/**
 * Backup lifecycle owner. `IOManager` instantiates one per storage and
 * delegates its backup methods through it.
 *
 * @example
 * ```typescript
 * const backups = new BackupManager(storage, '/data/.backups');
 * const result = await backups.create({ description: 'before migration' });
 * const all = await backups.list();
 * await backups.restore(all[0].filePath);
 * ```
 */
export class BackupManager {
  constructor(
    private readonly storage: GraphStorage,
    private readonly backupDir: string,
  ) {}

  /** Get the path to the backup directory. */
  getDir(): string {
    return this.backupDir;
  }

  /** Create a backup of the current knowledge graph. */
  async create(options?: BackupOptions | string): Promise<BackupResult> {
    await this.ensureDir();

    // Legacy string-arg compatibility — pre-Phase-2 callers passed
    // just a description.
    const opts: BackupOptions = typeof options === 'string'
      ? { description: options, compress: COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP }
      : { compress: COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP, ...options };

    const shouldCompress = opts.compress ?? COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP;
    const graph = await this.storage.loadGraph();
    const timestamp = new Date().toISOString();
    const fileName = this.generateFileName(shouldCompress);
    const backupPath = join(this.backupDir, fileName);

    try {
      const originalPath = this.storage.getFilePath();
      let fileContent: string;

      try {
        fileContent = await fs.readFile(originalPath, 'utf-8');
      } catch {
        const lines = [
          ...graph.entities.map((e) => JSON.stringify({ type: 'entity', ...e })),
          ...graph.relations.map((r) => JSON.stringify({ type: 'relation', ...r })),
        ];
        fileContent = lines.join('\n');
      }

      const originalSize = Buffer.byteLength(fileContent, 'utf-8');
      let compressedSize = originalSize;
      let compressionRatio = 1;

      if (shouldCompress) {
        const compressionResult = await compress(fileContent, {
          quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
          mode: 'text',
        });
        await fs.writeFile(backupPath, compressionResult.compressed);
        compressedSize = compressionResult.compressedSize;
        compressionRatio = compressionResult.ratio;
      } else {
        await fs.writeFile(backupPath, fileContent);
      }

      const stats = await fs.stat(backupPath);

      const metadata: BackupMetadata = {
        timestamp,
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        fileSize: stats.size,
        description: opts.description,
        compressed: shouldCompress,
        originalSize,
        compressionRatio: shouldCompress ? compressionRatio : undefined,
        compressionFormat: shouldCompress ? 'brotli' : 'none',
      };

      const metadataPath = `${backupPath}.meta.json`;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      return {
        path: backupPath,
        timestamp,
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        compressed: shouldCompress,
        originalSize,
        compressedSize,
        compressionRatio,
        description: opts.description,
      };
    } catch (error) {
      throw new FileOperationError('create backup', backupPath, error as Error);
    }
  }

  /** List all available backups, sorted by timestamp (newest first). */
  async list(): Promise<BackupInfo[]> {
    try {
      try {
        await fs.access(this.backupDir);
      } catch {
        return [];
      }

      const files = await fs.readdir(this.backupDir);
      const backupFiles = files.filter((f) =>
        f.startsWith('backup_') &&
        (f.endsWith('.jsonl') || f.endsWith('.jsonl.br')) &&
        !f.endsWith('.meta.json'),
      );

      const backups: BackupInfo[] = [];

      for (const fileName of backupFiles) {
        const filePath = join(this.backupDir, fileName);
        const isCompressed = hasBrotliExtension(fileName);
        const metadataPath = `${filePath}.meta.json`;

        try {
          const [metadataContent, stats] = await Promise.all([
            fs.readFile(metadataPath, 'utf-8'),
            fs.stat(filePath),
          ]);
          const metadata: BackupMetadata = JSON.parse(metadataContent);

          if (metadata.compressed === undefined) {
            metadata.compressed = isCompressed;
          }
          if (metadata.compressionFormat === undefined) {
            metadata.compressionFormat = isCompressed ? 'brotli' : 'none';
          }

          backups.push({
            fileName,
            filePath,
            metadata,
            compressed: isCompressed,
            size: stats.size,
          });
        } catch {
          // Skip backups without valid metadata.
          continue;
        }
      }

      backups.sort(
        (a, b) =>
          new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime(),
      );

      return backups;
    } catch (error) {
      throw new FileOperationError('list backups', this.backupDir, error as Error);
    }
  }

  /** Restore the knowledge graph from a backup file. */
  async restore(backupPath: string): Promise<RestoreResult> {
    try {
      validateFilePath(backupPath, this.backupDir, true);
      const stat = await fs.lstat(backupPath);
      if (stat.isSymbolicLink()) {
        throw new FileOperationError('Symbolic links are not allowed for backup restore', backupPath);
      }

      const isCompressed = hasBrotliExtension(backupPath);
      const backupBuffer = await fs.readFile(backupPath);

      let backupContent: string;
      if (isCompressed) {
        const decompressedBuffer = await decompress(backupBuffer);
        backupContent = decompressedBuffer.toString('utf-8');
      } else {
        backupContent = backupBuffer.toString('utf-8');
      }

      const mainPath = this.storage.getFilePath();
      await fs.writeFile(mainPath, backupContent);

      this.storage.clearCache();

      const graph = await this.storage.loadGraph();

      return {
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        restoredFrom: backupPath,
        wasCompressed: isCompressed,
      };
    } catch (error) {
      throw new FileOperationError('restore from backup', backupPath, error as Error);
    }
  }

  /** Delete a specific backup file (and its metadata sidecar). */
  async delete(backupPath: string): Promise<void> {
    try {
      validateFilePath(backupPath, this.backupDir, true);
      // Prevent symlink-based attacks (consistent with restore()).
      const stat = await fs.lstat(backupPath);
      if (stat.isSymbolicLink()) {
        throw new FileOperationError('Symbolic links are not allowed for backup deletion', backupPath);
      }
      await fs.unlink(backupPath);

      try {
        const baseName = basename(backupPath);
        const metaPath = join(this.backupDir, `${baseName}.meta.json`);
        validateFilePath(metaPath, this.backupDir, true);
        await fs.unlink(metaPath);
      } catch {
        // Metadata file doesn't exist or is outside backup dir — that's ok.
      }
    } catch (error) {
      throw new FileOperationError('delete backup', backupPath, error as Error);
    }
  }

  /** Drop old backups, keeping only the `keepCount` most-recent. Returns the number removed. */
  async cleanOld(keepCount: number = 10): Promise<number> {
    const backups = await this.list();
    if (backups.length <= keepCount) return 0;
    const toDelete = backups.slice(keepCount);
    let removed = 0;
    for (const backup of toDelete) {
      try {
        await this.delete(backup.filePath);
        removed++;
      } catch {
        continue;
      }
    }
    return removed;
  }

  /**
   * Ensure the backup directory exists. Used by `create()`; safe to
   * call multiple times.
   */
  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      throw new FileOperationError('create backup directory', this.backupDir, error as Error);
    }
  }

  /** Generate a timestamped backup filename. */
  private generateFileName(compressed: boolean = true): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\./g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const extension = compressed ? '.jsonl.br' : '.jsonl';
    return `backup_${timestamp}${extension}`;
  }
}
