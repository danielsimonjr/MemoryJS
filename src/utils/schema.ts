/**
 * In-repo schema validator for the subset of Zod 4.6.7 that MemoryJS uses.
 *
 * The API mirrors Zod's fluent builder — `z.object`, `z.string().min()`,
 * `.safeParse()`, `z.infer` — so call sites did not change when `zod` was
 * removed. Issue codes, paths, messages and issue order match Zod 4.6.7, and
 * `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })` reproduces
 * its output for every schema MemoryJS publishes, because both reach users
 * through `formatZodErrors`, the Recursa `invalid_args` message and the tool
 * `inputSchema` descriptors.
 *
 * Only the surface the codebase uses is implemented: object, array, tuple,
 * record, union, discriminated union, enum, literal, string (with
 * min/max/length/regex/datetime/trim/toLowerCase), number (with
 * int/min/max/positive/finite), boolean, null, unknown, and the
 * optional/nullable/default/refine wrappers. `z.unknown()` accepts `undefined`
 * exactly as Zod does; `z.number().finite()` is a no-op because non-finite
 * numbers already fail the type check.
 *
 * Parity is pinned by `tests/unit/utils/schema.parity.test.ts` against a fixture
 * recorded from the real package by
 * `tests/unit/utils/helpers/captureSchemaParity.ts`.
 *
 * @module utils/schema
 */

// Adapted from zod (https://github.com/colinhacks/zod), MIT License.
// Copyright (c) 2025 Colin McDonnell
//
// The issue shapes, message templates, English locale strings, issue-ordering
// rules, check-abort semantics and JSON Schema emission follow the source of
// zod 4.6.7; the implementation here is a narrow reimplementation of the shapes
// MemoryJS uses. See `THIRD_PARTY_NOTICES` for the copyright and license text.

/** Path of an issue, mirroring Zod's `PropertyKey[]`. */
export type IssuePath = PropertyKey[];

/** One validation issue, in Zod's shape. */
export interface SchemaIssue {
  /** Stable machine code such as `invalid_type` or `too_small`. */
  code: string;
  /** Path of the failing value. */
  path: IssuePath;
  /** Human-readable message. */
  message: string;
  /** Additional code-specific fields (`expected`, `origin`, `minimum`, ...). */
  [key: string]: unknown;
}

class ZodErrorBase<T = unknown> extends Error {
  /** Every issue produced by the failed parse, in emission order. */
  readonly issues: SchemaIssue[];

  /**
   * Build an error from a list of issues.
   *
   * @param issues - Issues to report.
   */
  constructor(issues: SchemaIssue[]) {
    super(JSON.stringify(issues, null, 2));
    this.name = 'ZodError';
    this.issues = issues;
    void (0 as unknown as T);
  }
}

/** Error thrown (or returned) when validation fails. */
export type ZodError<T = unknown> = ZodErrorBase<T>;

/** Result of {@link BaseSchema.safeParse}. */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ZodErrorBase<unknown> };

type CheckDef =
  | { kind: 'minLength' | 'maxLength' | 'length'; value: number; message?: string }
  | { kind: 'regex'; pattern: RegExp; message?: string }
  | { kind: 'datetime'; message?: string }
  | { kind: 'trim' }
  | { kind: 'lowercase' }
  | { kind: 'int'; message?: string }
  | { kind: 'gt' | 'gte' | 'lt' | 'lte'; value: number; message?: string }
  | { kind: 'refine'; fn: (value: unknown) => unknown; message?: string; path?: readonly PropertyKey[] };

/** An issue plus the internal `continue` flag Zod tracks on it. */
interface InternalIssue {
  issue: SchemaIssue;
  /** `true` keeps later checks running; `false` stops them; `undefined` stops implicitly. */
  continues: boolean | undefined;
}

interface Payload {
  value: unknown;
  issues: InternalIssue[];
}

/** Messages for Zod's English locale. */
const SIZABLE: Record<string, { unit: string }> = {
  string: { unit: 'characters' },
  array: { unit: 'items' },
};
const FORMAT_DICTIONARY: Record<string, string> = {
  regex: 'input',
  datetime: 'ISO datetime',
};

/** ISO 8601 date source used by `z.iso.datetime()`, copied from Zod's regexes. */
const DATE_SOURCE =
  '(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
const DATETIME_SOURCE = `^${DATE_SOURCE}T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$`;
const NUMBER_MAX_SAFE = Number.MAX_SAFE_INTEGER;
const NUMBER_MIN_SAFE = Number.MIN_SAFE_INTEGER;
/** Numeric-string object keys retried as numbers for record key schemas, matching Zod 4.6.7. */
const NUMERIC_KEY_PATTERN = /^-?\d+(?:\.\d+)?$/;

/** `String()` rendering Zod uses inside messages. */
function stringifyPrimitive(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'string') return `"${value}"`;
  return `${String(value)}`;
}

/** Join values with a separator, stringifying each. */
function joinValues(values: readonly unknown[], separator = '|'): string {
  return values.map((value) => stringifyPrimitive(value)).join(separator);
}

/** Zod's `parsedType`, used for the "received" half of an `invalid_type` message. */
function parsedType(data: unknown): string {
  const type = typeof data;
  if (type === 'number') return Number.isNaN(data) ? 'nan' : 'number';
  if (type === 'object') {
    if (data === null) return 'null';
    if (Array.isArray(data)) return 'array';
    const obj = data as { constructor?: unknown };
    if (obj && Object.getPrototypeOf(obj) !== Object.prototype && 'constructor' in obj && obj.constructor) {
      return (obj.constructor as { name?: string }).name as string;
    }
  }
  return type;
}

/** Zod maps `nan` to `NaN` for display and prints non-finite numbers literally. */
function typeName(type: string | undefined, input?: unknown): string {
  if (type === undefined) return 'undefined';
  if (type === 'number' && typeof input === 'number' && !Number.isFinite(input)) return String(input);
  return type === 'nan' ? 'NaN' : type;
}

/** Number of Unicode code points, which is how Zod measures string length. */
function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** Zod's `isObject`: any non-null, non-array object. */
function isObjectValue(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

/** Zod's `isPlainObject`, which decides whether a value may be a record. */
function isPlainObjectValue(data: unknown): data is Record<string, unknown> {
  if (!isObjectValue(data)) return false;
  const proto = Object.getPrototypeOf(data) as { constructor?: { prototype?: unknown } } | null;
  const ctor = (data as { constructor?: unknown }).constructor;
  if (ctor === undefined || typeof ctor !== 'function') return true;
  const ctorPrototype = (ctor as { prototype?: unknown }).prototype;
  if (!isObjectValue(ctorPrototype) && ctorPrototype !== null) return true;
  if (proto === null) return true;
  return Object.prototype.hasOwnProperty.call(ctorPrototype, 'isPrototypeOf');
}

/** Build an issue in canonical field order. */
function makeIssue(fields: Record<string, unknown>): SchemaIssue {
  return { path: [], message: '', ...fields } as unknown as SchemaIssue;
}

/** Push an issue onto a payload, recording whether later checks continue. */
function pushIssue(payload: Payload, issue: SchemaIssue, continues: boolean | undefined): void {
  payload.issues.push({ issue, continues });
}

/** Zod's `aborted`: any issue so far that is not explicitly continuing. */
function aborted(payload: Payload, start = 0): boolean {
  for (let i = start; i < payload.issues.length; i++) {
    if (payload.issues[i]!.continues !== true) return true;
  }
  return false;
}

/** Zod's `explicitlyAborted`: any issue so far with `continue === false`. */
function explicitlyAborted(payload: Payload): boolean {
  return payload.issues.some((entry) => entry.continues === false);
}

/** Prefix every issue path with one segment, as Zod's `prefixIssues` does. */
function prefixIssues(issues: readonly InternalIssue[], segment: PropertyKey): InternalIssue[] {
  return issues.map((entry) => ({ issue: { ...entry.issue, path: [segment, ...entry.issue.path] }, continues: entry.continues }));
}

/** Message for a size issue, matching Zod's English locale. */
function sizeMessage(kind: 'too_big' | 'too_small', issue: SchemaIssue): string {
  const exact = issue.exact === true;
  const inclusive = issue.inclusive === true;
  const adjective = kind === 'too_big' ? (exact ? 'exactly ' : inclusive ? '<=' : '<') : exact ? 'exactly ' : inclusive ? '>=' : '>';
  const origin = typeof issue.origin === 'string' ? issue.origin : 'value';
  const sizing = SIZABLE[origin];
  const bound = kind === 'too_big' ? issue.maximum : issue.minimum;
  if (sizing) {
    return `Too ${kind === 'too_big' ? 'big' : 'small'}: expected ${origin} to have ${adjective}${String(bound)} ${sizing.unit}`;
  }
  return `Too ${kind === 'too_big' ? 'big' : 'small'}: expected ${origin} to be ${adjective}${String(bound)}`;
}

/** Message for an `invalid_format` issue, matching Zod's English locale. */
function formatMessage(issue: SchemaIssue): string {
  const format = String(issue.format);
  if (format === 'regex') return `Invalid string: must match pattern ${String(issue.pattern)}`;
  return `Invalid ${FORMAT_DICTIONARY[format] ?? format}`;
}

/** Message for an `invalid_type` issue, matching Zod's English locale. */
function invalidTypeMessage(issue: SchemaIssue): string {
  const expected = typeName(String(issue.expected));
  const received = typeName(parsedType(issue.input), issue.input);
  return `Invalid input: expected ${expected}, received ${received}`;
}

/** Default message for an issue whose check carried no message. */
function defaultMessage(issue: SchemaIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return invalidTypeMessage(issue);
    case 'invalid_value':
      return (issue.values as unknown[]).length === 1
        ? `Invalid input: expected ${stringifyPrimitive((issue.values as unknown[])[0])}`
        : `Invalid option: expected one of ${joinValues(issue.values as unknown[])}`;
    case 'too_big':
    case 'too_small':
      return sizeMessage(issue.code, issue);
    case 'invalid_format':
      return formatMessage(issue);
    case 'unrecognized_keys':
      return `Unrecognized key${(issue.keys as unknown[]).length > 1 ? 's' : ''}: ${joinValues(issue.keys as unknown[], ', ')}`;
    case 'invalid_key':
      return `Invalid key in ${String(issue.origin)}`;
    case 'invalid_union': {
      const options = issue.options;
      if (Array.isArray(options) && options.length > 0) {
        return `Invalid discriminator value. Expected ${options.map((option) => `'${String(option)}'`).join(' | ')}`;
      }
      if (issue.inclusive === false) return 'Invalid input: more than one option matched';
      return 'Invalid input';
    }
    default:
      return 'Invalid input';
  }
}

/** Zod's `when` for length-based checks: the value must expose a `length`. */
function hasLength(value: unknown): boolean {
  return value !== null && value !== undefined && (value as { length?: unknown }).length !== undefined;
}

/** Size checks run even after an implicit abort, but not after an explicit one. */
function isSizeCheck(check: CheckDef): boolean {
  return check.kind === 'minLength' || check.kind === 'maxLength' || check.kind === 'length';
}

/** Run one check against a payload. */
function applyCheck(check: CheckDef, payload: Payload): void {
  const value = payload.value;
  switch (check.kind) {
    case 'minLength':
    case 'maxLength':
    case 'length': {
      if (!hasLength(value)) return;
      const measured = typeof value === 'string' ? codePointLength(value) : (value as { length: number }).length;
      const origin = typeof value === 'string' ? 'string' : 'array';
      const tooBig =
        check.kind === 'length'
          ? measured !== check.value && measured > check.value
          : check.kind === 'maxLength' && measured > check.value;
      const tooSmall =
        check.kind === 'length'
          ? measured !== check.value && measured < check.value
          : check.kind === 'minLength' && measured < check.value;
      if (!tooBig && !tooSmall) return;
      const issue = makeIssue({
        code: tooBig ? 'too_big' : 'too_small',
        origin,
        ...(tooBig ? { maximum: check.value } : { minimum: check.value }),
        inclusive: true,
        ...(check.kind === 'length' ? { exact: true } : {}),
        input: value,
        message: check.message ?? '',
      });
      if (check.message === undefined) issue.message = sizeMessage(tooBig ? 'too_big' : 'too_small', issue);
      pushIssue(payload, issue, true);
      return;
    }
    case 'regex': {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(value as string)) return;
      const issue = makeIssue({
        code: 'invalid_format',
        origin: 'string',
        format: 'regex',
        pattern: check.pattern.toString(),
        input: value,
        message: check.message ?? '',
      });
      if (check.message === undefined) issue.message = formatMessage(issue);
      pushIssue(payload, issue, true);
      return;
    }
    case 'datetime': {
      const pattern = new RegExp(DATETIME_SOURCE);
      if (pattern.test(value as string)) return;
      const issue = makeIssue({
        code: 'invalid_format',
        origin: 'string',
        format: 'datetime',
        pattern: pattern.toString(),
        input: value,
        message: check.message ?? '',
      });
      if (check.message === undefined) issue.message = formatMessage(issue);
      pushIssue(payload, issue, true);
      return;
    }
    case 'trim':
      payload.value = (value as string).trim();
      return;
    case 'lowercase':
      payload.value = (value as string).toLowerCase();
      return;
    case 'int': {
      if (!Number.isInteger(value)) {
        const issue = makeIssue({
          code: 'invalid_type',
          expected: 'int',
          format: 'safeint',
          input: value,
          message: check.message ?? '',
        });
        if (check.message === undefined) issue.message = invalidTypeMessage(issue);
        pushIssue(payload, issue, false);
        return;
      }
      if (!Number.isSafeInteger(value)) {
        const tooBig = (value as number) > 0;
        const issue = makeIssue({
          code: tooBig ? 'too_big' : 'too_small',
          ...(tooBig ? { maximum: NUMBER_MAX_SAFE } : { minimum: NUMBER_MIN_SAFE }),
          note: 'Integers must be within the safe integer range.',
          origin: 'int',
          inclusive: true,
          input: value,
          message: check.message ?? '',
        });
        if (check.message === undefined) issue.message = sizeMessage(tooBig ? 'too_big' : 'too_small', issue);
        pushIssue(payload, issue, true);
      }
      return;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const number = value as number;
      const passes =
        check.kind === 'gt'
          ? number > check.value
          : check.kind === 'gte'
            ? number >= check.value
            : check.kind === 'lt'
              ? number < check.value
              : number <= check.value;
      if (passes) return;
      const tooBig = check.kind === 'lt' || check.kind === 'lte';
      const issue = makeIssue({
        code: tooBig ? 'too_big' : 'too_small',
        origin: 'number',
        ...(tooBig ? { maximum: check.value } : { minimum: check.value }),
        inclusive: check.kind === 'gte' || check.kind === 'lte',
        input: value,
        message: check.message ?? '',
      });
      if (check.message === undefined) issue.message = sizeMessage(tooBig ? 'too_big' : 'too_small', issue);
      pushIssue(payload, issue, true);
      return;
    }
    case 'refine': {
      if (check.fn(value)) return;
      pushIssue(
        payload,
        makeIssue({ code: 'custom', input: value, path: [...(check.path ?? [])], message: check.message ?? 'Invalid input' }),
        true,
      );
      return;
    }
  }
}

/** Run a schema's checks in order, honouring Zod's abort rules. */
function runChecks(payload: Payload, checks: readonly CheckDef[] | undefined): void {
  if (!checks || checks.length === 0) return;
  for (const check of checks) {
    if (isSizeCheck(check)) {
      if (explicitlyAborted(payload)) continue;
      if (!hasLength(payload.value)) continue;
    } else if (aborted(payload)) {
      continue;
    }
    applyCheck(check, payload);
  }
}

/** Leading upper-bound checks, paired with the bound, mirroring Zod's `sizeCaps`. */
function sizeCaps(checks: readonly CheckDef[]): Array<[number, CheckDef]> {
  const caps: Array<[number, CheckDef]> = [];
  for (const check of checks) {
    if (check.kind === 'maxLength' || check.kind === 'length') {
      caps.push([check.value, check]);
    } else if (check.kind === 'minLength') {
      continue;
    } else {
      break;
    }
  }
  return caps;
}

/** Accepted options for a message-carrying check. */
export type MessageParams = string | { message?: string };

/** Options for {@link BaseSchema.refine}, including Zod's `path` override. */
export type RefineParams = string | { message?: string; path?: readonly PropertyKey[] };

function refineParams(params: RefineParams | undefined): { message?: string; path?: readonly PropertyKey[] } {
  if (params === undefined) return {};
  if (typeof params === 'string') return { message: params };
  return { message: params.message, path: params.path };
}

/** Resolve a message option to its string, if any. */
function messageOf(params: MessageParams | undefined): string | undefined {
  if (params === undefined) return undefined;
  if (typeof params === 'string') return params;
  return params.message;
}

/** Shape of an object schema, keyed by property name. */
export type SchemaShape = Record<string, BaseSchema<unknown, unknown>>;

/** Any schema instance. */
export type AnySchema = BaseSchema<unknown, unknown>;

type OptionalKeys<S extends SchemaShape> = {
  [K in keyof S]: undefined extends S[K]['__out'] ? K : never;
}[keyof S];
type RequiredKeys<S extends SchemaShape> = {
  [K in keyof S]: undefined extends S[K]['__out'] ? never : K;
}[keyof S];

/** Output type of an object schema. */
export type ObjectOutput<S extends SchemaShape> = {
  [K in RequiredKeys<S>]: S[K]['__out'];
} & {
  [K in OptionalKeys<S>]?: S[K]['__out'];
};

type Mode = 'strip' | 'strict' | 'passthrough';
type Def =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'literal'; values: readonly unknown[] }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'array'; element: AnySchema }
  | { kind: 'tuple'; items: readonly AnySchema[] }
  | { kind: 'object'; shape: SchemaShape; mode: Mode }
  | { kind: 'record'; keyType: AnySchema; valueType: AnySchema }
  | { kind: 'union'; options: readonly AnySchema[] }
  | { kind: 'discriminatedUnion'; discriminator: string; options: readonly AnySchema[] }
  | { kind: 'optional'; innerType: AnySchema }
  | { kind: 'nullable'; innerType: AnySchema }
  | { kind: 'default'; innerType: AnySchema; defaultValue: unknown };

/**
 * A validation schema. The fluent methods mirror Zod's, so a schema reads the
 * same as before the dependency was removed.
 */
export abstract class BaseSchema<Out = unknown, In = unknown> {
  /** Phantom carrier of the parsed output type, read by {@link z.infer}. */
  declare readonly __out: Out;
  /** Phantom carrier of the accepted input type. */
  declare readonly __in: In;

  /**
   * Create a schema.
   *
   * @param def - The schema definition.
   * @param checks - Checks applied after parsing the value.
   */
  protected constructor(
    readonly def: Def,
    readonly checks: readonly CheckDef[] = [],
  ) {}

  /** Zod's `optin` rung: `undefined`, `optional` or `defaulted`. */
  get optin(): 'optional' | 'defaulted' | undefined {
    return undefined;
  }

  /** Zod's `optout`: `optional` when absence is permitted in the output. */
  get optout(): 'optional' | undefined {
    return undefined;
  }

  /** Parse a value, returning a result object instead of throwing. */
  safeParse(data: unknown): SafeParseResult<Out> {
    const payload: Payload = { value: data, issues: [] };
    this._parse(payload);
    runChecks(payload, this.checks);
    if (payload.issues.length > 0) {
      return { success: false, error: new ZodErrorBase(payload.issues.map((entry) => entry.issue)) };
    }
    return { success: true, data: payload.value as Out };
  }

  /**
   * Parse a value, throwing on failure.
   *
   * @param data - Value to validate.
   * @returns The parsed value.
   * @throws ZodError when validation fails.
   */
  parse(data: unknown): Out {
    const result = this.safeParse(data);
    if (result.success) return result.data;
    throw result.error;
  }

  /** Accept `undefined` in addition to the parsed value. */
  optional(): OptionalSchema<this> {
    return new OptionalSchema({ kind: 'optional', innerType: this as unknown as AnySchema });
  }

  /** Accept `null` in addition to the parsed value. */
  nullable(): NullableSchema<this> {
    return new NullableSchema({ kind: 'nullable', innerType: this as unknown as AnySchema });
  }

  /**
   * Substitute a value when the input is `undefined`.
   *
   * @param value - The default, or a factory returning it.
   */
  default(value: Out | (() => Out)): DefaultSchema<this> {
    return new DefaultSchema({ kind: 'default', innerType: this as unknown as AnySchema, defaultValue: value });
  }

  /**
   * Add a predicate the parsed value must satisfy.
   *
   * @param fn - Predicate; a falsy result is an issue.
   * @param params - Optional message.
   */
  refine(fn: (value: Out) => unknown, params?: RefineParams): this {
    const resolved = refineParams(params);
    return this._withChecks([
      ...this.checks,
      { kind: 'refine', fn: fn as (value: unknown) => unknown, message: resolved.message, path: resolved.path },
    ]);
  }

  /** Rebuild this schema with a different check list. */
  protected _withChecks(checks: readonly CheckDef[]): this {
    const ctor = this.constructor as unknown as new (def: Def, checks: readonly CheckDef[]) => this;
    return new ctor(this.def, checks);
  }

  /** Validate one value into a payload. */
  protected abstract _parse(payload: Payload): void;

  /** Run a child schema and adopt its payload. */
  protected static _runInner(inner: AnySchema, payload: Payload): void {
    inner._run(payload);
  }

  /** Internal entry point: parse then run checks. */
  _run(payload: Payload): void {
    this._parse(payload);
    runChecks(payload, this.checks);
  }
}

/** Zod-compatible alias for the schema type. */
export type ZodSchema<Out = unknown, In = unknown> = BaseSchema<Out, In>;
export type { BaseSchema as ZodType };

/** A string schema. */
export class StringSchema extends BaseSchema<string> {
  /** Create a string schema. */
  constructor(def: Def = { kind: 'string' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  /** Require at least `value` characters. */
  min(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'minLength', value, message: messageOf(params) }]);
  }

  /** Require at most `value` characters. */
  max(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'maxLength', value, message: messageOf(params) }]);
  }

  /** Require exactly `value` characters. */
  length(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'length', value, message: messageOf(params) }]);
  }

  /** Require the value to match a pattern. */
  regex(pattern: RegExp, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'regex', pattern, message: messageOf(params) }]);
  }

  /** Require an ISO 8601 date-time with a `Z` suffix. */
  datetime(params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'datetime', message: messageOf(params) }]);
  }

  /** Trim surrounding whitespace. */
  trim(): this {
    return this._withChecks([...this.checks, { kind: 'trim' }]);
  }

  /** Lower-case the value. */
  toLowerCase(): this {
    return this._withChecks([...this.checks, { kind: 'lowercase' }]);
  }

  protected _parse(payload: Payload): void {
    if (typeof payload.value === 'string') return;
    const issue = makeIssue({ code: 'invalid_type', expected: 'string', input: payload.value, message: '' });
    issue.message = invalidTypeMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** A number schema. */
export class NumberSchema extends BaseSchema<number> {
  /** Create a number schema. */
  constructor(def: Def = { kind: 'number' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  /** Require a safe integer. */
  int(params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'int', message: messageOf(params) }]);
  }

  /** Require at least `value`. */
  min(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'gte', value, message: messageOf(params) }]);
  }

  /** Require at most `value`. */
  max(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'lte', value, message: messageOf(params) }]);
  }

  /** Require a value greater than zero. */
  positive(params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'gt', value: 0, message: messageOf(params) }]);
  }

  /** Require a finite number. Non-finite numbers already fail the type check. */
  finite(): this {
    return this;
  }

  protected _parse(payload: Payload): void {
    const value = payload.value;
    if (typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)) return;
    const received =
      typeof value === 'number' ? (Number.isNaN(value) ? 'NaN' : Number.isFinite(value) ? undefined : String(value)) : undefined;
    const issue = makeIssue({
      code: 'invalid_type',
      expected: 'number',
      ...(received === undefined ? {} : { received }),
      input: value,
      message: '',
    });
    issue.message = invalidTypeMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** A boolean schema. */
export class BooleanSchema extends BaseSchema<boolean> {
  /** Create a boolean schema. */
  constructor(def: Def = { kind: 'boolean' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    if (typeof payload.value === 'boolean') return;
    const issue = makeIssue({ code: 'invalid_type', expected: 'boolean', input: payload.value, message: '' });
    issue.message = invalidTypeMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** A schema accepting only `null`. */
export class NullSchema extends BaseSchema<null> {
  /** Create a null schema. */
  constructor(def: Def = { kind: 'null' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    if (payload.value === null) return;
    const issue = makeIssue({ code: 'invalid_type', expected: 'null', input: payload.value, message: '' });
    issue.message = invalidTypeMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** A schema accepting any value. */
export class UnknownSchema extends BaseSchema<unknown> {
  /** Create an unknown schema. */
  constructor(def: Def = { kind: 'unknown' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(): void {
    // Any value, including `undefined`, passes.
  }
}

/** A schema accepting one of a fixed set of literal values. */
export class LiteralSchema<V extends string | number | boolean | null> extends BaseSchema<V> {
  /** Create a literal schema. */
  constructor(def: Def = { kind: 'literal', values: [] }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    const values = (this.def as { values: readonly unknown[] }).values;
    if (values.some((value) => value === payload.value)) return;
    const issue = makeIssue({ code: 'invalid_value', values, input: payload.value, message: '' });
    issue.message = defaultMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** A schema accepting one of a fixed set of strings. */
export class EnumSchema<V extends readonly [string, ...string[]]> extends BaseSchema<V[number]> {
  /** Create an enum schema. */
  constructor(def: Def = { kind: 'enum', values: [] }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    const values = (this.def as { values: readonly string[] }).values;
    if (values.includes(payload.value as string)) return;
    const issue = makeIssue({ code: 'invalid_value', values, input: payload.value, message: '' });
    issue.message = defaultMessage(issue);
    pushIssue(payload, issue, undefined);
  }
}

/** An array schema. */
export class ArraySchema<E extends AnySchema> extends BaseSchema<E['__out'][]> {
  /** Create an array schema. */
  constructor(def: Def = { kind: 'array', element: undefined as unknown as AnySchema }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  /** Require at least `value` items. */
  min(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'minLength', value, message: messageOf(params) }]);
  }

  /** Require at most `value` items. */
  max(value: number, params?: MessageParams): this {
    return this._withChecks([...this.checks, { kind: 'maxLength', value, message: messageOf(params) }]);
  }

  protected _parse(payload: Payload): void {
    const input = payload.value;
    if (!Array.isArray(input)) {
      const issue = makeIssue({ code: 'invalid_type', expected: 'array', input, message: '' });
      issue.message = invalidTypeMessage(issue);
      pushIssue(payload, issue, undefined);
      return;
    }
    const caps = sizeCaps(this.checks);
    if (caps.length > 0) {
      const cap = Math.min(...caps.map(([max]) => max));
      if (input.length > cap) {
        for (const [max, check] of caps) {
          if (input.length > max) {
            const issue = makeIssue({
              code: 'too_big',
              origin: 'array',
              maximum: max,
              inclusive: true,
              input,
              message: (check as { message?: string }).message ?? '',
            });
            if ((check as { message?: string }).message === undefined) issue.message = sizeMessage('too_big', issue);
            pushIssue(payload, issue, false);
            return;
          }
        }
      }
    }
    const element = (this.def as { element: AnySchema }).element;
    const out: unknown[] = [];
    const collected: InternalIssue[] = [];
    for (let index = 0; index < input.length; index++) {
      const child: Payload = { value: input[index], issues: [] };
      element._run(child);
      collected.push(...prefixIssues(child.issues, index));
      out[index] = child.value;
    }
    payload.issues.push(...collected);
    payload.value = out;
  }
}

/** A fixed-length tuple schema. */
export class TupleSchema<T extends readonly AnySchema[]> extends BaseSchema<{ -readonly [K in keyof T]: T[K]['__out'] }> {
  /** Create a tuple schema. */
  constructor(def: Def = { kind: 'tuple', items: [] }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    const input = payload.value;
    const items = (this.def as { items: readonly AnySchema[] }).items;
    if (!Array.isArray(input)) {
      const issue = makeIssue({ code: 'invalid_type', expected: 'tuple', input, message: '' });
      issue.message = invalidTypeMessage(issue);
      pushIssue(payload, issue, undefined);
      return;
    }
    if (input.length < items.length) {
      const issue = makeIssue({
        code: 'too_small',
        minimum: items.length,
        inclusive: true,
        origin: 'array',
        input,
        message: '',
      });
      issue.message = sizeMessage('too_small', issue);
      pushIssue(payload, issue, false);
      return;
    }
    if (input.length > items.length) {
      const issue = makeIssue({
        code: 'too_big',
        maximum: items.length,
        inclusive: true,
        origin: 'array',
        input,
        message: '',
      });
      issue.message = sizeMessage('too_big', issue);
      pushIssue(payload, issue, true);
    }
    const out: unknown[] = [];
    for (let index = 0; index < items.length; index++) {
      const child: Payload = { value: input[index], issues: [] };
      items[index]!._run(child);
      payload.issues.push(...prefixIssues(child.issues, index));
      out[index] = child.value;
    }
    payload.value = out;
  }
}

/** An object schema. */
export class ObjectSchema<S extends SchemaShape = SchemaShape> extends BaseSchema<ObjectOutput<S>> {
  /** Create an object schema. */
  constructor(def: Def = { kind: 'object', shape: {}, mode: 'strip' }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  /** Reject unknown keys. */
  strict(): this {
    return this._withMode('strict');
  }

  /** Drop unknown keys (the default). */
  strip(): this {
    return this._withMode('strip');
  }

  /** Keep unknown keys. */
  passthrough(): this {
    return this._withMode('passthrough');
  }

  private _withMode(mode: Mode): this {
    const def = this.def as { kind: 'object'; shape: SchemaShape };
    return this._withChecksAndDef({ kind: 'object', shape: def.shape, mode }, this.checks);
  }

  private _withChecksAndDef(def: Def, checks: readonly CheckDef[]): this {
    const ctor = this.constructor as unknown as new (def: Def, checks: readonly CheckDef[]) => this;
    return new ctor(def, checks);
  }

  protected _parse(payload: Payload): void {
    const input = payload.value;
    const { shape, mode } = this.def as { shape: SchemaShape; mode: Mode };
    if (!isObjectValue(input)) {
      const issue = makeIssue({ code: 'invalid_type', expected: 'object', input, message: '' });
      issue.message = invalidTypeMessage(issue);
      pushIssue(payload, issue, undefined);
      return;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if (key === '__proto__') continue;
      const inner = shape[key]!;
      const isPresent = key in input;
      const isOptionalOut = inner.optout === 'optional';
      if (!isPresent && isOptionalOut && inner.optin === 'optional') continue;
      const child: Payload = { value: input[key], issues: [] };
      inner._run(child);
      if (child.issues.length > 0) {
        if (inner.optin !== undefined && isOptionalOut && !isPresent) continue;
        payload.issues.push(...prefixIssues(child.issues, key));
      }
      if (!isPresent && inner.optin === undefined) {
        if (child.issues.length === 0) {
          pushIssue(payload, makeIssue({ code: 'invalid_type', expected: 'nonoptional', path: [key], input: undefined, message: 'Invalid input: expected nonoptional, received undefined' }), undefined);
        }
        continue;
      }
      if (child.value === undefined) {
        if (isPresent || (inner.optin === 'defaulted' && !isOptionalOut)) out[key] = undefined;
      } else {
        out[key] = child.value;
      }
    }
    if (mode === 'strict' || mode === 'passthrough') {
      const unrecognized: string[] = [];
      for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(shape, key) && shape[key] !== undefined) continue;
        if (key === '__proto__') {
          if (mode === 'strict') unrecognized.push(key);
          continue;
        }
        if (mode === 'strict') {
          unrecognized.push(key);
          continue;
        }
        const value = (input as Record<string, unknown>)[key];
        if (value !== undefined) out[key] = value;
      }
      if (unrecognized.length > 0) {
        const issue = makeIssue({ code: 'unrecognized_keys', keys: unrecognized, input, message: '' });
        issue.message = defaultMessage(issue);
        pushIssue(payload, issue, true);
      }
    }
    payload.value = out;
  }
}

/** Fixed record keys when the key schema is a literal or enum, as in Zod 4.6.7. */
function recordKeyValues(keyType: AnySchema): readonly (string | number)[] | undefined {
  const keyDef = keyType.def;
  if (keyDef.kind === 'literal') {
    const values = keyDef.values.filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
    return values.length > 0 ? values : undefined;
  }
  if (keyDef.kind === 'enum') return keyDef.values;
  return undefined;
}

/** Validate one record object key, including Zod's numeric-string retry. */
function parseRecordKey(keyType: AnySchema, key: PropertyKey): Payload {
  const keyChild: Payload = { value: key, issues: [] };
  keyType._run(keyChild);
  if (typeof key === 'string' && NUMERIC_KEY_PATTERN.test(key) && keyChild.issues.length > 0) {
    const retry: Payload = { value: Number(key), issues: [] };
    keyType._run(retry);
    if (retry.issues.length === 0) return retry;
  }
  return keyChild;
}

/** A record schema with a dynamic key set. */
export class RecordSchema<V extends AnySchema> extends BaseSchema<Record<string, V['__out']>> {
  /** Create a record schema. */
  constructor(
    def: Def = { kind: 'record', keyType: undefined as unknown as AnySchema, valueType: undefined as unknown as AnySchema },
    checks: readonly CheckDef[] = [],
  ) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    const input = payload.value;
    const { keyType, valueType } = this.def as { keyType: AnySchema; valueType: AnySchema };
    if (!isPlainObjectValue(input)) {
      const issue = makeIssue({ code: 'invalid_type', expected: 'record', input, message: '' });
      issue.message = invalidTypeMessage(issue);
      pushIssue(payload, issue, undefined);
      return;
    }
    const fixedKeys = recordKeyValues(keyType);
    const out: Record<string, unknown> = {};
    if (fixedKeys) {
      const recordKeys = new Set<string>();
      for (const key of fixedKeys) {
        recordKeys.add(typeof key === 'number' ? key.toString() : key);
        if (key === '__proto__') continue;
        const keyChild = parseRecordKey(keyType, key);
        if (keyChild.issues.length > 0) {
          pushIssue(
            payload,
            makeIssue({
              code: 'invalid_key',
              origin: 'record',
              issues: keyChild.issues.map((entry) => entry.issue),
              input: key,
              path: [key],
              message: 'Invalid key in record',
            }),
            undefined,
          );
          continue;
        }
        const outKey = keyChild.value;
        if (outKey === '__proto__') continue;
        const valueChild: Payload = { value: (input as Record<PropertyKey, unknown>)[key], issues: [] };
        valueType._run(valueChild);
        if (valueChild.issues.length > 0) {
          payload.issues.push(...prefixIssues(valueChild.issues, key));
        }
        out[String(outKey)] = valueChild.value;
      }
      const unrecognized: string[] = [];
      for (const key in input) {
        if (!recordKeys.has(key)) unrecognized.push(key);
      }
      if (unrecognized.length > 0) {
        const issue = makeIssue({ code: 'unrecognized_keys', keys: unrecognized, input, message: '' });
        issue.message = defaultMessage(issue);
        pushIssue(payload, issue, true);
      }
      payload.value = out;
      return;
    }
    for (const key of Reflect.ownKeys(input)) {
      if (key === '__proto__') continue;
      if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
      const keyChild = parseRecordKey(keyType, key);
      if (keyChild.issues.length > 0) {
        pushIssue(
          payload,
          makeIssue({
            code: 'invalid_key',
            origin: 'record',
            issues: keyChild.issues.map((entry) => entry.issue),
            input: key,
            path: [key],
            message: 'Invalid key in record',
          }),
          undefined,
        );
        continue;
      }
      const outKey = keyChild.value;
      if (outKey === '__proto__') continue;
      const valueChild: Payload = { value: (input as Record<PropertyKey, unknown>)[key], issues: [] };
      valueType._run(valueChild);
      payload.issues.push(...prefixIssues(valueChild.issues, outKey as PropertyKey));
      out[String(outKey)] = valueChild.value;
    }
    payload.value = out;
  }
}

/** A union of schemas, accepting the first that parses. */
export class UnionSchema<O extends readonly AnySchema[]> extends BaseSchema<O[number]['__out']> {
  /** Create a union schema. */
  constructor(def: Def = { kind: 'union', options: [] }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  protected _parse(payload: Payload): void {
    const options = (this.def as { options: readonly AnySchema[] }).options;
    const results: Payload[] = [];
    for (const option of options) {
      const child: Payload = { value: payload.value, issues: [] };
      option._run(child);
      if (child.issues.length === 0) {
        payload.value = child.value;
        return;
      }
      results.push(child);
    }
    const nonAborted = results.filter((result) => !aborted(result));
    if (nonAborted.length === 1) {
      const only = nonAborted[0]!;
      payload.value = only.value;
      payload.issues.push(...only.issues);
      return;
    }
    pushIssue(
      payload,
      makeIssue({
        code: 'invalid_union',
        errors: results.map((result) => result.issues.map((entry) => entry.issue)),
        input: payload.value,
        message: 'Invalid input',
      }),
      undefined,
    );
  }
}

/** A union that selects its branch from a discriminator property. */
export class DiscriminatedUnionSchema<O extends readonly AnySchema[]> extends BaseSchema<O[number]['__out']> {
  private _optionsMap: Map<unknown, AnySchema> | undefined;

  /** Create a discriminated union schema. */
  constructor(def: Def = { kind: 'discriminatedUnion', discriminator: '', options: [] }, checks: readonly CheckDef[] = []) {
    super(def, checks);
    const { discriminator, options } = def as { discriminator: string; options: readonly AnySchema[] };
    options.forEach((option, index) => {
      const optionDef = option.def as { kind: string; shape?: SchemaShape };
      if (optionDef.kind !== 'object' || !optionDef.shape || !Object.prototype.hasOwnProperty.call(optionDef.shape, discriminator)) {
        throw new Error(`Invalid discriminated union option at index "${index}"`);
      }
    });
  }

  protected _parse(payload: Payload): void {
    const { discriminator, options } = this.def as { discriminator: string; options: readonly AnySchema[] };
    const input = payload.value;
    if (!isObjectValue(input)) {
      const issue = makeIssue({ code: 'invalid_type', expected: 'object', input, message: '' });
      issue.message = invalidTypeMessage(issue);
      pushIssue(payload, issue, undefined);
      return;
    }
    const map = this._discriminatorMap(discriminator, options);
    const value = input[discriminator];
    const option = map.get(value);
    if (option) {
      option._run(payload);
      return;
    }
    const values = [...map.keys()];
    pushIssue(
      payload,
      makeIssue({
        code: 'invalid_union',
        errors: [],
        note: 'No matching discriminator',
        discriminator,
        options: values,
        input,
        path: [discriminator],
        message: `Invalid discriminator value. Expected ${values.map((entry) => `'${String(entry)}'`).join(' | ')}`,
      }),
      undefined,
    );
  }

  /** Lazy-built lookup map; throws on duplicate discriminator literals at first parse. */
  private _discriminatorMap(discriminator: string, options: readonly AnySchema[]): Map<unknown, AnySchema> {
    if (this._optionsMap) return this._optionsMap;
    this._optionsMap = buildDiscriminatorMap(discriminator, options);
    return this._optionsMap;
  }
}

/** Discriminator value to branch map, built the way Zod builds `optionsMap`. */
function buildDiscriminatorMap(discriminator: string, options: readonly AnySchema[]): Map<unknown, AnySchema> {
  const map = new Map<unknown, AnySchema>();
  for (const option of options) {
    const def = option.def as { kind: string; shape?: SchemaShape };
    if (def.kind !== 'object' || !def.shape) throw new Error('Invalid discriminated union option');
    const field = def.shape[discriminator];
    if (!field) throw new Error(`Invalid discriminated union option: missing discriminator "${discriminator}"`);
    const fieldDef = field.def as { kind: string; values?: readonly unknown[] };
    if (fieldDef.kind !== 'literal' && fieldDef.kind !== 'enum') {
      throw new Error(`Invalid discriminated union discriminator "${discriminator}"`);
    }
    for (const value of fieldDef.values ?? []) {
      if (map.has(value)) {
        throw new Error(`Duplicate discriminator value "${String(value)}"`);
      }
      map.set(value, option);
    }
  }
  return map;
}

/** An optional wrapper. */
export class OptionalSchema<I extends AnySchema> extends BaseSchema<I['__out'] | undefined> {
  /** Create an optional wrapper. */
  constructor(def: Def = { kind: 'optional', innerType: undefined as unknown as AnySchema }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  override get optin(): 'optional' | 'defaulted' {
    const inner = (this.def as { innerType: AnySchema }).innerType;
    return inner.optin === 'defaulted' ? 'defaulted' : 'optional';
  }

  override get optout(): 'optional' {
    return 'optional';
  }

  protected _parse(payload: Payload): void {
    const inner = (this.def as { innerType: AnySchema }).innerType;
    if (payload.value === undefined) {
      if (inner.optin !== 'defaulted') {
        payload.value = undefined;
        return;
      }
      const child: Payload = { value: undefined, issues: [] };
      inner._run(child);
      payload.value = child.issues.length > 0 ? undefined : child.value;
      return;
    }
    inner._run(payload);
  }
}

/** A nullable wrapper. */
export class NullableSchema<I extends AnySchema> extends BaseSchema<I['__out'] | null> {
  /** Create a nullable wrapper. */
  constructor(def: Def = { kind: 'nullable', innerType: undefined as unknown as AnySchema }, checks: readonly CheckDef[] = []) {
    super(def, checks);
  }

  override get optin(): 'optional' | 'defaulted' | undefined {
    return (this.def as { innerType: AnySchema }).innerType.optin;
  }

  override get optout(): 'optional' | undefined {
    return (this.def as { innerType: AnySchema }).innerType.optout;
  }

  protected _parse(payload: Payload): void {
    if (payload.value === null) return;
    (this.def as { innerType: AnySchema }).innerType._run(payload);
  }
}

/** A default wrapper. */
export class DefaultSchema<I extends AnySchema> extends BaseSchema<I['__out']> {
  /** Create a default wrapper. */
  constructor(
    def: Def = { kind: 'default', innerType: undefined as unknown as AnySchema, defaultValue: undefined },
    checks: readonly CheckDef[] = [],
  ) {
    super(def, checks);
  }

  override get optin(): 'defaulted' {
    return 'defaulted';
  }

  protected _parse(payload: Payload): void {
    const { innerType, defaultValue } = this.def as { innerType: AnySchema; defaultValue: unknown };
    const resolve = (): unknown => (typeof defaultValue === 'function' ? (defaultValue as () => unknown)() : defaultValue);
    if (payload.value === undefined) {
      payload.value = resolve();
      return;
    }
    innerType._run(payload);
    if (payload.value === undefined) payload.value = resolve();
  }
}

/** Resolve a schema's `undefined` behaviour for JSON Schema `required` lists (input direction). */
function inputOptin(schema: AnySchema): 'optional' | 'defaulted' | undefined {
  return schema.optin;
}

/** Whether a field is required in the output JSON Schema shape (Zod `optout` rule). */
function outputRequired(schema: AnySchema): boolean {
  return schema.optout === undefined;
}

/** Aggregate the JSON Schema constraints a schema's checks describe. */
interface JsonAggregate {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  isInt?: boolean;
  format?: string;
  pattern?: string;
}

function aggregateChecks(schema: BaseSchema<unknown, unknown>): JsonAggregate {
  const agg: JsonAggregate = {};
  const narrowMin = (value: number): void => {
    if (agg.minimum === undefined || value > agg.minimum) agg.minimum = value;
  };
  const narrowMax = (value: number): void => {
    if (agg.maximum === undefined || value < agg.maximum) agg.maximum = value;
  };
  for (const check of schema.checks) {
    switch (check.kind) {
      case 'minLength':
        narrowMin(check.value);
        break;
      case 'maxLength':
        narrowMax(check.value);
        break;
      case 'length':
        narrowMin(check.value);
        narrowMax(check.value);
        break;
      case 'gt':
        if (agg.exclusiveMinimum === undefined || check.value > agg.exclusiveMinimum) agg.exclusiveMinimum = check.value;
        break;
      case 'gte':
        narrowMin(check.value);
        break;
      case 'lt':
        if (agg.exclusiveMaximum === undefined || check.value < agg.exclusiveMaximum) agg.exclusiveMaximum = check.value;
        break;
      case 'lte':
        narrowMax(check.value);
        break;
      case 'int':
        agg.isInt = true;
        narrowMin(NUMBER_MIN_SAFE);
        narrowMax(NUMBER_MAX_SAFE);
        break;
      case 'regex':
        agg.pattern = check.pattern.source;
        break;
      case 'datetime':
        agg.format = 'date-time';
        agg.pattern = DATETIME_SOURCE;
        break;
      default:
        break;
    }
  }
  return agg;
}

/** Fold `anyOf` of bare type assertions into a `type` array, as Zod does. */
function compactTypeUnion(json: Record<string, unknown>): void {
  const options = json.anyOf;
  if (!Array.isArray(options) || options.length === 0 || json.type !== undefined) return;
  const types: string[] = [];
  for (const option of options as Array<Record<string, unknown>>) {
    if (option === null || typeof option !== 'object') return;
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== 'type') return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== 'string') return;
      if (!types.includes(member)) types.push(member);
    }
  }
  delete json.anyOf;
  json.type = types.length === 1 ? types[0] : types;
}

/** Emit the JSON Schema body for one schema. */
function jsonSchemaOfOne(schema: AnySchema, io: 'input' | 'output' = 'input'): Record<string, unknown> {
  const def = schema.def;
  switch (def.kind) {
    case 'string': {
      const json: Record<string, unknown> = { type: 'string' };
      const agg = aggregateChecks(schema);
      if (agg.minimum !== undefined) json.minLength = agg.minimum;
      if (agg.maximum !== undefined) json.maxLength = agg.maximum;
      if (agg.format !== undefined) json.format = agg.format;
      if (agg.pattern !== undefined) json.pattern = agg.pattern;
      return json;
    }
    case 'number': {
      const agg = aggregateChecks(schema);
      const json: Record<string, unknown> = { type: agg.isInt ? 'integer' : 'number' };
      const useExclusiveMin =
        agg.exclusiveMinimum !== undefined && agg.exclusiveMinimum >= (agg.minimum ?? Number.NEGATIVE_INFINITY);
      const useExclusiveMax =
        agg.exclusiveMaximum !== undefined && agg.exclusiveMaximum <= (agg.maximum ?? Number.POSITIVE_INFINITY);
      if (useExclusiveMin) json.exclusiveMinimum = agg.exclusiveMinimum;
      else if (agg.minimum !== undefined) json.minimum = agg.minimum;
      if (useExclusiveMax) json.exclusiveMaximum = agg.exclusiveMaximum;
      else if (agg.maximum !== undefined) json.maximum = agg.maximum;
      return json;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'unknown':
      return {};
    case 'literal': {
      const values = def.values;
      if (values.length === 0) return { not: {} };
      if (values.length === 1) {
        const value = values[0];
        return { type: value === null ? 'null' : typeof value, const: value };
      }
      return { enum: [...values] };
    }
    case 'enum': {
      if (def.values.length === 0) return { not: {} };
      return { type: 'string', enum: [...def.values] };
    }
    case 'array': {
      const json: Record<string, unknown> = {};
      const agg = aggregateChecks(schema);
      if (agg.minimum !== undefined) json.minItems = agg.minimum;
      if (agg.maximum !== undefined) json.maxItems = agg.maximum;
      json.type = 'array';
      json.items = jsonSchemaOfOne(def.element, io);
      return json;
    }
    case 'tuple': {
      const prefixItems = def.items.map((item) => jsonSchemaOfOne(item, io));
      const json: Record<string, unknown> = { type: 'array', prefixItems, items: false };
      const minItems = def.items.length;
      if (minItems > 0) json.minItems = minItems;
      json.maxItems = def.items.length;
      const agg = aggregateChecks(schema);
      if (agg.minimum !== undefined) json.minItems = agg.minimum;
      if (agg.maximum !== undefined) json.maxItems = agg.maximum;
      return json;
    }
    case 'object': {
      const json: Record<string, unknown> = { type: 'object', properties: {} };
      const properties = json.properties as Record<string, unknown>;
      const required: string[] = [];
      for (const key of Object.keys(def.shape)) {
        properties[key] = jsonSchemaOfOne(def.shape[key]!, io);
        const isRequired = io === 'output' ? outputRequired(def.shape[key]!) : inputOptin(def.shape[key]!) === undefined;
        if (isRequired) required.push(key);
      }
      if (required.length > 0) json.required = required;
      if (def.mode === 'strict') json.additionalProperties = false;
      else if (def.mode === 'passthrough') json.additionalProperties = {};
      else if (io === 'output') json.additionalProperties = false;
      return json;
    }
    case 'record': {
      const json: Record<string, unknown> = { type: 'object' };
      json.propertyNames = jsonSchemaOfOne(def.keyType, io);
      json.additionalProperties = jsonSchemaOfOne(def.valueType, io);
      return json;
    }
    case 'union': {
      const json: Record<string, unknown> = { anyOf: def.options.map((option) => jsonSchemaOfOne(option, io)) };
      compactTypeUnion(json);
      return json;
    }
    case 'discriminatedUnion':
      return { oneOf: def.options.map((option) => jsonSchemaOfOne(option, io)) };
    case 'optional':
      return jsonSchemaOfOne(def.innerType, io);
    case 'nullable': {
      const json: Record<string, unknown> = { anyOf: [jsonSchemaOfOne(def.innerType, io), { type: 'null' }] };
      compactTypeUnion(json);
      return json;
    }
    case 'default': {
      const serialized = JSON.stringify(typeof def.defaultValue === 'function' ? undefined : def.defaultValue);
      const value = serialized === undefined ? null : (JSON.parse(serialized) as unknown);
      // Zod writes `default` ahead of the inner keywords.
      return { default: value, ...jsonSchemaOfOne(def.innerType, io) };
    }
    default:
      return {};
  }
}

/** Convert one schema to a JSON Schema document, as `z.toJSONSchema` does. */
function toJsonSchema(schema: AnySchema, io: 'input' | 'output' = 'input'): Record<string, unknown> {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...jsonSchemaOfOne(schema, io) };
}

/** Options of {@link z.toJSONSchema}. */
export interface ToJSONSchemaParams {
  /** Direction of the emitted schema. Only `input` is used by MemoryJS. */
  io?: 'input' | 'output';
  /** What to do with values JSON Schema cannot express. Only `any` is used. */
  unrepresentable?: 'any' | 'throw';
}

/** Builders, mirroring the `zod` namespace. */
export const z = {
  string: (): StringSchema => new StringSchema(),
  number: (): NumberSchema => new NumberSchema(),
  boolean: (): BooleanSchema => new BooleanSchema(),
  null: (): NullSchema => new NullSchema(),
  unknown: (): UnknownSchema => new UnknownSchema(),
  literal: <V extends string | number | boolean | null>(value: V): LiteralSchema<V> =>
    new LiteralSchema<V>({ kind: 'literal', values: [value] }),
  enum: <const V extends readonly [string, ...string[]]>(values: V): EnumSchema<V> =>
    new EnumSchema<V>({ kind: 'enum', values }),
  array: <E extends AnySchema>(element: E): ArraySchema<E> => new ArraySchema<E>({ kind: 'array', element }),
  tuple: <T extends readonly AnySchema[]>(items: [...T]): TupleSchema<T> => new TupleSchema<T>({ kind: 'tuple', items }),
  object: <S extends SchemaShape>(shape: S): ObjectSchema<S> => new ObjectSchema<S>({ kind: 'object', shape, mode: 'strip' }),
  record: <V extends AnySchema>(keyType: AnySchema, valueType: V): RecordSchema<V> =>
    new RecordSchema<V>({ kind: 'record', keyType, valueType }),
  union: <O extends readonly AnySchema[]>(options: [...O]): UnionSchema<O> => new UnionSchema<O>({ kind: 'union', options }),
  discriminatedUnion: <O extends readonly AnySchema[]>(discriminator: string, options: [...O]): DiscriminatedUnionSchema<O> =>
    new DiscriminatedUnionSchema<O>({ kind: 'discriminatedUnion', discriminator, options }),
  iso: {
    datetime: (params?: MessageParams): StringSchema => new StringSchema().datetime(params),
  },
  toJSONSchema: (schema: AnySchema, params?: ToJSONSchemaParams): Record<string, unknown> => {
    const io = params?.io ?? 'input';
    return toJsonSchema(schema, io);
  },
};

/* eslint-disable @typescript-eslint/no-namespace -- mirrors Zod's `z` namespace */
export namespace z {
  /** Output type of a schema, as `z.infer` in Zod. */
  export type infer<S> = S extends { readonly __out: infer O } ? O : never;
  /** Output type of a schema, as `z.output` in Zod. */
  export type output<S> = S extends { readonly __out: infer O } ? O : never;
  /** Input type of a schema, as `z.input` in Zod. */
  export type input<S> = S extends { readonly __in: infer I } ? I : never;
  /** Any schema with a fixed output type. */
  export type ZodType<Out = unknown, In = unknown> = BaseSchema<Out, In>;
  /** Zod's `ZodSchema` alias. */
  export type ZodSchema<Out = unknown, In = unknown> = BaseSchema<Out, In>;
  /** Validation error type. */
  export type ZodError<T = unknown> = ZodErrorBase<T>;
  /** One validation issue. */
  export type ZodIssue = SchemaIssue;
}
/* eslint-enable @typescript-eslint/no-namespace */
