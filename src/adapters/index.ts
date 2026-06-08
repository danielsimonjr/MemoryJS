/**
 * Adapters Module — Barrel Export
 *
 * Framework-edge utilities for callers building on top of MemoryJS.
 *
 * @module adapters
 */

// REST router scaffold (framework-agnostic dispatch table)
export {
  RestRouter,
  type RestMethod,
  type RestRequest,
  type RestResponse,
  type RestHandler,
  type RouteDefinition,
} from './RestRouter.js';

// v2.1.0 — Rate limiter + pagination helpers for REST handlers
export {
  RateLimiter,
  type RateLimiterConfig,
  type RateLimitVerdict,
} from './RateLimiter.js';
export {
  paginate,
  parsePaginationParams,
  type PaginationParams,
  type ParsePaginationOptions,
  type PaginatedResult,
} from './pagination.js';

// v2.1.0 — MCP tool-call observer adapter (structural-typed; no MCP-SDK dep)
export {
  MCPToolObserverAdapter,
  extractToolName,
} from './MCPToolObserverAdapter.js';

// LangChain adapter (pre-existing)
export { LangChainMemoryAdapter } from './LangChainMemoryAdapter.js';
