/**
 * ManagerContext numeric environment-variable validation.
 *
 * An operator's malformed value must not become a silent, out-of-contract
 * runtime setting. Each case falls back to the documented default.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** Reads the private numeric parser under test. */
function readEnvNumber(ctx: ManagerContext, key: string, fallback: number, opts?: unknown): number {
  const parse = (ctx as unknown as {
    getEnvNumber(k: string, d: number, o?: unknown): number;
  }).getEnvNumber.bind(ctx);
  return parse(key, fallback, opts);
}

describe('ManagerContext.getEnvNumber validation', () => {
  let ctx: ManagerContext;
  let testDir: string;
  const KEY = 'MEMORY_TEST_ENV_NUMBER';

  beforeEach(async () => {
    testDir = join(tmpdir(), `env-number-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    ctx = new ManagerContext(join(testDir, 'graph.jsonl'));
  });

  afterEach(async () => {
    delete process.env[KEY];
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('accepts a well-formed value', () => {
    process.env[KEY] = '0.75';
    expect(readEnvNumber(ctx, KEY, 0.5)).toBe(0.75);
  });

  it('rejects a numeric prefix followed by text', () => {
    process.env[KEY] = '10abc';
    expect(readEnvNumber(ctx, KEY, 0.5)).toBe(0.5);
  });

  it('rejects Infinity', () => {
    process.env[KEY] = 'Infinity';
    expect(readEnvNumber(ctx, KEY, 0.5)).toBe(0.5);
  });

  it('rejects an empty or whitespace-only value', () => {
    process.env[KEY] = '   ';
    expect(readEnvNumber(ctx, KEY, 0.5)).toBe(0.5);
  });

  it('rejects a value below the declared minimum', () => {
    process.env[KEY] = '-1';
    expect(readEnvNumber(ctx, KEY, 0.5, { min: 0, max: 1 })).toBe(0.5);
  });

  it('rejects a value above the declared maximum', () => {
    process.env[KEY] = '5';
    expect(readEnvNumber(ctx, KEY, 0.5, { min: 0, max: 1 })).toBe(0.5);
  });

  it('rejects a non-integer for an integer setting', () => {
    process.env[KEY] = '200.5';
    expect(readEnvNumber(ctx, KEY, 200, { integer: true, min: 1 })).toBe(200);
  });

  it('applies the documented probability range to a real knob', () => {
    process.env.MEMORY_ENGINE_JACCARD_THRESHOLD = '5';
    const engine = ctx.memoryEngine;
    expect((engine as unknown as { cfg: { jaccardThreshold: number } })
      .cfg.jaccardThreshold).toBe(0.72);
    delete process.env.MEMORY_ENGINE_JACCARD_THRESHOLD;
  });
});
