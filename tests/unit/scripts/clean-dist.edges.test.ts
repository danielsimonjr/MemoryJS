import { mkdir, writeFile, access, symlink, mkdtemp, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, beforeAll } from 'vitest';

const execFileAsync = promisify(execFile);

const root = async () => mkdtemp(join(tmpdir(), 'memoryjs-clean-edges-'));
const dist = (r: string) => join(r, 'dist');

describe('scripts/clean-dist.mjs edge cases', () => {
  let script: string;

  beforeAll(() => {
    script = join(process.cwd(), 'scripts/clean-dist.mjs');
  });

  const run = async (r: string) => execFileAsync(process.execPath, [script], { cwd: r });

  it('deletes dist when dist is a regular file', async () => {
    const r = await root();
    await writeFile(dist(r), 'x');
    await run(r);
    await expect(access(dist(r))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('unlinks a dist symlink and preserves its target', async () => {
    const r = await root();
    const target = await mkdtemp(join(tmpdir(), 'memoryjs-clean-target-'));
    await writeFile(join(target, 'keep.txt'), 'x');
    await symlink(target, dist(r), 'dir');
    await run(r);
    await expect(access(dist(r))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(target, 'keep.txt'))).resolves.toBeUndefined();
  });

  it('removes a broken dist symlink and exits 0', async () => {
    const r = await root();
    await symlink(join(tmpdir(), 'memoryjs-clean-nowhere'), dist(r), 'dir');
    await run(r);
    await expect(access(dist(r))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes dist containing a symlink loop without following it', async () => {
    const r = await root();
    const d = dist(r);
    await mkdir(join(d, 'loop'), { recursive: true });
    await symlink(join(d, 'loop'), join(d, 'loop', 'self'), 'dir');
    await run(r);
    await expect(access(d)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes deeply nested dist contents', async () => {
    const r = await root();
    let deep = dist(r);
    for (let i = 0; i < 20; i++) deep = join(deep, `level-${i}`);
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'index.js'), 'x');
    await run(r);
    await expect(access(dist(r))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates failure with a nonzero exit when dist cannot be deleted', async () => {
    if (process.platform === 'win32') return;
    const r = await root();
    const d = dist(r);
    await mkdir(join(d, 'sub'), { recursive: true });
    await writeFile(join(d, 'sub', 'a.js'), 'x');
    await chmod(join(d, 'sub'), 0o555);
    try {
      await expect(run(r)).rejects.toMatchObject({ code: 1 });
      await expect(access(d)).resolves.toBeUndefined();
    } finally {
      await chmod(join(d, 'sub'), 0o755);
    }
  });
});
