/** Temp-path and backend-matrix helpers. `withBothBackends` runs a suite on JSONL and SQLite. */
import { afterEach, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../src/core/SQLiteStorage.js';
import type { IGraphStorage } from '../../src/types/types.js';

const createdDirs = new Set<string>();

/** Create a fresh temp directory under the OS temp dir. Removed by `removeTempDir`. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.add(dir);
  return dir;
}

/** Remove a directory created by `makeTempDir` (best-effort, idempotent). */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  createdDirs.delete(dir);
}

/** Path to a not-yet-existing `memory.jsonl` in a fresh temp dir. */
export function makeTempJsonlPath(): string {
  return join(makeTempDir('memoryjs-jsonl-'), 'memory.jsonl');
}

/** Path to a not-yet-existing `memory.db` in a fresh temp dir. */
export function makeTempSqlitePath(): string {
  return join(makeTempDir('memoryjs-sqlite-'), 'memory.db');
}

/**
 * Remove every temp dir made by this module and not yet removed.
 *
 * Every dir is attempted and forgotten, then the first failure is rethrown,
 * so a leaked SQLite handle (Windows: `EBUSY` on `rmSync`) fails the test
 * that leaked it exactly once instead of every later test in the file.
 */
export function cleanupTempDirs(): void {
  let firstError: unknown;
  for (const dir of [...createdDirs]) {
    try {
      removeTempDir(dir);
    } catch (err) {
      createdDirs.delete(dir);
      firstError ??= err;
    }
  }
  if (firstError !== undefined) throw firstError;
}

export interface BackendCase {
  readonly name: 'jsonl' | 'sqlite';
  /** Create a new, empty storage at a fresh temp path. */
  create(): IGraphStorage;
}

export const BACKEND_CASES: readonly BackendCase[] = [
  { name: 'jsonl', create: () => new GraphStorage(makeTempJsonlPath()) as unknown as IGraphStorage },
  { name: 'sqlite', create: () => new SQLiteStorage(makeTempSqlitePath()) as unknown as IGraphStorage },
];

/**
 * Register `fn` as a `describe` block once per backend. Storages created via
 * `backend.create()` are closed (when they expose `close`) and their temp
 * dirs removed after each test.
 */
export function withBothBackends(name: string, fn: (backend: BackendCase) => void): void {
  describe.each(BACKEND_CASES.map((b) => [b.name, b] as const))(`${name} [%s]`, (_label, backend) => {
    const opened: IGraphStorage[] = [];
    const trackedCreate: BackendCase = {
      name: backend.name,
      create: () => {
        const storage = backend.create();
        opened.push(storage);
        return storage;
      },
    };

    afterEach(() => {
      for (const storage of opened.splice(0)) {
        (storage as unknown as { close?: () => void }).close?.();
      }
      cleanupTempDirs();
    });

    fn(trackedCreate);
  });
}
