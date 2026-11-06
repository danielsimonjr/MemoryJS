/**
 * Argument schemas of the Recursa tool adapter (spec section 3.8). Each schema validates the
 * JSON a harness sends before the tool runs.
 *
 * Every object schema is `.strict()` (unknown keys are `invalid_args`), and free-form record keys
 * and task ids refuse `__proto__`, `constructor` and `prototype`. Only the per-tool argument
 * schemas are exported; the building blocks stay private.
 *
 * @module adapters/recursaToolSchemas
 * @internal Used by `RecursaToolAdapter` only.
 */

import { z } from 'zod';
import { INTERACTION_KINDS } from '../agent/harness/InteractionLogFormat.js';

/** Longest free text accepted for answers, content and notes (characters). */
const MAX_TEXT_CHARS = 200_000;
/** Keys that could reach `Object.prototype` when a record is copied. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const idSchema = z.string().min(1).max(200);
/** Id usable as a record key: never a prototype-polluting name. */
const safeIdSchema = idSchema.refine((k) => !FORBIDDEN_KEYS.has(k), 'reserved key (__proto__, constructor, prototype)');
const textSchema = z.string().max(MAX_TEXT_CHARS);
const countSchema = z.number().int().min(0).max(1_000_000);
const tokensSchema = z.object({ input: countSchema, output: countSchema }).strict();
const criterionSchema = z
  .object({
    id: idSchema,
    text: z.string().max(4000),
    kind: z.enum(['fact', 'document', 'set-exact', 'set-precision', 'number', 'free']),
    expected: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
    tolerance: z.number().finite().min(0).optional(),
    weight: z.number().finite().min(0).optional(),
  })
  .strict();
const taskSchema = z
  .object({
    id: safeIdSchema,
    input: z.string().min(1).max(MAX_TEXT_CHARS),
    category: z.string().max(200).optional(),
    tags: z.array(z.string().max(200)).max(100).optional(),
    tools: z.array(z.string().max(200)).max(100).optional(),
    difficulty: z.string().max(100).optional(),
    sources: z.array(z.record(z.string().max(200).refine((k) => !FORBIDDEN_KEYS.has(k), 'reserved key'), z.unknown())).max(100).optional(),
    rubric: z.array(criterionSchema).max(200),
  })
  .strict();
const tasksSchema = z
  .array(taskSchema)
  .min(1)
  .max(1000)
  .refine((tasks) => new Set(tasks.map((t) => t.id)).size === tasks.length, 'task ids must be unique');
const budgetSchema = z
  .object({
    maxRounds: z.number().int().min(1).max(1000),
    maxTokens: countSchema.optional(),
    maxWallClockMs: countSchema.optional(),
    maxChildren: countSchema.optional(),
  })
  .strict();
const solveResultSchema = z
  .object({ answer: textSchema, traceAddrs: z.array(z.string().max(64)).max(1000), tokens: tokensSchema.optional() })
  .strict();
const judgeResultSchema = z
  .object({ criterionId: idSchema, pass: z.boolean(), note: z.string().max(4000).optional() })
  .strict();
const dirSchema = z.string().min(1).max(4096);

/** Arguments of `recursa.knowledge.load`. */
export const knowledgeLoadSchema = z
  .object({
    role: z.enum(['solver', 'learner', 'shared']),
    taskHint: z.string().max(MAX_TEXT_CHARS),
    budgetTokens: z.number().int().min(1).max(1_000_000).optional(),
    sections: z.array(z.enum(['instructions', 'skills', 'failures'])).max(3).optional(),
    includeSkillIds: z.array(z.string().max(200)).max(200).optional(),
    maxSkills: z.number().int().min(1).max(200).optional(),
  })
  .strict();
/** Arguments of `recursa.skills.publish`: `dir` is an optional relative subpath of `deps.publishDir`. */
export const skillsPublishSchema = z.object({ dir: dirSchema.optional(), snapshotId: idSchema.optional() }).strict();
/** Arguments of `recursa.skills.import`: `dir` as for publish. */
export const skillsImportSchema = z.object({ dir: dirSchema.optional() }).strict();
/** Arguments of `recursa.learn.start`. */
export const learnStartSchema = z
  .object({
    tasks: tasksSchema,
    taskIds: z.array(idSchema).min(1).max(1000).optional(),
    budget: budgetSchema,
    split: z.enum(['byCategory', 'byFailureMode', 'bySkill', 'byTool', 'auto']).optional(),
    validationSampleSize: countSchema.optional(),
    validationRepeats: z.number().int().min(1).max(10).optional(),
    concurrency: z.number().int().min(1).max(64).optional(),
    leafThreshold: countSchema.optional(),
    maxDepth: z.number().int().min(0).max(10).optional(),
    sessionId: idSchema.optional(),
    subsetLabel: z.string().min(1).max(200).optional(),
  })
  .strict();
/** Arguments of the tools that take only a trace id (`next`, `plan`, `merge`, `reflect`, `status`). */
export const traceIdSchema = z.object({ traceId: idSchema }).strict();
/** Arguments of `recursa.learn.submit`: solve answers or judge results keyed by task id. */
export const learnSubmitSchema = z.discriminatedUnion('kind', [
  z.object({ traceId: idSchema, kind: z.literal('solve'), payload: z.record(safeIdSchema, solveResultSchema.nullable()) }).strict(),
  z
    .object({ traceId: idSchema, kind: z.literal('judge'), payload: z.record(safeIdSchema, z.array(judgeResultSchema).nullable()) })
    .strict(),
]);
/** Arguments of `recursa.learn.submitChild`. */
export const submitChildSchema = z
  .object({ traceId: idSchema, childTraceId: idSchema, failure: z.string().max(4000).optional() })
  .strict();
/** Arguments of `recursa.log.append`. */
export const logAppendSchema = z
  .object({
    sessionId: idSchema,
    kind: z.enum(INTERACTION_KINDS),
    tag: z.string().max(200).optional(),
    content: z.string().max(4 * 1024 * 1024),
    ts: z.iso.datetime().optional(),
    tokens: tokensSchema.optional(),
  })
  .strict();
/** Arguments of `recursa.log.select`. */
export const logSelectSchema = z
  .object({
    addr: z.string().regex(/^e[1-9]\d*$/, 'addr must look like e<n>'),
    regex: z.string().min(1).max(256).optional(),
    lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
    fields: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict();
/** Arguments of `recursa.eval.run`: answers keyed by task id (unknown ids are refused by the tool). */
export const evalRunSchema = z
  .object({
    tasks: tasksSchema,
    answers: z.record(safeIdSchema, textSchema),
    knowledge: textSchema.optional(),
    concurrency: z.number().int().min(1).max(64).optional(),
  })
  .strict();
