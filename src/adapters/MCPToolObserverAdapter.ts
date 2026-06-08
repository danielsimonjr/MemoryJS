/**
 * MCPToolObserverAdapter — Phase Tool C protocol shim.
 *
 * Light adapter that wraps a generic MCP-style tool-call envelope and
 * threads it through `ToolCallObserver`. MemoryJS doesn't ship an MCP
 * server itself — this adapter is a compatibility shim for callers
 * building on `@modelcontextprotocol/sdk` (or equivalent).
 *
 * Uses **structural typing** on the envelope (no
 * `@modelcontextprotocol/sdk` dep). Supports the common shapes:
 * - `{ name: string }` — direct tool call
 * - `{ tool: string }` — alternate naming
 * - `{ method: 'tools/call', params: { name: string } }` — MCP JSON-RPC
 *
 * Unrecognized shapes fall back to a `'unknown'` tool name so the
 * observation still runs — operators can later grep the
 * `unknown` record to debug their envelope shape.
 *
 * @module adapters/MCPToolObserverAdapter
 */

import type { ToolCallObserver } from '../agent/ToolCallObserver.js';

/**
 * Best-effort extraction of a tool name from an arbitrary MCP-like
 * envelope. Returns `'unknown'` when no recognized shape matches.
 */
export function extractToolName(envelope: unknown): string {
  if (envelope === null || envelope === undefined || typeof envelope !== 'object') {
    return 'unknown';
  }
  const obj = envelope as Record<string, unknown>;

  if (typeof obj.name === 'string' && obj.name.length > 0) return obj.name;
  if (typeof obj.tool === 'string' && obj.tool.length > 0) return obj.tool;

  if (obj.method === 'tools/call' && typeof obj.params === 'object' && obj.params !== null) {
    const params = obj.params as Record<string, unknown>;
    if (typeof params.name === 'string' && params.name.length > 0) return params.name;
  }
  return 'unknown';
}

export class MCPToolObserverAdapter {
  private readonly observer: ToolCallObserver;

  constructor(observer: ToolCallObserver) {
    this.observer = observer;
  }

  /**
   * Run `handler` inside an observation window. On resolve calls
   * `observeComplete`; on throw calls `observeError` and re-throws the
   * original error (preserves stack and type). The handler is awaited
   * once — callers retain control over retries and abort signals.
   */
  async wrapToolCall<T>(envelope: unknown, handler: () => Promise<T>): Promise<T> {
    const toolName = extractToolName(envelope);
    const callId = this.observer.observeStart(toolName, envelope as Record<string, unknown>);
    try {
      const result = await handler();
      await this.observer.observeComplete(callId);
      return result;
    } catch (err) {
      await this.observer.observeError(
        callId,
        err instanceof Error ? err : String(err),
      );
      throw err;
    }
  }
}
