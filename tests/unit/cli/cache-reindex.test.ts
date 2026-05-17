/**
 * cache + reindex CLI command tests.
 *
 * Verifies the JSON-shape contracts of `memory cache stats|clear|cleanup`
 * and `memory reindex` (full / --ranked / --spell). Reindex runs against a
 * seeded graph so the spell vocabulary actually has something to rebuild
 * against.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerCacheCommands } from '../../../src/cli/commands/cache.js';
import { registerReindexCommand } from '../../../src/cli/commands/reindex.js';

describe('cache + reindex CLI commands', () => {
  let testDir: string;
  let storagePath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cache-reindex-cli-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storagePath = join(testDir, 'graph.jsonl');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('-s, --storage <path>', 'Storage path');
    registerCacheCommands(program);
    registerReindexCommand(program);
    return program;
  }

  function lastJson<T = unknown>(): T {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    return JSON.parse(calls[calls.length - 1]) as T;
  }

  describe('cache', () => {
    it('stats returns the four-tier shape', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'cache', 'stats']);
      const out = lastJson<{ stats: Record<string, { hits: number; misses: number; size: number; hitRate: number }> }>();
      expect(Object.keys(out.stats).sort()).toEqual(['basic', 'boolean', 'fuzzy', 'ranked']);
      for (const tier of Object.values(out.stats)) {
        expect(typeof tier.hits).toBe('number');
        expect(typeof tier.misses).toBe('number');
        expect(typeof tier.size).toBe('number');
        expect(typeof tier.hitRate).toBe('number');
      }
    });

    it('clear reports cleared=true', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'cache', 'clear']);
      const out = lastJson<{ cleared: boolean; caches: string[] }>();
      expect(out.cleared).toBe(true);
      expect(out.caches).toContain('ranked');
    });

    it('cleanup reports cleaned=true', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'cache', 'cleanup']);
      const out = lastJson<{ cleaned: boolean }>();
      expect(out.cleaned).toBe(true);
    });
  });

  describe('reindex', () => {
    beforeEach(async () => {
      const ctx = new ManagerContext(storagePath);
      await ctx.entityManager.createEntities([
        { name: 'Authentication', entityType: 'concept', observations: ['handles user login'] },
        { name: 'Authorization', entityType: 'concept', observations: ['controls access permissions'] },
      ]);
    });

    it('rebuilds both ranked and spell by default', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'reindex']);
      const out = lastJson<{
        ok: boolean;
        failed: number;
        result: Record<string, { ok: boolean; durationMs: number }>;
      }>();
      expect(out.ok).toBe(true);
      expect(out.failed).toBe(0);
      expect(out.result.ranked.ok).toBe(true);
      expect(out.result.spell.ok).toBe(true);
      expect(out.result.ranked.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('--ranked rebuilds only ranked', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'reindex', '--ranked']);
      const out = lastJson<{ result: Record<string, unknown> }>();
      expect(out.result.ranked).toBeDefined();
      expect(out.result.spell).toBeUndefined();
    });

    it('--spell rebuilds only spell', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'reindex', '--spell']);
      const out = lastJson<{ result: Record<string, unknown> }>();
      expect(out.result.spell).toBeDefined();
      expect(out.result.ranked).toBeUndefined();
    });
  });
});
