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

  it('rejects contentHash with wrong length (63 or 65 chars)', () => {
    const tooShort = EntitySchema.safeParse({
      name: 'test-entity',
      entityType: 'conversation-turn',
      observations: ['x'],
      contentHash: 'a'.repeat(63),
    });
    const tooLong = EntitySchema.safeParse({
      name: 'test-entity',
      entityType: 'conversation-turn',
      observations: ['x'],
      contentHash: 'a'.repeat(65),
    });
    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });
});
