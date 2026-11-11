/**
 * Fail when a release tag's version is not package.json's version.
 *
 * A tag `v5.0.0` may publish only when package.json says `5.0.0`. The v5.0.0
 * GitHub release exists but npm still carried 4.6.0 because no publish
 * workflow ran. The publish workflow checks out the tagged commit, and this
 * guard refuses a tag that does not name that commit's package.json version
 * (including a workflow_dispatch whose input does not match package.json).
 *
 * Usage: node scripts/publish-version-guard.mjs <tag> [package.json]
 *   <tag> is `vX.Y.Z` or `refs/tags/vX.Y.Z`.
 *   [package.json] defaults to ../package.json beside this script (the guard
 *   checkout). workflow_dispatch passes the release tree's package.json path.
 * Exit 0 on a match, 1 otherwise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} tag @returns {string | null} */
export function versionFromTag(tag) {
  if (typeof tag !== 'string' || tag.length < 2) return null;
  const name = tag.startsWith('refs/tags/') ? tag.slice('refs/tags/'.length) : tag;
  if (!name.startsWith('v') || name.length < 2) return null;
  return name.slice(1);
}

/**
 * @param {string} packageJsonPath
 * @returns {string}
 */
export function readPackageVersion(packageJsonPath) {
  return JSON.parse(readFileSync(resolve(packageJsonPath), 'utf8')).version;
}

/**
 * @param {string} tag
 * @param {string} packageVersion
 * @returns {{ ok: boolean, message: string }}
 */
export function assertTagMatchesPackageVersion(tag, packageVersion) {
  const fromTag = versionFromTag(tag);
  if (fromTag === null) {
    return {
      ok: false,
      message: `ref ${JSON.stringify(tag)} is not a v* tag, so there is no version to compare with package.json ${packageVersion}`,
    };
  }
  if (fromTag !== packageVersion) {
    return {
      ok: false,
      message: `tag version ${fromTag} does not equal package.json version ${packageVersion}`,
    };
  }
  return {
    ok: true,
    message: `tag v${fromTag} matches package.json ${packageVersion}`,
  };
}

function main() {
  const tag = process.argv[2] ?? '';
  const packageJsonPath = process.argv[3]
    ? resolve(process.argv[3])
    : new URL('../package.json', import.meta.url);
  const packageVersion =
    typeof packageJsonPath === 'string'
      ? readPackageVersion(packageJsonPath)
      : JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
  const result = assertTagMatchesPackageVersion(tag, packageVersion);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
