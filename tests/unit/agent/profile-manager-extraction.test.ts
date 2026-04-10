import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import type { SessionManager } from '../../../src/agent/SessionManager.js';
import type { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager.extractFromSession', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pme-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies high-importance low-recency facts as static', async () => {
    const mockSession = {
      getActiveSession: vi.fn(async () => ({
        name: 'sess-1',
        entityType: 'session',
        status: 'active',
        startedAt: new Date().toISOString(),
        observations: ['User prefers TypeScript', 'Currently debugging auth'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async (obs: string) => {
        if (obs === 'User prefers TypeScript') {
          return { components: { baseImportance: 0.8, recencyBoost: 0.1 } };
        }
        return { components: { baseImportance: 0.3, recencyBoost: 0.7 } };
      }),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience,
      { staticThreshold: 0.6, dynamicRecencyThreshold: 0.5 }
    );

    await pm.extractFromSession('sess-1');
    const profile = await pm.getProfile();
    expect(profile.static).toContain('User prefers TypeScript');
    expect(profile.dynamic).toContain('Currently debugging auth');
  });

  it('dedupes against existing profile facts', async () => {
    const mockSession = {
      getActiveSession: vi.fn(async () => ({
        name: 'sess-1',
        entityType: 'session',
        status: 'active',
        startedAt: new Date().toISOString(),
        observations: ['Fact A'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async () => ({
        components: { baseImportance: 0.8, recencyBoost: 0.1 },
      })),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience
    );

    await pm.addFact('Fact A', 'static');
    await pm.extractFromSession('sess-1');

    const profile = await pm.getProfile();
    expect(profile.static.filter(f => f === 'Fact A')).toHaveLength(1);
  });
});
