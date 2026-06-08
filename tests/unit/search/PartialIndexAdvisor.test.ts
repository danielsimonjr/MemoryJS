/**
 * PartialIndexAdvisor Smoke Tests
 *
 * Doesn't exercise SQLite DDL — just the in-memory tracker logic. The
 * SQLite integration is exercised end-to-end via the SQLiteStorage suite
 * once the advisor is wired in (deferred to a follow-up).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PartialIndexAdvisor } from '../../../src/search/PartialIndexAdvisor.js';

describe('PartialIndexAdvisor', () => {
  const ORIGINAL_ENV = process.env.MEMORY_SQLITE_AUTO_INDEX;

  beforeEach(() => {
    process.env.MEMORY_SQLITE_AUTO_INDEX = 'true';
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.MEMORY_SQLITE_AUTO_INDEX;
    else process.env.MEMORY_SQLITE_AUTO_INDEX = ORIGINAL_ENV;
  });

  it('does nothing when MEMORY_SQLITE_AUTO_INDEX is unset', () => {
    delete process.env.MEMORY_SQLITE_AUTO_INDEX;
    const advisor = new PartialIndexAdvisor({ minSupport: 1 });
    expect(advisor.enabled).toBe(false);
    advisor.record({ entityType: 'person' });
    expect(advisor.recommend()).toEqual([]);
  });

  it('records frequency per filter shape', () => {
    const advisor = new PartialIndexAdvisor({ minSupport: 1 });
    advisor.record({ entityType: 'person' });
    advisor.record({ entityType: 'person' });
    advisor.record({ entityType: 'project' });
    const snap = advisor.snapshot();
    expect(snap.typeCounts.person).toBe(2);
    expect(snap.typeCounts.project).toBe(1);
  });

  it('recommend() returns patterns above minSupport, sorted by descending support', () => {
    const advisor = new PartialIndexAdvisor({ minSupport: 2 });
    for (let i = 0; i < 5; i++) advisor.record({ entityType: 'person' });
    for (let i = 0; i < 3; i++) advisor.record({ entityType: 'project' });
    advisor.record({ entityType: 'rare' });

    const recs = advisor.recommend();
    expect(recs).toHaveLength(2);
    expect(recs[0]!.value).toBe('person');
    expect(recs[1]!.value).toBe('project');
    expect(recs[0]!.support).toBeGreaterThan(recs[1]!.support);
  });

  it('recommend() honours maxIndexes cap', () => {
    const advisor = new PartialIndexAdvisor({ minSupport: 1, maxIndexes: 2 });
    for (const t of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 5; i++) advisor.record({ entityType: t });
    }
    expect(advisor.recommend()).toHaveLength(2);
  });

  it('recommend() covers projectId observations as well', () => {
    const advisor = new PartialIndexAdvisor({ minSupport: 2 });
    for (let i = 0; i < 3; i++) advisor.record({ projectId: 'proj-A' });
    expect(advisor.recommend().some((r) => r.column === 'projectId')).toBe(true);
  });

  it('index names are sanitised against arbitrary strings', () => {
    const advisor = new PartialIndexAdvisor({ minSupport: 1 });
    for (let i = 0; i < 2; i++) advisor.record({ entityType: 'foo bar; DROP TABLE entities' });
    const recs = advisor.recommend();
    expect(recs[0]!.indexName).toMatch(/^idx_advisor_type_[a-zA-Z0-9_]+$/);
    expect(recs[0]!.indexName.length).toBeLessThan(80);
  });
});
