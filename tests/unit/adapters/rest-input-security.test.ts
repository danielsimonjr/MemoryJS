import { describe, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { RestRouter, type RestRequest } from '../../../src/adapters/RestRouter.js';
import { ApiKeyAuthMiddleware } from '../../../src/adapters/ApiKeyAuthMiddleware.js';
import { APIKeyStore } from '../../../src/security/APIKeyStore.js';
import type { ManagerContext } from '../../../src/core/ManagerContext.js';

const ctx = {} as ManagerContext;
const request = (path: string): RestRequest => ({
  method: 'GET', path, body: null, params: {}, query: {}, headers: {},
});

async function serve(router: RestRouter, chunks: string[], headers: Record<string, string> = {}) {
  const req = new IncomingMessage(new Socket());
  req.method = 'POST';
  req.url = '/body';
  req.headers = { 'content-type': 'application/json', ...headers };
  for (const chunk of chunks) req.push(Buffer.from(chunk));
  req.push(null);
  const output = { statusCode: 0, headersSent: false,
    setHeader: vi.fn(), getHeader: vi.fn(), end: vi.fn() };
  try {
    await router.serve(req, output as never);
    return { status: output.statusCode, body: JSON.parse(output.end.mock.calls[0][0]), output };
  } finally {
    req.destroy();
  }
}

describe('REST input boundaries', () => {
  it('accepts the byte limit and rejects oversized UTF-8 and chunked JSON', async () => {
    const router = new RestRouter(ctx, { maxBodyBytes: 6 });
    const handler = vi.fn(req => ({ status: 200, body: req.body }));
    router.post('/body', handler);
    expect((await serve(router, ['"🙂"'])).status).toBe(200);
    expect((await serve(router, ['"🙂a"'])).status).toBe(413);
    expect((await serve(router, ['{"a":', '123}'])).status).toBe(413);
    expect((await serve(router, [], { 'content-length': '7' })).status).toBe(413);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON without invoking the handler', async () => {
    const router = new RestRouter(ctx);
    const handler = vi.fn(() => ({ status: 200, body: {} }));
    router.post('/body', handler);
    expect((await serve(router, ['{bad'])).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('authenticates before consuming a body', async () => {
    const auth = new ApiKeyAuthMiddleware({ store: new APIKeyStore() });
    const router = new RestRouter(ctx, { auth, maxBodyBytes: 1 });
    expect((await serve(router, ['{bad'], { 'content-length': '99999' })).status).toBe(401);
  });

  it('returns 400 instead of rejecting dispatch for malformed URL encoding', async () => {
    const router = new RestRouter(ctx).get('/item/:name', () => ({ status: 200, body: {} }));
    expect((await router.dispatch(request('/item/%E0%A4%A'))).status).toBe(400);
  });

  it.each([undefined, 500, 503, 200, 999, NaN, 400.5])('redacts server errors and invalid status %s', async status => {
    const router = new RestRouter(ctx).get('/fail', () => {
      throw Object.assign(new Error('/private/database/password'), { status });
    });
    const response = await router.dispatch(request('/fail'));
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(response.status).toBe(status === 503 ? 503 : 500);
  });

  it('retains explicitly raised client errors', async () => {
    const router = new RestRouter(ctx).get('/fail', () => {
      throw Object.assign(new Error('Invalid entity'), { status: 422 });
    });
    expect(await router.dispatch(request('/fail'))).toEqual({ status: 422, body: { error: 'Invalid entity' } });
  });
});
