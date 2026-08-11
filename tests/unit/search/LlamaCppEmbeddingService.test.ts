/**
 * LlamaCppEmbeddingService — embeddings from a local llama.cpp server.
 *
 * Added for the librarian application, which indexes ~62,000 documents from a personal
 * Dropbox. Cloud embedding is not an option there: the corpus contains medical,
 * financial and employment records, and the standing rule is local models unless
 * explicitly authorised. The existing `local` provider (transformers.js /
 * all-MiniLM-L6-v2, 384-dim) works but is a fixed small model; llama.cpp serves any
 * GGUF, including the 4096-dim qwen3-embedding already on the machine.
 *
 * THE PROPERTY THAT MATTERS MOST: dimensions are DISCOVERED, never assumed.
 *
 * OpenAIEmbeddingService and LocalEmbeddingService can hardcode `dimensions` because
 * each is pinned to one model. A llama.cpp server serves whatever GGUF it was started
 * with, so a hardcoded constant would be a guess that silently corrupts every stored
 * vector when it is wrong. This is not hypothetical — a 4096-dim model was recently
 * mis-estimated as producing a 189 MB store when the true figure was 484 MB, because a
 * remembered constant stood in for a measurement.
 *
 * A vector store keyed on the wrong dimension does not error. It just returns
 * confident nonsense.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlamaCppEmbeddingService } from '../../../src/search/EmbeddingService.js';

const ORIGINAL_FETCH = globalThis.fetch;

function mockEmbeddings(vectors: number[][], status = 200) {
  const body = JSON.stringify({
    data: vectors.map((embedding, index) => ({ embedding, index })),
  });
  return vi.fn(async () => ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    text: async () => status === 200 ? body : 'error body',
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('LlamaCppEmbeddingService', () => {
  describe('dimension discovery', () => {
    it('discovers dimensions from the server rather than assuming them', async () => {
      globalThis.fetch = mockEmbeddings([new Array(4096).fill(0.01)]);
      const svc = new LlamaCppEmbeddingService();
      expect(await svc.isReady()).toBe(true);
      expect(svc.dimensions).toBe(4096);
    });

    it('reports a different model’s dimensions correctly', async () => {
      globalThis.fetch = mockEmbeddings([new Array(768).fill(0.01)]);
      const svc = new LlamaCppEmbeddingService();
      await svc.isReady();
      expect(svc.dimensions).toBe(768);
    });

    it('probes only once, then caches', async () => {
      const f = mockEmbeddings([new Array(384).fill(0.5)]);
      globalThis.fetch = f;
      const svc = new LlamaCppEmbeddingService();
      await svc.isReady();
      await svc.isReady();
      expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('reports dimensions as 0 before any probe, never a plausible guess', () => {
      const svc = new LlamaCppEmbeddingService();
      expect(svc.dimensions).toBe(0);
    });
  });

  describe('dimension drift', () => {
    it('throws if the server later returns a different dimension', async () => {
      // The server was restarted with a different GGUF. Every vector already stored is
      // now incomparable; silently accepting the new size corrupts the index.
      let dim = 4096;
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: [{ embedding: new Array(dim).fill(0.01), index: 0 }],
        }),
      })) as unknown as typeof fetch;

      const svc = new LlamaCppEmbeddingService();
      await svc.isReady();
      dim = 768;
      await expect(svc.embed('text')).rejects.toThrow(/dimension/i);
    });
  });

  describe('embedding', () => {
    it('returns an L2-normalised vector so cosine equals dot product', async () => {
      globalThis.fetch = mockEmbeddings([[3, 4]]);
      const svc = new LlamaCppEmbeddingService();
      const v = await svc.embed('hello');
      const magnitude = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(magnitude).toBeCloseTo(1, 6);
      expect(v[0]).toBeCloseTo(0.6, 6);
    });

    it('embeds a batch in one request', async () => {
      const f = mockEmbeddings([[1, 0], [0, 1]]);
      globalThis.fetch = f;
      const svc = new LlamaCppEmbeddingService();
      const out = await svc.embedBatch(['a', 'b']);
      expect(out).toHaveLength(2);
      expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe('error');
    });

    it('preserves batch ORDER even if the server returns results out of order', async () => {
      // The response carries an explicit `index`; trusting array position instead
      // would attach each document's vector to a different document -- undetectable
      // downstream, and exactly the cross-contamination class this project keeps hitting.
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: [
            { embedding: [0, 1], index: 1 },
            { embedding: [1, 0], index: 0 },
          ],
        }),
      })) as unknown as typeof fetch;
      const svc = new LlamaCppEmbeddingService();
      const out = await svc.embedBatch(['first', 'second']);
      expect(out[0]).toEqual([1, 0]);
      expect(out[1]).toEqual([0, 1]);
    });

    it('returns [] for an empty batch without calling the server', async () => {
      const f = mockEmbeddings([]);
      globalThis.fetch = f;
      const svc = new LlamaCppEmbeddingService();
      expect(await svc.embedBatch([])).toEqual([]);
      expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });

    it('rejects an empty text rather than storing a meaningless vector', async () => {
      globalThis.fetch = mockEmbeddings([[1, 0]]);
      const svc = new LlamaCppEmbeddingService();
      await expect(svc.embed('   ')).rejects.toThrow(/empty/i);
    });
  });

  describe('failure handling', () => {
    it('isReady returns false when the server is unreachable, and does not throw', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      const svc = new LlamaCppEmbeddingService();
      expect(await svc.isReady()).toBe(false);
    });

    it('surfaces a server error instead of returning a zero vector', async () => {
      globalThis.fetch = mockEmbeddings([], 500);
      const svc = new LlamaCppEmbeddingService();
      await expect(svc.embed('text')).rejects.toThrow(/status 500/i);
      await expect(svc.embed('text')).rejects.not.toThrow(/error body/i);
    });

    it('fails when the server returns fewer vectors than inputs', async () => {
      // Silently padding or truncating would mis-align documents to vectors.
      globalThis.fetch = mockEmbeddings([[1, 0]]);
      const svc = new LlamaCppEmbeddingService();
      await expect(svc.embedBatch(['a', 'b', 'c'])).rejects.toThrow(/expected 3/i);
    });

    it('rejects non-finite vector values', async () => {
      globalThis.fetch = mockEmbeddings([[1, Number.NaN]]);
      const svc = new LlamaCppEmbeddingService();
      await expect(svc.embed('text')).rejects.toThrow(/invalid embedding vector/i);
    });

    it('rejects responses whose declared size exceeds the cap', async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(17 * 1024 * 1024) }),
        text: async () => '{}',
      })) as unknown as typeof fetch;
      const svc = new LlamaCppEmbeddingService();
      await expect(svc.embed('text')).rejects.toThrow(/size limit/i);
    });

    it('reports request timeouts without exposing network details', async () => {
      globalThis.fetch = vi.fn(async () => {
        const error = new Error('http://internal-host/private');
        error.name = 'TimeoutError';
        throw error;
      }) as unknown as typeof fetch;
      const svc = new LlamaCppEmbeddingService({ requestTimeoutMs: 25 });
      await expect(svc.embed('text')).rejects.toThrow(/timed out after 25ms/i);
      await expect(svc.embed('text')).rejects.not.toThrow(/internal-host/i);
    });
  });

  describe('configuration', () => {
    it('defaults to the conventional llama.cpp port', () => {
      expect(new LlamaCppEmbeddingService().baseUrl).toContain('8080');
    });

    it('accepts a custom base URL and strips a trailing slash', () => {
      const svc = new LlamaCppEmbeddingService({ baseUrl: 'http://127.0.0.1:9999/' });
      expect(svc.baseUrl).toBe('http://127.0.0.1:9999');
    });

    it('rejects non-HTTP protocols and non-loopback hosts by default', () => {
      expect(() => new LlamaCppEmbeddingService({ baseUrl: 'file:///tmp/socket' }))
        .toThrow(/http or https/i);
      expect(() => new LlamaCppEmbeddingService({ baseUrl: 'http://169.254.169.254' }))
        .toThrow(/not allowed/i);
    });

    it('allows an explicitly allowlisted remote host', () => {
      const svc = new LlamaCppEmbeddingService({
        baseUrl: 'https://embeddings.example.com/',
        allowedHosts: ['embeddings.example.com'],
      });
      expect(svc.baseUrl).toBe('https://embeddings.example.com');
    });

    it('identifies its provider so a stored vector records what produced it', () => {
      expect(new LlamaCppEmbeddingService().provider).toBe('llamacpp');
    });
  });
});
