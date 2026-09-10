/**
 * ManagerContext.createProceduralGraph factory and disposal tests.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { InMemoryProceduralGraphBacking } from '../../../src/agent/procedural/graph/backing/InMemoryProceduralGraphBacking.js';
import type { PGEdge, PGNode } from '../../../src/types/proceduralGraph.js';

function nodes(): PGNode[] {
  return [
    { id: 'Start', type: 'STATE', description: 'Start' },
    { id: 'End', type: 'STATE', description: 'End' },
  ];
}

function edges(): PGEdge[] {
  return [
    { source: 'Start', relation: 'LEADS_TO', target: 'End', condition: null, guidance: '', pitfalls: '' },
  ];
}

describe('ManagerContext.createProceduralGraph', () => {
  const temps: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of temps) {
      rmSync(dir, { recursive: true, force: true });
    }
    temps.length = 0;
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    temps.push(dir);
    return dir;
  }

  it('createProceduralGraph with a config backing is disposed by ctx.close()', async () => {
    const close = vi.spyOn(InMemoryProceduralGraphBacking.prototype, 'close');
    const ctx = new ManagerContext(join(tempDir(), 'memory.jsonl'));
    await ctx.createProceduralGraph({ backing: { type: 'memory' } });
    ctx.close();
    await Promise.resolve();
    expect(close).toHaveBeenCalled();
  });

  it('with an injected backing it is not closed', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const close = vi.spyOn(backing, 'close');
    const ctx = new ManagerContext(join(tempDir(), 'memory.jsonl'));
    await ctx.createProceduralGraph({ backing });
    ctx.close();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
  });

  it('default sidecar path is <basename>-procedural-graph.jsonl', async () => {
    const dir = tempDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const manager = await ctx.createProceduralGraph({ backing: { type: 'jsonl' } });
    const created = await manager.createGraph({
      graphId: 'sidecar',
      nodes: nodes(),
      edges: edges(),
    });
    expect(created.ok).toBe(true);
    expect(existsSync(join(dir, 'memory-procedural-graph.jsonl'))).toBe(true);
    ctx.close();
  });
});
