/**
 * Unique name suffix
 *
 * A name built from `Date.now()` alone collides when two entries are created in one
 * millisecond, and the second entry then replaces or duplicates the first.
 *
 * @module utils/ids
 */

import { randomUUID } from 'node:crypto';

/**
 * Returns a suffix for a generated entity name.
 * The suffix is the time in milliseconds, an underscore, and 8 hex characters of a random UUID.
 * Two calls in the same millisecond return different suffixes.
 * The time part keeps names in creation order when sorted by age.
 *
 * @returns The suffix, for example `1700000000000_1a2b3c4d`.
 */
export function uniqueTimeSuffix(): string {
  return `${Date.now()}_${randomUUID().slice(0, 8)}`;
}
