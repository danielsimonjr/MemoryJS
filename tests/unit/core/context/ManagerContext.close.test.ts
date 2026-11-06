/**
 * ManagerContext.close() — proves the procedural-graph managers created with an
 * owned backing are disposed exactly once, and that a rejecting dispose is
 * logged rather than thrown.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { logger } from '../../../../src/utils/logger.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDirs();
});

describe('ManagerContext.close() procedural-graph disposal', () => {
  it('disposes an owned procedural graph once; a second close() does not dispose again', async () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    const manager = await ctx.createProceduralGraph({ backing: { type: 'memory' } });
    const dispose = vi.spyOn(manager, 'dispose');

    ctx.close();
    expect(dispose).toHaveBeenCalledTimes(1);

    ctx.close();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('logs a rejecting dispose instead of throwing', async () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    const manager = await ctx.createProceduralGraph({ backing: { type: 'memory' } });
    vi.spyOn(manager, 'dispose').mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(() => ctx.close()).not.toThrow();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'ProceduralGraphManager.dispose() failed during ManagerContext.close()',
        { error: 'boom' },
      );
    });
  });
});
