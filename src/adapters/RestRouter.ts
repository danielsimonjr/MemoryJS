/**
 * REST Router
 *
 * Phase 4 step 46 (§12.2) — framework-agnostic dispatch table that
 * maps HTTP method + path to handler functions. Designed to plug into
 * any Node HTTP framework (Fastify, Express, Hono, native http) by
 * adapting the framework's request/response into the small
 * `RestRequest` / `RestResponse` shapes defined here.
 *
 * **No external deps.** The library doesn't take on Fastify/Express
 * directly — callers wire whatever framework they prefer using the
 * `dispatch` method. A minimal `serve(req, res)` adapter for Node's
 * built-in `http` module is provided as a reference.
 *
 * @module adapters/RestRouter
 * @public `RestRequest` / `RestResponse` / `RouteDefinition` are
 *   stable. `withDefaults` mounts may gain routes additively in
 *   future minors.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ManagerContext } from '../core/ManagerContext.js';
import { logger } from '../utils/logger.js';
import { paginate, parsePaginationParams } from './pagination.js';
import type { ApiKeyAuthMiddleware, AuthContext } from './ApiKeyAuthMiddleware.js';
import { RateLimiter } from './RateLimiter.js';
import type { Entity } from '../types/types.js';

/** HTTP methods this router handles. */
export type RestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Framework-agnostic request envelope. */
export interface RestRequest {
  method: RestMethod;
  path: string;
  /** Path parameters extracted by the router (e.g. `{ name: 'alice' }`). */
  params: Record<string, string>;
  /** Parsed query string. Multi-valued params come through as comma-joined strings. */
  query: Record<string, string>;
  /** Parsed JSON body, or null when the request had none. */
  body: unknown;
  /** Subset of incoming headers, lowercase keys. */
  headers: Record<string, string>;
  /**
   * Authenticated principal, attached by the router when an
   * {@link ApiKeyAuthMiddleware} is configured (Sec9). Absent on
   * unauthenticated routers.
   */
  auth?: AuthContext;
  /**
   * Network address of the client. `serve()` fills it from the socket.
   * The router uses it only to key rate-limit buckets; it is never trusted
   * for authorization. Requests without it share one bucket.
   */
  clientAddress?: string;
}

/** Framework-agnostic response envelope. */
export interface RestResponse {
  status: number;
  body: unknown;
  /** Optional response headers. */
  headers?: Record<string, string>;
}

/** Handler signature. Async; thrown errors become a 500 unless they carry
 * an integer HTTP error `status` from 400–599. The response body carries a
 * fixed message for the status; thrown error messages never reach clients. */
export type RestHandler = (
  req: RestRequest,
  ctx: ManagerContext,
) => Promise<RestResponse> | RestResponse;

/**
 * Pattern-based route definition. The pattern uses `:name` segments
 * (Express-style) which become `params[name]` on the dispatched
 * request. No regex support — keep the pattern simple so any HTTP
 * framework can adapt to it without surprises.
 */
export interface RouteDefinition {
  method: RestMethod;
  pattern: string;
  handler: RestHandler;
}

/**
 * Dispatch table over typed routes.
 *
 * @example
 * ```typescript
 * const router = new RestRouter(ctx);
 * router.get('/entities/:name', async (req, ctx) => {
 *   const entity = await ctx.entityManager.getEntity(req.params.name);
 *   return entity ? { status: 200, body: entity } : { status: 404, body: { error: 'not found' } };
 * });
 * // Wire into your framework:
 * fastify.all('/api/*', async (req, reply) => reply.code(...).send(await router.dispatch(...)));
 * ```
 */
/** Optional router configuration. */
export interface RestRouterOptions {
  /**
   * Sec9: authentication middleware. When set, EVERY dispatched request
   * is authenticated (401 on missing/invalid key, 403 on insufficient
   * scope) before route matching, and the validated `{ keyId, scopes }`
   * is attached as `req.auth` for handlers. When omitted the router is
   * UNAUTHENTICATED — see the {@link RestRouter.withDefaults} warning.
   */
  auth?: ApiKeyAuthMiddleware;
  /** Maximum JSON request body size in bytes for serve(). Default: 1 MiB. */
  maxBodyBytes?: number;
  /**
   * Explicit opt-in to mount {@link RestRouter.withDefaults} routes without
   * authentication. Ignored when `auth` is set. Required when `auth` is
   * omitted — otherwise `withDefaults` throws.
   */
  allowUnauthenticated?: boolean;
  /**
   * Time limit in milliseconds for reading a request body in `serve()`.
   * A slower body gets 408. Default: 10 000.
   */
  bodyTimeoutMs?: number;
  /**
   * Budget for requests that FAIL authentication, keyed by
   * {@link RestRequest.clientAddress}. When the budget of an address is
   * empty, the router returns 429 before it examines the key. Only failed
   * attempts consume tokens. Default when `auth` is set: 60 failures,
   * refilled at 1 per second, at most 10 000 addresses.
   */
  preAuthLimiter?: RateLimiter;
  /**
   * Optional limiter for accepted requests, keyed by API key id (or by
   * client address on an unauthenticated router). No default.
   */
  rateLimiter?: RateLimiter;
  /** Input limits for the default routes. */
  limits?: Partial<RestLimits>;
}

/** Input limits applied by the {@link RestRouter.withDefaults} routes. */
export interface RestLimits {
  /** Maximum length of the `/search` query `q`. Default 1024. */
  maxQueryLength: number;
  /** Maximum length of `name`, `entityType` and `projectId`. Default 512. */
  maxNameLength: number;
  /** Maximum number of observations on a created entity. Default 1000. */
  maxObservations: number;
  /** Maximum length of one observation. Default 16 384. */
  maxObservationLength: number;
}

const DEFAULT_LIMITS: RestLimits = {
  maxQueryLength: 1024,
  maxNameLength: 512,
  maxObservations: 1000,
  maxObservationLength: 16_384,
};

export class RestRouter {
  private readonly routes: RouteDefinition[] = [];
  private readonly auth?: ApiKeyAuthMiddleware;
  private readonly maxBodyBytes: number;
  private readonly bodyTimeoutMs: number;
  private readonly preAuthLimiter?: RateLimiter;
  private readonly rateLimiter?: RateLimiter;
  /** Input limits for the default routes. */
  readonly limits: Readonly<RestLimits>;

  constructor(private ctx: ManagerContext, options?: RestRouterOptions) {
    this.auth = options?.auth;
    this.maxBodyBytes = options?.maxBodyBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 0) {
      throw new RangeError('RestRouter: maxBodyBytes must be a non-negative safe integer');
    }
    this.bodyTimeoutMs = options?.bodyTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.bodyTimeoutMs) || this.bodyTimeoutMs < 1) {
      throw new RangeError('RestRouter: bodyTimeoutMs must be a positive safe integer');
    }
    this.limits = { ...DEFAULT_LIMITS, ...options?.limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`RestRouter: limits.${name} must be a non-negative safe integer`);
      }
    }
    this.preAuthLimiter = options?.preAuthLimiter ??
      (this.auth ? new RateLimiter({ capacity: 60, refillPerSecond: 1 }) : undefined);
    this.rateLimiter = options?.rateLimiter;
  }

  /** Register a `GET` route. */
  get(pattern: string, handler: RestHandler): this {
    this.routes.push({ method: 'GET', pattern, handler });
    return this;
  }

  /** Register a `POST` route. */
  post(pattern: string, handler: RestHandler): this {
    this.routes.push({ method: 'POST', pattern, handler });
    return this;
  }

  /** Register a `PUT` route. */
  put(pattern: string, handler: RestHandler): this {
    this.routes.push({ method: 'PUT', pattern, handler });
    return this;
  }

  /** Register a `DELETE` route. */
  delete(pattern: string, handler: RestHandler): this {
    this.routes.push({ method: 'DELETE', pattern, handler });
    return this;
  }

  /** Register a `PATCH` route. */
  patch(pattern: string, handler: RestHandler): this {
    this.routes.push({ method: 'PATCH', pattern, handler });
    return this;
  }

  /** Register a route with an explicit method. */
  route(def: RouteDefinition): this {
    this.routes.push(def);
    return this;
  }

  /** Read-only list of registered routes (useful for OpenAPI generation). */
  list(): ReadonlyArray<Readonly<RouteDefinition>> {
    return this.routes;
  }

  /**
   * Dispatch a request through the registered routes. Returns a 404
   * response when no route matches, a 500 (or the thrown error's
   * `.status`) when the matched handler throws.
   *
   * When an auth middleware is configured (see {@link RestRouterOptions}),
   * authentication + scope checks run FIRST — before route matching — so
   * unauthenticated probes cannot distinguish existing from missing
   * routes, and `req.auth` is populated for the matched handler.
   */
  async dispatch(req: RestRequest): Promise<RestResponse> {
    const authorized = this.authorize(req);
    if ('status' in authorized) return authorized;
    if (req.body !== null && req.body !== undefined) {
      let bytes: number;
      try {
        bytes = Buffer.byteLength(JSON.stringify(req.body));
      } catch {
        return errorResponse(new HttpInputError(400, 'Invalid request body'));
      }
      if (bytes > this.maxBodyBytes) return errorResponse(new HttpInputError(413, 'Request body too large'));
    }
    return this.dispatchRoutes(authorized);
  }

  /**
   * Apply the pre-authentication budget, authentication and the accepted-
   * request limiter. Returns the request with `auth` attached, or the
   * rejection response.
   */
  private authorize(req: RestRequest): RestRequest | RestResponse {
    const client = `addr:${req.clientAddress ?? 'unknown'}`;
    if (this.auth) {
      const budget = this.preAuthLimiter?.peek(client);
      if (budget && !budget.allowed) return tooManyRequests(budget.resetAt);
      const outcome = this.auth.authenticate(req);
      if (!outcome.ok) {
        if (outcome.response.status === 401) this.preAuthLimiter?.check(client);
        return outcome.response;
      }
      req = { ...req, auth: outcome.auth };
    }
    if (this.rateLimiter) {
      const verdict = this.rateLimiter.check(req.auth ? `key:${req.auth.keyId}` : client);
      if (!verdict.allowed) return tooManyRequests(verdict.resetAt);
    }
    return req;
  }

  private async dispatchRoutes(req: RestRequest): Promise<RestResponse> {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      try {
        const params = matchPath(route.pattern, req.path);
        if (!params) continue;
        const enriched: RestRequest = { ...req, params: { ...req.params, ...params } };
        return await route.handler(enriched, this.ctx);
      } catch (err) {
        logger.error(`[RestRouter] ${route.method} ${route.pattern} threw:`, err);
        return errorResponse(err);
      }
    }
    return notFound();
  }

  /**
   * Build a default route table covering common entity operations.
   * Mounts `GET /entities`, `GET /entities/:name`, `POST /entities`,
   * `DELETE /entities/:name`, `GET /search?q=...`. Callers can
   * extend with `router.get(...)` etc.
   *
   * ## ⚠️ SECURITY WARNING — unauthenticated by default
   *
   * Without `options.auth`, mounting these routes exposes an
   * **unauthenticated read/WRITE HTTP surface**: anyone who can reach
   * the listener can enumerate every entity (`GET /entities`), create
   * entities (`POST /entities`), and delete them
   * (`DELETE /entities/:name`). Only mount the default routes without
   * auth on a loopback/trusted-network listener. For anything else,
   * pass an {@link ApiKeyAuthMiddleware}:
   *
   * ```typescript
   * const auth = new ApiKeyAuthMiddleware({ store: apiKeyStore });
   * const router = RestRouter.withDefaults(ctx, { auth });
   * // Local-only dev listener — explicit opt-in required:
   * const devRouter = RestRouter.withDefaults(ctx, { allowUnauthenticated: true });
   * ```
   *
   * With auth configured, mutations additionally require the
   * `entities:write` scope (default scope mapping).
   *
   * ## Project scoping
   *
   * A key with `projectIds` (see `APIKeyStore.issue`) sees only entities
   * whose `projectId` is in that list. Entities without a `projectId` are
   * hidden from such keys. List and search filter before pagination.
   * A direct read or delete of an entity outside the list returns 404, the
   * same response as a missing entity, so existence is not revealed.
   * Creation must name an allowed `projectId` (403 otherwise). Because names
   * are unique across projects, a scoped key that creates an existing name
   * gets 409. A key without `projectIds`, and an unauthenticated router,
   * keep full access.
   */
  static withDefaults(ctx: ManagerContext, options?: RestRouterOptions): RestRouter {
    if (!options?.auth && !options?.allowUnauthenticated) {
      throw new Error(
        'RestRouter.withDefaults requires either options.auth or options.allowUnauthenticated=true. ' +
          'Mounting unauthenticated entity CRUD on a network listener is unsafe.',
      );
    }
    const router = new RestRouter(ctx, options);
    const limits = router.limits;
    router
      .get('/entities', async (req, c) => {
        const graph = await c.storage.loadGraph();
        const params = parsePaginationParams(req.query);
        // Filter before pagination so totals and cursors count only visible entities.
        const result = paginate(visibleEntities(req, graph.entities), params);
        return { status: 200, body: { entities: result.page, total: result.total, nextCursor: result.nextCursor } };
      })
      .get('/entities/:name', async (req, c) => {
        const entity = await c.entityManager.getEntity(req.params.name!);
        // An entity outside the key's projects is reported exactly like a missing one.
        return entity && canAccess(req, entity) ? { status: 200, body: entity } : notFound();
      })
      .post('/entities', async (req, c) => {
        const body = req.body as Record<string, unknown> | null;
        if (
          !body ||
          typeof body !== 'object' ||
          typeof body.name !== 'string' ||
          typeof body.entityType !== 'string' ||
          !Array.isArray(body.observations) ||
          !body.observations.every((o) => typeof o === 'string') ||
          (body.projectId !== undefined && typeof body.projectId !== 'string')
        ) {
          return {
            status: 400,
            body: {
              error:
                'Body must be an Entity object with string `name`, string `entityType`, string[] `observations` and optional string `projectId`',
            },
          };
        }
        const { name, entityType } = body;
        const projectId = body.projectId as string | undefined;
        const observations = body.observations as string[];
        if (
          name.length > limits.maxNameLength ||
          entityType.length > limits.maxNameLength ||
          (projectId !== undefined && projectId.length > limits.maxNameLength)
        ) {
          return { status: 400, body: { error: 'Field length out of range' } };
        }
        if (
          observations.length > limits.maxObservations ||
          observations.some((o) => o.length > limits.maxObservationLength)
        ) {
          return { status: 413, body: { error: 'Too many or too large observations' } };
        }
        const scope = projectScope(req);
        if (scope) {
          // A project-scoped key must name one of its projects.
          if (projectId === undefined || !scope.has(projectId)) {
            return { status: 403, body: { error: 'forbidden' } };
          }
          // Names are unique across projects; report any existing name as a conflict.
          if (await c.entityManager.getEntity(name)) {
            return { status: 409, body: { error: 'Conflict' } };
          }
        }
        const created = await c.entityManager.createEntities([
          { name, entityType, observations, ...(projectId !== undefined ? { projectId } : {}) },
        ]);
        return { status: 201, body: { created } };
      })
      .delete('/entities/:name', async (req, c) => {
        if (projectScope(req)) {
          const entity = await c.entityManager.getEntity(req.params.name!);
          if (!entity || !canAccess(req, entity)) return notFound();
        }
        await c.entityManager.deleteEntities([req.params.name!]);
        return { status: 204, body: null };
      })
      .get('/search', async (req, c) => {
        const q = req.query.q ?? '';
        if (q.length > limits.maxQueryLength) {
          return { status: 400, body: { error: 'Query too long' } };
        }
        // Push a single allowed project down to the search layer; always
        // filter again before pagination. Relations are not returned.
        const scope = projectScope(req);
        const result = scope?.size === 1
          ? await c.searchManager.searchNodes(q, { projectId: [...scope][0] })
          : await c.searchManager.searchNodes(q);
        const params = parsePaginationParams(req.query);
        const paginated = paginate(visibleEntities(req, result.entities), params);
        return {
          status: 200,
          body: {
            entities: paginated.page,
            total: paginated.total,
            nextCursor: paginated.nextCursor,
          },
        };
      });
    return router;
  }

  /**
   * Minimal Node `http` adapter. Converts an `IncomingMessage` /
   * `ServerResponse` pair into a `RestRequest`, runs `dispatch`, and
   * writes the response. Authenticates before reading a JSON body, limits it
   * to `maxBodyBytes` (default 1 MiB) and `bodyTimeoutMs` (default 10 s), and
   * returns 400 for malformed JSON, 408 for a slow body or 413 for an
   * oversized body. Header-phase timeouts belong to the Node `http.Server`
   * (`headersTimeout`, `requestTimeout`). Non-JSON content leaves `body` as `null`.
   *
   * @example
   * ```typescript
   * import { createServer } from 'http';
   * const router = RestRouter.withDefaults(ctx);
   * createServer((req, res) => router.serve(req, res)).listen(3000);
   * ```
   */
  async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = (req.method ?? 'GET').toUpperCase() as RestMethod;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query: Record<string, string> = Object.create(null);
      for (const [k, v] of url.searchParams) query[k] = v;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
      }

      const restReq: RestRequest = {
        method,
        path: url.pathname,
        params: {},
        query,
        body: null,
        headers,
        clientAddress: req.socket?.remoteAddress,
      };
      // Reject unauthorized requests before buffering or parsing their body.
      let restRes: RestResponse;
      const authorized = this.authorize(restReq);
      if ('status' in authorized) {
        restRes = authorized;
        res.setHeader('connection', 'close');
      } else {
        authorized.body = await readJsonBody(req, headers, this.maxBodyBytes, this.bodyTimeoutMs);
        restRes = await this.dispatchRoutes(authorized);
      }

      res.statusCode = restRes.status;
      if (restRes.headers) {
        for (const [k, v] of Object.entries(restRes.headers)) res.setHeader(k, v);
      }
      if (restRes.body === null || restRes.body === undefined) {
        res.end();
        return;
      }
      if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'application/json');
      }
      res.end(JSON.stringify(restRes.body));
    } catch (err) {
      logger.error('[RestRouter.serve] unhandled error:', err);
      if (!res.headersSent) {
        const response = errorResponse(err);
        res.statusCode = response.status;
        // A rejected body may be unread. Close after sending the response.
        res.setHeader('connection', 'close');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(response.body));
      }
    }
  }
}

/**
 * Read the request body and parse as JSON when the content-type
 * suggests JSON. Returns `null` for empty bodies or non-JSON
 * content-types so handlers can branch on shape.
 */
async function readJsonBody(
  req: IncomingMessage,
  headers: Record<string, string>,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  const declaredLength = Number(headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpInputError(413, 'Request body too large');
  }
  const ctype = headers['content-type'] ?? '';
  if (!ctype.includes('json')) return null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new HttpInputError(408, 'Request body timeout'));
    }, timeoutMs);
  });
  const collect = (async (): Promise<string | null> => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    // Keep the socket alive long enough to send 408/413 when stopping early.
    const input = req.iterator({ destroyOnReturn: false });
    for await (const chunk of input) {
      // After the deadline, drop data until the connection closes.
      if (timedOut) return null;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      bytes += buffer.length;
      if (bytes > maxBodyBytes) throw new HttpInputError(413, 'Request body too large');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes).toString('utf-8');
  })();
  // The losing promise must not surface as an unhandled rejection.
  collect.catch(() => undefined);
  let text: string | null;
  try {
    text = await Promise.race([collect, deadline]);
  } finally {
    clearTimeout(timer);
  }
  if (text === null || text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpInputError(400, 'Invalid JSON request body');
  }
}

/**
 * Match a request path against a pattern. Returns the extracted
 * params on success, `null` on miss. Patterns use `:name` segments.
 */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((s) => s.length > 0);
  const pathParts = path.split('/').filter((s) => s.length > 0);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = Object.create(null);
  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i]!;
    const seg = pathParts[i]!;
    if (pat.startsWith(':')) {
      try {
        params[pat.slice(1)] = decodeURIComponent(seg);
      } catch {
        throw new HttpInputError(400, 'Invalid URL encoding');
      }
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}

class HttpInputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Fixed client-facing messages for 4xx statuses. */
const CLIENT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict',
  413: 'Payload Too Large', 415: 'Unsupported Media Type',
  422: 'Unprocessable Entity', 429: 'Too Many Requests',
};

/**
 * Map a thrown error to a response. Messages of router-raised input errors
 * are fixed strings and are kept. Any other error gets a fixed message for
 * its status, so internal text never reaches clients.
 */
function errorResponse(error: unknown): RestResponse {
  const status = (error as { status?: unknown } | null)?.status;
  const validStatus = typeof status === 'number' && Number.isInteger(status) &&
    status >= 400 && status <= 599 ? status : 500;
  if (validStatus >= 500) return { status: validStatus, body: { error: 'Internal Server Error' } };
  const message = error instanceof HttpInputError
    ? error.message
    : CLIENT_ERROR_MESSAGES[validStatus] ?? 'Client Error';
  return { status: validStatus, body: { error: message } };
}

function notFound(): RestResponse {
  return { status: 404, body: { error: 'Not Found' } };
}

function tooManyRequests(resetAt: string | undefined): RestResponse {
  const seconds = resetAt ? Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000)) : 1;
  return { status: 429, body: { error: 'Too Many Requests' }, headers: { 'retry-after': String(seconds) } };
}

/** Allowed projects of the caller, or `null` for full access. */
function projectScope(req: RestRequest): ReadonlySet<string> | null {
  const ids = req.auth?.projectIds;
  return ids ? new Set(ids) : null;
}

function canAccess(req: RestRequest, entity: Entity): boolean {
  const scope = projectScope(req);
  return !scope || (entity.projectId !== undefined && scope.has(entity.projectId));
}

function visibleEntities(req: RestRequest, entities: readonly Entity[]): Entity[] {
  const scope = projectScope(req);
  if (!scope) return [...entities];
  return entities.filter((e) => e.projectId !== undefined && scope.has(e.projectId));
}
