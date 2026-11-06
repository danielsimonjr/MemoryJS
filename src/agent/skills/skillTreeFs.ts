/**
 * Filesystem helpers for the published SKILL.md tree (spec RS-3): crash
 * recovery of an interrupted publish swap and confined, symlink-safe reads.
 *
 * @module agent/skills/skillTreeFs
 * @experimental Used by `SkillPublisher` only.
 */

import { promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { renameOver } from '../../utils/durableWriteFile.js';
import { ValidationError } from '../../utils/errors.js';
import { validateFilePath } from '../../utils/entityUtils.js';

/** Why {@link resolveConfinedTreeDir} refused a directory. */
export type TreeDirRefusal = 'path-traversal' | 'outside-root' | 'special-filesystem' | 'symlink-escape' | 'is-root';

/** Pseudo filesystems a skill tree is never written to or read from. */
const SPECIAL_ROOTS = ['/proc', '/sys', '/dev'];

/**
 * Throw the refusal as a `ValidationError` whose `errors` carry `dir:<reason>`.
 *
 * @param reason - Refusal code.
 * @param dir - Directory as given.
 */
function refuse(reason: TreeDirRefusal, dir: string): never {
  throw new ValidationError(`Skill tree directory refused (${reason}): ${dir.slice(0, 300)}`, [`dir:${reason}`]);
}

/**
 * Whether `p` is a special filesystem path (`/proc`, `/sys`, `/dev` or below).
 *
 * @param p - Absolute path.
 * @returns True for a special path.
 */
function isSpecial(p: string): boolean {
  const n = p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''); // Windows: drive prefix and backslashes
  return SPECIAL_ROOTS.some((r) => n === r || n.startsWith(r + '/'));
}

/**
 * Whether `child` lies strictly below `parent` (both absolute).
 *
 * @param parent - Parent directory.
 * @param child - Candidate path.
 * @returns True when `child` is inside and not equal to `parent`.
 */
function strictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve a skill tree directory against `root` and confine it there (spec RS-3, path confinement).
 * Rejects `..` segments, absolute paths outside `root`, `root` itself, `/proc`, `/sys` and `/dev`,
 * and paths whose deepest existing ancestor resolves (through symlinks) outside the real `root`.
 * Never touches the filesystem beyond `lstat`/`realpath`.
 *
 * @param dir - Directory as given (relative to `root` or absolute).
 * @param root - Confinement root.
 * @returns The resolved absolute directory.
 * @throws ValidationError with `errors[0] === 'dir:<reason>'` ({@link TreeDirRefusal}).
 */
export async function resolveConfinedTreeDir(dir: string, root: string): Promise<string> {
  if (dir.split(/[/\\]/).includes('..')) refuse('path-traversal', dir);
  const base = resolve(root);
  if (isSpecial(resolve(base, dir))) refuse('special-filesystem', dir);
  let target: string;
  try {
    target = validateFilePath(dir, base, true);
  } catch {
    refuse('outside-root', dir);
  }
  if (!strictlyInside(base, target)) refuse(target === base ? 'is-root' : 'outside-root', dir);
  let ancestor = target;
  while (!(await pathExists(ancestor))) {
    const up = dirname(ancestor);
    if (up === ancestor) break;
    ancestor = up;
  }
  const realBase = await fs.realpath(base).catch(() => base);
  const realAncestor = await fs.realpath(ancestor).catch(() => ancestor);
  const realTarget = join(realAncestor, relative(ancestor, target));
  if (isSpecial(realTarget)) refuse('special-filesystem', dir);
  try {
    validateFilePath(realTarget, realBase, true);
  } catch {
    refuse('symlink-escape', dir);
  }
  if (!strictlyInside(realBase, realTarget)) refuse('symlink-escape', dir);
  return target;
}

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
