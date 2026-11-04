/**
 * sidecarPath (DES-5) — table-driven derivation of `<dir>/<basename><suffix><ext>`.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { sidecarPath } from '../../../src/utils/sidecarPath.js';

const base = join('data', 'store');

describe('sidecarPath', () => {
  it.each([
    {
      label: 'jsonl storage, default ext',
      file: join(base, 'memory.jsonl'),
      suffix: '-audit',
      ext: undefined,
      expected: join(base, 'memory-audit.jsonl'),
    },
    {
      label: 'sqlite storage, default ext still .jsonl (audit sidecar)',
      file: join(base, 'memory.db'),
      suffix: '-audit',
      ext: undefined,
      expected: join(base, 'memory-audit.jsonl'),
    },
    {
      label: 'procedural graph with explicit .db ext',
      file: join(base, 'memory.db'),
      suffix: '-procedural-graph',
      ext: '.db',
      expected: join(base, 'memory-procedural-graph.db'),
    },
    {
      label: 'no extension on storage file',
      file: join(base, 'memory'),
      suffix: '-ref-index',
      ext: undefined,
      expected: join(base, 'memory-ref-index.jsonl'),
    },
    {
      label: 'dotted basename keeps everything before the last extension',
      file: join(base, 'memory.v2.jsonl'),
      suffix: '-audit',
      ext: undefined,
      expected: join(base, 'memory.v2-audit.jsonl'),
    },
    {
      label: 'nested directory is preserved',
      file: join(base, 'a', 'b', 'mem.jsonl'),
      suffix: '-tag-aliases',
      ext: undefined,
      expected: join(base, 'a', 'b', 'mem-tag-aliases.jsonl'),
    },
    {
      label: 'compound custom extension',
      file: join(base, 'mem.db'),
      suffix: '-tiered-cold',
      ext: '.jsonl.br',
      expected: join(base, 'mem-tiered-cold.jsonl.br'),
    },
    {
      label: 'column-store sidecar',
      file: join(base, 'memory.jsonl'),
      suffix: '-observations',
      ext: undefined,
      expected: join(base, 'memory-observations.jsonl'),
    },
    {
      label: 'saved-searches sidecar',
      file: join(base, 'memory.jsonl'),
      suffix: '-saved-searches',
      ext: undefined,
      expected: join(base, 'memory-saved-searches.jsonl'),
    },
  ])('$label', ({ file, suffix, ext, expected }) => {
    const result = ext === undefined ? sidecarPath(file, suffix) : sidecarPath(file, suffix, ext);
    expect(result).toBe(expected);
  });

  it('is a pure derivation: the same inputs give the same output', () => {
    const file = join(base, 'memory.db');
    expect(sidecarPath(file, '-audit')).toBe(sidecarPath(file, '-audit'));
  });
});
