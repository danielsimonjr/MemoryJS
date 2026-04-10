import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager basics', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      undefined,
      undefined,
      {}
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty profile when entity does not exist', async () => {
    const result = await pm.getProfile();
    expect(result.static).toEqual([]);
    expect(result.dynamic).toEqual([]);
    expect(result.entityName).toBe('profile-global');
  });

  it('addFact creates profile entity if missing', async () => {
    await pm.addFact('Prefers TypeScript', 'static');
    const entity = await ctx.entityManager.getEntity('profile-global');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('profile');
    expect(entity!.observations).toContain('[static] Prefers TypeScript');
  });

  it('getProfile parses static/dynamic prefixes', async () => {
    await pm.addFact('Stable fact', 'static');
    await pm.addFact('Recent fact', 'dynamic');
    const result = await pm.getProfile();
    expect(result.static).toEqual(['Stable fact']);
    expect(result.dynamic).toEqual(['Recent fact']);
  });

  it('uses sanitized projectId in entity name', async () => {
    await pm.addFact('Fact', 'static', { projectId: 'My Project!' });
    const entity = await ctx.entityManager.getEntity('profile-my-project-');
    expect(entity).toBeDefined();
  });

  it('isolates profiles by project', async () => {
    await pm.addFact('Global fact', 'static');
    await pm.addFact('Project fact', 'static', { projectId: 'p1' });

    const global = await pm.getProfile();
    const scoped = await pm.getProfile({ projectId: 'p1' });

    expect(global.static).toEqual(['Global fact']);
    expect(scoped.static).toEqual(['Project fact']);
  });

  it('promoteFact moves dynamic to static', async () => {
    await pm.addFact('Growing fact', 'dynamic');
    await pm.promoteFact('Growing fact');
    const result = await pm.getProfile();
    expect(result.dynamic).not.toContain('Growing fact');
    expect(result.static).toContain('Growing fact');
  });
});
