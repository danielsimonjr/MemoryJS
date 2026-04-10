import { describe, it, expect, afterEach } from 'vitest';

describe('Zero-config semantic search default', () => {
  const originalEnv = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MEMORY_EMBEDDING_PROVIDER;
    } else {
      process.env.MEMORY_EMBEDDING_PROVIDER = originalEnv;
    }
  });

  it('defaults embedding provider to local when env var not set', async () => {
    delete process.env.MEMORY_EMBEDDING_PROVIDER;
    // Dynamic import to pick up env change
    const mod = await import('../../../src/utils/constants.js');
    const config = mod.getEmbeddingConfig();
    expect(config.provider).toBe('local');
  });

  it('respects explicit none setting', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const mod = await import('../../../src/utils/constants.js');
    const config = mod.getEmbeddingConfig();
    expect(config.provider).toBe('none');
  });
});
