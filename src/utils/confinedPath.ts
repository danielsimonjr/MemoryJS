/**
 * Shared path confinement helpers: pseudo-filesystem detection, strict containment and existence checks.
 *
 * @module utils/confinedPath
 * @internal Used by the skill tree and the AMR reader. Not re-exported from a barrel.
 */

import { promises as fs } from 'fs';
import { isAbsolute, relative, sep } from 'path';

/** Pseudo filesystems a skill tree is never written to or read from. */
const SPECIAL_ROOTS = ['/proc', '/sys', '/dev'];

/**
 * Whether `p` is a special filesystem path (`/proc`, `/sys`, `/dev` or below).
 *
 * @param p - Absolute path.
 * @returns True for a special path.
 */
export function isSpecial(p: string): boolean {
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
export function strictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Whether `p` exists. The check does not follow a final symlink.
 *
 * @param p - Absolute path.
 * @returns True when lstat finds an entry.
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}
