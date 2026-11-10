import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('scripts/clean-dist.mjs', () => {
  it('removes dist and succeeds when dist is already gone', async () => {
    const root = join(tmpdir(), `memoryjs-clean-${Date.now()}`);
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'nested'), { recursive: true });
    await writeFile(join(dist, 'nested', 'index.js'), 'x');
    const script = join(process.cwd(), 'scripts/clean-dist.mjs');
    await execFileAsync(process.execPath, [script], { cwd: root });
    await expect(access(dist)).rejects.toMatchObject({ code: 'ENOENT' });
    await execFileAsync(process.execPath, [script], { cwd: root });
  });
});
