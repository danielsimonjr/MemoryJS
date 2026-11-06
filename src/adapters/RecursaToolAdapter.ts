/**
 * RecursaToolAdapter: the reference implementation of the Recursa harness tool surface (spec
 * section 3.8). A downstream MCP server or Claude Code plugin wraps `call` one-to-one: each tool
 * takes JSON arguments and returns JSON. The adapter holds no state of its own; every durable
 * fact lives in the context, the interaction log or the publish directory.
 *
 * Tools (the table of section 3.8): `recursa.knowledge.load`, `recursa.skills.publish`,
 * `recursa.skills.import`, `recursa.learn.start|next|submit|plan|submitChild|merge|reflect|status`,
 * `recursa.log.append`, `recursa.log.select`, `recursa.eval.run`.
 *
 * Contract:
 * - `call` never throws. Every failure is `{ ok: false, error: { code, message } }`. Codes:
 *   `invalid_args` (zod, including unknown keys and reserved record keys, or library validation),
 *   `unknown_tool`, `aborted`, `not_found` (unknown trace), `invalid_state` (protocol misuse: a
 *   leaf/recursive mismatch, an out-of-phase or duplicate submit, a non-pending task id),
 *   `solver_required` (merge or a solver-backed call without `deps.solver`), `not_configured`
 *   (log tools without `deps.interactionLog`, skills tools without `deps.publishDir`),
 *   `internal_error` (a real bug). A library `KnowledgeGraphError` keeps its own code.
 * - The skills tools are confined to `deps.publishDir`: their optional `dir` must be a relative
 *   subpath strictly below it (`..`, absolute paths, symlink escapes, `/proc`, `/sys`, `/dev` are
 *   `invalid_args`, and nothing is created).
 * - `recursa.eval.run` refuses answers for unknown task ids (`invalid_args`); tasks without an
 *   answer fail with the note `no answer` and are listed in the result's `missing`.
 * - `recursa.learn.next` returns the `StepRequest` verbatim (RS-18): the harness runs the solves
 *   itself and feeds the answers back through `recursa.learn.submit`. It is never truncated,
 *   because truncation would break the protocol.
 * - Every other successful result is bounded to `maxBytes` (default 64 KiB). An oversize result
 *   is shrunk field by field and carries `truncated: true`.
 *
 * @module adapters/RecursaToolAdapter
 * @experimental Tool names and input shapes follow spec section 3.8 but may change with the
 *   harness feedback. The reference MCP server itself is downstream of this module.
 */

import { z } from 'zod';
import type { ManagerContext } from '../core/ManagerContext.js';
import type { LearningLoop, LearningLoopDeps } from '../core/context/LearningFacade.js';
import type { InteractionLog } from '../agent/harness/InteractionLog.js';
import { Evaluator, type Solver } from '../agent/evaluation/Evaluator.js';
import { DeterministicJudge, type RubricJudge } from '../agent/evaluation/DeterministicJudge.js';
import type { LearningSolver } from '../agent/learning/types.js';
import type { RecursiveStartOptions } from '../agent/learning/RecursiveLearner.js';
import type { PGCompletionProvider } from '../agent/procedural/graph/CompletionProvider.js';
import type { LoadForContextOptions } from '../agent/knowledge/KnowledgeRepository.js';
import type { SkillId } from '../types/skills.js';
import type { CriterionResult, SolveResult, TaskRecord } from '../types/learning.js';
import { SkillPublisher } from '../agent/skills/SkillPublisher.js';
import { dirname } from 'path';
import { boundResult } from './recursaToolBounds.js';
import {
  ToolFailure,
  definedOnly,
  fail,
  failureOf,
  issuesOf,
  jsonSchemaOf,
  publishTargetOf,
  reservedKeyPath,
  type RecursaToolResult,
} from './recursaToolSupport.js';
import {
  evalRunSchema,
  knowledgeLoadSchema,
  learnStartSchema,
  learnSubmitSchema,
  logAppendSchema,
  logSelectSchema,
  skillsImportSchema,
  skillsPublishSchema,
  submitChildSchema,
  traceIdSchema,
} from './recursaToolSchemas.js';

/** Default byte budget of a bounded tool result. */
const DEFAULT_MAX_BYTES = 64 * 1024;

/** Descriptor of one tool, in the shape an MCP `tools/list` entry needs. */
export interface RecursaToolDescriptor {
  /** Tool name, `recursa.<area>.<verb>`. */
  name: string;
  /** One-sentence description for the harness. */
  description: string;
  /** JSON-schema-like description of the arguments object. */
  inputSchema: Record<string, unknown>;
}

export type { RecursaToolResult };

/** The tool set a downstream server wraps. Stateless: `call` may run concurrently. */
export interface RecursaToolSet {
  /** Descriptors of every tool, in the section 3.8 order. */
  list(): RecursaToolDescriptor[];
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

/** Dependencies of {@link createRecursaTools}. Every field is optional. */
export interface RecursaToolDeps {
  /** Solver for the in-process `merge` validation. Without it, `merge` returns `solver_required`. */
  solver?: LearningSolver;
  /** Judge for `eval.run` and learning. Default: `DeterministicJudge`. */
  judge?: RubricJudge;
  /** Optional LLM for diagnosis and editing (deterministic fallbacks when absent). */
  llmProvider?: PGCompletionProvider;
  /** Interaction log for the `log.*` tools. Without it those tools return `not_configured`. */
  interactionLog?: InteractionLog;
  /**
   * Directory SKILL.md files are published to. Required by the skills tools (else `not_configured`);
   * their optional `dir` argument must be a relative subpath strictly below it (else `invalid_args`).
   */
  publishDir?: string;
  /** Byte budget of a bounded result. Default 65536. */
  maxBytes?: number;
}

/** Internal tool entry: the zod schema validates arguments before `run` sees them. */
interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodType;
  run(args: unknown, signal: AbortSignal | undefined): Promise<unknown>;
}

/** Typed definition of one tool, erased to {@link ToolEntry} by {@link defineTool}. */
interface ToolSpec<S extends z.ZodType> {
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
function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolEntry {
  return spec as unknown as ToolEntry;
}

/** Solver used when no `deps.solver` is given: any call to it is a configuration error. */
const UNCONFIGURED_SOLVER: LearningSolver = {
  async solve(): Promise<SolveResult> {
    throw new ToolFailure('solver_required', 'This call needs deps.solver; the harness solves steps through learn.next.');
  },
};

/**
 * Build the tool set over a context. Each call of a tool builds its own learning loop, so the
 * returned set holds no state and is safe to share.
 *
 * @param ctx - Context whose managers the tools call.
 * @param deps - Optional solver, judge, LLM, interaction log, publish directory and byte budget.
 * @returns The tool set.
 * @example
 * const tools = createRecursaTools(ctx, { publishDir: './skills' });
 * const out = await tools.call('recursa.knowledge.load', { role: 'solver', taskHint: 'ledger totals' });
 */
export function createRecursaTools(ctx: ManagerContext, deps: RecursaToolDeps = {}): RecursaToolSet {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const judge = deps.judge ?? new DeterministicJudge();

  const loopOf = (): LearningLoop => {
    const loopDeps: LearningLoopDeps = {
      solver: deps.solver ?? UNCONFIGURED_SOLVER,
      judge,
      ...(deps.llmProvider ? { llmProvider: deps.llmProvider } : {}),
      ...(deps.publishDir !== undefined ? { publishDir: deps.publishDir } : {}),
      ...(deps.interactionLog ? { interactionLog: deps.interactionLog } : {}),
    };
    return ctx.learningLoop(loopDeps);
  };
  const logOf = (): InteractionLog => {
    if (!deps.interactionLog) throw new ToolFailure('not_configured', 'No interactionLog is configured for this tool set.');
    return deps.interactionLog;
  };
  // The publisher is rooted at the parent of the target, which `publishTargetOf` confined to publishDir.
  const publisherFor = (target: string): SkillPublisher =>
    new SkillPublisher(ctx.storage, ctx.skillManager, { root: dirname(target) });
  const requireSolver = (): void => {
    if (!deps.solver) throw new ToolFailure('solver_required', 'merge validates in-process and needs deps.solver.');
  };

  const tools: ToolEntry[] = [
    defineTool({
      name: 'recursa.knowledge.load',
      description: 'Load knowledge (instructions, skills, failure lessons) as Markdown for a solver prompt.',
      schema: knowledgeLoadSchema,
      run: (a) => {
        const options: LoadForContextOptions = {
          role: a.role,
          taskHint: a.taskHint,
          ...definedOnly({
            budgetTokens: a.budgetTokens,
            sections: a.sections,
            includeSkillIds: a.includeSkillIds as SkillId[] | undefined,
            maxSkills: a.maxSkills,
          }),
        };
        return ctx.knowledgeRepository.loadForContext(options);
      },
    }),
    defineTool({
      name: 'recursa.skills.publish',
      description: 'Atomically publish the live skills as SKILL.md files under publishDir and return the change marker.',
      schema: skillsPublishSchema,
      run: async (a) => {
        const target = await publishTargetOf(deps.publishDir, a.dir);
        return publisherFor(target).publish(target, definedOnly({ snapshotId: a.snapshotId }));
      },
    }),
    defineTool({
      name: 'recursa.skills.import',
      description: 'Import edited SKILL.md files under publishDir back into the registry; returns the import report.',
      schema: skillsImportSchema,
      run: async (a) => {
        const target = await publishTargetOf(deps.publishDir, a.dir);
        return publisherFor(target).importSkills(target);
      },
    }),
    defineTool({
      name: 'recursa.learn.start',
      description: 'Create a resumable learning run (leaf or recursive) and return its initial state.',
      schema: learnStartSchema,
      run: async (a) => {
        const opts = {
          ...a,
          taskIds: a.taskIds ?? a.tasks.map((t) => t.id),
        } as unknown as RecursiveStartOptions;
        return loopOf().start(opts);
      },
    }),
    defineTool({
      name: 'recursa.learn.next',
      description: 'Advance a leaf run; returns a solve or judge StepRequest, or done with the result.',
      schema: traceIdSchema,
      run: (a, signal) => loopOf().next(a.traceId, signal ? { signal } : {}),
    }),
    defineTool({
      name: 'recursa.learn.submit',
      description: 'Submit solve answers or judge results for the pending step of a leaf run.',
      schema: learnSubmitSchema,
      run: (a) => {
        const loop = loopOf();
        if (a.kind === 'solve') {
          return loop.submit(a.traceId, 'solve', a.payload as Record<string, SolveResult | null>);
        }
        return loop.submit(a.traceId, 'judge', a.payload as Record<string, CriterionResult[] | null>);
      },
    }),
    defineTool({
      name: 'recursa.learn.plan',
      description: 'Split a recursive run into child runs; returns the subsets and child trace ids.',
      schema: traceIdSchema,
      run: (a) => loopOf().plan(a.traceId),
    }),
    defineTool({
      name: 'recursa.learn.submitChild',
      description: 'Record a child run as complete (it must be in phase done) or as failed.',
      schema: submitChildSchema,
      run: (a) => loopOf().submitChild(a.traceId, a.childTraceId, a.failure),
    }),
    defineTool({
      name: 'recursa.learn.merge',
      description: 'Merge the children revisions, validate on a sample and apply with OCC.',
      schema: traceIdSchema,
      run: (a, signal) => {
        requireSolver();
        return loopOf().merge(a.traceId, signal ? { signal } : {});
      },
    }),
    defineTool({
      name: 'recursa.learn.reflect',
      description: 'Write the round reflection and return whether the recursive run continues.',
      schema: traceIdSchema,
      run: (a) => loopOf().reflect(a.traceId),
    }),
    defineTool({
      name: 'recursa.learn.status',
      description: 'Return the persisted state of a run with its learning report.',
      schema: traceIdSchema,
      run: (a) => loopOf().status(a.traceId),
    }),
    defineTool({
      name: 'recursa.log.append',
      description: 'Append one harness interaction record; caller-reported tokens are echoed, not stored.',
      schema: logAppendSchema,
      run: async (a) => {
        const addr = await logOf().append({
          sessionId: a.sessionId,
          kind: a.kind,
          content: a.content,
          ...definedOnly({ tag: a.tag, ts: a.ts }),
        });
        return { addr, tokens: a.tokens ?? null };
      },
    }),
    defineTool({
      name: 'recursa.log.select',
      description: 'Return only the excerpt of one interaction record (line range, regex or fields).',
      schema: logSelectSchema,
      run: (a) => {
        const options = definedOnly({
          regex: a.regex,
          lines: a.lines as [number, number] | undefined,
          fields: a.fields,
        });
        return logOf().select(a.addr, options);
      },
    }),
    defineTool({
      name: 'recursa.eval.run',
      description: 'Judge harness-supplied answers against the task rubrics and return the metrics.',
      schema: evalRunSchema,
      run: async (a, signal) => {
        const taskIds = new Set(a.tasks.map((t) => t.id));
        const unknown = Object.keys(a.answers).filter((id) => !taskIds.has(id));
        if (unknown.length > 0) throw new ToolFailure('invalid_args', `answers name unknown task ids: ${unknown.slice(0, 20).join(', ')}`);
        const missing = a.tasks.filter((t) => !Object.hasOwn(a.answers, t.id)).map((t) => t.id);
        const missingSet = new Set(missing);
        const solver: Solver = async (task: TaskRecord) => a.answers[task.id] ?? '';
        const scoring: RubricJudge = {
          judge: async (task, answer, sig) =>
            missingSet.has(task.id)
              ? task.rubric.map((c) => ({ criterionId: c.id, pass: false, note: 'no answer' }))
              : judge.judge(task, answer, sig),
        };
        const evaluated = await new Evaluator().evaluate(
          a.tasks as TaskRecord[],
          solver,
          scoring,
          definedOnly({ knowledge: a.knowledge, concurrency: a.concurrency, signal }),
        );
        return { ...evaluated, missing };
      },
    }),
  ];

  const byName = new Map(tools.map((t) => [t.name, t] as const));
  const descriptors: RecursaToolDescriptor[] = tools.map((t) => ({
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
        const result = await tool.run(parsed.data, signal);
        if (tool.name === 'recursa.learn.next') return { ok: true, result };
        return { ok: true, result: boundResult(result, maxBytes) };
      } catch (err) {
        return failureOf(err, signal);
      }
    },
  };
}
