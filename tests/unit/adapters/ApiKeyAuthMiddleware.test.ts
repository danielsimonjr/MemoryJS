/**
 * Sec9 — ApiKeyAuthMiddleware + RestRouter auth wiring.
 *
 * Covers: valid key passes with context attached, invalid/absent 401,
 * scope enforcement on write routes (403), X-Api-Key fallback, and the
 * APIKeyStore serialize/load + revoke + onMutate integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RestRouter, type RestRequest } from '../../../src/adapters/RestRouter.js';
import {
  ApiKeyAuthMiddleware,
  DEFAULT_WRITE_SCOPE,
} from '../../../src/adapters/ApiKeyAuthMiddleware.js';
import { APIKeyStore } from '../../../src/security/APIKeyStore.js';
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

describe('ApiKeyAuthMiddleware', () => {
  let store: APIKeyStore;
  let auth: ApiKeyAuthMiddleware;

  beforeEach(() => {
    store = new APIKeyStore();
    auth = new ApiKeyAuthMiddleware({ store });
  });

  describe('authenticate', () => {
    it('accepts a valid Bearer key and returns the auth context', () => {
      const { plaintext, record } = store.issue({
        ownerId: 'user-1',
        scopes: ['read:entities'],
      });
      const outcome = auth.authenticate(
        makeRequest({ headers: { authorization: `Bearer ${plaintext}` } }),
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.auth.keyId).toBe(record.keyId);
        expect(outcome.auth.scopes).toEqual(['read:entities']);
        expect(outcome.auth.ownerId).toBe('user-1');
      }
    });

    it('accepts the X-Api-Key fallback header', () => {
      const { plaintext } = store.issue();
      const outcome = auth.authenticate(makeRequest({ headers: { 'x-api-key': plaintext } }));
      expect(outcome.ok).toBe(true);
    });

    it('rejects an absent key with a uniform 401', () => {
      const outcome = auth.authenticate(makeRequest({}));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.response.status).toBe(401);
        expect(outcome.response.body).toEqual({ error: 'unauthorized' });
        expect(outcome.response.headers?.['www-authenticate']).toBe('Bearer');
      }
    });

    it('rejects an unknown key with the same 401 envelope (no reason leak)', () => {
      const outcome = auth.authenticate(
        makeRequest({ headers: { authorization: 'Bearer mjs_not-a-real-key' } }),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.response.body).toEqual({ error: 'unauthorized' });
    });

    it('rejects a revoked key (and reports the reason server-side only)', () => {
      const onReject = vi.fn();
      const authWithLog = new ApiKeyAuthMiddleware({ store, onReject });
      const { plaintext, record } = store.issue();
      store.revoke(record.keyId);

      const outcome = authWithLog.authenticate(
        makeRequest({ headers: { authorization: `Bearer ${plaintext}` } }),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.response.status).toBe(401);
      expect(onReject).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'revoked' }),
      );
    });

    it('enforces the default write scope on mutating methods (403)', () => {
      const { plaintext } = store.issue({ scopes: ['read:entities'] });
      const outcome = auth.authenticate(
        makeRequest({
          method: 'POST',
          path: '/entities',
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.response.status).toBe(403);
        expect(outcome.response.body).toEqual({
          error: 'forbidden',
          requiredScopes: [DEFAULT_WRITE_SCOPE],
        });
      }
    });

    it('passes mutating methods when the key holds entities:write', () => {
      const { plaintext } = store.issue({ scopes: [DEFAULT_WRITE_SCOPE] });
      const outcome = auth.authenticate(
        makeRequest({
          method: 'DELETE',
          path: '/entities/x',
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      );
      expect(outcome.ok).toBe(true);
    });

    it('honors a custom requiredScopes mapping', () => {
      const custom = new ApiKeyAuthMiddleware({
        store,
        requiredScopes: (method, path) =>
          path.startsWith('/admin') ? ['admin'] : [],
      });
      const { plaintext } = store.issue({ scopes: [] });
      expect(
        custom.authenticate(
          makeRequest({ path: '/entities', headers: { 'x-api-key': plaintext } }),
        ).ok,
      ).toBe(true);
      const denied = custom.authenticate(
        makeRequest({ path: '/admin/keys', headers: { 'x-api-key': plaintext } }),
      );
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.response.status).toBe(403);
    });
  });

  describe('store integration roundtrip', () => {
    it('serialize/load round-trips validation; revoke persists through it', () => {
      const { plaintext: kept } = store.issue({ scopes: ['read:entities'] });
      const { plaintext: revoked, record } = store.issue();
      store.revoke(record.keyId);

      const restored = new APIKeyStore();
      restored.load(JSON.parse(JSON.stringify(store.serialize())));
      const restoredAuth = new ApiKeyAuthMiddleware({ store: restored });

      expect(
        restoredAuth.authenticate(makeRequest({ headers: { 'x-api-key': kept } })).ok,
      ).toBe(true);
      expect(
        restoredAuth.authenticate(makeRequest({ headers: { 'x-api-key': revoked } })).ok,
      ).toBe(false);
    });

    it('onMutate fires on issue/revoke/load (auto-persist hook)', () => {
      const onMutate = vi.fn();
      const s = new APIKeyStore({ onMutate });
      const { record } = s.issue();
      expect(onMutate).toHaveBeenLastCalledWith('issue');
      s.revoke(record.keyId);
      expect(onMutate).toHaveBeenLastCalledWith('revoke');
      s.revoke(record.keyId); // idempotent second revoke does not re-fire
      expect(onMutate).toHaveBeenCalledTimes(2);
      s.load(s.serialize());
      expect(onMutate).toHaveBeenLastCalledWith('load');
    });
  });
});

describe('RestRouter auth wiring', () => {
  let ctx: ManagerContext;
  let dir: string;
  let store: APIKeyStore;

  beforeEach(async () => {
    dir = join(tmpdir(), `rest-auth-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    ctx = new ManagerContext(join(dir, 'mem.jsonl'));
    await ctx.storage.saveGraph({
      entities: [{ name: 'Alice', entityType: 'person', observations: ['dev'] }],
      relations: [],
    });
    store = new APIKeyStore();
  });

  afterEach(async () => {
    ctx.storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('unauthenticated request to an authed router gets 401 before route matching', async () => {
    const router = RestRouter.withDefaults(ctx, {
      auth: new ApiKeyAuthMiddleware({ store }),
    });
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/entities' }));
    expect(res.status).toBe(401);
    // Unknown routes are indistinguishable (still 401, not 404).
    const miss = await router.dispatch(makeRequest({ method: 'GET', path: '/nope' }));
    expect(miss.status).toBe(401);
  });

  it('valid key reaches the handler with req.auth attached', async () => {
    const { plaintext, record } = store.issue({ scopes: ['read:entities'] });
    const router = new RestRouter(ctx, { auth: new ApiKeyAuthMiddleware({ store }) });
    router.get('/whoami', (req) => ({ status: 200, body: { auth: req.auth } }));

    const res = await router.dispatch(
      makeRequest({ path: '/whoami', headers: { authorization: `Bearer ${plaintext}` } }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { auth: { keyId: string } }).auth.keyId).toBe(record.keyId);
  });

  it('write route requires entities:write through withDefaults', async () => {
    const readOnly = store.issue({ scopes: ['read:entities'] });
    const writer = store.issue({ scopes: [DEFAULT_WRITE_SCOPE] });
    const router = RestRouter.withDefaults(ctx, {
      auth: new ApiKeyAuthMiddleware({ store }),
    });

    const denied = await router.dispatch(
      makeRequest({
        method: 'POST',
        path: '/entities',
        headers: { authorization: `Bearer ${readOnly.plaintext}` },
        body: { name: 'New', entityType: 'person', observations: [] },
      }),
    );
    expect(denied.status).toBe(403);

    const allowed = await router.dispatch(
      makeRequest({
        method: 'POST',
        path: '/entities',
        headers: { authorization: `Bearer ${writer.plaintext}` },
        body: { name: 'New', entityType: 'person', observations: [] },
      }),
    );
    expect(allowed.status).toBe(201);
    expect(await ctx.entityManager.getEntity('New')).not.toBeNull();
  });

  it('withDefaults without auth requires allowUnauthenticated opt-in', () => {
    expect(() => RestRouter.withDefaults(ctx)).toThrow(/allowUnauthenticated/);
  });

  it('router without auth keeps unauthenticated behavior when explicitly opted in', async () => {
    const router = RestRouter.withDefaults(ctx, { allowUnauthenticated: true });
    const res = await router.dispatch(makeRequest({ method: 'GET', path: '/entities' }));
    expect(res.status).toBe(200);
  });
});
