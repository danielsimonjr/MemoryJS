/**
 * AmrToolAdapter: the `amr.*` tool surface over one fixed Agent Memory Repo (AMR) root. A harness
 * wraps `call` one-to-one: each tool takes JSON arguments and returns JSON.
 *
 * Tools: `amr.context`, `amr.check`, `amr.export`, `amr.import`, `amr.commit`. A result is the module
 * report unchanged when it fits `deps.maxBytes` (default 64 KiB). A larger report is shrunk field by
 * field and carries `truncated: true`, the same bound as `RecursaToolAdapter`.
 *
 * Contract:
 * - The root comes only from `deps.root`. No argument carries a root or a path: every object schema is
 *   strict, so such a key is `invalid_args`.
 * - Writes need `deps.allowWrite === true`. `apply: true` on `amr.export` and `amr.import`, and every
 *   `amr.commit`, fail with `write_disabled` otherwise, before any file or git call.
 * - Reader budgets above the `AMR_READER_DEFAULTS` values are `invalid_args`, not capped.
 * - `amr.export` passes the whole graph to the export. `types` is the only filter.
 * - `call` never throws. Every failure is `{ ok: false, error: { code, message } }`.
 * - An abort signal is read only before the tool starts. A running tool does not stop on abort.
 *
 * @module adapters/AmrToolAdapter
 * @experimental
 */

import path from 'node:path';
import { z } from '../utils/schema.js';
import { ValidationError } from '../utils/errors.js';
import type { ManagerContext } from '../core/ManagerContext.js';
import { AMR_READER_DEFAULTS, checkAmr, loadAmrContext, type AmrReaderOptions } from '../features/amr/AmrReader.js';
import { exportAmr, importAmr, type AmrSyncMode, type AmrSyncOptions } from '../features/amr/AmrSync.js';
import { GitRunner } from '../features/amr/GitRunner.js';
import { commitAmrEdits, AMR_COMMIT_MESSAGE_MAX_CHARS } from '../features/amr/AmrWriter.js';
import { boundResult, DEFAULT_MAX_BYTES } from './recursaToolBounds.js';
import {
  ToolFailure,
  defineTool,
  definedOnly,
  makeToolSet,
  type RecursaToolResult,
  type ToolDescriptor,
  type ToolEntry,
  type ToolSet,
} from './recursaToolSupport.js';

/** Result of one AMR tool call. Same shape as the Recursa tool results. */
export type AmrToolResult = RecursaToolResult;

/** Dependencies of {@link createAmrTools}. */
export interface AmrToolDeps {
  /** The one memory root (the repository top). Required. Relative paths resolve against the cwd. */
  root: string;
  /** Allows writes: `apply: true` on export and import, and every commit. Default false. */
  allowWrite?: boolean;
  /** Namespace of the exported and imported files. Not an argument of any tool. */
  namespace?: string;
  /** Byte budget of a bounded result. Default 65536. */
  maxBytes?: number;
}

/** Descriptor of one tool, in the shape an MCP `tools/list` entry needs. */
export type AmrToolDescriptor = ToolDescriptor;

/** The tool set a downstream server wraps. Stateless: `call` may run concurrently. */
export type AmrToolSet = ToolSet;

/** Reader budget of `amr.context`: a positive integer, at most the reader default. */
const budget = (max: number) => z.number().int().positive().max(max).optional();
const modeSchema = z.enum(['add-only', 'reconcile']).optional();
const typesSchema = z.array(z.string().min(1).max(200)).max(100).optional();

const contextSchema = z
  .object({
    maxFiles: budget(AMR_READER_DEFAULTS.maxFiles),
    maxTotalBytes: budget(AMR_READER_DEFAULTS.maxTotalBytes),
    maxDepth: budget(AMR_READER_DEFAULTS.maxDepth),
  })
  .strict();
const emptySchema = z.object({}).strict();
const exportSchema = z.object({ apply: z.boolean().optional(), types: typesSchema, mode: modeSchema }).strict();
const importSchema = z.object({ apply: z.boolean().optional(), mode: modeSchema }).strict();
const commitSchema = z.object({ message: z.string().min(1).max(AMR_COMMIT_MESSAGE_MAX_CHARS) }).strict();

/**
 * Build the AMR tool set over a context and one fixed root.
 *
 * @param ctx - Context whose storage the export and import read.
 * @param deps - The root, the write switch and the namespace.
 * @returns The tool set.
 * @throws ValidationError when `deps.root` is empty or not a string.
 * @example
 * const tools = createAmrTools(ctx, { root: '/notes/memory', allowWrite: false });
 * const out = await tools.call('amr.check', {});
 */
export function createAmrTools(ctx: ManagerContext, deps: AmrToolDeps): AmrToolSet {
  if (typeof deps.root !== 'string' || deps.root === '') {
    throw new ValidationError('deps.root must be a non-empty path', ['root']);
  }
  const root = path.resolve(deps.root);
  const requireWrite = (): void => {
    if (deps.allowWrite !== true) throw new ToolFailure('write_disabled', 'Writes need deps.allowWrite.');
  };
  const namespaceOpt = deps.namespace !== undefined ? { namespace: deps.namespace } : {};

  const tools: ToolEntry[] = [
    defineTool({
      name: 'amr.context',
      description: 'Read the bounded AMR context block of the memory root. Read-only.',
      schema: contextSchema,
      run: (a) => loadAmrContext(root, definedOnly(a) as Partial<AmrReaderOptions>),
    }),
    defineTool({
      name: 'amr.check',
      description: 'Check the memory root: links, metadata, case duplicates and secrets. Read-only.',
      schema: emptySchema,
      run: () => checkAmr(root),
    }),
    defineTool({
      name: 'amr.export',
      description: 'Export graph entities to the memory root. A dry run unless apply is true (needs allowWrite).',
      schema: exportSchema,
      run: async (a) => {
        const apply = a.apply === true;
        if (apply) requireWrite();
        const graph = await ctx.storage.loadGraph();
        const opts: AmrSyncOptions = {
          dryRun: !apply,
          ...(a.types !== undefined ? { types: a.types } : {}),
          ...(a.mode !== undefined ? { mode: a.mode as AmrSyncMode } : {}),
          ...namespaceOpt,
          ...(apply ? { runner: new GitRunner(root) } : {}),
        };
        return exportAmr([...graph.entities], [...graph.relations], root, opts);
      },
    }),
    defineTool({
      name: 'amr.import',
      description: 'Import memory files into the graph. A dry run unless apply is true (needs allowWrite).',
      schema: importSchema,
      run: async (a) => {
        const apply = a.apply === true;
        if (apply) requireWrite();
        return importAmr(ctx, root, {
          dryRun: !apply,
          ...(a.mode !== undefined ? { mode: a.mode as AmrSyncMode } : {}),
          ...namespaceOpt,
        });
      },
    }),
    defineTool({
      name: 'amr.commit',
      description: 'Commit the hand edits of the memory root in one commit (needs allowWrite).',
      schema: commitSchema,
      run: (a) => {
        requireWrite();
        return commitAmrEdits(root, { runner: new GitRunner(root), message: a.message });
      },
    }),
  ];

  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  return makeToolSet(tools, (_tool, result) => boundResult(result, maxBytes));
}
