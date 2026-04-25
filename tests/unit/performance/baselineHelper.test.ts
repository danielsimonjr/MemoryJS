import { describe, it, expect } from 'vitest';
import { platformKey, getBaseline } from '../../performance/baselineHelper.js';

describe('baselineHelper', () => {
  it('platformKey returns a stable string for the active host', () => {
    const k = platformKey();
    expect(typeof k).toBe('string');
    expect(k.length).toBeGreaterThan(0);
    // Format: {platform}-{cpu-slug}
    expect(k.split('-').length).toBeGreaterThanOrEqual(2);
  });

  it('platformKey is deterministic across calls', () => {
    expect(platformKey()).toBe(platformKey());
  });

  it('getBaseline returns null when no row is present', () => {
    expect(getBaseline('nonexistent-test-name-xyz')).toBeNull();
  });
});
