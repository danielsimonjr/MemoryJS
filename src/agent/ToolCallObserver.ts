/**
 * ToolCallObserver — Phase Tool B producer pipeline.
 *
 * The canonical caller for `ToolAffordanceManager`. External systems
 * (MCP server, agent wrapper, custom runtime) call
 * `observeStart(toolName)` before running a tool and
 * `observeComplete` / `observeError` / `observePartial` after. The
 * observer computes `durationMs`, threads through to the manager, and
 * emits events for any external telemetry subscribers.
 *
 * @module agent/ToolCallObserver
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ToolAffordanceManager } from './ToolAffordanceManager.js';

interface InFlightCall {
  toolName: string;
  startedAtMs: number;
  args?: Record<string, unknown>;
}

export type ToolCallEvent =
  | 'toolCall:start'
  | 'toolCall:complete'
  | 'toolCall:error'
  | 'toolCall:partial';

export class ToolCallObserver {
  /** Public event emitter — subscribe for `toolCall:start|complete|error|partial`. */
  public readonly events = new EventEmitter();

  private readonly manager: ToolAffordanceManager;
  private readonly inFlight: Map<string, InFlightCall> = new Map();

  constructor(manager: ToolAffordanceManager) {
    this.manager = manager;
  }

  /**
   * Begin observing a tool call. Returns a call id the caller threads
   * through to one of `observeComplete` / `observeError` /
   * `observePartial` / `cancel`. Emits `toolCall:start`.
   */
  observeStart(toolName: string, args?: Record<string, unknown>): string {
    if (typeof toolName !== 'string' || toolName.trim().length === 0) {
      throw new Error(
        `ToolCallObserver.observeStart: toolName must be a non-empty string`,
      );
    }
    const callId = `call-${randomUUID()}`;
    const entry: InFlightCall = {
      toolName,
      startedAtMs: Date.now(),
      args,
    };
    this.inFlight.set(callId, entry);
    this.events.emit('toolCall:start', { callId, toolName, args });
    return callId;
  }

  /**
   * Record successful completion. No-op when `callId` is unknown
   * (defensive — callers may double-call or pass stale ids; we don't
   * pollute the affordance stats with phantom successes).
   */
  async observeComplete(callId: string, meta?: { result?: string }): Promise<void> {
    const entry = this.inFlight.get(callId);
    if (!entry) return;
    this.inFlight.delete(callId);
    const durationMs = Date.now() - entry.startedAtMs;
    await this.manager.recordOutcome(entry.toolName, {
      outcome: 'success',
      durationMs,
    });
    this.events.emit('toolCall:complete', {
      callId,
      toolName: entry.toolName,
      durationMs,
      result: meta?.result,
    });
  }

  /**
   * Record a failure. `error` may be an `Error` instance or a plain
   * string; the message is stored in `errorMessage` for the manager's
   * `commonFailureModes` ranking. No-op on unknown `callId`.
   */
  async observeError(callId: string, error: Error | string): Promise<void> {
    const entry = this.inFlight.get(callId);
    if (!entry) return;
    this.inFlight.delete(callId);
    const durationMs = Date.now() - entry.startedAtMs;
    const message = error instanceof Error ? error.message : String(error);
    await this.manager.recordOutcome(entry.toolName, {
      outcome: 'failure',
      errorMessage: message,
      durationMs,
    });
    this.events.emit('toolCall:error', {
      callId,
      toolName: entry.toolName,
      durationMs,
      errorMessage: message,
    });
  }

  /**
   * Record a partial outcome — the tool returned a usable but
   * incomplete result. `reason` is stored as the `errorMessage`
   * so it surfaces in `commonFailureModes`. No-op on unknown
   * `callId`.
   */
  async observePartial(callId: string, reason: string): Promise<void> {
    const entry = this.inFlight.get(callId);
    if (!entry) return;
    this.inFlight.delete(callId);
    const durationMs = Date.now() - entry.startedAtMs;
    await this.manager.recordOutcome(entry.toolName, {
      outcome: 'partial',
      errorMessage: reason,
      durationMs,
    });
    this.events.emit('toolCall:partial', {
      callId,
      toolName: entry.toolName,
      durationMs,
      reason,
    });
  }

  /**
   * Drop an in-flight observation without recording — e.g. the user
   * cancelled the tool call before it completed. No-op on unknown
   * `callId`.
   */
  cancel(callId: string): void {
    this.inFlight.delete(callId);
  }

  /** Number of in-flight (started but not yet completed) calls. */
  inFlightCount(): number {
    return this.inFlight.size;
  }
}
