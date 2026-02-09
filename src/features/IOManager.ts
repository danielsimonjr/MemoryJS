/**
 * IO Manager
 *
 * Unified manager for import, export, and backup operations.
 * Consolidates BackupManager, ExportManager, and ImportManager (Sprint 11.4).
 *
 * @module features/IOManager
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type {
  Entity,
  Relation,
  KnowledgeGraph,
  ReadonlyKnowledgeGraph,
  ImportResult,
  BackupOptions,
  BackupResult,
  RestoreResult,
  ExportOptions,
  ExportResult,
  LongRunningOperationOptions,
} from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { FileOperationError } from '../utils/errors.js';
import {
  compress,
  decompress,
  hasBrotliExtension,
  COMPRESSION_CONFIG,
  STREAMING_CONFIG,
  checkCancellation,
  createProgressReporter,
  createProgress,
  validateFilePath,
  sanitizeObject,
  escapeCsvFormula,
} from '../utils/index.js';
import { StreamingExporter, type StreamResult } from './StreamingExporter.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Supported export formats.
 */
export type ExportFormat = 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid';

/**
 * Supported import formats.
 */
export type ImportFormat = 'json' | 'csv' | 'graphml';

/**
 * Merge strategies for handling existing entities during import.
 */
export type MergeStrategy = 'replace' | 'skip' | 'merge' | 'fail';

/**
 * Metadata stored with each backup.
 * Extended with compression information for Phase 3 Sprint 2.
 */
export interface BackupMetadata {
  /** Timestamp when backup was created (ISO 8601) */
  timestamp: string;
  /** Number of entities in the backup */
  entityCount: number;
  /** Number of relations in the backup */
  relationCount: number;
  /** File size in bytes (compressed size if compressed) */
  fileSize: number;
  /** Optional description/reason for backup */
  description?: string;
  /** Whether the backup is compressed (default: true for new backups) */
  compressed?: boolean;
  /** Original size before compression in bytes */
  originalSize?: number;
  /** Compression ratio achieved (compressedSize / originalSize) */
  compressionRatio?: number;
  /** Compression format used */
  compressionFormat?: 'brotli' | 'none';
}

/**
 * Information about a backup file.
 * Extended with compression details for Phase 3 Sprint 2.
 */
export interface BackupInfo {
  /** Backup file name */
  fileName: string;
  /** Full path to backup file */
  filePath: string;
  /** Backup metadata */
  metadata: BackupMetadata;
  /** Whether the backup is compressed */
  compressed: boolean;
  /** File size in bytes */
  size: number;
}

// ============================================================
// IO MANAGER CLASS
// ============================================================

/**
 * Unified manager for import, export, and backup operations.
 *
 * Combines functionality from:
 * - ExportManager: Graph export to various formats
 * - ImportManager: Graph import from various formats
 * - BackupManager: Point-in-time backup and restore
 */
export class IOManager {
  private readonly backupDir: string;

  constructor(private storage: GraphStorage) {
    const filePath = this.storage.getFilePath();
    const dir = dirname(filePath);
    this.backupDir = join(dir, '.backups');
  }

  // ============================================================
  // EXPORT OPERATIONS
  // ============================================================

  /**
   * Export graph to specified format.
   *
   * @param graph - Knowledge graph to export
   * @param format - Export format
   * @returns Formatted export string
   */
  exportGraph(graph: ReadonlyKnowledgeGraph, format: ExportFormat): string {
    switch (format) {
      case 'json':
        return this.exportAsJson(graph);
      case 'csv':
        return this.exportAsCsv(graph);
      case 'graphml':
        return this.exportAsGraphML(graph);
      case 'gexf':
        return this.exportAsGEXF(graph);
      case 'dot':
        return this.exportAsDOT(graph);
      case 'markdown':
        return this.exportAsMarkdown(graph);
      case 'mermaid':
        return this.exportAsMermaid(graph);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export graph with optional brotli compression.
   *
   * Compression is applied when:
   * - `options.compress` is explicitly set to `true`
   * - The exported content exceeds 100KB (auto-compress threshold)
   *
   * Compressed content is returned as base64-encoded string.
   * Uncompressed content is returned as UTF-8 string.
   *
   * @param graph - Knowledge graph to export
   * @param format - Export format
   * @param options - Export options including compression settings
   * @returns Export result with content and compression metadata
   *
   * @example
   * ```typescript
   * // Export with explicit compression
   * const result = await manager.exportGraphWithCompression(graph, 'json', {
   *   compress: true,
   *   compressionQuality: 11
   * });
   *
   * // Export with auto-compression for large graphs
   * const result = await manager.exportGraphWithCompression(graph, 'json');
   * // Compresses automatically if content > 100KB
   * ```
   */
  async exportGraphWithCompression(
    graph: ReadonlyKnowledgeGraph,
    format: ExportFormat,
    options?: ExportOptions
  ): Promise<ExportResult> {
    // Check if streaming should be used
    const shouldStream = options?.streaming ||
      (options?.outputPath && graph.entities.length >= STREAMING_CONFIG.STREAMING_THRESHOLD);

    if (shouldStream && options?.outputPath) {
      return this.streamExport(format, graph, options as ExportOptions & { outputPath: string });
    }

    // Generate export content using existing method
    const content = this.exportGraph(graph, format);
    const originalSize = Buffer.byteLength(content, 'utf-8');

    // Determine if compression should be applied
    const shouldCompress =
      options?.compress === true ||
      (options?.compress !== false &&
        originalSize > COMPRESSION_CONFIG.AUTO_COMPRESS_EXPORT_SIZE);

    if (shouldCompress) {
      const quality =
        options?.compressionQuality ?? COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH;

      const compressionResult = await compress(content, {
        quality,
        mode: 'text',
      });

      return {
        format,
        content: compressionResult.compressed.toString('base64'),
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        compressed: true,
        encoding: 'base64',
        originalSize,
        compressedSize: compressionResult.compressedSize,
        compressionRatio: compressionResult.ratio,
      };
    }

    // Return uncompressed content
    return {
      format,
      content,
      entityCount: graph.entities.length,
      relationCount: graph.relations.length,
      compressed: false,
      encoding: 'utf-8',
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
    };
  }

  /**
   * Stream export to a file for large graphs.
   *
   * Uses StreamingExporter to write entities and relations incrementally
   * to avoid loading the entire export content into memory.
   *
   * @param format - Export format
   * @param graph - Knowledge graph to export
   * @param options - Export options with required outputPath
   * @returns Export result with streaming metadata
   * @private
   */
  private async streamExport(
    format: ExportFormat,
    graph: ReadonlyKnowledgeGraph,
    options: ExportOptions & { outputPath: string }
  ): Promise<ExportResult> {
    // Validate path to prevent path traversal attacks (defense in depth)
    const validatedOutputPath = validateFilePath(options.outputPath);
    const exporter = new StreamingExporter(validatedOutputPath);
    let result: StreamResult;

    switch (format) {
      case 'json':
        // Use JSONL format for streaming (line-delimited JSON)
        result = await exporter.streamJSONL(graph);
        break;
      case 'csv':
        result = await exporter.streamCSV(graph);
        break;
      default:
        // Fallback to in-memory export for unsupported streaming formats
        const content = this.exportGraph(graph, format);
        await fs.writeFile(validatedOutputPath, content);
        result = {
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          entitiesWritten: graph.entities.length,
          relationsWritten: graph.relations.length,
          durationMs: 0,
        };
    }

    return {
      format,
      content: `Streamed to ${validatedOutputPath}`,
      entityCount: result.entitiesWritten,
      relationCount: result.relationsWritten,
      compressed: false,
      encoding: 'utf-8',
      originalSize: result.bytesWritten,
      compressedSize: result.bytesWritten,
      compressionRatio: 1,
      streamed: true,
      outputPath: validatedOutputPath,
    };
  }

  private exportAsJson(graph: ReadonlyKnowledgeGraph): string {
    return JSON.stringify(graph, null, 2);
  }

  private exportAsCsv(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    const escapeCsvField = (field: string | undefined | null): string => {
      if (field === undefined || field === null) return '';
      // First protect against CSV formula injection
      let str = escapeCsvFormula(String(field));
      // Then handle CSV special characters
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    lines.push('# ENTITIES');
    lines.push('name,entityType,observations,createdAt,lastModified,tags,importance');

    for (const entity of graph.entities) {
      const observationsStr = entity.observations.join('; ');
      const tagsStr = entity.tags ? entity.tags.join('; ') : '';
      const importanceStr = entity.importance !== undefined ? String(entity.importance) : '';

      lines.push(
        [
          escapeCsvField(entity.name),
          escapeCsvField(entity.entityType),
          escapeCsvField(observationsStr),
          escapeCsvField(entity.createdAt),
          escapeCsvField(entity.lastModified),
          escapeCsvField(tagsStr),
          escapeCsvField(importanceStr),
        ].join(',')
      );
    }

    lines.push('');
    lines.push('# RELATIONS');
    lines.push('from,to,relationType,createdAt,lastModified');

    for (const relation of graph.relations) {
      lines.push(
        [
          escapeCsvField(relation.from),
          escapeCsvField(relation.to),
          escapeCsvField(relation.relationType),
          escapeCsvField(relation.createdAt),
          escapeCsvField(relation.lastModified),
        ].join(',')
      );
    }

    return lines.join('\n');
  }

  private exportAsGraphML(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    const escapeXml = (str: string | undefined | null): string => {
      if (str === undefined || str === null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
    lines.push('  <key id="d0" for="node" attr.name="entityType" attr.type="string"/>');
    lines.push('  <key id="d1" for="node" attr.name="observations" attr.type="string"/>');
    lines.push('  <key id="d2" for="node" attr.name="createdAt" attr.type="string"/>');
    lines.push('  <key id="d3" for="node" attr.name="lastModified" attr.type="string"/>');
    lines.push('  <key id="d4" for="node" attr.name="tags" attr.type="string"/>');
    lines.push('  <key id="d5" for="node" attr.name="importance" attr.type="double"/>');
    lines.push('  <key id="e0" for="edge" attr.name="relationType" attr.type="string"/>');
    lines.push('  <key id="e1" for="edge" attr.name="createdAt" attr.type="string"/>');
    lines.push('  <key id="e2" for="edge" attr.name="lastModified" attr.type="string"/>');
    lines.push('  <graph id="G" edgedefault="directed">');

    for (const entity of graph.entities) {
      const nodeId = escapeXml(entity.name);
      lines.push(`    <node id="${nodeId}">`);
      lines.push(`      <data key="d0">${escapeXml(entity.entityType)}</data>`);
      lines.push(`      <data key="d1">${escapeXml(entity.observations.join('; '))}</data>`);
      if (entity.createdAt) lines.push(`      <data key="d2">${escapeXml(entity.createdAt)}</data>`);
      if (entity.lastModified) lines.push(`      <data key="d3">${escapeXml(entity.lastModified)}</data>`);
      if (entity.tags?.length) lines.push(`      <data key="d4">${escapeXml(entity.tags.join('; '))}</data>`);
      if (entity.importance !== undefined) lines.push(`      <data key="d5">${entity.importance}</data>`);
      lines.push('    </node>');
    }

    let edgeId = 0;
    for (const relation of graph.relations) {
      const sourceId = escapeXml(relation.from);
      const targetId = escapeXml(relation.to);
      lines.push(`    <edge id="e${edgeId}" source="${sourceId}" target="${targetId}">`);
      lines.push(`      <data key="e0">${escapeXml(relation.relationType)}</data>`);
      if (relation.createdAt) lines.push(`      <data key="e1">${escapeXml(relation.createdAt)}</data>`);
      if (relation.lastModified) lines.push(`      <data key="e2">${escapeXml(relation.lastModified)}</data>`);
      lines.push('    </edge>');
      edgeId++;
    }

    lines.push('  </graph>');
    lines.push('</graphml>');
    return lines.join('\n');
  }

  private exportAsGEXF(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    const escapeXml = (str: string | undefined | null): string => {
      if (str === undefined || str === null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">');
    lines.push('  <meta>');
    lines.push('    <creator>Memory MCP Server</creator>');
    lines.push('  </meta>');
    lines.push('  <graph mode="static" defaultedgetype="directed">');
    lines.push('    <attributes class="node">');
    lines.push('      <attribute id="0" title="entityType" type="string"/>');
    lines.push('      <attribute id="1" title="observations" type="string"/>');
    lines.push('    </attributes>');
    lines.push('    <nodes>');

    for (const entity of graph.entities) {
      const nodeId = escapeXml(entity.name);
      lines.push(`      <node id="${nodeId}" label="${nodeId}">`);
      lines.push('        <attvalues>');
      lines.push(`          <attvalue for="0" value="${escapeXml(entity.entityType)}"/>`);
      lines.push(`          <attvalue for="1" value="${escapeXml(entity.observations.join('; '))}"/>`);
      lines.push('        </attvalues>');
      lines.push('      </node>');
    }

    lines.push('    </nodes>');
    lines.push('    <edges>');

    let edgeId = 0;
    for (const relation of graph.relations) {
      const sourceId = escapeXml(relation.from);
      const targetId = escapeXml(relation.to);
      const label = escapeXml(relation.relationType);
      lines.push(`      <edge id="${edgeId}" source="${sourceId}" target="${targetId}" label="${label}"/>`);
      edgeId++;
    }

    lines.push('    </edges>');
    lines.push('  </graph>');
    lines.push('</gexf>');
    return lines.join('\n');
  }

  private exportAsDOT(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    const escapeDot = (str: string): string => {
      return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    };

    lines.push('digraph KnowledgeGraph {');
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=rounded];');
    lines.push('');

    for (const entity of graph.entities) {
      const nodeId = escapeDot(entity.name);
      const label = [`${entity.name}`, `Type: ${entity.entityType}`];
      if (entity.tags?.length) label.push(`Tags: ${entity.tags.join(', ')}`);
      const labelStr = escapeDot(label.join('\\n'));
      lines.push(`  ${nodeId} [label=${labelStr}];`);
    }

    lines.push('');

    for (const relation of graph.relations) {
      const fromId = escapeDot(relation.from);
      const toId = escapeDot(relation.to);
      const label = escapeDot(relation.relationType);
      lines.push(`  ${fromId} -> ${toId} [label=${label}];`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private exportAsMarkdown(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    lines.push('# Knowledge Graph Export');
    lines.push('');
    lines.push(`**Exported:** ${new Date().toISOString()}`);
    lines.push(`**Entities:** ${graph.entities.length}`);
    lines.push(`**Relations:** ${graph.relations.length}`);
    lines.push('');
    lines.push('## Entities');
    lines.push('');

    for (const entity of graph.entities) {
      lines.push(`### ${entity.name}`);
      lines.push('');
      lines.push(`- **Type:** ${entity.entityType}`);
      if (entity.tags?.length) lines.push(`- **Tags:** ${entity.tags.map(t => `\`${t}\``).join(', ')}`);
      if (entity.importance !== undefined) lines.push(`- **Importance:** ${entity.importance}/10`);
      if (entity.observations.length > 0) {
        lines.push('');
        lines.push('**Observations:**');
        for (const obs of entity.observations) {
          lines.push(`- ${obs}`);
        }
      }
      lines.push('');
    }

    if (graph.relations.length > 0) {
      lines.push('## Relations');
      lines.push('');
      for (const relation of graph.relations) {
        lines.push(`- **${relation.from}** → *${relation.relationType}* → **${relation.to}**`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private exportAsMermaid(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];

    const sanitizeId = (str: string): string => str.replace(/[^a-zA-Z0-9_]/g, '_');
    const escapeLabel = (str: string): string => str.replace(/"/g, '#quot;');

    lines.push('graph LR');
    lines.push('  %% Knowledge Graph');
    lines.push('');

    const nodeIds = new Map<string, string>();
    for (const entity of graph.entities) {
      nodeIds.set(entity.name, sanitizeId(entity.name));
    }

    for (const entity of graph.entities) {
      const nodeId = nodeIds.get(entity.name)!;
      const labelParts: string[] = [entity.name, `Type: ${entity.entityType}`];
      if (entity.tags?.length) labelParts.push(`Tags: ${entity.tags.join(', ')}`);
      const label = escapeLabel(labelParts.join('<br/>'));
      lines.push(`  ${nodeId}["${label}"]`);
    }

    lines.push('');

    for (const relation of graph.relations) {
      const fromId = nodeIds.get(relation.from);
      const toId = nodeIds.get(relation.to);
      if (fromId && toId) {
        const label = escapeLabel(relation.relationType);
        lines.push(`  ${fromId} -->|"${label}"| ${toId}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================
  // IMPORT OPERATIONS
  // ============================================================

  /**
   * Import graph from formatted data.
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * @param format - Import format
   * @param data - Import data string
   * @param mergeStrategy - How to handle conflicts
   * @param dryRun - If true, preview changes without applying
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Import result with statistics
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   */
  async importGraph(
    format: ImportFormat,
    data: string,
    mergeStrategy: MergeStrategy = 'skip',
    dryRun: boolean = false,
    options?: LongRunningOperationOptions
  ): Promise<ImportResult> {
    // Check for early cancellation
    checkCancellation(options?.signal, 'importGraph');

    // Setup progress reporter
    const reportProgress = createProgressReporter(options?.onProgress);
    reportProgress?.(createProgress(0, 100, 'importGraph'));

    let importedGraph: KnowledgeGraph;

    try {
      // Parsing phase (0-20% progress)
      reportProgress?.(createProgress(5, 100, 'parsing data'));
      checkCancellation(options?.signal, 'importGraph');

      switch (format) {
        case 'json':
          importedGraph = this.parseJsonImport(data);
          break;
        case 'csv':
          importedGraph = this.parseCsvImport(data);
          break;
        case 'graphml':
          importedGraph = this.parseGraphMLImport(data);
          break;
        default:
          throw new Error(`Unsupported import format: ${format}`);
      }

      reportProgress?.(createProgress(20, 100, 'parsing complete'));
    } catch (error) {
      return {
        entitiesAdded: 0,
        entitiesSkipped: 0,
        entitiesUpdated: 0,
        relationsAdded: 0,
        relationsSkipped: 0,
        errors: [`Failed to parse ${format} data: ${error instanceof Error ? error.message : String(error)}`],
      };
    }

    // Merging phase (20-100% progress)
    return await this.mergeImportedGraph(importedGraph, mergeStrategy, dryRun, options);
  }

  private parseJsonImport(data: string): KnowledgeGraph {
    // Security: Limit input size to prevent DoS (10MB max)
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
    if (data.length > MAX_IMPORT_SIZE) {
      throw new FileOperationError(
        `JSON import data exceeds maximum size of ${MAX_IMPORT_SIZE / (1024 * 1024)}MB`,
        'json-import'
      );
    }

    const parsed = JSON.parse(data);

    if (!parsed.entities || !Array.isArray(parsed.entities)) {
      throw new Error('Invalid JSON: missing or invalid entities array');
    }
    if (!parsed.relations || !Array.isArray(parsed.relations)) {
      throw new Error('Invalid JSON: missing or invalid relations array');
    }

    // Security: Limit maximum number of entities/relations
    const MAX_ITEMS = 100000;
    if (parsed.entities.length > MAX_ITEMS) {
      throw new FileOperationError(
        `JSON import exceeds maximum entity count of ${MAX_ITEMS}`,
        'json-import'
      );
    }
    if (parsed.relations.length > MAX_ITEMS) {
      throw new FileOperationError(
        `JSON import exceeds maximum relation count of ${MAX_ITEMS}`,
        'json-import'
      );
    }

    return {
      entities: parsed.entities as Entity[],
      relations: parsed.relations as Relation[],
    };
  }

  private parseCsvImport(data: string): KnowledgeGraph {
    // Security: Limit input size to prevent DoS (10MB max)
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
    if (data.length > MAX_IMPORT_SIZE) {
      throw new FileOperationError(
        `CSV import data exceeds maximum size of ${MAX_IMPORT_SIZE / (1024 * 1024)}MB`,
        'csv-import'
      );
    }

    // Security: Limit maximum number of entities/relations
    const MAX_ITEMS = 100000;

    const lines = data
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    let section: 'entities' | 'relations' | null = null;
    let headerParsed = false;

    const parseCsvLine = (line: string): string[] => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          fields.push(current);
          current = '';
        } else {
          current += char;
        }
      }

      fields.push(current);
      return fields;
    };

    for (const line of lines) {
      if (line.startsWith('# ENTITIES')) {
        section = 'entities';
        headerParsed = false;
        continue;
      } else if (line.startsWith('# RELATIONS')) {
        section = 'relations';
        headerParsed = false;
        continue;
      }

      if (line.startsWith('#')) continue;

      if (section === 'entities') {
        if (!headerParsed) {
          headerParsed = true;
          continue;
        }

        const fields = parseCsvLine(line);
        if (fields.length >= 2) {
          // Security: Check entity limit
          if (entities.length >= MAX_ITEMS) {
            throw new FileOperationError(
              `CSV import exceeds maximum entity count of ${MAX_ITEMS}`,
              'csv-import'
            );
          }
          const entity: Entity = {
            name: fields[0],
            entityType: fields[1],
            observations: fields[2]
              ? fields[2]
                  .split(';')
                  .map(s => s.trim())
                  .filter(s => s)
              : [],
            createdAt: fields[3] || undefined,
            lastModified: fields[4] || undefined,
            tags: fields[5]
              ? fields[5]
                  .split(';')
                  .map(s => s.trim().toLowerCase())
                  .filter(s => s)
              : undefined,
            importance: fields[6] ? parseFloat(fields[6]) : undefined,
          };
          entities.push(entity);
        }
      } else if (section === 'relations') {
        if (!headerParsed) {
          headerParsed = true;
          continue;
        }

        const fields = parseCsvLine(line);
        if (fields.length >= 3) {
          // Security: Check relation limit
          if (relations.length >= MAX_ITEMS) {
            throw new FileOperationError(
              `CSV import exceeds maximum relation count of ${MAX_ITEMS}`,
              'csv-import'
            );
          }
          const relation: Relation = {
            from: fields[0],
            to: fields[1],
            relationType: fields[2],
            createdAt: fields[3] || undefined,
            lastModified: fields[4] || undefined,
          };
          relations.push(relation);
        }
      }
    }

    return { entities, relations };
  }

  private parseGraphMLImport(data: string): KnowledgeGraph {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Security: Limit input size to prevent ReDoS attacks (10MB max)
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
    if (data.length > MAX_IMPORT_SIZE) {
      throw new FileOperationError(
        `GraphML import data exceeds maximum size of ${MAX_IMPORT_SIZE / (1024 * 1024)}MB`,
        'graphml-import'
      );
    }

    // Security: Limit maximum number of entities/relations to prevent infinite loops
    const MAX_ITEMS = 100000;
    let nodeCount = 0;
    let relationCount = 0;

    // Use non-greedy patterns with character class restrictions
    const nodeRegex = /<node\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/node>/g;
    let nodeMatch;

    while ((nodeMatch = nodeRegex.exec(data)) !== null) {
      // Security: Limit iterations to prevent ReDoS
      if (++nodeCount > MAX_ITEMS) {
        throw new FileOperationError(
          `GraphML import exceeds maximum entity count of ${MAX_ITEMS}`,
          'graphml-import'
        );
      }
      const nodeId = nodeMatch[1];
      const nodeContent = nodeMatch[2];

      // Escape RegExp special chars for safe use in dynamic regex
      const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const getDataValue = (key: string): string | undefined => {
        const dataRegex = new RegExp(`<data\\s+key="${escapeRegExp(key)}">([^<]*)<\\/data>`);
        const match = dataRegex.exec(nodeContent);
        return match ? match[1] : undefined;
      };

      // Decode XML entities without stripping characters (preserves "AT&T", "O'Brien")
      const decodeXmlEntities = (v: string): string =>
        v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

      const entity: Entity = {
        name: decodeXmlEntities(nodeId),
        entityType: decodeXmlEntities(getDataValue('d0') || getDataValue('entityType') || 'unknown'),
        observations: decodeXmlEntities(getDataValue('d1') || getDataValue('observations') || '')
          .split(';')
          .map(s => s.trim())
          .filter(s => s),
        createdAt: decodeXmlEntities(getDataValue('d2') || getDataValue('createdAt') || ''),
        lastModified: decodeXmlEntities(getDataValue('d3') || getDataValue('lastModified') || ''),
        tags: decodeXmlEntities(getDataValue('d4') || getDataValue('tags') || '')
          .split(';')
          .map(s => s.trim().toLowerCase())
          .filter(s => s),
        importance: getDataValue('d5') || getDataValue('importance') ? parseFloat(getDataValue('d5') || getDataValue('importance') || '0') : undefined,
      };

      entities.push(entity);
    }

    const edgeRegex = /<edge\s+[^>]*source="([^"]+)"\s+target="([^"]+)"[^>]*>([\s\S]*?)<\/edge>/g;
    let edgeMatch;

    while ((edgeMatch = edgeRegex.exec(data)) !== null) {
      // Security: Limit iterations to prevent ReDoS
      if (++relationCount > MAX_ITEMS) {
        throw new FileOperationError(
          `GraphML import exceeds maximum relation count of ${MAX_ITEMS}`,
          'graphml-import'
        );
      }
      const source = edgeMatch[1];
      const target = edgeMatch[2];
      const edgeContent = edgeMatch[3];

      const escapeRegExpEdge = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const getDataValue = (key: string): string | undefined => {
        const dataRegex = new RegExp(`<data\\s+key="${escapeRegExpEdge(key)}">([^<]*)<\\/data>`);
        const match = dataRegex.exec(edgeContent);
        return match ? match[1] : undefined;
      };

      const decodeXmlEnt = (v: string): string =>
        v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

      const relation: Relation = {
        from: decodeXmlEnt(source),
        to: decodeXmlEnt(target),
        relationType: decodeXmlEnt(getDataValue('e0') || getDataValue('relationType') || 'related_to'),
        createdAt: decodeXmlEnt(getDataValue('e1') || getDataValue('createdAt') || ''),
        lastModified: decodeXmlEnt(getDataValue('e2') || getDataValue('lastModified') || ''),
      };

      relations.push(relation);
    }

    return { entities, relations };
  }

  private async mergeImportedGraph(
    importedGraph: KnowledgeGraph,
    mergeStrategy: MergeStrategy,
    dryRun: boolean,
    options?: LongRunningOperationOptions
  ): Promise<ImportResult> {
    // Check for cancellation
    checkCancellation(options?.signal, 'importGraph');

    // Setup progress reporter (we're at 20% from parsing, need to go to 100%)
    const reportProgress = createProgressReporter(options?.onProgress);

    const existingGraph = await this.storage.getGraphForMutation();
    const result: ImportResult = {
      entitiesAdded: 0,
      entitiesSkipped: 0,
      entitiesUpdated: 0,
      relationsAdded: 0,
      relationsSkipped: 0,
      errors: [],
    };

    const existingEntitiesMap = new Map<string, Entity>();
    for (const entity of existingGraph.entities) {
      existingEntitiesMap.set(entity.name, entity);
    }

    const existingRelationsSet = new Set<string>();
    for (const relation of existingGraph.relations) {
      existingRelationsSet.add(`${relation.from}|${relation.to}|${relation.relationType}`);
    }

    // Process entities (20-60% progress)
    const totalEntities = importedGraph.entities.length;
    const totalRelations = importedGraph.relations.length;
    let processedEntities = 0;

    for (const importedEntity of importedGraph.entities) {
      // Check for cancellation periodically
      checkCancellation(options?.signal, 'importGraph');

      const existing = existingEntitiesMap.get(importedEntity.name);

      if (!existing) {
        result.entitiesAdded++;
        if (!dryRun) {
          existingGraph.entities.push(importedEntity);
          existingEntitiesMap.set(importedEntity.name, importedEntity);
        }
      } else {
        switch (mergeStrategy) {
          case 'replace':
            result.entitiesUpdated++;
            if (!dryRun) {
              // Sanitize imported entity to prevent prototype pollution
              Object.assign(existing, sanitizeObject(importedEntity as unknown as Record<string, unknown>));
            }
            break;

          case 'skip':
            result.entitiesSkipped++;
            break;

          case 'merge':
            result.entitiesUpdated++;
            if (!dryRun) {
              existing.observations = [
                ...new Set([...existing.observations, ...importedEntity.observations]),
              ];
              if (importedEntity.tags) {
                existing.tags = existing.tags || [];
                existing.tags = [...new Set([...existing.tags, ...importedEntity.tags])];
              }
              if (importedEntity.importance !== undefined) {
                existing.importance = importedEntity.importance;
              }
              existing.lastModified = new Date().toISOString();
            }
            break;

          case 'fail':
            result.errors.push(`Entity "${importedEntity.name}" already exists`);
            break;
        }
      }

      processedEntities++;
      // Map entity progress (0-100%) to overall progress (20-60%)
      const entityProgress = totalEntities > 0 ? Math.round(20 + (processedEntities / totalEntities) * 40) : 60;
      reportProgress?.(createProgress(entityProgress, 100, 'importing entities'));
    }

    reportProgress?.(createProgress(60, 100, 'importing relations'));

    // Process relations (60-95% progress)
    let processedRelations = 0;

    for (const importedRelation of importedGraph.relations) {
      // Check for cancellation periodically
      checkCancellation(options?.signal, 'importGraph');

      const relationKey = `${importedRelation.from}|${importedRelation.to}|${importedRelation.relationType}`;

      if (!existingEntitiesMap.has(importedRelation.from)) {
        result.errors.push(`Relation source entity "${importedRelation.from}" does not exist`);
        processedRelations++;
        continue;
      }
      if (!existingEntitiesMap.has(importedRelation.to)) {
        result.errors.push(`Relation target entity "${importedRelation.to}" does not exist`);
        processedRelations++;
        continue;
      }

      if (!existingRelationsSet.has(relationKey)) {
        result.relationsAdded++;
        if (!dryRun) {
          existingGraph.relations.push(importedRelation);
          existingRelationsSet.add(relationKey);
        }
      } else {
        if (mergeStrategy === 'fail') {
          result.errors.push(`Relation "${relationKey}" already exists`);
        } else {
          result.relationsSkipped++;
        }
      }

      processedRelations++;
      // Map relation progress (0-100%) to overall progress (60-95%)
      const relationProgress = totalRelations > 0 ? Math.round(60 + (processedRelations / totalRelations) * 35) : 95;
      reportProgress?.(createProgress(relationProgress, 100, 'importing relations'));
    }

    // Check for cancellation before final save
    checkCancellation(options?.signal, 'importGraph');
    reportProgress?.(createProgress(95, 100, 'saving graph'));

    if (!dryRun && (mergeStrategy !== 'fail' || result.errors.length === 0)) {
      await this.storage.saveGraph(existingGraph);
    }

    // Report completion
    reportProgress?.(createProgress(100, 100, 'importGraph'));

    return result;
  }

  // ============================================================
  // BACKUP OPERATIONS
  // ============================================================

  /**
   * Ensure backup directory exists.
   */
  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      throw new FileOperationError('create backup directory', this.backupDir, error as Error);
    }
  }

  /**
   * Generate backup file name with timestamp.
   * @param compressed - Whether the backup will be compressed (affects extension)
   */
  private generateBackupFileName(compressed: boolean = true): string {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/:/g, '-')
      .replace(/\./g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const extension = compressed ? '.jsonl.br' : '.jsonl';
    return `backup_${timestamp}${extension}`;
  }

  /**
   * Create a backup of the current knowledge graph.
   *
   * By default, backups are compressed with brotli for 50-70% space reduction.
   * Use `options.compress = false` to create uncompressed backups.
   *
   * @param options - Backup options (compress, description) or legacy description string
   * @returns Promise resolving to BackupResult with compression statistics
   *
   * @example
   * ```typescript
   * // Compressed backup (default)
   * const result = await manager.createBackup({ description: 'Pre-migration backup' });
   * console.log(`Compressed from ${result.originalSize} to ${result.compressedSize} bytes`);
   *
   * // Uncompressed backup
   * const result = await manager.createBackup({ compress: false });
   * ```
   */
  async createBackup(options?: BackupOptions | string): Promise<BackupResult> {
    await this.ensureBackupDir();

    // Handle legacy string argument (backward compatibility)
    const opts: BackupOptions = typeof options === 'string'
      ? { description: options, compress: COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP }
      : { compress: COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP, ...options };

    const shouldCompress = opts.compress ?? COMPRESSION_CONFIG.AUTO_COMPRESS_BACKUP;
    const graph = await this.storage.loadGraph();
    const timestamp = new Date().toISOString();
    const fileName = this.generateBackupFileName(shouldCompress);
    const backupPath = join(this.backupDir, fileName);

    try {
      const originalPath = this.storage.getFilePath();
      let fileContent: string;

      try {
        fileContent = await fs.readFile(originalPath, 'utf-8');
      } catch {
        // If file doesn't exist, generate content from graph
        const lines = [
          ...graph.entities.map(e => JSON.stringify({ type: 'entity', ...e })),
          ...graph.relations.map(r => JSON.stringify({ type: 'relation', ...r })),
        ];
        fileContent = lines.join('\n');
      }

      const originalSize = Buffer.byteLength(fileContent, 'utf-8');
      let compressedSize = originalSize;
      let compressionRatio = 1;

      if (shouldCompress) {
        // Compress with maximum quality for backups (archive quality)
        const compressionResult = await compress(fileContent, {
          quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
          mode: 'text',
        });

        await fs.writeFile(backupPath, compressionResult.compressed);
        compressedSize = compressionResult.compressedSize;
        compressionRatio = compressionResult.ratio;
      } else {
        // Write uncompressed backup
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

  /**
   * List all available backups, sorted by timestamp (newest first).
   *
   * Detects both compressed (.jsonl.br) and uncompressed (.jsonl) backups.
   *
   * @returns Promise resolving to array of backup information with compression details
   */
  async listBackups(): Promise<BackupInfo[]> {
    try {
      try {
        await fs.access(this.backupDir);
      } catch {
        return [];
      }

      const files = await fs.readdir(this.backupDir);
      // Match both .jsonl and .jsonl.br backup files, exclude metadata files
      const backupFiles = files.filter(f =>
        f.startsWith('backup_') &&
        (f.endsWith('.jsonl') || f.endsWith('.jsonl.br')) &&
        !f.endsWith('.meta.json')
      );

      const backups: BackupInfo[] = [];

      for (const fileName of backupFiles) {
        const filePath = join(this.backupDir, fileName);
        const isCompressed = hasBrotliExtension(fileName);

        // Try to read metadata file (handles both .jsonl.meta.json and .jsonl.br.meta.json)
        const metadataPath = `${filePath}.meta.json`;

        try {
          const [metadataContent, stats] = await Promise.all([
            fs.readFile(metadataPath, 'utf-8'),
            fs.stat(filePath),
          ]);
          const metadata: BackupMetadata = JSON.parse(metadataContent);

          // Ensure compression fields are present (backward compatibility)
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
          // Skip backups without valid metadata
          continue;
        }
      }

      backups.sort((a, b) =>
        new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
      );

      return backups;
    } catch (error) {
      throw new FileOperationError('list backups', this.backupDir, error as Error);
    }
  }

  /**
   * Restore the knowledge graph from a backup file.
   *
   * Automatically detects and decompresses brotli-compressed backups (.br extension).
   * Maintains backward compatibility with uncompressed backups.
   *
   * @param backupPath - Path to the backup file to restore from
   * @returns Promise resolving to RestoreResult with restoration details
   *
   * @example
   * ```typescript
   * // Restore from compressed backup
   * const result = await manager.restoreFromBackup('/path/to/backup.jsonl.br');
   * console.log(`Restored ${result.entityCount} entities from compressed backup`);
   *
   * // Restore from uncompressed backup (legacy)
   * const result = await manager.restoreFromBackup('/path/to/backup.jsonl');
   * ```
   */
  async restoreFromBackup(backupPath: string): Promise<RestoreResult> {
    try {
      validateFilePath(backupPath, this.backupDir, true);
      await fs.access(backupPath);

      const isCompressed = hasBrotliExtension(backupPath);
      const backupBuffer = await fs.readFile(backupPath);

      let backupContent: string;
      if (isCompressed) {
        // Decompress the backup
        const decompressedBuffer = await decompress(backupBuffer);
        backupContent = decompressedBuffer.toString('utf-8');
      } else {
        // Read as plain text
        backupContent = backupBuffer.toString('utf-8');
      }

      const mainPath = this.storage.getFilePath();
      await fs.writeFile(mainPath, backupContent);

      this.storage.clearCache();

      // Load the restored graph to get counts
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

  /**
   * Delete a specific backup file.
   *
   * @param backupPath - Path to the backup file to delete
   */
  async deleteBackup(backupPath: string): Promise<void> {
    try {
      validateFilePath(backupPath, this.backupDir, true);
      await fs.unlink(backupPath);

      try {
        const metaPath = join(dirname(backupPath), `${backupPath.split(/[/\\]/).pop()}.meta.json`);
        validateFilePath(metaPath, this.backupDir, true);
        await fs.unlink(metaPath);
      } catch {
        // Metadata file doesn't exist or is outside backup dir - that's ok
      }
    } catch (error) {
      throw new FileOperationError('delete backup', backupPath, error as Error);
    }
  }

  /**
   * Clean old backups, keeping only the most recent N backups.
   *
   * @param keepCount - Number of recent backups to keep (default: 10)
   * @returns Promise resolving to number of backups deleted
   */
  async cleanOldBackups(keepCount: number = 10): Promise<number> {
    const backups = await this.listBackups();

    if (backups.length <= keepCount) {
      return 0;
    }

    const backupsToDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of backupsToDelete) {
      try {
        await this.deleteBackup(backup.filePath);
        deletedCount++;
      } catch {
        continue;
      }
    }

    return deletedCount;
  }

  /**
   * Get the path to the backup directory.
   */
  getBackupDir(): string {
    return this.backupDir;
  }
}
