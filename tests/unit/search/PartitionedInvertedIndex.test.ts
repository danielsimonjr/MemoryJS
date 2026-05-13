/**
 * PartitionedInvertedIndex Smoke Tests
 */

import { describe, it, expect } from 'vitest';
import { PartitionedInvertedIndex } from '../../../src/search/PartitionedInvertedIndex.js';

describe('PartitionedInvertedIndex', () => {
  it('addDocument creates a partition lazily on first write', () => {
    const idx = new PartitionedInvertedIndex();
    expect(idx.partitionKeys()).toEqual([]);
    idx.addDocument('person', 'Alice', ['developer', 'lead']);
    expect(idx.partitionKeys()).toEqual(['person']);
  });

  it('searchPartition returns documents matching all terms in that partition only', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer', 'lead']);
    idx.addDocument('person', 'Bob', ['developer', 'junior']);
    idx.addDocument('project', 'Site', ['developer', 'frontend']);

    const personDevs = idx.searchPartition('person', ['developer']);
    expect(personDevs.sort()).toEqual(['Alice', 'Bob']);
    // 'Site' is in 'project' partition, not surfaced.
    expect(personDevs).not.toContain('Site');
  });

  it('searchPartition on an unknown partition returns []', () => {
    const idx = new PartitionedInvertedIndex();
    expect(idx.searchPartition('nope', ['x'])).toEqual([]);
  });

  it('searchAcrossAll unions matches from every partition', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer']);
    idx.addDocument('project', 'Site', ['developer']);
    const all = idx.searchAcrossAll(['developer']);
    expect(all.sort()).toEqual(['Alice', 'Site']);
  });

  it('removeDocument routes to the correct partition', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer']);
    expect(idx.removeDocument('person', 'Alice')).toBe(true);
    expect(idx.searchPartition('person', ['developer'])).toEqual([]);
  });

  it('dropPartition removes a partition entirely', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer']);
    expect(idx.dropPartition('person')).toBe(true);
    expect(idx.hasPartition('person')).toBe(false);
  });

  it('snapshot returns per-partition document and term counts', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer', 'lead']);
    idx.addDocument('project', 'Site', ['developer', 'frontend', 'react']);
    const snap = idx.snapshot();
    expect(snap.partitions).toHaveLength(2);
    expect(snap.totalDocuments).toBe(2);
    expect(snap.totalTerms).toBeGreaterThan(0);
  });

  it('health() rolls up to a single IndexHealth shape', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer']);
    const h = idx.health();
    expect(h.name).toBe('partitioned-inverted');
    expect(h.documentCount).toBeGreaterThan(0);
    expect(h.extras?.partitionCount).toBe(1);
  });

  it('clear() drops every partition', () => {
    const idx = new PartitionedInvertedIndex();
    idx.addDocument('person', 'Alice', ['developer']);
    idx.addDocument('project', 'Site', ['developer']);
    idx.clear();
    expect(idx.partitionKeys()).toEqual([]);
  });
});
