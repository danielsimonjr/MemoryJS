/**
 * RowLevelFilter Unit Tests
 *
 * Covers Phase 5 step 54: entity-level filtering predicates.
 */

import { describe, it, expect } from 'vitest';
import { RowLevelFilter } from '../../../src/security/RowLevelFilter.js';
import type { Entity } from '../../../src/types/types.js';

function ent(name: string, extras: Partial<Entity> & Record<string, unknown> = {}): Entity & Record<string, unknown> {
  return {
    name,
    entityType: 'thing',
    observations: [],
    ...extras,
  } as Entity & Record<string, unknown>;
}

describe('RowLevelFilter.byTenant', () => {
  it('keeps only rows whose tenantId matches the subject', () => {
    const filter = RowLevelFilter.entities().add(RowLevelFilter.byTenant<Entity & Record<string, unknown>>());
    const rows = [
      ent('a', { tenantId: 't1' }),
      ent('b', { tenantId: 't2' }),
      ent('c', { tenantId: 't1' }),
    ];
    const result = filter.apply({ tenantId: 't1' }, rows);
    expect(result.map((r) => r.name)).toEqual(['a', 'c']);
  });

  it('drops rows missing the attribute by default', () => {
    const filter = RowLevelFilter.entities().add(RowLevelFilter.byTenant<Entity & Record<string, unknown>>());
    const rows = [ent('a', { tenantId: 't1' }), ent('b')];
    const result = filter.apply({ tenantId: 't1' }, rows);
    expect(result.map((r) => r.name)).toEqual(['a']);
  });

  it('allows opting into permissive missing-attribute behavior', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byAttribute<Entity & Record<string, unknown>>('tenantId', { denyOnMissing: false }),
    );
    const rows = [ent('a', { tenantId: 't1' }), ent('b')];
    const result = filter.apply({ tenantId: 't1' }, rows);
    expect(result.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });
});

describe('RowLevelFilter.byClassificationCap', () => {
  const ranking = ['public', 'internal', 'classified', 'secret'] as const;

  it('subject can read rows at or below their clearance', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byClassificationCap<Entity & Record<string, unknown>>(
        'clearance',
        'classification',
        ranking,
      ),
    );
    const rows = [
      ent('p', { classification: 'public' }),
      ent('i', { classification: 'internal' }),
      ent('c', { classification: 'classified' }),
      ent('s', { classification: 'secret' }),
    ];
    expect(
      filter.apply({ clearance: 'classified' }, rows).map((r) => r.name).sort(),
    ).toEqual(['c', 'i', 'p']);
  });

  it('rows without classification pass through (unclassified)', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byClassificationCap<Entity & Record<string, unknown>>(
        'clearance',
        'classification',
        ranking,
      ),
    );
    const rows = [ent('u'), ent('p', { classification: 'public' })];
    expect(
      filter.apply({ clearance: 'public' }, rows).map((r) => r.name).sort(),
    ).toEqual(['p', 'u']);
  });

  it('subject without clearance denies all classified rows', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byClassificationCap<Entity & Record<string, unknown>>(
        'clearance',
        'classification',
        ranking,
      ),
    );
    const rows = [
      ent('p', { classification: 'public' }),
      ent('s', { classification: 'secret' }),
    ];
    expect(filter.apply({}, rows).map((r) => r.name)).toEqual([]);
  });
});

describe('RowLevelFilter composition', () => {
  it('AND combines multiple predicates', () => {
    const filter = RowLevelFilter.entities()
      .add(RowLevelFilter.byTenant<Entity & Record<string, unknown>>())
      .add(
        RowLevelFilter.byClassificationCap<Entity & Record<string, unknown>>(
          'clearance',
          'classification',
          ['public', 'secret'],
        ),
      );
    const rows = [
      ent('a', { tenantId: 't1', classification: 'public' }),
      ent('b', { tenantId: 't1', classification: 'secret' }),
      ent('c', { tenantId: 't2', classification: 'public' }),
    ];
    const result = filter.apply({ tenantId: 't1', clearance: 'public' }, rows);
    expect(result.map((r) => r.name)).toEqual(['a']);
  });

  it('permits() exposes single-row evaluation', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byTenant<Entity & Record<string, unknown>>(),
    );
    expect(filter.permits({ tenantId: 't1' }, ent('a', { tenantId: 't1' }))).toBe(true);
    expect(filter.permits({ tenantId: 't1' }, ent('a', { tenantId: 't2' }))).toBe(false);
  });

  it('empty filter passes everything through', () => {
    const filter = RowLevelFilter.entities();
    const rows = [ent('a'), ent('b')];
    expect(filter.apply({}, rows)).toEqual(rows);
  });
});

describe('RowLevelFilter.byTagOverlap', () => {
  it('row visible when its tags overlap with subject allowedTags', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byTagOverlap('allowedTags'),
    );
    const rows = [
      ent('a', { tags: ['finance', 'hr'] }),
      ent('b', { tags: ['eng'] }),
    ];
    const result = filter.apply({ allowedTags: ['hr'] }, rows);
    expect(result.map((r) => r.name)).toEqual(['a']);
  });

  it('row missing tags is denied (no overlap possible)', () => {
    const filter = RowLevelFilter.entities().add(
      RowLevelFilter.byTagOverlap('allowedTags'),
    );
    const rows = [ent('a'), ent('b', { tags: ['hr'] })];
    expect(filter.apply({ allowedTags: ['hr'] }, rows).map((r) => r.name)).toEqual(['b']);
  });
});
