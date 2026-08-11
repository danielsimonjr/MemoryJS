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
import {
  fireGovernanceAudits,
  preflightGovernedGraphMutation,
  type GovernanceHooks,
} from '../core/EntityManager.js';
import { FileOperationError } from '../utils/errors.js';
import {
  compress,
  decompress,
  hasBrotliExtension,
  COMPRESSION_CONFIG,
} from '../utils/index.js';
import { sanitizeObject, validateFilePath } from '../utils/entityUtils.js';
import { PiiRedactor } from '../security/PiiRedactor.js';
import type {
  BackupOptions,
  BackupResult,
  Entity,
  KnowledgeGraph,
  Relation,
  RestoreResult,
} from '../types/index.js';
import type { BackupMetadata, BackupInfo, PiiRedactionOption } from './IOManager.js';
import { durableWriteFile } from '../utils/durableWriteFile.js';
import { GovernanceError } from './GovernanceManager.js';

// Canonical `BackupMetadata` / `BackupInfo` live in IOManager.ts (the optional
// compression fields honestly describe pre-compression backup metas read from
// disk). Re-exported here (same binding — type-only, so the
// IOManager -> BackupManager value-import cycle is erased at compile time)
// for callers that import from this module directly.
export type { BackupMetadata, BackupInfo } from './IOManager.js';

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
    private readonly governanceHooks?: GovernanceHooks,
  ) {}

  /** Get the path to the backup directory. */
  getDir(): string {
    return this.backupDir;
  }

  /**
   * Create a backup of the current knowledge graph.
   *
   * Sec6: `redactPii: true` synthesizes the backup from the parsed graph
   * with PII-redacted observation COPIES (never a raw file copy, and the
   * live graph is untouched). Default `false` = byte-identical raw-file
   * backup, exactly as before.
   */
  async create(options?: (BackupOptions & PiiRedactionOption) | string): Promise<BackupResult> {
    await this.ensureDir();

    // Legacy string-arg compatibility — pre-Phase-2 callers passed
    // just a description.
    const opts: BackupOptions & PiiRedactionOption = typeof options === 'string'
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

      if (opts.redactPii) {
        // Sec6: build the backup from the graph with redacted observation
        // copies. A raw-file copy would require text-mangling the storage
        // file (unsafe for the SQLite binary format); synthesizing from
        // the parsed graph redacts structurally and backend-agnostically.
        const redacted = new PiiRedactor().redactGraph(graph);
        fileContent = this.serializeGraph(redacted);
      } else {
        try {
          const raw = await fs.readFile(originalPath);
          // SQLite backups must use the portable graph JSONL representation;
          // interpreting the binary database as UTF-8 creates an unrestorable
          // backup and cannot safely be written over an open connection.
          fileContent = raw.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000'
            ? this.serializeGraph(graph)
            : raw.toString('utf8');
        } catch {
          fileContent = this.serializeGraph(graph);
        }
      }

      const originalSize = Buffer.byteLength(fileContent, 'utf-8');
      let compressedSize = originalSize;
      let compressionRatio = 1;

      if (shouldCompress) {
        const compressionResult = await compress(fileContent, {
          quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
          mode: 'text',
        });
        await durableWriteFile(backupPath, compressionResult.compressed);
        compressedSize = compressionResult.compressedSize;
        compressionRatio = compressionResult.ratio;
      } else {
        await durableWriteFile(backupPath, fileContent);
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
      await durableWriteFile(metadataPath, JSON.stringify(metadata, null, 2));

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
      const validatedBackupPath = validateFilePath(backupPath, this.backupDir, true);
      const stat = await fs.lstat(validatedBackupPath);
      if (stat.isSymbolicLink()) {
        throw new FileOperationError(
          'Symbolic links are not allowed for backup restore',
          validatedBackupPath,
        );
      }

      const isCompressed = hasBrotliExtension(validatedBackupPath);
      const backupBuffer = await fs.readFile(validatedBackupPath);

      let backupContent: string;
      if (isCompressed) {
        const decompressedBuffer = await decompress(backupBuffer);
        backupContent = decompressedBuffer.toString('utf-8');
      } else {
        backupContent = backupBuffer.toString('utf-8');
      }

      const beforeGraph = await this.storage.loadGraph();
      const graph = this.parseBackupGraph(backupContent);
      const auditEvents = preflightGovernedGraphMutation(
        this.governanceHooks,
        beforeGraph,
        graph,
      );
      await this.storage.saveGraph(graph);
      fireGovernanceAudits(this.governanceHooks, auditEvents, 'BackupManager');

      return {
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        restoredFrom: validatedBackupPath,
        wasCompressed: isCompressed,
      };
    } catch (error) {
      if (error instanceof GovernanceError) throw error;
      throw new FileOperationError('restore from backup', backupPath, error as Error);
    }
  }

  /** Delete a specific backup file (and its metadata sidecar). */
  async delete(backupPath: string): Promise<void> {
    try {
      const validatedBackupPath = validateFilePath(backupPath, this.backupDir, true);
      // Prevent symlink-based attacks (consistent with restore()).
      const stat = await fs.lstat(validatedBackupPath);
      if (stat.isSymbolicLink()) {
        throw new FileOperationError(
          'Symbolic links are not allowed for backup deletion',
          validatedBackupPath,
        );
      }
      await fs.unlink(validatedBackupPath);

      try {
        const baseName = basename(validatedBackupPath);
        const metaPath = join(this.backupDir, `${baseName}.meta.json`);
        const validatedMetaPath = validateFilePath(metaPath, this.backupDir, true);
        await fs.unlink(validatedMetaPath);
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
      await fs.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.backupDir, 0o700);
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

  /**
   * Parse the JSONL representation emitted by GraphStorage/backup creation.
   * Invalid lines retain the historical best-effort restore behaviour.
   */
  private parseBackupGraph(content: string): KnowledgeGraph {
    const entityMap = new Map<string, Entity>();
    const relationMap = new Map<string, Relation>();

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = sanitizeObject(JSON.parse(line) as Record<string, unknown>);
        if (raw['type'] === 'entity') {
          const candidate = { ...raw };
          delete candidate['type'];
          if (
            typeof candidate['name'] === 'string' &&
            candidate['name'].length > 0 &&
            typeof candidate['entityType'] === 'string' &&
            Array.isArray(candidate['observations']) &&
            candidate['observations'].every(value => typeof value === 'string')
          ) {
            const entity = candidate as unknown as Entity;
            entity.createdAt ??= new Date().toISOString();
            entity.lastModified ??= entity.createdAt;
            entityMap.set(entity.name, entity);
          }
        } else if (raw['type'] === 'relation') {
          const candidate = { ...raw };
          delete candidate['type'];
          if (
            typeof candidate['from'] === 'string' &&
            typeof candidate['to'] === 'string' &&
            typeof candidate['relationType'] === 'string'
          ) {
            const relation = candidate as unknown as Relation;
            relation.createdAt ??= new Date().toISOString();
            relation.lastModified ??= relation.createdAt;
            relationMap.set(
              `${relation.from}\u0000${relation.to}\u0000${relation.relationType}`,
              relation,
            );
          }
        }
      } catch {
        // Match GraphStorage's recovery-friendly malformed-line handling.
      }
    }

    return {
      entities: [...entityMap.values()],
      relations: [...relationMap.values()],
    };
  }

  /** Serialize a backend-independent JSONL backup. */
  private serializeGraph(graph: {
    entities: readonly Entity[];
    relations: readonly Relation[];
  }): string {
    return [
      ...graph.entities.map(entity => JSON.stringify({ type: 'entity', ...entity })),
      ...graph.relations.map(relation => JSON.stringify({ type: 'relation', ...relation })),
    ].join('\n');
  }
}
