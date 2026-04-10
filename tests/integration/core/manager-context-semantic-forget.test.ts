import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ManagerContext exposes SemanticForget', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-mcsf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('semanticForget getter returns a SemanticForget instance', () => {
    expect(ctx.semanticForget).toBeDefined();
    expect(typeof ctx.semanticForget.forgetByContent).toBe('function');
  });

  it('forgetByContent works via context', async () => {
    const result = await ctx.semanticForget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(1);
  });

  it('lazy getter returns same instance', () => {
    expect(ctx.semanticForget).toBe(ctx.semanticForget);
  });
});
