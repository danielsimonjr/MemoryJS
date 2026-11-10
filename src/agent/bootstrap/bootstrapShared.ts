/**
 * Small helpers shared by the bootstrap (corpus mapping) modules: deterministic short hashes,
 * chunking and the entity envelope used for memory-typed records.
 *
 * @module agent/bootstrap/bootstrapShared
 * @experimental Spec RS-10..RS-13.
 */

import type { Entity } from '../../types/types.js';
import { toIsoDateTime } from '../../types/agent-memory.js';
import { sha256Hex } from '../procedural/graph/canonical.js';
import { AbortError, type RunResult } from '../harness/ConcurrencyLimiter.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Deterministic short hash of a string (hex prefix of its SHA-256).
 *
 * @param text - Input text.
 * @param length - Number of hex characters to keep (default 12).
 * @returns Lower-case hex prefix.
 */
export function shortHash(text: string, length = 12): string {
  return sha256Hex(text).slice(0, length);
}

/**
 * Split an array into consecutive chunks of at most `size` items.
 *
 * @param items - Items to split.
 * @param size - Maximum chunk length (at least 1).
 * @returns Chunks in input order.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Text form of an arbitrary metadata value: primitives as-is, objects as JSON.
 *
 * @param value - Metadata value.
 * @returns Display text.
 */
export function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? 'null';
}

/**
 * Current time as an ISO 8601 string.
 *
 * @returns Timestamp string.
 */
export function nowIso(): string {
  return toIsoDateTime(new Date());
}

/** Options for {@link buildMemoryEntity}. */
export interface MemoryEntityParts {
  /** Entity name (the public key). */
  name: string;
  /** Memory type discriminator (snake_case). */
  memoryType: string;
  /** Name of the payload field, e.g. `navigationNodeRecord`. */
  field: string;
  /** Payload record. */
  value: unknown;
  /** Observation lines. */
  observations: string[];
  /** Entity importance (default 5). */
  importance?: number;
  /** Optional content hash stored on the entity. */
  contentHash?: string;
  /** Optional parent link, set at creation instead of a follow-up write. */
  parentId?: string;
  /** Timestamp used for both `createdAt` and `lastModified`. */
  now: string;
}

/**
 * Build a storage entity carrying a memory-typed record, with the same envelope the other
 * Recursa modules write (visibility private, version 1, confidence 1).
 *
 * @param parts - Entity parts.
 * @returns Entity ready for `EntityManager.createEntities`.
 */
export function buildMemoryEntity(parts: MemoryEntityParts): Entity {
  return {
    name: parts.name,
    entityType: parts.memoryType,
    observations: parts.observations,
    createdAt: parts.now,
    lastModified: parts.now,
    importance: parts.importance ?? 5,
    memoryType: parts.memoryType,
    visibility: 'private',
    accessCount: 0,
    confidence: 1,
    confirmationCount: 0,
    version: 1,
    ...(parts.contentHash !== undefined ? { contentHash: parts.contentHash } : {}),
    ...(parts.parentId !== undefined ? { parentId: parts.parentId } : {}),
    [parts.field]: parts.value,
  } as unknown as Entity;
}

/** Minimal shape of a corpus source used by the partition helpers. */
export interface PartitionableSource {
  /** Source reference. */
  ref: string;
  /** Optional metadata; `group` drives the default partitioner. */
  metadata?: Record<string, unknown>;
}

/**
 * Default partitioner: one shard per `metadata.group` value when any source carries a group
 * (ungrouped sources share one shard), otherwise fixed-size chunks of `shardSize`.
 *
 * @param shardSize - Chunk size for the fallback.
 * @returns Partitioner over any sources.
 */
export function defaultPartitioner<T extends PartitionableSource>(shardSize: number): (sources: T[]) => T[][] {
  return (sources) => {
    if (sources.some((s) => s.metadata?.group !== undefined)) {
      const groups = new Map<string, T[]>();
      for (const s of sources) {
        const key = s.metadata?.group === undefined ? '(ungrouped)' : scalarText(s.metadata.group);
        const bucket = groups.get(key) ?? [];
        bucket.push(s);
        groups.set(key, bucket);
      }
      return [...groups.values()];
    }
    return chunk(sources, shardSize);
  };
}

/**
 * Reject an abort signal that has already fired.
 *
 * @param signal - Optional signal.
 * @throws AbortError when aborted.
 */
export function throwIfAbortedSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

/**
 * Unwrap `runAll` results: abort first, then the first item error, else the values in order.
 *
 * @param results - Results from `runAll`.
 * @param signal - Optional signal checked first.
 * @returns Values in input order.
 * @throws AbortError when aborted, or the first item error.
 */
export function unwrapResults<T>(results: Array<RunResult<T>>, signal: AbortSignal | undefined): T[] {
  if (signal?.aborted) throw new AbortError();
  return results.map((r) => {
    if (!r.ok) throw r.error;
    return r.value;
  });
}

/**
 * Reject the same source object appearing twice in the input.
 *
 * @param sources - Input sources.
 * @throws ValidationError on a repeated object.
 */
export function assertDistinctSourceObjects<T>(sources: T[]): void {
  if (new Set(sources).size !== sources.length) {
    throw new ValidationError('CorpusMapper: the same source object was supplied twice', ['use distinct objects']);
  }
}

/**
 * Check that a partition covers every source exactly once with no empty shard.
 *
 * @param sources - Input sources.
 * @param shards - Partitioner output.
 * @returns Shard index by source object.
 * @throws ValidationError on an empty shard, or a dropped, duplicated or unknown source.
 */
export function assertPartition<T extends PartitionableSource>(sources: T[], shards: T[][]): Map<T, number> {
  const known = new Set(sources);
  const seen = new Map<T, number>();
  shards.forEach((shard, k) => {
    if (!Array.isArray(shard) || shard.length === 0) {
      throw new ValidationError('CorpusMapper: partitioner returned an empty shard', [`shard ${k}`]);
    }
    for (const s of shard) {
      if (!known.has(s)) throw new ValidationError('CorpusMapper: partitioner returned an unknown source', [s.ref]);
      if (seen.has(s)) throw new ValidationError('CorpusMapper: partitioner duplicated a source', [s.ref]);
      seen.set(s, k);
    }
  });
  const dropped = sources.find((s) => !seen.has(s));
  if (dropped) throw new ValidationError('CorpusMapper: partitioner dropped a source', [dropped.ref]);
  return seen;
}
