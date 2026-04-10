import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('IOManager.visualizeGraph', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-viz-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Developer'], importance: 8 },
      { name: 'orion', entityType: 'project', observations: ['React app'], importance: 6 },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'alice', to: 'orion', relationType: 'works_on' },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns valid HTML with D3 visualization', async () => {
    const html = await ctx.ioManager.visualizeGraph();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('d3.v7.min.js');
    expect(html).toContain('alice');
    expect(html).toContain('orion');
    expect(html).toContain('works_on');
  });

  it('writes to file when outputPath specified', async () => {
    const outPath = path.join(tmpDir, 'graph.html');
    await ctx.ioManager.visualizeGraph({ outputPath: outPath });
    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
  });

  it('respects maxEntities limit', async () => {
    const html = await ctx.ioManager.visualizeGraph({ maxEntities: 1 });
    // Should only include the highest-importance entity
    expect(html).toContain('alice'); // importance 8
  });

  it('handles empty graph', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-viz-empty-'));
    const ctx2 = new ManagerContext(path.join(tmpDir2, 'memory.jsonl'));
    const html = await ctx2.ioManager.visualizeGraph();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('nodes = []');
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
