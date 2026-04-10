import { describe, it, expect } from 'vitest';
import { isProfileEntity } from '../../../src/types/agent-memory.js';
import type { Entity } from '../../../src/types/types.js';

describe('ProfileEntity type guard', () => {
  it('identifies profile entities', () => {
    const e: Entity = {
      name: 'profile-global',
      entityType: 'profile',
      observations: ['[static] Prefers TypeScript'],
    };
    expect(isProfileEntity(e)).toBe(true);
  });

  it('rejects non-profile entities', () => {
    const e: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: [],
    };
    expect(isProfileEntity(e)).toBe(false);
  });
});
