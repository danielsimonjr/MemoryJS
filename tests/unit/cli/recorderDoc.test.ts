/**
 * Challenger test (Sprint 6, step 4): the parity-recorder documentation must
 * point at the recorder that actually exists in the repository.
 *
 * The recorder lives at `tests/unit/cli/helpers/captureCliParity.ts`.
 * An operator following CHANGELOG.md to re-record the fixture must be
 * pointed at that file. This test asserts that every documented path
 * for the recorder resolves to a file on disk.
 *
 * @module tests/unit/cli/recorderDoc.test
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

/** Files that mention the parity recorder by path. */
const docFiles = [
  'CHANGELOG.md',
  'tests/unit/cli/parseArgsPinned.test.ts',
  'tests/unit/cli/parseArgsSurfacePinned.test.ts',
];

/** Pattern matching a path-like mention of the recorder. */
const recorderRef = /(?:scripts\/[\w./-]+|tests\/unit\/cli\/helpers\/[\w./-]+)/g;

describe('parity recorder documentation', () => {
  it('references only recorder paths that exist in the repository', () => {
    const broken: string[] = [];
    for (const doc of docFiles) {
      const text = readFileSync(join(repoRoot, doc), 'utf-8');
      for (const match of text.matchAll(recorderRef)) {
        const referenced = match[0];
        if (!existsSync(join(repoRoot, referenced))) {
          broken.push(`${doc}: ${referenced}`);
        }
      }
    }
    expect(
      broken,
      `Parity-recorder paths that do not exist on disk (fix the references, ` +
        `the recorder lives at tests/unit/cli/helpers/captureCliParity.ts): ${broken.join(', ')}`,
    ).toEqual([]);
  });
});
