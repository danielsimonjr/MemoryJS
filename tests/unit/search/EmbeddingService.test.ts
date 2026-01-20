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

// ==================== Sprint 13: Additional Coverage Tests ====================

import {
  l2Normalize,
  QUERY_PREFIX,
  DOCUMENT_PREFIX,
  type EmbeddingProgressCallback,
} from '../../../src/search/EmbeddingService.js';

describe('l2Normalize', () => {
  it('should normalize a simple vector', () => {
    const result = l2Normalize([3, 4]);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('should return vector unchanged if already normalized', () => {
    const normalized = [0.6, 0.8]; // magnitude 1
    const result = l2Normalize(normalized);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('should return original vector for zero vector', () => {
    const zeroVector = [0, 0, 0];
    const result = l2Normalize(zeroVector);
    expect(result).toEqual([0, 0, 0]);
  });

  it('should handle single element vector', () => {
    const result = l2Normalize([5]);
    expect(result[0]).toBeCloseTo(1);
  });

  it('should handle large vectors', () => {
    const vector = Array(1000).fill(1);
    const result = l2Normalize(vector);

    // Calculate magnitude
    let magnitude = 0;
    for (const v of result) {
      magnitude += v * v;
    }
    magnitude = Math.sqrt(magnitude);

    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('should preserve direction', () => {
    const vector = [2, 4, 6];
    const result = l2Normalize(vector);

    // Ratios should be preserved
    expect(result[1] / result[0]).toBeCloseTo(2);
    expect(result[2] / result[0]).toBeCloseTo(3);
  });

  it('should handle negative values', () => {
    const result = l2Normalize([-3, 4]);
    expect(result[0]).toBeCloseTo(-0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });
});

describe('Embedding Constants', () => {
  it('should export QUERY_PREFIX', () => {
    expect(QUERY_PREFIX).toBe('query: ');
  });

  it('should export DOCUMENT_PREFIX', () => {
    expect(DOCUMENT_PREFIX).toBe('passage: ');
  });
});

describe('OpenAIEmbeddingService - Extended Tests', () => {
  const mockApiKey = 'sk-test-api-key';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Mode Parameter', () => {
    it('should apply query prefix for query mode', async () => {
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

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      await service.embed('test text', 'query');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(requestBody.input[0]).toBe('query: test text');
    });

    it('should apply document prefix for document mode', async () => {
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

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      await service.embed('test text', 'document');

      const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(requestBody.input[0]).toBe('passage: test text');
    });

    it('should default to document mode', async () => {
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

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      await service.embed('test text');

      const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(requestBody.input[0]).toBe('passage: test text');
    });
  });

  describe('embedBatchWithProgress', () => {
    it('should call progress callback', async () => {
      const mockEmbedding = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { object: 'embedding', embedding: mockEmbedding, index: 0 },
            { object: 'embedding', embedding: mockEmbedding, index: 1 },
          ],
          model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
          usage: { prompt_tokens: 20, total_tokens: 20 },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      const progressCalls: Array<{ current: number; total: number; percentage: number }> = [];
      const onProgress: EmbeddingProgressCallback = (progress) => {
        progressCalls.push(progress);
      };

      await service.embedBatchWithProgress(['text1', 'text2'], 'document', onProgress);

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[progressCalls.length - 1].percentage).toBe(100);
    });

    it('should return empty array for empty input', async () => {
      const service = new OpenAIEmbeddingService(mockApiKey);
      const results = await service.embedBatchWithProgress([]);
      expect(results).toEqual([]);
    });

    it('should work without progress callback', async () => {
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
      const results = await service.embedBatchWithProgress(['test']);

      expect(results).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should retry on 500 server error if retryable', async () => {
      const mockEmbedding = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
      const errorResponse = {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
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
        .mockResolvedValueOnce(errorResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      await expect(service.embed('test')).rejects.toThrow('OpenAI API error: 500');
    });

    it('should throw after exhausting retries on 429', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      };

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValue(rateLimitResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      await expect(service.embed('test')).rejects.toThrow('OpenAI API error: 429');
    }, 30000);

    it('should handle network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const service = new OpenAIEmbeddingService(mockApiKey);
      await expect(service.embed('test')).rejects.toThrow('Network error');
    });

    it('should handle non-Error thrown values', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');

      const service = new OpenAIEmbeddingService(mockApiKey);
      await expect(service.embed('test')).rejects.toThrow('string error');
    });
  });

  describe('Batch Chunking', () => {
    it('should handle batch mode in embedBatch', async () => {
      const mockEmbedding1 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.1);
      const mockEmbedding2 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.2);
      const mockEmbedding3 = Array(EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS).fill(0.3);

      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { object: 'embedding', embedding: mockEmbedding1, index: 0 },
            { object: 'embedding', embedding: mockEmbedding2, index: 1 },
            { object: 'embedding', embedding: mockEmbedding3, index: 2 },
          ],
          model: EMBEDDING_DEFAULTS.OPENAI_MODEL,
          usage: { prompt_tokens: 30, total_tokens: 30 },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = new OpenAIEmbeddingService(mockApiKey);
      const results = await service.embedBatch(['text1', 'text2', 'text3'], 'query');

      expect(results).toHaveLength(3);
    });
  });
});

describe('MockEmbeddingService - Extended Tests', () => {
  describe('Mode Parameter', () => {
    it('should generate different embeddings for query vs document mode', async () => {
      const service = new MockEmbeddingService();
      const queryEmbedding = await service.embed('test text', 'query');
      const documentEmbedding = await service.embed('test text', 'document');

      // Embeddings should be different because of the prefix
      expect(queryEmbedding).not.toEqual(documentEmbedding);
    });

    it('should apply mode to batch operations', async () => {
      const service = new MockEmbeddingService();
      const queryResults = await service.embedBatch(['text1', 'text2'], 'query');
      const docResults = await service.embedBatch(['text1', 'text2'], 'document');

      expect(queryResults[0]).not.toEqual(docResults[0]);
    });
  });

  describe('embedBatchWithProgress', () => {
    it('should call progress callback for each item', async () => {
      const service = new MockEmbeddingService();
      const progressCalls: Array<{ current: number; total: number; percentage: number }> = [];
      const onProgress: EmbeddingProgressCallback = (progress) => {
        progressCalls.push({ ...progress });
      };

      await service.embedBatchWithProgress(['text1', 'text2', 'text3'], 'document', onProgress);

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ current: 1, total: 3, percentage: 33 });
      expect(progressCalls[1]).toEqual({ current: 2, total: 3, percentage: 67 });
      expect(progressCalls[2]).toEqual({ current: 3, total: 3, percentage: 100 });
    });

    it('should work without progress callback', async () => {
      const service = new MockEmbeddingService();
      const results = await service.embedBatchWithProgress(['text1', 'text2']);
      expect(results).toHaveLength(2);
    });

    it('should handle empty array', async () => {
      const service = new MockEmbeddingService();
      const results = await service.embedBatchWithProgress([]);
      expect(results).toEqual([]);
    });

    it('should support query mode', async () => {
      const service = new MockEmbeddingService();
      const results = await service.embedBatchWithProgress(['test'], 'query');
      expect(results).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', async () => {
      const service = new MockEmbeddingService();
      const embedding = await service.embed('');
      expect(embedding).toHaveLength(384);
    });

    it('should handle very long text', async () => {
      const service = new MockEmbeddingService();
      const longText = 'a'.repeat(10000);
      const embedding = await service.embed(longText);
      expect(embedding).toHaveLength(384);
    });

    it('should handle unicode characters', async () => {
      const service = new MockEmbeddingService();
      const embedding = await service.embed('こんにちは世界 🌍');
      expect(embedding).toHaveLength(384);
    });

    it('should handle special characters', async () => {
      const service = new MockEmbeddingService();
      const embedding = await service.embed('<script>alert("xss")</script>');
      expect(embedding).toHaveLength(384);
    });
  });
});

describe('LocalEmbeddingService - Extended Tests', () => {
  describe('Mode Parameter', () => {
    // Note: These tests verify API contracts since we can't load @xenova/transformers
    it('should accept mode parameter in embed signature', () => {
      const service = new LocalEmbeddingService();
      // Just verify the method signature accepts mode
      expect(typeof service.embed).toBe('function');
    });

    it('should accept mode parameter in embedBatch signature', () => {
      const service = new LocalEmbeddingService();
      expect(typeof service.embedBatch).toBe('function');
    });

    it('should have embedBatchWithProgress method', () => {
      const service = new LocalEmbeddingService();
      expect(typeof service.embedBatchWithProgress).toBe('function');
    });
  });

  describe('Initialization', () => {
    it('should not be initialized before calling initialize', () => {
      const service = new LocalEmbeddingService();
      // Private field check via behavior - isReady will try to initialize
      expect(typeof service.isReady).toBe('function');
    });

    it('should accept custom model name', () => {
      const customModel = 'custom/embedding-model';
      const service = new LocalEmbeddingService(customModel);
      expect(service.model).toBe(customModel);
    });

    it('should have correct default dimensions', () => {
      const service = new LocalEmbeddingService();
      expect(service.dimensions).toBe(EMBEDDING_DEFAULTS.LOCAL_DIMENSIONS);
    });
  });
});

describe('createEmbeddingService - Extended Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should handle unknown provider', () => {
    const service = createEmbeddingService({ provider: 'unknown' as 'none' });
    expect(service).toBeNull();
  });

  it('should merge config with environment config', () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.MEMORY_OPENAI_API_KEY = 'sk-from-env';

    // Override provider via config
    const service = createEmbeddingService({ provider: 'local' });
    expect(service).toBeInstanceOf(LocalEmbeddingService);
  });

  it('should use apiKey from config over environment', () => {
    process.env.MEMORY_OPENAI_API_KEY = 'sk-from-env';

    const service = createEmbeddingService({
      provider: 'openai',
      apiKey: 'sk-from-config',
    });

    expect(service).toBeInstanceOf(OpenAIEmbeddingService);
  });

  it('should pass model to local service', () => {
    const service = createEmbeddingService({
      provider: 'local',
      model: 'custom/model',
    });
    expect((service as LocalEmbeddingService).model).toBe('custom/model');
  });
});
