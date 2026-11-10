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

  it('record() numeric-string retry matches zod\'s /^-?\\d+(?:\\.\\d+)?$/ (not Number() on every string)', () => {
    const schema = z.record(z.number(), z.number());
    const accepted = ['1', '-1', '1.5', '-0', '01', '1.0', '-01', '9007199254740993'];
    const rejected = ['1e3', ' 1', '+1', '1.', '.5', 'Infinity', 'NaN', '0x10', '1E3', '1e+3', '+0', '2.'];
    for (const key of accepted) {
      const result = schema.safeParse({ [key]: 1 });
      expect(result.success, key).toBe(true);
    }
    for (const key of rejected) {
      expect(schema.safeParse({ [key]: 1 }).success, key).toBe(false);
    }
    const ints = z.record(z.number().int(), z.number());
    expect(ints.safeParse({ '1': 1 }).success).toBe(true);
    expect(ints.safeParse({ '1.5': 1 }).success).toBe(false);
    const positives = z.record(z.number().positive(), z.number());
    expect(positives.safeParse({ '1': 1 }).success).toBe(true);
    expect(positives.safeParse({ '0': 1 }).success).toBe(false);
    expect(positives.safeParse({ '-1': 1 }).success).toBe(false);
  });

  it('record() with a union of mixed string/number literals requires every key (zod semantics)', () => {
    const schema = z.record(z.union([z.literal(1), z.literal('a')]), z.number());
    expect(schema.safeParse({ 1: 1, a: 2 }).success).toBe(true);
    expect(issues(schema.safeParse({ a: 2 }))).toEqual([
      { code: 'invalid_type', path: [1], message: 'Invalid input: expected number, received undefined' },
    ]);
    expect(issues(schema.safeParse({ 1: 1, a: 2, b: 3 }))).toEqual([
      { code: 'unrecognized_keys', path: [], message: 'Unrecognized key: "b"' },
    ]);
  });

  it('toJSONSchema record keys stringify numbers and list enumerable keys as required', () => {
    expect(z.toJSONSchema(z.record(z.number(), z.boolean()), { io: 'input', unrepresentable: 'any' }).propertyNames).toEqual({
      type: 'string',
      pattern: '^-?\\d+(?:\\.\\d+)?$',
    });
    expect(z.toJSONSchema(z.record(z.number().int(), z.boolean()), { io: 'input', unrepresentable: 'any' }).propertyNames).toEqual({
      type: 'string',
      pattern: '^-?\\d+$',
    });
    expect(z.toJSONSchema(z.record(z.literal(1), z.number()), { io: 'input', unrepresentable: 'any' })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      propertyNames: { type: 'string', const: '1' },
      additionalProperties: { type: 'number' },
      required: ['1'],
    });
    expect(
      z.toJSONSchema(z.record(z.union([z.literal(1), z.literal('a')]), z.number()), { io: 'input', unrepresentable: 'any' }),
    ).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      propertyNames: { anyOf: [{ type: 'string', const: '1' }, { type: 'string', const: 'a' }] },
      additionalProperties: { type: 'number' },
      required: ['1', 'a'],
    });
    const optionalValues = z.record(z.enum(['a', 'b']), z.string().optional());
    expect(z.toJSONSchema(optionalValues, { io: 'input', unrepresentable: 'any' }).required).toBeUndefined();
    expect(z.toJSONSchema(optionalValues, { io: 'output', unrepresentable: 'any' }).required).toEqual(['a', 'b']);
  });

  it('refine() path concatenates through nested objects and arrays', () => {
    const schema = z.object({
      items: z.array(
        z.object({
          n: z.string().refine((v) => v !== 'bad', { message: 'no', path: ['nested'] }),
        }),
      ),
    });
    expect(issues(schema.safeParse({ items: [{ n: 'bad' }] }))).toEqual([
      { code: 'custom', path: ['items', 0, 'n', 'nested'], message: 'no' },
    ]);
  });

  it('toJSONSchema io:"output" nested defaults stay required and passthrough keeps additionalProperties', () => {
    const schema = z.object({
      inner: z.object({
        d: z.string().default('x'),
        o: z.string().optional(),
      }).passthrough(),
      outer: z.string().default('y'),
    });
    expect(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          properties: {
            d: { default: 'x', type: 'string' },
            o: { type: 'string' },
          },
          required: ['d'],
          additionalProperties: {},
        },
        outer: { default: 'y', type: 'string' },
      },
      required: ['inner', 'outer'],
      additionalProperties: false,
    });
  });

  it('discriminatedUnion duplicate error throws from safeParse, not construction', () => {
    let schema: ReturnType<typeof z.discriminatedUnion>;
    expect(() => {
      schema = z.discriminatedUnion('t', [
        z.object({ t: z.literal('a'), x: z.string() }),
        z.object({ t: z.literal('a'), y: z.number() }),
      ]);
    }).not.toThrow();
    expect(() => schema.safeParse({ t: 'a', x: 's' })).toThrow('Duplicate discriminator value "a"');
    expect(() => schema.parse({ t: 'a', x: 's' })).toThrow('Duplicate discriminator value "a"');
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

  it('record() with a boolean or null key schema treats every string key as unrecognized', () => {
    // zod 4.6.7: z.literal(true) and z.null() enumerate, but only string/number
    // values become required keys, so { true: 1 } is unrecognized_keys.
    expect(issues(z.record(z.literal(true), z.number()).safeParse({ true: 1 }))).toEqual([
      { code: 'unrecognized_keys', path: [], message: 'Unrecognized key: "true"' },
    ]);
    expect(issues(z.record(z.union([z.literal('a'), z.null()]), z.number()).safeParse({}))).toEqual([
      { code: 'invalid_type', path: ['a'], message: 'Invalid input: expected number, received undefined' },
    ]);
    expect(issues(z.record(z.union([z.literal('a'), z.null()]), z.number()).safeParse({ null: 1 }))).toEqual([
      { code: 'invalid_type', path: ['a'], message: 'Invalid input: expected number, received undefined' },
      { code: 'unrecognized_keys', path: [], message: 'Unrecognized key: "null"' },
    ]);
    expect(z.toJSONSchema(z.record(z.union([z.literal('a'), z.null()]), z.number()), { io: 'input' })).toMatchObject({
      required: ['a'],
      propertyNames: { anyOf: [{ type: 'string', const: 'a' }, { type: 'null' }] },
    });
  });

  it('toJSONSchema invokes a function default before serializing it', () => {
    // zod 4.6.7 calls the default factory; a literal undefined default throws.
    const schema = z.object({ n: z.number() }).default(() => ({ n: 4 }));
    expect(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }).default).toEqual({ n: 4 });
    expect(() => z.toJSONSchema(z.string().default(() => undefined as unknown as string), { io: 'input' })).toThrow(
      '"undefined" is not valid JSON',
    );
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
