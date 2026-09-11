/**
 * Zod v4 schemas for Procedural Graph snapshots and refiner edit sets.
 *
 * Implementation layer — not `src/types`. Parse functions return
 * diagnostics instead of throwing for expected validation failures.
 *
 * @module agent/procedural/graph/ProceduralGraphSchemas
 * @experimental
 */

import { z } from 'zod';
import type { PGDiagnostic, PGEdge, PGEditSet, PGNode, PGSnapshot } from '../../../types/proceduralGraph.js';

export const PG_LIMITS = {
  maxNodes: 2000,
  maxEdges: 8000,
  maxIdLength: 200,
  maxTextLength: 4000,
  maxSerializedBytes: 2_000_000,
} as const;

const PGNodeTypeSchema = z.enum(['ACTION', 'SKILL', 'REASONING', 'STATE']);
const PGCyclePolicySchema = z.enum(['allow', 'repair', 'reject']);

const idSchema = z.string().min(1).max(PG_LIMITS.maxIdLength);
const textSchema = z.string().max(PG_LIMITS.maxTextLength);
const nullableTextSchema = z.union([textSchema, z.null()]);

export const PGNodeSchema: z.ZodType<PGNode> = z.object({
  id: idSchema,
  type: PGNodeTypeSchema,
  description: textSchema,
  actionName: z.string().min(1).max(PG_LIMITS.maxIdLength).optional(),
}).strict();

export const PGEdgeSchema: z.ZodType<PGEdge> = z.object({
  source: idSchema,
  relation: z.string().min(1).max(PG_LIMITS.maxIdLength),
  target: idSchema,
  condition: nullableTextSchema,
  guidance: nullableTextSchema,
  pitfalls: nullableTextSchema,
}).strict();

export const PGSnapshotSchema: z.ZodType<PGSnapshot> = z.object({
  schemaVersion: z.literal(1),
  graphId: idSchema,
  revisionId: idSchema,
  parentRevisionId: idSchema.optional(),
  entryNodeId: idSchema,
  relationVocabulary: z.array(z.string().min(1).max(PG_LIMITS.maxIdLength)),
  cyclePolicy: PGCyclePolicySchema,
  toolCatalogHash: z.string().min(1),
  nodes: z.array(PGNodeSchema).max(PG_LIMITS.maxNodes),
  edges: z.array(PGEdgeSchema).max(PG_LIMITS.maxEdges),
}).strict();

const PGAddEdgeSchema = z.object({
  source: idSchema,
  relation: z.string().min(1).max(PG_LIMITS.maxIdLength),
  target: idSchema,
  condition: nullableTextSchema,
  guidance: z.string().min(1).max(PG_LIMITS.maxTextLength),
  pitfalls: z.string().min(1).max(PG_LIMITS.maxTextLength),
}).strict();

const PGDeleteEdgeSchema = z.object({
  source: idSchema,
  target: idSchema,
}).strict();

export const PGEditSetSchema: z.ZodType<PGEditSet> = z.object({
  add_nodes: z.array(PGNodeSchema),
  delete_nodes: z.array(z.string().min(1).max(PG_LIMITS.maxIdLength)),
  add_edges: z.array(PGAddEdgeSchema),
  delete_edges: z.array(PGDeleteEdgeSchema),
}).strict();

/**
 * Parse an imported snapshot. Absent `condition` / `guidance` / `pitfalls`
 * fields normalize to `null` (PG-02 / A11) and are reported as
 * `missing-attribute` warnings on the `ok` branch so callers can surface
 * them without failing the import.
 */
export function parseSnapshot(
  input: unknown,
): { ok: true; value: PGSnapshot; diagnostics: PGDiagnostic[] } | { ok: false; diagnostics: PGDiagnostic[] } {
  const { normalized, diagnostics } = normalizeSnapshotInput(input);
  const parsed = PGSnapshotSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, diagnostics: zodIssuesToDiagnostics(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data, diagnostics };
}

/**
 * Strict refiner-output parser (feature plan 9.4).
 * Input must be a single raw JSON object — no fences, no surrounding prose.
 */
export function parseEditSet(
  raw: string,
): { ok: true; value: PGEditSet } | { ok: false; diagnostics: PGDiagnostic[] } {
  if (!isRawJsonObject(raw)) {
    return {
      ok: false,
      diagnostics: [errorDiag('not-raw-json', 'Edit set must be a single raw JSON object with no prose or code fences')],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return {
      ok: false,
      diagnostics: [errorDiag('not-raw-json', 'Edit set is not valid JSON')],
    };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      diagnostics: [errorDiag('not-raw-json', 'Edit set must be a JSON object')],
    };
  }

  const obj = value as Record<string, unknown>;
  const allowed = new Set(['add_nodes', 'delete_nodes', 'add_edges', 'delete_edges']);
  const diagnostics: PGDiagnostic[] = [];

  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      diagnostics.push(errorDiag('unknown-key', `Unknown top-level key '${key}'`));
    }
  }

  for (const key of allowed) {
    if (!(key in obj)) {
      diagnostics.push(errorDiag('missing-field', `Missing required array field '${key}'`));
      continue;
    }
    if (!Array.isArray(obj[key])) {
      diagnostics.push(errorDiag('invalid-type', `Field '${key}' must be an array`));
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const addNodes = obj.add_nodes as unknown[];
  const addEdges = obj.add_edges as unknown[];
  const deleteNodes = obj.delete_nodes as unknown[];
  const deleteEdges = obj.delete_edges as unknown[];

  const nodes: PGEditSet['add_nodes'] = [];
  const seenNodeIds = new Set<string>();
  for (let i = 0; i < addNodes.length; i++) {
    const item = addNodes[i];
    const parsed = PGNodeSchema.safeParse(item);
    if (!parsed.success) {
      diagnostics.push(...itemIssues('add_nodes', i, item, parsed.error.issues, 'node'));
      continue;
    }
    if (seenNodeIds.has(parsed.data.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-add-node',
        message: `Duplicate add_nodes id '${parsed.data.id}'`,
        nodeId: parsed.data.id,
        editIndex: i,
      });
      continue;
    }
    seenNodeIds.add(parsed.data.id);
    nodes.push(parsed.data);
  }

  const deleteNodeIds: string[] = [];
  for (let i = 0; i < deleteNodes.length; i++) {
    const parsed = z.string().min(1).max(PG_LIMITS.maxIdLength).safeParse(deleteNodes[i]);
    if (!parsed.success) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-type',
        message: `delete_nodes[${i}] must be a non-empty string`,
        editIndex: i,
      });
      continue;
    }
    deleteNodeIds.push(parsed.data);
  }

  const edges: PGEditSet['add_edges'] = [];
  const seenEdgeKeys = new Set<string>();
  for (let i = 0; i < addEdges.length; i++) {
    const item = addEdges[i];
    const outcome = diagnoseAddEdge(item, i);
    if (!outcome.ok) {
      diagnostics.push(...outcome.diagnostics);
      continue;
    }
    const parsed = outcome.value;
    const key = `${parsed.source}\0${parsed.relation}\0${parsed.target}`;
    if (seenEdgeKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-add-edge',
        message: `Duplicate add_edges triplet (${parsed.source}, ${parsed.relation}, ${parsed.target})`,
        edge: { source: parsed.source, target: parsed.target, relation: parsed.relation },
        editIndex: i,
      });
      continue;
    }
    seenEdgeKeys.add(key);
    edges.push(parsed);
  }

  const deletions: PGEditSet['delete_edges'] = [];
  for (let i = 0; i < deleteEdges.length; i++) {
    const item = deleteEdges[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-type',
        message: `delete_edges[${i}] must be an object with exactly source and target`,
        editIndex: i,
      });
      continue;
    }
    const keys = Object.keys(item as object);
    const unexpected = keys.filter((k) => k !== 'source' && k !== 'target');
    if (unexpected.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'unexpected-field',
        message: `delete_edges[${i}] must have exactly source and target`,
        editIndex: i,
      });
      continue;
    }
    const parsed = PGDeleteEdgeSchema.safeParse(item);
    if (!parsed.success) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-type',
        message: `delete_edges[${i}] must have string source and target`,
        editIndex: i,
      });
      continue;
    }
    deletions.push(parsed.data);
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    value: {
      add_nodes: nodes,
      delete_nodes: deleteNodeIds,
      add_edges: edges,
      delete_edges: deletions,
    },
  };
}

function isRawJsonObject(raw: string): boolean {
  if (raw.includes('```')) {
    return false;
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

const OPTIONAL_EDGE_ATTRIBUTES = ['condition', 'guidance', 'pitfalls'] as const;

function normalizeSnapshotInput(
  input: unknown,
): { normalized: unknown; diagnostics: PGDiagnostic[] } {
  const diagnostics: PGDiagnostic[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { normalized: input, diagnostics };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.edges)) {
    return { normalized: input, diagnostics };
  }
  const edges = obj.edges.map((edge, index) => {
    if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
      return edge;
    }
    const e = { ...(edge as Record<string, unknown>) };
    for (const field of OPTIONAL_EDGE_ATTRIBUTES) {
      if (e[field] !== undefined) {
        continue;
      }
      e[field] = null;
      diagnostics.push({
        severity: 'warning',
        code: 'missing-attribute',
        message: `edges[${index}] has no '${field}' attribute; normalized to null`,
        editIndex: index,
        edge: optionalEdgeRef(e),
      });
    }
    return e;
  });
  return { normalized: { ...obj, edges }, diagnostics };
}

/**
 * Validate one `add_edges` entry with a single Zod pass. The attribute
 * pre-checks produce the paper-specific codes (`missing-required-attribute`,
 * `invalid-condition`); the schema pass covers everything else.
 */
function diagnoseAddEdge(
  item: unknown,
  editIndex: number,
): { ok: true; value: PGEdge } | { ok: false; diagnostics: PGDiagnostic[] } {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return {
      ok: false,
      diagnostics: [{
        severity: 'error',
        code: 'invalid-type',
        message: `add_edges[${editIndex}] must be an object`,
        editIndex,
      }],
    };
  }
  const e = item as Record<string, unknown>;
  const out: PGDiagnostic[] = [];

  if (!isNonEmptyString(e.guidance) || !isNonEmptyString(e.pitfalls)) {
    out.push({
      severity: 'error',
      code: 'missing-required-attribute',
      message: `add_edges[${editIndex}] guidance and pitfalls must be non-empty strings`,
      editIndex,
      edge: optionalEdgeRef(e),
    });
  }

  if (e.condition !== null && typeof e.condition !== 'string') {
    out.push({
      severity: 'error',
      code: 'invalid-condition',
      message: `add_edges[${editIndex}] condition must be a string or null`,
      editIndex,
      edge: optionalEdgeRef(e),
    });
  }

  if (out.length > 0) {
    return { ok: false, diagnostics: out };
  }

  const parsed = PGAddEdgeSchema.safeParse(item);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: itemIssues('add_edges', editIndex, item, parsed.error.issues, 'edge'),
    };
  }
  return { ok: true, value: parsed.data };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalEdgeRef(e: Record<string, unknown>): PGDiagnostic['edge'] {
  if (typeof e.source === 'string' && typeof e.target === 'string') {
    return {
      source: e.source,
      target: e.target,
      relation: typeof e.relation === 'string' ? e.relation : undefined,
    };
  }
  return undefined;
}

function itemIssues(
  field: string,
  editIndex: number,
  item: unknown,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }>,
  kind: 'node' | 'edge',
): PGDiagnostic[] {
  const rec = item !== null && typeof item === 'object' && !Array.isArray(item)
    ? item as Record<string, unknown>
    : undefined;
  const typeIssue = issues.find((i) => i.path[0] === 'type');
  const code = typeIssue ? 'invalid-node-type' : 'invalid-type';
  const nodeId = kind === 'node' && typeof rec?.id === 'string' ? rec.id : undefined;
  return [{
    severity: 'error',
    code,
    message: `${field}[${editIndex}]: ${issues.map((i) => i.message).join('; ')}`,
    editIndex,
    nodeId,
    edge: kind === 'edge' && rec ? optionalEdgeRef(rec) : undefined,
  }];
}

function zodIssuesToDiagnostics(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }>,
): PGDiagnostic[] {
  return issues.map((issue) => ({
    severity: 'error' as const,
    code: issue.code === 'unrecognized_keys' ? 'unknown-key' : 'invalid-type',
    message: issue.message,
    editIndex: typeof issue.path[1] === 'number' ? issue.path[1] : undefined,
  }));
}

function errorDiag(code: string, message: string): PGDiagnostic {
  return { severity: 'error', code, message };
}
