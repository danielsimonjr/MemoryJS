import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ManagerContext defaultProjectId option', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-mc-test-'));
    storagePath = path.join(tmpDir, 'memory.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts string path (legacy)', () => {
    const ctx = new ManagerContext(storagePath);
    expect(ctx.defaultProjectId).toBeUndefined();
  });

  it('accepts options object with defaultProjectId', () => {
    const ctx = new ManagerContext({
      storagePath,
      defaultProjectId: 'my-project',
    });
    expect(ctx.defaultProjectId).toBe('my-project');
  });
});
