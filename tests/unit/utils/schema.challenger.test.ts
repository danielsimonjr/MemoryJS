/**
 * Challenger differential tests for `src/utils/schema.ts` against zod 4.6.7.
 *
 * Every expectation below was captured by running the REAL `zod@4.6.7`
 * package (installed outside the repository) on the same schema and input.
 * The Sprint 7 build challenger filed these as latent divergences on
 * 2026-11-10; build review (same day) fixed each one in `src/utils/schema.ts`
 * so behaviour matches zod for the implemented subset.
 *
 * None of the scenarios is reachable from the schemas `src/` builds today
 * (a 48,000-case differential fuzz over every exported production schema,
 * with JSON-shaped inputs, found no active divergence). The expectations stay
 * zod-recorded literals so the test runs without `zod` installed.
 *
 * @module tests/unit/utils/schema.challenger
 */

import { describe, expect, it } from 'vitest';
import { z } from '../../../src/utils/schema.js';

/** Flatten a failed parse into comparable `{ code, path, message }` triples. */
function issues(result: unknown): Array<{ code: string; path: unknown[]; message: string }> {
  const failure = result as { success: boolean; error?: { issues: Array<{ code: string; path: unknown[]; message: string }> } };
  expect(failure.success).toBe(false);
  return (failure.error!.issues ?? []).map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
  }));
}

describe('schema challenger — divergences from zod 4.6.7', () => {
  it('refine() honours a `path` param on a root schema (zod appends it to the issue path)', () => {
    // zod 4.6.7: safeParse('y').error.issues[0].path === ['deep']
    const schema = z.string().refine((v) => v === 'x', { message: 'bad', path: ['deep'] });
    expect(issues(schema.safeParse('y'))).toEqual([
      { code: 'custom', path: ['deep'], message: 'bad' },
    ]);
  });

  it('refine() honours a `path` param on an object field (zod appends after the field path)', () => {
    // zod 4.6.7: path === ['a', 'nested', 'deep']
    const schema = z.object({
      a: z.string().refine((v) => v !== 'bad', { message: 'no bad', path: ['nested', 'deep'] }),
    });
    expect(issues(schema.safeParse({ a: 'bad' }))).toEqual([
      { code: 'custom', path: ['a', 'nested', 'deep'], message: 'no bad' },
    ]);
  });

  it('toJSONSchema honours io:"output" — a defaulted field is required in the output shape', () => {
    // zod 4.6.7 with io:'output': required: ['b', 'c'] — the default makes `b`
    // always present in the output, and the nullable `c` stays required.
    const schema = z.object({
      a: z.string().optional(),
      b: z.string().default('d'),
      c: z.string().nullable(),
    });
    expect(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { default: 'd', type: 'string' },
        c: { type: ['string', 'null'] },
      },
      required: ['b', 'c'],
      additionalProperties: false,
    });
  });

  it('record() with a literal key schema requires that key and reports extras as unrecognized (zod semantics)', () => {
    // zod 4.6.7 treats record() with literal/enum key schemas as an object with
    // exactly those keys required: a missing key is an `invalid_type` at the
    // key's path and an extra key is `unrecognized_keys`.
    const schema = z.record(z.literal('a'), z.number());
    expect(issues(schema.safeParse({ b: 1 }))).toEqual([
      { code: 'invalid_type', path: ['a'], message: 'Invalid input: expected number, received undefined' },
      { code: 'unrecognized_keys', path: [], message: 'Unrecognized key: "b"' },
    ]);
    expect(issues(schema.safeParse({ a: 1, b: 2 }))).toEqual([
      { code: 'unrecognized_keys', path: [], message: 'Unrecognized key: "b"' },
    ]);
  });

  it('record() with a numeric key schema passes numeric-string keys through (zod semantics)', () => {
    // zod 4.6.7 accepts { '1': 1 } for z.record(z.number(), z.number()) — the
    // object key '1' is already a string, so the key parse succeeds and the
    // entry survives as '1'. Our record rejects it with invalid_key.
    const schema = z.record(z.number(), z.number());
    const result = schema.safeParse({ '1': 1 });
    expect(result.success).toBe(true);
    expect((result as { data: unknown }).data).toEqual({ '1': 1 });
  });

  it('discriminatedUnion() throws on a duplicate discriminator value (zod semantics)', () => {
    // zod 4.6.7 throws `Duplicate discriminator value "a"` out of safeParse.
    const schema = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a'), x: z.string() }),
      z.object({ t: z.literal('a'), y: z.number() }),
    ]);
    expect(() => schema.parse({ t: 'a', x: 's' })).toThrow('Duplicate discriminator value "a"');
  });

  it('discriminatedUnion() throws at construction when an option lacks the discriminator (zod semantics)', () => {
    // zod 4.6.7 throws `Invalid discriminated union option at index "0"` while
    // the union is being built. Our module accepts the construction and only
    // fails at parse time, with a different message.
    expect(() =>
      z.discriminatedUnion('t', [z.object({ x: z.string() })]),
    ).toThrow('Invalid discriminated union option at index "0"');
  });

  it('invalid_type messages match zod for an object whose prototype chain carries a non-function constructor', () => {
    // zod 4.6.7's parsedType rule is `"constructor" in obj && obj.constructor`
    // → return obj.constructor.name (possibly undefined). For an input whose
    // prototype chain contains { constructor: {} } it therefore prints
    // "received undefined". Our helper requires `obj.constructor?.name` to be
    // truthy and falls back to "received object".
    const input = Object.create({ constructor: {} });
    expect(issues(z.string().safeParse(input))).toEqual([
      { code: 'invalid_type', path: [], message: 'Invalid input: expected string, received undefined' },
    ]);
  });
});
