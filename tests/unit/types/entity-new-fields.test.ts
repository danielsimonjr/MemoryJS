import { describe, it, expect } from 'vitest';
import type { Entity } from '../../../src/types/types.js';

describe('Entity new fields (v1.8.0)', () => {
  it('accepts projectId field', () => {
    const e: Entity = {
      name: 'test',
      entityType: 'thing',
      observations: [],
      projectId: 'proj-1',
    };
    expect(e.projectId).toBe('proj-1');
  });

  it('accepts version chain fields', () => {
    const e: Entity = {
      name: 'test-v2',
      entityType: 'thing',
      observations: [],
      version: 2,
      parentEntityName: 'test',
      rootEntityName: 'test',
      isLatest: true,
    };
    expect(e.version).toBe(2);
    expect(e.parentEntityName).toBe('test');
    expect(e.rootEntityName).toBe('test');
    expect(e.isLatest).toBe(true);
  });

  it('accepts supersededBy field', () => {
    const e: Entity = {
      name: 'old',
      entityType: 'thing',
      observations: [],
      isLatest: false,
      supersededBy: 'new',
    };
    expect(e.supersededBy).toBe('new');
    expect(e.isLatest).toBe(false);
  });

  it('allows all new fields to be omitted (back-compat)', () => {
    const e: Entity = {
      name: 'legacy',
      entityType: 'thing',
      observations: [],
    };
    expect(e.projectId).toBeUndefined();
    expect(e.version).toBeUndefined();
    expect(e.isLatest).toBeUndefined();
  });
});
