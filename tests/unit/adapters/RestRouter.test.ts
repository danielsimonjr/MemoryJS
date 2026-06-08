/**
 * RestRouter Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RestRouter, type RestRequest } from '../../../src/adapters/RestRouter.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';

function makeRequest(partial: Partial<RestRequest>): RestRequest {
  return {
    method: 'GET',
    path: '/',
    params: {},
    query: {},
    body: null,
    headers: {},
    ...partial,
  };
}

describe('RestRouter', () => {
  let ctx: ManagerContext;
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `rest-router-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    ctx = new ManagerContext(join(dir, 'mem.jsonl'));
    await ctx.storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['developer'] },
        { name: 'Bob', entityType: 'person', observations: ['manager'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    ctx.storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('dispatches GET to a registered handler', async () => {
    const router = new RestRouter(ctx);
    router.get('/ping', () => ({ status: 200, body: { ok: true } }));
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/ping' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('extracts path params from `:name` segments', async () => {
    const router = new RestRouter(ctx);
    router.get('/users/:id', (req) => ({ status: 200, body: { id: req.params.id } }));
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/users/42' }));
    expect(res.body).toEqual({ id: '42' });
  });

  it('returns 404 when no route matches', async () => {
    const router = new RestRouter(ctx);
    router.get('/foo', () => ({ status: 200, body: null }));
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/bar' }));
    expect(res.status).toBe(404);
  });

  it('returns 500 when a handler throws (logs the error)', async () => {
    const router = new RestRouter(ctx);
    router.get('/boom', () => {
      throw new Error('fail');
    });
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/boom' }));
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('fail');
  });

  it('honours a thrown error.status when present', async () => {
    const router = new RestRouter(ctx);
    router.get('/forbidden', () => {
      const err: Error & { status?: number } = new Error('nope');
      err.status = 403;
      throw err;
    });
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/forbidden' }));
    expect(res.status).toBe(403);
  });

  it('routes by method (GET vs POST on same pattern)', async () => {
    const router = new RestRouter(ctx);
    router.get('/x', () => ({ status: 200, body: 'get' }));
    router.post('/x', () => ({ status: 200, body: 'post' }));
    const get = await router.dispatch(makeRequest({ method: 'GET', path: '/x' }));
    const post = await router.dispatch(makeRequest({ method: 'POST', path: '/x' }));
    expect(get.body).toBe('get');
    expect(post.body).toBe('post');
  });

  it('list() returns the registered routes', () => {
    const router = new RestRouter(ctx);
    router.get('/a', () => ({ status: 200, body: null }));
    router.post('/b', () => ({ status: 200, body: null }));
    expect(router.list().map((r) => `${r.method} ${r.pattern}`)).toEqual(['GET /a', 'POST /b']);
  });

  it('withDefaults wires entity + search routes', async () => {
    const router = RestRouter.withDefaults(ctx);
    const list = await router.dispatch(makeRequest({ method: 'GET', path: '/entities' }));
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { entities: unknown[] }).entities)).toBe(true);

    const get = await router.dispatch(makeRequest({ method: 'GET', path: '/entities/Alice' }));
    expect(get.status).toBe(200);

    const missing = await router.dispatch(
      makeRequest({ method: 'GET', path: '/entities/Nobody' }),
    );
    expect(missing.status).toBe(404);
  });
});
