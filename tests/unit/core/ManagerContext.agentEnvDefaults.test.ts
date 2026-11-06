/**
 * ManagerContext.consolidationScheduler honours both enable aliases, and
 * builds at most once per process when enabled. The on/off decision is read
 * once, at first access, and cached.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ConsolidationScheduler } from '../../../src/agent/ConsolidationScheduler.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTempDirs();
});

describe('ManagerContext.consolidationScheduler env gate', () => {
  it('is undefined when neither alias is set', () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.consolidationScheduler).toBeUndefined();
  });

  it('is created when MEMORY_CONSOLIDATION_SCHEDULER_ENABLED is true', () => {
    vi.stubEnv('MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', 'true');
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.consolidationScheduler).toBeInstanceOf(ConsolidationScheduler);
    expect(ctx.consolidationScheduler).toBe(ctx.consolidationScheduler);
  });

  it('is created when the original MEMORY_AUTO_CONSOLIDATION is true', () => {
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'true');
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.consolidationScheduler).toBeInstanceOf(ConsolidationScheduler);
  });

  it('caches the off state: enabling the env after first access has no effect', () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.consolidationScheduler).toBeUndefined();
    vi.stubEnv('MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', 'true');
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'true');
    expect(ctx.consolidationScheduler).toBeUndefined();
  });

  it('caches the on state: disabling the env after first access keeps the scheduler', () => {
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'true');
    const ctx = new ManagerContext(makeTempJsonlPath());
    const first = ctx.consolidationScheduler;
    expect(first).toBeInstanceOf(ConsolidationScheduler);
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'false');
    expect(ctx.consolidationScheduler).toBe(first);
  });

  it('a false on one alias never overrides a true on the other', () => {
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'false');
    vi.stubEnv('MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', 'true');
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.consolidationScheduler).toBeInstanceOf(ConsolidationScheduler);
  });
});
