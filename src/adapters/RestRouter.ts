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
 */

import type { ManagerContext } from '../core/ManagerContext.js';
import { logger } from '../utils/logger.js';

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
}

/** Framework-agnostic response envelope. */
export interface RestResponse {
  status: number;
  body: unknown;
  /** Optional response headers. */
  headers?: Record<string, string>;
}

/** Handler signature. Async; thrown errors become a 500 (unless the
 * thrown error has a numeric `status` field, in which case that status
 * is used and the message becomes the body). */
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
export class RestRouter {
  private readonly routes: RouteDefinition[] = [];

  constructor(private ctx: ManagerContext) {}

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
   */
  async dispatch(req: RestRequest): Promise<RestResponse> {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.pattern, req.path);
      if (!params) continue;
      try {
        const enriched: RestRequest = { ...req, params: { ...req.params, ...params } };
        return await route.handler(enriched, this.ctx);
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[RestRouter] ${route.method} ${route.pattern} threw:`, err);
        return {
          status: typeof status === 'number' ? status : 500,
          body: { error: message },
        };
      }
    }
    return { status: 404, body: { error: `No route for ${req.method} ${req.path}` } };
  }

  /**
   * Build a default route table covering common entity operations.
   * Mounts `GET /entities`, `GET /entities/:name`, `POST /entities`,
   * `DELETE /entities/:name`, `GET /search?q=...`. Callers can
   * extend with `router.get(...)` etc.
   */
  static withDefaults(ctx: ManagerContext): RestRouter {
    const router = new RestRouter(ctx);
    router
      .get('/entities', async (_req, c) => {
        const graph = await c.storage.loadGraph();
        return { status: 200, body: { entities: graph.entities } };
      })
      .get('/entities/:name', async (req, c) => {
        const entity = await c.entityManager.getEntity(req.params.name!);
        return entity
          ? { status: 200, body: entity }
          : { status: 404, body: { error: `Entity not found: ${req.params.name}` } };
      })
      .post('/entities', async (req, c) => {
        if (!req.body || typeof req.body !== 'object') {
          return { status: 400, body: { error: 'Body must be an Entity object' } };
        }
        const created = await c.entityManager.createEntities([req.body as never]);
        return { status: 201, body: { created } };
      })
      .delete('/entities/:name', async (req, c) => {
        await c.entityManager.deleteEntities([req.params.name!]);
        return { status: 204, body: null };
      })
      .get('/search', async (req, c) => {
        const q = req.query.q ?? '';
        const results = await c.searchManager.searchNodes(q);
        return { status: 200, body: { results } };
      });
    return router;
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

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i]!;
    const seg = pathParts[i]!;
    if (pat.startsWith(':')) {
      params[pat.slice(1)] = decodeURIComponent(seg);
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}
