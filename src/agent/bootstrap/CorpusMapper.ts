/**
 * Corpus navigation mapper (Recursa RS-10).
 *
 * Builds a navigation tree over a corpus: one `navigation_node` per source (level 0), shard
 * summaries (level 1), and fan-in folds until one root remains. Leaves are keyed by source
 * `ref`; a second source with the same `ref` and different text is recorded as a conflict and
 * never replaces the first. Parent to child edges use `TOPIC_SUMMARIZES` plus
 * `HierarchyManager.setEntityParent`; leaves point at a `source` entity with `located_at`.
 *
 * @module agent/bootstrap/CorpusMapper
 * @experimental Spec RS-10. Naming, partitioning and fold fan-in may change.
 */

import type { Entity, IGraphStorage, Relation } from '../../types/types.js';
import type { NavigationNodeRecord } from '../../types/skills.js';
import { isNavigationNodeEntity } from '../../types/agent-memory.js';
import { EntityManager } from '../../core/EntityManager.js';
import { RelationManager } from '../../core/RelationManager.js';
import { HierarchyManager } from '../../core/HierarchyManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { SummarizationService } from '../SummarizationService.js';
import { KeywordExtractor } from '../../features/KeywordExtractor.js';
import { runAll } from '../harness/ConcurrencyLimiter.js';
import { TOPIC_SUMMARIZES } from '../reconstruction/MemoryGraphBridge.js';
import { sha256Hex } from '../procedural/graph/canonical.js';
import { ValidationError } from '../../utils/errors.js';
import {
  assertDistinctSourceObjects,
  assertPartition,
  buildMemoryEntity,
  chunk,
  defaultPartitioner,
  nowIso,
  shortHash,
  throwIfAbortedSignal,
  unwrapResults,
} from './bootstrapShared.js';

/** Relation from a leaf navigation node to the `source` entity it was read from. */
export const LOCATED_AT_RELATION = 'located_at';

/** Default number of sources per shard (also the fold fan-in). */
export const DEFAULT_SHARD_SIZE = 8;

/** Default number of parallel loader, summary and fold calls. */
export const DEFAULT_MAP_CONCURRENCY = 4;

/** Keywords kept per navigation node. */
const KEYWORDS_PER_NODE = 8;

/** One document of the corpus. */
export interface CorpusSource {
  /** Stable reference (path, URL or id). Leaves are keyed by it. */
  ref: string;
  /** Optional display title (defaults to the ref). */
  title?: string;
  /** Full text. Either this or `loader` must be given. */
  text?: string;
  /** Lazy text loader, used when `text` is absent. */
  loader?: () => Promise<string>;
  /** Free-form metadata; `group` drives the default partitioner. */
  metadata?: Record<string, unknown>;
}

/**
 * Splits sources into shards. Every input source must appear in exactly one shard and no shard
 * may be empty; the mapper rejects anything else.
 */
export type Partitioner = (sources: CorpusSource[]) => CorpusSource[][];

/** Options for {@link CorpusMapper.map}. */
export interface CorpusMapOptions {
  /** Shard partitioner (default: by `metadata.group` when present, else fixed-size chunks). */
  partitioner?: Partitioner;
  /** Fixed shard size and fold fan-in, an integer of at least 2 (default 8). */
  shardSize?: number;
  /** Parallel calls for loaders, summaries and folds (default 4). */
  concurrency?: number;
  /** Cancels pending work; the call rejects with `AbortError`. */
  signal?: AbortSignal;
}

/** Result of a corpus mapping. */
export interface NavigationMap {
  /** Name of the root navigation node, or `undefined` for an empty corpus. */
  rootId: string | undefined;
  /** Level of the root (0 when there is no root). */
  levels: number;
  /** Number of navigation nodes in the map (leaves plus summaries). */
  nodeCount: number;
  /** Second versions of a `ref` whose text differed from the first (the first is kept). */
  conflicts: Array<{ ref: string; hash: string }>;
}

/** Storage and optional helpers used by {@link CorpusMapper}. */
export interface CorpusMapperDeps {
  /** Storage that holds the navigation entities. */
  storage: IGraphStorage;
  /** Write path (pass `ctx.entityManager` for governance). */
  entityManager?: EntityManager;
  /** Relation path. */
  relationManager?: RelationManager;
  /** Summariser (default: an unconfigured `SummarizationService`, which uses the heuristic). */
  summarizer?: SummarizationService;
  /** Keyword extractor (default: a fresh `KeywordExtractor`). */
  keywords?: KeywordExtractor;
}

/**
 * Stable name of the leaf node for a source reference (`nav-0-<hash>`).
 *
 * @param ref - Source reference.
 * @returns Entity name.
 */
export function navigationLeafName(ref: string): string {
  return `nav-0-${shortHash(ref)}`;
}

/**
 * Name of the `source` entity a leaf points at.
 *
 * @param ref - Source reference.
 * @returns Entity name.
 */
export function sourceEntityName(ref: string): string {
  return `source:${ref}`;
}

/** A navigation node known to this run (written now, or already stored). */
interface NodeInfo {
  name: string;
  record: NavigationNodeRecord;
  /** True when this run writes the node. */
  fresh: boolean;
}

/** Claim on one leaf name during the conflict pass. */
interface LeafClaim {
  hash: string;
  fresh: boolean;
  /** Index of the first source with this ref; decides the shard. */
  owner: number;
  source?: CorpusSource;
  text?: string;
}

/** Writes queued during one mapping run. */
interface Persist {
  nodes: NodeInfo[];
  entities: Entity[];
  relations: Relation[];
  parents: Array<{ child: string; parent: string }>;
  sourceNames: Set<string>;
  summaryCount: number;
}

/**
 * Builds navigation maps over corpora. Deterministic for the same inputs: node names derive
 * from source refs and child names, and summaries come from the same summariser.
 *
 * @example
 * ```ts
 * const mapper = new CorpusMapper({ storage });
 * const map = await mapper.map(sources, { shardSize: 8 });
 * ```
 */
export class CorpusMapper {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly relationManager: RelationManager;
  private readonly hierarchy: HierarchyManager;
  private readonly summarizer: SummarizationService;
  private readonly keywords: KeywordExtractor;

  /**
   * Create the mapper.
   *
   * @param deps - Storage and optional write paths and helpers.
   */
  constructor(deps: CorpusMapperDeps) {
    this.storage = deps.storage;
    this.entityManager = deps.entityManager ?? new EntityManager(deps.storage as GraphStorage);
    this.relationManager = deps.relationManager ?? new RelationManager(deps.storage as GraphStorage);
    this.hierarchy = new HierarchyManager(deps.storage as GraphStorage);
    this.summarizer = deps.summarizer ?? new SummarizationService();
    this.keywords = deps.keywords ?? new KeywordExtractor();
  }

  /**
   * Map a corpus into a navigation tree and persist it.
   *
   * @param sources - Corpus documents. Refs may repeat; a repeat with different text is a conflict.
   * @param options - Partitioner, shard size, concurrency and abort signal.
   * @returns The navigation map (empty for an empty corpus).
   * @throws ValidationError when a source has no text or loader, the shard size is below 2, or
   *   the partitioner returns an empty shard, drops a source, duplicates one or adds an unknown one.
   * @throws AbortError when the signal aborts.
   */
  async map(sources: CorpusSource[], options: CorpusMapOptions = {}): Promise<NavigationMap> {
    if (sources.length === 0) return { rootId: undefined, levels: 0, nodeCount: 0, conflicts: [] };
    const shardSize = options.shardSize ?? DEFAULT_SHARD_SIZE;
    if (!Number.isInteger(shardSize) || shardSize < 2) {
      throw new ValidationError('CorpusMapper: shardSize must be an integer of at least 2', [`shardSize=${shardSize}`]);
    }
    const concurrency = options.concurrency ?? DEFAULT_MAP_CONCURRENCY;
    const signal = options.signal;
    throwIfAbortedSignal(signal);
    assertDistinctSourceObjects(sources);
    assertValidRefs(sources);
    const shards = (options.partitioner ?? defaultPartitioner<CorpusSource>(shardSize))(sources);
    const shardOf = assertPartition(sources, shards);

    const texts = await this.loadTexts(sources, concurrency, signal);
    const claims = new Map<string, LeafClaim>();
    const conflicts: Array<{ ref: string; hash: string }> = [];
    const conflictLines = new Map<string, string[]>();
    this.claimLeaves(sources, texts, claims, conflicts, conflictLines);
    const leaves = await this.leafInfos(claims, concurrency, signal);

    const persist: Persist = { nodes: [], entities: [], relations: [], parents: [], sourceNames: new Set(), summaryCount: 0 };
    for (const info of leaves.values()) {
      if (!info.fresh) continue;
      persist.nodes.push(info);
      const sourceName = sourceEntityName(info.record.ref);
      if (this.storage.getEntityByName(sourceName) === undefined && !persist.sourceNames.has(sourceName)) {
        persist.sourceNames.add(sourceName);
        persist.entities.push(buildSourceEntity(sourceName, info.record.ref, nowIso()));
      }
      persist.relations.push({ from: info.name, to: sourceName, relationType: LOCATED_AT_RELATION });
    }

    // Each leaf folds into the shard of its owner (first occurrence of its ref).
    const shardChildren: NodeInfo[][] = shards.map(() => []);
    const byOwner = [...claims.entries()].sort((a, b) => a[1].owner - b[1].owner);
    for (const [name, claim] of byOwner) {
      const k = shardOf.get(sources[claim.owner]!);
      if (k === undefined) throw new Error(`CorpusMapper: owner of ${name} is not in any shard`);
      shardChildren[k]!.push(leaves.get(name)!);
    }

    let level = 1;
    let current = await this.foldLevel(shardChildren.filter((g) => g.length > 0), level, persist, concurrency, signal);
    while (current.length > 1) {
      level += 1;
      current = await this.foldLevel(chunk(current, shardSize), level, persist, concurrency, signal);
    }
    await this.flush(persist, leaves, conflictLines);

    return {
      rootId: current[0]!.name,
      levels: level,
      nodeCount: leaves.size + persist.summaryCount,
      conflicts,
    };
  }

  /**
   * Read the text of every source (inline text, or the loader's result).
   *
   * @returns Text by source object.
   * @throws ValidationError when a source has neither text nor loader.
   */
  private async loadTexts(
    sources: CorpusSource[],
    concurrency: number,
    signal: AbortSignal | undefined,
  ): Promise<Map<CorpusSource, string>> {
    const results = await runAll(
      sources,
      async (s) => {
        if (s.text !== undefined) return s.text;
        if (!s.loader) throw new ValidationError('CorpusMapper: source has neither text nor loader', [s.ref]);
        const loaded: unknown = await s.loader();
        if (typeof loaded !== 'string') {
          throw new ValidationError('CorpusMapper: loader must resolve to a string', [`${s.ref}: got ${loaded === null ? 'null' : typeof loaded}`]);
        }
        return loaded;
      },
      { concurrency, ...(signal ? { signal } : {}) },
    );
    const values = unwrapResults(results, signal);
    const out = new Map<CorpusSource, string>();
    sources.forEach((s, i) => out.set(s, String(values[i])));
    return out;
  }

  /**
   * Decide which leaves are written. The first occurrence of a ref wins; a later different text
   * is a conflict; a stored node with the same name is reused, and a differing hash is a conflict.
   */
  private claimLeaves(
    sources: CorpusSource[],
    texts: Map<CorpusSource, string>,
    claims: Map<string, LeafClaim>,
    conflicts: Array<{ ref: string; hash: string }>,
    conflictLines: Map<string, string[]>,
  ): void {
    sources.forEach((source, i) => {
      const text = texts.get(source)!;
      const hash = sha256Hex(text);
      const name = navigationLeafName(source.ref);
      let claim = claims.get(name);
      if (!claim) {
        const stored = this.storage.getEntityByName(name);
        if (!stored || !isNavigationNodeEntity(stored)) {
          claims.set(name, { hash, fresh: true, owner: i, source, text });
          return;
        }
        claim = { hash: stored.navigationNodeRecord.contentHash, fresh: false, owner: i };
        claims.set(name, claim);
      }
      if (claim.hash === hash) return;
      if (conflicts.some((c) => c.ref === source.ref && c.hash === hash)) return;
      conflicts.push({ ref: source.ref, hash });
      const lines = conflictLines.get(name) ?? [];
      lines.push(`[conflict]: ${hash}`);
      conflictLines.set(name, lines);
    });
  }

  /**
   * Node info for every claim: fresh leaves get a record (summaries computed in parallel);
   * stored leaves are read back.
   */
  private async leafInfos(
    claims: Map<string, LeafClaim>,
    concurrency: number,
    signal: AbortSignal | undefined,
  ): Promise<Map<string, NodeInfo>> {
    const out = new Map<string, NodeInfo>();
    const fresh: Array<[string, LeafClaim]> = [];
    for (const [name, claim] of claims) {
      if (claim.fresh) {
        fresh.push([name, claim]);
        continue;
      }
      const stored = this.storage.getEntityByName(name);
      if (stored && isNavigationNodeEntity(stored)) out.set(name, { name, record: stored.navigationNodeRecord, fresh: false });
    }
    const built = await runAll(
      fresh,
      async ([name, claim]) => {
        const source = claim.source!;
        const text = claim.text!;
        const record: NavigationNodeRecord = {
          level: 0,
          ref: source.ref,
          title: source.title ?? source.ref,
          summary: await this.summarizer.summarize([text]),
          keywords: this.keywords.extractTop(text, KEYWORDS_PER_NODE),
          metadata: source.metadata ?? {},
          contentHash: claim.hash,
          sourceRefs: [source.ref],
        };
        return { name, record, fresh: true } satisfies NodeInfo;
      },
      { concurrency, ...(signal ? { signal } : {}) },
    );
    for (const info of unwrapResults(built, signal)) out.set(info.name, info);
    return out;
  }

  /** Fold one level: each group becomes a summary node at `level`. */
  private async foldLevel(
    groups: NodeInfo[][],
    level: number,
    persist: Persist,
    concurrency: number,
    signal: AbortSignal | undefined,
  ): Promise<NodeInfo[]> {
    const folded = await runAll(groups, (children) => this.summaryNode(children, level, persist), {
      concurrency,
      ...(signal ? { signal } : {}),
    });
    return unwrapResults(folded, signal);
  }

  /**
   * Summary node over `children`: read back when stored, otherwise computed and queued for write.
   * The name hashes the level and child names, so the same inputs give the same node.
   */
  private async summaryNode(children: NodeInfo[], level: number, persist: Persist): Promise<NodeInfo> {
    const name = `nav-${level}-${shortHash(`${level}\n${children.map((c) => c.name).join('\n')}`)}`;
    persist.summaryCount += 1;
    const stored = this.storage.getEntityByName(name);
    if (stored && isNavigationNodeEntity(stored)) return { name, record: stored.navigationNodeRecord, fresh: false };

    const summaries = children.map((c) => c.record.summary);
    const summary = await this.summarizer.summarize(summaries);
    const record: NavigationNodeRecord = {
      level,
      ref: name,
      title: `Level ${level} summary of ${children.length} node(s)`,
      summary,
      keywords: this.keywords.extractTop(summaries.join(' '), KEYWORDS_PER_NODE),
      metadata: {},
      contentHash: sha256Hex(summary),
      sourceRefs: [...new Set(children.flatMap((c) => c.record.sourceRefs))],
    };
    const info: NodeInfo = { name, record, fresh: true };
    persist.nodes.push(info);
    for (const child of children) {
      persist.relations.push({ from: name, to: child.name, relationType: TOPIC_SUMMARIZES });
      persist.parents.push({ child: child.name, parent: name });
    }
    return info;
  }

  /**
   * Write everything queued: new nodes and sources, conflict observations on stored leaves,
   * relations, then parent links.
   */
  private async flush(
    persist: Persist,
    leaves: Map<string, NodeInfo>,
    conflictLines: Map<string, string[]>,
  ): Promise<void> {
    const now = nowIso();
    // A parent link for a node this flush creates is written with the create. Previously every
    // link was a `setEntityParent` call after the fact, and that call validated against
    // `loadGraph()`'s borrowed view (deep-frozen off production) before each write on its own: 36
    // links meant 36 validation passes and 36 durable appends. Links to an already-stored node
    // still go through the hierarchy manager. Conflict observations on stored nodes use one
    // `batchUpdate` with per-entity `expectedVersion` OCC and a single durable commit.
    const parentOf = new Map<string, string>();
    for (const { child, parent } of persist.parents) parentOf.set(child, parent);
    const creating = new Set(persist.nodes.map((info) => info.name));
    for (const info of persist.nodes) {
      const lines = conflictLines.get(info.name) ?? [];
      const parent = parentOf.get(info.name);
      persist.entities.push(
        buildMemoryEntity({
          name: info.name,
          memoryType: 'navigation_node',
          field: 'navigationNodeRecord',
          value: info.record,
          observations: [`[navigation] level ${info.record.level}: ${info.record.title}`, ...lines],
          contentHash: info.record.contentHash,
          ...(parent !== undefined ? { parentId: parent } : {}),
          now,
        }),
      );
    }
    if (persist.entities.length > 0) await this.entityManager.createEntities(parentFirst(persist.entities, persist.parents));

    const conflictUpdates: Array<{ name: string; updates: Partial<Entity>; expectedVersion: number }> = [];
    for (const [name, lines] of conflictLines) {
      const info = leaves.get(name);
      const stored = this.storage.getEntityByName(name);
      if (!info || info.fresh || !stored) continue;
      const toAdd = lines.filter((line) => !stored.observations.includes(line));
      if (toAdd.length === 0) continue;
      conflictUpdates.push({
        name,
        updates: { observations: [...stored.observations, ...toAdd] } as Partial<Entity>,
        expectedVersion: stored.version ?? 1,
      });
    }
    if (conflictUpdates.length > 0) await this.entityManager.batchUpdate(conflictUpdates);
    if (persist.relations.length > 0) await this.relationManager.createRelations(persist.relations);
    for (const { child, parent } of persist.parents) {
      if (creating.has(child)) continue;
      await this.hierarchy.setEntityParent(child, parent);
    }
  }
}

/**
 * Entity for a `source` reference.
 *
 * @param name - Entity name (`source:<ref>`).
 * @param ref - Source reference.
 * @param now - Timestamp.
 * @returns Plain entity of type `source`.
 */
function buildSourceEntity(name: string, ref: string, now: string): Entity {
  return {
    name,
    entityType: 'source',
    observations: [`[source] ${ref}`],
    createdAt: now,
    lastModified: now,
    importance: 3,
  } as Entity;
}

export { defaultPartitioner };

/**
 * Order entities so every node comes after the parent it names.
 *
 * Setting `parentId` at creation avoids a follow-up `setEntityParent` per link (each of those
 * validates against `loadGraph()`'s borrowed view and writes on its own), but both backends require
 * the parent row to exist first: SQLite enforces `parentId` as a foreign key. Nodes whose parent
 * is not part of this batch keep their input position, and a cycle cannot occur because the
 * navigation tree is built top-down.
 *
 * @param entities - Entities to create.
 * @param parents - Child-to-parent links among them.
 * @returns The same entities, parents before children.
 */
function parentFirst(entities: Entity[], parents: ReadonlyArray<{ child: string; parent: string }>): Entity[] {
  const batch = new Set(entities.map((e) => e.name));
  const parentOf = new Map<string, string>();
  for (const { child, parent } of parents) if (batch.has(child) && batch.has(parent)) parentOf.set(child, parent);
  if (parentOf.size === 0) return entities;
  const ordered: Entity[] = [];
  const emitted = new Set<string>();
  const emit = (entity: Entity, seen: Set<string>): void => {
    if (emitted.has(entity.name) || seen.has(entity.name)) return;
    const parentName = parentOf.get(entity.name);
    if (parentName !== undefined) {
      const parent = entities.find((e) => e.name === parentName);
      if (parent) {
        seen.add(entity.name);
        emit(parent, seen);
        seen.delete(entity.name);
      }
    }
    if (emitted.has(entity.name)) return;
    emitted.add(entity.name);
    ordered.push(entity);
  };
  for (const entity of entities) emit(entity, new Set());
  return ordered;
}

/**
 * Maximum length of a source ref: the spec's 512-character ceiling, lowered so that the
 * `source:<ref>` entity name stays within the 500-character entity-name limit.
 */
export const MAX_REF_CHARS = Math.min(512, 500 - 'source:'.length);

/**
 * Reject empty refs and refs longer than {@link MAX_REF_CHARS} characters.
 *
 * @param sources - Corpus documents.
 * @throws ValidationError naming the offending ref.
 */
function assertValidRefs(sources: readonly CorpusSource[]): void {
  for (const s of sources) {
    if (typeof s.ref !== 'string' || s.ref.trim().length === 0) {
      throw new ValidationError('CorpusMapper: source ref must be a non-empty string', [JSON.stringify(s.ref)]);
    }
    if (s.ref.length > MAX_REF_CHARS) {
      throw new ValidationError(`CorpusMapper: source ref longer than ${MAX_REF_CHARS} characters`, [`${s.ref.slice(0, 40)}… (${s.ref.length} chars)`]);
    }
  }
}
