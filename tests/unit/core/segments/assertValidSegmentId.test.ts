/**
 * Direct tests for `assertValidSegmentId` (CL-5) and its use by both
 * segment storage backends. The error text is part of the contract.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  assertValidSegmentId,
  FnvSegmentRouter,
  InMemorySegmentStorage,
} from '../../../../src/core/segments/ISegmentStorage.js';
import { FileSegmentStorage } from '../../../../src/core/segments/FileSegmentStorage.js';

describe('assertValidSegmentId (CL-5)', () => {
  it('accepts every integer in [0, segmentCount)', () => {
    expect(() => assertValidSegmentId(0, 4)).not.toThrow();
    expect(() => assertValidSegmentId(3, 4)).not.toThrow();
    expect(() => assertValidSegmentId(0, 1)).not.toThrow();
  });

  it('rejects ids outside the range with the shared message', () => {
    expect(() => assertValidSegmentId(4, 4)).toThrow(
      'Segment id must be an integer in [0, 4), got 4',
    );
    expect(() => assertValidSegmentId(-1, 4)).toThrow(
      'Segment id must be an integer in [0, 4), got -1',
    );
  });

  it('rejects non-integer ids', () => {
    expect(() => assertValidSegmentId(1.5, 4)).toThrow(
      'Segment id must be an integer in [0, 4), got 1.5',
    );
    expect(() => assertValidSegmentId(NaN, 4)).toThrow(
      'Segment id must be an integer in [0, 4), got NaN',
    );
  });
});

describe('segment storage backends use the shared id check (CL-5)', () => {
  it('InMemorySegmentStorage.loadSegment reports the same text', async () => {
    const store = new InMemorySegmentStorage(new FnvSegmentRouter(3));
    await expect(store.loadSegment(3)).rejects.toThrow(
      'Segment id must be an integer in [0, 3), got 3',
    );
    await expect(store.saveSegment({ id: -2, entities: [], relations: [] })).rejects.toThrow(
      'Segment id must be an integer in [0, 3), got -2',
    );
  });

  it('FileSegmentStorage.loadSegment reports the same text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seg-assert-'));
    try {
      const store = new FileSegmentStorage(dir, new FnvSegmentRouter(2));
      await expect(store.loadSegment(2)).rejects.toThrow(
        'Segment id must be an integer in [0, 2), got 2',
      );
      expect(() => store.segmentPath(0.5)).toThrow(
        'Segment id must be an integer in [0, 2), got 0.5',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
