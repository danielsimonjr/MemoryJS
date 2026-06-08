import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ContextWindowManager.wakeUp', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'proj-alpha', entityType: 'project', observations: ['Uses React', 'Deployed on AWS'], importance: 8 },
      { name: 'proj-beta', entityType: 'project', observations: ['Uses Vue'], importance: 5 },
    ]);
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Senior developer', 'static');
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns L0 with profile static facts', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l0).toContain('Senior developer');
    expect(result.l0).toContain('Prefers TypeScript');
  });

  it('returns L1 with top entities by importance', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l1).toBeTruthy();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('respects maxL0Tokens budget', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp({ maxL0Tokens: 10 });
    expect(result.totalTokens).toBeLessThan(100);
  });

  it('returns empty L0 when no profile exists', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu2-'));
    const ctx2 = new ManagerContext(path.join(tmpDir2, 'memory.jsonl'));
    const amm2 = ctx2.agentMemory();
    const result = await amm2.contextWindowManager.wakeUp();
    expect(result.l0).toBe('');
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
