import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerContext } from '../../../src/core/ManagerContext.js';

describe('unscoped API key startup warning', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs once per process, with the count and no key material', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { RestRouter } = await import('../../../src/adapters/RestRouter.js');
    const { ApiKeyAuthMiddleware } = await import('../../../src/adapters/ApiKeyAuthMiddleware.js');
    const { APIKeyStore } = await import('../../../src/security/APIKeyStore.js');
    const store = new APIKeyStore();
    const issued = [store.issue({}), store.issue({}), store.issue({}), store.issue({ projectIds: ['A'] })];
    store.revoke(store.issue({}).record.keyId);
    const auth = new ApiKeyAuthMiddleware({ store });
    const ctx = {} as ManagerContext;
    new RestRouter(ctx, { auth });
    RestRouter.withDefaults(ctx, { auth });
    new RestRouter(ctx, { auth });

    const messages = warn.mock.calls.map((c) => c.map(String).join(' '));
    const hits = messages.filter((m) => m.includes('projectIds'));
    expect(hits).toEqual(['[WARN] [RestRouter] 3 API keys have no projectIds and can access all projects']);
    for (const { plaintext, record } of issued) {
      for (const m of messages) {
        expect(m).not.toContain(plaintext);
        expect(m).not.toContain(record.hash);
        expect(m).not.toContain(record.keyId);
      }
    }
  });

  it('does not log when every key is scoped', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { RestRouter } = await import('../../../src/adapters/RestRouter.js');
    const { ApiKeyAuthMiddleware } = await import('../../../src/adapters/ApiKeyAuthMiddleware.js');
    const { APIKeyStore } = await import('../../../src/security/APIKeyStore.js');
    const store = new APIKeyStore();
    store.issue({ projectIds: [] });
    new RestRouter({} as ManagerContext, { auth: new ApiKeyAuthMiddleware({ store }) });
    expect(warn).not.toHaveBeenCalled();
  });
});
