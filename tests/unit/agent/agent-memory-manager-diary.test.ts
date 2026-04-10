import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager diary', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-diary-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeDiary creates diary entity on first write', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Found auth bypass in PR#42');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('diary');
    expect(entity!.importance).toBe(8);
  });

  it('writeDiary appends timestamped observations', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Entry one');
    await amm.writeDiary('reviewer', 'Entry two');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity!.observations).toHaveLength(2);
    expect(entity!.observations[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });

  it('readDiary returns entries in reverse chronological order', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'First');
    await amm.writeDiary('reviewer', 'Second');
    const entries = await amm.readDiary('reviewer');
    expect(entries[0]).toContain('Second');
    expect(entries[1]).toContain('First');
  });

  it('readDiary filters by topic', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Auth issue', { topic: 'security' });
    await amm.writeDiary('reviewer', 'Style issue', { topic: 'style' });
    const security = await amm.readDiary('reviewer', { topic: 'security' });
    expect(security).toHaveLength(1);
    expect(security[0]).toContain('Auth issue');
  });

  it('readDiary returns empty for nonexistent agent', async () => {
    const amm = ctx.agentMemory();
    const entries = await amm.readDiary('nonexistent');
    expect(entries).toEqual([]);
  });

  it('diary-* namespace is reserved for non-diary entities', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'diary-test', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow();
  });
});
