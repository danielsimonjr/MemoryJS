import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';
import { pathToFileURL } from 'url';
import { FuzzySearch } from '../../../src/search/FuzzySearch.js';

/**
 * Regression tests for the bundled-dist worker-path bug: after code
 * splitting, the module that runs FuzzySearch can live at dist root
 * (shared chunk), dist/search (subpath entry), dist/cli, or src/search
 * (tests). The old single hard-coded relative path only matched the
 * unbundled dist/search layout, so bundled consumers silently lost the
 * worker pool. `resolveWorkerPath` must find the worker in every layout.
 */
describe('FuzzySearch.resolveWorkerPath', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fuzzy-worker-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedWorker(ext: '.js' | '.cjs'): string {
    const dir = join(root, 'dist', 'workers');
    mkdirSync(dir, { recursive: true });
    const p = normalize(join(dir, `levenshteinWorker${ext}`));
    writeFileSync(p, '// worker');
    return p;
  }

  function moduleUrlFor(relDir: string, ext = '.js'): string {
    // A fake module file at <root>/<relDir>/index<ext>
    return pathToFileURL(join(root, relDir, `index${ext}`)).href;
  }
  function dirFor(relDir: string): string {
    return join(root, relDir);
  }

  it('finds the worker from a bundled shared chunk at dist root', () => {
    const expected = seedWorker('.js');
    const got = FuzzySearch.resolveWorkerPath(moduleUrlFor('dist'), dirFor('dist'));
    expect(got).toBe(expected);
  });

  it('finds the worker from a dist/search subpath entry', () => {
    const expected = seedWorker('.js');
    const got = FuzzySearch.resolveWorkerPath(
      moduleUrlFor('dist/search'),
      dirFor('dist/search'),
    );
    expect(got).toBe(expected);
  });

  it('finds the worker from the dist/cli bundle', () => {
    const expected = seedWorker('.js');
    const got = FuzzySearch.resolveWorkerPath(moduleUrlFor('dist/cli'), dirFor('dist/cli'));
    expect(got).toBe(expected);
  });

  it('finds the worker from src/search during tests', () => {
    const expected = seedWorker('.js');
    const got = FuzzySearch.resolveWorkerPath(
      moduleUrlFor('src/search'),
      dirFor('src/search'),
    );
    expect(got).toBe(expected);
  });

  it('prefers the .cjs worker when the host module is .cjs', () => {
    seedWorker('.js');
    const cjs = seedWorker('.cjs');
    const got = FuzzySearch.resolveWorkerPath(
      moduleUrlFor('dist', '.cjs'),
      dirFor('dist'),
    );
    expect(got).toBe(cjs);
  });

  it('falls back to the .js worker when the host is .cjs but only .js exists', () => {
    const js = seedWorker('.js');
    const got = FuzzySearch.resolveWorkerPath(
      moduleUrlFor('dist', '.cjs'),
      dirFor('dist'),
    );
    expect(got).toBe(js);
  });

  it('returns null when no worker binary exists for any layout', () => {
    const got = FuzzySearch.resolveWorkerPath(moduleUrlFor('dist'), dirFor('dist'));
    expect(got).toBeNull();
  });
});
