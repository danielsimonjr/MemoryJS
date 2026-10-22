/**
 * Default wiring of hybrid ranking into the context window manager.
 *
 * MEMORY_CONTEXT_HYBRID_RANKING is opt-in (default off). When it is true,
 * ctx.contextWindowManager ranks retrieval candidates through
 * ctx.hybridSearchManager. When it is off, the hybrid manager is never built.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ManagerContext hybrid ranking wiring (MEMORY_CONTEXT_HYBRID_RANKING)', () => {
  let testDir: string;
  let ctx: ManagerContext;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    testDir = join(tmpdir(), `kgm-hybrid-ctx-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    delete process.env.MEMORY_CONTEXT_HYBRID_RANKING;
    ctx = new ManagerContext(join(testDir, 'memory.jsonl'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('does not touch hybridSearchManager when the switch is unset', async () => {
    const getter = vi.spyOn(ManagerContext.prototype, 'hybridSearchManager', 'get');

    const cwm = ctx.contextWindowManager;
    await cwm.retrieveForContext({ maxTokens: 1000, context: { queryText: 'deploy' } });

    expect(getter).not.toHaveBeenCalled();
  });

  it('calls hybrid search once per retrieval when the switch is true', async () => {
    process.env.MEMORY_CONTEXT_HYBRID_RANKING = 'true';
    const search = vi.spyOn(ctx.hybridSearchManager, 'search').mockResolvedValue([]);

    await ctx.contextWindowManager.retrieveForContext({
      maxTokens: 1000,
      context: { queryText: 'deploy' },
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][1]).toBe('deploy');
  });

  it('does not call hybrid search when the switch is true but there is no queryText', async () => {
    process.env.MEMORY_CONTEXT_HYBRID_RANKING = 'true';
    const search = vi.spyOn(ctx.hybridSearchManager, 'search').mockResolvedValue([]);

    await ctx.contextWindowManager.retrieveForContext({ maxTokens: 1000, context: {} });

    expect(search).not.toHaveBeenCalled();
  });

  it.each(['false', '0'])('does not call hybrid search when the switch is %s', async (value) => {
    process.env.MEMORY_CONTEXT_HYBRID_RANKING = value;
    const search = vi.spyOn(ctx.hybridSearchManager, 'search').mockResolvedValue([]);

    await ctx.contextWindowManager.retrieveForContext({
      maxTokens: 1000,
      context: { queryText: 'deploy' },
    });

    expect(search).not.toHaveBeenCalled();
  });
});
