import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager exposes ProfileManager', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-amm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('profileManager getter returns a ProfileManager instance', () => {
    const amm = ctx.agentMemory();
    expect(amm.profileManager).toBeDefined();
    expect(typeof amm.profileManager.getProfile).toBe('function');
  });

  it('getProfile works via facade', async () => {
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
    const profile = await amm.profileManager.getProfile();
    expect(profile.static).toContain('Prefers TypeScript');
  });
});
