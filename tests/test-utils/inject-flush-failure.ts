/**
 * Shared test helper — force `durableWriteFile` to fail end-to-end
 *
 * The atomic write path is `temp file → fsync → rename → (Windows
 * EPERM fallback: open target directly + write)`. Triggering a
 * rollback test requires both legs to fail: making `fs.rename` throw
 * is not enough because the fallback would just succeed.
 *
 * Path-based filter on `fs.open` lets the temp-file open succeed but
 * rejects when the caller tries to open the target directly (the
 * Windows EPERM fallback path). Combined with a `fs.rename` reject,
 * both legs fail and the calling code's rollback path runs.
 *
 * Used by:
 * - `tests/unit/core/columns/columns-review-fixes.test.ts`
 * - `tests/unit/search/tiered/DiskWarmTier.test.ts`
 * - `tests/unit/search/tiered/BrotliColdTier.test.ts`
 * - `tests/unit/search/tiered/tiered-review-fixes.test.ts`
 *
 * @example
 * ```typescript
 * import { injectFlushFailure } from '../../test-utils/inject-flush-failure.js';
 * import { promises as fs } from 'fs';
 *
 * afterEach(() => vi.restoreAllMocks());
 *
 * it('rolls back on flush failure', async () => {
 *   injectFlushFailure(sidecarPath);
 *   await expect(store.put('a', value)).rejects.toThrow(/synthetic/);
 *   vi.restoreAllMocks();
 *   // ... assert pre-mutation state preserved ...
 * });
 * ```
 */

import { promises as fs } from 'fs';
import { vi } from 'vitest';

export interface InjectFlushFailureResult {
  /** Restore the spies. Convenience over the global `vi.restoreAllMocks()`. */
  restore(): void;
}

/**
 * Force `durableWriteFile` to fail for writes targeting `targetPath`.
 * Mocks `fs.rename` to reject unconditionally + `fs.open` to reject
 * when the path argument equals `targetPath` (the fallback path).
 * Non-matching paths (the tmp-file open) get through to the real
 * implementation.
 */
export function injectFlushFailure(targetPath: string): InjectFlushFailureResult {
  const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('synthetic-rename'));
  const realOpen = fs.open.bind(fs);
  const openSpy = vi.spyOn(fs, 'open').mockImplementation(((p: Parameters<typeof fs.open>[0], ...rest: unknown[]) => {
    if (p === targetPath) {
      return Promise.reject(new Error('synthetic-fallback'));
    }
    return (realOpen as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
  }) as typeof fs.open);

  return {
    restore() {
      renameSpy.mockRestore();
      openSpy.mockRestore();
    },
  };
}
