/**
 * Filesystem helpers for the published SKILL.md tree (spec RS-3): crash
 * recovery of an interrupted publish swap and confined, symlink-safe reads.
 *
 * @module agent/skills/skillTreeFs
 * @internal Used by `SkillPublisher` only.
 */

import { promises as fs } from 'fs';
import { basename, dirname, join, sep } from 'path';
import { renameOver } from '../../utils/durableWriteFile.js';

/**
 * Recover from an interrupted publish and sweep its leftovers.
 *
 * When `target` is missing but a `<target>.old-*` sibling exists (the swap
 * moved the old tree aside, then both the new rename and the rollback
 * failed), the newest such sibling is renamed back to `target`. Remaining
 * `<target>.tmp-*` and `<target>.old-*` siblings are removed (best-effort).
 *
 * @param target - Absolute path of the published tree.
 */
export async function recoverPublishedTree(target: string): Promise<void> {
  const parent = dirname(target);
  const name = basename(target);
  const siblings = await fs.readdir(parent).catch(() => [] as string[]);
  const olds = siblings.filter((s) => s.startsWith(`${name}.old-`));
  const temps = siblings.filter((s) => s.startsWith(`${name}.tmp-`));
  if (!(await pathExists(target)) && olds.length > 0) {
    const stats = await Promise.all(olds.map(async (s) => ({ s, m: (await fs.lstat(join(parent, s))).mtimeMs })));
    stats.sort((a, b) => b.m - a.m);
    const newest = stats[0]!.s;
    await renameOver(join(parent, newest), target);
    olds.splice(olds.indexOf(newest), 1);
  }
  for (const leftover of [...olds, ...temps]) await removeBestEffort(join(parent, leftover));
}

/** `fs.rm -rf` that ignores failures (EBUSY on Windows, already gone, ...). */
export async function removeBestEffort(path: string): Promise<void> {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup: a leftover is swept on the next publish/import.
  }
}

/** Whether `p` exists (without following a final symlink). */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Outcome of {@link readConfinedSkillFile}. */
export type ConfinedRead =
  | { ok: true; text: string }
  | { ok: false; reason: 'missing' | 'not-regular' | 'outside-tree' };

/**
 * Read `<root>/<id>/SKILL.md` only when it is a regular file (not a symlink)
 * whose real path lies inside the real path of `root`.
 *
 * @param root - Absolute tree root.
 * @param filePath - Absolute SKILL.md path under `root`.
 * @returns The text, or why it was refused.
 */
export async function readConfinedSkillFile(root: string, filePath: string): Promise<ConfinedRead> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not-regular' };
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(filePath)]);
  if (!realFile.startsWith(realRoot + sep)) return { ok: false, reason: 'outside-tree' };
  return { ok: true, text: await fs.readFile(filePath, 'utf8') };
}
