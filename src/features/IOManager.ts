/** Unified manager for import, export, and backup operations. */

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
import { BackupManager } from './BackupManager.js';
import { EntitySchema, RelationSchema } from '../utils/schemas.js';
import { PiiRedactor } from '../security/PiiRedactor.js';

/**
 * Sec6 — opt-in PII redaction for export/backup surfaces.
 *
 * When `redactPii: true`, observation strings are passed through
 * {@link PiiRedactor} on a DEEP-COPIED text path of the exported data —
 * the live graph is never mutated. Default `false` keeps output
 * byte-identical to previous releases.
 */
export interface PiiRedactionOption {
  /** Redact PII (email/phone/SSN/CC/IP) from exported observation text. */
  redactPii?: boolean;
}

/** Shared default redactor — stateless, safe to reuse across calls. */
const DEFAULT_EXPORT_REDACTOR = new PiiRedactor();

export type ExportFormat = 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid' | 'turtle' | 'rdf-xml' | 'json-ld';
export type ImportFormat = 'json' | 'csv' | 'graphml';
export type MergeStrategy = 'replace' | 'skip' | 'merge' | 'fail';

export interface IngestInput {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
  source?: string;
  metadata?: Record<string, unknown>;
}

// ==================== R4b/R5: ingest provenance + cost/quality dial ====================

/** Relation type linking each ingested entity to its ingest manifest (R4b). */
export const INGEST_DERIVED_FROM_RELATION = 'derived_from';

/** Entity type of the per-run ingest manifest entity (R4b). */
export const INGEST_MANIFEST_ENTITY_TYPE = 'ingest-manifest';

/**
 * Observation prefix for manifest chunk lines (house pattern: prefix +
 * `JSON.stringify` payload — escape-safe, cf. `ProcedureStore`).
 */
export const INGEST_CHUNK_PREFIX = '[chunk]: ';

/**
 * Ingestion cost/quality dial (R5).
 *
 * - `'lightweight'` — heuristic extraction only; the LLM provider is NEVER
 *   called, even when configured (distiller mode `'heuristic-only'`).
 * - `'balanced'` (default) — current behaviour: LLM extraction when a
 *   provider is present, heuristic fallback otherwise (distiller `'auto'`).
 * - `'accurate'` — LLM extraction when available (distiller
 *   `'llm-preferred'`) plus a validation pass via the {@link IngestOptions.validate}
 *   hook. Without a validator, accurate degrades to balanced with stricter
 *   heuristic thresholds (distiller `heuristicStrictness: 'strict'`).
 */
export type IngestMode = 'accurate' | 'balanced' | 'lightweight';

/** Summed LLM token usage for one ingest run (R5). */
export interface IngestTokenUsage {
  input: number;
  output: number;
  /** True when any component was estimated via the chars/4 heuristic. */
  approximate: boolean;
}

/** Artifacts produced by an ingest run, handed to the accurate-mode validator. */
export interface IngestProduced {
  ingestId: string;
  /** Name of the `ingest-<id>` manifest entity. */
  manifestEntity: string;
  /** Chunk entities created this run (as written to storage). */
  entities: Entity[];
  /** `derived_from` relations created this run. */
  relations: Relation[];
}

/** Feedback returned by an accurate-mode ingest validator. */
export interface IngestValidationFeedback {
  valid: boolean;
  issues?: string[];
}

export interface IngestOptions {
  projectId?: string;
  entityType?: string;
  tags?: string[];
  chunkBy?: 'exchange' | 'paragraph' | 'fixed';
  maxChunkSize?: number;
  deduplicateThreshold?: number;
  dryRun?: boolean;
  /** R5 cost/quality dial. Default `'balanced'` (= pre-R5 behaviour). */
  mode?: IngestMode;
  /**
   * R4b: store the raw chunk TEXT in the manifest chunk lines. Default
   * `false` — manifests store only `{ id, source, offset, length, hash }`
   * so no source text is duplicated into the graph. Stored text is capped
   * at 4000 chars per chunk (flagged `truncated: true` when cut).
   */
  keepSourceText?: boolean;
  /**
   * R5: optional LLM provider for distillation-based enrichment. When set
   * (and mode is not `'lightweight'`), each ingested chunk is additionally
   * distilled via `MemoryDistiller` and the resulting self-contained
   * sentences are appended as `[distilled] …` observations. Absent ⇒
   * ingest behaves exactly as before (raw observations only).
   */
  llmProvider?: import('../search/LLMQueryPlanner.js').LLMProvider;
  /**
   * R5: validation hook invoked in `'accurate'` mode (only) after entities,
   * manifest and relations are written. This is the structural seam a
   * relation-consolidation/validation stage plugs into later; ingest itself
   * only records the feedback on the result (no corrective action).
   * Skipped on `dryRun` (nothing is produced).
   */
  validate?: (produced: IngestProduced) => Promise<IngestValidationFeedback>;
}

export interface IngestResult {
  entitiesCreated: number;
  observationsAdded: number;
  skippedDuplicates: number;
  entityNames: string[];
  /** R4b: stable id of this ingest run (8 hex chars). */
  ingestId: string;
  /** R4b: name of the `ingest-<id>` manifest entity (written unless dryRun or zero chunks). */
  manifestEntity: string;
  /** R4b: total source chunks produced from the input (including skipped duplicates). */
  chunkCount: number;
  /** R5: summed LLM token usage; present only when the LLM was invoked. */
  tokenUsage?: IngestTokenUsage;
  /** R5: feedback returned by the accurate-mode validator, when invoked. */
  validation?: IngestValidationFeedback;
}

export interface BackupMetadata {
  timestamp: string;
  entityCount: number;
  relationCount: number;
  fileSize: number;
  description?: string;
  compressed?: boolean;
  originalSize?: number;
  compressionRatio?: number;
  compressionFormat?: 'brotli' | 'none';
}

export interface BackupInfo {
  fileName: string;
  filePath: string;
  metadata: BackupMetadata;
  compressed: boolean;
  size: number;
}
export interface SplitOptions {
  /** Minimum messages per session to keep (skip tiny fragments). Default 2. */
  minMessages?: number;
  /** Session delimiter patterns to detect. Default: common separators. */
  delimiters?: RegExp[];
  /** Preview without writing. */
  dryRun?: boolean;
}

export interface SplitResult {
  sessionsFound: number;
  sessionsKept: number;
  sessionsSkipped: number;
  sessions: Array<{
    index: number;
    messageCount: number;
    preview: string;
  }>;
}

export interface VisualizeOptions {
  /** Max entities to include. Default 100. */
  maxEntities?: number;
  /** Filter by project (matches entities with a tag or parentId equal to projectId). */
  projectId?: string;
  /** Output file path. If not specified, returns HTML string. */
  outputPath?: string;
  /** Graph title. */
  title?: string;
}


export interface VisualizeOptions {
  /** Max entities to include. Default 100. */
  maxEntities?: number;
  /** Filter by project (matches entities with a tag or parentId equal to projectId). */
  projectId?: string;
  /** Output file path. If not specified, returns HTML string. */
  outputPath?: string;
  /** Graph title. */
  title?: string;
}

export class IOManager {
  private readonly backupDir: string;

  /**
   * Backup lifecycle is delegated to `BackupManager` (extracted in
   * Phase 2 step 29). `IOManager`'s public backup methods remain
   * unchanged — they thinly forward to this instance.
   */
  private readonly backups: BackupManager;

  constructor(private storage: GraphStorage) {
    const filePath = this.storage.getFilePath();
    const dir = dirname(filePath);
    this.backupDir = join(dir, '.backups');
    this.backups = new BackupManager(storage, this.backupDir);
  }

  /**
   * Standalone backup manager. Callers can use it directly if they
   * want a smaller surface than the full `IOManager`; the public
   * backup methods on `IOManager` continue to delegate here.
   */
  get backupManager(): BackupManager {
    return this.backups;
  }

  // ---
  // EXPORT OPERATIONS
  // ---

  /**
   * Export graph to specified format.
   *
   * @param options - `redactPii: true` masks PII in observation strings
   *   on the exported copy only (the input graph is never mutated).
   */
  exportGraph(
    graph: ReadonlyKnowledgeGraph,
    format: ExportFormat,
    options?: PiiRedactionOption,
  ): string {
    if (options?.redactPii) {
      // redactGraph returns a clone with redacted observation copies —
      // the live graph object is untouched.
      graph = DEFAULT_EXPORT_REDACTOR.redactGraph(graph);
    }
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
      case 'turtle':
        return this.exportAsTurtle(graph);
      case 'rdf-xml':
        return this.exportAsRdfXml(graph);
      case 'json-ld':
        return this.exportAsJsonLd(graph);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  // -------- η.5.4 Standards Compliance — RDF / Turtle / JSON-LD --------

  /** IRI for an entity resource. Format: `urn:memoryjs:entity:<percent-encoded-name>`. */
  private entityIri(name: string): string {
    return `urn:memoryjs:entity:${encodeURIComponent(name)}`;
  }

  /** IRI for a relation predicate. Format: `urn:memoryjs:rel:<percent-encoded-type>`. */
  private relationIri(type: string): string {
    return `urn:memoryjs:rel:${encodeURIComponent(type)}`;
  }

  /**
   * Escape a string for a Turtle `STRING_LITERAL_QUOTE` per W3C Turtle 1.1.
   * - Named ECHAR escapes for `\\ " \n \r \t \b \f`
   * - Other C0 control chars (forbidden unescaped in `"..."`) as `\uXXXX`
   */
  private turtleEscape(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\x08/g, '\\b')
      .replace(/\x0c/g, '\\f')
      .replace(/[\x00-\x07\x0B\x0E-\x1F]/g, (c) =>
        `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
      );
  }

  /**
   * Test whether a string is a valid XML 1.0 NCName — ASCII subset,
   * sufficient because `relationIri()` percent-encodes everything else.
   * RDF/XML requires this for property-element predicate names.
   */
  private isValidNCName(s: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_\-.]*$/.test(s);
  }

  /**
   * Export as Turtle (W3C RDF 1.1).
   * - entity → `urn:memoryjs:entity:<name>` resource
   * - entityType → `rdf:type` with `urn:memoryjs:type:<type>` IRI
   * - observations → `rdfs:comment` literals
   * - tags → `dcterms:subject` literals
   * - createdAt → `dcterms:created` literal
   * - relation → `<from> <urn:memoryjs:rel:<type>> <to>` triple
   */
  private exportAsTurtle(graph: ReadonlyKnowledgeGraph): string {
    const lines: string[] = [];
    lines.push('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .');
    lines.push('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .');
    lines.push('@prefix dcterms: <http://purl.org/dc/terms/> .');
    lines.push('');

    for (const entity of graph.entities) {
      const subject = `<${this.entityIri(entity.name)}>`;
      lines.push(`${subject} a <urn:memoryjs:type:${encodeURIComponent(entity.entityType)}> ;`);
      lines.push(`  rdfs:label "${this.turtleEscape(entity.name)}" ;`);
      for (const obs of entity.observations) {
        lines.push(`  rdfs:comment "${this.turtleEscape(obs)}" ;`);
      }
      for (const tag of entity.tags ?? []) {
        lines.push(`  dcterms:subject "${this.turtleEscape(tag)}" ;`);
      }
      if (entity.createdAt) {
        lines.push(`  dcterms:created "${this.turtleEscape(entity.createdAt)}" ;`);
      }
      // Convert the trailing predicate-list separator `;` into a `.` terminator.
      const last = lines.length - 1;
      lines[last] = lines[last].replace(/ ;$/, ' .');
    }

    if (graph.entities.length > 0) lines.push('');

    for (const relation of graph.relations) {
      const subject = `<${this.entityIri(relation.from)}>`;
      const predicate = `<${this.relationIri(relation.relationType)}>`;
      const object = `<${this.entityIri(relation.to)}>`;
      lines.push(`${subject} ${predicate} ${object} .`);
    }

    return lines.join('\n');
  }

  /**
   * Export as RDF/XML (W3C RDF 1.1 XML serialization).
   * - Same triple set as Turtle, in XML form
   * - NCName-valid relation types → property-element under `mjsRel:`
   * - Otherwise → asserted `mjsRel:link` triple plus `rdf:Statement` reification preserving the original predicate IRI
   */
  private exportAsRdfXml(graph: ReadonlyKnowledgeGraph): string {
    const xmlEscape = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<rdf:RDF');
    lines.push('  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"');
    lines.push('  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"');
    lines.push('  xmlns:dcterms="http://purl.org/dc/terms/"');
    lines.push('  xmlns:mjsRel="urn:memoryjs:rel:">');

    for (const entity of graph.entities) {
      lines.push(`  <rdf:Description rdf:about="${xmlEscape(this.entityIri(entity.name))}">`);
      lines.push(`    <rdf:type rdf:resource="urn:memoryjs:type:${xmlEscape(encodeURIComponent(entity.entityType))}"/>`);
      lines.push(`    <rdfs:label>${xmlEscape(entity.name)}</rdfs:label>`);
      for (const obs of entity.observations) {
        lines.push(`    <rdfs:comment>${xmlEscape(obs)}</rdfs:comment>`);
      }
      for (const tag of entity.tags ?? []) {
        lines.push(`    <dcterms:subject>${xmlEscape(tag)}</dcterms:subject>`);
      }
      lines.push('  </rdf:Description>');
    }

    for (const relation of graph.relations) {
      const fromIri = xmlEscape(this.entityIri(relation.from));
      const toIri = xmlEscape(this.entityIri(relation.to));
      if (this.isValidNCName(relation.relationType)) {
        lines.push(`  <rdf:Description rdf:about="${fromIri}">`);
        lines.push(`    <mjsRel:${xmlEscape(relation.relationType)} rdf:resource="${toIri}"/>`);
        lines.push('  </rdf:Description>');
        continue;
      }
      // Non-NCName predicate: emit an asserted edge via synthetic `mjsRel:link`,
      // then a reified `rdf:Statement` so the original predicate IRI survives.
      const predIri = xmlEscape(this.relationIri(relation.relationType));
      lines.push(`  <rdf:Description rdf:about="${fromIri}">`);
      lines.push(`    <mjsRel:link rdf:resource="${toIri}"/>`);
      lines.push('  </rdf:Description>');
      lines.push('  <rdf:Description>');
      lines.push('    <rdf:type rdf:resource="http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement"/>');
      lines.push(`    <rdf:subject rdf:resource="${fromIri}"/>`);
      lines.push(`    <rdf:predicate rdf:resource="${predIri}"/>`);
      lines.push(`    <rdf:object rdf:resource="${toIri}"/>`);
      lines.push('  </rdf:Description>');
    }

    lines.push('</rdf:RDF>');
    return lines.join('\n');
  }

  /**
   * Export as JSON-LD (JSON for Linking Data).
   * - `@context` maps memoryjs schema to RDFS + DCTerms vocabularies
   * - observations/tags use `@container: @set` so each value becomes its own triple (matches Turtle/RDF-XML), not an `rdf:List`
   * - any JSON-LD parser yields the same RDF graph as the Turtle export
   */
  private exportAsJsonLd(graph: ReadonlyKnowledgeGraph): string {
    const context = {
      '@vocab': 'urn:memoryjs:',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      dcterms: 'http://purl.org/dc/terms/',
      name: 'rdfs:label',
      entityType: '@type',
      observations: { '@id': 'rdfs:comment', '@container': '@set' },
      tags: { '@id': 'dcterms:subject', '@container': '@set' },
      createdAt: 'dcterms:created',
      lastModified: 'dcterms:modified',
      from: { '@id': 'urn:memoryjs:rel:from', '@type': '@id' },
      to: { '@id': 'urn:memoryjs:rel:to', '@type': '@id' },
      relationType: 'urn:memoryjs:rel:type',
    };
    const doc = {
      '@context': context,
      '@graph': [
        ...graph.entities.map((entity) => ({
          '@id': this.entityIri(entity.name),
          name: entity.name,
          entityType: `urn:memoryjs:type:${encodeURIComponent(entity.entityType)}`,
          observations: entity.observations,
          ...(entity.tags && entity.tags.length > 0 ? { tags: entity.tags } : {}),
          ...(entity.createdAt ? { createdAt: entity.createdAt } : {}),
          ...(entity.lastModified ? { lastModified: entity.lastModified } : {}),
        })),
        ...graph.relations.map((relation) => ({
          '@id': `urn:memoryjs:relation:${encodeURIComponent(relation.from)}:${encodeURIComponent(relation.relationType)}:${encodeURIComponent(relation.to)}`,
          from: this.entityIri(relation.from),
          to: this.entityIri(relation.to),
          relationType: relation.relationType,
        })),
      ],
    };
    return JSON.stringify(doc, null, 2);
  }

  /** Export graph with optional brotli compression (and opt-in PII redaction). */
  async exportGraphWithCompression(
    graph: ReadonlyKnowledgeGraph,
    format: ExportFormat,
    options?: ExportOptions & PiiRedactionOption
  ): Promise<ExportResult> {
    // Check if streaming should be used
    const shouldStream = options?.streaming ||
      (options?.outputPath && graph.entities.length >= STREAMING_CONFIG.STREAMING_THRESHOLD);

    if (shouldStream && options?.outputPath) {
      return this.streamExport(
        format,
        graph,
        options as ExportOptions & PiiRedactionOption & { outputPath: string },
      );
    }

    // Generate export content using existing method
    const content = this.exportGraph(graph, format, { redactPii: options?.redactPii });
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

  /** Stream export to a file for large graphs. */
  private async streamExport(
    format: ExportFormat,
    graph: ReadonlyKnowledgeGraph,
    options: ExportOptions & PiiRedactionOption & { outputPath: string }
  ): Promise<ExportResult> {
    // Export output is user-supplied and may legitimately target outside
    // cwd; ".." defense-in-depth check inside validateFilePath still runs.
    const validatedOutputPath = validateFilePath(options.outputPath, undefined, false);
    const exporter = new StreamingExporter(validatedOutputPath);
    const redactPii = options.redactPii;
    let result: StreamResult;

    switch (format) {
      case 'json':
        // Use JSONL format for streaming (line-delimited JSON)
        result = await exporter.streamJSONL(graph, { redactPii });
        break;
      case 'csv':
        result = await exporter.streamCSV(graph, { redactPii });
        break;
      default:
        // Fallback to in-memory export for unsupported streaming formats
        const content = this.exportGraph(graph, format, { redactPii });
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
    const usedIds = new Set<string>();
    for (const entity of graph.entities) {
      let id = sanitizeId(entity.name);
      if (usedIds.has(id)) {
        let counter = 2;
        while (usedIds.has(`${id}_${counter}`)) counter++;
        id = `${id}_${counter}`;
      }
      usedIds.add(id);
      nodeIds.set(entity.name, id);
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

  // ---
  // IMPORT OPERATIONS
  // ---

  /**
   * Import graph from formatted data.
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

    // Validate and sanitize each entity/relation against schemas
    const entities: Entity[] = [];
    for (const raw of parsed.entities) {
      const result = EntitySchema.safeParse(sanitizeObject(raw));
      if (result.success) {
        entities.push(result.data as Entity);
      }
      // Skip invalid entities silently (best-effort import)
    }

    const relations: Relation[] = [];
    for (const raw of parsed.relations) {
      const result = RelationSchema.safeParse(sanitizeObject(raw));
      if (result.success) {
        relations.push(result.data as Relation);
      }
    }

    return { entities, relations };
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
                  .map(s => s.trim())
                  .filter(s => s)
              : undefined,
            importance: fields[6] && !isNaN(parseFloat(fields[6])) ? parseFloat(fields[6]) : undefined,
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

      // Decode XML entities without stripping characters (preserves "AT&T", "O'Brien").
      // Order is load-bearing: `&amp;` MUST run last so that double-encoded
      // entities like `&amp;lt;` decode to `&lt;` (literal) rather than `<`.
      const decodeXmlEntities = (v: string): string =>
        v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

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
          .map(s => s.trim())
          .filter(s => s),
        importance: (() => {
          const raw = getDataValue('d5') || getDataValue('importance');
          if (!raw) return undefined;
          const val = parseFloat(raw);
          return isNaN(val) ? undefined : val;
        })(),
      };

      entities.push(entity);
    }

    const edgeRegex = /<edge\s+([^>]*?)>([\s\S]*?)<\/edge>/g;
    const attrSourceRegex = /source="([^"]+)"/;
    const attrTargetRegex = /target="([^"]+)"/;
    let edgeMatch;

    while ((edgeMatch = edgeRegex.exec(data)) !== null) {
      // Security: Limit iterations to prevent ReDoS
      if (++relationCount > MAX_ITEMS) {
        throw new FileOperationError(
          `GraphML import exceeds maximum relation count of ${MAX_ITEMS}`,
          'graphml-import'
        );
      }
      const edgeAttrs = edgeMatch[1];
      const edgeContent = edgeMatch[2];
      const sourceMatch = attrSourceRegex.exec(edgeAttrs);
      const targetMatch = attrTargetRegex.exec(edgeAttrs);
      if (!sourceMatch || !targetMatch) continue;
      const source = sourceMatch[1];
      const target = targetMatch[1];

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

  // ==================== Backup methods (delegated) ====================
  // Backup logic now lives in `BackupManager` (Phase 2 step 29 — first
  // pass of the IOManager split). These wrappers preserve the
  // pre-extraction public API so existing callers keep working
  // unchanged.

  /**
   * Create a backup of the current knowledge graph.
   *
   * Sec6: pass `redactPii: true` to mask PII in observation strings of
   * the backup content. The backup is then synthesized from the parsed
   * graph (redacted copies) rather than a raw file copy — the live graph
   * and storage file are never touched. Redacted backups are for
   * compliance/export use; they are not byte-identical snapshots.
   */
  async createBackup(
    options?: (BackupOptions & PiiRedactionOption) | string
  ): Promise<BackupResult> {
    return this.backups.create(options);
  }

  /** List all available backups, sorted by timestamp (newest first). */
  async listBackups(): Promise<BackupInfo[]> {
    return this.backups.list();
  }

  /** Restore the knowledge graph from a backup file. */
  async restoreFromBackup(backupPath: string): Promise<RestoreResult> {
    return this.backups.restore(backupPath);
  }

  /** Delete a specific backup file. */
  async deleteBackup(backupPath: string): Promise<void> {
    return this.backups.delete(backupPath);
  }

  /** Clean old backups, keeping only the most recent N. */
  async cleanOldBackups(keepCount: number = 10): Promise<number> {
    return this.backups.cleanOld(keepCount);
  }

  /** Get the path to the backup directory. */
  getBackupDir(): string {
    return this.backups.getDir();
  }

  /**
   * Ingest pre-normalized conversation data into the knowledge graph.
   * Format-agnostic: users normalize chat exports before calling.
   *
   * R4b provenance: every run writes an `ingest-<id>` manifest entity
   * (`entityType: 'ingest-manifest'`) with one `[chunk]: <JSON>` line per
   * source chunk (`{ id, source, offset, length, hash }`; raw text only when
   * `keepSourceText: true`). Each created entity records per-observation
   * `sourceRef` provenance via `observationMeta` and is linked to the
   * manifest with a `derived_from` relation.
   *
   * R5 mode dial: see {@link IngestMode}. Distillation-based enrichment
   * (extra `[distilled] …` observations + token accounting) activates only
   * when an {@link IngestOptions.llmProvider} is supplied; without one every
   * mode preserves the raw-observation behaviour.
   */
  async ingest(
    input: IngestInput | IngestInput[],
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const inputs = Array.isArray(input) ? input : [input];
    const entityType = options.entityType ?? 'memory';
    const chunkBy = options.chunkBy ?? 'exchange';
    const dryRun = options.dryRun ?? false;
    const mode: IngestMode = options.mode ?? 'balanced';
    const keepSourceText = options.keepSourceText ?? false;
    const baseTags = [...(options.tags ?? []), 'ingested'];

    const { createHash, randomBytes } = await import('crypto');
    const ingestId = randomBytes(4).toString('hex');
    const manifestEntity = `ingest-${ingestId}`;

    const result: IngestResult = {
      entitiesCreated: 0,
      observationsAdded: 0,
      skippedDuplicates: 0,
      entityNames: [],
      ingestId,
      manifestEntity,
      chunkCount: 0,
    };

    // R5: distillation-based enrichment is active only when a provider is
    // supplied. Mode maps onto the distiller dial: lightweight → heuristic-only
    // (provider never called), balanced → auto, accurate → llm-preferred
    // (strict heuristics when no external validator is configured).
    let distiller: import('../agent/reconstruction/MemoryDistiller.js').MemoryDistiller | undefined;
    if (options.llmProvider && !dryRun) {
      const { MemoryDistiller } = await import('../agent/reconstruction/MemoryDistiller.js');
      distiller = new MemoryDistiller(options.llmProvider, {
        mode:
          mode === 'lightweight' ? 'heuristic-only'
          : mode === 'accurate' ? 'llm-preferred'
          : 'auto',
        heuristicStrictness: mode === 'accurate' && !options.validate ? 'strict' : 'normal',
      });
    }

    // Build dedup set from existing entities using content hash to avoid || delimiter collisions.
    // Entities enriched by a previous run carry the raw-chunk hash in `contentHash`.
    const graph = await this.storage.loadGraph();
    const existingObsSet = new Set<string>();
    for (const e of graph.entities) {
      existingObsSet.add(createHash('sha256').update(e.observations.join('\n')).digest('hex'));
      if (e.contentHash) existingObsSet.add(e.contentHash);
    }

    // Create managers once, reuse across all chunks
    const { EntityManager } = await import('../core/EntityManager.js');
    const em = new EntityManager(this.storage);

    const manifestLines: string[] = [];
    const createdEntities: Entity[] = [];
    let chunkNo = 0;
    let tokenUsage: IngestTokenUsage | undefined;

    for (const inp of inputs) {
      const chunks = this._chunkMessages(inp.messages, chunkBy, options.maxChunkSize);
      const source = inp.source ?? `ingest-${new Date().toISOString().slice(0, 10)}`;
      // Char offset of the current chunk within this input's rendered text
      // (chunks joined by '\n' — matches the hashed representation).
      let offset = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const entityName = `${source}-${String(i + 1).padStart(3, '0')}`;
        const observations = chunk.map(m => `[${m.role}] ${m.content}`);
        const chunkText = observations.join('\n');
        const obsKey = createHash('sha256').update(chunkText).digest('hex');

        // R4b: manifest chunk line (escape-safe: prefix + JSON.stringify).
        chunkNo++;
        const chunkId = `${ingestId}-chunk-${chunkNo}`;
        const chunkRecord: Record<string, unknown> = {
          id: chunkId,
          source,
          offset,
          length: chunkText.length,
          hash: obsKey,
        };
        if (keepSourceText) {
          const MAX_TEXT = 4000;
          chunkRecord.text = chunkText.slice(0, MAX_TEXT);
          if (chunkText.length > MAX_TEXT) chunkRecord.truncated = true;
        }
        manifestLines.push(`${INGEST_CHUNK_PREFIX}${JSON.stringify(chunkRecord)}`);
        offset += chunkText.length + 1;

        if (existingObsSet.has(obsKey)) {
          result.skippedDuplicates++;
          continue;
        }

        // R5: optional enrichment pass (after dedup — no tokens spent on skips).
        let extraObs: string[] = [];
        if (distiller) {
          const turns = chunk.map((m, j) => ({
            id: `${chunkId}:${j + 1}`,
            speaker: m.role,
            text: m.content,
            timestamp: m.timestamp,
          }));
          const distilled = await distiller.distill(turns);
          const seen = new Set(observations);
          extraObs = distilled.sentences
            .map(s => `[distilled] ${s.text}`.slice(0, 5000))
            .filter(o => o.length > 0 && !seen.has(o) && (seen.add(o), true));
          if (distilled.tokenUsage) {
            tokenUsage = {
              input: (tokenUsage?.input ?? 0) + distilled.tokenUsage.input,
              output: (tokenUsage?.output ?? 0) + distilled.tokenUsage.output,
              approximate: (tokenUsage?.approximate ?? false) || distilled.tokenUsage.approximate,
            };
          }
        }

        const allObs = [...observations, ...extraObs];
        result.entitiesCreated++;
        result.observationsAdded += allObs.length;
        result.entityNames.push(entityName);

        if (!dryRun) {
          const recordedAt = new Date().toISOString();
          try {
            const [created] = await em.createEntities([{
              name: entityName,
              entityType,
              observations: allObs,
              tags: [...baseTags],
              projectId: options.projectId,
              // R4b: raw-chunk hash — used for dedup on re-ingest.
              contentHash: obsKey,
              // R4b: per-observation source-chunk provenance.
              observationMeta: allObs.map(content => ({
                content,
                recordedAt,
                sourceRef: chunkId,
              })),
            }]);
            createdEntities.push(created);
          } catch (err) {
            throw new Error(
              `[ingest] Failed to create entity '${entityName}' (source: ${source}, chunk: ${i + 1}): ${err instanceof Error ? err.message : String(err)}`
            );
          }
          existingObsSet.add(obsKey);
        }
      }
    }

    result.chunkCount = chunkNo;
    if (tokenUsage) result.tokenUsage = tokenUsage;

    // R4b: write the manifest + derived_from relations.
    const createdRelations: Relation[] = [];
    if (!dryRun && manifestLines.length > 0) {
      try {
        await em.createEntities([{
          name: manifestEntity,
          entityType: INGEST_MANIFEST_ENTITY_TYPE,
          observations: manifestLines,
          tags: [...baseTags, INGEST_MANIFEST_ENTITY_TYPE],
          projectId: options.projectId,
        }]);
      } catch (err) {
        throw new Error(
          `[ingest] Failed to create manifest '${manifestEntity}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (createdEntities.length > 0) {
        const { RelationManager } = await import('../core/RelationManager.js');
        const rm = new RelationManager(this.storage);
        const relations = createdEntities.map(e => ({
          from: e.name,
          to: manifestEntity,
          relationType: INGEST_DERIVED_FROM_RELATION,
        }));
        createdRelations.push(...await rm.createRelations(relations));
      }
    }

    // R5: accurate-mode validation pass (the consolidator seam).
    if (mode === 'accurate' && options.validate && !dryRun) {
      result.validation = await options.validate({
        ingestId,
        manifestEntity,
        entities: createdEntities,
        relations: createdRelations,
      });
    }

    return result;
  }

  private _chunkMessages(
    messages: IngestInput['messages'],
    strategy: string,
    maxSize?: number
  ): IngestInput['messages'][] {
    if (strategy === 'exchange') {
      const chunks: IngestInput['messages'][] = [];
      let current: IngestInput['messages'] = [];
      for (const msg of messages) {
        current.push(msg);
        if (msg.role === 'assistant' && current.length >= 2) {
          chunks.push(current);
          current = [];
        }
      }
      if (current.length > 0) chunks.push(current);
      return chunks;
    }

    if (strategy === 'paragraph') {
      return messages.map(m => [m]);
    }

    // Fixed size
    const max = maxSize ?? 2000;
    const chunks: IngestInput['messages'][] = [];
    let current: IngestInput['messages'] = [];
    let size = 0;
    for (const msg of messages) {
      if (size + msg.content.length > max && current.length > 0) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(msg);
      size += msg.content.length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  /**
   * Split a concatenated transcript into per-session chunks.
   * Detects session boundaries via delimiter patterns (timestamps,
   * separator lines, "New conversation" markers).
   *
   * This is a pure function — it takes a string and returns split results.
   * It does NOT write to storage. The caller uses `ingest()` to persist each session.
   */
  splitTranscript(content: string, options?: SplitOptions): SplitResult {
    const minMessages = options?.minMessages ?? 2;
    const delimiters = options?.delimiters ?? [
      /^-{3,}$/m,
      /^={3,}$/m,
      /^#{1,2}\s+(?:New |Session |Conversation)/mi,
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/m,
    ];

    // Find the first delimiter that matches and use it to split
    // Limit content length to prevent ReDoS on regex split operations
    const MAX_SPLIT_LENGTH = 10 * 1024 * 1024; // 10MB
    const MAX_PARTS = 10000;
    const splitContent = content.length > MAX_SPLIT_LENGTH ? content.slice(0, MAX_SPLIT_LENGTH) : content;
    let rawSessions: string[] = [splitContent];

    for (const delimiter of delimiters) {
      // Only accept RegExp objects from the hardcoded defaults or validated input;
      // delimiter.source is safe here because delimiters come from the hardcoded
      // array above or caller-provided RegExp objects (not raw strings).
      const flags = delimiter.flags.includes('g') ? delimiter.flags : delimiter.flags + 'g';
      const globalDelimiter = new RegExp(delimiter.source, flags);
      if (globalDelimiter.test(splitContent)) {
        // Split using this delimiter; for timestamp-style delimiters, keep the delimiter
        // as the start of the new segment using a lookahead split
        const lookaheadFlags = delimiter.flags.replace(/[gm]/g, '') + 'm';
        const lookaheadDelimiter = new RegExp(`(?=${delimiter.source})`, lookaheadFlags);
        const parts = splitContent.split(lookaheadDelimiter);
        if (parts.length > 1) {
          rawSessions = parts.slice(0, MAX_PARTS);
          break;
        }
        // Fallback: split and discard the delimiter line
        const splitDelimiter = new RegExp(delimiter.source, flags);
        const splitParts = splitContent.split(splitDelimiter);
        if (splitParts.length > 1) {
          rawSessions = splitParts.slice(0, MAX_PARTS);
          break;
        }
      }
    }

    const sessionsFound = rawSessions.length;
    const keptSessions: Array<{ index: number; messageCount: number; preview: string }> = [];
    let sessionsSkipped = 0;

    rawSessions.forEach((sessionText, idx) => {
      const trimmed = sessionText.trim();
      const messageCount = trimmed === '' ? 0 : trimmed.split('\n').filter(line => line.trim().length > 0).length;

      if (messageCount < minMessages) {
        sessionsSkipped++;
        return;
      }

      keptSessions.push({
        index: idx,
        messageCount,
        preview: trimmed.slice(0, 100),
      });
    });

    return {
      sessionsFound,
      sessionsKept: keptSessions.length,
      sessionsSkipped,
      sessions: keptSessions,
    };
  }

  /**
   * Generate a self-contained HTML file with D3.js force-directed
   * graph visualization of the knowledge graph.
   */
  async visualizeGraph(options?: VisualizeOptions): Promise<string> {
    const maxEntities = options?.maxEntities ?? 100;
    const title = options?.title ?? 'Knowledge Graph';

    // Load graph data
    const graph = await this.storage.loadGraph();

    // Filter entities by projectId if provided
    let entities = graph.entities;
    if (options?.projectId) {
      const pid = options.projectId;
      entities = entities.filter(
        e =>
          e.parentId === pid ||
          (e.tags ?? []).includes(pid)
      );
    }

    // Limit to maxEntities by importance (descending), then name for stable order
    entities = [...entities]
      .sort((a, b) => {
        const ia = a.importance ?? 0;
        const ib = b.importance ?? 0;
        if (ib !== ia) return ib - ia;
        return a.name.localeCompare(b.name);
      })
      .slice(0, maxEntities);

    const entityNames = new Set(entities.map(e => e.name));

    // Build nodes
    const nodes = entities.map(e => ({
      id: e.name,
      type: e.entityType,
      observations: e.observations.length,
      importance: e.importance ?? 1,
      observationList: e.observations.slice(0, 3),
    }));

    // Build links (only where both endpoints are visible)
    const links = graph.relations
      .filter(r => entityNames.has(r.from) && entityNames.has(r.to))
      .map(r => ({
        source: r.from,
        target: r.to,
        type: r.relationType,
      }));

    const nodesJson = JSON.stringify(nodes);
    const linksJson = JSON.stringify(links);
    const html = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      `  <title>${title}</title>`,
      '  <script src="https://d3js.org/d3.v7.min.js"><\/script>',
      '  <style>',
      '    body { margin: 0; font-family: sans-serif; background: #1a1a2e; }',
      '    svg { width: 100vw; height: 100vh; }',
      '    .node circle { stroke: #fff; stroke-width: 1.5px; cursor: grab; }',
      '    .node circle:active { cursor: grabbing; }',
      '    .node text { fill: #e0e0e0; font-size: 11px; pointer-events: none; }',
      '    .link { stroke: #555; stroke-opacity: 0.6; }',
      '    .link-label { fill: #888; font-size: 9px; pointer-events: none; }',
      '    .tooltip { position: absolute; background: #16213e; color: #e0e0e0;',
      '               padding: 8px 12px; border-radius: 4px; font-size: 12px;',
      '               pointer-events: none; max-width: 300px; border: 1px solid #0f3460;',
      '               display: none; }',
      '    h1 { color: #e0e0e0; text-align: center; margin: 10px 0 0 0; font-size: 16px;',
      '         position: absolute; width: 100%; top: 0; }',
      '  </style>',
      '</head>',
      '<body>',
      `  <h1>${title}</h1>`,
      '  <svg></svg>',
      '  <div class="tooltip" id="tooltip"></div>',
      '  <script>',
      `    const nodes = ${nodesJson};`,
      `    const links = ${linksJson};`,
      '',
      '    const width = window.innerWidth;',
      '    const height = window.innerHeight;',
      '',
      '    const color = d3.scaleOrdinal(d3.schemeCategory10);',
      '',
      '    const svg = d3.select("svg")',
      '      .attr("width", width)',
      '      .attr("height", height);',
      '',
      '    const g = svg.append("g");',
      '',
      '    svg.call(',
      '      d3.zoom()',
      '        .scaleExtent([0.1, 10])',
      '        .on("zoom", (event) => g.attr("transform", event.transform))',
      '    );',
      '',
      '    const simulation = d3.forceSimulation(nodes)',
      '      .force("link", d3.forceLink(links).id(d => d.id).distance(120))',
      '      .force("charge", d3.forceManyBody().strength(-300))',
      '      .force("center", d3.forceCenter(width / 2, height / 2))',
      '      .force("collision", d3.forceCollide().radius(d => Math.max(5, (d.importance || 1) * 3) + 10));',
      '',
      '    svg.append("defs").append("marker")',
      '      .attr("id", "arrowhead")',
      '      .attr("viewBox", "0 -5 10 10")',
      '      .attr("refX", 20)',
      '      .attr("refY", 0)',
      '      .attr("markerWidth", 6)',
      '      .attr("markerHeight", 6)',
      '      .attr("orient", "auto")',
      '      .append("path")',
      '      .attr("d", "M0,-5L10,0L0,5")',
      '      .attr("fill", "#555");',
      '',
      '    const link = g.append("g")',
      '      .selectAll("line")',
      '      .data(links)',
      '      .enter().append("line")',
      '      .attr("class", "link")',
      '      .attr("stroke-width", 1.5)',
      '      .attr("marker-end", "url(#arrowhead)");',
      '',
      '    const linkLabel = g.append("g")',
      '      .selectAll("text")',
      '      .data(links)',
      '      .enter().append("text")',
      '      .attr("class", "link-label")',
      '      .text(d => d.type);',
      '',
      '    const node = g.append("g")',
      '      .selectAll("g")',
      '      .data(nodes)',
      '      .enter().append("g")',
      '      .attr("class", "node")',
      '      .call(',
      '        d3.drag()',
      '          .on("start", (event, d) => {',
      '            if (!event.active) simulation.alphaTarget(0.3).restart();',
      '            d.fx = d.x; d.fy = d.y;',
      '          })',
      '          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })',
      '          .on("end", (event, d) => {',
      '            if (!event.active) simulation.alphaTarget(0);',
      '            d.fx = null; d.fy = null;',
      '          })',
      '      );',
      '',
      '    node.append("circle")',
      '      .attr("r", d => Math.max(5, (d.importance || 1) * 3))',
      '      .attr("fill", d => color(d.type));',
      '',
      '    node.append("text")',
      '      .attr("dx", d => Math.max(5, (d.importance || 1) * 3) + 3)',
      '      .attr("dy", 4)',
      '      .text(d => d.id);',
      '',
      '    const tooltip = document.getElementById("tooltip");',
      '',
      '    function buildTooltip(d) {',
      '      while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);',
      '      const header = document.createElement("div");',
      '      header.textContent = d.id + " (" + d.type + ")";',
      '      header.style.fontWeight = "bold";',
      '      tooltip.appendChild(header);',
      '      const meta = document.createElement("div");',
      '      meta.textContent = "Importance: " + d.importance + "  Observations: " + d.observations;',
      '      tooltip.appendChild(meta);',
      '      d.observationList.forEach(obs => {',
      '        const item = document.createElement("div");',
      '        item.style.fontStyle = "italic";',
      '        item.textContent = obs;',
      '        tooltip.appendChild(item);',
      '      });',
      '    }',
      '',
      '    node.on("mouseover", (event, d) => {',
      '      buildTooltip(d);',
      '      tooltip.style.display = "block";',
      '      tooltip.style.left = (event.pageX + 12) + "px";',
      '      tooltip.style.top = (event.pageY - 10) + "px";',
      '    })',
      '    .on("mousemove", (event) => {',
      '      tooltip.style.left = (event.pageX + 12) + "px";',
      '      tooltip.style.top = (event.pageY - 10) + "px";',
      '    })',
      '    .on("mouseout", () => { tooltip.style.display = "none"; });',
      '',
      '    simulation.on("tick", () => {',
      '      link',
      '        .attr("x1", d => d.source.x)',
      '        .attr("y1", d => d.source.y)',
      '        .attr("x2", d => d.target.x)',
      '        .attr("y2", d => d.target.y);',
      '',
      '      linkLabel',
      '        .attr("x", d => (d.source.x + d.target.x) / 2)',
      '        .attr("y", d => (d.source.y + d.target.y) / 2);',
      '',
      '      node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");',
      '    });',
      '  <\/script>',
      '</body>',
      '</html>',
    ].join('\n');

    if (options?.outputPath) {
      await fs.writeFile(options.outputPath, html, 'utf-8');
    }

    return html;
  }

}
