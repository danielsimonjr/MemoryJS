import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ValidationError } from '../../../src/utils/errors.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager reserves profile-* namespace', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pn-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when user creates non-profile entity with profile-* name', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-myproject', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow(ValidationError);
  });

  it('allows entities with entityType=profile in the reserved namespace', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-global', entityType: 'profile', observations: [] },
      ])
    ).resolves.toBeDefined();
  });

  it('allows non-matching names', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'alice', entityType: 'person', observations: [] },
      ])
    ).resolves.toBeDefined();
  });
});
