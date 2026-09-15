import { describe, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { RestRouter, type RestRequest } from '../../../src/adapters/RestRouter.js';
import { ApiKeyAuthMiddleware } from '../../../src/adapters/ApiKeyAuthMiddleware.js';
import { RateLimiter } from '../../../src/adapters/RateLimiter.js';
import { APIKeyStore } from '../../../src/security/APIKeyStore.js';
import type { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { Entity } from '../../../src/types/types.js';

const entities: Entity[] = [
  { name: 'a1', entityType: 't', observations: ['secret-a'], projectId: 'A' },
  { name: 'a2', entityType: 't', observations: ['secret-a'], projectId: 'A' },
  { name: 'b1', entityType: 't', observations: ['secret-b'], projectId: 'B' },
  { name: 'legacy', entityType: 't', observations: ['secret-none'] },
];

function fakeCtx() {
  const deleteEntities = vi.fn(async () => undefined);
  const createEntities = vi.fn(async (e: Entity[]) => e);
  const searchNodes = vi.fn(async () => ({ entities, relations: [] }));
  const ctx = {
    storage: { loadGraph: async () => ({ entities, relations: [] }) },
    entityManager: {
      getEntity: async (name: string) => entities.find(e => e.name === name) ?? null,
      deleteEntities,
      createEntities,
    },
    searchManager: { searchNodes },
    relationManager: { getRelations: async () => [] as unknown[] },
  } as unknown as ManagerContext;
  return { ctx, deleteEntities, createEntities, searchNodes };
}

function setup(issue: Parameters<APIKeyStore['issue']>[0]) {
  const store = new APIKeyStore();
  const { plaintext } = store.issue(issue);
  const fake = fakeCtx();
  const router = RestRouter.withDefaults(fake.ctx, { auth: new ApiKeyAuthMiddleware({ store }) });
  const call = (method: RestRequest['method'], path: string, query: Record<string, string> = {}, body: unknown = null) =>
    router.dispatch({ method, path, query, body, params: {}, headers: { authorization: `Bearer ${plaintext}` } });
  return { ...fake, router, call };
}

const names = (body: unknown) => (body as { entities: Entity[] }).entities.map(e => e.name);

describe('APIKeyStore project scoping', () => {
  it('stores, validates and round-trips projectIds', () => {
    const store = new APIKeyStore();
    const { plaintext, record } = store.issue({ scopes: ['entities:read'], projectIds: ['A', 'A', 'B'] });
    expect(record.projectIds).toEqual(['A', 'B']);
    expect(store.validate(plaintext).projectIds).toEqual(['A', 'B']);
    const copy = new APIKeyStore();
    copy.load(store.serialize());
    expect(copy.validate(plaintext).projectIds).toEqual(['A', 'B']);
  });

  it('keeps legacy records without projectIds loadable', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ scopes: [] });
    const records = store.serialize().map(({ projectIds: _p, ...r }) => r);
    const copy = new APIKeyStore();
    copy.load(records);
    expect(copy.validate(plaintext).projectIds).toBeUndefined();
  });

  it.each([[['']], [[1]], ['A'], [Array(1001).fill('x').map((x, i) => x + i)], [['x'.repeat(257)]]])(
    'rejects invalid projectIds %#', (projectIds) => {
      const store = new APIKeyStore();
      expect(() => store.issue({ projectIds: projectIds as string[] })).toThrow(TypeError);
      const good = new APIKeyStore();
      good.issue({});
      const bad = good.serialize().map(r => ({ ...r, projectIds }));
      expect(() => new APIKeyStore().load(bad as never)).toThrow(TypeError);
    });
});

describe('RestRouter tenancy', () => {
  const scoped = { scopes: ['entities:read', 'entities:write'], projectIds: ['A'] };

  it('filters list before pagination so totals hide other projects', async () => {
    const { call } = setup(scoped);
    const res = await call('GET', '/entities', { limit: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2 });
    expect(names(res.body)).toEqual(['a1']);
    const page2 = await call('GET', '/entities', { limit: '1', offset: '1' });
    expect(names(page2.body)).toEqual(['a2']);
    expect((page2.body as { nextCursor?: unknown }).nextCursor).toBeFalsy();
  });

  it('filters search results before pagination and pushes each project down', async () => {
    const { call, searchNodes } = setup(scoped);
    const res = await call('GET', '/search', { q: 'secret' });
    expect(res.body).toMatchObject({ total: 2 });
    expect(names(res.body)).toEqual(['a1', 'a2']);
    expect(searchNodes).toHaveBeenCalledWith('secret', { projectId: 'A' });
    const multi = setup({ scopes: ['entities:read'], projectIds: ['A', 'B'] });
    const both = await multi.call('GET', '/search', { q: 'secret' });
    expect(names(both.body)).toEqual(['a1', 'a2', 'b1']);
    expect(multi.searchNodes).toHaveBeenCalledTimes(2);
  });

  it('returns the same 404 for foreign, unprojected and missing entities', async () => {
    const { call } = setup(scoped);
    expect((await call('GET', '/entities/a1')).status).toBe(200);
    const foreign = await call('GET', '/entities/b1');
    const legacy = await call('GET', '/entities/legacy');
    const missing = await call('GET', '/entities/nope');
    expect(foreign).toEqual(missing);
    expect(legacy).toEqual(missing);
    expect(missing).toEqual({ status: 404, body: { error: 'Not Found' } });
  });

  it('refuses a scoped delete that would remove a relation to a foreign entity', async () => {
    const { ctx, deleteEntities } = fakeCtx();
    const relations = [{ from: 'b1', to: 'a2', relationType: 'uses' }, { from: 'a1', to: 'gone', relationType: 'uses' }];
    (ctx.relationManager as { getRelations: unknown }).getRelations = async (n: string) =>
      relations.filter((r) => r.from === n || r.to === n);
    const store = new APIKeyStore();
    const { plaintext } = store.issue(scoped);
    const router = RestRouter.withDefaults(ctx, { auth: new ApiKeyAuthMiddleware({ store }) });
    const del = (name: string) => router.dispatch({ method: 'DELETE', path: `/entities/${name}`, query: {}, body: null, params: {}, headers: { authorization: `Bearer ${plaintext}` } });
    expect((await del('a2')).status).toBe(409);
    expect((await del('a1')).status).toBe(204);
    expect(deleteEntities).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when a concurrent create skips the name', async () => {
    const { call, createEntities } = setup(scoped);
    createEntities.mockResolvedValueOnce([]);
    expect((await call('POST', '/entities', {}, { name: 'n', entityType: 't', observations: [], projectId: 'A' })).status).toBe(409);
  });

  it('refuses to delete foreign entities with 404', async () => {
    const { call, deleteEntities } = setup(scoped);
    expect((await call('DELETE', '/entities/b1')).status).toBe(404);
    expect(deleteEntities).not.toHaveBeenCalled();
    expect((await call('DELETE', '/entities/a1')).status).toBe(204);
    expect(deleteEntities).toHaveBeenCalledWith(['a1']);
  });

  it('validates the project on create', async () => {
    const { call, createEntities } = setup(scoped);
    const base = { name: 'n', entityType: 't', observations: [] };
    expect((await call('POST', '/entities', {}, base)).status).toBe(403);
    expect((await call('POST', '/entities', {}, { ...base, projectId: 'B' })).status).toBe(403);
    expect((await call('POST', '/entities', {}, { ...base, name: 'b1', projectId: 'A' })).status).toBe(409);
    expect(createEntities).not.toHaveBeenCalled();
    expect((await call('POST', '/entities', {}, { ...base, projectId: 'A' })).status).toBe(201);
    expect(createEntities).toHaveBeenCalledWith([{ ...base, projectId: 'A' }]);
  });

  it('requires entities:read for project-scoped reads', async () => {
    const { call } = setup({ scopes: [], projectIds: ['A'] });
    expect((await call('GET', '/entities')).status).toBe(403);
  });

  it('an empty project list grants no data', async () => {
    const { call } = setup({ scopes: ['entities:read'], projectIds: [] });
    expect((await call('GET', '/entities')).body).toMatchObject({ total: 0 });
  });

  it('a legacy key without projectIds keeps full access', async () => {
    const { call, searchNodes } = setup({ scopes: ['entities:write'] });
    expect((await call('GET', '/entities')).body).toMatchObject({ total: 4 });
    expect((await call('GET', '/entities/b1')).status).toBe(200);
    expect((await call('GET', '/search', { q: 'x' })).body).toMatchObject({ total: 4 });
    expect(searchNodes).toHaveBeenCalledWith('x');
    expect((await call('DELETE', '/entities/b1')).status).toBe(204);
    expect((await call('POST', '/entities', {}, { name: 'n', entityType: 't', observations: [] })).status).toBe(201);
  });

  it('the unauthenticated opt-in keeps full access and still requires the flag', async () => {
    const { ctx } = fakeCtx();
    expect(() => RestRouter.withDefaults(ctx)).toThrow(/allowUnauthenticated/);
    const router = RestRouter.withDefaults(ctx, { allowUnauthenticated: true });
    const res = await router.dispatch({ method: 'GET', path: '/entities', query: {}, body: null, params: {}, headers: {} });
    expect(res.body).toMatchObject({ total: 4 });
  });
});

describe('RestRouter request limits', () => {
  const open = () => {
    const fake = fakeCtx();
    const router = RestRouter.withDefaults(fake.ctx, {
      allowUnauthenticated: true,
      limits: { maxQueryLength: 5, maxObservations: 2, maxObservationLength: 4, maxNameLength: 3 },
    });
    const call = (method: RestRequest['method'], path: string, query: Record<string, string> = {}, body: unknown = null) =>
      router.dispatch({ method, path, query, body, params: {}, headers: {} });
    return { ...fake, call };
  };

  it('bounds query length', async () => {
    const { call, searchNodes } = open();
    expect((await call('GET', '/search', { q: 'abcdef' })).status).toBe(400);
    expect(searchNodes).not.toHaveBeenCalled();
  });

  it('bounds names, observation count and observation size', async () => {
    const { call, createEntities } = open();
    expect((await call('POST', '/entities', {}, { name: 'long', entityType: 't', observations: [] })).status).toBe(400);
    expect((await call('POST', '/entities', {}, { name: 'n', entityType: 't', observations: ['a', 'b', 'c'] })).status).toBe(413);
    expect((await call('POST', '/entities', {}, { name: 'n', entityType: 't', observations: ['abcde'] })).status).toBe(413);
    expect(createEntities).not.toHaveBeenCalled();
  });

  it('dispatch enforces the body limit itself', async () => {
    const router = new RestRouter({} as ManagerContext, { maxBodyBytes: 10 });
    const handler = vi.fn(() => ({ status: 200, body: {} }));
    router.post('/x', handler);
    const res = await router.dispatch({ method: 'POST', path: '/x', query: {}, params: {}, headers: {}, body: { a: 'x'.repeat(20) } });
    expect(res.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ends a slow body within the deadline', async () => {
    const router = new RestRouter({} as ManagerContext, { bodyTimeoutMs: 50 });
    const handler = vi.fn(() => ({ status: 200, body: {} }));
    router.post('/x', handler);
    const req = new IncomingMessage(new Socket());
    req.method = 'POST';
    req.url = '/x';
    req.headers = { 'content-type': 'application/json' };
    req.push(Buffer.from('{"a":'));
    const out = { statusCode: 0, headersSent: false, setHeader: vi.fn(), getHeader: vi.fn(), end: vi.fn() };
    const started = Date.now();
    try {
      await router.serve(req, out as never);
    } finally {
      req.destroy();
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.statusCode).toBe(408);
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps client errors to fixed messages', async () => {
    const router = new RestRouter({} as ManagerContext).get('/f', () => {
      throw Object.assign(new Error('/internal/path leaked'), { status: 422 });
    });
    const res = await router.dispatch({ method: 'GET', path: '/f', query: {}, params: {}, headers: {}, body: null });
    expect(res).toEqual({ status: 422, body: { error: 'Unprocessable Entity' } });
    const miss = await router.dispatch({ method: 'GET', path: '/<script>', query: {}, params: {}, headers: {}, body: null });
    expect(JSON.stringify(miss.body)).not.toContain('script');
  });
});

describe('RestRouter rate limiting', () => {
  it('returns 429 to failed-key traffic after the pre-auth budget', async () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({});
    const router = RestRouter.withDefaults(fakeCtx().ctx, {
      auth: new ApiKeyAuthMiddleware({ store }),
      preAuthLimiter: new RateLimiter({ capacity: 2, refillPerSecond: 0 }),
    });
    const req = (key: string, clientAddress = '1.1.1.1'): RestRequest =>
      ({ method: 'GET', path: '/entities', query: {}, body: null, params: {}, clientAddress, headers: { authorization: `Bearer ${key}` } });
    expect((await router.dispatch(req('bad'))).status).toBe(401);
    expect((await router.dispatch(req('bad'))).status).toBe(401);
    const blocked = await router.dispatch(req('bad'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers?.['retry-after']).toBeDefined();
    expect((await router.dispatch(req('bad', '2.2.2.2'))).status).toBe(401);
    // A valid key from the exhausted address still passes.
    expect((await router.dispatch(req(plaintext))).status).toBe(200);
  });

  it('does not apply the failure budget without a client address', async () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({});
    const router = RestRouter.withDefaults(fakeCtx().ctx, {
      auth: new ApiKeyAuthMiddleware({ store }),
      preAuthLimiter: new RateLimiter({ capacity: 1, refillPerSecond: 0 }),
    });
    const req = (key: string): RestRequest =>
      ({ method: 'GET', path: '/entities', query: {}, body: null, params: {}, headers: { authorization: `Bearer ${key}` } });
    for (let i = 0; i < 5; i++) expect((await router.dispatch(req('bad'))).status).toBe(401);
    expect((await router.dispatch(req(plaintext))).status).toBe(200);
  });

  it('groups IPv6 clients by /64 and keeps the bucket count capped under many failing clients', async () => {
    const store = new APIKeyStore();
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0, maxBuckets: 50 });
    const router = RestRouter.withDefaults(fakeCtx().ctx, { auth: new ApiKeyAuthMiddleware({ store }), preAuthLimiter: limiter });
    const req = (clientAddress: string): RestRequest =>
      ({ method: 'GET', path: '/entities', query: {}, body: null, params: {}, clientAddress, headers: { authorization: 'Bearer bad' } });
    expect((await router.dispatch(req('2001:db8:1:2::1'))).status).toBe(401);
    expect((await router.dispatch(req('2001:DB8:1:2:ffff::9%eth0'))).status).toBe(429);
    // IPv4-mapped spellings share the IPv4 bucket; invalid strings share one bucket.
    expect((await router.dispatch(req('9.8.7.6'))).status).toBe(401);
    expect((await router.dispatch(req('::ffff:908:706'))).status).toBe(429);
    expect((await router.dispatch(req('not-an-ip'))).status).toBe(401);
    expect((await router.dispatch(req('also bad'))).status).toBe(429);
    for (let i = 0; i < 500; i++) await router.dispatch(req(`10.0.${i >> 8}.${i & 255}`));
    expect(limiter.size()).toBeLessThanOrEqual(50);
  });

  it('applies the authenticated limiter per key', async () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({});
    const router = RestRouter.withDefaults(fakeCtx().ctx, {
      auth: new ApiKeyAuthMiddleware({ store }),
      rateLimiter: new RateLimiter({ capacity: 1, refillPerSecond: 0 }),
    });
    const req: RestRequest = { method: 'GET', path: '/entities', query: {}, body: null, params: {}, headers: { authorization: `Bearer ${plaintext}` } };
    expect((await router.dispatch(req)).status).toBe(200);
    const limited = await router.dispatch(req);
    expect(limited.status).toBe(429);
    expect(limited.headers?.['retry-after']).toBeDefined();
  });
});
