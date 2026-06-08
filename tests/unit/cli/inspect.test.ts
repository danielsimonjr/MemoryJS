/**
 * Inspection CLI command tests.
 *
 * Covers `memory show`, `memory tree` (JSON + --ascii), `memory neighbors`,
 * `memory size` against a seeded multi-entity graph with a parent/child
 * hierarchy and a couple of relations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { registerInspectCommands } from '../../../src/cli/commands/inspect.js';

describe('inspect CLI commands', () => {
  let testDir: string;
  let storagePath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `inspect-cli-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storagePath = join(testDir, 'graph.jsonl');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const ctx = new ManagerContext(storagePath);
    await ctx.entityManager.createEntities([
      { name: 'Root', entityType: 'service', observations: ['root note'], tags: ['core'], importance: 8 },
      { name: 'Child1', entityType: 'service', observations: ['c1 note'] },
      { name: 'Child2', entityType: 'service', observations: ['c2 note'] },
      { name: 'Grandkid', entityType: 'service', observations: [] },
      { name: 'Unrelated', entityType: 'doc', observations: ['standalone'] },
    ]);
    await ctx.hierarchyManager.setEntityParent('Child1', 'Root');
    await ctx.hierarchyManager.setEntityParent('Child2', 'Root');
    await ctx.hierarchyManager.setEntityParent('Grandkid', 'Child1');
    await ctx.relationManager.createRelations([
      { from: 'Root', to: 'Unrelated', relationType: 'references' },
    ]);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('-s, --storage <path>', 'Storage path');
    registerInspectCommands(program);
    return program;
  }

  function lastJson(): unknown {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    const lastBlock = calls[calls.length - 1];
    return JSON.parse(lastBlock);
  }

  describe('show', () => {
    it('returns observations + outgoing relations + children + tags + importance', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'show', 'Root']);
      const snap = lastJson() as {
        name: string;
        observations: string[];
        tags?: string[];
        importance?: number;
        children: string[];
        ancestors: string[];
        relations: { outgoing: Array<{ to: string }>; incoming: Array<{ from: string }> };
      };
      expect(snap.name).toBe('Root');
      expect(snap.observations).toContain('root note');
      expect(snap.tags).toContain('core');
      expect(snap.importance).toBe(8);
      expect(snap.children.sort()).toEqual(['Child1', 'Child2']);
      expect(snap.ancestors).toEqual([]);
      expect(snap.relations.outgoing.some((r) => r.to === 'Unrelated')).toBe(true);
    });

    it('returns ancestors for a deep node', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'show', 'Grandkid']);
      const snap = lastJson() as { ancestors: string[] };
      expect(snap.ancestors).toContain('Child1');
      expect(snap.ancestors).toContain('Root');
    });

    it('exits non-zero for unknown entity', async () => {
      const program = makeProgram();
      let threw = false;
      try {
        await program.parseAsync(['node', 'memory', '--storage', storagePath, 'show', 'NoSuch']);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('tree', () => {
    it('JSON form returns nested children for an explicit root', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'tree', 'Root']);
      const trees = lastJson() as Array<{ name: string; children: Array<{ name: string; children: unknown[] }> }>;
      expect(trees).toHaveLength(1);
      expect(trees[0].name).toBe('Root');
      expect(trees[0].children.map((c) => c.name).sort()).toEqual(['Child1', 'Child2']);
      const child1 = trees[0].children.find((c) => c.name === 'Child1');
      expect(child1?.children).toHaveLength(1);
    });

    it('--ascii renders indented tree with branch markers', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'tree', 'Root', '--ascii']);
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toMatch(/Root \(service\)/);
      expect(written).toMatch(/[├└]── Child[12]/);
      expect(written).toMatch(/[├└]── Grandkid/);
    });
  });

  describe('neighbors', () => {
    it('reports outgoing relations + degree counts', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'neighbors', 'Root']);
      const r = lastJson() as { outDegree: number; inDegree: number; outgoing: Array<{ to: string }> };
      expect(r.outDegree).toBe(1);
      expect(r.inDegree).toBe(0);
      expect(r.outgoing[0].to).toBe('Unrelated');
    });

    it('reports incoming relations for the target', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'neighbors', 'Unrelated']);
      const r = lastJson() as { inDegree: number; incoming: Array<{ from: string }> };
      expect(r.inDegree).toBe(1);
      expect(r.incoming[0].from).toBe('Root');
    });
  });

  describe('size', () => {
    it('reports entity/relation/observation counts + storage bytes + line count', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'memory', '--storage', storagePath, 'size']);
      const r = lastJson() as {
        graph: { entities: number; relations: number; observations: number; distinctTags: number };
        storage: { exists: boolean; sizeBytes: number; lineCount: number };
      };
      expect(r.graph.entities).toBe(5);
      expect(r.graph.relations).toBe(1);
      expect(r.graph.observations).toBeGreaterThanOrEqual(4);
      expect(r.graph.distinctTags).toBeGreaterThanOrEqual(1);
      expect(r.storage.exists).toBe(true);
      expect(r.storage.sizeBytes).toBeGreaterThan(0);
      expect(r.storage.lineCount).toBeGreaterThan(0);
    });
  });
});
