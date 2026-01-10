/**
 * Embedding Service Tests
 *
 * Phase 4 Sprint 10: Tests for embedding service implementations.
 *
 * @module __tests__/unit/search/EmbeddingService.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAIEmbeddingService,
  LocalEmbeddingService,
  MockEmbeddingService,
  createEmbeddingService,
} from '../../../src/search/EmbeddingService.js';
import { EMBEDDING_DEFAULTS } from '../../../src/utils/constants.js';

describe('OpenAIEmbeddingService', () => {
  const mockApiKey = 'sk-test-api-key';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw error when API key is missing', () => {
    expect(() => new OpenAIEmbeddingService('')).toThrow('OpenAI API key is required');
  });

  it('should have correct dimensions for text-embedding-3-small', () => {
    const service = new OpenAIEmbeddingService(mockApiKey);
    expect(service.dimensions).toBe(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS);
  });

  it('should have correct provider and model', () => {
    const service = new OpenAIEmbeddingService(mockApiKey);
    expect(service.provider).toBe('openai');
    expect(service.model).toBe(EMBEDDING_DEFAULTS.OPENAI_MODEL);
  });

  it('should accept custom model', () => {
    const customModel = 'text-embedding-3-large';
    const service = new OpenAIEmbeddingService(mockApiKey, customModel);
    expect(service.model).toBe(customModel);
  });

  it('should report ready when API key is set', async () => {
    const service = new OpenAIEmbeddingService(mockApiKey);
    expect(await service.isReady()).toBe(true);
  });

  it('should call OpenAI API for embed', async () => {
    const mockEmbedding = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
    const mockResponse = {
      ok: true,
      json: async () => ({
        object: 'list',
        data: [{ object: 'embedding', embedding: mockEmbedding, index: 0 }],
        model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

    const service = new OpenAIEmbeddingService(mockApiKey);
    const result = await service.embed('test text');

    expect(result).toEqual(mockEmbedding);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should call OpenAI API for embedBatch', async () => {
    const mockEmbedding1 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
    const mockEmbedding2 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.2);
    const mockResponse = {
      ok: true,
      json: async () => ({
        object: 'list',
        data: [
          { object: 'embedding', embedding: mockEmbedding1, index: 0 },
          { object: 'embedding', embedding: mockEmbedding2, index: 1 },
        ],
        model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
        usage: { prompt_tokens: 20, total_tokens: 20 },
      }),
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

    const service = new OpenAIEmbeddingService(mockApiKey);
    const results = await service.embedBatch(['text1', 'text2']);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(mockEmbedding1);
    expect(results[1]).toEqual(mockEmbedding2);
  });

  it('should return empty array for empty batch', async () => {
    const service = new OpenAIEmbeddingService(mockApiKey);
    const results = await service.embedBatch([]);
    expect(results).toEqual([]);
  });

  it('should sort results by index', async () => {
    const mockEmbedding1 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
    const mockEmbedding2 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.2);
    const mockResponse = {
      ok: true,
      json: async () => ({
        object: 'list',
        data: [
          // Return out of order
          { object: 'embedding', embedding: mockEmbedding2, index: 1 },
          { object: 'embedding', embedding: mockEmbedding1, index: 0 },
        ],
        model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
        usage: { prompt_tokens: 20, total_tokens: 20 },
      }),
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

    const service = new OpenAIEmbeddingService(mockApiKey);
    const results = await service.embedBatch(['text1', 'text2']);

    // Should be in correct order
    expect(results[0]).toEqual(mockEmbedding1);
    expect(results[1]).toEqual(mockEmbedding2);
  });

  it('should throw error on API error', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

    const service = new OpenAIEmbeddingService(mockApiKey);
    await expect(service.embed('test')).rejects.toThrow('OpenAI API error: 400');
  });

  it('should retry on rate limit (429)', async () => {
    const mockEmbedding = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
    const rateLimitResponse = {
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    };
    const successResponse = {
      ok: true,
      json: async () => ({
        object: 'list',
        data: [{ object: 'embedding', embedding: mockEmbedding, index: 0 }],
        model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(rateLimitResponse as Response)
      .mockResolvedValueOnce(successResponse as Response);

    const service = new OpenAIEmbeddingService(mockApiKey);
    const result = await service.embed('test');

    expect(result).toEqual(mockEmbedding);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('MockEmbeddingService', () => {
  it('should have correct default dimensions', () => {
    const service = new MockEmbeddingService();
    expect(service.dimensions).toBe(384);
  });

  it('should accept custom dimensions', () => {
    const service = new MockEmbeddingService(512);
    expect(service.dimensions).toBe(512);
  });

  it('should have correct provider and model', () => {
    const service = new MockEmbeddingService();
    expect(service.provider).toBe('mock');
    expect(service.model).toBe('mock-model');
  });

  it('should always be ready', async () => {
    const service = new MockEmbeddingService();
    expect(await service.isReady()).toBe(true);
  });

  it('should generate embedding with correct dimensions', async () => {
    const service = new MockEmbeddingService(384);
    const embedding = await service.embed('test text');
    expect(embedding).toHaveLength(384);
  });

  it('should generate deterministic embeddings for same text', async () => {
    const service = new MockEmbeddingService();
    const embedding1 = await service.embed('test text');
    const embedding2 = await service.embed('test text');
    expect(embedding1).toEqual(embedding2);
  });

  it('should generate different embeddings for different text', async () => {
    const service = new MockEmbeddingService();
    const embedding1 = await service.embed('text one');
    const embedding2 = await service.embed('text two');
    expect(embedding1).not.toEqual(embedding2);
  });

  it('should generate normalized embeddings', async () => {
    const service = new MockEmbeddingService();
    const embedding = await service.embed('test text');

    // Calculate magnitude
    let magnitude = 0;
    for (const v of embedding) {
      magnitude += v * v;
    }
    magnitude = Math.sqrt(magnitude);

    // Should be approximately 1 (unit vector)
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('should handle batch embeddings', async () => {
    const service = new MockEmbeddingService();
    const texts = ['text1', 'text2', 'text3'];
    const embeddings = await service.embedBatch(texts);

    expect(embeddings).toHaveLength(3);
    embeddings.forEach(embedding => {
      expect(embedding).toHaveLength(384);
    });
  });
});

describe('LocalEmbeddingService', () => {
  it('should have correct default dimensions', () => {
    const service = new LocalEmbeddingService();
    expect(service.dimensions).toBe(EMBEDDING_DEFAULTS.LOCAL_DIMENSIONS);
  });

  it('should have correct provider and model', () => {
    const service = new LocalEmbeddingService();
    expect(service.provider).toBe('local');
    expect(service.model).toBe(EMBEDDING_DEFAULTS.LOCAL_MODEL);
  });

  it('should accept custom model', () => {
    const customModel = 'custom/model';
    const service = new LocalEmbeddingService(customModel);
    expect(service.model).toBe(customModel);
  });

  it('should report not ready before initialization', async () => {
    // Mock import to fail
    vi.doMock('@xenova/transformers', () => {
      throw new Error('Module not found');
    });

    const service = new LocalEmbeddingService();
    const isReady = await service.isReady();
    // Should return false when transformers is not available
    expect(isReady).toBe(false);
  });
});

describe('createEmbeddingService factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null for provider "none"', () => {
    const service = createEmbeddingService({ provider: 'none' });
    expect(service).toBeNull();
  });

  it('should create OpenAI service with API key', () => {
    const service = createEmbeddingService({
      provider: 'openai',
      apiKey: 'sk-test',
    });
    expect(service).toBeInstanceOf(OpenAIEmbeddingService);
    expect(service?.provider).toBe('openai');
  });

  it('should throw error for OpenAI without API key', () => {
    expect(() => createEmbeddingService({ provider: 'openai' })).toThrow(
      'OpenAI API key is required'
    );
  });

  it('should create local service', () => {
    const service = createEmbeddingService({ provider: 'local' });
    expect(service).toBeInstanceOf(LocalEmbeddingService);
    expect(service?.provider).toBe('local');
  });

  it('should read from environment variables', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.MEMORY_OPENAI_API_KEY = 'sk-env-test';

    // Import to test env config - function reads process.env dynamically
    const { getEmbeddingConfig } = await import('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();

    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-env-test');
  });

  it('should use default provider when not set', async () => {
    delete process.env.MEMORY_EMBEDDING_PROVIDER;

    const { getEmbeddingConfig } = await import('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();

    expect(config.provider).toBe('none');
  });

  it('should pass custom model to service', () => {
    const service = createEmbeddingService({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'text-embedding-3-large',
    });
    expect((service as OpenAIEmbeddingService).model).toBe('text-embedding-3-large');
  });
});
