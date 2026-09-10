/**
 * Deterministic hashing for Procedural Graph identity.
 *
 * Graph digest excludes graph/revision identifiers and timestamps so two
 * semantically identical graphs hash the same (feature plan 6.3).
 *
 * @module agent/procedural/graph/canonical
 * @experimental
 */

import { createHash } from 'node:crypto';
import type { PGSnapshot } from '../../../types/proceduralGraph.js';

/**
 * Recursively sort object keys and stringify with no whitespace.
 * Arrays keep their given order. `JSON.stringify` Unicode escapes are stable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Semantic digest of a snapshot. Excludes `graphId`, `revisionId`,
 * `parentRevisionId`, and any timestamps.
 */
export function graphDigest(snapshot: PGSnapshot): string {
  const nodes = [...snapshot.nodes].sort((a, b) => compareString(a.id, b.id));
  const edges = [...snapshot.edges].sort(compareEdges);
  const relationVocabulary = [...snapshot.relationVocabulary].sort(compareString);
  return sha256Hex(canonicalJson({
    cyclePolicy: snapshot.cyclePolicy,
    edges,
    entryNodeId: snapshot.entryNodeId,
    nodes,
    relationVocabulary,
    schemaVersion: snapshot.schemaVersion,
    toolCatalogHash: snapshot.toolCatalogHash,
  }));
}

/** SHA-256 of the canonical JSON of the sorted unique tool names. */
export function toolCatalogHash(tools: readonly string[]): string {
  const unique = [...new Set(tools)].sort(compareString);
  return sha256Hex(canonicalJson(unique));
}

/**
 * Bounded storage key: `pg:<kind>:<sha256(canonicalJson(tuple))>`.
 * Always well under 100 characters (A5).
 */
export function storageKey(
  kind: 'graph' | 'revision' | 'node' | 'evaluation' | 'rejection' | 'run' | 'head',
  tuple: readonly string[],
): string {
  return `pg:${kind}:${sha256Hex(canonicalJson(tuple))}`;
}

export function evaluationFingerprint(parts: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(parts));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort(compareString)) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEdges(
  a: { source: string; target: string; relation: string },
  b: { source: string; target: string; relation: string },
): number {
  return compareString(a.source, b.source)
    || compareString(a.target, b.target)
    || compareString(a.relation, b.relation);
}
