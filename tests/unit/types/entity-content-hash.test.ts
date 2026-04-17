import { describe, it, expect } from 'vitest';
import { EntitySchema, CreateEntitySchema, UpdateEntitySchema } from '../../../src/utils/schemas.js';

describe('Entity.contentHash', () => {
  const baseEntity = {
    name: 'test-entity',
    entityType: 'conversation-turn',
    observations: ['[role=user] hello'],
  };

  it('accepts optional contentHash in EntitySchema', () => {
    const result = EntitySchema.safeParse({ ...baseEntity, contentHash: 'a'.repeat(64) });
    expect(result.success).toBe(true);
  });

  it('accepts entity without contentHash (optional)', () => {
    const result = EntitySchema.safeParse(baseEntity);
    expect(result.success).toBe(true);
  });

  it('accepts contentHash in CreateEntitySchema', () => {
    const result = CreateEntitySchema.safeParse({ ...baseEntity, contentHash: 'b'.repeat(64) });
    expect(result.success).toBe(true);
  });

  it('accepts contentHash in UpdateEntitySchema', () => {
    const result = UpdateEntitySchema.safeParse({ contentHash: 'c'.repeat(64) });
    expect(result.success).toBe(true);
  });

  it('rejects non-string contentHash', () => {
    const result = EntitySchema.safeParse({ ...baseEntity, contentHash: 12345 });
    expect(result.success).toBe(false);
  });
});
