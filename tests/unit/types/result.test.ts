/**
 * Result<T, E> — Phase 2 / API audit Theme 1.
 *
 * The discriminated-union return type for operations with *expected* domain
 * failures (per the error-handling policy in CONTRIBUTING.md: throw for
 * programmer errors, return Result for failures the caller should branch on).
 */

import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  mapOk,
  type Result,
} from '../../../src/types/result.js';

describe('Result — constructors', () => {
  it('ok() builds a success variant', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err() builds a failure variant', () => {
    const e = new Error('boom');
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it('err() accepts non-Error error values', () => {
    const r = err('not-found');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not-found');
  });
});

describe('Result — guards', () => {
  it('isOk narrows to the success variant', () => {
    const r: Result<number, string> = ok(7);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(7); // narrowed
  });

  it('isErr narrows to the failure variant', () => {
    const r: Result<number, string> = err('nope');
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) expect(r.error).toBe('nope'); // narrowed
  });
});

describe('Result — unwrap', () => {
  it('unwrap returns the value on success', () => {
    expect(unwrap(ok('hello'))).toBe('hello');
  });

  it('unwrap throws the error on failure', () => {
    const e = new Error('exploded');
    expect(() => unwrap(err(e))).toThrow(e);
  });

  it('unwrap wraps a non-Error error in an Error before throwing', () => {
    expect(() => unwrap(err('plain-string'))).toThrow('plain-string');
  });

  it('unwrapOr returns the value on success, fallback on failure', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err('x') as Result<number, string>, 99)).toBe(99);
  });
});

describe('Result — mapOk', () => {
  it('maps the success value', () => {
    const r = mapOk(ok(3), (n) => n * 2);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(6);
  });

  it('passes errors through unchanged', () => {
    const r = mapOk(err('bad') as Result<number, string>, (n) => n * 2);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toBe('bad');
  });
});
