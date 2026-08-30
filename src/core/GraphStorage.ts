/**
 * Graph Storage
 *
 * Handles file I/O operations for the knowledge graph using JSONL format.
 * Implements IGraphStorage interface for storage abstraction.
 *
 * @module core/GraphStorage
 */

import { promises as fs } from 'fs';
import {
  durableWriteFile as durableWriteFileShared,
  restrictSensitiveFilePermissions,
} from '../utils/durableWriteFile.js';
import { Mutex } from 'async-mutex';
import type { KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData } from '../types/index.js';
import {
  clearAllSearchCaches,
  bumpEntityGeneration,
  bumpRelationGeneration,
} from '../utils/searchCache.js';
import { NameIndex, TypeIndex, LowercaseCache, RelationIndex, ObservationIndex } from '../utils/indexes.js';
import { sanitizeObject, validateFilePath, AsyncMutex } from '../utils/index.js';
import { EntityNotFoundError, DuplicateEntityError } from '../utils/errors.js';
import { BatchTransaction } from './TransactionManager.js';
import { GraphEventEmitter } from './GraphEventEmitter.js';
import { dirname } from 'path';
import { FileSegmentStorage } from './segments/FileSegmentStorage.js';
import { FnvSegmentRouter } from './segments/ISegmentStorage.js';
import { FsReadMmapBackend } from './mmap/FsReadMmapBackend.js';
import { streamLines } from './mmap/IMmapBackend.js';

/**
 * Read `MEMORY_STORAGE_SEGMENT_COUNT` and return a `FileSegmentStorage`
 * when the value parses as an integer in `[2, MAX_SEGMENT_COUNT]`,
 * otherwise `null` (single-file mode — byte-identical to pre-Phase-7
 * behavior). Anything else (unset, floats, exponents, hex literals,
 * out-of-range) falls back to single-file mode rather than throwing
 * so a misconfigured deployment degrades gracefully.
 *
 * Strict parsing: we use `Number(raw)` + `Number.isInteger` instead of
 * `parseInt` because `parseInt('3.7')` silently truncates to `3`,
 * which would surprise an operator who typed a fractional value.
 *
 * Upper bound: 1024 segments is enough for any practical workload
 * and guards against `MEMORY_STORAGE_SEGMENT_COUNT=1000000` causing
 * `loadAll` to do a million ENOENT-rejected file opens.
 *
 * Segment files live under `<dirname(memoryFilePath)>/segments/`.
 */
const MAX_SEGMENT_COUNT = 1024;
const SEGMENT_COUNT_PATTERN = /^[1-9][0-9]*$/;
function resolveSegmentStorage(memoryFilePath: string): FileSegmentStorage | null {
  const raw = process.env.MEMORY_STORAGE_SEGMENT_COUNT;
  if (!raw) return null;
  // Require a plain positive-decimal-integer literal — rejects floats
  // (`3.7`), exponents (`1e3`), hex (`0x10`), leading zeros (`007`),
  // signs (`-5`, `+5`), and whitespace. `Number('1e3') === 1000` is
  // numerically fine, but an operator who typed `1e3` was probably
  // confused — fail closed so the misconfig surfaces.
  if (!SEGMENT_COUNT_PATTERN.test(raw)) return null;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 2 || count > MAX_SEGMENT_COUNT) return null;
  const rootDir = dirname(memoryFilePath);
  return new FileSegmentStorage(rootDir, new FnvSegmentRouter(count));
}

// Required fields are always serialized via the explicit literal at each
// call site. This list is the *optional* fields — additive across schema
// evolution. Add new optional Entity / AgentEntity / SessionEntity /
// ArtifactEntity fields here once and every appendEntity /
// saveGraphInternal / updateEntity site picks them up. See:
//   src/types/types.ts            Entity
//   src/types/agent-memory.ts     AgentEntity, SessionEntity
//   src/types/artifact.ts         ArtifactEntity
const OPTIONAL_PERSISTED_ENTITY_FIELDS: ReadonlyArray<string> = [
  // Core Entity (types/types.ts)
  'id',
  'tags', 'importance', 'parentId', 'projectId',
  'version', 'parentEntityName', 'rootEntityName', 'isLatest', 'supersededBy',
  'contentHash',
  'ttl', 'confidence',
  // η.4.4 temporal versioning expansion
  'validFrom', 'validUntil', 'observationMeta',
  // Entity state machine
  'lifecycleStatus',
  // AgentEntity extension (types/agent-memory.ts)
  'memoryType', 'sessionId', 'conversationId', 'taskId',
  'expiresAt', 'isWorkingMemory', 'promotedAt', 'promotedFrom', 'markedForPromotion',
  'accessCount', 'lastAccessedAt', 'accessPattern',
  'confirmationCount', 'decayRate',
  'agentId', 'visibility', 'source',
  // SessionEntity extension (types/agent-memory.ts)
  'startedAt', 'endedAt', 'status',
  'goalDescription', 'taskType', 'userIntent',
  'memoryCount', 'consolidatedCount',
  'previousSessionId', 'relatedSessionIds',
  'outcome', 'failureCauses',
  // ArtifactEntity extension (types/artifact.ts)
  'artifactType', 'toolName', 'shortId',
  // v2.1.0 subclass-manager record fields (sibling to the v2.1.1
  // UpdateEntitySchema.passthrough fix — same root cause: subclass managers
  // attach domain records that the persistence allowlist must also admit,
  // otherwise the records are silently dropped on save and the managers'
  // list/match/get operations return empty on next load).
  'heuristicRecord',            // HeuristicEntity
  'decisionRecord',             // DecisionEntity (includes nested lifecycle)
  'exclusionRule',              // ExclusionEntity
  'projectContextRecord',       // ProjectContextEntity
  'toolAffordanceRecord',       // ToolAffordanceEntity
  'prospectiveRecord',          // ProspectiveEntity
  'failureRecord',              // FailureEntity
  'planRecord',                 // PlanEntity
  'reflectionRecord',           // ReflectionEntity
];

function copyOptionalPersistedFields(
  src: Partial<Record<string, unknown>>,
  dst: Record<string, unknown>,
): void {
  for (const field of OPTIONAL_PERSISTED_ENTITY_FIELDS) {
    const v = src[field];
    if (v !== undefined) dst[field] = v;
  }
}

/**
 * Composite key uniquely identifying a relation (`from`/`to`/`relationType`
 * triple). `\u0000` separator matches `RelationManager.deleteRelations` and
 * cannot collide with entity-name content in practice.
 */
function relationKeyOf(r: Pick<Relation, 'from' | 'to' | 'relationType'>): string {
  return `${r.from}\u0000${r.to}\u0000${r.relationType}`;
}

/**
 * Serialize an entity to its JSONL line (shared by append / update /
 * full-save paths so the on-disk shape stays identical everywhere).
 */
function serializeEntityLine(e: Entity): string {
  const entityData: Record<string, unknown> = {
    type: 'entity',
    name: e.name,
    entityType: e.entityType,
    observations: e.observations,
    createdAt: e.createdAt,
    lastModified: e.lastModified,
  };
  copyOptionalPersistedFields(e as unknown as Record<string, unknown>, entityData);
  return JSON.stringify(entityData);
}

/**
 * Serialize a relation to its JSONL line (shared by append / full-save
 * paths).
 */
function serializeRelationLine(r: Relation): string {
  const relationData: Record<string, unknown> = {
    type: 'relation',
    from: r.from,
    to: r.to,
    relationType: r.relationType,
    createdAt: r.createdAt,
    lastModified: r.lastModified,
  };
  if (r.weight !== undefined) relationData.weight = r.weight;
  if (r.confidence !== undefined) relationData.confidence = r.confidence;
  if (r.properties) relationData.properties = r.properties;
  if (r.metadata) relationData.metadata = r.metadata;
  return JSON.stringify(relationData);
}

/**
 * GraphStorage manages persistence of the knowledge graph to disk.
 *
 * Uses JSONL (JSON Lines) format where each line is a separate JSON object
 * representing either an entity or a relation.
 *
 * OPTIMIZED: Implements in-memory caching to avoid repeated disk reads.
 * Cache is invalidated on every write operation to ensure consistency.
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('/path/to/memory.jsonl');
 * const graph = await storage.loadGraph();
 * graph.entities.push(newEntity);
 * await storage.saveGraph(graph);
 * ```
 */
export class GraphStorage implements IGraphStorage {
  /**
   * Mutex for thread-safe access to storage operations.
   * Prevents concurrent writes from corrupting the file or cache.
   */
  private mutex = new Mutex();

  /**
   * Application-level mutex for managers to serialize validate+mutate+save.
   * Shared across all managers using this storage instance.
   */
  readonly graphMutex = new AsyncMutex();

  /**
   * In-memory cache of the knowledge graph.
   * Null when cache is empty or invalidated.
   */
  private cache: KnowledgeGraph | null = null;

  /**
   * In-flight load promise. When two concurrent `loadGraph()` /
   * `ensureLoaded()` calls hit a cold cache, only the first
   * actually invokes `loadFromDisk`; the second awaits the same
   * promise. Without this, both would race through `loadFromDisk`,
   * both would build entity maps, and the second would clobber the
   * first's cache assignment. The second backend handle in mmap
   * mode also doubled the kernel page-cache pressure. Flagged in
   * the Phase 11 review #3 as a pre-existing hole; fixed here.
   */
  private loadingPromise: Promise<void> | null = null;

  /**
   * Number of pending append operations since last compaction.
   * Used to trigger automatic compaction when threshold is reached.
   */
  private pendingAppends: number = 0;

  /**
   * Dynamic threshold for automatic compaction.
   *
   * Returns the larger of 100 or 10% of the current entity count.
   * This scales with graph size to avoid too-frequent compaction on large graphs
   * while maintaining a reasonable minimum for small graphs.
   *
   * @returns Compaction threshold value
   */
  private get compactionThreshold(): number {
    return Math.max(100, Math.floor((this.cache?.entities.length ?? 0) * 0.1));
  }

  /**
   * O(1) entity lookup by name.
   */
  private nameIndex: NameIndex = new NameIndex();

  /**
   * O(1) entity lookup by type.
   */
  private typeIndex: TypeIndex = new TypeIndex();

  /**
   * Pre-computed lowercase strings for search optimization.
   */
  private lowercaseCache: LowercaseCache = new LowercaseCache();

  /**
   * O(1) relation lookup by entity name.
   */
  private relationIndex: RelationIndex = new RelationIndex();

  /**
   * O(1) observation word lookup by entity.
   * Maps words in observations to entity names.
   */
  private observationIndex: ObservationIndex = new ObservationIndex();

  /**
   * O(1) relation lookup by composite key (`from\u0000to\u0000relationType`).
   * Maps to the live relation object held in `cache.relations`, enabling
   * O(1) upsert-in-place on duplicate appends (S3-style cache maintenance)
   * and O(1) targeted deletes.
   */
  private relationKeyMap: Map<string, Relation> = new Map();

  /**
   * Phase 10 Sprint 2: Event emitter for graph change notifications.
   * Allows external systems to subscribe to graph changes.
   */
  private eventEmitter: GraphEventEmitter = new GraphEventEmitter();

  /**
   * Validated file path (after path traversal checks).
   */
  private memoryFilePath: string;

  /**
   * When set, reads and writes route through the segment-file
   * backend instead of the single JSONL file. Activated by setting
   * `MEMORY_STORAGE_SEGMENT_COUNT >= 2` in the environment.
   * Default (`null`) preserves byte-identical behavior with the
   * pre-Phase-7 single-file format.
   */
  private segmentStorage: FileSegmentStorage | null;

  /**
   * Create a new GraphStorage instance.
   *
   * @param memoryFilePath - Absolute path to the JSONL file
   * @throws {FileOperationError} If path traversal is detected
   */
  constructor(memoryFilePath: string) {
    // Security: Validate path to prevent path traversal attacks.
    // confineToBase=false: memoryFilePath comes from ManagerContext, which
    // already validated it. Tests pass tmpdir() paths; the ".." segment
    // defense-in-depth check still runs.
    this.memoryFilePath = validateFilePath(memoryFilePath, undefined, false);
    this.segmentStorage = resolveSegmentStorage(this.memoryFilePath);
  }

  // ==================== Phase 10 Sprint 2: Event Emitter Access ====================

  /**
   * Get the event emitter for subscribing to graph changes.
   *
   * @returns GraphEventEmitter instance
   *
   * @example
   * ```typescript
   * const storage = new GraphStorage('/data/memory.jsonl');
   *
   * // Subscribe to entity creation events
   * storage.events.on('entity:created', (event) => {
   *   console.log(`Entity ${event.entity.name} created`);
   * });
   *
   * // Subscribe to all events
   * storage.events.onAny((event) => {
   *   console.log(`Graph event: ${event.type}`);
   * });
   * ```
   */
  get events(): GraphEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Synchronous access to the in-memory cached graph. Returns `null` if the
   * cache is not yet warm — in which case consumers should call
   * `loadGraph()` once to populate it and then use this accessor on
   * subsequent reads.
   *
   * Intended for integrations that need a synchronous read path backed by
   * `GraphStorage`'s already-materialized cache (e.g., the `ObservableDataModel`
   * adapter consumed by JSON-UI's `DataProvider`, which must supply a
   * synchronous `snapshot()` to React's `useSyncExternalStore`). Most
   * callers should prefer `loadGraph()`, which lazy-loads on first call.
   *
   * The returned reference is the live cache object — do NOT mutate it.
   * Use `loadGraph()` for a defensive read or `getGraphForMutation()` for
   * a mutable copy.
   */
  get cachedGraph(): ReadonlyKnowledgeGraph | null {
    return this.cache;
  }

  // ==================== Durable File Operations ====================

  /**
   * Write content to file with fsync for durability.
   *
   * @param content - Content to write
   */
  private async durableWriteFile(content: string): Promise<void> {
    await durableWriteFileShared(this.memoryFilePath, content);
  }

  /**
   * Append content to file with fsync for durability.
   *
   * @param content - Content to append
   * @param prependNewline - Whether to prepend a newline
   */
  private async durableAppendFile(content: string, prependNewline: boolean): Promise<void> {
    await restrictSensitiveFilePermissions(this.memoryFilePath);
    const fd = await fs.open(this.memoryFilePath, 'a', 0o600);
    try {
      const dataToWrite = prependNewline ? '\n' + content : content;
      await fd.write(dataToWrite);
      await fd.sync();
    } finally {
      await fd.close();
    }
  }

  /**
   * Append one or more JSONL lines with a single fsync. Creates the file
   * when it does not exist yet (ENOENT fallback mirrors the historical
   * per-line append behavior).
   *
   * @param lines - Serialized JSONL lines (no trailing newline)
   */
  private async appendLines(lines: string[]): Promise<void> {
    const content = lines.join('\n');
    try {
      const stat = await fs.stat(this.memoryFilePath);
      await this.durableAppendFile(content, stat.size > 0);
    } catch (error) {
      // File doesn't exist - create it
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.durableWriteFile(content);
      } else {
        throw error;
      }
    }
  }

  /**
   * Load the knowledge graph from disk (read-only access).
   *
   * OPTIMIZED: Returns cached reference directly without copying.
   * This is O(1) regardless of graph size. For mutation operations,
   * use getGraphForMutation() instead.
   *
   * @returns Promise resolving to read-only knowledge graph reference
   * @throws Error if file exists but cannot be read or parsed
   */
  async loadGraph(): Promise<ReadonlyKnowledgeGraph> {
    // Return cached graph directly (no copying - O(1))
    if (this.cache !== null) {
      return this.cache;
    }

    // Cache miss - load from disk via the shared in-flight
    // promise so concurrent callers don't both invoke loadFromDisk.
    await this.ensureLoaded();
    return this.cache!;
  }

  /**
   * Get a mutable copy of the graph for write operations.
   *
   * Creates deep copies of entity and relation arrays to allow
   * safe mutation without affecting the cached data.
   *
   * @returns Promise resolving to mutable knowledge graph copy
   */
  async getGraphForMutation(): Promise<KnowledgeGraph> {
    await this.ensureLoaded();
    return {
      entities: this.cache!.entities.map(e => ({
        ...e,
        observations: [...e.observations],
        tags: e.tags ? [...e.tags] : undefined,
      })),
      relations: this.cache!.relations.map(r => ({ ...r })),
    };
  }

  /**
   * Ensure the cache is loaded from disk. Concurrent callers share
   * the same in-flight promise so `loadFromDisk` runs at most once
   * per cold-cache window. On error, the in-flight promise is
   * cleared (not the cache) so the next caller retries from disk.
   */
  async ensureLoaded(): Promise<void> {
    if (this.cache !== null) return;
    if (this.loadingPromise !== null) {
      await this.loadingPromise;
      return;
    }
    this.loadingPromise = this.loadFromDisk().finally(() => {
      this.loadingPromise = null;
    });
    await this.loadingPromise;
  }

  /**
   * Internal method to load graph from disk into cache.
   */
  private async loadFromDisk(): Promise<void> {
    if (this.segmentStorage !== null) {
      await this.loadFromSegments();
      return;
    }
    // Phase 11 task 84: when MEMORY_USE_MMAP=true AND the file is
    // larger than the configured threshold, iterate lines via the
    // FsReadMmapBackend's range-read path instead of slurping the
    // whole file into a single string. Smaller files stay on the
    // existing fs.readFile path — for sub-threshold files the
    // streaming setup overhead doesn't pay off.
    if (await this.shouldUseMmap()) {
      await this.loadViaMmap();
      return;
    }
    try {
      const data = await fs.readFile(this.memoryFilePath, 'utf-8');
      const lines = data.split('\n').filter((line: string) => line.trim() !== '');

      // Use Maps to deduplicate - later entries override earlier ones
      // This supports append-only updates where new versions are appended
      const entityMap = new Map<string, Entity>();
      const relationMap = new Map<string, Relation>();

      // A JSONL line is a tagged entity or relation. `JSON.parse` returns
      // `any`; narrowing on the `type` discriminator below gives us a
      // properly-typed `Entity` / `Relation` without an explicit `any`.
      type JsonlLine =
        | ({ type: 'entity' } & Entity)
        | ({ type: 'relation' } & Relation);

      for (const line of lines) {
        let item: JsonlLine;
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            continue;
          }
          item = sanitizeObject(parsed as Record<string, unknown>) as unknown as JsonlLine;
        } catch {
          // Skip malformed JSON lines (e.g., from partial writes or corruption)
          continue;
        }

        if (item.type === 'entity') {
          // Add createdAt if missing for backward compatibility
          if (!item.createdAt) item.createdAt = new Date().toISOString();
          // Add lastModified if missing for backward compatibility
          if (!item.lastModified) item.lastModified = item.createdAt;

          // Use name as key - later entries override earlier ones
          entityMap.set(item.name, item);
        }

        if (item.type === 'relation') {
          // Add createdAt if missing for backward compatibility
          if (!item.createdAt) item.createdAt = new Date().toISOString();
          // Add lastModified if missing for backward compatibility
          if (!item.lastModified) item.lastModified = item.createdAt;

          // Use composite key for relations
          const key = relationKeyOf(item);
          relationMap.set(key, item);
        }
      }

      // Convert maps to arrays
      const graph: KnowledgeGraph = {
        entities: Array.from(entityMap.values()),
        relations: Array.from(relationMap.values()),
      };

      // Populate cache
      this.cache = graph;

      // Build indexes from loaded data
      this.buildEntityIndexes(graph.entities);
      this.buildRelationIndex(graph.relations);

      // Phase 10 Sprint 2: Emit graph:loaded event
      this.eventEmitter.emitGraphLoaded(graph.entities.length, graph.relations.length);
    } catch (error) {
      // File doesn't exist - create empty graph
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = { entities: [], relations: [] };
        this.clearIndexes();

        // Phase 10 Sprint 2: Emit graph:loaded event for empty graph
        this.eventEmitter.emitGraphLoaded(0, 0);
        return;
      }
      throw error;
    }
  }

  /**
   * Load via the segment backend (activated by `MEMORY_STORAGE_SEGMENT_COUNT
   * >= 2`). Equivalent to `loadFromDisk` but reads each segment file
   * separately. An absent `segments/` directory degrades to an empty
   * graph — matches the ENOENT fallback in the single-file path.
   */
  private async loadFromSegments(): Promise<void> {
    const graph = await this.segmentStorage!.loadAll();
    this.cache = graph;
    this.buildEntityIndexes(graph.entities);
    this.buildRelationIndex(graph.relations);
    this.eventEmitter.emitGraphLoaded(graph.entities.length, graph.relations.length);
  }

  /**
   * Segment-mode mutation persistence. Stages the in-memory mutation via
   * `applyMutation`, then rewrites one segment when the mutation is confined
   * to a single owner; cross-segment mutations retain crash-atomic `saveAll`.
   * On save failure we
   * reload from disk so the cache + indexes don't diverge from the
   * persisted state. Matches the write-first-cache-after contract
   * the single-file append paths use, just at a coarser granularity.
   *
   * **Recovery contract on save failure:**
   * - Speculative cache + index mutations are dropped.
   * - We `clearIndexes()` first, then `loadFromSegments()` rebuilds
   *   from disk. The clear is defense-in-depth — `IndexImpl.build()`
   *   isn't required to be clear-then-add.
   * - If the reload itself fails (disk error, malformed segment),
   *   we throw an aggregated `Error` that mentions both the
   *   original save error and the reload error. The caller should
   *   treat the storage as desynced and reconstruct it.
   */
  private async appendViaSegmentSave(
    applyMutation: () => void,
    dirtySegmentIds?: ReadonlySet<number>,
  ): Promise<void> {
    applyMutation();
    try {
      if (dirtySegmentIds?.size === 1) {
        const id = dirtySegmentIds.values().next().value;
        if (id === undefined) {
          throw new Error('Segment mutation declared one dirty segment but supplied no id');
        }
        await this.segmentStorage!.saveSegment({
          id,
          entities: this.cache!.entities.filter(
            entity => this.segmentStorage!.router.route(entity.name) === id,
          ),
          relations: this.cache!.relations.filter(
            relation => this.segmentStorage!.router.route(relation.from) === id,
          ),
        });
      } else {
        await this.segmentStorage!.saveAll(this.cache!);
      }
    } catch (saveErr) {
      try {
        this.cache = null;
        this.clearIndexes();
        await this.loadFromSegments();
      } catch (reloadErr) {
        // Both writes failed — surface both errors so the caller can
        // tell what happened.
        const saveMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        const reloadMsg = reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
        throw new Error(
          `Segment save failed (${saveMsg}); recovery reload also failed (${reloadMsg}); storage is in a desynced state and must be reconstructed.`,
        );
      }
      throw saveErr;
    }
  }

  /**
   * Phase 11 task 84: decide whether to use the mmap-backed read
   * path. Activated by `MEMORY_USE_MMAP='true'` (strict literal-
   * match, matches Phase 7/8/9/10 env precedents) AND file size
   * > `MEMORY_MMAP_THRESHOLD_BYTES` (default 100 MB).
   *
   * Files below the threshold stay on the existing `fs.readFile`
   * path — for small files the per-line streaming setup overhead
   * eats the mmap perf benefit.
   */
  private async shouldUseMmap(): Promise<boolean> {
    if (process.env.MEMORY_USE_MMAP !== 'true') return false;
    const thresholdRaw = process.env.MEMORY_MMAP_THRESHOLD_BYTES;
    // Phase 11 review #4: accept `0` to mean "always use mmap"
    // (size > 0 trivially true for any non-empty file). Without
    // this, `'0'` silently fell back to the 100 MB default which
    // surprised operators who wrote `MEMORY_MMAP_THRESHOLD_BYTES=0`
    // to force the mmap path on.
    const threshold = thresholdRaw && /^(0|[1-9][0-9]*)$/.test(thresholdRaw)
      ? Number(thresholdRaw)
      : 100 * 1024 * 1024;
    try {
      const stat = await fs.stat(this.memoryFilePath);
      return stat.size > threshold;
    } catch {
      // ENOENT / EACCES — fall back to the regular path which
      // already handles those cases.
      return false;
    }
  }

  /**
   * Load via the `FsReadMmapBackend` + `streamLines` helper.
   * Iterates lines lazily, holding at most one 64 KB chunk in
   * memory at a time. Compared to `fs.readFile`+split, this avoids
   * the peak-RSS spike of loading the whole file as a single
   * string for multi-GB JSONLs.
   */
  private async loadViaMmap(): Promise<void> {
    const backend = new FsReadMmapBackend();
    const handle = await backend.open(this.memoryFilePath);
    try {
      const entityMap = new Map<string, Entity>();
      const relationMap = new Map<string, Relation>();
      // Track line number for debuggable parse errors (review #2).
      // The fs.readFile path doesn't carry line numbers either, but
      // mmap-mode targets huge files where "which line broke?" is
      // exactly the information operators need.
      let lineNumber = 0;

      for await (const lineBuf of streamLines(backend, handle)) {
        lineNumber++;
        const line = lineBuf.toString('utf-8').trim();
        if (line === '') continue;
        let item: unknown;
        try {
          item = JSON.parse(line);
        } catch (err) {
          // Surface the underlying SyntaxError message + line
          // number so a 1 GB file's bad row is locatable.
          const cause = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to parse line ${lineNumber} of ${this.memoryFilePath}: ${cause} (preview: ${line.slice(0, 100)})`,
          );
        }
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          continue;
        }
        const rec = sanitizeObject(item as Record<string, unknown>) as Record<string, unknown>;
        if (rec.type === 'entity') {
          if (!rec.createdAt) rec.createdAt = new Date().toISOString();
          if (!rec.lastModified) rec.lastModified = rec.createdAt;
          entityMap.set(rec.name as string, rec as unknown as Entity);
        } else if (rec.type === 'relation') {
          if (!rec.createdAt) rec.createdAt = new Date().toISOString();
          if (!rec.lastModified) rec.lastModified = rec.createdAt;
          const relation = rec as unknown as Relation;
          relationMap.set(relationKeyOf(relation), relation);
        }
      }

      const graph: KnowledgeGraph = {
        entities: Array.from(entityMap.values()),
        relations: Array.from(relationMap.values()),
      };
      this.cache = graph;
      this.buildEntityIndexes(graph.entities);
      this.buildRelationIndex(graph.relations);
      this.eventEmitter.emitGraphLoaded(graph.entities.length, graph.relations.length);
    } finally {
      await backend.close(handle);
    }
  }

  /**
   * Build all entity indexes from entity array.
   */
  private buildEntityIndexes(entities: Entity[]): void {
    this.nameIndex.build(entities);
    this.typeIndex.build(entities);
    this.lowercaseCache.build(entities);

    // Build observation index
    this.observationIndex.clear();
    for (const entity of entities) {
      this.observationIndex.add(entity.name, entity.observations);
    }
  }

  /**
   * Build relation index (and relation key map) from relation array.
   */
  private buildRelationIndex(relations: Relation[]): void {
    this.relationIndex.build(relations);
    this.relationKeyMap.clear();
    for (const relation of relations) {
      this.relationKeyMap.set(relationKeyOf(relation), relation);
    }
  }

  /**
   * Clear all indexes.
   */
  private clearIndexes(): void {
    this.nameIndex.clear();
    this.typeIndex.clear();
    this.lowercaseCache.clear();
    this.relationIndex.clear();
    this.observationIndex.clear();
    this.relationKeyMap.clear();
  }

  /**
   * Upsert an entity into the in-memory cache + indexes.
   *
   * When an entity with the same name already exists, its live object is
   * mutated **in place** (stale fields removed, new fields assigned) so
   * every structure holding a reference to it — `cache.entities`,
   * `NameIndex` — stays consistent in O(1) without array scans. This
   * mirrors the on-disk JSONL semantics where a later line for the same
   * name replaces the earlier one on reload.
   *
   * @returns The live cache object for the entity (the existing object on
   *   replace, the given object on insert)
   */
  private upsertEntityInCache(entity: Entity): Entity {
    const existing = this.nameIndex.get(entity.name);
    if (existing !== undefined && existing !== entity) {
      const oldType = existing.entityType;
      const target = existing as unknown as Record<string, unknown>;
      const source = entity as unknown as Record<string, unknown>;
      for (const key of Object.keys(target)) {
        if (!(key in source)) delete target[key];
      }
      Object.assign(target, source);
      if (oldType !== existing.entityType) {
        this.typeIndex.updateType(existing.name, oldType, existing.entityType);
      }
      this.lowercaseCache.set(existing);
      this.observationIndex.remove(existing.name);
      this.observationIndex.add(existing.name, existing.observations);
      return existing;
    }
    if (existing === undefined) {
      this.cache!.entities.push(entity);
    }
    this.nameIndex.add(entity);
    this.typeIndex.add(entity);
    this.lowercaseCache.set(entity);
    this.observationIndex.remove(entity.name);
    this.observationIndex.add(entity.name, entity.observations);
    return entity;
  }

  /**
   * Upsert a relation into the in-memory cache + indexes. Same in-place
   * replace strategy as `upsertEntityInCache` — a duplicate
   * `from`/`to`/`relationType` key mutates the live object (matching the
   * on-disk dedup-on-reload semantics and SQLite's INSERT OR REPLACE)
   * instead of pushing a duplicate row into the cache array.
   *
   * @returns The live cache object for the relation
   */
  private upsertRelationInCache(relation: Relation): Relation {
    const key = relationKeyOf(relation);
    const existing = this.relationKeyMap.get(key);
    if (existing !== undefined && existing !== relation) {
      const target = existing as unknown as Record<string, unknown>;
      const source = relation as unknown as Record<string, unknown>;
      for (const k of Object.keys(target)) {
        if (!(k in source)) delete target[k];
      }
      Object.assign(target, source);
      return existing;
    }
    if (existing === undefined) {
      this.cache!.relations.push(relation);
      this.relationIndex.add(relation);
      this.relationKeyMap.set(key, relation);
    }
    return relation;
  }

  /**
   * Save the knowledge graph to disk.
   *
   * OPTIMIZED: Updates cache directly after write to avoid re-reading.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * Writes the graph to JSONL format, with one JSON object per line.
   *
   * @param graph - The knowledge graph to save
   * @returns Promise resolving when save is complete
   * @throws Error if file cannot be written
   */
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.saveGraphInternal(graph);
    });
  }

  /**
   * Append a single entity to the file (O(1) write operation).
   *
   * OPTIMIZED: Uses file append instead of full rewrite.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Updates cache in-place and triggers compaction when threshold is reached.
   *
   * @param entity - The entity to append
   * @returns Promise resolving when append is complete
   */
  async appendEntity(entity: Entity): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (this.segmentStorage !== null) {
        // Segment mode rewrites only the owning segment for this entity.
        // `pendingAppends` is a single-file compaction counter, so it
        // remains reset in segment mode.
        await this.appendViaSegmentSave(
          () => {
            this.upsertEntityInCache(entity);
          },
          new Set([this.segmentStorage.router.route(entity.name)]),
        );
        this.pendingAppends = 0;
        bumpEntityGeneration();
        this.eventEmitter.emitEntityCreated(entity);
        return;
      }

      const line = serializeEntityLine(entity);

      // Append to file with fsync for durability (write FIRST, then update cache)
      await this.appendLines([line]);

      // Update cache + indexes in-place (after successful file write).
      // Duplicate names replace the live cache object (matches on-disk
      // dedup-on-reload semantics and SQLite's INSERT OR REPLACE).
      this.upsertEntityInCache(entity);

      this.pendingAppends++;

      // S6: lazily invalidate entity-dependent search caches
      bumpEntityGeneration();

      // Phase 10 Sprint 2: Emit entity:created event
      this.eventEmitter.emitEntityCreated(entity);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Append multiple entities in a single write (S2 delta persistence).
   *
   * One serialized block, one fsync — O(changed) instead of the previous
   * manager-level full-graph rewrite. Cache/index maintenance and event
   * emission are per-entity (`entity:created` fires exactly once per
   * entity; no `graph:saved` — that event is reserved for true full-graph
   * writes).
   *
   * Duplicate names follow the same upsert semantics as `appendEntity`.
   *
   * Segment mode (`MEMORY_STORAGE_SEGMENT_COUNT >= 2`) falls back to a
   * single full `saveAll` for the whole batch (documented segment-mode
   * limitation; single-file mode stays O(changed)).
   *
   * @param entities - Entities to append (no-op when empty)
   */
  async appendEntities(entities: Entity[]): Promise<void> {
    if (entities.length === 0) return;
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (this.segmentStorage !== null) {
        const dirtySegments = new Set(
          entities.map(entity => this.segmentStorage!.router.route(entity.name)),
        );
        await this.appendViaSegmentSave(
          () => {
            for (const entity of entities) {
              this.upsertEntityInCache(entity);
            }
          },
          dirtySegments,
        );
        this.pendingAppends = 0;
        bumpEntityGeneration();
        for (const entity of entities) {
          this.eventEmitter.emitEntityCreated(entity);
        }
        return;
      }

      const lines = entities.map(serializeEntityLine);
      await this.appendLines(lines);

      for (const entity of entities) {
        this.upsertEntityInCache(entity);
      }

      this.pendingAppends += entities.length;
      bumpEntityGeneration();

      for (const entity of entities) {
        this.eventEmitter.emitEntityCreated(entity);
      }

      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Append a single relation to the file (O(1) write operation).
   *
   * OPTIMIZED: Uses file append instead of full rewrite.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Updates cache in-place and triggers compaction when threshold is reached.
   *
   * @param relation - The relation to append
   * @returns Promise resolving when append is complete
   */
  async appendRelation(relation: Relation): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (this.segmentStorage !== null) {
        // Relations are owned by the segment of their `from` endpoint.
        await this.appendViaSegmentSave(
          () => {
            this.upsertRelationInCache(relation);
          },
          new Set([this.segmentStorage.router.route(relation.from)]),
        );
        this.pendingAppends = 0;
        bumpRelationGeneration();
        this.eventEmitter.emitRelationCreated(relation);
        return;
      }

      const line = serializeRelationLine(relation);

      // Append to file with fsync for durability (write FIRST, then update cache)
      await this.appendLines([line]);

      // Update cache + index in-place (after successful file write).
      // Duplicate keys replace the live cache object (matches on-disk
      // dedup-on-reload semantics and SQLite's INSERT OR REPLACE).
      this.upsertRelationInCache(relation);

      this.pendingAppends++;

      // S6: lazily invalidate relation-dependent search caches
      bumpRelationGeneration();

      // Phase 10 Sprint 2: Emit relation:created event
      this.eventEmitter.emitRelationCreated(relation);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Append multiple relations in a single write (S2 delta persistence).
   *
   * One serialized block, one fsync. Emits `relation:created` exactly once
   * per relation; no `graph:saved`. Duplicate keys follow the same upsert
   * semantics as `appendRelation`.
   *
   * Segment mode falls back to a single full `saveAll` for the batch.
   *
   * @param relations - Relations to append (no-op when empty)
   */
  async appendRelations(relations: Relation[]): Promise<void> {
    if (relations.length === 0) return;
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (this.segmentStorage !== null) {
        const dirtySegments = new Set(
          relations.map(relation => this.segmentStorage!.router.route(relation.from)),
        );
        await this.appendViaSegmentSave(
          () => {
            for (const relation of relations) {
              this.upsertRelationInCache(relation);
            }
          },
          dirtySegments,
        );
        this.pendingAppends = 0;
        bumpRelationGeneration();
        for (const relation of relations) {
          this.eventEmitter.emitRelationCreated(relation);
        }
        return;
      }

      const lines = relations.map(serializeRelationLine);
      await this.appendLines(lines);

      for (const relation of relations) {
        this.upsertRelationInCache(relation);
      }

      this.pendingAppends += relations.length;
      bumpRelationGeneration();

      for (const relation of relations) {
        this.eventEmitter.emitRelationCreated(relation);
      }

      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Compact the file by rewriting it with only current cache contents.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent operations.
   * Removes duplicate entries and cleans up the file.
   * Resets pending appends counter.
   *
   * @returns Promise resolving when compaction is complete
   */
  async compact(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.compactInternal();
    });
  }

  /**
   * Internal compact implementation (must be called within mutex).
   *
   * @returns Promise resolving when compaction is complete
   */
  private async compactInternal(): Promise<void> {
    if (this.cache === null) {
      return;
    }

    // Rewrite file with current cache (removes duplicates/updates)
    await this.saveGraphInternal(this.cache);
    this.pendingAppends = 0;
  }

  /**
   * Internal saveGraph implementation (must be called within mutex).
   *
   * @param graph - The knowledge graph to save
   * @returns Promise resolving when save is complete
   */
  private async saveGraphInternal(graph: KnowledgeGraph): Promise<void> {
    if (this.segmentStorage !== null) {
      await this.segmentStorage.saveAll(graph);
      this.cache = graph;
      this.buildEntityIndexes(graph.entities);
      this.buildRelationIndex(graph.relations);
      clearAllSearchCaches();
      bumpEntityGeneration();
      bumpRelationGeneration();
      this.eventEmitter.emitGraphSaved(graph.entities.length, graph.relations.length);
      return;
    }
    await this.writeGraphFile(graph);

    // Update cache directly with the saved graph (avoid re-reading from disk)
    this.cache = graph;

    // Rebuild indexes with new graph data
    this.buildEntityIndexes(graph.entities);
    this.buildRelationIndex(graph.relations);

    // Reset pending appends since file is now clean
    this.pendingAppends = 0;

    // Clear all search caches since graph data has changed (full clear is
    // retained for true full-graph writes; delta ops use generation bumps)
    clearAllSearchCaches();
    bumpEntityGeneration();
    bumpRelationGeneration();

    // Phase 10 Sprint 2: Emit graph:saved event
    this.eventEmitter.emitGraphSaved(graph.entities.length, graph.relations.length);
  }

  /**
   * Serialize a full graph and durably rewrite the JSONL file. Pure
   * write helper — no cache/index/event side effects (callers own those).
   */
  private async writeGraphFile(graph: KnowledgeGraph): Promise<void> {
    const lines = [
      ...graph.entities.map(serializeEntityLine),
      ...graph.relations.map(serializeRelationLine),
    ];
    await this.durableWriteFile(lines.join('\n'));
  }

  /**
   * Get the current pending appends count.
   *
   * Useful for testing compaction behavior.
   *
   * @returns Number of pending appends since last compaction
   */
  getPendingAppends(): number {
    return this.pendingAppends;
  }

  /**
   * Update an entity in-place in the cache and append to file.
   *
   * OPTIMIZED: Modifies cache directly and appends updated version to file.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Does not rewrite the entire file - compaction handles deduplication later.
   *
   * @param entityName - Name of the entity to update
   * @param updates - Partial entity updates to apply
   * @returns Promise resolving to true if entity was found and updated, false otherwise
   */
  async updateEntity(entityName: string, updates: Partial<Entity>): Promise<boolean> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      // O(1) NameIndex lookup — the index maps to the same live object
      // held in `cache.entities`, so in-place mutation stays consistent.
      const entity = this.nameIndex.get(entityName);
      if (entity === undefined) {
        return false;
      }

      const oldType = entity.entityType;
      const timestamp = new Date().toISOString();

      if (this.segmentStorage !== null) {
        // Segment mode rewrites the entity's owning segment after applying
        // the in-cache mutation.
        // Capture pre-mutation state for the change event — deep-
        // clone array/object fields so the snapshot survives the
        // in-place `Object.assign` mutation that follows.
        const previous: Partial<Entity> = {};
        for (const key of Object.keys(updates)) {
          const v = (entity as unknown as Record<string, unknown>)[key];
          (previous as Record<string, unknown>)[key] =
            v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
        }
        await this.appendViaSegmentSave(
          () => {
            Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
            entity.lastModified = timestamp;
            this.nameIndex.add(entity);
            if (updates.entityType && updates.entityType !== oldType) {
              this.typeIndex.updateType(entityName, oldType, updates.entityType);
            }
            this.lowercaseCache.set(entity);
            if (updates.observations) {
              this.observationIndex.remove(entityName);
              this.observationIndex.add(entityName, entity.observations);
            }
          },
          new Set([this.segmentStorage.router.route(entityName)]),
        );
        this.pendingAppends = 0;
        bumpEntityGeneration();
        this.eventEmitter.emitEntityUpdated(entityName, updates, previous);
        return true;
      }

      // Phase 10 Sprint 2: Capture previous values for event
      const previousValues: Partial<Entity> = {};
      for (const key of Object.keys(updates) as Array<keyof Entity>) {
        if (key in entity) {
          // TS can't prove the per-key value-type alignment when `key` is a
          // union — runtime correctness holds because `key` is narrowed to a
          // single Entity field per iteration.
          (previousValues as Record<string, unknown>)[key] = entity[key];
        }
      }

      // Build the updated entity data for file write BEFORE modifying cache.
      // Sanitize before serializing so dangerous keys never reach disk.
      const sanitizedUpdates = sanitizeObject(updates as Record<string, unknown>);
      const updatedEntity = {
        ...entity,
        ...sanitizedUpdates,
        lastModified: timestamp,
      };

      const line = serializeEntityLine(updatedEntity);

      // Write to file FIRST with durability - if this fails, cache remains consistent
      await this.appendLines([line]);

      // File write succeeded - NOW update cache in-place (sanitized to prevent prototype pollution)
      Object.assign(entity, sanitizedUpdates);
      entity.lastModified = timestamp;

      // Update indexes
      this.nameIndex.add(entity); // Update reference
      if (updates.entityType && updates.entityType !== oldType) {
        this.typeIndex.updateType(entityName, oldType, updates.entityType);
      }
      this.lowercaseCache.set(entity); // Recompute lowercase
      if (updates.observations) {
        this.observationIndex.remove(entityName); // Remove old observations
        this.observationIndex.add(entityName, entity.observations); // Add new observations
      }

      this.pendingAppends++;

      // S6: lazily invalidate entity-dependent search caches
      bumpEntityGeneration();

      // Phase 10 Sprint 2: Emit entity:updated event
      this.eventEmitter.emitEntityUpdated(entityName, updates, previousValues);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }

      return true;
    });
  }

  /**
   * Update multiple entities in a single write (S2 delta persistence).
   *
   * Validates that every named entity exists **before** applying anything
   * (all-or-nothing, preserving the atomic semantics of the previous
   * full-graph-save path), then appends one updated JSONL line per entity
   * with a single fsync. Emits `entity:updated` exactly once per entity
   * (with `previousValues`); no `graph:saved`.
   *
   * Timestamp semantics: an explicit `updates.lastModified` wins;
   * otherwise `options.timestamp` (letting callers stamp a whole batch
   * uniformly); otherwise the current time.
   *
   * Segment mode falls back to a single full `saveAll` for the batch.
   *
   * @param batch - Per-entity partial updates
   * @param options - Optional shared timestamp for the batch
   * @returns The live updated entity objects (same order as `batch`)
   * @throws {EntityNotFoundError} If any named entity does not exist
   *   (checked before any mutation)
   */
  async updateEntities(
    batch: Array<{ name: string; updates: Partial<Entity> }>,
    options?: { timestamp?: string },
  ): Promise<Entity[]> {
    if (batch.length === 0) return [];
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      // Validate all names first — all-or-nothing.
      for (const { name } of batch) {
        if (!this.nameIndex.has(name)) {
          throw new EntityNotFoundError(name);
        }
      }

      const defaultTimestamp = options?.timestamp ?? new Date().toISOString();

      // Pre-compute everything needed for the write + post-write cache
      // application so a failed write leaves the cache untouched.
      const prepared: Array<{
        entity: Entity;
        sanitized: Record<string, unknown>;
        updates: Partial<Entity>;
        previousValues: Partial<Entity>;
        lastModified: string;
        line: string;
      }> = [];

      for (const { name, updates } of batch) {
        const entity = this.nameIndex.get(name)!;
        const sanitized = sanitizeObject(updates as Record<string, unknown>);
        const lastModified =
          typeof sanitized.lastModified === 'string'
            ? sanitized.lastModified
            : defaultTimestamp;

        const previousValues: Partial<Entity> = {};
        for (const key of Object.keys(updates)) {
          if (key in entity) {
            (previousValues as Record<string, unknown>)[key] =
              (entity as unknown as Record<string, unknown>)[key];
          }
        }

        const updatedEntity = { ...entity, ...sanitized, lastModified } as Entity;
        prepared.push({
          entity,
          sanitized,
          updates,
          previousValues,
          lastModified,
          line: serializeEntityLine(updatedEntity),
        });
      }

      if (this.segmentStorage !== null) {
        const dirtySegments = new Set(
          prepared.map(p => this.segmentStorage!.router.route(p.entity.name)),
        );
        await this.appendViaSegmentSave(
          () => {
            for (const p of prepared) {
              this.applyPreparedEntityUpdate(p);
            }
          },
          dirtySegments,
        );
        this.pendingAppends = 0;
        bumpEntityGeneration();
        for (const p of prepared) {
          this.eventEmitter.emitEntityUpdated(p.entity.name, p.updates, p.previousValues);
        }
        return prepared.map(p => p.entity);
      }

      // Write FIRST (single fsync), then apply to cache.
      await this.appendLines(prepared.map(p => p.line));

      for (const p of prepared) {
        this.applyPreparedEntityUpdate(p);
      }

      this.pendingAppends += prepared.length;
      bumpEntityGeneration();

      for (const p of prepared) {
        this.eventEmitter.emitEntityUpdated(p.entity.name, p.updates, p.previousValues);
      }

      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }

      return prepared.map(p => p.entity);
    });
  }

  /**
   * Apply one prepared entity update to the live cache object + indexes.
   * Shared by the single-file and segment-mode branches of
   * `updateEntities`.
   */
  private applyPreparedEntityUpdate(p: {
    entity: Entity;
    sanitized: Record<string, unknown>;
    updates: Partial<Entity>;
    lastModified: string;
  }): void {
    const { entity, sanitized, updates, lastModified } = p;
    const oldType = entity.entityType;
    Object.assign(entity, sanitized);
    entity.lastModified = lastModified;

    this.nameIndex.add(entity);
    if (updates.entityType && updates.entityType !== oldType) {
      this.typeIndex.updateType(entity.name, oldType, updates.entityType);
    }
    this.lowercaseCache.set(entity);
    if (updates.observations) {
      this.observationIndex.remove(entity.name);
      this.observationIndex.add(entity.name, entity.observations);
    }
  }

  /**
   * Delete entities (and cascade-delete every relation touching them) as a
   * targeted storage operation (S2 delta persistence).
   *
   * **JSONL delete strategy (documented):** JSONL is append-only, so a
   * delete cannot be expressed as an appended line — the file is rewritten
   * **once per call** from the filtered in-memory state (O(graph) for
   * deletes, while creates/updates stay O(changed)). Cache and index
   * maintenance is incremental (O(deleted)); `pendingAppends` resets to 0
   * because the rewrite doubles as a compaction.
   *
   * Emits `entity:deleted` once per deleted entity and `relation:deleted`
   * once per cascaded relation; no `graph:saved` (reserved for true
   * full-graph writes). Names that don't exist are silently ignored; a
   * call that deletes nothing performs no write and emits nothing.
   *
   * Segment mode rewrites one segment when all deleted entities and
   * cascaded relations share an owner; otherwise it uses `saveAll`.
   *
   * @param names - Entity names to delete
   * @returns The deleted entities and cascaded relations
   */
  async deleteEntities(
    names: string[],
  ): Promise<{ deletedEntities: Entity[]; deletedRelations: Relation[] }> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      const nameSet = new Set(names);
      const deletedEntities = this.cache!.entities.filter(e => nameSet.has(e.name));
      const deletedRelations = this.cache!.relations.filter(
        r => nameSet.has(r.from) || nameSet.has(r.to),
      );

      if (deletedEntities.length === 0 && deletedRelations.length === 0) {
        return { deletedEntities, deletedRelations };
      }

      const applyCacheDeletion = (): void => {
        this.cache!.entities = this.cache!.entities.filter(e => !nameSet.has(e.name));
        this.cache!.relations = this.cache!.relations.filter(
          r => !nameSet.has(r.from) && !nameSet.has(r.to),
        );
        for (const e of deletedEntities) {
          this.nameIndex.remove(e.name);
          this.typeIndex.remove(e.name, e.entityType);
          this.lowercaseCache.remove(e.name);
          this.observationIndex.remove(e.name);
        }
        for (const r of deletedRelations) {
          this.relationIndex.remove(r);
          this.relationKeyMap.delete(relationKeyOf(r));
        }
      };

      if (this.segmentStorage !== null) {
        const dirtySegments = new Set<number>();
        for (const entity of deletedEntities) {
          dirtySegments.add(this.segmentStorage.router.route(entity.name));
        }
        for (const relation of deletedRelations) {
          dirtySegments.add(this.segmentStorage.router.route(relation.from));
        }
        await this.appendViaSegmentSave(applyCacheDeletion, dirtySegments);
        this.pendingAppends = 0;
      } else {
        // Rewrite the file once from the filtered state (write FIRST so a
        // failed write leaves cache + indexes untouched), then apply the
        // same filtering to the cache incrementally.
        await this.writeGraphFile({
          entities: this.cache!.entities.filter(e => !nameSet.has(e.name)),
          relations: this.cache!.relations.filter(
            r => !nameSet.has(r.from) && !nameSet.has(r.to),
          ),
        });
        applyCacheDeletion();
        // The rewrite doubles as a compaction.
        this.pendingAppends = 0;
      }

      if (deletedEntities.length > 0) bumpEntityGeneration();
      if (deletedRelations.length > 0) bumpRelationGeneration();

      for (const e of deletedEntities) {
        this.eventEmitter.emitEntityDeleted(e.name, e);
      }
      for (const r of deletedRelations) {
        this.eventEmitter.emitRelationDeleted(r.from, r.to, r.relationType);
      }

      return { deletedEntities, deletedRelations };
    });
  }

  /**
   * Delete relations by composite key as a targeted storage operation
   * (S2 delta persistence).
   *
   * **JSONL delete strategy (documented):** as with `deleteEntities`, a
   * relation delete rewrites the file once per call (O(graph)); cache and
   * index maintenance is O(deleted). When only `touchEntities` timestamp
   * bumps apply (no relation actually matched), the write degrades to a
   * cheap O(touched) line append instead of a rewrite.
   *
   * `options.touchEntities` bumps `lastModified` on the named entities in
   * the **same atomic write** — preserving `RelationManager`'s historical
   * "affected entities get a timestamp bump" semantics. Non-existent
   * entity names in `touchEntities` are ignored.
   *
   * Emits `relation:deleted` once per actually-deleted relation and
   * `entity:updated` (changes = `{ lastModified }`) once per touched
   * entity; no `graph:saved`. A call that deletes nothing and touches
   * nothing performs no write and emits nothing.
   *
   * Segment mode rewrites one segment when the relation owners and touched
   * entities share it; otherwise it uses `saveAll`.
   *
   * @param keys - Relation keys (`from`/`to`/`relationType`) to delete
   * @param options - Optional entity-timestamp bump + shared timestamp
   * @returns The actually-deleted relations
   */
  async deleteRelations(
    keys: Array<Pick<Relation, 'from' | 'to' | 'relationType'>>,
    options?: { touchEntities?: string[]; timestamp?: string },
  ): Promise<Relation[]> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      const keySet = new Set(keys.map(relationKeyOf));
      const deletedRelations = this.cache!.relations.filter(r =>
        keySet.has(relationKeyOf(r)),
      );

      const timestamp = options?.timestamp ?? new Date().toISOString();
      const touchedEntities: Entity[] = [];
      const seenTouched = new Set<string>();
      for (const name of options?.touchEntities ?? []) {
        if (seenTouched.has(name)) continue;
        seenTouched.add(name);
        const entity = this.nameIndex.get(name);
        if (entity) touchedEntities.push(entity);
      }

      if (deletedRelations.length === 0 && touchedEntities.length === 0) {
        return deletedRelations;
      }

      const previousTimestamps = touchedEntities.map(e => e.lastModified);

      const applyCacheMutation = (): void => {
        if (deletedRelations.length > 0) {
          this.cache!.relations = this.cache!.relations.filter(
            r => !keySet.has(relationKeyOf(r)),
          );
          for (const r of deletedRelations) {
            this.relationIndex.remove(r);
            this.relationKeyMap.delete(relationKeyOf(r));
          }
        }
        for (const entity of touchedEntities) {
          entity.lastModified = timestamp;
        }
      };

      if (this.segmentStorage !== null) {
        const dirtySegments = new Set<number>();
        for (const relation of deletedRelations) {
          dirtySegments.add(this.segmentStorage.router.route(relation.from));
        }
        for (const entity of touchedEntities) {
          dirtySegments.add(this.segmentStorage.router.route(entity.name));
        }
        await this.appendViaSegmentSave(applyCacheMutation, dirtySegments);
        this.pendingAppends = 0;
      } else if (deletedRelations.length > 0) {
        // Deletes require a rewrite: bump timestamps in-place so the
        // rewrite carries them, restoring on write failure.
        for (const entity of touchedEntities) {
          entity.lastModified = timestamp;
        }
        try {
          await this.writeGraphFile({
            entities: this.cache!.entities,
            relations: this.cache!.relations.filter(r => !keySet.has(relationKeyOf(r))),
          });
        } catch (error) {
          touchedEntities.forEach((entity, i) => {
            entity.lastModified = previousTimestamps[i];
          });
          throw error;
        }
        // Timestamps already applied; apply the relation filtering.
        this.cache!.relations = this.cache!.relations.filter(
          r => !keySet.has(relationKeyOf(r)),
        );
        for (const r of deletedRelations) {
          this.relationIndex.remove(r);
          this.relationKeyMap.delete(relationKeyOf(r));
        }
        this.pendingAppends = 0;
      } else {
        // Timestamp-only bump: append updated entity lines (O(touched)).
        const lines = touchedEntities.map(entity =>
          serializeEntityLine({ ...entity, lastModified: timestamp }),
        );
        await this.appendLines(lines);
        for (const entity of touchedEntities) {
          entity.lastModified = timestamp;
        }
        this.pendingAppends += touchedEntities.length;
      }

      if (deletedRelations.length > 0) bumpRelationGeneration();
      if (touchedEntities.length > 0) bumpEntityGeneration();

      for (const r of deletedRelations) {
        this.eventEmitter.emitRelationDeleted(r.from, r.to, r.relationType);
      }
      touchedEntities.forEach((entity, i) => {
        this.eventEmitter.emitEntityUpdated(
          entity.name,
          { lastModified: timestamp },
          { lastModified: previousTimestamps[i] },
        );
      });

      // The timestamp-only append path can cross the compaction threshold.
      if (this.segmentStorage === null && this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }

      return deletedRelations;
    });
  }

  /**
   * Atomically rename an entity, rewriting every stored reference to the
   * old name:
   * - `Relation.from` / `Relation.to`
   * - other entities' `parentId`
   * - version-chain fields on all entities (`parentEntityName`,
   *   `rootEntityName`, `supersededBy`) — including self-references on
   *   the renamed entity itself.
   *
   * The entity's `id`, `createdAt`, and all other fields are preserved;
   * only `lastModified` is bumped. Referencing entities/relations keep
   * their own timestamps (a rename is a pure reference rewrite, their
   * content did not change).
   *
   * Implementation: load-mutate-save via `saveGraphInternal`, which fully
   * rewrites the file and rebuilds every in-memory index (NameIndex /
   * TypeIndex / LowercaseCache / RelationIndex / ObservationIndex) — the
   * same pattern other bulk mutations use. This also makes segment mode
   * (`MEMORY_STORAGE_SEGMENT_COUNT >= 2`) correct for free: `saveAll`
   * re-routes every entity through `fnv1a32(name) % N`, so the renamed
   * entity migrates to its new owning segment atomically (manifest-based
   * multi-file commit).
   *
   * Does NOT emit entity events itself — `EntityManager.renameEntity`
   * emits `entity:renamed` + `entity:deleted` + `entity:created` after
   * the storage write succeeds. (`saveGraphInternal` still emits its
   * usual `graph:saved`.)
   *
   * @param oldName - Current entity name (must exist)
   * @param newName - New entity name (must not exist)
   * @returns The renamed entity
   * @throws {EntityNotFoundError} If `oldName` does not exist
   * @throws {DuplicateEntityError} If `newName` already exists
   */
  async renameEntity(oldName: string, newName: string): Promise<Entity> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      if (!this.nameIndex.has(oldName)) {
        throw new EntityNotFoundError(oldName);
      }
      if (this.nameIndex.has(newName)) {
        throw new DuplicateEntityError(newName);
      }

      // Deep-copy the graph (same shape as getGraphForMutation) so a
      // failed save leaves the cache untouched.
      const graph: KnowledgeGraph = {
        entities: this.cache!.entities.map(e => ({
          ...e,
          observations: [...e.observations],
          tags: e.tags ? [...e.tags] : undefined,
        })),
        relations: this.cache!.relations.map(r => ({ ...r })),
      };

      const renamed = graph.entities.find(e => e.name === oldName)!;
      renamed.name = newName;
      renamed.lastModified = new Date().toISOString();

      // Rewrite all name references (including self-references on the
      // renamed entity's own version-chain fields).
      for (const e of graph.entities) {
        if (e.parentId === oldName) e.parentId = newName;
        if (e.parentEntityName === oldName) e.parentEntityName = newName;
        if (e.rootEntityName === oldName) e.rootEntityName = newName;
        if (e.supersededBy === oldName) e.supersededBy = newName;
      }
      for (const r of graph.relations) {
        if (r.from === oldName) r.from = newName;
        if (r.to === oldName) r.to = newName;
      }

      // Full rewrite + index rebuild (same pattern as other bulk ops).
      await this.saveGraphInternal(graph);
      return renamed;
    });
  }

  /**
   * Manually clear the cache.
   *
   * Useful for testing or when external processes modify the file.
   *
   * @returns void
   */
  clearCache(): void {
    this.cache = null;
    this.clearIndexes();
  }

  /**
   * Get the file path being used for storage.
   *
   * @returns The memory file path
   */
  getFilePath(): string {
    return this.memoryFilePath;
  }

  // ==================== Index Accessors ====================

  /**
   * Get an entity by name in O(1) time.
   *
   * OPTIMIZED: Uses NameIndex for constant-time lookup.
   *
   * @param name - Entity name to look up
   * @returns Entity if found, undefined otherwise
   */
  getEntityByName(name: string): Entity | undefined {
    return this.nameIndex.get(name);
  }

  /**
   * Check if an entity exists by name in O(1) time.
   *
   * @param name - Entity name to check
   * @returns True if entity exists
   */
  hasEntity(name: string): boolean {
    return this.nameIndex.has(name);
  }

  /**
   * Get all entities of a given type in O(1) time.
   *
   * OPTIMIZED: Uses TypeIndex for constant-time lookup of entity names,
   * then uses NameIndex for O(1) entity retrieval.
   *
   * @param entityType - Entity type to filter by (case-insensitive)
   * @returns Array of entities with the given type
   */
  getEntitiesByType(entityType: string): Entity[] {
    const names = this.typeIndex.getNames(entityType);
    const entities: Entity[] = [];
    for (const name of names) {
      const entity = this.nameIndex.get(name);
      if (entity) {
        entities.push(entity);
      }
    }
    return entities;
  }

  /**
   * Get pre-computed lowercase data for an entity.
   *
   * OPTIMIZED: Avoids repeated toLowerCase() calls during search.
   *
   * @param entityName - Entity name to get lowercase data for
   * @returns LowercaseData if entity exists, undefined otherwise
   */
  getLowercased(entityName: string): LowercaseData | undefined {
    return this.lowercaseCache.get(entityName);
  }

  /**
   * Get all unique entity types in the graph.
   *
   * @returns Array of unique entity types (lowercase)
   */
  getEntityTypes(): string[] {
    return this.typeIndex.getTypes();
  }

  // ==================== Relation Index Accessors ====================

  /**
   * Get all relations where the entity is the source (outgoing relations) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up outgoing relations for
   * @returns Array of relations where entity is the source
   */
  getRelationsFrom(entityName: string): Relation[] {
    return this.relationIndex.getRelationsFrom(entityName);
  }

  /**
   * Get all relations where the entity is the target (incoming relations) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up incoming relations for
   * @returns Array of relations where entity is the target
   */
  getRelationsTo(entityName: string): Relation[] {
    return this.relationIndex.getRelationsTo(entityName);
  }

  /**
   * Get all relations involving the entity (both incoming and outgoing) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up all relations for
   * @returns Array of all relations involving the entity
   */
  getRelationsFor(entityName: string): Relation[] {
    return this.relationIndex.getRelationsFor(entityName);
  }

  /**
   * Check if an entity has any relations.
   *
   * @param entityName - Entity name to check
   * @returns True if entity has any relations
   */
  hasRelations(entityName: string): boolean {
    return this.relationIndex.hasRelations(entityName);
  }

  // ==================== Observation Index Accessors ====================

  /**
   * Get entities that have observations containing the given word.
   * Uses the observation index for O(1) lookup.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookup instead of
   * linear scan through all entities and their observations.
   *
   * @param word - Word to search for in observations
   * @returns Set of entity names
   */
  getEntitiesByObservationWord(word: string): Set<string> {
    return this.observationIndex.getEntitiesWithWord(word);
  }

  /**
   * Get entities that have observations containing ANY of the given words (union).
   * Uses the observation index for O(1) lookup per word.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookups.
   *
   * @param words - Array of words to search for
   * @returns Set of entity names containing any of the words
   */
  getEntitiesByAnyObservationWord(words: string[]): Set<string> {
    return this.observationIndex.getEntitiesWithAnyWord(words);
  }

  /**
   * Get entities that have observations containing ALL of the given words (intersection).
   * Uses the observation index for O(1) lookup per word.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookups and set intersection.
   *
   * @param words - Array of words that must all be present
   * @returns Set of entity names containing all of the words
   */
  getEntitiesByAllObservationWords(words: string[]): Set<string> {
    return this.observationIndex.getEntitiesWithAllWords(words);
  }

  /**
   * Get statistics about the observation index.
   *
   * @returns Object with wordCount and entityCount
   */
  getObservationIndexStats(): { wordCount: number; entityCount: number } {
    return this.observationIndex.getStats();
  }

  // ==================== Phase 10 Sprint 1: Transaction Factory ====================

  /**
   * Create a new batch transaction for atomic operations.
   *
   * Returns a BatchTransaction instance that can be used to queue multiple
   * operations and execute them atomically with a single save operation.
   *
   * @returns A new BatchTransaction instance
   *
   * @example
   * ```typescript
   * const storage = new GraphStorage('/data/memory.jsonl');
   *
   * // Create and execute a batch transaction
   * const result = await storage.transaction()
   *   .createEntity({ name: 'Alice', entityType: 'person', observations: ['Developer'] })
   *   .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
   *   .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
   *   .execute();
   *
   * console.log(`Batch completed: ${result.operationsExecuted} operations`);
   * ```
   */
  transaction(): BatchTransaction {
    return new BatchTransaction(this);
  }
}
