/**
 * Response and Pagination Formatters
 *
 * Consolidated module for MCP tool response formatting and pagination utilities.
 * Centralizes response formatting for MCP tool calls to eliminate redundant patterns.
 *
 * @module utils/formatters
 */

import { SEARCH_LIMITS } from './constants.js';

// ==================== MCP Tool Response Formatting ====================

/**
 * MCP Tool Response type - uses the exact shape expected by the SDK.
 * The 'as const' assertion ensures the type literal is preserved.
 */
export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Formats data as an MCP tool response with JSON content.
 * Centralizes the response format to ensure consistency and reduce duplication.
 *
 * @param data - Any data to be JSON stringified
 * @returns Formatted MCP tool response
 */
export function formatToolResponse(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Formats a simple text message as an MCP tool response.
 * Use for success messages that don't need JSON formatting.
 *
 * @param message - Plain text message
 * @returns Formatted MCP tool response
 */
export function formatTextResponse(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
  };
}

/**
 * Formats raw string content as an MCP tool response.
 * Use for export formats that return pre-formatted strings (markdown, CSV, etc.)
 *
 * @param content - Raw string content
 * @returns Formatted MCP tool response
 */
export function formatRawResponse(content: string) {
  return {
    content: [{ type: 'text' as const, text: content }],
  };
}

/**
 * Formats an error as an MCP tool response with isError flag.
 *
 * @param error - Error object or message string
 * @returns Formatted MCP tool error response
 */
export function formatErrorResponse(error: Error | string) {
  const message = error instanceof Error ? error.message : error;
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

// ==================== Pagination Utilities ====================

/**
 * Validated pagination parameters with helper methods.
 */
export interface ValidatedPagination {
  /** Validated offset (guaranteed >= 0) */
  offset: number;
  /** Validated limit (guaranteed within SEARCH_LIMITS.MIN to SEARCH_LIMITS.MAX) */
  limit: number;
  /**
   * Check if there are more results beyond the current page.
   * @param totalCount - Total number of items
   * @returns true if there are more items after this page
   */
  hasMore: (totalCount: number) => boolean;
}

/**
 * Validates and normalizes pagination parameters.
 * Ensures offset is non-negative and limit is within configured bounds.
 *
 * @param offset - Starting position (default: 0)
 * @param limit - Maximum results to return (default: SEARCH_LIMITS.DEFAULT)
 * @returns Validated pagination parameters with helper methods
 *
 * @example
 * ```typescript
 * const pagination = validatePagination(10, 50);
 * const results = items.slice(pagination.offset, pagination.offset + pagination.limit);
 * if (pagination.hasMore(items.length)) {
 *   console.log('More results available');
 * }
 * ```
 */
export function validatePagination(
  offset: number = 0,
  limit: number = SEARCH_LIMITS.DEFAULT
): ValidatedPagination {
  const validatedOffset = Math.max(0, offset);
  const validatedLimit = Math.min(
    Math.max(SEARCH_LIMITS.MIN, limit),
    SEARCH_LIMITS.MAX
  );

  return {
    offset: validatedOffset,
    limit: validatedLimit,
    hasMore: (totalCount: number) => validatedOffset + validatedLimit < totalCount,
  };
}

/**
 * Applies pagination to an array of items.
 *
 * @param items - Array to paginate
 * @param pagination - Validated pagination parameters
 * @returns Paginated slice of the array
 *
 * @example
 * ```typescript
 * const pagination = validatePagination(offset, limit);
 * const pageResults = applyPagination(allResults, pagination);
 * ```
 */
export function applyPagination<T>(
  items: T[],
  pagination: ValidatedPagination
): T[] {
  return items.slice(pagination.offset, pagination.offset + pagination.limit);
}

/**
 * Applies pagination using raw offset and limit values.
 * Combines validation and application in one call.
 *
 * @param items - Array to paginate
 * @param offset - Starting position
 * @param limit - Maximum results
 * @returns Paginated slice of the array
 */
export function paginateArray<T>(
  items: T[],
  offset: number = 0,
  limit: number = SEARCH_LIMITS.DEFAULT
): T[] {
  const pagination = validatePagination(offset, limit);
  return applyPagination(items, pagination);
}

/**
 * Calculates pagination metadata for a result set.
 *
 * @param totalCount - Total number of items
 * @param offset - Current offset
 * @param limit - Current limit
 * @returns Pagination metadata
 */
export function getPaginationMeta(
  totalCount: number,
  offset: number = 0,
  limit: number = SEARCH_LIMITS.DEFAULT
): {
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  pageNumber: number;
  totalPages: number;
} {
  const pagination = validatePagination(offset, limit);

  return {
    totalCount,
    offset: pagination.offset,
    limit: pagination.limit,
    hasMore: pagination.hasMore(totalCount),
    pageNumber: Math.floor(pagination.offset / pagination.limit) + 1,
    totalPages: Math.ceil(totalCount / pagination.limit),
  };
}
