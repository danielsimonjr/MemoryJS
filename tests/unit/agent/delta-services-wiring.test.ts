import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { MemoryValidator } from '../../../src/agent/MemoryValidator.js';
import { TrajectoryCompressor } from '../../../src/agent/TrajectoryCompressor.js';
import { ExperienceExtractor } from '../../../src/agent/ExperienceExtractor.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ManagerContext Phase δ services wiring', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(os.tmpdir(), `delta-wire-${Date.now()}-${Math.random()}.jsonl`);
  });
  afterEach(() => {
    if (existsSync(file)) {
      try { rmSync(file, { force: true }); } catch { /* lock */ }
    }
  });

  it('memoryValidator accessor returns a MemoryValidator instance', () => {
    const ctx = new ManagerContext(file);
    expect(ctx.memoryValidator).toBeInstanceOf(MemoryValidator);
  });

  it('trajectoryCompressor accessor returns a TrajectoryCompressor instance', () => {
    const ctx = new ManagerContext(file);
    expect(ctx.trajectoryCompressor).toBeInstanceOf(TrajectoryCompressor);
  });

  it('experienceExtractor accessor returns an ExperienceExtractor instance', () => {
    const ctx = new ManagerContext(file);
    expect(ctx.experienceExtractor).toBeInstanceOf(ExperienceExtractor);
  });

  it('all three δ accessors are cached on repeat access', () => {
    const ctx = new ManagerContext(file);
    expect(ctx.memoryValidator).toBe(ctx.memoryValidator);
    expect(ctx.trajectoryCompressor).toBe(ctx.trajectoryCompressor);
    expect(ctx.experienceExtractor).toBe(ctx.experienceExtractor);
  });

  it('memoryValidator works end-to-end on a small entity (no semantic-search backend)', async () => {
    const ctx = new ManagerContext(file);
    const validator = ctx.memoryValidator;
    // Even without a semantic-search backend configured, the validator's
    // other methods still operate (detection silently returns nothing).
    const reliability = validator.calculateReliability({
      name: 'test',
      entityType: 'memory_turn',
      observations: ['hello'],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(typeof reliability).toBe('number');
    expect(reliability).toBeGreaterThanOrEqual(0);
    expect(reliability).toBeLessThanOrEqual(1);
  });
});
