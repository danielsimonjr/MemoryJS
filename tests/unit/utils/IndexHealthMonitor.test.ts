/**
 * Direct unit tests for IndexHealthMonitor (CMP-5).
 */

import { describe, it, expect } from 'vitest';
import { IndexHealthMonitor } from '../../../src/utils/IndexHealthMonitor.js';
import type { IndexHealthSnapshot } from '../../../src/utils/IIndexHealth.js';

const tfidfSnapshot: IndexHealthSnapshot = {
  name: 'tfidf',
  initialized: true,
  documentCount: 42,
  staleness: 'fresh',
};

describe('IndexHealthMonitor', () => {
  it('reports the rankedSearch snapshot as tfidf', () => {
    const monitor = new IndexHealthMonitor({
      rankedSearch: { getIndexHealth: () => tfidfSnapshot },
    });
    const report = monitor.report();
    expect(report.tfidf).toEqual(tfidfSnapshot);
    expect(report.embedding).toBeUndefined();
  });

  it('degrades to an uninitialized tfidf snapshot with a warning when no rankedSearch is attached', () => {
    const report = new IndexHealthMonitor({}).report();
    expect(report.tfidf).toEqual({
      name: 'tfidf',
      initialized: false,
      documentCount: 0,
      warnings: ['no rankedSearch attached'],
    });
  });

  it('includes the embedding snapshot only when an embeddingHealth source is given', () => {
    const embedding: IndexHealthSnapshot = {
      name: 'embedding',
      initialized: true,
      documentCount: 7,
      extras: { model: 'test-model' },
    };
    const report = new IndexHealthMonitor({ embeddingHealth: () => embedding }).report();
    expect(report.embedding).toEqual(embedding);
  });

  it('reads sources on every call (no caching of the snapshot)', () => {
    let count = 0;
    const monitor = new IndexHealthMonitor({
      rankedSearch: {
        getIndexHealth: () => ({ name: 'tfidf', initialized: true, documentCount: ++count }),
      },
    });
    expect(monitor.report().tfidf.documentCount).toBe(1);
    expect(monitor.report().tfidf.documentCount).toBe(2);
  });

  it('stamps generatedAt with a valid ISO timestamp', () => {
    const before = Date.now();
    const { generatedAt } = new IndexHealthMonitor({}).report();
    const parsed = Date.parse(generatedAt);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before - 1);
    expect(new Date(generatedAt).toISOString()).toBe(generatedAt);
  });
});
