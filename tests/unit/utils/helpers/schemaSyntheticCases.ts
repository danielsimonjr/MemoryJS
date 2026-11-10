/**
 * Synthetic schema tree used to widen parity beyond the schemas MemoryJS
 * declares today.
 *
 * `buildSynthetic(z)` is parameterised over the schema namespace so the same
 * tree is built from real Zod 4.6.7 by the recorder and from the in-repo module
 * by the replay test. It deliberately exercises combinations the production
 * schemas do not reach yet — nested strict objects, `.default()` inside a
 * stringified schema (which orders `default` before the inner keywords),
 * nullable records, length-exact strings, and union branches that disagree on
 * type — so a regression in those corners fails parity instead of shipping.
 *
 * Every schema is named, so a mismatch reports which construct broke.
 */

/** One input value fed to every synthetic schema. */
export const SYNTHETIC_INPUTS: unknown[] = [
  undefined,
  null,
  0,
  1,
  -1,
  1.5,
  2 ** 53,
  Number.NaN,
  Infinity,
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'bad',
  'zz',
  ' AB ',
  'ABC',
  true,
  false,
  [],
  [''],
  ['a'],
  ['ab', 'cd', 'ef'],
  {},
  { a: 1 },
  { a: 'x', b: 3 },
  { a: 'x', b: 10 },
  { a: 'x', b: 3, c: 1 },
  { name: 'ab' },
  { name: 'abcd', x: 1 },
  { name: 'ab', n: -1 },
  { name: 'ab', n: 3 },
  { name: 'ab', tags: ['aa', 'bb', 'cc'] },
  { kind: 'a', v: 'x' },
  { kind: 'b', v: 1 },
  { kind: 'c', v: 1 },
  { kind: 'a', v: 1, extra: 2 },
  [1, 'ab'],
  [0, 'ab'],
  [1, 'abc'],
  { ts: '2026-01-15T12:00:00Z' },
  { ts: 'nope' },
  { h: 'abc' },
  { h: 'abcd' },
  { s: null, a: null },
  { s: 'x', a: ['y'], r: { k: null } },
  { s: 5 },
  { s: 'x', r: { toolong: 'v' } },
  { list: [], score: 0 },
  { list: ['ab'], score: 1 },
  { list: ['abc'], score: 2 },
  { list: 'x' },
  { list: ['a'], nested: { x: 'v' } },
  { list: ['a'], nested: { x: 1 } },
  {
    sessionId: 'abc',
    tokens: { input: 1, output: 2 },
    rubric: [{ id: 'c', text: 't', kind: 'fact' }],
  },
  { sessionId: 'abc', tokens: { input: 1 }, rubric: [] },
  { sessionId: 'abc', tokens: { input: 200, output: 2 }, rubric: [] },
  { sessionId: 'abc', rubric: [{ id: 'c', text: 't', kind: 'nope' }] },
  { sessionId: 'abc', rubric: [{ id: 'c', text: 't', kind: 'number', expected: [1] }] },
  { sessionId: 'abc', rubric: [{ id: 'c', text: 't', kind: 'number', expected: ['a', 1] }] },
  { sessionId: 'abc', tokens: { input: 1, output: 2, extra: 3 } },
  { v: 1 },
  { v: 2 },
  { v: 1, w: 'w' },
  { v: 1, w: 'x' },
  { h: 'ab' },
  { h: 'ab', k: 'cd' },
  { h: 'ab', k: 'cde' },
  { i: 0, j: 0 },
  { i: -6 },
  { i: 6 },
  { i: 0, j: 1.5 },
  { p: 1 },
  { p: 0 },
  { p: 1, f: Infinity },
  { p: 1, f: Number.NaN },
  { p: 1, f: 2 },
  { a: { b: { c: [{ d: 'ab' }] } }, flag: true },
  { a: { b: { c: [{ d: 'abc' }, { d: 'x', e: 1 }] } }, flag: true },
  { a: { b: { c: [{ d: 'ab' }, { d: 'cd' }, { d: 'ef' }] } }, flag: false },
  { a: { b: { c: [] } }, flag: true },
  { a: { b: {} }, flag: true },
  { a: {}, flag: 'x' },
  { a: { b: { c: [{ d: 'ab', z: 1 }] } }, flag: true },
  { list: [null], score: null },
  { list: [undefined], score: 0.5 },
];

/** The subset of the schema namespace `buildSynthetic` needs. */
export interface SyntheticZNamespace {
  string(): any;
  number(): any;
  boolean(): any;
  null(): any;
  enum(values: readonly string[]): any;
  literal(value: string | number): any;
  array(element: any): any;
  tuple(items: readonly any[]): any;
  object(shape: Record<string, any>): any;
  record(keyType: any, valueType: any): any;
  union(options: readonly any[]): any;
  discriminatedUnion(discriminator: string, options: readonly any[]): any;
  iso: { datetime(): any };
}

/**
 * Build the synthetic schema tree with the given implementation.
 *
 * @param z - The schema namespace (real Zod or the in-repo module).
 * @returns Named schemas, all built from the same source.
 */
export function buildSynthetic(z: SyntheticZNamespace): Record<string, any> {
  const token = z
    .object({ input: z.number().int().min(0).max(100), output: z.number().int().min(0).max(100) })
    .strict();
  const rubric = z
    .object({
      id: z.string().min(1).max(4),
      text: z.string().max(6),
      kind: z.enum(['fact', 'number', 'free']),
      expected: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
    })
    .strict();
  return {
    objStrict: z
      .object({
        name: z.string().min(2).max(4),
        tags: z.array(z.string().max(3)).max(2).optional(),
        n: z.number().positive().optional(),
      })
      .strict(),
    objStrip: z.object({
      name: z.string().min(2),
      nested: z.object({ a: z.string(), b: z.number().int().min(0).max(9) }).strict().optional(),
      flag: z.boolean().default(false),
    }),
    objPass: z.object({ name: z.string() }).passthrough(),
    deep: z
      .object({
        a: z.object({
          b: z.object({
            c: z.array(z.object({ d: z.string().max(2), e: z.number().optional() }).strict()).max(2),
          }),
        }),
        flag: z.boolean(),
      })
      .strict(),
    arrStrictObjects: z.array(z.object({ id: z.string().min(1).max(5) }).strict()).min(1).max(3),
    tup: z.tuple([z.number().int().min(1), z.string().max(2)]),
    rec: z.record(
      z.string().min(1).max(5).refine((k: string) => k !== 'bad', 'reserved key'),
      z.object({ x: z.string().max(3) }).strict(),
    ),
    un: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
    unionObj: z.union([z.object({ a: z.string() }).strict(), z.object({ b: z.number() }).strict()]),
    unionNull: z.union([z.string().max(2), z.null()]),
    disc: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), v: z.string() }).strict(),
      z.object({ kind: z.literal('b'), v: z.number() }).strict(),
    ]),
    iso: z.object({ ts: z.iso.datetime().optional(), h: z.string().length(3).optional() }),
    refineStr: z
      .string()
      .trim()
      .min(2)
      .refine((s: string) => s !== 'zz', { message: 'nope' }),
    lower: z.string().toLowerCase().regex(/^[a-z]+$/, 'letters only'),
    enumArr: z.array(z.enum(['x', 'y'])).min(1).max(2),
    literalField: z.object({ v: z.literal(1), w: z.literal('w').optional() }),
    lengthStr: z.object({ h: z.string().length(2), k: z.string().length(2).optional() }),
    intRange: z.object({ i: z.number().int().min(-5).max(5), j: z.number().int().optional() }),
    posFinite: z.object({ p: z.number().positive(), f: z.number().finite().optional() }),
    nullableAll: z
      .object({
        s: z.string().nullable(),
        a: z.array(z.string()).nullable().optional(),
        r: z.record(z.string().max(3), z.string().nullable()).optional(),
      })
      .strict(),
    defaulted: z.object({
      list: z.array(z.string().max(2)).default([]),
      score: z.number().min(0).max(1).default(0.5),
      nested: z.object({ x: z.string().default('d') }).optional(),
    }),
    tokens: z
      .object({
        sessionId: z.string().min(1).max(5),
        tokens: token.optional(),
        rubric: z.array(rubric).max(2),
      })
      .strict(),
  };
}
