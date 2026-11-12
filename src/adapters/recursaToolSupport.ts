/**
 * Shared plumbing of the tool adapters: the tool entry types, the shared tool-set shell, the stable
 * failure codes, the mapping of thrown values to them, zod issue formatting, JSON-schema
 * descriptors and publish-dir confinement.
 *
 * @module adapters/recursaToolSupport
 * @internal Used by `RecursaToolAdapter` and `AmrToolAdapter` only.
 */

import { z } from '../utils/schema.js';
import { isAbsolute, resolve } from 'path';
import { ValidationError, KnowledgeGraphError } from '../utils/errors.js';
import { resolveConfinedTreeDir } from '../agent/skills/skillTreeFs.js';

/** Longest error message returned to the caller, in characters. */
const MAX_MESSAGE_CHARS = 500;

/**
 * Outcome of one tool call. A success carries the JSON result; a failure carries a stable code
 * and a bounded message. `call` never rejects.
 */
export type RecursaToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

/** Descriptor of one tool, in the shape an MCP `tools/list` entry needs. */
export interface ToolDescriptor {
  /** Tool name, `<surface>.<verb>`. */
  name: string;
  /** One-sentence description for the harness. */
  description: string;
  /** JSON-schema-like description of the arguments object. */
  inputSchema: Record<string, unknown>;
}

/** The tool set a downstream server wraps. Stateless: `call` may run concurrently. */
export interface ToolSet {
  /** Descriptors of every tool, in the order of the surface. */
  list(): ToolDescriptor[];
  /**
   * Run one tool on JSON arguments. Never throws.
   *
   * @param name - Tool name from `list()`.
   * @param args - Arguments as received from the harness (validated here).
   * @param signal - Optional abort signal; an aborted call returns `aborted`.
   * @returns The result or the failure.
   */
  call(name: string, args: unknown, signal?: AbortSignal): Promise<RecursaToolResult>;
}

/** Internal tool entry: the zod schema validates the arguments before `run` sees them. */
export interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodType;
  run(args: unknown, signal: AbortSignal | undefined): Promise<unknown>;
}

/** Typed definition of one tool, erased to {@link ToolEntry} by {@link defineTool}. */
export interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(args: z.output<S>, signal: AbortSignal | undefined): Promise<unknown>;
}

/**
 * Erase a typed tool definition to a {@link ToolEntry}. The schema is the only source of the
 * argument type, so the cast is sound.
 *
 * @param spec - Typed tool definition.
 * @returns The erased entry.
 */
export function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolEntry {
  return spec as unknown as ToolEntry;
}

/**
 * Build the tool-set shell over a list of tools. `call` looks up the tool, refuses an aborted
 * signal, a reserved key and invalid arguments, runs the tool and passes its result to `finish`.
 * Every thrown value becomes a failure result.
 *
 * @param tools - Tools of the surface, in order.
 * @param finish - Maps the result of a tool before it is returned (for example, a byte bound).
 * @returns The tool set.
 */
export function makeToolSet(tools: readonly ToolEntry[], finish: (tool: ToolEntry, result: unknown) => unknown): ToolSet {
  const byName = new Map(tools.map((t) => [t.name, t] as const));
  const descriptors: ToolDescriptor[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: jsonSchemaOf(t.schema),
  }));
  return {
    list: () => descriptors.map((d) => ({ ...d, inputSchema: { ...d.inputSchema } })),
    async call(name: string, args: unknown, signal?: AbortSignal): Promise<RecursaToolResult> {
      try {
        const tool = byName.get(name);
        if (!tool) return fail('unknown_tool', `Unknown tool: ${String(name).slice(0, 200)}`);
        if (signal?.aborted) return fail('aborted', 'The call was aborted before it started.');
        const reserved = reservedKeyPath(args);
        if (reserved !== undefined) return fail('invalid_args', `${reserved.slice(0, 200)}: reserved key`);
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) return fail('invalid_args', issuesOf(parsed.error));
        return { ok: true, result: finish(tool, await tool.run(parsed.data, signal)) };
      } catch (err) {
        return failureOf(err, signal);
      }
    },
  };
}

/** Failure with a stable code, raised inside a tool and mapped to `ok: false` by `call`. */
export class ToolFailure extends Error {
  /**
   * Create a failure with a stable code.
   *
   * @param code - Stable error code.
   * @param message - Human-readable message.
   */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolFailure';
  }
}

/** Learning-library messages that mean the trace (or child trace) does not exist. */
const NOT_FOUND = /unknown (child )?trace|has no (leaf-learner|recursive) state/;
/** Learning-library messages that mean the call is valid JSON but out of protocol. */
const INVALID_STATE =
  /is a recursive run|is not a recursive run|not expected in phase|is not pending|run \S+ is done|no pending tasks|not complete|did not complete|is not a child of|, not done|stale state/;

/**
 * Message of an error, bounded in length.
 *
 * @param err - Any thrown value.
 * @returns A short message.
 */
export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}...` : text;
}

/**
 * Build a failure result.
 *
 * @param code - Error code.
 * @param message - Error message.
 * @returns The failure result.
 */
export function fail(code: string, message: string): RecursaToolResult {
  return { ok: false, error: { code, message } };
}

/**
 * Map a thrown value to a failure result: `invalid_args` for validation, `not_found` for an
 * unknown trace, `invalid_state` for protocol misuse, `aborted`, else `internal_error`.
 *
 * @param err - Thrown value.
 * @param signal - The call's signal, when one was given.
 * @returns The failure result.
 */
export function failureOf(err: unknown, signal: AbortSignal | undefined): RecursaToolResult {
  if (err instanceof ToolFailure) return fail(err.code, messageOf(err));
  if (err instanceof ValidationError) return fail('invalid_args', messageOf(err));
  if (err instanceof KnowledgeGraphError) return fail(err.code, messageOf(err));
  if ((err instanceof Error && err.name === 'AbortError') || signal?.aborted === true) {
    return fail('aborted', 'The call was aborted.');
  }
  if (err instanceof RangeError || err instanceof TypeError) return fail('invalid_args', messageOf(err));
  const message = messageOf(err);
  if (NOT_FOUND.test(message)) return fail('not_found', message);
  if (INVALID_STATE.test(message)) return fail('invalid_state', message);
  return fail('internal_error', message);
}

/**
 * Format zod issues into one bounded message.
 *
 * @param error - Zod error.
 * @returns Message naming each failing path.
 */
export function issuesOf(error: z.ZodError): string {
  return messageOf(new Error(error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')));
}

/**
 * Convert a zod schema to the `inputSchema` descriptor. Refinements that JSON Schema cannot
 * express are left out; the runtime check still applies them.
 *
 * @param schema - Argument schema.
 * @returns JSON-schema-like object.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** Keys that could reach `Object.prototype` when a parsed record is copied. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Path of the first reserved own key (`__proto__`, `constructor`, `prototype`) anywhere in a JSON
 * value. Zod records silently skip `__proto__`, so arguments are scanned before parsing.
 *
 * @param value - Arguments as received.
 * @param path - Path so far (internal).
 * @param depth - Nesting depth so far (internal; scanning stops at 64).
 * @returns The dotted path of the key, or `undefined` when there is none.
 */
export function reservedKeyPath(value: unknown, path = '', depth = 0): string | undefined {
  if (value === null || typeof value !== 'object' || depth > 64) return undefined;
  for (const key of Object.keys(value)) {
    const here = path ? `${path}.${key}` : key;
    if (RESERVED_KEYS.has(key)) return here;
    const found = reservedKeyPath((value as Record<string, unknown>)[key], here, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Drop keys whose value is `undefined`, so optional fields can be passed with `exactOptionalPropertyTypes`.
 *
 * @param obj - Object with possibly undefined values.
 * @returns A copy without the undefined keys.
 */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Publish target of a skills tool: `publishDir` itself, or a relative subpath strictly below it.
 * The subpath goes through the same confinement as `SkillPublisher` (`..`, absolute paths,
 * symlink escapes and special filesystems are refused).
 *
 * @param publishDir - Configured publish directory (`deps.publishDir`).
 * @param dir - Optional `dir` argument.
 * @returns The absolute target directory.
 * @throws ToolFailure `not_configured` without `publishDir`; `invalid_args` for a refused `dir`.
 */
export async function publishTargetOf(publishDir: string | undefined, dir: string | undefined): Promise<string> {
  if (publishDir === undefined) throw new ToolFailure('not_configured', 'The skills tools need deps.publishDir.');
  const base = resolve(publishDir);
  if (dir === undefined) return base;
  if (isAbsolute(dir)) throw new ToolFailure('invalid_args', 'dir must be a relative subpath of publishDir, not an absolute path.');
  try {
    return await resolveConfinedTreeDir(dir, base);
  } catch (err) {
    throw new ToolFailure('invalid_args', `dir must be a relative subpath of publishDir: ${messageOf(err)}`);
  }
}
