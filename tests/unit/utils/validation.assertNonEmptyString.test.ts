/**
 * assertNonEmptyString (CL-21)
 *
 * Also pins the message the two consolidation stages produce through it.
 */

import { describe, it, expect } from 'vitest';
import { assertNonEmptyString } from '../../../src/utils/validation.js';
import { ReflectionStage, HeuristicExtractionStage } from '../../../src/agent/ConsolidationPipeline.js';

describe('assertNonEmptyString', () => {
  it('accepts a string with visible content', () => {
    expect(() => assertNonEmptyString('abc', 'sessionId', 'Ctx.fn')).not.toThrow();
    expect(() => assertNonEmptyString(' x ', 'sessionId', 'Ctx.fn')).not.toThrow();
  });

  it('rejects the empty string with the quoted value in the message', () => {
    expect(() => assertNonEmptyString('', 'failureId', 'Ctx.fn')).toThrow(
      new Error("Ctx.fn: failureId must be a non-empty string; received ''"),
    );
  });

  it('rejects whitespace-only strings, quoting the raw value', () => {
    expect(() => assertNonEmptyString('  \t', 'sessionId', 'Ctx.fn')).toThrow(
      new Error("Ctx.fn: sessionId must be a non-empty string; received '  \t'"),
    );
  });

  it.each([
    [undefined, 'undefined'],
    [null, 'object'],
    [42, 'number'],
    [true, 'boolean'],
    [{}, 'object'],
    [['a'], 'object'],
  ])('reports typeof for non-string %p', (value, typeName) => {
    expect(() => assertNonEmptyString(value, 'id', 'Ctx.fn')).toThrow(
      new Error(`Ctx.fn: id must be a non-empty string; received ${typeName}`),
    );
  });

  it('throws a plain Error instance', () => {
    try {
      assertNonEmptyString(undefined, 'id', 'Ctx.fn');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('Error');
    }
  });
});

describe('stage guards keep their message through assertNonEmptyString', () => {
  // The guards run before any dependency is touched, so inert stubs suffice.
  const stub = {} as never;

  it('ReflectionStage.runOnSessionEnd', async () => {
    const stage = new ReflectionStage(stub, stub, stub, stub);
    await expect(stage.runOnSessionEnd('   ')).rejects.toThrow(
      new Error("ReflectionStage.runOnSessionEnd: sessionId must be a non-empty string; received '   '"),
    );
    await expect(stage.runOnSessionEnd(7 as unknown as string)).rejects.toThrow(
      new Error('ReflectionStage.runOnSessionEnd: sessionId must be a non-empty string; received number'),
    );
  });

  it('HeuristicExtractionStage.runOnResolution', async () => {
    const stage = new HeuristicExtractionStage(stub, stub);
    await expect(stage.runOnResolution('')).rejects.toThrow(
      new Error("HeuristicExtractionStage.runOnResolution: failureId must be a non-empty string; received ''"),
    );
  });
});
