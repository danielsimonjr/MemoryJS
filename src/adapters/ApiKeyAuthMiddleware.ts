/**
 * API-Key Auth Middleware (Sec9)
 *
 * Reference authentication layer wiring `APIKeyStore.validate()` into
 * the framework-agnostic `RestRouter`. Reads the key from
 * `Authorization: Bearer <key>` (preferred) with an `X-Api-Key` header
 * fallback, validates it against the store, and attaches
 * `{ keyId, scopes, ownerId }` to the request as `req.auth`.
 *
 * Failure responses are JSON:
 * - `401 { error: 'unauthorized' }` — missing/unknown/revoked/expired key.
 *   The specific rejection reason is intentionally NOT serialized to the
 *   client (see the timing-leak note on `APIKeyStore.validate`); it is
 *   available server-side via the `onReject` callback for logging.
 * - `403 { error: 'forbidden', requiredScopes }` — valid key lacking a
 *   required scope for the route (e.g. `entities:write` on mutations).
 *
 * Usage:
 * ```typescript
 * const store = new APIKeyStore();
 * const auth = new ApiKeyAuthMiddleware({ store });
 * const router = RestRouter.withDefaults(ctx, { auth });
 * ```
 *
 * @module adapters/ApiKeyAuthMiddleware
 * @experimental Scope-mapping defaults may gain granularity (per-resource
 *   scopes) in a future minor.
 */

import type { APIKeyStore, KeyValidationResult } from '../security/APIKeyStore.js';
import type { RestMethod, RestRequest, RestResponse } from './RestRouter.js';

/** Authenticated principal attached to the request as `req.auth`. */
export interface AuthContext {
  keyId: string;
  scopes: readonly string[];
  ownerId?: string;
}

/** Default scope demanded for mutating HTTP methods. */
export const DEFAULT_WRITE_SCOPE = 'entities:write';

export interface ApiKeyAuthOptions {
  /** The key store to validate against. */
  store: APIKeyStore;
  /**
   * Map a request to the scopes it requires. Return `[]` for
   * "any valid key". Default: `GET` requires no scopes; `POST` / `PUT` /
   * `PATCH` / `DELETE` require `['entities:write']`.
   */
  requiredScopes?: (method: RestMethod, path: string) => readonly string[];
  /**
   * Server-side observer for rejections (logging/metrics). Receives the
   * store's detailed reason, which is deliberately kept OFF the wire.
   */
  onReject?: (info: {
    reason: NonNullable<KeyValidationResult['reason']> | 'missing';
    method: RestMethod;
    path: string;
  }) => void;
}

/** Result of an `authenticate` call. */
export type AuthOutcome =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: RestResponse };

/**
 * Validates inbound API keys and enforces per-route scopes.
 *
 * Framework-agnostic: operates purely on the `RestRequest` /
 * `RestResponse` envelopes, so it composes with `RestRouter` (via the
 * `auth` option) or with any adapter that builds those shapes.
 */
export class ApiKeyAuthMiddleware {
  private readonly store: APIKeyStore;
  private readonly scopesFor: (method: RestMethod, path: string) => readonly string[];
  private readonly onReject?: ApiKeyAuthOptions['onReject'];

  constructor(options: ApiKeyAuthOptions) {
    this.store = options.store;
    this.scopesFor =
      options.requiredScopes ??
      ((method) => (method === 'GET' ? [] : [DEFAULT_WRITE_SCOPE]));
    this.onReject = options.onReject;
  }

  /**
   * Extract the API key from the request headers.
   * Prefers `Authorization: Bearer <key>`; falls back to `X-Api-Key`.
   * Header keys are expected lowercase (the `RestRequest` contract).
   */
  extractKey(req: RestRequest): string | null {
    const authz = req.headers['authorization'];
    if (authz) {
      const match = /^Bearer\s+(.+)$/i.exec(authz.trim());
      if (match) return match[1].trim();
    }
    const xApiKey = req.headers['x-api-key'];
    if (xApiKey && xApiKey.trim().length > 0) return xApiKey.trim();
    return null;
  }

  /**
   * Authenticate a request: extract + validate the key, then enforce the
   * route's required scopes. On success returns the {@link AuthContext}
   * to attach; on failure returns the 401/403 `RestResponse` to send.
   */
  authenticate(req: RestRequest): AuthOutcome {
    const key = this.extractKey(req);
    if (key === null) {
      this.onReject?.({ reason: 'missing', method: req.method, path: req.path });
      return { ok: false, response: unauthorized() };
    }

    const validation = this.store.validate(key);
    if (!validation.valid || !validation.keyId) {
      this.onReject?.({
        reason: validation.reason ?? 'unknown',
        method: req.method,
        path: req.path,
      });
      return { ok: false, response: unauthorized() };
    }

    const auth: AuthContext = {
      keyId: validation.keyId,
      scopes: validation.scopes ?? [],
      ownerId: validation.ownerId,
    };

    const denial = this.checkScopes(auth, req.method, req.path);
    if (denial) return { ok: false, response: denial };

    return { ok: true, auth };
  }

  /**
   * Scope-check helper: verify `auth` covers the scopes the route
   * requires (e.g. `entities:write` for mutations). Returns the 403
   * response to send on denial, or `null` when access is allowed.
   * Public so custom handlers can enforce additional scopes themselves.
   */
  checkScopes(auth: AuthContext, method: RestMethod, path: string): RestResponse | null {
    const required = this.scopesFor(method, path);
    if (required.length === 0) return null;
    const have = new Set(auth.scopes);
    const missing = required.filter((s) => !have.has(s));
    if (missing.length === 0) return null;
    this.onReject?.({ reason: 'wrong-scope', method, path });
    return {
      status: 403,
      body: { error: 'forbidden', requiredScopes: required },
    };
  }
}

/** Uniform 401 envelope — no key-state detail leaks to the caller. */
function unauthorized(): RestResponse {
  return {
    status: 401,
    body: { error: 'unauthorized' },
    headers: { 'www-authenticate': 'Bearer' },
  };
}
