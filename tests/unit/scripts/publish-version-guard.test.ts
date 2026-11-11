/**
 * The publish job refuses a tag whose version is not package.json's version.
 *
 * npm 4.6.0 stayed on the registry while GitHub had v5.0.0 because no publish
 * workflow existed. The guard is the part a unit test can pin: a tag that does
 * not name package.json's version must exit 1, and the tag that does must exit 0.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  versionFromTag,
  assertTagMatchesPackageVersion,
  readPackageVersion,
} from '../../../scripts/publish-version-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const script = resolve(root, 'scripts/publish-version-guard.mjs');
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version as string;

function run(tag: string, packageJson?: string): { status: number; stdout: string; stderr: string } {
  const args = packageJson ? [script, tag, packageJson] : [script, tag];
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('publish version guard', () => {
  it('strips one leading v and accepts refs/tags/', () => {
    expect(versionFromTag('v5.0.0')).toBe('5.0.0');
    expect(versionFromTag('refs/tags/v5.0.0')).toBe('5.0.0');
    expect(versionFromTag('v5.0.0-rc.1')).toBe('5.0.0-rc.1');
  });

  it('rejects a ref that is not a v* tag', () => {
    expect(versionFromTag('master')).toBeNull();
    expect(versionFromTag('5.0.0')).toBeNull();
    expect(versionFromTag('')).toBeNull();
    expect(versionFromTag('v')).toBeNull();
  });

  it('fails when the tag version is not the package version', () => {
    const mismatch = assertTagMatchesPackageVersion('v9.9.9-not-a-release', packageVersion);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toContain('9.9.9-not-a-release');
    expect(mismatch.message).toContain(packageVersion);

    const branch = assertTagMatchesPackageVersion('master', packageVersion);
    expect(branch.ok).toBe(false);
    expect(branch.message).toContain('master');
  });

  it('passes only when the tag version equals the package version', () => {
    const match = assertTagMatchesPackageVersion(`v${packageVersion}`, packageVersion);
    expect(match.ok).toBe(true);
    expect(match.message).toContain(packageVersion);
  });

  it('readPackageVersion reads an explicit package.json path', () => {
    expect(readPackageVersion(resolve(root, 'package.json'))).toBe(packageVersion);
  });

  it('the CLI uses an explicit package.json path (release checkout vs guard checkout)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memoryjs-pub-guard-'));
    const pkgPath = join(dir, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ version: '5.0.0' }));
    const accepted = run('v5.0.0', pkgPath);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('5.0.0');
    const refused = run('v4.6.0', pkgPath);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('4.6.0');
    expect(refused.stderr).toContain('5.0.0');
  });

  it('the CLI exits 1 on a mismatch and 0 on the live package.json version', () => {
    const refused = run('v9.9.9-not-a-release');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('9.9.9-not-a-release');
    expect(refused.stderr).toContain(packageVersion);

    const dispatchedFromBranch = run('master');
    expect(dispatchedFromBranch.status).toBe(1);

    const accepted = run(`v${packageVersion}`);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain(packageVersion);
  });
});
